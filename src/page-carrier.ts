/** Browser connection to the detached relay; recovery never replaces the document. */
import { copy } from './locale.ts';

/** A page capability authorizes only this page's official API relay. */
export class PageCarrier {
  private socket?: WebSocket;
  private ready = false;
  private opened = false;
  private closed = false;
  private retry?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private lastPong = 0;
  private readonly initial: Record<string, unknown>[] = [];
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private badge?: HTMLElement;

  /** @param endpoint - Forwarded supervisor URL and page-only credential.
   * @param language - VS Code locale. @param receive - Existing bridge packet receiver.
   * @param lost - Fail pending operations without replaying them.
   */
  constructor(private readonly endpoint: { url: string; token: string }, private readonly language: string,
    private readonly receive: (packet: Record<string, unknown>) => void, private readonly lost: () => void) {
    this.connect();
    this.heartbeat = setInterval(() => this.probe(), 10000);
    window.addEventListener('focus', this.probe);
    document.addEventListener('visibilitychange', this.visible);
    document.addEventListener('click', this.interaction, true);
    document.addEventListener('keydown', this.keyed, true);
  }

  private notice(show: boolean): void {
    if (!show) { this.badge?.remove(); this.badge = undefined; return; }
    if (this.badge || !document.body) return;
    this.badge = document.createElement('div');
    this.badge.id = 'vscode-reconnecting';
    this.badge.setAttribute('role', 'status');
    this.badge.textContent = copy(this.language).reconnecting;
    document.body.append(this.badge);
  }

  private connect(): void {
    if (this.closed || this.socket) return;
    clearTimeout(this.retry);
    const socket = new WebSocket(this.endpoint.url);
    this.socket = socket;
    this.deadline = setTimeout(() => socket.close(), 15000);
    socket.onopen = () => socket.send(JSON.stringify({ token: this.endpoint.token }));
    socket.onmessage = event => {
      try {
        const value = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (value.kind === 'carrier-ready') {
          clearTimeout(this.deadline);
          this.ready = true;
          this.lastPong = Date.now();
          this.notice(false);
          const reconnect = this.opened;
          this.opened = true;
          for (const packet of this.initial.splice(0)) this.post(packet);
          if (reconnect) this.receive({ kind: 'reconnect-client' });
        } else if (value.kind === 'native-unavailable') {
          this.notice(true);
        } else if (value.kind === 'host-status') {
          if (value.ready === true) this.notice(false);
        } else if (value.kind === 'pong') {
          this.lastPong = Date.now();
          if (value.host === true) this.notice(false);
        } else this.receive(value);
      } catch (error) { socket.close(1008); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      clearTimeout(this.deadline);
      this.socket = undefined;
      this.ready = false;
      // Initial requests also settle if the first connection fails.
      this.initial.length = 0;
      this.opened = true;
      this.lost();
      if (!this.closed) {
        this.notice(true);
        this.retry = setTimeout(() => this.connect(), 1000);
      }
    };
  }

  /** @param packet - One operation, transmitted at most once. */
  post(packet: Record<string, unknown>): void {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(packet));
    } else if (!this.opened && this.initial.length < 128) this.initial.push(packet);
    else {
      this.probe();
      if (typeof packet.id === 'string') this.receive({
        kind: packet.kind === 'stream-open' ? 'stream-error' : 'failure', id: packet.id,
        error: copy(this.language).reconnecting,
      });
    }
  }

  /** Triggered by timers, focus and every mouse or keyboard activation. */
  readonly probe = (): void => {
    if (this.closed) return;
    if (!this.socket) { this.connect(); return; }
    if (!this.ready) return;
    if (Date.now() - this.lastPong > 30000) { this.ready = false; this.socket.close(); return; }
    this.socket.send(JSON.stringify({ kind: 'probe' }));
  };

  private readonly visible = (): void => { if (!document.hidden) this.probe(); };
  private readonly keyed = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      this.probe();
      if (!this.ready) { this.notice(true); event.preventDefault(); event.stopImmediatePropagation(); }
    } else if (event.key === ' ') this.interaction(event);
  };
  private readonly interaction = (event: Event): void => {
    this.probe();
    const target = event.target;
    if (!this.ready && target instanceof Element && target.closest('button, a, [role=button], [role=menuitem]')) {
      this.notice(true);
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  /** Release page-owned listeners and timers on document disposal. */
  dispose(): void {
    this.closed = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    clearTimeout(this.deadline);
    window.removeEventListener('focus', this.probe);
    document.removeEventListener('visibilitychange', this.visible);
    document.removeEventListener('click', this.interaction, true);
    document.removeEventListener('keydown', this.keyed, true);
    this.socket?.close();
    this.notice(false);
  }
}
