/** Page-scoped relays outlive the VS Code extension host that created them. */
import { randomBytes } from 'node:crypto';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { Transport } from './transport.ts';
import { WebRelay } from './relay.ts';
import { record, redact } from './protocol.ts';

interface Page {
  owner: string;
  epoch: string;
  maxBytes: number;
  socket?: WebSocket;
  relay?: WebRelay;
  expires: number;
  reservation: boolean;
  state: Map<string, Record<string, unknown>>;
}

/** Backend credentials stay in the supervisor; browsers receive only a single-page capability. */
export class DetachedPages {
  private readonly pages = new Map<string, Page>();
  private readonly hosts = new Map<string, WebSocket>();
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 360 * 1024 * 1024 });
  private readonly pending = new Set<Promise<unknown>>();
  private readonly sweep: ReturnType<typeof setInterval>;
  private closed = false;

  /** @param server - Supervisor listener. @param secret - Host-only credential.
   * @param backend - Current authenticated launch URL, absent until ready.
   */
  constructor(server: Server, private readonly secret: string, private readonly backend: () => string | undefined) {
    server.on('upgrade', (request, socket, head) => {
      const path = request.url ?? '';
      if (this.closed || (path !== '/page' && !path.startsWith('/native/'))) { socket.destroy(); return; }
      if (path.startsWith('/native/') && request.headers.authorization !== `Bearer ${this.secret}`) {
        socket.destroy(); return;
      }
      this.sockets.handleUpgrade(request, socket, head, ws => {
        ws.on('error', () => ws.terminate());
        if (path.startsWith('/native/')) this.host(path.slice('/native/'.length), ws);
        else this.page(ws);
      });
    });
    this.sweep = setInterval(() => {
      for (const [key, page] of this.pages) {
        if (!page.socket && page.expires < Date.now()) this.pages.delete(key);
      }
    }, 30000);
    this.sweep.unref();
  }

  /** @returns Live pages and reservations, including pages whose extension host crashed. */
  get connections(): number {
    return [...this.pages.values()].filter(page => page.socket?.readyState === WebSocket.OPEN
      || (page.reservation && page.expires > Date.now())).length;
  }

  /** Called only after the supervisor authenticates the host.
   * @param request - Page registration. @param response - Private capability response.
   */
  register(request: IncomingMessage, response: ServerResponse): void {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 4096) request.destroy();
    });
    request.on('end', () => {
      try {
        const value = record(JSON.parse(body));
        if (this.closed || !this.backend()) { response.writeHead(409).end(); return; }
        if (typeof value.owner !== 'string' || !/^[\w-]{1,128}$/.test(value.owner)
          || typeof value.epoch !== 'string' || !/^[A-Za-z0-9+/_-]{1,128}$/.test(value.epoch)
          || !Number.isInteger(value.maxBytes) || Number(value.maxBytes) < 1024
          || Number(value.maxBytes) > 256 * 1024 * 1024) throw new Error('Invalid page registration');
        if (this.pages.size >= 256) { response.writeHead(429).end(); return; }
        const token = randomBytes(32).toString('hex');
        this.pages.set(token, { owner: value.owner, epoch: value.epoch,
          maxBytes: Number(value.maxBytes), state: new Map(), reservation: true, expires: Date.now() + 30000 });
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ token }));
      } catch (error) { response.writeHead(400).end(); }
    });
  }

  private send(socket: WebSocket, value: unknown, limit = 360 * 1024 * 1024): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(value);
    if (socket.bufferedAmount + Buffer.byteLength(text) > limit) { socket.close(1013); return; }
    socket.send(text);
  }

  private track(work: Promise<unknown>): void {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => undefined);
  }

  private host(owner: string, socket: WebSocket): void {
    if (!/^[\w-]{1,128}$/.test(owner)) { socket.close(1008); return; }
    this.hosts.get(owner)?.close(1000);
    this.hosts.set(owner, socket);
    for (const page of this.pages.values()) {
      if (page.owner !== owner) continue;
      if (page.socket) this.send(page.socket, { kind: 'host-status', ready: true });
      for (const packet of page.state.values()) this.send(socket, { epoch: page.epoch, packet });
    }
    socket.on('close', () => {
      if (this.hosts.get(owner) !== socket) return;
      this.hosts.delete(owner);
      for (const page of this.pages.values()) {
        if (page.owner === owner && page.socket) this.send(page.socket, { kind: 'host-status', ready: false });
      }
    });
    socket.on('message', bytes => {
      try {
        const value = record(JSON.parse(bytes.toString()));
        if (value.kind === 'ping') { this.send(socket, { kind: 'pong' }); return; }
        for (const page of this.pages.values()) {
          if (page.owner === owner && page.epoch === value.epoch && page.socket) this.send(page.socket, value.packet);
        }
      } catch (error) { socket.close(1008); }
    });
  }

  private page(socket: WebSocket): void {
    const deadline = setTimeout(() => socket.close(1008), 10000);
    socket.once('close', () => clearTimeout(deadline));
    socket.once('message', bytes => {
      clearTimeout(deadline);
      let page: Page | undefined;
      try {
        const auth = record(JSON.parse(bytes.toString()));
        page = typeof auth.token === 'string' ? this.pages.get(auth.token) : undefined;
      } catch (error) { socket.close(1008); return; }
      if (!page || this.closed) { socket.close(1008); return; }
      const owned = page;
      const oldRelay = owned.relay;
      owned.socket?.close(1000);
      owned.socket = socket;
      owned.reservation = false;
      owned.relay = undefined;
      const transport = new Transport(() => socket.close(1012));
      const relay = new WebRelay(transport, packet => this.send(socket, packet, owned.maxBytes * 4), owned.maxBytes);
      owned.relay = relay;
      socket.once('close', () => {
        if (owned.socket === socket) {
          owned.socket = undefined;
          owned.relay = undefined;
          owned.expires = Date.now() + 24 * 60 * 60 * 1000;
        }
        this.track(relay.dispose());
      });
      // Install before asynchronous authentication so messages cannot be lost.
      let ready = false;
      socket.on('message', data => {
        try {
          const value = record(JSON.parse(data.toString()));
          if (value.kind === 'probe') {
            this.send(socket, { kind: 'pong', ready, host: this.hosts.get(owned.owner)?.readyState === WebSocket.OPEN });
            return;
          }
          if (!ready) { socket.close(1013); return; }
          this.track(relay.receive(value).then(handled => {
            if (handled) return;
            if (['client-ready', 'session', 'focus'].includes(String(value.kind))) owned.state.set(String(value.kind), value);
            const host = this.hosts.get(owned.owner);
            if (host?.readyState === WebSocket.OPEN) this.send(host, { epoch: owned.epoch, packet: value });
            else if (typeof value.id !== 'string') this.send(socket, { kind: 'native-unavailable' });
            else this.send(socket, { kind: 'failure', id: value.id, error: 'Extension host reconnecting' });
          }).catch(error => this.send(socket, { kind: 'failure', id: value.id, error: redact(String(error)) })));
        } catch (error) { socket.close(1008); }
      });
      this.track((async () => {
        await oldRelay?.dispose();
        if (socket.readyState !== WebSocket.OPEN || this.closed) return;
        const url = this.backend();
        if (!url) { socket.close(1013); return; }
        await transport.connect(url);
        if (socket.readyState !== WebSocket.OPEN || owned.socket !== socket) { await relay.dispose(); return; }
        ready = true;
        this.send(socket, { kind: 'carrier-ready', host: this.hosts.get(owned.owner)?.readyState === WebSocket.OPEN });
      })().catch(() => socket.close(1012)));
    });
  }

  /** @returns Completion after every page relay and upgraded socket closes. */
  async dispose(): Promise<void> {
    this.closed = true;
    clearInterval(this.sweep);
    for (const socket of this.sockets.clients) socket.terminate();
    await Promise.allSettled([...this.pages.values()].map(page => page.relay?.dispose()));
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    await new Promise<void>(resolve => this.sockets.close(() => resolve()));
    this.pages.clear();
    this.hosts.clear();
  }
}
