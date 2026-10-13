/** Serialized supervisor diagnostics whose write failures do not block teardown. */
import { appendFile } from 'node:fs/promises';
import { redact } from './protocol.ts';

/** Credential-redacted, bounded diagnostics for one supervisor lifetime. */
export class SupervisorLog {
  private bytes = 0;
  private pending = Promise.resolve();

  /** @param file - Private log file. @param failed - Reports a failed write independently of backend ownership. */
  constructor(private readonly file: string, private readonly failed: (error: unknown) => void) {}

  /** @param line - Process diagnostic, with launch credentials removed before persistence. */
  write(line: string): void {
    const text = `${new Date().toISOString()} ${redact(line)}\n`;
    if (this.bytes + Buffer.byteLength(text) > 1024 * 1024) return;
    this.bytes += Buffer.byteLength(text);
    this.pending = this.pending.then(async () => {
      try { await appendFile(this.file, text, { mode: 0o600 }); }
      catch (error) { this.failed(error); }
    });
  }

  /** @returns Completion of queued writes, including handled failures. */
  flush(): Promise<void> { return this.pending; }
}
