/** Browser request deadlines exclude periods when the Webview can suspend JavaScript. */
/** @param expired - Failure callback while visible. @param milliseconds - Visible wait budget after returning to the page. @returns Cancellation that also removes the visibility listener. */
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
    if (!stopped && !document.hidden) timer = setTimeout(() => {
      if (document.hidden) return;
      cancel(); expired();
    }, milliseconds);
  };
  document.addEventListener('visibilitychange', watch);
  watch();
  return cancel;
}
