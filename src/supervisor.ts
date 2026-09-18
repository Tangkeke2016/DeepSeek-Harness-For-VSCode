/** Detached owner of the unchanged official dsh Web process. */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFile, rename, rm, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { Backend, type BackendOptions } from './backend.ts';
import { discovery, probe, type SharedStatus } from './shared-backend.ts';
import { redact } from './protocol.ts';
import { findCli } from './runtime.ts';

/**
 * Own the official Web server for one user until an explicit stop.
 *
 * The supervisor is spawned detached by SharedBackend and outlives every VS Code
 * window, so its only teardown paths are the `/stop` control route, a signal, or
 * a backend that exited on its own.
 */
async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory || !process.argv[3]) throw new Error('Missing supervisor options');
  const options = JSON.parse(process.argv[3]) as BackendOptions;

  // Keep a bounded, credential-redacted log beside the discovery record.
  const logPath = join(directory, 'supervisor.log');
  let logBytes = 0;
  let writes = Promise.resolve();
  const log = (line: string): void => {
    const text = `${new Date().toISOString()} ${redact(line)}\n`;
    if (logBytes + Buffer.byteLength(text) > 1024 * 1024) return;
    logBytes += Buffer.byteLength(text);
    writes = writes.then(() => appendFile(logPath, text, { mode: 0o600 }));
    void writes.catch(() => { /* Logging failure does not change backend ownership. */ });
  };

  const backend = new Backend(log, () => {
    // The owned backend exiting on its own ends this supervisor's reason to live.
    if (status.state === 'ready') { status.state = 'failed'; status.error = 'Official backend exited'; log(status.error); void stop?.(); }
  });
  let compromised = false;
  let stop: (() => Promise<void>) | undefined;
  let release: () => Promise<void>;

  // One supervisor per directory: a second launch finds the lock held and exits.
  try {
    release = await lockfile.lock(directory, { realpath: false, retries: 0, stale: 30000, update: 5000,
      onCompromised: error => { compromised = true; log(String(error)); void stop?.(); },
    });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ELOCKED') return; throw error; }

  // An older supervisor that still answers keeps ownership of the directory.
  const previous = await discovery(directory);
  if (previous && await probe(previous)) { await release(); return; }

  await writeFile(logPath, '', { mode: 0o600 });
  const token = randomBytes(32).toString('hex');
  const status: SharedStatus = { state: 'starting', cli: findCli(options.harnessPath, options.cwd, options.binPath), home: options.home };
  let startup: Promise<string> | undefined;
  let stopping: Promise<void> | undefined;

  // The control server is the only interface clients use; every route requires the token.
  const server = createServer((request, response) => {
    const provided = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { response.writeHead(403).end(); return; }

    if (request.url === '/status' && request.method === 'GET') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(status));
    } else if (request.url === '/stop' && request.method === 'POST') {
      status.state = 'stopping';
      void (async () => {
        // Answer only after the owned tree is gone, so the caller can trust the stop.
        await startup?.catch(() => undefined);
        await backend.dispose();
        response.end(JSON.stringify(status));
        await stop?.();
      })().catch(error => { if (!response.writableEnded) response.writeHead(500).end(); log(String(error)); });
    } else response.writeHead(404).end();
  });

  stop = () => stopping ??= (async () => {
    status.state = 'stopping';
    await startup?.catch(() => undefined);
    await backend.dispose();

    // Stop accepting connections, then close the listeners that remain.
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const force = setTimeout(() => server.closeAllConnections(), 1000);
    try { await closed; } finally { clearTimeout(force); }

    // Remove only this supervisor's own discovery record.
    const current = await discovery(directory);
    if (current?.token === token) await rm(join(directory, 'server.json'), { force: true });
    if (!compromised) await release();
    await writes;
  })();

  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing supervisor port');

    // Publish atomically so a reader never sees a partial discovery record.
    const temporary = join(directory, `${token}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: 1, port: address.port, token }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(directory, 'server.json'));

    startup = backend.start(options);
    process.once('SIGTERM', () => { void stop?.(); });
    process.once('SIGINT', () => { void stop?.(); });

    status.url = await startup;
    // A stop requested during startup already tears the supervisor down.
    if (stopping || status.state === 'stopping') return;
    status.state = 'ready';
  } catch (error) {
    // Stay reachable briefly so a client can read the failure before teardown.
    status.state = 'failed';
    status.error = redact(String(error));
    log(status.error);
    setTimeout(() => { void stop?.(); }, 5000);
  }
}

void main().catch(() => { process.exitCode = 1; });
