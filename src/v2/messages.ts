/** Editor context stays durable on the backend and is hidden only in this client's transcript projection. */
export interface EditorContext {
  key: string;
  path: string;
  label: string;
  startLine?: number;
  endLine?: number;
  text?: string;
}
const PREFIX = '<dsh-vscode-context version="1">\n';
const SUFFIX = '\n</dsh-vscode-context>';

/** @param contexts - Explicit composer chips. @returns Logged text sent with the prompt. */
export function contextText(contexts: readonly EditorContext[]): string {
  return PREFIX + JSON.stringify(contexts.map(({ path, startLine, endLine, text }) => ({ path, startLine, endLine, text }))) + SUFFIX;
}

/** @param value - One text block. @returns Whether this is the extension-owned context encoding. */
export function isContextText(value: unknown): boolean {
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || !value.endsWith(SUFFIX)) return false;
  try {
    const parsed: unknown = JSON.parse(value.slice(PREFIX.length, -SUFFIX.length));
    return Array.isArray(parsed) && parsed.every(item => typeof item === 'object' && item !== null && typeof (item as { path?: unknown }).path === 'string');
  } catch { return false; } // Non-JSON user text is ordinary visible message content.
}

/** @param value - Remote JSON response. @returns Detached UI projection with only encoded editor-context blocks removed. */
export function presentation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(presentation);
  if (typeof value !== 'object' || value === null) return value;
  const object = value as Record<string, unknown>;
  if (object.type === 'user/message' && typeof object.data === 'object' && object.data !== null) {
    const data = object.data as Record<string, unknown>;
    if (Array.isArray(data.content)) return { ...object, data: { ...data, content: data.content.filter(block => !isContextText((block as { text?: unknown }).text)) } };
  }
  return Object.fromEntries(Object.entries(object).map(([key, field]) => [key,
    key === 'title' && typeof field === 'string' && field.includes('<dsh-vscode')
      ? field.slice(0, field.indexOf('<dsh-vscode')).trimEnd() : presentation(field)]));
}

/** Editor-tab labels are bounded: VS Code sizes a tab from its label, so a label wider than the editor group scrolls the title area and carries the tab's close control out of view. */
export const TAB_LABEL_COLUMNS = 24;

/**
 * Display columns one code point occupies in a tab label: the East Asian wide
 * and fullwidth ranges, including emoji, take two.
 * @param codePoint - One code point.
 * @returns Two for wide or fullwidth, otherwise one.
 */
function labelColumns(codePoint: number): number {
  return (codePoint >= 0x1100 && codePoint <= 0x115f)
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd) ? 2 : 1;
}

/** @param value - Flat label text. @returns Its width in display columns. */
function labelWidth(value: string): number {
  let columns = 0;
  for (const character of value) columns += labelColumns(character.codePointAt(0)!);
  return columns;
}

/**
 * Strip this client's encoded editor context from a title and collapse its
 * whitespace: the label text a tab carries before any width bound.
 * @param title - Session display title.
 * @returns The title without the encoded context, whitespace collapsed.
 */
export function sessionLabel(title: string): string {
  const marker = title.indexOf('<dsh-vscode');
  return (marker < 0 ? title : title.slice(0, marker)).replace(/\s+/g, ' ').trim();
}

/**
 * Bound one label to {@link TAB_LABEL_COLUMNS} display columns, cutting on a
 * code-point boundary; the ellipsis marking a cut spends one of those columns,
 * so a bounded label never exceeds the budget. Only tab sizing that grows a tab
 * with its label needs this bound: `fixed` and `shrink` ellipsize the label
 * themselves and keep the full title for the tab's hover.
 * @param title - Session display title.
 * @returns The collapsed title when it fits, otherwise its bounded prefix.
 */
export function tabLabel(title: string): string {
  const flat = sessionLabel(title);
  if (labelWidth(flat) <= TAB_LABEL_COLUMNS) return flat;
  let columns = 0; let label = '';
  for (const character of flat) {
    const width = labelColumns(character.codePointAt(0)!);
    if (columns + width > TAB_LABEL_COLUMNS - 1) break;
    columns += width; label += character;
  }
  return `${label.trimEnd()}…`;
}
