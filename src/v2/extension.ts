/** Native VS Code surfaces hosting the unmodified official Web application. */
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { join, relative, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { SharedBackend } from '../shared-backend.ts';
import { Transport } from '../transport.ts';
import { expandHome, findCli, findNode } from '../runtime.ts';
import { startupCopy, startupHtml, type StartupState } from './startup.ts';
import { record, redact } from '../protocol.ts';
import { WebRelay } from './relay.ts';
import { webviewHtml } from './html.ts';
import { copy } from './locale.ts';
import { sessionLabel, tabLabel, type EditorContext } from './messages.ts';
import { ClientAssets } from './assets.ts';
import { MessageDelivery } from './delivery.ts';

type Surface = vscode.WebviewView | vscode.WebviewPanel;
interface View { surface: Surface; epoch?: string; relay?: WebRelay; connection?: Transport; delivery?: MessageDelivery; timer?: ReturnType<typeof setTimeout>; loading?: Promise<void>; pendingNew?: boolean; disposed: boolean; cwd: string; mode: 'chat' | 'settings'; ready: boolean; fresh: boolean; generation: number; editorTab?: boolean; sessionId?: string; title?: string }
let app: Application | undefined;

/** @param context - VS Code extension lifetime and storage. */
export function activate(context: vscode.ExtensionContext): void {
  app = new Application(context);
  context.subscriptions.push(app);
}
/** @returns Completion after view connections close; the shared backend keeps running. */
export async function deactivate(): Promise<void> { await app?.shutdown(); app = undefined; }

class Application implements vscode.Disposable {
  private backend?: SharedBackend;
  private launch?: Promise<string>;
  private sidebar?: View;
  private settings?: View;
  private readonly views = new Set<View>();
  private readonly output = vscode.window.createOutputChannel('DeepSeek Harness');
  private readonly subscriptions: vscode.Disposable[] = [];
  private lastEditor = vscode.window.activeTextEditor;
  private pendingFresh = false;
  private stopping?: Promise<void>;
  private assets?: ClientAssets;
  private settingsDocument?: string;
  private attachedUrl?: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.subscriptions.push(this.output,
      vscode.window.registerWebviewViewProvider('deepseekHarness.chat', { resolveWebviewView: view => {
        this.sidebar = this.attach(view, 'chat', this.pendingFresh); this.pendingFresh = false;
      } }, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.commands.registerCommand('deepseekHarness.open', () => this.open(false)),
      vscode.commands.registerCommand('deepseekHarness.newSession', () => this.open(true)),
      vscode.commands.registerCommand('deepseekHarness.newEditorSession', () => { try { this.output.appendLine('command: new editor'); this.openEditor(); } catch (error) { this.report(error); } }),
      vscode.commands.registerCommand('deepseekHarness.reloadView', () => {
        const view = [...this.views].find(view => 'active' in view.surface && view.surface.active) ?? this.sidebar ?? [...this.views].at(-1);
        if (view) { this.reset(view); void this.load(view); }
      }),
      vscode.commands.registerCommand('deepseekHarness.settings', () => this.openSettings()),
      vscode.commands.registerCommand('deepseekHarness.stop', () => this.shutdown(true)),
      vscode.commands.registerCommand('deepseekHarness.connect', async () => {
        const value = await vscode.window.showInputBox({ prompt: copy(vscode.env.language).connectPrompt, password: true, ignoreFocusOut: true });
        if (!value) return;
        await this.shutdown(); this.attachedUrl = value; this.launch = Promise.resolve(value);
        for (const view of this.views) void this.load(view);
        await this.open(false);
      }),
      vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) { this.lastEditor = editor; this.editorContext(editor); } }),
      vscode.window.onDidChangeTextEditorSelection(event => { this.lastEditor = event.textEditor; this.editorContext(event.textEditor); }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => { if (this.sidebar) void this.load(this.sidebar); }),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('workbench.editor.tabSizing')) for (const view of this.views) this.applyTitle(view); }),
    );
  }

  private workspace(): vscode.WorkspaceFolder {
    if (!vscode.workspace.isTrusted) throw new Error(copy(vscode.env.language).workspace);
    const active = this.lastEditor ? vscode.workspace.getWorkspaceFolder(this.lastEditor.document.uri) : undefined;
    const folder = active ?? vscode.workspace.workspaceFolders?.[0];
    if (!folder || folder.uri.scheme !== 'file') throw new Error(copy(vscode.env.language).workspace);
    return folder;
  }

  private async open(fresh: boolean): Promise<void> {
    this.pendingFresh = fresh;
    await vscode.commands.executeCommand('deepseekHarness.chat.focus');
    if (this.sidebar) {
      (this.sidebar.surface as vscode.WebviewView).show(false);
      const cwd = this.workspace().uri.fsPath;
      if (this.sidebar.loading) { if (fresh) this.sidebar.pendingNew = true; await this.sidebar.loading; }
      else if (this.sidebar.cwd !== cwd || !this.sidebar.relay) { this.sidebar.fresh ||= fresh; await this.load(this.sidebar); }
      else if (fresh && this.sidebar.ready) await this.sidebar.surface.webview.postMessage({ kind: 'new-session' });
      else if (fresh) this.sidebar.pendingNew = true;
      this.pendingFresh = false;
    }
  }

  private openSettings(): void {
    if (this.settings) { (this.settings.surface as vscode.WebviewPanel).reveal(); if (!this.settings.relay) void this.load(this.settings); return; }
    const panel = vscode.window.createWebviewPanel('deepseekHarness.settings', copy(vscode.env.language).settings, vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    this.settings = this.attach(panel, 'settings', false);
  }

  private openEditor(cwd = this.workspace().uri.fsPath): void {
    const panel = vscode.window.createWebviewPanel('deepseekHarness.editor', 'DeepSeek Harness', vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = { light: vscode.Uri.file(join(this.context.extensionPath, 'media/whale-light.svg')), dark: vscode.Uri.file(join(this.context.extensionPath, 'media/whale-dark.svg')) };
    this.attach(panel, 'chat', true, cwd);
  }

  /**
   * Name one editor view's tab after the view's session.
   *
   * `fit` sizing grows a tab with its label, so that mode alone needs the label
   * bounded; `fixed` and `shrink` ellipsize the label themselves and keep the
   * whole title as the tab's hover text.
   * @param view - The attached view whose panel follows the session title.
   */
  private applyTitle(view: View): void {
    if (!view.editorTab) return;
    const title = view.title;
    const sizing = title === undefined ? 'fit' : vscode.workspace.getConfiguration('workbench.editor').get<string>('tabSizing', 'fit');
    (view.surface as vscode.WebviewPanel).title = title === undefined ? 'DeepSeek Harness' : sizing === 'fit' ? tabLabel(title) : sessionLabel(title);
  }

  private attach(surface: Surface, mode: View['mode'], fresh: boolean, editorCwd?: string): View {
    const view: View = { surface, mode, fresh, disposed: false, cwd: editorCwd ?? '', ready: false, generation: 0, editorTab: editorCwd !== undefined };
    this.views.add(view);
    const listener = surface.webview.onDidReceiveMessage((value: unknown) => {
      void this.receive(view, value).catch(error => this.report(error));
    });
    surface.onDidDispose(() => {
      view.disposed = true; this.reset(view); listener.dispose(); this.views.delete(view);
      if (this.sidebar === view) this.sidebar = undefined;
      if (this.settings === view) this.settings = undefined;
      void view.relay?.dispose().catch(error => this.report(error));
    });
    void this.load(view);
    return view;
  }

  private async backendUrl(cwd: string): Promise<string> {
    if (this.stopping) await this.stopping;
    if (this.attachedUrl) return this.attachedUrl;
    if (!this.launch) {
      const settings = vscode.workspace.getConfiguration('deepseekHarness');
      this.backend = new SharedBackend(join(homedir(), '.dsh-vscode'), join(this.context.extensionPath, 'dist/v2-supervisor.cjs'), line => this.output.appendLine(line));
      const home = settings.get<string>('home', '') || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
      const expanded = expandHome(home);
      this.settingsDocument = join(resolve(cwd, expanded), 'settings.yaml');
      this.launch = this.backend.start({ cwd, harnessPath: settings.get('harnessPath', ''), binPath: settings.get('binPath', ''), home: resolve(cwd, expanded),
        startupTimeoutSeconds: settings.get('startupTimeoutSeconds', 90) });
      this.launch.catch(() => { this.launch = undefined; });
    }
    return this.launch;
  }

  private load(view: View): Promise<void> {
    if (view.loading) return view.loading;
    const task = this.loadView(view).catch(error => this.report(error)); view.loading = task;
    void task.finally(() => { if (view.loading === task) view.loading = undefined; });
    return task;
  }

  private async loadView(view: View): Promise<void> {
    const generation = ++view.generation;
    const epoch = view.epoch = randomBytes(18).toString('base64');
    const active = (): boolean => !view.disposed && generation === view.generation;
    view.ready = false;
    const old = view.relay; view.relay = undefined;
    await old?.dispose();
    if (!active()) return;
    const text = copy(vscode.env.language);
    const timeout = vscode.workspace.getConfiguration('deepseekHarness').get('webviewTimeoutSeconds', 60) * 1000;
    const phase = (name: string): void => this.output.appendLine(`view ${generation}: ${name}`);
    phase('loading');
    view.surface.webview.options = { enableScripts: true };
    view.surface.webview.html = this.status(text.loading);
    let transport: Transport | undefined;
    try {
      const cwd = view.editorTab ? view.cwd : this.workspace().uri.fsPath; view.cwd = cwd;
      if (!this.attachedUrl && !this.launch) {
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
      transport = new Transport(error => {
        if (!active()) return;
        this.launch = undefined; this.assets = undefined;
        view.ready = false; view.relay = undefined;
        this.output.appendLine(redact(error.message));
        view.surface.webview.html = this.status(`${text.failed}: ${redact(error.message)}`, true);
      });
      view.connection = transport;
      await transport.connect(url);
      if (!active()) { await transport.dispose(); return; }
      const maxBytes = vscode.workspace.getConfiguration('deepseekHarness').get('maxTransferMegabytes', 64) * 1024 * 1024;
      const assets = this.assets ??= new ClientAssets(maxBytes);
      const delivery = new MessageDelivery(value => view.surface.webview.postMessage(value), error => { if (active()) this.failed(view, error); }, maxBytes * 4, timeout);
      view.delivery = delivery;
      const relay = new WebRelay(transport, value => { if (active()) delivery.send(value); }, maxBytes,
        (path, signal) => assets.fetch(path, resource => transport!.request(resource, { signal })));
      view.relay = relay;
      view.timer = setTimeout(() => { if (active()) this.failed(view, new Error(text.loadTimeout)); }, timeout);
      const cache = join(this.context.globalStorageUri.fsPath, 'web-assets');
      const webview = view.surface.webview;
      webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri, vscode.Uri.file(cache)] };
      const uri = (path: string): string => webview.asWebviewUri(vscode.Uri.file(path)).toString();
      const response = await transport.request('/');
      if (!response.ok) throw new Error(`Official Web bootstrap HTTP ${response.status}`);
      const html = await webviewHtml(await response.text(), {
        fetch: path => assets.fetch(path, resource => transport!.request(resource)), cacheRoot: cache, uri,
        inlineStatic: vscode.workspace.getConfiguration('deepseekHarness').get('inlineStaticResources', false),
        bridgeUri: uri(join(this.context.extensionPath, 'dist/v2-bridge.js')),
        adapterUri: uri(join(this.context.extensionPath, 'dist/v2-adapter.js')),
        styleUri: uri(join(this.context.extensionPath, 'webview/v2.css')), cspSource: webview.cspSource,
      }, { cwd, mode: view.mode, language: vscode.env.language, fresh: view.fresh, editorTab: view.editorTab,
        sessionId: view.editorTab ? view.sessionId : this.context.workspaceState.get<string>(`v2.session:${cwd}`), nonce: epoch, maxTransferBytes: maxBytes, requestTimeoutMs: timeout });
      if (active()) { phase(`HTML published (${Buffer.byteLength(html)} bytes)`); webview.html = html; } else await relay.dispose();
    } catch (error) {
      await transport?.dispose();
      if (active()) { view.relay = undefined; view.surface.webview.html = this.status(`${text.failed}: ${redact(String(error))}`, true); }
      this.output.appendLine(redact(String(error)));
    }
  }

  private reset(view: View): void {
    view.generation++; clearTimeout(view.timer); view.timer = undefined; view.ready = false; view.loading = undefined;
    view.delivery?.dispose(); view.delivery = undefined;
    const relay = view.relay; const connection = view.connection; view.relay = undefined; view.connection = undefined;
    void (relay ? relay.dispose() : connection?.dispose())?.catch(error => this.output.appendLine(redact(String(error))));
  }

  private failed(view: View, error: Error): void {
    this.reset(view); this.output.appendLine(redact(error.message));
    if (!view.disposed) view.surface.webview.html = this.status(`${copy(vscode.env.language).failed}: ${redact(error.message)}`, true);
  }

  private status(message: string, retry = false): string {
    return this.setupPage({ message: message === copy(vscode.env.language).loading ? startupCopy(vscode.env.language).loading : message, retry });
  }

  private setupPage(state: StartupState): string {
    return startupHtml(vscode.env.language, randomBytes(18).toString('base64'), readFileSync(join(this.context.extensionPath, 'media/whale.svg'), 'utf8'), state);
  }

  private async configureRuntime(view: View, directory: boolean): Promise<void> {
    const t = startupCopy(vscode.env.language);
    const settings = vscode.workspace.getConfiguration('deepseekHarness');
    const validate = (input: string): string | undefined => {
      try { findCli(directory ? input : '', view.cwd, directory ? '' : input); return input.trim() ? undefined : t.invalid; }
      catch { return t.invalid; }
    };
    const value = await vscode.window.showInputBox({ prompt: directory ? t.directoryPrompt : t.binPrompt, ignoreFocusOut: true, validateInput: validate });
    if (value === undefined || view.disposed) return;
    const error = validate(value); if (error) throw new Error(error);
    if (directory) {
      // Store the resolved entry first so an interrupted settings write still selects this runtime.
      await settings.update('binPath', findCli(value.trim(), view.cwd), vscode.ConfigurationTarget.Global);
      await settings.update('harnessPath', expandHome(value.trim()), vscode.ConfigurationTarget.Global);
      await settings.update('binPath', undefined, vscode.ConfigurationTarget.Global);
    } else await settings.update('binPath', expandHome(value.trim()), vscode.ConfigurationTarget.Global);
    this.output.appendLine(t.saved);
    this.reset(view); await this.load(view);
  }

  private async receive(view: View, value: unknown): Promise<void> {
    if (view.disposed) return;
    const incoming = record(value);
    if (incoming.epoch !== undefined && incoming.epoch !== view.epoch) return;
    if (incoming.kind === 'delivery-ack') { if (typeof incoming.id === 'string') view.delivery?.acknowledge(incoming.id, typeof incoming.error === 'string' ? incoming.error : undefined); return; }
    if (view.relay && await view.relay.receive(value)) return;
    const message = record(value);
    switch (message.kind) {
      case 'setup-bin': await this.configureRuntime(view, false); break;
      case 'setup-directory': await this.configureRuntime(view, true); break;
      case 'retry': this.reset(view); await this.load(view); break;
      case 'client-failure': this.failed(view, new Error(String(message.error))); break;
      case 'client-diagnostic': this.output.appendLine(`client: ${redact(String(message.error))}`); break;
      case 'settings': this.openSettings(); break;
      case 'open-settings-document': {
        if (typeof message.id !== 'string') throw new Error('Invalid settings document request');
        try {
          const configured = vscode.workspace.getConfiguration('deepseekHarness').get<string>('settingsPath', '');
          let path = configured || this.settingsDocument;
          if (!path) {
            const selected = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, filters: { 'YAML / JSON': ['yaml', 'yml', 'json'] } });
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
          await view.surface.webview.postMessage({ kind: 'reply', id: message.id });
        } catch (error) { await view.surface.webview.postMessage({ kind: 'failure', id: message.id, error: redact(String(error)) }); }
        break;
      }
      case 'new-editor': this.openEditor(view.cwd); break;
      case 'close-settings': if (view.mode === 'settings') (view.surface as vscode.WebviewPanel).dispose(); break;
      case 'client-ready':
        clearTimeout(view.timer); view.timer = undefined; this.output.appendLine('view: client ready');
        view.ready = true; view.fresh = false;
        if (view.pendingNew) { view.pendingNew = false; await view.surface.webview.postMessage({ kind: 'new-session' }); }
        if (this.lastEditor) this.sendEditorContext(view, this.lastEditor); break;
      case 'session':
        if (view.editorTab) {
          if (typeof message.sessionId === 'string') view.sessionId = message.sessionId;
          view.title = message.blank !== false || typeof message.title !== 'string' ? undefined : message.title;
          this.applyTitle(view);
        } else if (view.mode === 'chat' && typeof message.sessionId === 'string') await this.context.workspaceState.update(`v2.session:${view.cwd}`, message.sessionId);
        break;
      case 'external': {
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

  private editorContext(editor: vscode.TextEditor): void {
    for (const view of this.views) this.sendEditorContext(view, editor);
  }

  private sendEditorContext(view: View, editor: vscode.TextEditor): void {
    if (!view.ready || view.mode !== 'chat' || editor.document.uri.scheme !== 'file') return;
    const path = editor.document.uri.fsPath;
    const local = relative(view.cwd, path);
    if (!local || local.startsWith('..') || isAbsolute(local)) return;
    const selection = editor.selection;
    const context: EditorContext = { key: path, path, label: local };
    if (!selection.isEmpty) {
      context.startLine = selection.start.line + 1; context.endLine = selection.end.line + 1;
      context.text = editor.document.getText(selection); context.label += `:${context.startLine}-${context.endLine}`;
    }
    void view.surface.webview.postMessage({ kind: 'editor-context', context });
  }

  private report(error: unknown): void { const message = redact(String(error)); this.output.appendLine(message); void vscode.window.showErrorMessage(message); }

  async shutdown(stopBackend = false): Promise<void> {
    if (this.stopping) return this.stopping;
    const backend = this.backend ?? (stopBackend && !this.attachedUrl ? new SharedBackend(join(homedir(), '.dsh-vscode'), join(this.context.extensionPath, 'dist/v2-supervisor.cjs'), line => this.output.appendLine(line)) : undefined);
    this.backend = undefined; this.launch = undefined; this.attachedUrl = undefined;
    this.assets = undefined;
    this.settingsDocument = undefined;
    this.stopping = (async () => {
      await Promise.all([...this.views].map(async view => {
        clearTimeout(view.timer); view.delivery?.dispose();
        view.generation++; view.ready = false; const relay = view.relay; view.relay = undefined;
        await relay?.dispose();
        if (!view.disposed) view.surface.webview.html = this.status(copy(vscode.env.language).stopped, true);
      }));
      if (stopBackend) await backend?.dispose();
    })();
    try { await this.stopping; } finally { this.stopping = undefined; }
  }

  dispose(): void { for (const subscription of this.subscriptions) subscription.dispose(); void this.shutdown(); }
}
