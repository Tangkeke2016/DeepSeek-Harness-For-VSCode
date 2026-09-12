/** Owns authenticated HTTP and one multiplexed socket; callers own reconnection. */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { launchUrl, record, rpcResult, string } from './protocol.ts';

type Stream = { item: (value: unknown) => void; fail: (error: Error) => void };

/** A connection authenticates before opening any Remote stream. */
export class Transport {
  private cookie = '';
  private origin = '';
  private socket?: WebSocket;
  private readonly streams = new Map<string, Stream>();
  private readonly abort = new AbortController();
  private closed = false;

  /** @param onDisconnect - Reports unexpected socket loss once. */
  constructor(private readonly onDisconnect: (error: Error) => void) {}

  /** @param input - Official launch URL. @returns Completion after authenticated socket opening. */
  async connect(input: string): Promise<void> {
    const url = launchUrl(input);
    this.origin = url.origin;
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]) });
    if (response.status !== 302 && response.status !== 303) throw new Error(`Authentication HTTP ${response.status}`);
    this.cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    await response.body?.cancel();
    if (!this.cookie) throw new Error('Authentication returned no cookie');
    this.abort.signal.throwIfAborted();
    const socket = new WebSocket(this.origin.replace('http:', 'ws:') + '/api/remote.mux', {
      headers: { Cookie: this.cookie, Origin: this.origin }, handshakeTimeout: 15_000, maxPayload: 64 * 1024 * 1024,
    });
    this.socket = socket;
    socket.on('message', (bytes, binary) => {
      try {
        if (binary) throw new Error('Unexpected binary Remote frame');
        const frame = record(JSON.parse(bytes.toString()) as unknown);
        const id = string(frame.streamId);
        const stream = this.streams.get(id);
        if (!['item', 'end', 'error'].includes(string(frame.type))) throw new Error('Invalid Remote frame');
        if (!stream) return;
        if (frame.type === 'item') stream.item(frame.value);
        else {
          this.streams.delete(id);
          const failure = frame.type === 'error' ? record(frame.error) : undefined;
          stream.fail(Object.assign(new Error(failure ? string(failure.message) : 'Remote stream ended'), failure
            ? { dshRemoteStreamFailure: { kind: 'remote', code: string(failure.code), details: failure.details } }
            : { dshRemoteStreamEnd: true }));
        }
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
    socket.on('error', error => this.fail(error));
    socket.on('close', () => this.fail(new Error('Backend disconnected')));
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => { socket.off('open', opened); socket.off('error', failed); socket.off('close', closed); };
      const opened = (): void => { cleanup(); resolve(); };
      const failed = (error: Error): void => { cleanup(); reject(error); };
      const closed = (): void => failed(new Error('Socket closed before opening'));
      socket.once('open', opened); socket.once('error', failed); socket.once('close', closed);
    });
  }

  /** @param endpoint - Official Remote name. @param args - Named arguments. @returns Validated RPC result. */
  async call(endpoint: string, args: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error('Connection closed');
    if (!/^[\w$.-]+(?:\/[\w$.-]+)*$/.test(endpoint)) throw new Error('Invalid endpoint');
    const rpcId = randomUUID();
    const response = await fetch(`${this.origin}/api/${endpoint}`, {
      method: 'POST', redirect: 'error', headers: { Cookie: this.cookie, Origin: this.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
      signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    return rpcResult(await response.json(), rpcId);
  }

  /** @param path - Backend-relative asset or API path. @param init - Fetch method/body and cancellation. @returns Authenticated response without redirecting credentials. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(path, this.origin);
    if (target.origin !== this.origin || target.username || target.password) throw new Error('Cross-origin backend request refused');
    if (this.closed) throw new Error('Connection closed');
    const headers = new Headers(init.headers);
    headers.set('Cookie', this.cookie); headers.set('Origin', this.origin);
    const signals = [this.abort.signal, AbortSignal.timeout(60_000)];
    if (init.signal) signals.push(init.signal);
    return fetch(target, { ...init, headers, redirect: 'error', signal: AbortSignal.any(signals) });
  }

  /** @param endpoint - Remote stream. @param args - Named arguments. @param item - Synchronous item consumer. @param fail - Terminal failure consumer. @returns Cancellation function. */
  open(endpoint: string, args: Record<string, unknown>, item: Stream['item'], fail: Stream['fail']): () => void {
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Connection unavailable');
    const streamId = randomUUID();
    this.streams.set(streamId, { item, fail });
    this.socket.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args } }));
    return () => {
      if (this.streams.delete(streamId) && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'cancel', streamId }));
      }
    };
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    const streams = [...this.streams.values()];
    this.streams.clear();
    this.socket?.terminate();
    for (const stream of streams) {
      try { stream.fail(error); } catch (failure) { this.onDisconnect(failure instanceof Error ? failure : new Error(String(failure))); }
    }
    this.onDisconnect(error);
  }

  /** Cancel requests and wait until the physical socket closes. */
  async dispose(): Promise<void> {
    this.closed = true;
    this.abort.abort();
    const streams = [...this.streams.values()];
    this.streams.clear();
    for (const stream of streams) {
      try { stream.fail(new Error('Connection closed')); } catch (error) { this.onDisconnect(error instanceof Error ? error : new Error(String(error))); }
    }
    const socket = this.socket;
    if (!socket || socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { socket.once('close', resolve); socket.terminate(); });
  }
}
