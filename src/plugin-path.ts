/** Resolve old absolute and current document-relative official plugin references. */

/**
 * @param reference - Official bootstrap or bundle URL.
 * @returns Root-relative plugin route, or absence for other origins, fragments, or resources.
 */
export function pluginPath(reference: string): string | undefined {
  const origin = 'https://dsh.invalid';
  let url: URL;
  try { url = new URL(reference, `${origin}/`); }
  catch (error) {
    // Invalid URLs cannot name an authenticated plugin route.
    return undefined;
  }
  if (url.origin !== origin || !url.pathname.startsWith('/plugins/') || url.hash) return undefined;
  return url.pathname + url.search;
}
