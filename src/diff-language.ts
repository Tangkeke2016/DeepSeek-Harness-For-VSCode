/** Languages supported by the bundled read-only diff renderer. */
const languages: Readonly<Record<string, string>> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', py: 'python', md: 'markdown' };

/** @param path - Recorded file path. @returns A bundled language identifier, or plain text for unsupported extensions. */
export function diffLanguage(path: string): string {
  return languages[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'plaintext';
}
