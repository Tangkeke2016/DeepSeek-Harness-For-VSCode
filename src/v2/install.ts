/** Installs the official npm distribution on the Extension Host machine. */
import { spawn, execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { launchUrl, redact } from '../protocol.ts';

/** A complete installed DSH package and its launch entry. */
export interface InstalledHarness { root: string; bin: string; version: string }

/** @param node - Supported Node executable. @returns The npx CLI shipped beside that Node installation. */
export async function findNpx(node: string): Promise<string> {
  const directories = new Set([dirname(node), dirname(await realpath(node))]);
  for (const directory of directories) {
    for (const candidate of [join(directory, 'node_modules/npm/bin/npx-cli.js'), resolve(directory, '../lib/node_modules/npm/bin/npx-cli.js')]) {
      try { await access(candidate); return candidate; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  throw new Error('npx is unavailable beside Node.js. Install Node.js with npm, or select an existing DSH folder.');
}

/**
 * @param node - Supported Node executable, also used by npx lifecycle scripts.
 * @param npx - npx CLI JavaScript entry.
 * @param target - Extension-owned installation directory, separate from the workspace.
 * @param signal - Cancels installation and its bootstrap process tree.
 * @param output - Receives credential-redacted progress and diagnostics.
 * @param timeoutMs - Installation and bootstrap deadline in milliseconds.
 * @returns Installed official paths after Web startup and bootstrap shutdown.
 */
export async function installHarness(node: string, npx: string, target: string, signal: AbortSignal, output: (text: string) => void, timeoutMs: number): Promise<InstalledHarness> {
  signal.throwIfAborted();
  await mkdir(target, { recursive: true });
  const attempt = await mkdtemp(join(target, 'bootstrap-'));
  await writeFile(join(attempt, 'package.json'), JSON.stringify({ name: 'dsh-vscode-bootstrap', version: '0.0.0', private: true }));
  const cache = join(attempt, 'npm-cache');
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (/KEY|SECRET|TOKEN|PASSWORD/i.test(name) || ['npm_config_cache', 'npm_config_yes', 'npm_config_prefix', 'dsh_home'].includes(name.toLowerCase())) delete env[name];
  }
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = dirname(node) + delimiter + (env[pathKey] ?? '');
  env.npm_config_cache = cache;
  env.npm_config_yes = 'true';
  env.npm_config_prefix = attempt;
  env.DSH_HOME = join(attempt, 'bootstrap-home');
  await new Promise<void>((done, fail) => {
    const child = spawn(node, [npx, '@deepseek-ai/dsh', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], {
      cwd: attempt, env, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    let error: Error | undefined;
    let ready = false;
    let stopping: Promise<void> | undefined;
    const stop = (): void => {
      if (stopping || !child.pid || child.exitCode !== null) return;
      const pid = child.pid;
      stopping = process.platform === 'win32' ? new Promise<void>((resolveStop, rejectStop) => {
        execFile('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, failure => {
          if (failure && child.exitCode === null && child.signalCode === null) rejectStop(failure); else resolveStop();
        });
      }) : new Promise<void>((resolveStop, rejectStop) => {
        try { process.kill(-pid, 'SIGKILL'); resolveStop(); }
        catch (failure) { if ((failure as NodeJS.ErrnoException).code === 'ESRCH') resolveStop(); else rejectStop(failure); }
      });
      void stopping.catch(failure => { error = failure as Error; child.kill(); });
    };
    const timer = setTimeout(() => { error = new Error('Official DSH installation timed out'); stop(); }, timeoutMs);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.on('error', failure => { error = failure; });
    for (const stream of [child.stdout, child.stderr]) {
      let buffered = '';
      stream.setEncoding('utf8');
      stream.on('data', (data: string) => {
        buffered += data;
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          output(redact(line));
          for (const match of line.matchAll(/http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/\?token=[^\s"'<>]+/g)) {
            try { launchUrl(match[0]); }
            catch (failure) { output(String(failure)); continue; }
            ready = true; stop();
          }
        }
        if (buffered.length > 65536) buffered = buffered.slice(-65536);
      });
      stream.on('end', () => { if (buffered) output(redact(buffered)); });
    }
    child.once('close', (code, killedBy) => {
      clearTimeout(timer); signal.removeEventListener('abort', stop);
      void Promise.resolve(stopping).then(() => {
        if (signal.aborted) fail(signal.reason);
        else if (error) fail(error);
        else if (!ready) fail(new Error(`npx DSH bootstrap failed (${killedBy ?? code}); see Output > DeepSeek Harness`));
        else done();
      }, fail);
    });
  });
  signal.throwIfAborted();
  const packages: InstalledHarness[] = [];
  for (const entry of await readdir(join(cache, '_npx'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const root = join(cache, '_npx', entry.name, 'node_modules/@deepseek-ai/dsh');
    let source: string;
    try { source = await readFile(join(root, 'package.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const metadata = JSON.parse(source) as { name?: unknown; version?: unknown };
    if (metadata.name !== '@deepseek-ai/dsh' || typeof metadata.version !== 'string') throw new Error('Installed package is not the official DSH distribution');
    const bin = join(root, 'lib/bin.js'); await access(bin);
    packages.push({ root, bin, version: metadata.version });
  }
  if (packages.length !== 1) throw new Error('Unable to identify the DSH installation created by npx');
  return packages[0]!;
}
