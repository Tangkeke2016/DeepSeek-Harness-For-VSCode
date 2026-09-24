/** Stops one session's pending and active work before hiding it from history. */

interface Result { ok: boolean; error?: { code: string; message: string } }

/** Pending agent input, split by when the agent consumes it. */
interface InboxState { 'next-turn'?: readonly { id: string }[]; 'next-step'?: readonly { id: string }[] }

/** Official client operations used by the history delete action. */
export interface DeletableSession {
  getSnapshot(): { running: boolean; queue?: readonly { id: string }[] };
  /** Session projections; pending input lives here since the snapshot dropped its own queue. */
  readonly projections?: { faceOf(name: 'inbox'): { getSnapshot(): unknown } };
  updateQueue(id: string, action: { kind: 'remove' }): Promise<Result>;
  cancel(): Promise<Result>;
}

/**
 * Stop everything one session may still run, then archive it.
 *
 * Archiving comes last: a session that still owned queued or running work would
 * keep producing events after it disappeared from history.
 * @param session - Loaded binding of the selected row, absent for unopened history.
 * @param archive - Official history archival operation, including host-owned activity handling.
 * @returns Completion after pending work is removed and cancellation acknowledged.
 */
export async function deleteSession(session: DeletableSession | undefined, archive: () => Promise<void>): Promise<void> {
  // History summaries outlive client bindings; archival is addressed by session ID.
  if (!session) { await archive(); return; }
  const check = (result: Result): void => {
    if (!result.ok) throw new Error(result.error?.message ?? 'Session operation failed');
  };

  // Current backends expose pending input through the inbox projection; the
  // session snapshot carried its own queue before that move.
  const snapshot = session.getSnapshot();
  const inbox = session.projections?.faceOf('inbox').getSnapshot() as InboxState | undefined;
  const pending = snapshot.queue ?? [...(inbox?.['next-turn'] ?? []), ...(inbox?.['next-step'] ?? [])];
  for (const item of pending) {
    const result = await session.updateQueue(item.id, { kind: 'remove' });

    // A queued turn can start between observing the row and removing it; cancellation below covers it.
    if (!result.ok && result.error?.code === 'session/queue-item-not-found') continue;
    check(result);
  }

  if (pending.length || snapshot.running) check(await session.cancel());
  await archive();
}
