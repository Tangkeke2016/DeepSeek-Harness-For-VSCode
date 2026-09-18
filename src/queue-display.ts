/** Defers a newly mounted queue dock without delaying message submission. */

/**
 * @param delayMs - How long a queue must remain mounted before occupying space; zero shows it immediately.
 * @returns A disposer that cancels pending reveals and restores official visibility.
 */
export function settleQueueDisplay(delayMs: number): () => void {
  if (delayMs === 0) return () => {};

  const pending = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const revealed = new Set<HTMLElement>();
  document.body.setAttribute('data-vscode-queue-settling', '');

  const scan = (): void => {
    const docks = new Set(document.querySelectorAll<HTMLElement>('[data-queue-dock]'));

    // Forget docks the official UI removed, including timers still waiting on them.
    for (const [dock, timer] of pending) if (!docks.has(dock)) { clearTimeout(timer); pending.delete(dock); }
    for (const dock of revealed) if (!docks.has(dock)) { dock.removeAttribute('data-vscode-queue-ready'); revealed.delete(dock); }

    for (const dock of docks) {
      if (pending.has(dock) || revealed.has(dock)) continue;
      pending.set(dock, setTimeout(() => {
        pending.delete(dock);
        // A dock may disappear while its delay is still running.
        if (!dock.isConnected) return;
        dock.setAttribute('data-vscode-queue-ready', '');
        revealed.add(dock);
      }, delayMs));
    }
  };

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  return () => {
    observer.disconnect();
    for (const timer of pending.values()) clearTimeout(timer);
    for (const dock of revealed) dock.removeAttribute('data-vscode-queue-ready');
    pending.clear(); revealed.clear();
    document.body.removeAttribute('data-vscode-queue-settling');
  };
}
