/** Close the official model popup after activation without waiting for its remote write. */

/**
 * Leave submission, pending state, and failure toasts with the official component.
 * Mouse and keyboard activation both dispatch clicks on its option buttons.
 * @returns Remove the listener and invalidate any queued dismissal.
 */
export function dismissModelMenuOnSelection(): () => void {
  let disposed = false;
  const dismissals = new WeakMap<MouseEvent, () => void>();
  const activate = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const option = event.target.closest<HTMLButtonElement>('button[role="menuitemradio"]');
    if (!option || option.disabled || option.getAttribute('aria-disabled') === 'true') return;
    const menu = option.closest('[role="menu"]');
    if (!menu?.id) return;
    const trigger = [...document.querySelectorAll<HTMLButtonElement>(
      '[data-slot="conversation.input.model"] button[aria-haspopup="menu"][aria-expanded="true"]',
    )].find(button => button.getAttribute('aria-controls') === menu.id);
    if (!trigger) return;

    dismissals.set(event, () => {
      if (disposed || !menu.isConnected || !trigger.isConnected || trigger.disabled
        || trigger.getAttribute('aria-expanded') !== 'true') return;
      trigger.click();
    });
  };
  // Browser events can flush microtasks between listeners. Wait until the click
  // has bubbled through React before scheduling the trigger's close action.
  const afterActivation = (event: MouseEvent): void => {
    const dismiss = dismissals.get(event);
    if (dismiss) queueMicrotask(dismiss);
  };
  document.addEventListener('click', activate, true);
  document.addEventListener('click', afterActivation);
  return () => {
    disposed = true;
    document.removeEventListener('click', activate, true);
    document.removeEventListener('click', afterActivation);
  };
}
