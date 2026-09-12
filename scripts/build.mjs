/** Bundle both runtimes without importing the Harness source tree. */
import { build } from 'esbuild';
await build({ entryPoints: ['src/supervisor.ts'], outfile: 'dist/v2-supervisor.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'info' });
await build({ entryPoints: ['src/v2/extension.ts'], outfile: 'dist/v2-extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], logLevel: 'info' });
await build({ entryPoints: ['src/v2/bridge.ts'], outfile: 'dist/v2-bridge.js', bundle: true, platform: 'browser', target: 'es2022', logLevel: 'info' });
await build({ entryPoints: ['src/v2/adapter.ts'], outfile: 'dist/v2-adapter.js', bundle: true, platform: 'browser', target: 'es2022', logLevel: 'info' });
