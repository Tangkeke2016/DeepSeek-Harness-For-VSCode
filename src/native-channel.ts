/** Reattach native editor actions to pages retained by the detached supervisor. */
import WebSocket from 'ws';
import type { Discovery } from './shared-backend.ts';
import { record } from './protocol.ts';

/** One authenticated connection per VS Code window and workspace. */
export class NativeChannel {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private closed = false;

  /** @param target - Host-only supervisor endpoint. @param owner - VS Code window identity.
   * @param receive - Native requests from an existing page.
   */
  constructor(readonly target: Discovery, private readonly owner: string,
    private readonly receive: (epoch: string, packet: Record<string, unknown>) => Promise<void>) {
    this.connect();
  }

  private connect(): void {
    if (this.closed) return;
    const socket = new WebSocket(`ws://127.0.0.1:${this.target.port}/native/${this.owner}`, {
      headers: { authorization: `Bearer ${this.target.token}` }, handshakeTimeout: 10000,
      maxPayload: 4 * 1024 * 1024,
    });
    this.socket = socket;
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      if (!this.closed) this.retry = setTimeout(() => this.connect(), 1000);
    });
    socket.on('message', bytes => {
      try {
        const message = record(JSON.parse(bytes.toString()));
        if (typeof message.epoch !== 'string') return;
        const packet = record(message.packet);
        void this.receive(message.epoch, packet).catch(error => {
          this.send(message.epoch as string, { kind: 'failure', id: packet.id, error: String(error) });
        });
      } catch (error) { socket.close(1008); }
    });
  }

  /** @param epoch - Page identity. @param packet - Reply or client reconnection request. */
  send(epoch: string, packet: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ epoch, packet }));
  }

  /** @param epoch - Page identity. @param maxBytes - Per-page transfer budget.
   * @returns Browser capability, never the supervisor credential.
   */
  async register(epoch: string, maxBytes: number): Promise<string | undefined> {
    const response = await fetch(`http://127.0.0.1:${this.target.port}/pages`, {
      method: 'POST', headers: { authorization: `Bearer ${this.target.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ owner: this.owner, epoch, maxBytes }), signal: AbortSignal.timeout(10000),
    });
    // Already-running supervisors from older VSIX versions keep their original protocol.
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`Page registration HTTP ${response.status}`);
    const result = record(await response.json());
    if (typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)) throw new Error('Invalid page capability');
    return result.token;
  }

  /** Stop native delivery without disconnecting the browser or official backend. */
  dispose(): void {
    this.closed = true;
    clearTimeout(this.retry);
    this.socket?.terminate();
  }
}
