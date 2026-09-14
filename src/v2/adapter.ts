/** Cordis client extension for the official Web UI, registered before its module entry runs. */
import type { ViewConfig } from './html.ts';
import type { EditorContext } from './messages.ts';
import { copy } from './locale.ts';
import { deleteSession, type DeletableSession } from './delete-session.ts';

interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface Summary { id: string; displayTitle: string; blank: boolean; running: boolean }
interface SessionState { phase: string; current?: string; ids: string[]; byId: Record<string, Summary> }
interface Workspace { workspaceId: string; path: string; sessionIds: string[] }
interface WorkspaceState { phase: string; items: Workspace[]; archivedSessionIds: string[] }
interface Context {
  effect(start: () => (() => void), label?: string): void;
  sessions: { list: Observable<SessionState>; create(input: { workspaceId: string }): Promise<string>; binding(id: string): { session: DeletableSession } | undefined };
  workspaces: { list: Observable<WorkspaceState>; create(input: { path: string }): Promise<Workspace> };
  uiWorkspace: { openSession(id: string): void; openWorkspace(id: string): Promise<void>; startSession(id: string): void; archiveSession(id: string): Promise<void> };
  locale: Observable<{ active: string }>;
}
interface Globals {
  __VSCODE_DSH_CONFIG__: ViewConfig;
  __VSCODE_DSH__: { post(value: unknown): void; contexts(): readonly EditorContext[]; submitted(contexts: readonly EditorContext[]): void; handle?(value: { kind: string; context?: EditorContext }): void };
  __DSH_BOOT__: { entries: { id: string; [key: string]: unknown }[]; batches: { entries: string[]; [key: string]: unknown }[] };
  __ModuleLoader__: { load(entry: { id: string; factory: (require: (name: string) => unknown) => unknown }): void };
}
const global = globalThis as unknown as Globals;
const config = global.__VSCODE_DSH_CONFIG__;
const bridge = global.__VSCODE_DSH__;
const id = '@deepseek-ai/dsh-vscode-client';
// VSIX clients reload with the view; the development-only EventSource belongs to the browser server.
const hmr = '@deepseek-ai/dsh-client-hmr';
global.__DSH_BOOT__.entries = global.__DSH_BOOT__.entries.filter(entry => entry.id !== hmr);
global.__DSH_BOOT__.batches = global.__DSH_BOOT__.batches.map(batch => ({ ...batch, entries: batch.entries.filter(entry => entry !== hmr) })).filter(batch => batch.entries.length);
global.__DSH_BOOT__.entries.push({ id, url: '/vscode/client.js', rev: '0.1.4', inject: [], external: ['react', 'react-dom/client', '@deepseek-ai/dsh-client-ui-primitives'] });
global.__DSH_BOOT__.batches.push({ phase: 'application', url: '/vscode/client.js', rev: '0.1.4', entries: [id] });
global.__ModuleLoader__.load({ id, factory: require => {
  const react = require('react') as { createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown };
  const dom = require('react-dom/client') as { createRoot(element: Element): { render(node: unknown): void; unmount(): void } };
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives') as Record<string, unknown>;
  return { inject: ['sessions', 'workspaces', 'uiWorkspace', 'locale'], apply(ctx: Context): void {
    ctx.effect(() => {
      let text = copy(ctx.locale.getSnapshot().active);
      const lifetime = new AbortController();
      const header = document.createElement('header'); header.id = 'vscode-header';
      const title = document.createElement('span'); title.id = 'vscode-title';
      const actions = document.createElement('div'); actions.id = 'vscode-actions';
      header.append(title, actions); document.body.append(header);
      document.body.dataset.dshVscode = config.mode;
      const menu = document.createElement('div'); menu.id = 'vscode-history'; menu.hidden = true; menu.setAttribute('role', 'menu'); header.append(menu);
      const contextMenu = document.createElement('div'); contextMenu.id = 'vscode-history-context'; contextMenu.hidden = true; contextMenu.setAttribute('role', 'menu'); header.append(contextMenu);
      const chips = document.createElement('div'); chips.id = 'vscode-contexts';
      const roots: ReturnType<typeof dom.createRoot>[] = [];
      const renderButtons: (() => void)[] = [];
      let workspace: Workspace | undefined;
      let current: string | undefined;
      let announced = '';
      let initialized = false;
      let settingsOpened = false;
      let settingsSeen = false;
      const contexts = new Map<string, Map<string, EditorContext>>();
      const currentChips = (): Map<string, EditorContext> => {
        const key = current ?? ''; let value = contexts.get(key);
        if (!value) { value = new Map(); contexts.set(key, value); }
        return value;
      };
      const renderChips = (): void => {
        const owned = currentChips();
        bridge.submitted = sent => {
          for (const value of sent) if (JSON.stringify(owned.get(value.key)) === JSON.stringify(value)) owned.delete(value.key);
          renderChips();
        };
        chips.replaceChildren();
        for (const context of currentChips().values()) {
          const chip = document.createElement('span'); chip.className = 'vscode-context'; chip.title = context.path;
          const label = document.createElement('span'); label.textContent = context.label;
          const remove = document.createElement('button'); remove.textContent = '×'; remove.title = text.remove; remove.setAttribute('aria-label', `${text.remove}: ${context.label}`);
          remove.onclick = () => { currentChips().delete(context.key); renderChips(); };
          chip.append(label, remove); chips.append(chip);
        }
      };
      bridge.contexts = () => [...currentChips().values()];
      let creating = false;
      const fresh = (): void => {
        menu.hidden = true;
        if (!workspace || creating || (current && ctx.sessions.list.getSnapshot().byId[current]?.blank)) return;
        creating = true;
        void ctx.sessions.create({ workspaceId: workspace.workspaceId }).then(sessionId => {
          if (!lifetime.signal.aborted) ctx.uiWorkspace.openSession(sessionId);
        }).catch(error => bridge.post({ kind: 'error', error: String(error) })).finally(() => { creating = false; });
      };
      const button = (key: 'history' | 'fresh' | 'settings', icon: string, action: () => void): void => {
        const seat = document.createElement('span'); actions.append(seat);
        const root = dom.createRoot(seat); roots.push(root);
        const render = (): void => root.render(react.createElement(primitives.Tooltip, { label: text[key], side: 'bottom' },
          react.createElement('button', { type: 'button', 'aria-label': text[key], onClick: action }, react.createElement(localIcons[icon] ?? primitives[icon], { size: 16 }))));
        renderButtons.push(render); render();
      };
      // The official new-chat outline spans 15.3526 units inside its 16-unit viewport.
      const historyIcon = () => react.createElement('svg', { width: 16, height: 16, viewBox: '1.57831 1.57831 20.84338 20.84338', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        ...['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5', 'M12 7v5l4 2'].map(d => react.createElement('path', { d, key: d })));
      // Local copies of the two icons the official sidebar also renders. Its own copies
      // carry one hard-coded <clipPath id> each, and a duplicate id resolves to the copy
      // inside the hidden sidebar, which blanks this bar's glyph at wide frame widths.
      const gearPaths = [
        'M14.0861 5.51366C13.8717 5.0575 13.588 4.58542 13.2889 4.18108C13.208 4.07172 13.1596 4.04373 13.0243 4.03054C12.4277 3.97255 11.8245 4.05527 11.2269 3.9972C10.7224 3.94816 10.3133 3.71661 10.0115 3.30919C9.66986 2.84777 9.43973 2.31343 9.09824 1.85234C9.01771 1.74365 8.96805 1.71589 8.83354 1.70282C8.29432 1.65044 7.70402 1.65061 7.16656 1.70282C7.03205 1.71589 6.98239 1.74365 6.90186 1.85234C6.56067 2.31303 6.33025 2.84774 5.98855 3.30919C5.68681 3.71661 5.27774 3.94816 4.77317 3.9972C4.17564 4.05527 3.57239 3.97255 2.97585 4.03054C2.84046 4.04373 2.79208 4.07172 2.71115 4.18108C2.41212 4.58542 2.12835 5.0575 1.91403 5.51366C1.85299 5.64359 1.85286 5.7018 1.91403 5.8319C2.14865 6.33077 2.49748 6.76892 2.73237 7.26854C2.9594 7.7515 2.96041 8.24717 2.73338 8.73044C2.49837 9.23061 2.14891 9.66837 1.91403 10.1681C1.85291 10.2982 1.85299 10.3564 1.91403 10.4863C2.12856 10.9429 2.41185 11.4142 2.71115 11.8189C2.79208 11.9283 2.84046 11.9563 2.97585 11.9694C3.57239 12.0274 4.17564 11.9447 4.77317 12.0028C5.27774 12.0518 5.68681 12.2834 5.98855 12.6908C6.33024 13.1522 6.56037 13.6866 6.90186 14.1476C6.98239 14.2563 7.03205 14.2841 7.16656 14.2972C7.70402 14.3494 8.29432 14.3495 8.83354 14.2972C8.96805 14.2841 9.01771 14.2563 9.09824 14.1476C9.43944 13.687 9.66985 13.1522 10.0115 12.6908C10.3133 12.2834 10.7224 12.0518 11.2269 12.0028C11.8244 11.9447 12.4271 12.0275 13.0243 11.9694C13.1596 11.9563 13.208 11.9283 13.2889 11.8189C13.5891 11.4131 13.872 10.942 14.0861 10.4863C14.1471 10.3564 14.1472 10.2982 14.0861 10.1681C13.8513 9.66861 13.5017 9.23061 13.2667 8.73044C13.0397 8.24717 13.0407 7.7515 13.2677 7.26854C13.5026 6.7689 13.8513 6.33106 14.0861 5.8319C14.1472 5.7018 14.1471 5.64359 14.0861 5.51366ZM15.3035 6.40373C15.0685 6.90359 14.7188 7.34119 14.4841 7.84037C14.4231 7.97025 14.423 8.02855 14.4841 8.15861C14.7189 8.65833 15.0685 9.09611 15.3035 9.59626C15.5308 10.0801 15.5308 10.5744 15.3035 11.0582C15.052 11.5933 14.7225 12.1426 14.37 12.6191C14.0685 13.0265 13.6581 13.259 13.1536 13.3081C12.5566 13.366 11.9541 13.2835 11.3573 13.3414C11.2228 13.3545 11.1731 13.3823 11.0926 13.491C10.7511 13.9521 10.521 14.4864 10.1793 14.9478C9.87828 15.3542 9.46719 15.5869 8.96387 15.6358C8.34008 15.6964 7.66194 15.6966 7.03623 15.6358C6.53291 15.5869 6.12182 15.3542 5.82084 14.9478C5.47911 14.4863 5.24878 13.9517 4.90753 13.491C4.82701 13.3823 4.77734 13.3545 4.64284 13.3414C4.04647 13.2835 3.44373 13.366 2.84653 13.3081C2.34201 13.259 1.93164 13.0265 1.63013 12.6191C1.27867 12.144 0.948453 11.5941 0.696621 11.0582C0.469315 10.5744 0.469279 10.0801 0.696621 9.59626C0.931628 9.09613 1.2813 8.65807 1.51597 8.15861C1.57708 8.02855 1.57702 7.97025 1.51597 7.84037C1.28117 7.34095 0.931635 6.9036 0.696621 6.40373C0.469213 5.91992 0.469367 5.42562 0.696621 4.94183C0.948441 4.40587 1.27868 3.85598 1.63013 3.38092C1.93164 2.97349 2.34201 2.74095 2.84653 2.6919C3.44353 2.63397 4.04599 2.71649 4.64284 2.65856C4.77734 2.64549 4.82701 2.61774 4.90753 2.50904C5.24905 2.04792 5.47913 1.51362 5.82084 1.05219C6.12182 0.645806 6.53291 0.413119 7.03623 0.364178C7.66002 0.303556 8.33816 0.303369 8.96387 0.364178C9.46719 0.413119 9.87828 0.645806 10.1793 1.05219C10.521 1.51365 10.7513 2.04828 11.0926 2.50904C11.1731 2.61774 11.2228 2.64549 11.3573 2.65856C11.9541 2.71649 12.5566 2.63397 13.1536 2.6919C13.6581 2.74095 14.0685 2.97349 14.37 3.38092C14.7214 3.85598 15.0517 4.40587 15.3035 4.94183C15.5307 5.42562 15.5309 5.91992 15.3035 6.40373Z',
        'M9.13764 7.99999C9.13764 7.3715 8.62855 6.8624 8.00005 6.8624C7.37155 6.8624 6.86246 7.3715 6.86246 7.99999C6.86246 8.62849 7.37155 9.13759 8.00005 9.13759C8.62855 9.13759 9.13764 8.62849 9.13764 7.99999ZM10.4834 7.99999C10.4834 9.37126 9.37132 10.4833 8.00005 10.4833C6.62878 10.4833 5.51674 9.37126 5.51674 7.99999C5.51674 6.62873 6.62878 5.51669 8.00005 5.51669C9.37132 5.51669 10.4834 6.62873 10.4834 7.99999Z',
      ];
      const settingsIcon = () => react.createElement('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        ...gearPaths.map(d => react.createElement('path', { d, fill: 'currentColor', key: d.slice(0, 12) })));
      const localIcons: Record<string, unknown> = { VscodeHistory: historyIcon, VscodeSettings: settingsIcon };
      button('history', 'VscodeHistory', () => { menu.hidden = !menu.hidden; });
      button('fresh', 'IconNewChatOutline16', config.editorTab ? () => bridge.post({ kind: 'new-editor' }) : fresh);
      button('settings', 'VscodeSettings', () => bridge.post({ kind: 'settings' }));
      const update = (): void => {
        const state = ctx.sessions.list.getSnapshot();
        const changed = current !== state.current; current = state.current;
        const summary = current ? state.byId[current] : undefined;
        title.textContent = summary && !summary.blank ? summary.displayTitle : text.fresh;
        title.title = title.textContent;
        if (changed) renderChips();
        const announcement = { kind: 'session', sessionId: current, title: title.textContent, blank: summary?.blank ?? true };
        const serialized = JSON.stringify(announcement);
        if ((!config.editorTab || document.body.dataset.vscodeReady === 'true') && serialized !== announced) { announced = serialized; bridge.post(announcement); }
        const workspaces = ctx.workspaces.list.getSnapshot();
        workspace = workspaces.items.find(item => item.workspaceId === workspace?.workspaceId) ?? workspace;
        menu.replaceChildren();
        const ids = workspace?.sessionIds ?? [];
        for (const sessionId of ids) {
          const row = state.byId[sessionId];
          if (!row || workspaces.archivedSessionIds.includes(sessionId) || (row.blank && sessionId !== current)) continue;
          const item = document.createElement('button'); item.setAttribute('role', 'menuitem');
          item.textContent = (row.running ? '● ' : '') + (row.blank ? text.fresh : row.displayTitle); item.title = item.textContent;
          item.setAttribute('aria-current', String(sessionId === current));
          item.onclick = () => { ctx.uiWorkspace.openSession(sessionId); menu.hidden = true; }; menu.append(item);
          item.oncontextmenu = event => {
            event.preventDefault(); contextMenu.replaceChildren();
            const remove = document.createElement('button'); remove.textContent = text.deleteSession; remove.title = text.deleteDetail; remove.setAttribute('role', 'menuitem');
            remove.onclick = () => {
              remove.disabled = true;
              const binding = ctx.sessions.binding(sessionId);
              if (!binding) { remove.disabled = false; bridge.post({ kind: 'error', error: text.sessionUnavailable }); return; }
              void deleteSession(binding.session, () => ctx.uiWorkspace.archiveSession(sessionId)).then(() => { contextMenu.hidden = true; update(); }, error => { remove.disabled = false; bridge.post({ kind: 'error', error: String(error) }); });
            };
            contextMenu.append(remove); contextMenu.hidden = false;
            contextMenu.style.left = `${Math.max(8, Math.min(event.clientX, innerWidth - 200))}px`;
            contextMenu.style.top = `${Math.max(8, Math.min(event.clientY, innerHeight - 55))}px`; remove.focus();
          };
        }
        if (!menu.childElementCount) { const empty = document.createElement('p'); empty.textContent = text.empty; menu.append(empty); }
        if (!initialized && state.phase === 'ready' && workspaces.phase === 'ready') {
          initialized = true;
          void (async () => {
            if (config.mode === 'settings') return;
            const target = await ctx.workspaces.create({ path: config.cwd });
            if (lifetime.signal.aborted) return;
            workspace = target;
            if (!config.fresh && config.sessionId && target.sessionIds.includes(config.sessionId) && !ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(config.sessionId)) ctx.uiWorkspace.openSession(config.sessionId);
            else {
              const sessionId = await ctx.sessions.create({ workspaceId: target.workspaceId });
              if (lifetime.signal.aborted) return;
              ctx.uiWorkspace.openSession(sessionId);
            }
            if (!lifetime.signal.aborted) { document.body.dataset.vscodeReady = 'true'; update(); bridge.post({ kind: 'client-ready' }); }
          })().catch(error => bridge.post({ kind: 'client-failure', error: String(error) }));
        }
      };
      bridge.handle = packet => {
        if (packet.kind === 'new-session') fresh();
        if (packet.kind === 'editor-context' && packet.context && config.mode === 'chat') {
          for (const owned of contexts.values()) owned.clear();
          currentChips().set(packet.context.key, packet.context); renderChips();
        }
      };
      const adapt = (): void => {
        const system = document.querySelector('[data-slot="sidebar.settings"] [class*="_cubeRow"] button:last-child');
        const label = system?.lastChild;
        if (label?.nodeType === Node.TEXT_NODE && label.textContent !== text.followTheme) label.textContent = text.followTheme;
        const seat = document.querySelector('[data-composer-seat]');
        if (seat) {
          const card = seat.querySelector('[data-composer-card]');
          if (card && chips.parentElement !== card) card.prepend(chips);
        }
        if (config.mode === 'settings') {
          const trigger = document.querySelector<HTMLButtonElement>('[data-slot="sidebar.settings"] button');
          if (trigger && !settingsOpened) { settingsOpened = true; trigger.click(); }
          const dialog = document.querySelector('[data-slot="sidebar.settings"] [role="dialog"]');
          if (dialog && settingsOpened) { dialog.setAttribute('data-vscode-settings', ''); if (!settingsSeen) bridge.post({ kind: 'client-ready' }); settingsSeen = true; }
          else if (settingsSeen) { settingsSeen = false; bridge.post({ kind: 'close-settings' }); }
        }
      };
      const observer = new MutationObserver(adapt); observer.observe(document.body, { childList: true, characterData: true, subtree: true });
      const outside = (event: PointerEvent): void => { if (!contextMenu.contains(event.target as Node)) contextMenu.hidden = true; if (!header.contains(event.target as Node)) menu.hidden = true; };
      const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') { menu.hidden = true; contextMenu.hidden = true; } };
      document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
      const unsubSessions = ctx.sessions.list.subscribe(update); const unsubWorkspaces = ctx.workspaces.list.subscribe(update);
      const unsubLocale = ctx.locale.subscribe(() => { text = copy(ctx.locale.getSnapshot().active); for (const render of renderButtons) render(); update(); renderChips(); adapt(); });
      update(); renderChips(); adapt();
      return () => {
        lifetime.abort(); unsubSessions(); unsubWorkspaces(); unsubLocale(); observer.disconnect();
        document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
        for (const root of roots) root.unmount(); header.remove(); chips.remove();
        bridge.contexts = () => []; bridge.submitted = () => {}; bridge.handle = undefined;
      };
    }, 'vscode: workspace surface');
  } };
} });
