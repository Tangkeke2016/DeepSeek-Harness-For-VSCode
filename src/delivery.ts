/** Bounded, ordered host-to-Webview delivery with an acknowledgement after reassembly. */
import { randomUUID } from 'node:crypto';

/** Splits large messages so the remote extension channel never carries a multi-megabyte frame. */
export class MessageDelivery {
  private readonly queue: { id: string; text: string }[] = [];
  private bytes = 0;
  private active = false;
  private disposed = false;
  private visible = true;
  private acknowledgement?: { id: string; finish(error?: Error): void; watch(visible: boolean): void };

  /** @param post - Native Webview delivery result. @param failed - Reports undeliverable data without replaying RPCs. @param limit - Maximum queued UTF-16 bytes. @param timeout - Maximum acknowledgement wait in milliseconds. */
  constructor(private readonly post: (packet: unknown) => PromiseLike<boolean>, private readonly failed: (error: Error) => void, private readonly limit: number, private readonly timeout: number) {}

  /** @param value - One ordered relay packet, including stream termination. */
  send(value: unknown): void {
    if (this.disposed) return;

    const text = JSON.stringify(value);
    if (this.bytes + text.length * 2 > this.limit) { this.fail(new Error('Webview delivery buffer exceeded')); return; }

    this.bytes += text.length * 2;
    this.queue.push({ id: randomUUID(), text });
    if (!this.active) void this.flush();
  }

  /** @param visible - Hidden Webviews keep receiving messages; only acknowledgement deadlines pause while JavaScript may be suspended. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.acknowledgement?.watch(visible);
    // A queue parked while hidden resumes as soon as the view is visible again.
    if (visible && !this.active && this.queue.length && !this.disposed) void this.flush();
  }

  /** @param id - Packet identity acknowledged by this view. @param error - Optional reassembly failure. */
  acknowledge(id: string, error?: string): void {
    if (this.acknowledgement?.id === id) this.acknowledgement.finish(error ? new Error(error) : undefined);
  }

  /** Cancel queued deliveries without affecting backend sessions. */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.bytes = 0;
    this.acknowledgement?.finish(new Error('View disposed'));
  }

  private fail(error: Error): void {
    if (this.disposed) return;
    this.dispose();
    this.failed(error);
  }

  private async flush(): Promise<void> {
    this.active = true;
    try {
      while (!this.disposed && this.queue.length) {
        const message = this.queue[0]!;
        let resolveCompletion!: () => void;
        let rejectCompletion!: (error: Error) => void;
        const completion = new Promise<void>((resolve, reject) => { resolveCompletion = resolve; rejectCompletion = reject; });

        // Mark rejection handled while native postMessage calls are still pending.
        void completion.catch(() => {});

        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (error?: Error): void => { settled = true; clearTimeout(timer); error ? rejectCompletion(error) : resolveCompletion(); };

        // The deadline measures visible time only: a hidden Webview may suspend the acknowledgement.
        const watch = (visible: boolean): void => {
          clearTimeout(timer);
          if (visible && !settled) timer = setTimeout(() => finish(new Error('Webview did not acknowledge delivery')), this.timeout);
        };
        this.acknowledgement = { id: message.id, finish, watch };
        watch(this.visible);
        try {
          const size = 64 * 1024;
          const total = Math.ceil(message.text.length / size);
          for (let index = 0; index < total && !this.disposed; index++) {
            const posted = this.post({ kind: 'delivery-part', id: message.id, index, total, text: message.text.slice(index * size, (index + 1) * size) });

            // Stop early when the view acknowledges or disappears mid-transfer.
            if (!await Promise.race([Promise.resolve(posted), completion.then(() => true)])) throw new Error('Webview is unavailable');
          }
          await completion;
        } finally { clearTimeout(timer); this.acknowledgement = undefined; }

        if (!this.disposed) { this.bytes -= message.text.length * 2; this.queue.shift(); }
      }
    } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); }
    finally { this.active = false; }
  }
}
