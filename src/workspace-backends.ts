/** Workspace discovery stays on the extension host, including Remote SSH hosts. */
import { createHash } from 'node:crypto';
import { realpath, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { discovery, probe, stopSupervisor, SharedBackend } from './shared-backend.ts';
import type { BackendOptions } from './backend.ts';

/** @param cwd - Selected workspace directory. @returns Stable key across symlinks and Windows case. */
export async function workspaceKey(cwd: string): Promise<string> {
  const path = await realpath(resolve(cwd));
  return createHash('sha256').update(process.platform === 'win32' ? path.toLowerCase() : path).digest('hex');
}

/** One pool per host user; stopped or unreachable records never count as live backends. */
export class WorkspaceBackends {
  private readonly clients = new Map<string, SharedBackend>();
  private selected?: string;

  /** @param root - Private discovery root. @param program - Supervisor bundle. @param log - Diagnostics.
   * @param windowId - VS Code session identity, retained when a window changes folders.
   */
  constructor(
    private readonly root: string,
    private readonly program: string,
    private readonly log: (line: string) => void,
    private readonly windowId?: string,
  ) {}

  /** @param options - Workspace and runtime settings. @returns Its existing or newly launched backend. */
  async connect(options: BackendOptions): Promise<string> {
    const legacy = await discovery(this.root);
    if (legacy && await probe(legacy)) throw new Error('legacy-workspace-backend');
    options = { ...options, cwd: await realpath(options.cwd) };
    const previous = this.selected ?? await this.previousWorkspace();
    if (previous && previous !== options.cwd) {
      try { await this.switchWorkspace(previous, options.cwd); }
      catch (error) { this.log(`Previous workspace retained: ${String(error)}`); }
    }
    this.selected = options.cwd;
    const key = await workspaceKey(options.cwd);
    let client = this.clients.get(key);
    if (!client) {
      client = new SharedBackend(join(this.root, 'workspaces', key), this.program, this.log);
      this.clients.set(key, client);
    }
    try {
      const url = await client.start(options);
      if (this.windowId) {
        await mkdir(join(this.root, 'windows'), { recursive: true, mode: 0o700 });
        await writeFile(this.windowFile(), options.cwd, { mode: 0o600 });
      }
      return url;
    }
    catch (error) {
      if (this.clients.get(key) === client) this.clients.delete(key);
      throw error;
    }
  }

  private windowFile(): string {
    return join(this.root, 'windows', createHash('sha256').update(this.windowId!).digest('hex'));
  }

  private async previousWorkspace(): Promise<string | undefined> {
    if (!this.windowId) return undefined;
    try { return await readFile(this.windowFile(), 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  /** Forget local URLs after a transport loss without terminating the shared process.
   * @param cwd - Workspace whose next connection must rediscover its supervisor.
   */
  async invalidate(cwd: string): Promise<void> {
    this.clients.delete(await workspaceKey(cwd));
  }

  /** @param cwd - Connected workspace. @param lost - Unexpected supervisor disconnection.
   * @returns Release of this view's connection count, without stopping its backend.
   */
  async lease(cwd: string, lost: (stopped: boolean) => void): Promise<() => Promise<void>> {
    const client = this.clients.get(await workspaceKey(cwd));
    if (!client) throw new Error('Workspace backend is not connected');
    return client.lease(lost);
  }

  /** @param cwd - Workspace directory. @returns Private supervisor control endpoint. */
  async control(cwd: string) {
    return discovery(join(this.root, 'workspaces', await workspaceKey(cwd)));
  }

  /** @returns Ready workspaces whose pages can survive an extension host restart. */
  async retainedWorkspaces(): Promise<string[]> {
    let entries: string[];
    try { entries = await readdir(join(this.root, 'workspaces')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const results = await Promise.all(entries.filter(key => /^[a-f0-9]{64}$/.test(key)).map(async key => {
      const target = await discovery(join(this.root, 'workspaces', key));
      const status = target && await probe(target);
      return status?.state === 'ready' && status.pageRelay === 1 ? status.cwd : undefined;
    }));
    return results.filter((cwd): cwd is string => typeof cwd === 'string');
  }

  /** @param cwd - Workspace opened in VS Code. @returns Whether a supervisor already answers. */
  async exists(cwd: string): Promise<boolean> {
    const target = await discovery(join(this.root, 'workspaces', await workspaceKey(cwd)));
    const status = target && await probe(target);
    return status?.state === 'ready' || status?.state === 'starting';
  }

  /** Stop the previous workspace only for an explicit directory change with no other views or work.
   * @param previous - Workspace being left.
   * @param next - Newly selected workspace; an existing owner takes priority.
   * @returns Whether the previous process was stopped for a clean restart.
   */
  async switchWorkspace(previous: string, next: string): Promise<boolean> {
    const key = await workspaceKey(previous);
    if (key === await workspaceKey(next) || await this.exists(next)) return false;
    const target = await discovery(join(this.root, 'workspaces', key));
    if (!target) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${target.port}/stop-idle`, {
        method: 'POST', headers: { authorization: `Bearer ${target.token}` }, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) { await response.body?.cancel(); return false; }
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('stopped' in result) || result.stopped !== true) return false;
      this.clients.delete(key);
      return true;
    } catch (error) {
      this.log(`Previous workspace retained: ${String(error)}`);
      return false;
    }
  }

  /** Stop only extension-owned supervisors, including ones started by other windows.
   * @param cwd - One workspace, or omitted for every workspace on this host.
   * @returns Completion after all selected supervisors acknowledge shutdown.
   */
  async stop(cwd?: string): Promise<void> {
    const keys = cwd ? [await workspaceKey(cwd)] : await this.keys();
    const directories = keys.map(key => join(this.root, 'workspaces', key));
    // The old per-user supervisor remains explicitly stoppable during upgrades.
    if (!cwd) directories.push(this.root);
    const results = await Promise.allSettled(directories.map(async directory => {
      const target = await discovery(directory);
      if (target) await stopSupervisor(target);
    }));
    for (const key of keys) this.clients.delete(key);
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Unable to stop every selected backend');
  }

  private async keys(): Promise<string[]> {
    try {
      return (await readdir(join(this.root, 'workspaces'), { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name))
        .map(entry => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}
