/** Builds this standalone extension without invoking the repository workspace installer. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
for (const args of [
  ['scripts/build.mjs'],
  ['node_modules/@vscode/vsce/vsce', 'package', '--no-dependencies', '--readme-path', 'EXTENSION.md', '--no-rewrite-relative-links', '--out', `dist/deepseek-harness-vscode-${manifest.version}.vsix`],
]) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
