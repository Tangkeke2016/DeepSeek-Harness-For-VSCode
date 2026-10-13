/** Bundle both runtimes without importing the Harness source tree. */
import { build } from 'esbuild';
import { diffMenuPlugin } from './diff-menu.mjs';
await build({ entryPoints: ['src/idle-guard.ts'], outfile: 'dist/idle-guard.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'info' });
await build({ entryPoints: ['src/supervisor.ts'], outfile: 'dist/supervisor.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'info' });
await build({ entryPoints: ['src/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], logLevel: 'info' });
await build({ entryPoints: ['src/bridge.ts'], outfile: 'dist/bridge.js', bundle: true, platform: 'browser', target: 'es2022', logLevel: 'info' });
await build({ entryPoints: ['src/adapter.ts'], outfile: 'dist/adapter.js', bundle: true, platform: 'browser', target: 'es2022', logLevel: 'info' });
await build({ entryPoints: ['src/diff-view.ts'], outfile: 'dist/diff-view.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022', loader: { '.ttf': 'dataurl' }, plugins: [diffMenuPlugin], logLevel: 'info' });
await build({ entryPoints: ['src/diff-locale.ts'], outfile: 'dist/diff-locale.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'info' });
await build({ entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'], outfile: 'dist/diff-worker.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', logLevel: 'info' });
