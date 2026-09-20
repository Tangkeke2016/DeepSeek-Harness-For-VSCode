/** Optional DSH profile plugin: claim quiescent Agents before a workspace handoff. */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

interface Agent {
  status: string;
  session: unknown;
  inbox: { nextTurn: readonly unknown[]; nextStep: readonly unknown[] };
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
}
interface GuardContext {
  agents: { list(): Agent[] };
  jobs: { list(agent?: Agent): { status: string }[] };
  sessionProjections: { snapshot(session: unknown): { values: Record<string, unknown> } };
  effect(start: () => () => Promise<void>, label: string): void;
}
interface Config { supervisor: string; token: string }

/** Cordis plugin identity. */
export const name = 'vscode-workspace-idle-guard';
/** Services whose absence disables handoff rather than guessing that the process is idle. */
export const inject = ['agents', 'jobs', 'sessionProjections'];

/** Synchronously hold every known Agent's maintenance phase, or release all claims.
 * @param ctx - DSH services, supplied by the official profile.
 * @returns Release when idle; undefined for busy or unsupported runtimes.
 */
export function claimIdle(ctx: GuardContext): (() => void) | undefined {
  const agents = ctx.agents.list();
  const jobs = [undefined, ...agents].flatMap(agent => ctx.jobs.list(agent));
  if (jobs.some(job => job.status !== 'completed' && job.status !== 'killed' && job.status !== 'failed')) return;
  for (const agent of agents) {
    if (agent.status !== 'idle' || !agent.inbox || agent.inbox.nextTurn.length || agent.inbox.nextStep.length
      || typeof agent.runMaintenance !== 'function') return;
    const schedule = ctx.sessionProjections.snapshot(agent.session).values.schedule;
    // Unknown projection formats never authorize stopping a scheduled backend.
    if (schedule !== undefined && (!Array.isArray(schedule) || schedule.length > 0)) return;
  }
  const releases: (() => void)[] = [];
  const release = (): void => { for (const finish of releases) finish(); };
  try {
    for (const agent of agents) {
      // A synchronous refusal also detects maintenance that public status hides.
      const held = agent.runMaintenance(signal => new Promise<void>(resolve => {
        const finish = (): void => { signal.removeEventListener('abort', finish); resolve(); };
        releases.push(finish);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      }));
      void held.catch(release);
    }
    return release;
  } catch (error) {
    // Failure to claim even one Agent keeps the entire backend alive.
    release();
    return undefined;
  }
}

/** Register a private handoff endpoint without modifying the official DSH implementation.
 * @param ctx - Official Cordis context.
 * @param config - Private supervisor address and authentication secret.
 */
export function apply(ctx: GuardContext, config: Config): void {
  const supervisor = new URL(config.supervisor);
  if (supervisor.protocol !== 'http:' || supervisor.hostname !== '127.0.0.1'
    || !/^[a-f0-9]{64}$/.test(config.token)) throw new Error('Invalid workspace supervisor configuration');
  ctx.effect(() => {
    let release: (() => void) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const server = createServer((request, response) => {
      const provided = Buffer.from(request.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${config.token}`);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        response.writeHead(403).end(); return;
      }
      if (request.method !== 'POST' || request.url !== '/claim') { response.writeHead(404).end(); return; }
      try {
        if (!release) release = claimIdle(ctx);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ idle: release !== undefined }));
        if (release) {
          clearTimeout(timeout);
          // A failed handoff must not leave the Agent permanently paused.
          timeout = setTimeout(() => { release?.(); release = undefined; }, 15000);
        }
      } catch (error) { response.writeHead(503).end(); }
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return;
      void fetch(new URL('/guard', supervisor), {
        method: 'POST', headers: { authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ port: address.port }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      }).then(response => response.body?.cancel()).catch(error => {
        // Missing registration disables handoff; normal conversations still work.
        if (!controller.signal.aborted) console.error('VS Code workspace handoff registration failed');
      });
    });
    server.on('error', () => { release?.(); release = undefined; });
    return async () => {
      controller.abort(); clearTimeout(timeout); release?.();
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    };
  }, 'vscode-workspace-idle-guard');
}
