/** Routes plugin-created image and script URLs through the authenticated Webview carrier. */

/** @param fetchResource - Authenticated, size-limited backend fetch. @returns Restore DOM accessors and release pending resources. */
export function bridgePluginResources(fetchResource: typeof fetch): () => void {
  const setAttribute = Element.prototype.setAttribute;
  const states = new Map<HTMLImageElement | HTMLScriptElement, { controller: AbortController; source: string; blob?: string }>();
  // Both prototypes define `src` as an accessor pair; keep the originals for restoration.
  const descriptors = [HTMLImageElement.prototype, HTMLScriptElement.prototype].map(prototype => ({ prototype, descriptor: Object.getOwnPropertyDescriptor(prototype, 'src')! }));
  let disposed = false;

  const release = (element: HTMLImageElement | HTMLScriptElement): void => {
    const state = states.get(element);
    state?.controller.abort();
    if (state?.blob) URL.revokeObjectURL(state.blob);
    states.delete(element);
  };

  const assign = (element: HTMLImageElement | HTMLScriptElement, value: string, native: () => void): void => {
    release(element);
    let url: URL;
    try { url = new URL(value, document.baseURI); } catch { native(); return; }

    // Only backend-owned resources are proxied; every other URL keeps native behavior.
    if (url.origin !== location.origin || !(url.pathname.startsWith('/plugins/') || url.pathname === '/favicon.svg')) { native(); return; }

    const state = { controller: new AbortController(), source: url.href, blob: undefined as string | undefined };
    states.set(element, state);
    void (async () => {
      const response = await fetchResource(url, { signal: state.controller.signal });
      if (!response.ok) throw new Error(`Plugin resource HTTP ${response.status}`);
      const blob = await response.blob();

      // The element may have been released or reassigned while the fetch was in flight.
      if (disposed || states.get(element) !== state) return;
      state.blob = URL.createObjectURL(blob);
      setAttribute.call(element, 'src', state.blob);
    })().catch(error => {
      if (disposed || states.get(element) !== state || state.controller.signal.aborted) return;
      release(element);
      console.error('Plugin resource failed', url.pathname, error);
      // The official UI reacts to a failed resource through the DOM error event.
      element.dispatchEvent(new Event('error'));
    });
  };

  for (const { prototype, descriptor } of descriptors) Object.defineProperty(prototype, 'src', {
    ...descriptor,
    get(this: HTMLImageElement | HTMLScriptElement): string { return states.get(this)?.source ?? descriptor.get!.call(this); },
    set(this: HTMLImageElement | HTMLScriptElement, value: string) { assign(this, String(value), () => descriptor.set!.call(this, value)); },
  });

  Element.prototype.setAttribute = function (name: string, value: string): void {
    if (name.toLowerCase() === 'src' && (this instanceof HTMLImageElement || this instanceof HTMLScriptElement)) assign(this, String(value), () => setAttribute.call(this, name, value));
    else setAttribute.call(this, name, value);
  };

  // Detached preloader images remain owned until unload; connected nodes are released on removal.
  const observer = new MutationObserver(records => {
    for (const record of records)
      for (const removed of record.removedNodes) {
        if (!(removed instanceof Element) || removed.isConnected) continue;
        for (const element of [removed, ...removed.querySelectorAll('img,script')]) {
          if (element instanceof HTMLImageElement || element instanceof HTMLScriptElement) release(element);
        }
      }
  });
  observer.observe(document, { childList: true, subtree: true });

  return () => {
    disposed = true;
    observer.disconnect();
    for (const element of states.keys()) release(element);
    Element.prototype.setAttribute = setAttribute;
    for (const { prototype, descriptor } of descriptors) Object.defineProperty(prototype, 'src', descriptor);
  };
}
