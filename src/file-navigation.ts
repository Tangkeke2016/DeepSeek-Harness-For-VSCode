/** Route official file resources to the editor while retaining other sidebar resources. */
import { isWebPage } from './file-opening-rules.ts';
export interface FileNavigation { path: string; cwd?: string; line?: number }
export interface ResourceNavigation {
  openResource(address: string, options?: { params?: { line?: number } }): void;
  openTab?(kind: string, options?: { params?: { url?: string } }): void;
}

/** @param address - Official resource URI. @returns Decoded file scope, or undefined for other resources. */
export function fileResource(address: string): { path: string; sessionId?: string } | undefined {
  const prefix = 'dsh-resource://file/';
  if (!address.startsWith(prefix)) return undefined;
  try {
    const [scope, ...parts] = address.slice(prefix.length).split(/[?#]/, 1)[0]!.split('/');
    if (scope === 'session' && parts[0] && parts.length > 1) {
      return { sessionId: decodeURIComponent(parts[0]), path: parts.slice(1).map(decodeURIComponent).join('/') };
    }
    if (scope === 'absolute' && parts.length && parts.join('/')) {
      const path = parts.map(decodeURIComponent).join('/');
      return { path: /^[A-Za-z]:\//.test(path) ? path : `/${path}` };
    }
  } catch (error) {
    if (!(error instanceof URIError)) throw error;
  }
  return undefined;
}

/**
 * @param navigation - Official sidebar controller for this client lifetime.
 * @param cwd - Resolve the resource's session workspace, including nonselected sessions.
 * @param open - Forward an explicit file click to the extension host.
 * @returns Restore the original method when the client plugin unloads.
 */
export function routeFiles(navigation: ResourceNavigation, cwd: (sessionId: string) => string | undefined,
  open: (file: FileNavigation) => void): () => void {
  const original = navigation.openResource;
  const originalTab = navigation.openTab;
  const browserTab: ResourceNavigation['openTab'] = function (this: ResourceNavigation, kind, options) {
    if (kind === 'browser' && options?.params?.url && isWebPage(options.params.url)) {
      open({ path: options.params.url });
    } else originalTab?.call(this, kind, options);
  };
  const replacement: ResourceNavigation['openResource'] = function (this: ResourceNavigation, address, options) {
    if (isWebPage(address)) { open({ path: address }); return; }
    const file = fileResource(address);
    if (!file) { original.call(this, address, options); return; }
    open({ path: file.path || '.', cwd: file.sessionId ? cwd(file.sessionId) : undefined, line: options?.params?.line });
  };
  navigation.openResource = replacement;
  if (originalTab) navigation.openTab = browserTab;
  return () => {
    if (navigation.openResource === replacement) navigation.openResource = original;
    if (originalTab && navigation.openTab === browserTab) navigation.openTab = originalTab;
  };
}
