/** Browser request deadlines exclude periods when the Webview can suspend JavaScript. */

/**
 * Start a deadline that only spends time while the page is visible: a hidden
 * Webview may suspend JavaScript, so hidden periods must not consume the budget.
 * @param expired - Failure callback while visible.
 * @param milliseconds - Visible wait budget after returning to the page.
 * @returns Cancellation that also removes the visibility listener.
 */
export function visibleDeadline(expired: () => void, milliseconds: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const cancel = (): void => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', watch);
  };

  const watch = (): void => {
    clearTimeout(timer);
    // Every visibility change restarts the budget; a hidden page stays paused.
    if (!stopped && !document.hidden) timer = setTimeout(() => {
      // The page can be hidden again while this timer is pending.
      if (document.hidden) return;
      cancel();
      expired();
    }, milliseconds);
  };

  document.addEventListener('visibilitychange', watch);
  watch();

  return cancel;
}
