/** Native VS Code surfaces hosting the unmodified official Web application. */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { probe } from './shared-backend.ts';
import { NativeChannel } from './native-channel.ts';
import { WorkspaceBackends } from './workspace-backends.ts';
import { Transport } from './transport.ts';
import { expandHome, findCli, findNode } from './runtime.ts';
import { startupCopy, startupHtml, type StartupState } from './startup.ts';
import { record, redact } from './protocol.ts';
import { WebRelay } from './relay.ts';
import { webviewHtml } from './html.ts';
import { copy } from './locale.ts';
import { sessionLabel, tabLabel, type EditorContext } from './messages.ts';
import { ClientAssets } from './assets.ts';
import { MessageDelivery } from './delivery.ts';
import { findNpx, installHarness } from './install.ts';

type Surface = vscode.WebviewView | vscode.WebviewPanel;

/**
 * One hosted surface and everything that belongs to its current connection.
 *
 * `generation` and `epoch` identify one load attempt: a late callback from an
 * older generation must not publish into a newer Webview, and the Webview tags
 * every message with the epoch it was created for.
 */
interface View {
  detached?: boolean;
  visible: boolean;
  reconnectPending?: boolean;
  reconnectAvailable?: boolean;
  loadFailed?: boolean;
  surface: Surface;
  epoch?: string;
  relay?: WebRelay;
  connection?: Transport;
  release?: () => Promise<void>;
  delivery?: MessageDelivery;
  timer?: ReturnType<typeof setTimeout>;
  loading?: Promise<void>;
  pendingNew?: boolean;
  disposed: boolean;
  cwd: string;
  mode: 'chat' | 'settings';
  ready: boolean;
  fresh: boolean;
  generation: number;
  editorTab?: boolean;
  sessionId?: string;
  title?: string
}

let app: Application | undefined;

/** @param context - VS Code extension lifetime and storage. */
export function activate(context: vscode.ExtensionContext): void {
  app = new Application(context);
  context.subscriptions.push(app);
}
/** @returns Completion after view connections close; the shared backend keeps running. */
export async function deactivate(): Promise<void> { await app?.shutdown(); app = undefined; }

class Application implements vscode.Disposable {
  private readonly backends: WorkspaceBackends;
  private readonly nativeChannels = new Map<string, NativeChannel>();
  private readonly retainedPages = new Map<string, string>();
  private focusedPage?: { cwd: string; epoch: string };
  private recovering = false;
  private readonly launches = new Map<string, Promise<string>>();
  private sidebar?: View;
  private settings?: View;
  private readonly views = new Set<View>();
  private readonly output = vscode.window.createOutputChannel('DeepSeek Harness');
  private readonly subscriptions: vscode.Disposable[] = [];
  private lastEditor = vscode.window.activeTextEditor;
  private pendingFresh = false;
  private stopping?: Promise<void>;
  private readonly assets = new Map<string, ClientAssets>();
  private attachedUrl?: string;
  private installation?: { controller: AbortController; done: Promise<void> };
  private windowFocused = vscode.window.state.focused;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.backends = new WorkspaceBackends(
      join(homedir(), '.dsh-vscode'),
      join(context.extensionPath, 'dist/supervisor.cjs'),
      line => this.output.appendLine(line),
      vscode.env.sessionId,
    );
    this.subscriptions.push(this.output,
      // Panel serializers restore the editor and settings tabs VS Code reopens after a reload.
      ...(['deepseekHarness.editor', 'deepseekHarness.settings'] as const).map(kind => vscode.window.registerWebviewPanelSerializer(kind, {
        deserializeWebviewPanel: async (panel, state: unknown) => {
          const saved = state !== null && typeof state === 'object' && !Array.isArray(state) ? record(state) : {};
          panel.webview.options = { enableScripts: true };
          if (kind === 'deepseekHarness.settings') this.settings = this.attach(panel, 'settings', false,
            typeof saved.cwd === 'string' && isAbsolute(saved.cwd) ? saved.cwd : this.workspace().uri.fsPath);
          else {
            // Restore the workspace and session the tab carried before the reload.
            const cwd = typeof saved.cwd === 'string' && isAbsolute(saved.cwd) ? saved.cwd : this.workspace().uri.fsPath;
            const sessionId = typeof saved.sessionId === 'string' && saved.sessionId ? saved.sessionId : undefined;
            panel.iconPath = { light: vscode.Uri.file(join(this.context.extensionPath, 'resources/whale-light.svg')), dark: vscode.Uri.file(join(this.context.extensionPath, 'resources/whale-dark.svg')) };
            this.attach(panel, 'chat', !sessionId, cwd, sessionId, typeof saved.title === 'string' ? saved.title : undefined);
          }
        },
      })),

      // The activity-bar view keeps its DOM while hidden so a reopen stays instant.
      vscode.window.registerWebviewViewProvider('deepseekHarness.chat', { resolveWebviewView: view => {
        this.sidebar = this.attach(view, 'chat', this.pendingFresh);
        this.pendingFresh = false;
      } }, { webviewOptions: { retainContextWhenHidden: true } }),

      // Commands exposed through the Command Palette and the editor title bar.
      vscode.commands.registerCommand('deepseekHarness.open', () => this.open(false)),
      vscode.commands.registerCommand('deepseekHarness.newSession', () => this.open(true)),
      vscode.commands.registerCommand('deepseekHarness.newEditorSession', () => { try { this.output.appendLine('command: new editor'); this.openEditor(); } catch (error) { this.report(error); } }),
      vscode.commands.registerCommand('deepseekHarness.reloadView', () => {
        // Reload whichever view is on screen, falling back to the sidebar.
        const active = [...this.views].find(view => 'active' in view.surface && view.surface.active);
        const view = active ?? this.sidebar ?? [...this.views].at(-1);
        if (!active && this.focusedPage) {
          this.nativeChannels.get(this.focusedPage.cwd)?.send(this.focusedPage.epoch, { kind: 'reconnect-client' });
          return;
        }
        if (view?.detached && view.epoch) this.nativeChannels.get(view.cwd)?.send(view.epoch, { kind: 'reconnect-client' });
        else if (this.focusedPage) this.nativeChannels.get(this.focusedPage.cwd)?.send(this.focusedPage.epoch, { kind: 'reconnect-client' });
        else if (view) { this.reset(view); void this.load(view); }
      }),
      vscode.commands.registerCommand('deepseekHarness.settings', () => this.openSettings()),
      vscode.commands.registerCommand('deepseekHarness.stop', () => this.stopBackends(this.workspace().uri.fsPath)),
      vscode.commands.registerCommand('deepseekHarness.stopAll', () => this.stopBackends()),
      vscode.commands.registerCommand('deepseekHarness.connect', async () => {
        // Attaching to an external backend replaces any owned one for this session.
        const value = await vscode.window.showInputBox({ prompt: copy(vscode.env.language).connectPrompt, password: true, ignoreFocusOut: true });
        if (!value) return;
        await this.shutdown();
        this.attachedUrl = value;
        for (const view of this.views) void this.load(view);
        await this.open(false);
      }),

      // Editor and window events that keep every view's context and visibility current.
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) { this.lastEditor = editor; this.editorContext(editor); } }),
      vscode.window.onDidChangeTextEditorSelection(event => { this.lastEditor = event.textEditor; this.editorContext(event.textEditor); }),
      vscode.window.onDidChangeWindowState(state => { this.windowFocused = state.focused; for (const view of this.views) this.visibilityChanged(view); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { if (this.sidebar) void this.load(this.sidebar); }),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('workbench.editor.tabSizing')) for (const view of this.views) this.applyTitle(view); }),
    );
    void this.restoreBackend();
  }

  /** Reconnect a discovered workspace backend without starting one on every VS Code launch. */
  private async restoreBackend(): Promise<void> {
    if (!vscode.workspace.isTrusted || !vscode.workspace.workspaceFolders?.length) return;
    try {
      const cwd = this.workspace().uri.fsPath;
      if (await this.backends.exists(cwd)) { await this.backendUrl(cwd); await this.nativeChannel(cwd); }
      for (const retained of await this.backends.retainedWorkspaces()) await this.nativeChannel(retained);
    } catch (error) { this.output.appendLine(redact(String(error))); }
  }

  /** Restore native actions even when VS Code retains a panel without deserializing it. */
  private async nativeChannel(cwd: string): Promise<NativeChannel | undefined> {
    const target = await this.backends.control(cwd);
    if (!target) return undefined;
    if ((await probe(target))?.pageRelay !== 1) return undefined;
    const existing = this.nativeChannels.get(cwd);
    if (existing?.target.token === target.token) return existing;
    existing?.dispose();
    const channel = new NativeChannel(target, vscode.env.sessionId, async (epoch, message) => {
      this.retainedPages.set(epoch, cwd);
      if (message.kind === 'focus') this.focusedPage = { cwd, epoch };
      if (this.lastEditor && ['focus', 'client-ready'].includes(String(message.kind))) {
        const context = this.selectionContext(this.lastEditor, cwd);
        if (context) channel.send(epoch, { kind: 'editor-context', context });
      }
      const view = [...this.views].find(view => view.epoch === epoch && !view.disposed);
      if (view) { await this.receive(view, { ...message, epoch }); return; }
      // Orphaned panels have no VS Code handle, but native commands still belong to their window.
      switch (message.kind) {
        case 'new-editor': this.openEditor(cwd); break;
        case 'settings': this.openSettings(cwd); break;
        case 'close-settings': {
          const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
          if (tab?.input instanceof vscode.TabInputWebview && tab.input.viewType === 'deepseekHarness.settings') {
            await vscode.window.tabGroups.close(tab);
          }
          break;
        }
        case 'clipboard':
          if (typeof message.text !== 'string' || typeof message.id !== 'string') return;
          await vscode.env.clipboard.writeText(message.text);
          channel.send(epoch, { kind: 'reply', id: message.id });
          break;
        case 'open-settings-document':
          await this.openSettingsDocument(cwd);
          channel.send(epoch, { kind: 'reply', id: message.id });
          break;
        case 'external':
          if (typeof message.url === 'string') {
            const uri = vscode.Uri.parse(message.url);
            if (['https', 'http', 'mailto'].includes(uri.scheme)) await vscode.env.openExternal(uri);
          }
          break;
        case 'session-create-failed': await this.sessionCreateFailed(String(message.error), cwd); break;
        case 'client-failure':
        case 'client-diagnostic': this.output.appendLine(redact(String(message.error))); break;
      }
    });
    this.nativeChannels.set(cwd, channel);
    return channel;
  }

  /** @param cwd - Page workspace. @returns Completion after the settings document opens. */
  private async openSettingsDocument(cwd: string): Promise<void> {
    const settings = vscode.workspace.getConfiguration('deepseekHarness');
    const configured = settings.get<string>('settingsPath', '');
    const home = settings.get<string>('home', '') || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
    let path = configured || (!this.attachedUrl ? join(resolve(cwd, expandHome(home)), 'settings.yaml') : undefined);
    if (!path) {
      const selected = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false,
        filters: { 'YAML / JSON': ['yaml', 'yml', 'json'] } });
      path = selected?.[0]?.fsPath;
    }
    if (!path) throw new Error(copy(vscode.env.language).cancelled);
    if (!isAbsolute(path)) throw new Error(copy(vscode.env.language).absoluteSettings);
    let uri = vscode.Uri.file(path);
    try { await access(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      uri = uri.with({ scheme: 'untitled' });
    }
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Active });
  }

  /** @returns The workspace folder every non-editor view runs in. */
  private workspace(): vscode.WorkspaceFolder {
    // An untrusted workspace never reaches the backend: credentials and files are at stake.
    if (!vscode.workspace.isTrusted) throw new Error(copy(vscode.env.language).workspace);

    const active = this.lastEditor ? vscode.workspace.getWorkspaceFolder(this.lastEditor.document.uri) : undefined;
    const folder = active ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== 'file') throw new Error(copy(vscode.env.language).workspace);
    return folder;
  }

  /** @param fresh - Whether the sidebar should end up on a new session. */
  private async open(fresh: boolean): Promise<void> {
    this.pendingFresh = fresh;
    await vscode.commands.executeCommand('deepseekHarness.chat.focus');
    if (this.sidebar) {
      (this.sidebar.surface as vscode.WebviewView).show(false);
      const cwd = this.workspace().uri.fsPath;

      // A view already loading takes the request through pendingNew instead.
      if (this.sidebar.loading) { if (fresh) this.sidebar.pendingNew = true; await this.sidebar.loading; }
      else if (this.sidebar.cwd !== cwd || !this.sidebar.relay) { this.sidebar.fresh ||= fresh; await this.load(this.sidebar); }
      else if (fresh && this.sidebar.ready) await this.sidebar.surface.webview.postMessage({ kind: 'new-session' });
      else if (fresh) this.sidebar.pendingNew = true;
      this.pendingFresh = false;
    }
  }

  /** Show the reusable settings panel, loading it when it has no connection yet. */
  private openSettings(cwd = this.workspace().uri.fsPath): void {
    if (this.settings && this.settings.cwd !== cwd) {
      (this.settings.surface as vscode.WebviewPanel).dispose();
    }
    if (this.settings) {
      (this.settings.surface as vscode.WebviewPanel).reveal();
      if (!this.settings.relay) void this.load(this.settings);
      return;
    }

    const panel = vscode.window.createWebviewPanel('deepseekHarness.settings', copy(vscode.env.language).settings, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    this.settings = this.attach(panel, 'settings', false, cwd);
  }

  /** @param cwd - Workspace the new editor tab is bound to. */
  private openEditor(cwd = this.workspace().uri.fsPath): void {
    const panel = vscode.window.createWebviewPanel('deepseekHarness.editor', 'DeepSeek Harness', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = { light: vscode.Uri.file(join(this.context.extensionPath, 'resources/whale-light.svg')), dark: vscode.Uri.file(join(this.context.extensionPath, 'resources/whale-dark.svg')) };
    this.attach(panel, 'chat', true, cwd);
  }

  /**
   * Name one editor view's tab: a chat tab follows its session, while a
   * settings panel keeps the localized surface name it was created with.
   *
   * `fit` sizing grows a tab with its label, so that mode alone needs the label
   * bounded; `fixed` and `shrink` ellipsize the label themselves and keep the
   * whole title as the tab's hover text.
   * @param view - The attached view whose panel follows the session title.
   */
  private applyTitle(view: View): void {
    if (!view.editorTab) return;

    // A settings panel shows no session, so naming it after one would replace
    // its localized title with the product name.
    if (view.mode === 'settings') {
      (view.surface as vscode.WebviewPanel).title = copy(vscode.env.language).settings;
      return;
    }

    const title = view.title;
    const sizing = title === undefined ? 'fit' : vscode.workspace.getConfiguration('workbench.editor').get<string>('tabSizing', 'fit');
    (view.surface as vscode.WebviewPanel).title = title === undefined ? 'DeepSeek Harness' : sizing === 'fit' ? tabLabel(title) : sessionLabel(title);
  }

  /** @param surface - The view or panel to host. @param mode - Chat or settings surface. @param fresh - Whether the view starts on a new session. @param editorCwd - Workspace of an editor tab; omitted for the sidebar and settings. @param sessionId - Session the tab restores. @param title - Title the tab restores. @returns The tracked view. */
  private attach(surface: Surface, mode: View['mode'], fresh: boolean, editorCwd?: string, sessionId?: string, title?: string): View {
    const view: View = { sessionId, title, visible: surface.visible && this.windowFocused, surface, mode, fresh, disposed: false, cwd: editorCwd ?? '', ready: false, generation: 0, editorTab: editorCwd !== undefined };
    this.views.add(view);
    this.applyTitle(view);

    // Every Webview message is handled asynchronously and reported, never rethrown.
    const listener = surface.webview.onDidReceiveMessage((value: unknown) => {
      void this.receive(view, value).catch(error => this.report(error));
    });

    // Panels and sidebar views expose visibility through differently named events.
    const visibility = 'onDidChangeViewState' in surface
      ? surface.onDidChangeViewState(() => this.visibilityChanged(view))
      : surface.onDidChangeVisibility(() => this.visibilityChanged(view));

    surface.onDidDispose(() => {
      view.disposed = true;
      this.reset(view);
      listener.dispose();
      visibility.dispose();
      this.views.delete(view);
      if (this.sidebar === view) this.sidebar = undefined;
      if (this.settings === view) this.settings = undefined;
      void view.relay?.dispose().catch(error => this.report(error));
    });

    void this.load(view);
    return view;
  }

  /** @param view - The view whose visibility may have changed. */
  private visibilityChanged(view: View): void {
    const visible = view.surface.visible && this.windowFocused;
    if (view.disposed || view.visible === visible) return;
    view.visible = visible;
    view.delivery?.setVisible(view.visible);

    if (!view.visible) {
      // A hidden Webview keeps its DOM but may stop running JavaScript.
      view.reconnectAvailable = true;
      clearTimeout(view.timer);
      view.timer = undefined;
    } else if (view.reconnectPending) this.reconnect(view);
    else if (view.relay && !view.ready) this.watchInitialization(view);
  }

  /** @param view - A loaded view that has not reported readiness yet. */
  private watchInitialization(view: View): void {
    clearTimeout(view.timer);
    view.timer = undefined;
    if (!view.visible) return;

    // A visible Webview that never reports readiness is an error, not a slow load.
    const timeout = vscode.workspace.getConfiguration('deepseekHarness').get('webviewTimeoutSeconds', 60) * 1000;
    view.timer = setTimeout(() => this.failed(view, new Error(copy(vscode.env.language).loadTimeout)), timeout);
  }

  /** @param view - The view to reload after it became visible again. */
  private reconnect(view: View): void {
    view.reconnectPending = false;
    view.reconnectAvailable = false;
    // A tab that already owned a session must not create another one.
    if (view.sessionId) view.fresh = false;

    this.output.appendLine('view: reconnecting after visibility change');
    void this.load(view);
  }

  /** @param cwd - Workspace the backend is launched for. @returns The authenticated launch URL of the owned or attached backend. */
  private async backendUrl(cwd: string): Promise<string> {
    if (this.stopping) await this.stopping;
    if (this.attachedUrl) return this.attachedUrl;

    let launch = this.launches.get(cwd);
    if (!launch) {
      const settings = vscode.workspace.getConfiguration('deepseekHarness');
      const home = settings.get<string>('home', '') || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
      launch = this.backends.connect({
        cwd, harnessPath: settings.get('harnessPath', ''), binPath: settings.get('binPath', ''),
        home: resolve(cwd, expandHome(home)),
        startupTimeoutSeconds: settings.get('startupTimeoutSeconds', 90),
      });
      this.launches.set(cwd, launch);
      const pending = launch;
      const clear = (): void => {
        if (this.launches.get(cwd) === pending) this.launches.delete(cwd);
      };
      void launch.then(clear, clear);
    }
    return launch;
  }

  /** @param view - The view to load. @returns Completion of the in-flight load for that view. */
  private load(view: View): Promise<void> {
    if (view.loading) return view.loading;

    // Failures are surfaced inside the view; callers never observe a rejection.
    const task = this.loadView(view).catch(error => this.report(error));
    view.loading = task;
    void task.finally(() => { if (view.loading === task) view.loading = undefined; });
    return task;
  }

  /** @param view - The view to (re)connect and publish. */
  private async loadView(view: View): Promise<void> {
    // Invalidate the previous generation before tearing it down.
    view.detached = false;
    view.loadFailed = false;
    view.reconnectPending = false;
    clearTimeout(view.timer);
    view.timer = undefined;
    view.delivery?.dispose();
    view.delivery = undefined;
    const generation = ++view.generation;
    const epoch = view.epoch = randomBytes(18).toString('base64');
    const active = (): boolean => !view.disposed && generation === view.generation;
    view.ready = false;

    const old = view.relay; const oldConnection = view.connection; const oldRelease = view.release;
    view.relay = undefined; view.connection = undefined; view.release = undefined;
    try { await (old ? old.dispose() : oldConnection?.dispose()); }
    finally { await oldRelease?.(); }
    if (!active()) return;

    const text = copy(vscode.env.language);
    const timeout = vscode.workspace.getConfiguration('deepseekHarness').get('webviewTimeoutSeconds', 60) * 1000;
    const phase = (name: string): void => this.output.appendLine(`view ${generation}: ${name}`);
    phase('loading');
    view.surface.webview.options = { enableScripts: true };
    view.surface.webview.html = this.status(text.loading);

    let transport: Transport | undefined;
    try {
      const cwd = view.editorTab ? view.cwd : this.workspace().uri.fsPath;
      if (view.cwd && view.cwd !== cwd) {
        view.sessionId = undefined;
        view.title = undefined;
        view.fresh = false;
      }
      view.cwd = cwd;

      // Check the local prerequisites once, before any backend is started, so a
      // missing Node.js or CLI becomes the setup page instead of a launch error.
      if (!this.attachedUrl && !this.launches.has(cwd)) {
        const settings = vscode.workspace.getConfiguration('deepseekHarness');
        const failures: StartupState = {};
        try { await findNode(); } catch (error) { failures.nodeError = redact(String(error)); this.output.appendLine(failures.nodeError); }
        try { findCli(settings.get('harnessPath', ''), cwd, settings.get('binPath', '')); } catch (error) { failures.binError = redact(String(error)); this.output.appendLine(failures.binError); }
        if (!active()) return;
        if (failures.nodeError !== undefined || failures.binError !== undefined) { view.surface.webview.html = this.setupPage(failures); return; }
      }

      const url = await this.backendUrl(cwd);
      if (!active()) return;
      phase('backend ready');
      if (!this.attachedUrl) {
        const release = await this.backends.lease(cwd, stopped => {
          if (!active()) return;
          this.launches.delete(cwd);
          void this.backends.invalidate(cwd).catch(error => this.output.appendLine(redact(String(error))));
          if (stopped) {
            view.reconnectPending = false;
            view.reconnectAvailable = false;
            void this.reset(view);
            view.surface.webview.html = this.status(copy(vscode.env.language).stopped, true);
          } else this.failed(view, new Error(copy(vscode.env.language).stopped));
        });
        if (!active()) { await release(); return; }
        view.release = release;
      }

      // Losing the authenticated connection invalidates cached assets too.
      transport = new Transport(error => {
        if (!active() || view.detached) return;
        this.launches.delete(cwd);
        this.assets.delete(url);
        void this.backends.invalidate(cwd).catch(error => this.output.appendLine(redact(String(error))));
        this.failed(view, error);
      });
      view.connection = transport;
      await transport.connect(url);
      if (!active()) { await transport.dispose(); return; }

      const maxBytes = vscode.workspace.getConfiguration('deepseekHarness').get('maxTransferMegabytes', 64) * 1024 * 1024;
      const assets = this.assets.get(url) ?? new ClientAssets(maxBytes);
      this.assets.set(url, assets);
      const delivery = new MessageDelivery(value => view.surface.webview.postMessage(value), error => { if (active()) this.failed(view, error); }, maxBytes * 4, timeout);
      view.delivery = delivery;
      delivery.setVisible(view.visible);

      // The relay owns this view's requests and its own view of the asset cache.
      const relay = new WebRelay(transport, value => { if (active()) delivery.send(value); }, maxBytes,
        (path, signal) => assets.fetch(path, resource => transport!.request(resource, { signal })));
      view.relay = relay;
      this.watchInitialization(view);

      // Assets are cached per extension installation so a restart reuses them.
      const cache = join(this.context.globalStorageUri.fsPath, 'web-assets');
      const webview = view.surface.webview;
      webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri, vscode.Uri.file(cache)] };
      const uri = (path: string): string => webview.asWebviewUri(vscode.Uri.file(path)).toString();
      const response = await transport.request('/');
      if (!response.ok) throw new Error(`Official Web bootstrap HTTP ${response.status}`);

      let recovery: { url: string; token: string } | undefined;
      if (!this.attachedUrl) {
        const channel = await this.nativeChannel(cwd);
        const token = await channel?.register(epoch, maxBytes);
        if (token && channel) {
          const forwarded = await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${channel.target.port}/page`));
          const endpoint = new URL(forwarded.toString());
          endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
          recovery = { url: endpoint.href, token };
        }
      }
      view.detached = Boolean(recovery);
      // Rewrite the official bootstrap and publish it as this view's document.
      const html = await webviewHtml(await response.text(), {
        fetch: path => assets.fetch(path, resource => transport!.request(resource)), cacheRoot: cache, uri,
        inlineStatic: vscode.workspace.getConfiguration('deepseekHarness').get('inlineStaticResources', false),
        bridgeUri: uri(join(this.context.extensionPath, 'dist/bridge.js')),
        adapterUri: uri(join(this.context.extensionPath, 'dist/adapter.js')),
        styleUri: uri(join(this.context.extensionPath, 'webview/style.css')), cspSource: webview.cspSource,
      }, { recovery, cwd, mode: view.mode, language: vscode.env.language, fresh: view.fresh, editorTab: view.editorTab,
        sessionTitle: view.fresh ? undefined : view.title,
        queueRevealDelayMs: vscode.workspace.getConfiguration('deepseekHarness').get('queueRevealDelayMilliseconds', 250),
        sessionId: view.editorTab ? view.sessionId : this.context.workspaceState.get<string>(`v2.session:${cwd}`), nonce: epoch, maxTransferBytes: maxBytes, requestTimeoutMs: timeout });
      if (active()) { phase(`HTML published (${Buffer.byteLength(html)} bytes)`); webview.html = html; } else await relay.dispose();
    } catch (error) {
      await transport?.dispose();
      if (active()) this.failed(view, error instanceof Error ? error : new Error(String(error)));
      this.output.appendLine(redact(String(error)));
    }
  }

  /** @param view - The view whose connection must be dropped without touching the backend. */
  private reset(view: View): Promise<void> {
    // Bumping the generation invalidates every callback still in flight.
    view.detached = false;
    view.epoch = undefined;
    view.generation++;
    clearTimeout(view.timer);
    view.timer = undefined;
    view.ready = false;
    view.loading = undefined;
    view.delivery?.dispose();
    view.delivery = undefined;

    const relay = view.relay; const connection = view.connection; const release = view.release;
    view.relay = undefined; view.connection = undefined; view.release = undefined;
    return (async () => {
      try { await (relay ? relay.dispose() : connection?.dispose()); }
      finally { await release?.(); }
    })().catch(error => this.output.appendLine(redact(String(error))));
  }

  /** @param view - The view whose connection failed. @param error - The failure to show. */
  private failed(view: View, error: Error): void {
    if (error.message === 'legacy-workspace-backend') error = new Error(copy(vscode.env.language).legacyBackend);
    this.reset(view);
    view.loadFailed = true;
    this.output.appendLine(redact(error.message));
    if (view.disposed) return;

    // A hidden view reconnects on its own once it becomes visible again.
    view.reconnectPending = true;
    if (!view.visible) return;
    if (view.reconnectAvailable) { this.reconnect(view); return; }
    view.surface.webview.html = this.status(`${copy(vscode.env.language).failed}: ${redact(error.message)}`, true);
  }

  /** @param message - Localized status text. @param retry - Whether the page offers a retry action. */
  private status(message: string, retry = false): string {
    return this.setupPage({ message: message === copy(vscode.env.language).loading ? startupCopy(vscode.env.language).loading : message, retry });
  }

  /** @param state - Loading or setup status. @returns The pre-client page for this view. */
  private setupPage(state: StartupState): string {
    return startupHtml(vscode.env.language, randomBytes(18).toString('base64'), readFileSync(join(this.context.extensionPath, 'resources/whale.svg'), 'utf8'), state);
  }

  /**
   * Ask for a Harness location until one validates, then reload the view.
   * @param view - The setup page's view, which shows the picker's result.
   * @param directory - Whether a DSH folder rather than a bin.js file is selected.
   */
  private async configureRuntime(view: View, directory: boolean): Promise<void> {
    const t = startupCopy(vscode.env.language);
    const settings = vscode.workspace.getConfiguration('deepseekHarness');
    const validate = (input: string): string | undefined => {
      try { findCli(directory ? input : '', view.cwd, directory ? '' : input); return input.trim() ? undefined : t.invalid; }
      catch { return t.invalid; }
    };

    // Reopen the picker after an invalid path; cancel or a disposed view ends the loop.
    while (!view.disposed) {
      const selected = await vscode.window.showOpenDialog({
        title: directory ? t.directoryPrompt : t.binPrompt, openLabel: directory ? t.directoryAction : t.binAction,
        canSelectFiles: !directory, canSelectFolders: directory, canSelectMany: false,
        ...(directory ? {} : { filters: { JavaScript: ['js'] } }),
      });
      const value = selected?.[0]?.fsPath;
      if (value === undefined || view.disposed) return;

      const error = validate(value);
      if (error) { await vscode.window.showErrorMessage(error); continue; }

      if (directory) {
        // Store the resolved entry first so an interrupted settings write still selects this runtime.
        await settings.update('binPath', findCli(value.trim(), view.cwd), vscode.ConfigurationTarget.Global);
        await settings.update('harnessPath', expandHome(value.trim()), vscode.ConfigurationTarget.Global);
        await settings.update('binPath', undefined, vscode.ConfigurationTarget.Global);
      } else await settings.update('binPath', expandHome(value.trim()), vscode.ConfigurationTarget.Global);
      this.output.appendLine(t.saved);

      this.reset(view);
      await this.load(view);
      if (view.loadFailed) continue;
      return;
    }
  }

  /** @param view - The setup page's view that reports installation progress. */
  private async installRuntime(view: View): Promise<void> {
    // One installation at a time; a second request waits for the first.
    if (this.installation) { await this.installation.done; return; }
    if (!vscode.workspace.isTrusted) throw new Error(copy(vscode.env.language).workspace);

    const controller = new AbortController();
    const text = startupCopy(vscode.env.language);
    const done = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: text.installing, cancellable: true }, async (_progress, cancellation) => {
      const subscription = cancellation.onCancellationRequested(() => controller.abort());
      if (cancellation.isCancellationRequested) controller.abort();
      try {
        view.surface.webview.html = this.setupPage({ message: text.installing });

        // Install into extension storage: the workspace stays untouched.
        const node = await findNode();
        const installed = await installHarness(node.command, await findNpx(node.command), join(this.context.globalStorageUri.fsPath, 'dsh-runtime'), controller.signal,
          line => this.output.appendLine(redact(line)), vscode.workspace.getConfiguration('deepseekHarness').get('installTimeoutSeconds', 600) * 1000);
        controller.signal.throwIfAborted();

        // Save both paths so a later manual selection can still clear binPath.
        const settings = vscode.workspace.getConfiguration('deepseekHarness');
        await settings.update('binPath', installed.bin, vscode.ConfigurationTarget.Global);
        await settings.update('harnessPath', installed.root, vscode.ConfigurationTarget.Global);
        this.output.appendLine(`${text.saved} DSH ${installed.version}`);
        if (!view.disposed) { this.reset(view); await this.load(view); }
      } catch (error) {
        this.output.appendLine(redact(String(error)));
        if (!view.disposed) view.surface.webview.html = this.setupPage({ binError: 'installation', installError: controller.signal.aborted ? text.installCancelled : text.installFailed });
      } finally { subscription.dispose(); }
    });

    this.installation = { controller, done: Promise.resolve(done) };
    try { await done; } finally { this.installation = undefined; }
  }

  /** @param view - The Webview that sent the message. @param value - Untrusted Webview envelope. */
  private async receive(view: View, value: unknown): Promise<void> {
    if (view.disposed) return;

    // A message from a previous load generation belongs to no live Webview.
    const incoming = record(value);
    if (incoming.epoch !== undefined && incoming.epoch !== view.epoch) return;

    // Delivery acknowledgements never reach the relay.
    if (incoming.kind === 'delivery-ack') {
      if (typeof incoming.id === 'string') view.delivery?.acknowledge(incoming.id, typeof incoming.error === 'string' ? incoming.error : undefined);
      return;
    }
    // The relay owns backend traffic; anything it declines is a host message.
    if (view.relay && await view.relay.receive(value)) return;

    const message = record(value);
    switch (message.kind) {
      case 'setup-bin': await this.configureRuntime(view, false); break;
      case 'setup-directory': await this.configureRuntime(view, true); break;
      case 'setup-install': await this.installRuntime(view); break;
      case 'retry': this.reset(view); await this.load(view); break;
      case 'client-failure':
        if (view.detached && view.ready) this.output.appendLine(redact(String(message.error)));
        else this.failed(view, new Error(String(message.error)));
        break;
      case 'session-create-failed': await this.sessionCreateFailed(String(message.error), view.cwd); break;
      case 'client-diagnostic': this.output.appendLine(`client: ${redact(String(message.error))}`); break;
      case 'settings': this.openSettings(view.cwd); break;
      case 'open-settings-document': {
        if (typeof message.id !== 'string') throw new Error('Invalid settings document request');
        try {
          await this.openSettingsDocument(view.cwd);
          await view.surface.webview.postMessage({ kind: 'reply', id: message.id });
        } catch (error) { await view.surface.webview.postMessage({ kind: 'failure', id: message.id, error: redact(String(error)) }); }
        break;
      }
      case 'new-editor': this.openEditor(view.cwd); break;
      case 'close-settings': if (view.mode === 'settings') (view.surface as vscode.WebviewPanel).dispose(); break;
      case 'client-ready':
        // Readiness ends the initialization deadline for this load.
        clearTimeout(view.timer);
        view.timer = undefined;
        this.output.appendLine('view: client ready');
        view.ready = true;
        view.fresh = false;
        if (view.pendingNew) { view.pendingNew = false; await view.surface.webview.postMessage({ kind: 'new-session' }); }
        if (this.lastEditor) this.sendEditorContext(view, this.lastEditor);
        break;
      case 'session':
        if (typeof message.sessionId === 'string') view.sessionId = message.sessionId;

        // An editor tab shows its own session title; the sidebar remembers the
        // session for this workspace so a reload reopens it.
        if (view.editorTab) {
          view.title = message.blank !== false || typeof message.title !== 'string' ? undefined : message.title;
          this.applyTitle(view);
        } else if (view.mode === 'chat' && typeof message.sessionId === 'string') await this.context.workspaceState.update(`v2.session:${view.cwd}`, message.sessionId);
        break;
      case 'external': {
        // Only schemes the host browser may open are forwarded.
        if (typeof message.url !== 'string') break;
        const uri = vscode.Uri.parse(message.url);
        if (['https', 'http', 'mailto'].includes(uri.scheme)) await vscode.env.openExternal(uri);
        break;
      }
      case 'error': this.report(String(message.error)); break;
      case 'clipboard':
        if (typeof message.text !== 'string' || typeof message.id !== 'string') throw new Error('Invalid clipboard request');
        try { await vscode.env.clipboard.writeText(message.text); await view.surface.webview.postMessage({ kind: 'reply', id: message.id }); }
        catch (error) { await view.surface.webview.postMessage({ kind: 'failure', id: message.id, error: redact(String(error)) }); }
        break;
      case 'bridge-ready': this.output.appendLine('view: bridge ready'); break;
      case 'focus': break;
      default: throw new Error('Unknown Webview message');
    }
  }

  /** @param editor - The editor whose selection every chat view should show. */
  private editorContext(editor: vscode.TextEditor): void {
    for (const view of this.views) this.sendEditorContext(view, editor);
    for (const [epoch, cwd] of this.retainedPages) {
      if ([...this.views].some(view => view.epoch === epoch)) continue;
      const context = this.selectionContext(editor, cwd);
      if (context) this.nativeChannels.get(cwd)?.send(epoch, { kind: 'editor-context', context });
    }
  }

  /** @param view - The chat view receiving context. @param editor - The editor to describe. */
  private sendEditorContext(view: View, editor: vscode.TextEditor): void {
    // Only a ready chat view can show chips, and only files inside its workspace qualify.
    if (!view.ready || view.mode !== 'chat' || editor.document.uri.scheme !== 'file') return;
    const context = this.selectionContext(editor, view.cwd);
    if (context) void view.surface.webview.postMessage({ kind: 'editor-context', context });
  }

  /** @param editor - Current selection. @param cwd - Page workspace. @returns In-workspace context, without file contents. */
  private selectionContext(editor: vscode.TextEditor, cwd: string): EditorContext | undefined {
    if (editor.document.uri.scheme !== 'file') return undefined;
    const path = editor.document.uri.fsPath;
    const local = relative(cwd, path);
    if (!local || local.startsWith('..') || isAbsolute(local)) return;

    const selection = editor.selection;
    const context: EditorContext = { key: path, path, label: local, unsaved: editor.document.isDirty };
    if (!selection.isEmpty) {
      // VS Code selections are 0-based and end-exclusive; the backend contract is 1-based.
      context.startLine = selection.start.line + 1;
      context.endLine = selection.end.line + 1;
      context.startColumn = selection.start.character + 1;
      context.endColumn = selection.end.character + 1;
      context.label += `:${context.startLine}-${context.endLine}`;
    }
    return context;
  }

  /** A preset failure leaves the view usable; only an explicit action restarts the owned shared backend. */
  private async sessionCreateFailed(error: string, cwd: string): Promise<void> {
    // Only an owned backend can be restarted, and only for a resolvable preset failure.
    if (!error.includes('agent-preset/invalid') || !error.includes('cannot be resolved') || this.attachedUrl) { this.report(error); return; }
    if (this.recovering) return;
    this.recovering = true;

    const launch = this.launches.get(cwd);
    try {
      const text = copy(vscode.env.language);
      this.output.appendLine(redact(error));
      const action = await vscode.window.showWarningMessage(`${redact(error)}\n${text.restartWarning}`, text.restartBackend);

      // The launcher may have changed while the warning was open; restart only that one.
      if (action !== text.restartBackend || this.launches.get(cwd) !== launch || this.attachedUrl || !this.views.size) return;
      await this.stopBackends(cwd);
      await Promise.all([...this.views].filter(view => !view.disposed && view.cwd === cwd).map(view => this.load(view)));
    } finally { this.recovering = false; }
  }

  /** @param error - The failure to log and show. */
  private report(error: unknown): void {
    const message = redact(String(error));
    this.output.appendLine(message);
    void vscode.window.showErrorMessage(message);
  }

  /** @param cwd - Workspace to stop, or omitted for all extension-owned backends on this host. */
  private async stopBackends(cwd?: string): Promise<void> {
    if (this.stopping) await this.stopping;
    const targets = [...this.views].filter(view => cwd === undefined || view.cwd === cwd);
    const stop = (async () => {
      for (const view of targets) {
        view.reconnectPending = false;
        view.reconnectAvailable = false;
        await this.reset(view);
        if (!view.disposed) view.surface.webview.html = this.status(copy(vscode.env.language).stopped, true);
      }
      // Wait for already requested starts so stop cannot leave an unseen child behind.
      const launches = [...this.launches].filter(([key]) => cwd === undefined || key === cwd);
      await Promise.allSettled(launches.map(([, launch]) => launch));
      for (const [key] of launches) this.launches.delete(key);
      this.assets.clear();
      await this.backends.stop(cwd);
    })();
    this.stopping = stop;
    try { await stop; } finally { if (this.stopping === stop) this.stopping = undefined; }
  }

  /** Disconnect this extension host; every owned backend remains available. */
  async shutdown(): Promise<void> {
    if (this.installation) { this.installation.controller.abort(); await this.installation.done; }
    for (const view of this.views) {
      view.reconnectPending = false;
      view.reconnectAvailable = false;
      await this.reset(view);
    }
    for (const channel of this.nativeChannels.values()) channel.dispose();
    this.nativeChannels.clear();
    this.retainedPages.clear();
    this.launches.clear();
    this.attachedUrl = undefined;
    this.assets.clear();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    void this.shutdown();
  }
}
