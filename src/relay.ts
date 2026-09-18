/** Per-Webview request ownership; no backend credentials cross the message bridge. */
import { Transport } from './transport.ts';
import { record, string, array, redact } from './protocol.ts';
import { presentation } from './messages.ts';

/** Authenticated relay using the official HTTP and stream APIs. */
export class WebRelay {
  private readonly requests = new Map<string, AbortController>();
  private readonly streams = new Map<string, () => void>();
  private disposed = false;
  private readonly pending = new Set<Promise<boolean>>();

  /** @param transport - This view's authenticated carrier. @param send - Webview delivery. @param maxBytes - Buffered transfer limit. @param bundleFetch - Optional backend-lifetime immutable resource cache. */
  constructor(readonly transport: Pick<Transport, 'request' | 'open' | 'dispose'>, private readonly send: (value: unknown) => void, private readonly maxBytes: number, private readonly bundleFetch?: (path: string, signal: AbortSignal) => Promise<Response>) {}

  /** @param input - Untrusted Webview envelope. @returns Whether the relay owns this message. */
  receive(input: unknown): Promise<boolean> {
    // Track in-flight work so dispose() can await every answer already started.
    const task = this.handle(input);
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  private async handle(input: unknown): Promise<boolean> {
    const message = record(input);
    const kind = string(message.kind);

    // Messages this relay does not own fall through to the extension host.
    if (!['fetch', 'bundle', 'abort', 'stream-open', 'stream-cancel'].includes(kind)) return false;

    const id = string(message.id);
    if (this.disposed) return true;
    if (kind === 'abort') { this.requests.get(id)?.abort(); return true; }
    if (kind === 'stream-cancel') { this.streams.get(id)?.(); this.streams.delete(id); return true; }

    // One identity per request or stream; reuse would let a view cancel another's work.
    if (this.requests.has(id) || this.streams.has(id)) throw new Error('Duplicate Webview request identity');

    try {
      if (kind === 'stream-open') {
        if (this.streams.size >= 128) throw new Error('Too many Webview streams');

        const endpoint = string(message.endpoint);
        if (!/^[\w$.-]+(?:\/[\w$.-]+)*$/.test(endpoint)) throw new Error('Invalid stream endpoint');

        const args = record(record(message.payload).args);
        const cancel = this.transport.open(endpoint, args,
          value => this.emit({ kind: 'stream-item', id, value: presentation(value) }),
          error => {
            this.streams.delete(id);
            const failure = error as Error & { dshRemoteStreamEnd?: boolean; dshRemoteStreamFailure?: unknown };
            // A clean end and a remote failure both terminate the browser-side stream.
            this.emit({ kind: failure.dshRemoteStreamEnd ? 'stream-end' : 'stream-error', id, error: redact(error.message), failure: failure.dshRemoteStreamFailure });
          });
        this.streams.set(id, cancel);
        return true;
      }

      const controller = new AbortController();
      this.requests.set(id, controller);
      try {
        const path = string(message.path);

        // Resolve against a sentinel origin so a foreign or ambiguous path is rejected.
        const parsed = new URL(path, 'https://relay.invalid');
        if (parsed.origin !== 'https://relay.invalid' || path !== parsed.pathname + parsed.search) throw new Error('Invalid backend path');

        // Only the routes the official client needs are forwarded.
        const routes = kind === 'bundle' ? ['/plugins/'] : ['/api/', '/plugins/', '/open-in-app/'];
        if (!(routes.some(prefix => path.startsWith(prefix)) || (kind === 'fetch' && path === '/favicon.svg')) || /[\r\n]/.test(path)) throw new Error('Unsupported backend route');

        if (kind === 'bundle') {
          // Client bundles are immutable for the backend's lifetime, so they may be cached.
          const response = await (this.bundleFetch ? this.bundleFetch(path, controller.signal) : this.transport.request(path, { signal: controller.signal }));
          if (!response.ok) throw new Error(`Client bundle HTTP ${response.status}`);
          this.emit({ kind: 'reply', id, value: (await this.read(response)).toString('utf8') });
        } else {
          const method = string(message.method);
          // Plugin resources support the full method set; API traffic stays read/write only.
          if (!(path.startsWith('/plugins/') ? ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] : ['GET', 'HEAD', 'POST']).includes(method)) throw new Error('Unsupported backend method');

          const encoded = string(message.body);
          if (encoded.length > Math.ceil(this.maxBytes / 3) * 4) throw new Error('Attachment exceeds the VS Code transfer limit');

          // Forward only content negotiation headers; credentials come from the transport.
          const headers = new Headers();
          for (const entry of array(message.headers)) {
            const pair = array(entry);
            const name = string(pair[0]);
            const value = string(pair[1]);
            if (['content-type', 'accept', 'range'].includes(name.toLowerCase())) headers.set(name, value);
          }

          const body = Buffer.from(encoded, 'base64');
          const response = await this.transport.request(path, { method, headers, ...(!['GET', 'HEAD'].includes(method) ? { body } : {}), signal: controller.signal });
          let bytes = await this.read(response);

          // JSON answers hide the encoded editor context before the UI sees them.
          if (response.headers.get('content-type')?.includes('application/json')) bytes = Buffer.from(JSON.stringify(presentation(JSON.parse(bytes.toString('utf8')))));

          this.emit({ kind: 'reply', id, status: response.status,
            headers: [...response.headers].filter(([name]) => !['set-cookie', 'content-length', 'content-encoding'].includes(name)), body: bytes.toString('base64') });
        }
      } finally { this.requests.delete(id); }
    } catch (error) {
      this.emit({ kind: kind === 'stream-open' ? 'stream-error' : 'failure', id, error: redact(error instanceof Error ? error.message : String(error)) });
    }
    return true;
  }

  private emit(value: unknown): void {
    if (!this.disposed) this.send(value);
  }

  private async read(response: Response): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);

    // Enforce the transfer limit while streaming so an oversized body is cancelled early.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > this.maxBytes) { await reader.cancel(); throw new Error('Backend response exceeds the VS Code transfer limit'); }
        chunks.push(item.value);
      }
      return Buffer.concat(chunks, size);
    } finally { reader.releaseLock(); }
  }

  /** Abort requests, cancel streams, and await the physical connection shutdown. */
  async dispose(): Promise<void> {
    this.disposed = true;
    for (const request of this.requests.values()) request.abort();
    for (const cancel of this.streams.values()) cancel();
    this.requests.clear(); this.streams.clear();
    await this.transport.dispose();
    await Promise.allSettled(this.pending);
  }
}
