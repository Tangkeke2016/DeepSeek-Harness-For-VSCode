/** File types excluded from ordinary editor navigation; extend this table for additional viewers. */
export const FILE_OPENING_EXCLUSIONS: Readonly<Record<string, 'browser'>> = {
  '.html': 'browser',
  '.htm': 'browser',
};

/** @param value - Navigation target. @returns Whether it is an HTTP(S) webpage. */
export function isWebPage(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
