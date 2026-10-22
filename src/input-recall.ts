/** Read the latest user text from the loaded official session event window. */

/** @param entries - Session events already available to the client. @returns Latest plain user text, excluding injected editor context. */
export function lastUserInput(entries: readonly unknown[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (typeof entry !== 'object' || entry === null) continue;
    const wrapper = entry as Record<string, unknown>;
    const event = wrapper.event ?? entry;
    if (typeof event !== 'object' || event === null) continue;
    const row = event as Record<string, unknown>;
    if (row.type !== 'user/message' || typeof row.data !== 'object' || row.data === null) continue;
    const data = row.data as Record<string, unknown>;
    const source = data.source;
    if (typeof source !== 'object' || source === null || (source as Record<string, unknown>).kind !== 'user') continue;
    const content = data.content;
    if (!Array.isArray(content)) continue;
    const text = content.flatMap((part: unknown) => {
      if (typeof part !== 'object' || part === null) return [];
      const value = part as Record<string, unknown>;
      return value.type === 'text' && typeof value.text === 'string' && !value.text.startsWith('<dsh-vscode-context') ? [value.text] : [];
    }).join('\n');
    if (text) return text;
  }
  return undefined;
}
