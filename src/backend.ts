/** Launches only the official dsh profile and owns its child process lifetime. */
import { spawn, type ChildProcess } from 'node:child_process';
import { launchUrl, redact } from './protocol.ts';
import { findCli, findNode } from './runtime.ts';

/** Explicit settings for an owned official backend. */
export interface BackendOptions {
  cwd: string; harnessPath: string; binPath?: string; home: string; startupTimeoutSeconds: number;
}

/** One child launched through dsh; attached external backends never enter this class. */
export class Backend {
  private child?: ChildProcess;
  private done?: Promise<void>;
  private stopping?: Promise<void>;

  /** @param log - Receives credential-redacted diagnostics. @param exited - Reports the owned process exit. */
  constructor(private readonly log: (line: string) => void, private readonly exited?: () => void) {}

  /** @param options - Resolved launch settings. @returns Launch URL after the official server announces it. */
  async start(options: BackendOptions): Promise<string> {
    if (this.child) throw new Error('Backend already started');

    const cli = findCli(options.harnessPath, options.cwd, options.binPath);
    const node = await findNode();
    this.log(`cli: ${cli}`);
    this.log(`node: ${node.command} (${node.version})`);

    // The official Web profile binds an ephemeral loopback port and prints its
    // authenticated URL; `--no-open` keeps the server from launching a browser.
    const child = spawn(node.command, [cli, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: options.cwd, env: { ...process.env, ...(options.home ? { DSH_HOME: options.home } : {}) },
      shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;
    this.done = new Promise(resolve => child.once('close', () => { resolve(); this.exited?.(); }));

    try {
      return await new Promise<string>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new Error('Backend startup timed out; see the DeepSeek Harness output channel')), options.startupTimeoutSeconds * 1000);

        const finish = (value: string | Error): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (value instanceof Error) reject(value); else resolve(value);
        };

        child.on('error', error => finish(error));
        child.once('close', code => finish(new Error(`Backend exited (${String(code)}); see the DeepSeek Harness output channel`)));

        // Either stream can carry the announcement, so both are read line by line.
        for (const source of [child.stdout, child.stderr]) {
          let pending = '';
          source?.setEncoding('utf8');
          source?.on('data', (chunk: string) => {
            pending += chunk;
            let newline: number;
            while ((newline = pending.indexOf('\n')) >= 0) {
              // Strip ANSI color so the launch URL stays matchable.
              const line = pending.slice(0, newline).replace(/\u001b\[[0-9;]*m/g, '');
              pending = pending.slice(newline + 1);

              const match = /dsh web:\s+(http:\/\/[^\s]+\?token=[^\s]+)/.exec(line);
              if (match?.[1]) {
                try { finish(launchUrl(match[1]).href); } catch (error) { finish(error as Error); }
              }
              this.log(redact(line));
            }
            // Drop oversized unterminated diagnostics without printing partial secrets.
            if (pending.length > 128 * 1024) pending = '';
          });
        }
      });
    } catch (error) { await this.dispose(); throw error; }
  }

  /** Terminate the owned process tree and await its exit. */
  dispose(): Promise<void> {
    this.stopping ??= this.stop();
    return this.stopping;
  }

  private async stop(): Promise<void> {
    const child = this.child;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) { await this.done; return; }

    if (process.platform === 'win32') {
      // taskkill /t removes the whole tree: dsh can leave grandchildren behind.
      await new Promise<void>((resolve, reject) => {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.once('error', reject);
        killer.once('close', code => {
          if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
          else {
            try { process.kill(child.pid!, 0); }
            catch (error) {
              // taskkill can observe exit before Node dispatches this child's close event.
              if ((error as NodeJS.ErrnoException).code === 'ESRCH') { resolve(); return; }
            }
            reject(new Error(`Unable to stop backend process tree (${String(code)})`));
          }
        });
      });
    } else {
      // The child leads its own process group, so a negative pid signals the tree.
      const kill = (signal: NodeJS.Signals): void => {
        try { process.kill(-child.pid!, signal); } catch (error) {
          // The owned process group may have exited between the status check and kill.
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      };
      kill('SIGTERM');
      const force = setTimeout(() => kill('SIGKILL'), 5000);
      try { await this.done; } finally { clearTimeout(force); }
    }

    await this.done;
  }
}
