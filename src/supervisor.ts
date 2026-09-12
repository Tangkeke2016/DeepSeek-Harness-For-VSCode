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

async function main(): Promise<void> {
  const directory = process.argv[2];
  if (!directory || !process.argv[3]) throw new Error('Missing supervisor options');
  const options = JSON.parse(process.argv[3]) as BackendOptions;
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
    if (status.state === 'ready') { status.state = 'failed'; status.error = 'Official backend exited'; log(status.error); void stop?.(); }
  });
  let compromised = false;
  let stop: (() => Promise<void>) | undefined;
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(directory, { realpath: false, retries: 0, stale: 30000, update: 5000,
      onCompromised: error => { compromised = true; log(String(error)); void stop?.(); },
    });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ELOCKED') return; throw error; }
  const previous = await discovery(directory);
  if (previous && await probe(previous)) { await release(); return; }
  await writeFile(logPath, '', { mode: 0o600 });
  const token = randomBytes(32).toString('hex');
  const status: SharedStatus = { state: 'starting', cli: findCli(options.harnessPath, options.cwd), home: options.home };
  let startup: Promise<string> | undefined;
  let stopping: Promise<void> | undefined;
  const server = createServer((request, response) => {
    const provided = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { response.writeHead(403).end(); return; }
    if (request.url === '/status' && request.method === 'GET') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(status)); }
    else if (request.url === '/stop' && request.method === 'POST') {
      status.state = 'stopping';
      void (async () => {
        await startup?.catch(() => undefined);
        await backend.dispose(); response.end(JSON.stringify(status)); await stop?.();
      })().catch(error => { if (!response.writableEnded) response.writeHead(500).end(); log(String(error)); });
    } else response.writeHead(404).end();
  });
  stop = () => stopping ??= (async () => {
    status.state = 'stopping';
    await startup?.catch(() => undefined);
    await backend.dispose();
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const force = setTimeout(() => server.closeAllConnections(), 1000);
    try { await closed; } finally { clearTimeout(force); }
    const current = await discovery(directory);
    if (current?.token === token) await rm(join(directory, 'server.json'), { force: true });
    if (!compromised) await release();
    await writes;
  })();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing supervisor port');
    const temporary = join(directory, `${token}.tmp`);
    await writeFile(temporary, JSON.stringify({ version: 1, port: address.port, token }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(directory, 'server.json'));
    startup = backend.start(options);
    process.once('SIGTERM', () => { void stop?.(); });
    process.once('SIGINT', () => { void stop?.(); });
    status.url = await startup;
    if (stopping || status.state === 'stopping') return;
    status.state = 'ready';
  } catch (error) {
    status.state = 'failed'; status.error = redact(String(error)); log(status.error);
    setTimeout(() => { void stop?.(); }, 5000);
  }
}
void main().catch(() => { process.exitCode = 1; });
