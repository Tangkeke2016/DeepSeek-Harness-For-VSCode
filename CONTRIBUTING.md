# Contributing

This repository contains the VS Code integration. The official DeepSeek Harness runtime is installed separately and is not vendored here.

Use Node.js 22.x starting at 22.19, or 24+, and npm:

```sh
npm ci
npm run typecheck
npm run package
```

The VSIX is written to `releases/tangkeke-deepseek-harness-x.x.x.vsix`. `EXTENSION.md` supplies the VS Code extension details through `vsce --readme-path`; `README.md` is the GitHub homepage. Keep these documents independent.

Open issues and pull requests at https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode. Include reproduction steps and relevant environment versions. Do not include API keys, access tokens, session content, or private filesystem data.

The code is licensed under MIT. Preserve LICENSE and THIRD_PARTY_NOTICES.md when redistributing.

Runtime sources live directly in `src/`, styles in `webview/`, and build scripts in `scripts/`. `npm run build` emits `dist/extension.cjs`, `dist/supervisor.cjs`, `dist/bridge.js`, and `dist/adapter.js`. Local history and diagnostics in `extras/` are ignored by Git and excluded from the VSIX.
