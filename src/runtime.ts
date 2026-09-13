/** Locates the Node.js executable and the official CLI that launch an owned backend. */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, statSync, accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';

/** Lowest supported Node.js; the official packages declare `^22.19 || >=24`. */
const MINIMUM_MAJOR = 22;
const MINIMUM_MINOR = 19;
/** Relative CLI entries of a Harness installation: a built checkout, an installed package, a dependency. */
const CLI_ENTRIES = ['apps/cli/lib/bin.js', 'lib/bin.js', 'node_modules/@deepseek-ai/dsh/lib/bin.js'] as const;

/** One executable to try. */
export interface NodeCandidate {
  command: string;
}

/** The Node.js executable that launches the backend. */
export interface NodeRuntime {
  command: string;
  version: string;
}

/**
 * @param value - A configured path.
 * @returns The path with a leading `~` expanded to the user's home directory.
 */
export function expandHome(value: string): string {
  if (value === '~') return homedir();
  return /^~[/\\]/.test(value) ? join(homedir(), value.slice(2)) : value;
}

/**
 * @param version - `node -v` output, for example `v24.19.0`.
 * @returns Whether the official CLI runs on that Node.js.
 */
export function nodeSupported(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)(?:\.|$)/.exec(version.trim());
  if (!match) return false;
  const major = Number(match[1]);
  return major >= 24 || (major === MINIMUM_MAJOR && Number(match[2]) >= MINIMUM_MINOR);
}

/** Installation roots that hold a `node` executable directly. */
function installRoots(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const values = platform === 'win32'
    ? [env.ProgramFiles && join(env.ProgramFiles, 'nodejs'), env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'nodejs'),
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs/nodejs'), env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Volta/bin'),
      env.USERPROFILE && join(env.USERPROFILE, 'scoop/shims'), env.ProgramData && join(env.ProgramData, 'chocolatey/bin')]
    : ['/usr/local/bin', '/usr/bin', '/opt/homebrew/bin', '/snap/bin', '/opt/node/bin',
      join(homedir(), '.local/bin'), join(homedir(), '.volta/bin'), join(homedir(), '.local/share/fnm/aliases/default/bin')];
  return values.filter((value): value is string => Boolean(value));
}

/** Roots holding one child directory per installed version, newest name first. */
function versionRoots(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const roots = platform === 'win32'
    ? [env.APPDATA && join(env.APPDATA, 'nvm')]
    : [join(homedir(), '.nvm/versions/node'), join(homedir(), '.nodenv/versions')];
  const directories: string[] = [];
  for (const root of roots) {
    if (!root) continue;
    let versions: string[];
    // A version manager that is not installed owns no candidates.
    try { versions = readdirSync(root); } catch { continue; }
    for (const version of versions.sort().reverse()) directories.push(platform === 'win32' ? join(root, version) : join(root, version, 'bin'));
  }
  return directories;
}

/**
 * Node.js executables to try, in the order a terminal on this machine would
 * resolve them: the host PATH, the platform's installation roots, every
 * version-managed installation, and last the Extension Host's own Node.
 *
 * A desktop Extension Host is Electron, whose executable is not a Node CLI, so
 * it is offered only when the host process is Node itself — every remote, WSL
 * and container Extension Host.
 * @param env - Environment supplying PATH and the platform's installation roots.
 * @param platform - `process.platform` of the machine that runs the backend.
 * @param host - `process.execPath` of the Extension Host.
 * @param electron - Whether the Extension Host runs on Electron.
 * @returns Candidate commands, most preferred first, duplicates removed.
 */
export function nodeCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, host: string, electron: boolean): NodeCandidate[] {
  const name = platform === 'win32' ? 'node.exe' : 'node';
  const directories = [...(env.PATH ?? '').split(delimiter).filter(directory => directory.trim()), ...installRoots(env, platform), ...versionRoots(env, platform)];
  const candidates: NodeCandidate[] = directories.map(directory => ({ command: join(directory, name) }));
  if (!electron) candidates.push({ command: host });
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = platform === 'win32' ? candidate.command.toLowerCase() : candidate.command;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param candidate - One executable. @returns Its `-v` output, or undefined when it is not a working Node.js. */
function versionOf(candidate: NodeCandidate): Promise<string | undefined> {
  return new Promise(done => {
    execFile(candidate.command, ['-v'], { timeout: 15_000, windowsHide: true }, (error, stdout) => {
      done(error ? undefined : stdout.trim() || undefined);
    });
  });
}

/**
 * Pick the Node.js that launches the backend.
 *
 * Every candidate that exists is asked for its version, so an old system
 * Node.js never shadows a newer one later in the list.
 * @param candidates - Ordered executables.
 * @returns The first executable the official CLI supports.
 */
export async function pickNode(candidates: readonly NodeCandidate[]): Promise<NodeRuntime> {
  const rejected: string[] = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate.command)) continue;
    const version = await versionOf(candidate);
    if (version === undefined) continue;
    if (nodeSupported(version)) return { command: candidate.command, version };
    rejected.push(`${candidate.command} (${version})`);
  }
  const found = rejected.length ? ` Found ${rejected.join(', ')}.` : '';
  throw new Error(`Node.js 22.19+ (22.x) or 24+ is required to launch the Harness.${found} Install Node.js and make sure it is on PATH.`);
}

/** @returns The Node.js of this machine that launches the backend. */
export function findNode(): Promise<NodeRuntime> {
  return pickNode(nodeCandidates(process.env, process.platform, process.execPath, process.versions.electron !== undefined));
}

/**
 * Locate the official CLI entry.
 *
 * A configured Harness location is authoritative: when it holds no built CLI
 * this fails instead of silently launching a different installation.
 * @param harnessPath - Configured Harness installation directory; empty discovers one.
 * @param cwd - Workspace folder used for discovery.
 * @param binPath - Explicit official bin.js path; takes precedence over the directory.
 * @returns Absolute path of the official `lib/bin.js` entry.
 */
export function findCli(harnessPath: string, cwd: string, binPath = ''): string {
  if (binPath.trim()) {
    const file = expandHome(binPath.trim());
    if (!isAbsolute(file) || basename(file) !== 'bin.js') throw new Error('binPath must be an absolute path to the official bin.js');
    if (!statSync(file).isFile()) throw new Error('binPath must be a file');
    accessSync(file, constants.R_OK);
    return file;
  }
  const configured = harnessPath.trim();
  if (configured) {
    const root = expandHome(configured);
    if (!isAbsolute(root)) throw new Error('deepseekHarness.harnessPath must be an absolute directory path');
    const located = CLI_ENTRIES.map(entry => join(root, entry)).find(file => existsSync(file) && statSync(file).isFile());
    if (!located) throw new Error(`deepseekHarness.harnessPath holds no built Harness CLI (expected ${CLI_ENTRIES.join(', ')}): ${root}`);
    accessSync(located, constants.R_OK);
    return located;
  }
  const candidates = [join(cwd, CLI_ENTRIES[0])];
  try {
    const req = createRequire(join(cwd, 'package.json'));
    candidates.push(join(dirname(req.resolve('@deepseek-ai/dsh/package.json')), 'lib/bin.js'));
  } catch (error) {
    // A workspace without dsh installed can still use a global npm installation.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;
  }
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    candidates.push(join(directory, CLI_ENTRIES[2]));
    candidates.push(resolve(directory, '../lib/node_modules/@deepseek-ai/dsh/lib/bin.js'));
  }
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Official Harness not found. Set deepseekHarness.harnessPath to the Harness installation directory.');
  if (!statSync(found).isFile()) throw new Error('Official Harness CLI must be a file');
  accessSync(found, constants.R_OK);
  return found;
}
