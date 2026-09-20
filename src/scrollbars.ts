/** Reveal conversation scrollbar thumbs without changing the scroll gutter. */

/** Time a revealed thumb stays visible after the last input. */
const HIDE_MS = 1200;
/** Window in which a scroll event still counts as following real input. */
const INTENT_MS = 400;
/** Narrowest gutter band, in CSS pixels, that counts as the scrollbar area. */
const MIN_GUTTER_PX = 8;
/** Keys whose default action scrolls the focused container. */
const SCROLL_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
]);
/** Elements that consume typing keys instead of scrolling. */
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
/** Keys a text control consumes for its own caret and content. */
const EDITING_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', ' ', 'Spacebar',
]);

/** @returns Disposal of listeners, timers and presentation attributes. */
export function autoHideScrollbars(): () => void {
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  let near: HTMLElement | undefined;
  /** Last input that really scrolled a conversation; reflow fires scroll too. */
  let gestureAt = Number.NEGATIVE_INFINITY;

  const leave = (): void => {
    near?.removeAttribute('data-vscode-scrollbar-near');
    near = undefined;
  };

  const reveal = (scroll: HTMLElement): void => {
    clearTimeout(timers.get(scroll));
    scroll.setAttribute('data-vscode-scrollbar-active', '');
    timers.set(scroll, setTimeout(() => {
      scroll.removeAttribute('data-vscode-scrollbar-active');
      timers.delete(scroll);
    }, HIDE_MS));
  };

  const container = (target: EventTarget | null): HTMLElement | null =>
    target instanceof Element ? target.closest<HTMLElement>('[data-conversation-scroll]') : null;

  /** Record real input and reveal the scrollport it acts on. */
  const gesture = (scroll: HTMLElement): void => {
    gestureAt = performance.now();
    reveal(scroll);
  };

  const scrolled = (event: Event): void => {
    const scroll = container(event.target);
    if (!scroll) return;
    const now = performance.now();
    // Layout changes, the client's own bottom-follow and the width handles all
    // fire scroll events; only a chain started by input may reveal the thumb.
    if (now - gestureAt > INTENT_MS) return;
    gestureAt = now;
    reveal(scroll);
  };

  const wheeled = (event: WheelEvent): void => {
    const scroll = container(event.target);
    if (scroll) gesture(scroll);
  };

  const touched = (event: Event): void => {
    const scroll = container(event.target);
    if (scroll) gesture(scroll);
  };

  const keyed = (event: KeyboardEvent): void => {
    if (!SCROLL_KEYS.has(event.key)) return;
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target.isContentEditable || EDITABLE_TAGS.has(target.tagName));
    // Caret and text keys belong to the focused control; page keys still scroll on.
    if (typing && EDITING_KEYS.has(event.key)) return;
    const scroll = container(target);
    if (scroll) gesture(scroll);
  };

  /** Width of the painted scrollbar, excluding a gutter reserved on the far edge. */
  const barWidth = (scroll: HTMLElement): number => {
    const gutter = scroll.offsetWidth - scroll.clientWidth;
    const bothEdges = getComputedStyle(scroll).getPropertyValue('scrollbar-gutter').includes('both-edges');
    return Math.max(gutter / (bothEdges ? 2 : 1), MIN_GUTTER_PX);
  };

  /** Whether the pointer sits on the edge that paints the bar; the other edge is empty. */
  const onGutter = (event: PointerEvent, scroll: HTMLElement): boolean => {
    const bounds = scroll.getBoundingClientRect();
    if (event.clientY < bounds.top || event.clientY > bounds.bottom) return false;
    const width = barWidth(scroll);
    if (getComputedStyle(scroll).direction === 'rtl') return event.clientX <= bounds.left + width;
    return event.clientX >= bounds.right - width;
  };

  const pointer = (event: PointerEvent): void => {
    const scroll = container(event.target);
    leave();
    if (!scroll || !onGutter(event, scroll)) return;
    near = scroll;
    scroll.setAttribute('data-vscode-scrollbar-near', '');
  };

  document.addEventListener('keydown', keyed, true);
  document.addEventListener('pointermove', pointer, { passive: true });
  document.addEventListener('pointerleave', leave);
  document.addEventListener('scroll', scrolled, true);
  document.addEventListener('touchstart', touched, { passive: true });
  document.addEventListener('touchmove', touched, { passive: true });
  document.addEventListener('wheel', wheeled, { passive: true });

  return () => {
    document.removeEventListener('keydown', keyed, true);
    document.removeEventListener('pointermove', pointer);
    document.removeEventListener('pointerleave', leave);
    document.removeEventListener('scroll', scrolled, true);
    document.removeEventListener('touchstart', touched);
    document.removeEventListener('touchmove', touched);
    document.removeEventListener('wheel', wheeled);
    leave();
    for (const [scroll, timer] of timers) {
      clearTimeout(timer);
      scroll.removeAttribute('data-vscode-scrollbar-active');
    }
    timers.clear();
  };
}
