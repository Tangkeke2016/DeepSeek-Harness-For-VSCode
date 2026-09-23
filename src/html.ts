/** Adapts the official, authenticated Web bootstrap to local Webview resources. */
import { pluginPath } from './plugin-path.ts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/** @param path - Mirrored resource file. @returns Whether it already holds published bytes. */
async function present(path: string): Promise<boolean> {
  try { return (await stat(path)).size > 0; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Capabilities provided by Extension Host or the isolated browser smoke. */
export interface WebAssets {
  fetch(path: string): Promise<Response>;
  cacheRoot: string;
  uri(path: string): string;
  bridgeUri: string;
  adapterUri: string;
  styleUri: string;
  cspSource: string;
  /** Embed official static assets to avoid individual remote Webview transfers. */
  inlineStatic?: boolean;
}

/** One view's workspace and launch intent, never authentication secrets. */
export interface ViewConfig {
  recovery?: { url: string; token: string };
  cwd: string;
  language: string;
  mode: 'chat' | 'settings';
  sessionId?: string;
  sessionTitle?: string;
  fresh: boolean;
  editorTab?: boolean;
  nonce: string;
  maxTransferBytes: number;
  requestTimeoutMs?: number;
  queueRevealDelayMs?: number;
}

/** @param source - Authenticated official index. @param assets - Bound resource loader. @param config - View-specific state. @returns Executable official Webview HTML. */
export async function webviewHtml(source: string, assets: WebAssets, config: ViewConfig): Promise<string> {
  const document = parse(source);
  // Names the cache subtree, so one extension installation never reuses another's files.
  const resourceScope = createHash('sha256').update('resource-scope-v2\0').update(assets.bridgeUri).digest('hex');
  const cached = new Map<string, Promise<string>>();
  const assigned = new Map<string, string>();
  const modules = new Map<string, string>();
  const styles = new Set<string>();

  // Mirror one backend URL to a local (or embedded) resource, rewriting the
  // relative references it carries so the mirrored copy stays self-contained.
  const mirror = (input: string, parent = '/'): Promise<string> => {
    const url = new URL(input, 'http://dsh.internal' + parent);
    // Off-origin URLs (data:, https:, …) pass through untouched.
    if (url.origin !== 'http://dsh.internal') return Promise.resolve(input);

    const key = url.pathname + url.search;
    if (assigned.has(key)) return Promise.resolve(assigned.get(key)!);
    const previous = cached.get(key);
    if (previous) return previous;

    const task = (async () => {
      const response = await assets.fetch(key);
      if (!response.ok) throw new Error(`Official asset HTTP ${response.status}: ${url.pathname}`);
      const body = Buffer.from(await response.arrayBuffer());

      // Content-addressed file name: identical bytes are stored once.
      const hash = createHash('sha256').update(key).update('\0').update(body).digest('hex');
      const local = join(assets.cacheRoot, resourceScope, hash + posix.extname(url.pathname));
      const isModule = url.pathname.endsWith('.js');
      const resourceUri = assets.inlineStatic && isModule ? `dsh-static/${createHash('sha256').update(key).digest('hex')}` : assets.inlineStatic ? '' : assets.uri(local);
      if (resourceUri) assigned.set(key, resourceUri);

      let text: string | undefined;
      if (url.pathname.endsWith('.js')) {
        text = body.toString('utf8');

        // Rewrite relative imports to the URLs their mirrored copies received.
        const refs = [...text.matchAll(/(["'])(\.{1,2}\/[^"'\s]+\.(?:js|css|woff2?|svg|png))\1/g)];
        for (const match of refs) {
          const mapped = await mirror(match[2]!, url.pathname);
          text = text.replaceAll(match[0], JSON.stringify(mapped));
        }
        // Blob modules cannot resolve Vite's relative preload URLs. Their CSS is included below.
        if (assets.inlineStatic) text = text.replace(/^const __vite__mapDeps=[^\n]+;\r?\n/, 'const __vite__mapDeps=()=>[];\n');
      } else if (url.pathname.endsWith('.css')) {
        text = body.toString('utf8');

        // Rewrite url(...) references the same way.
        for (const match of [...text.matchAll(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/g)]) {
          if (/^(data:|https?:|#)/.test(match[2]!)) continue;
          text = text.replaceAll(match[0], `url(${JSON.stringify(await mirror(match[2]!, url.pathname))})`);
        }
      }

      // Inline mode embeds small assets and registers modules for the import map.
      if (assets.inlineStatic) {
        if (isModule) {
          modules.set(resourceUri, text!);
          return resourceUri;
        }
        const mime: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
        const embedded = `data:${mime[posix.extname(url.pathname)] ?? 'application/octet-stream'};base64,${Buffer.from(text ?? body).toString('base64')}`;
        assigned.set(key, embedded);
        if (url.pathname.endsWith('.css')) styles.add(embedded);
        return embedded;
      }

      await mkdir(dirname(local), { recursive: true });
      // The name carries the content hash, so published bytes are already the
      // wanted ones and are never rewritten: renaming over a file the Webview is
      // reading fails on Windows, and two views can mirror the same resource at
      // once. A lost race is therefore a success, not a failed load.
      if (!await present(local)) {
        const temporary = `${local}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, text ?? body, { flag: 'wx' });
          await rename(temporary, local);
        } catch (error) {
          if (!await present(local)) throw error;
        } finally {
          try { await unlink(temporary); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
      return resourceUri;
    })();
    cached.set(key, task);
    return task;
  };

  // Rewrite the bootstrap in place: drop what points at the backend, map every
  // remaining resource, and capture the head and body the injections need.
  let head: Element | undefined; let body: Element | undefined;
  const visit = async (node: Node): Promise<void> => {
    if ('tagName' in node) {
      if (node.tagName === 'head') head = node;
      if (node.tagName === 'body') body = node;

      const attr = (name: string): string | undefined => node.attrs.find(item => item.name === name)?.value;
      const set = (name: string, value: string): void => { node.attrs = node.attrs.filter(item => item.name !== name); node.attrs.push({ name, value }); };

      // Preload hints and <base> point at the backend, which the Webview cannot reach.
      if (node.tagName === 'base' || (node.tagName === 'link' && ['manifest', 'preload', 'modulepreload'].includes(attr('rel') ?? ''))) {
        const parent = node.parentNode;
        if (parent) parent.childNodes = parent.childNodes.filter(child => child !== node);
        return;
      }

      if (node.tagName === 'script') {
        set('nonce', config.nonce);
        const src = attr('src');
        const plugin = src && pluginPath(src);
        if (plugin) {
          // Plugin scripts are inlined: the Webview cannot fetch them itself.
          const response = await assets.fetch(plugin);
          if (!response.ok) throw new Error(`Bootstrap HTTP ${response.status}`);
          node.attrs = node.attrs.filter(item => item.name !== 'src');
          node.childNodes = [{ nodeName: '#text', value: (await response.text()).replace(/<\/script/gi, '<\\/script'), parentNode: node }];
        } else if (src) {
          const mapped = await mirror(src);
          if (assets.inlineStatic && mapped.startsWith('dsh-static/')) {
            // An inlined module is reached through the generated import map.
            node.attrs = node.attrs.filter(item => item.name !== 'src');
            set('type', 'module');
            node.childNodes = [{ nodeName: '#text', value: `import ${JSON.stringify(mapped)};`, parentNode: node }];
          } else set('src', mapped);
        }
      }
      if (node.tagName === 'link' && attr('href')) set('href', await mirror(attr('href')!));
    }
    if ('childNodes' in node) for (const child of [...node.childNodes]) await visit(child);
  };
  await visit(document);

  if (!head || !body || !source.includes('__DSH_BOOT__')) throw new Error('Backend does not provide the official Web bootstrap');

  // The configuration is embedded, so `<` is escaped to keep it out of the markup.
  const configJson = JSON.stringify(config).replaceAll('<', '\\u003c');
  // The official Cordis loader evaluates its client configuration expressions.
  const csp = `default-src 'none'; script-src 'nonce-${config.nonce}' ${assets.cspSource} blob: 'unsafe-eval'; style-src ${assets.cspSource}${assets.inlineStatic ? ' data:' : ''} 'unsafe-inline'; img-src ${assets.cspSource} data: blob: https:; font-src ${assets.cspSource} data: blob:; connect-src ${assets.cspSource} blob:${config.recovery ? ' ' + new URL(config.recovery.url).origin : ''}; worker-src blob:;`;
  // The beacon owns the single `acquireVsCodeApi` call of the document, so a
  // bridge script that never runs still reports that the document itself did.
  const prefix = parseFragment(`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{margin:0!important;padding:0!important;min-height:100%;background:var(--vscode-editor-background,#181818)}#root{width:100%;height:100dvh}</style><link rel="stylesheet" href="${assets.styleUri}"><script nonce="${config.nonce}">globalThis.__VSCODE_DSH_CONFIG__=${configJson}</script><script nonce="${config.nonce}">globalThis.__VSCODE_DSH_API__=acquireVsCodeApi();globalThis.__VSCODE_DSH_API__.postMessage({kind:'document-boot'})</script><script nonce="${config.nonce}" src="${assets.bridgeUri}"></script>`);
  head.childNodes.unshift(...prefix.childNodes);

  // Inline mode needs the import map in place before any module consumes it.
  if (assets.inlineStatic) {
    const sources = JSON.stringify([...modules]).replaceAll('<', '\\u003c');
    const nonce = JSON.stringify(config.nonce).replaceAll('<', '\\u003c');
    const bootstrap = parseFragment(`<script nonce="${config.nonce}">{const imports={};for(const [id,source] of ${sources})imports[id]=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));const map=document.createElement('script');map.type='importmap';map.nonce=${nonce};map.textContent=JSON.stringify({imports});document.currentScript.after(map);}</script>${[...styles].map(href => `<link rel="stylesheet" href="${href}">`).join('')}`);
    head.childNodes.splice(prefix.childNodes.length, 0, ...bootstrap.childNodes);
  }

  const tail = parseFragment(`<link rel="stylesheet" href="${assets.styleUri}"><script nonce="${config.nonce}" src="${assets.adapterUri}"></script>`);
  body.childNodes.push(...tail.childNodes);

  return serialize(document);
}
