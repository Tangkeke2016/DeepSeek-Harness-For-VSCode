/** Resolves the document edited by the owned official Web profile. */
import { access } from 'node:fs/promises';
import { join } from 'node:path';

/** @param path - Local candidate. @returns Whether it exists; permission and I/O failures propagate. */
async function present(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * @param home - Absolute DSH home of the owned backend.
 * @returns The Web profile patch, or an existing legacy settings file when no Web profile exists.
 */
export async function settingsDocument(home: string): Promise<string> {
  const profile = join(home, 'profiles', 'web');
  const patch = join(profile, 'cordis.patch.yml');
  for (const path of [patch, join(profile, 'cordis.yml'), join(profile, 'package.json')]) {
    if (await present(path)) return patch;
  }
  const legacy = join(home, 'settings.yaml');
  return await present(legacy) ? legacy : patch;
}
