/** Reassembles one bounded host packet before exposing it to the official client. */
export class MessageAssembly {
  private current?: { id: string; total: number; parts: string[]; length: number };
  /** @param limit - Maximum UTF-16 bytes of a single assembled packet. */
  constructor(private readonly limit: number) {}
  /** @param packet - Untrusted host framing. @returns Completed relay packet, or undefined until complete. */
  accept(packet: { id?: unknown; index?: unknown; total?: unknown; text?: unknown }): unknown {
    const { id, index, total, text } = packet;
    if (typeof id !== 'string' || typeof text !== 'string' || !Number.isInteger(index) || !Number.isInteger(total) || Number(total) < 1 || Number(total) > Math.ceil(this.limit / 2 / 65536)) throw new Error('Invalid Webview delivery frame');
    if (!this.current) this.current = { id, total: Number(total), parts: [], length: 0 };
    const current = this.current;
    if (id !== current.id || total !== current.total || index !== current.parts.length) throw new Error('Out-of-order Webview delivery');
    current.length += text.length;
    if (current.length * 2 > this.limit) throw new Error('Webview delivery exceeds limit');
    current.parts.push(text);
    if (current.parts.length !== current.total) return undefined;
    this.current = undefined;
    return JSON.parse(current.parts.join('')) as unknown;
  }
}
