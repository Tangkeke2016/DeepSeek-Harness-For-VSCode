/** History ordering and elapsed labels use the official latest Session activity timestamp. */
import { copy } from './locale.ts';

/** @param rows - Visible workspace sessions. @returns A new list ordered by latest activity, preserving ties. */
export function recentSessions<T extends { updatedAt: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => right.updatedAt - left.updatedAt);
}

/** @param timestamp - Latest activity in epoch milliseconds. @param now - Current epoch milliseconds. @param language - Client locale. @returns Floored elapsed time, or local month/day at 24 hours. */
export function historyTime(timestamp: number, now: number, language: string): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  const text = copy(language.toLowerCase());

  // A day or more is reported as a calendar date instead of an ever-growing count.
  if (seconds >= 86400) {
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  const count = seconds < 60 ? seconds : seconds < 3600 ? Math.floor(seconds / 60) : Math.floor(seconds / 3600);
  const unit = seconds < 60 ? (count === 1 ? text.second : text.seconds)
    : seconds < 3600 ? (count === 1 ? text.minute : text.minutes) : (count === 1 ? text.hour : text.hours);

  return `${count}${text.timeSeparator}${unit}`;
}

/** Filter visible titles without changing their activity order.
 * @param rows - Sessions in display order.
 * @param query - Literal, case-insensitive title text.
 * @param blankTitle - Localized title of a blank session.
 * @returns Matching sessions; whitespace alone keeps all rows.
 */
export function filterSessions<T extends { displayTitle: string; blank: boolean }>(
  rows: readonly T[], query: string, blankTitle: string,
): T[] {
  const needle = query.trim().normalize('NFKC').toLocaleLowerCase();
  return rows.filter(row => (row.blank ? blankTitle : row.displayTitle)
    .normalize('NFKC').toLocaleLowerCase().includes(needle));
}
