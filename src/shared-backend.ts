/** Authenticated discovery of the user's detached Harness supervisor. */
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { findCli, findNode } from './runtime.ts';
import { launchUrl, record } from './protocol.ts';
import type { BackendOptions } from './backend.ts';

/** Private discovery information written by the supervisor. */
export interface Discovery { version: 1; port: number; token: string }
/** Live supervisor status; credentials never cross into the Webview. */
export interface SharedStatus { state: 'starting' | 'ready' | 'failed' | 'stopping'; cli: string; home: string; url?: string; error?: string }

/** @param directory - Per-user private state directory. @returns Discovery record, or absence when unpublished. */
export async function discovery(directory: string): Promise<Discovery | undefined> {
  let source: string;
  try { source = await readFile(join(directory, 'server.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }

  // The record is written by another process, so every field is validated.
  const value = record(JSON.parse(source));
  if (value.version !== 1 || !Number.isInteger(value.port) || Number(value.port) < 1 || Number(value.port) > 65535 || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error('Invalid shared backend discovery record');
  return value as unknown as Discovery;
}

/** @param target - Authenticated loopback endpoint. @param stop - Whether to stop the shared backend. @returns Live status, or absence on connection failure. */
export async function probe(target: Discovery, stop = false): Promise<SharedStatus | undefined> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${target.port}/${stop ? 'stop' : 'status'}`, {
      method: stop ? 'POST' : 'GET', headers: { authorization: `Bearer ${target.token}` }, signal: AbortSignal.timeout(stop ? 15000 : 1500),
    });
  } catch { /* A dead supervisor or unavailable loopback listener has no live status. */ return undefined; }

  if (!response.ok) throw new Error(`Shared backend authentication/status failed (${response.status})`);

  // An authenticated response is still untrusted: the port could belong to another process.
  const value = record(await response.json());
  if (!['starting', 'ready', 'failed', 'stopping'].includes(String(value.state)) || typeof value.cli !== 'string' || typeof value.home !== 'string') throw new Error('Invalid shared backend status');
  if (value.url !== undefined) launchUrl(String(value.url));
  return value as unknown as SharedStatus;
}

/** Each instance attaches to the same per-user supervisor; closing a client does not stop it. */
export class SharedBackend {
  private target?: Discovery;
  private pending?: Promise<string>;

  /** @param directory - Stable per-user directory. @param supervisor - Bundled supervisor program. @param log - Credential-free diagnostics. */
  constructor(private readonly directory: string, private readonly supervisor: string, private readonly log: (line: string) => void) {}

  /** @param options - Official profile settings. @returns Existing or newly started server's launch URL. */
  start(options: BackendOptions): Promise<string> {
    return this.pending ??= this.connect(options);
  }

  private async connect(options: BackendOptions): Promise<string> {
    const cli = findCli(options.harnessPath, options.cwd, options.binPath);
    const home = resolve(options.cwd, options.home);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });

    const deadline = Date.now() + options.startupTimeoutSeconds * 1000;
    let spawned = false;
    let childAlive = false;
    let nextSpawn = 0;
    let spawnError: Error | undefined;

    // Poll for the supervisor another window may already own; start one only when
    // none answers, and never wait longer than the configured timeout.
    while (Date.now() < deadline) {
      const target = await discovery(this.directory);
      const status = target && await probe(target);
      if (status) {
        this.target = target;

        // A shared supervisor serves one harnessPath/home pair for its whole lifetime.
        if (status.cli !== cli || status.home !== home) throw new Error('A shared Harness is already running with another harnessPath/home. Stop it explicitly before changing those settings.');
        if (status.state === 'ready' && status.url) {
          this.log(`Shared backend ${spawned ? 'connected' : 'reused'} (${Date.now() - (deadline - options.startupTimeoutSeconds * 1000)} ms)`);
          return status.url;
        }
        if (status.state === 'failed') throw new Error(status.error ?? 'Shared backend startup failed');
      } else if (!childAlive && Date.now() >= nextSpawn) {
        // Spawn detached: the supervisor outlives this Extension Host and every window.
        const node = await findNode();
        const child = spawn(node.command, [this.supervisor, this.directory, JSON.stringify({ ...options, home })], {
          cwd: options.cwd, detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
        });
        childAlive = true; nextSpawn = Date.now() + 1000;
        child.once('error', error => { spawnError = error; childAlive = false; });
        child.once('exit', () => { childAlive = false; });
        child.unref();
        spawned = true;
      }

      if (spawnError) throw spawnError;
      await delay(100);
    }

    throw new Error(`Shared backend startup timed out; inspect ${join(this.directory, 'supervisor.log')}`);
  }

  /** Explicitly stop the server shared by this user's windows. */
  async dispose(): Promise<void> {
    // A failed startup may still have published a supervisor that must be stopped.
    if (this.pending) { try { await this.pending; } catch { /* Failed startup may still have published a supervisor to stop. */ } }
    const target = this.target ?? await discovery(this.directory);
    if (target && !await probe(target, true)) throw new Error('Shared backend did not acknowledge stop; inspect supervisor.log');
  }
}
