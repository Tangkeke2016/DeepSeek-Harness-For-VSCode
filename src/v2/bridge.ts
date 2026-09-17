/** Browser side of the Webview carrier; official client plugins retain their own protocol and recovery logic. */
import { contextText, type EditorContext } from './messages.ts';
import type { ViewConfig } from './html.ts';
import { bridgePluginResources } from './plugin-resources.ts';
import { followEditorTheme } from './theme.ts';
import { MessageAssembly } from './assembly.ts';

window.addEventListener('unload', followEditorTheme(), { once: true });

declare function acquireVsCodeApi(): { postMessage(value: unknown): void; getState(): unknown; setState(value: unknown): void };
interface Packet { kind: string; id?: string; index?: number; total?: number; text?: string; value?: unknown; error?: string; failure?: unknown; body?: string; status?: number; headers?: [string, string][] }
interface StreamQueue { values: unknown[]; error?: Error; closed: boolean; wake?: () => void }
interface BrowserGlobals {
  __VSCODE_DSH_CONFIG__: ViewConfig;
  __VSCODE_DSH__: {
    post(value: unknown): void;
    contexts: () => readonly EditorContext[];
    submitted: (contexts: readonly EditorContext[]) => void;
    handle?: (value: Packet) => void;
  };
  __DSH_TRANSPORT__: unknown;
}
const global = globalThis as unknown as BrowserGlobals;
const nativeApi = acquireVsCodeApi();
const config = global.__VSCODE_DSH_CONFIG__;
let panelState = { cwd: config.cwd, sessionId: config.sessionId, title: config.fresh ? undefined : config.sessionTitle };
nativeApi.setState(panelState);
const api = { postMessage: (value: Record<string, unknown>): void => {
  if (value.kind === 'session' && typeof value.sessionId === 'string') {
    panelState = { cwd: config.cwd, sessionId: value.sessionId, title: value.blank === false && typeof value.title === 'string' ? value.title : undefined };
    nativeApi.setState(panelState);
  }
  nativeApi.postMessage({ ...value, epoch: config.nonce });
} };
const nativeFetch = window.fetch.bind(window);
const requests = new Map<string, { resolve(value: Packet): void; reject(error: Error): void }>();
const streams = new Map<string, StreamQueue>();
const assembly = new MessageAssembly(global.__VSCODE_DSH_CONFIG__.maxTransferBytes * 4);
const timeoutMs = global.__VSCODE_DSH_CONFIG__.requestTimeoutMs ?? 60000;
const fault = (error: string): void => api.postMessage({ kind: 'client-failure', error });
global.__VSCODE_DSH__ = { post: value => api.postMessage(value as Record<string, unknown>), contexts: () => [], submitted: () => {} };

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return btoa(binary);
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value); return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function call(kind: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<Packet> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (packet: Packet): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(packet); };
    const failed = (error: Error): void => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); };
    const abort = (): void => { requests.delete(id); api.postMessage({ kind: 'abort', id }); failed(new DOMException('Aborted', 'AbortError')); };
    if (signal?.aborted) { failed(new DOMException('Aborted', 'AbortError')); return; }
    requests.set(id, { resolve: finish, reject: failed });
    if (kind === 'fetch' || kind === 'bundle') timer = setTimeout(() => {
      requests.delete(id); api.postMessage({ kind: 'abort', id });
      const message = `${kind} response timed out`; failed(new Error(message)); fault(message);
    }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    api.postMessage({ kind, id, ...payload });
  });
}
async function bridgedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requested = input instanceof Request ? input.url : String(input);
  const url = new URL(requested, location.href);
  if (url.origin !== location.origin || !(url.pathname === '/favicon.svg' || ['/api/', '/plugins/', '/open-in-app/'].some(prefix => url.pathname.startsWith(prefix)))) return nativeFetch(input, init);
  const request = new Request(input instanceof Request ? input : url, init);
  let bytes = new Uint8Array(await request.arrayBuffer());
  if (url.pathname === '/api/settings/openSettingsDocument' && request.method === 'POST') {
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as { rpcId: string };
    await call('open-settings-document', {}, request.signal);
    return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { opened: true } } });
  }
  const contexts = [...global.__VSCODE_DSH__.contexts()];
  const submitted = global.__VSCODE_DSH__.submitted;
  if (url.pathname === '/api/session/prompt' && contexts.length) {
    const envelope = JSON.parse(new TextDecoder().decode(bytes)) as { payload: { args: { request: { content: unknown[] } } } };
    envelope.payload.args.request.content.push({ type: 'text', text: contextText(contexts) });
    bytes = new TextEncoder().encode(JSON.stringify(envelope));
  }
  if (bytes.byteLength > global.__VSCODE_DSH_CONFIG__.maxTransferBytes) throw new Error('Attachment exceeds the VS Code transfer limit');
  const result = await call('fetch', { path: url.pathname + url.search, method: request.method, headers: [...request.headers], body: encode(bytes) }, request.signal);
  const response = new Response([204, 205, 304].includes(result.status!) ? null : decode(result.body ?? ''), { status: result.status, headers: result.headers });
  if (url.pathname === '/api/session/prompt' && response.ok) {
    const envelope = await response.clone().json() as { result?: { ok?: boolean } };
    if (envelope.result?.ok) submitted(contexts);
  }
  return response;
}
async function* openStream(endpoint: string, payload: unknown, signal: AbortSignal): AsyncGenerator<unknown> {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const queue: StreamQueue = { values: [], closed: false };
  const opening = endpoint === 'session/follow' ? setTimeout(() => {
    queue.error = new Error('History opening snapshot timed out'); queue.closed = true; queue.wake?.();
    api.postMessage({ kind: 'stream-cancel', id }); fault(queue.error.message);
  }, timeoutMs) : undefined;
  const abort = (): void => { queue.closed = true; queue.wake?.(); api.postMessage({ kind: 'stream-cancel', id }); };
  signal.throwIfAborted(); streams.set(id, queue);
  signal.addEventListener('abort', abort, { once: true });
  api.postMessage({ kind: 'stream-open', id, endpoint, payload });
  try {
    while (!queue.closed || queue.values.length) {
      if (queue.error) throw queue.error;
      if (queue.values.length) { clearTimeout(opening); yield queue.values.shift(); }
      else await new Promise<void>(resolve => { queue.wake = resolve; });
    }
    if (queue.error) throw queue.error;
  } finally { clearTimeout(opening); signal.removeEventListener('abort', abort); streams.delete(id); api.postMessage({ kind: 'stream-cancel', id }); }
}
function receive(packet: Packet): void {
  if (!packet || typeof packet.kind !== 'string') return;
  if (packet.kind === 'reply' || packet.kind === 'failure') {
    const request = requests.get(packet.id!); requests.delete(packet.id!);
    if (packet.kind === 'failure') request?.reject(new Error(packet.error)); else request?.resolve(packet);
  } else if (packet.kind === 'stream-item' || packet.kind === 'stream-error' || packet.kind === 'stream-end') {
    const queue = streams.get(packet.id!); if (!queue) return;
    if (packet.kind === 'stream-end') queue.closed = true;
    else if (packet.kind === 'stream-error') {
      queue.error = Object.assign(new Error(packet.error), { dshRemoteStreamFailure: packet.failure ?? { kind: 'carrier' } });
      queue.closed = true;
    } else {
      queue.values.push(packet.value);
      if (queue.values.length > 2048) { queue.error = new Error('Remote stream consumer fell behind'); queue.closed = true; }
    }
    queue.wake?.(); queue.wake = undefined;
  } else global.__VSCODE_DSH__.handle?.(packet);
}
window.addEventListener('message', (event: MessageEvent<Packet>) => {
  const packet = event.data;
  if (packet?.kind !== 'delivery-part') { receive(packet); return; }
  try {
    const value = assembly.accept(packet);
    if (value !== undefined) { receive(value as Packet); api.postMessage({ kind: 'delivery-ack', id: packet.id }); }
  } catch (error) { api.postMessage({ kind: 'delivery-ack', id: packet.id, error: String(error) }); fault(String(error)); }
});
window.addEventListener('error', event => { if (event.message) api.postMessage({ kind: 'client-diagnostic', error: event.message.slice(0, 1000) }); });
global.__DSH_TRANSPORT__ = {
  ownsHost: true,
  fetch: bridgedFetch,
  openStream,
  async loadBundle(path: string): Promise<void> {
    const reply = await call('bundle', { path });
    const script = document.createElement('script'); script.nonce = global.__VSCODE_DSH_CONFIG__.nonce;
    script.textContent = String(reply.value); document.head.append(script); script.remove();
  },
};
window.fetch = bridgedFetch;
window.addEventListener('unload', bridgePluginResources(bridgedFetch), { once: true });
Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (text: string): Promise<void> => { await call('clipboard', { text }); } });
window.addEventListener('focus', () => api.postMessage({ kind: 'focus' }));
document.addEventListener('click', event => {
  const link = (event.target as Element | null)?.closest('a');
  if (!link?.href || link.getAttribute('href')?.startsWith('#')) return;
  const url = new URL(link.href, location.href);
  if (['http:', 'https:', 'mailto:'].includes(url.protocol) && url.origin !== location.origin) {
    event.preventDefault(); api.postMessage({ kind: 'external', url: url.href });
  }
});
api.postMessage({ kind: 'bridge-ready' });
