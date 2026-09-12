/** Resolves the official client's system color preference from VS Code's Webview theme classes. @returns Restore the native query provider and release listeners. */
export function followEditorTheme(): () => void {
  const original = window.matchMedia;
  const queries = new Map<string, EditorQuery>();
  const dark = (): boolean | undefined => {
    const classes = document.body?.classList;
    if (classes?.contains('vscode-light') || classes?.contains('vscode-high-contrast-light')) return false;
    if (classes?.contains('vscode-dark') || classes?.contains('vscode-high-contrast')) return true;
    return undefined;
  };
  class EditorQuery extends EventTarget implements MediaQueryList {
    readonly media: string;
    onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null;
    private previous: boolean;
    constructor(private readonly native: MediaQueryList, private readonly wantsDark: boolean) {
      super(); this.media = native.media; this.previous = this.matches;
      native.addEventListener('change', this.sync);
    }
    get matches(): boolean { const value = dark(); return value === undefined ? this.native.matches : value === this.wantsDark; }
    readonly sync = (): void => {
      if (this.previous === this.matches) return;
      this.previous = this.matches;
      const event = new MediaQueryListEvent('change', { matches: this.matches, media: this.media });
      this.dispatchEvent(event); this.onchange?.call(this, event);
    };
    addListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void { if (listener) this.addEventListener('change', listener as EventListener); }
    removeListener(listener: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null): void { if (listener) this.removeEventListener('change', listener as EventListener); }
    dispose(): void { this.native.removeEventListener('change', this.sync); }
  }
  const matchMedia: typeof window.matchMedia = query => {
    const color = /^\(prefers-color-scheme:\s*(dark|light)\)$/.exec(query.trim());
    if (!color) return original.call(window, query);
    let result = queries.get(color[1]!);
    if (!result) { result = new EditorQuery(original.call(window, query), color[1] === 'dark'); queries.set(color[1]!, result); }
    return result;
  };
  window.matchMedia = matchMedia;
  let body: HTMLElement | null = null;
  const observer = new MutationObserver(() => {
    if (document.body !== body) observe();
    for (const query of queries.values()) query.sync();
  });
  const observe = (): void => {
    observer.disconnect(); body = document.body;
    if (body) observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    else observer.observe(document.documentElement, { childList: true });
  };
  observe();
  return () => { observer.disconnect(); for (const query of queries.values()) query.dispose(); if (window.matchMedia === matchMedia) window.matchMedia = original; };
}
