/** Builds this standalone extension without invoking the repository workspace installer. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));

// Packaged VSIX files are released artifacts, so they live outside dist/ and are
// never removed by a build-output clean. releases/ is ignored by Git.
const out = `releases/${manifest.name}-${manifest.version}.vsix`;
mkdirSync(dirname(resolve(cwd, out)), { recursive: true });

for (const args of [
  ['scripts/build.mjs'],
  ['node_modules/@vscode/vsce/vsce', 'package', '--no-dependencies', '--readme-path', 'EXTENSION.md', '--no-rewrite-relative-links', '--out', out],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
