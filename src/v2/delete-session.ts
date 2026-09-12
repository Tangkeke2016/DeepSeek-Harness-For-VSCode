/** Stops one session's pending and active work before hiding it from history. */
interface Result { ok: boolean; error?: { code: string; message: string } }
/** Official client operations used by the history delete action. */
export interface DeletableSession {
  getSnapshot(): { running: boolean; queue: readonly { id: string }[] };
  updateQueue(id: string, action: { kind: 'remove' }): Promise<Result>;
  cancel(): Promise<Result>;
}
/** @param session - Binding of the selected row, independent of the active editor. @param archive - Official history archival operation. @returns Completion after pending work is removed and cancellation acknowledged. */
export async function deleteSession(session: DeletableSession, archive: () => Promise<void>): Promise<void> {
  const check = (result: Result): void => { if (!result.ok) throw new Error(result.error?.message ?? 'Session operation failed'); };
  const pending = session.getSnapshot().queue;
  for (const item of pending) {
    const result = await session.updateQueue(item.id, { kind: 'remove' });
    // A queued turn can start between observing the row and removing it; cancellation below covers it.
    if (!result.ok && result.error?.code === 'session/queue-item-not-found') continue;
    check(result);
  }
  if (pending.length || session.getSnapshot().running) check(await session.cancel());
  await archive();
}
