# DeepSeek Harness for VS Code

[中文](README.md) | English

Use the official DeepSeek Harness Web interface in the current VS Code workspace, with independent chat tabs, session history, editor selection context, and settings. Author: 唐可可. Version: 0.1.1.

This independently maintained VS Code integration is not an official DeepSeek extension. It does not include a DSH installation or modify the official backend source.

## Prerequisites

1. Install desktop VS Code 1.95 or newer.
2. Install Node.js 22.x starting at 22.19, or Node.js 24 or newer, and add its installation directory to the `PATH` environment variable. Development and compilation also require npm. Run `node --version` on the extension host machine to verify Node is available; restart VS Code after changing the environment.
3. Prepare an [official DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) installation with dependencies installed and build outputs present. A source checkout must contain `apps/cli/lib/bin.js`; an installed `@deepseek-ai/dsh` package must contain `lib/bin.js`. Copying the CLI file alone is insufficient: the full dependencies and official Web runtime assets are required.
4. Set `deepseekHarness.harnessPath` in VS Code to that DSH installation's absolute directory, not the `dsh` executable or `bin.js` file.

Windows settings example:

```json
{
  "deepseekHarness.harnessPath": "D:\\tools\\deepseek-harness"
}
```

Linux settings example:

```json
{
  "deepseekHarness.harnessPath": "/opt/deepseek-harness"
}
```

For Remote-SSH, install the extension on the SSH host and configure its remote DSH path in Remote Settings. Node.js, `PATH`, DSH, and model credentials must also be available on that remote machine. A local Windows path cannot identify a remote Linux installation. The working directory is the current VS Code workspace; no separate folder selection is required.

## Build and install

Clone and build this project independently; it does not require a parent Harness checkout or pnpm workspace. Run from this project root:

```sh
npm ci
npm run typecheck
npm run package
```

The output is `dist/deepseek-harness-vscode-0.1.1.vsix`. In the VS Code Extensions panel, select **Install from VSIX…** from the additional actions menu, select the file, and reload when prompted. Run `npm run build` to compile JavaScript only.

The source repository excludes `node_modules`, build artifacts, VSIX files, diagnostic logs, runtime data, obsolete code, and development history. Keep `package-lock.json`: it pins the extension's build dependencies. VSIX users do not need the extension source or npm build dependencies, but still need Node.js and an installed DSH runtime.

## Usage

Open and trust a workspace, then click the whale in the editor title bar or run **DeepSeek Harness: New Session** from the Command Palette. History and settings controls are inside the chat page.

The extension starts or reuses a per-user shared backend through the official `dsh --profile web` entry, using a system-assigned available port rather than a fixed port 3080. You do not need to run `pnpm dsh web` separately. Closing a chat page or VS Code leaves the shared backend running; use **DeepSeek Harness: Stop Current User's Shared Backend** to stop it.

Configure models and credentials in the official settings interface; never commit API keys, tokens, or personal settings to the repository.

| Setting | Purpose |
| --- | --- |
| `deepseekHarness.harnessPath` | Absolute directory of the installed DSH runtime. |
| `deepseekHarness.home` | Optional DSH data directory; empty uses `DSH_HOME` or `~/.dsh`. |
| `deepseekHarness.startupTimeoutSeconds` | Backend startup deadline; defaults to 90 seconds. |
| `deepseekHarness.webviewTimeoutSeconds` | Client initialization and first history snapshot deadline; defaults to 60 seconds. |
| `deepseekHarness.maxTransferMegabytes` | Attachment or API response buffer limit; defaults to 64 MiB. |
| `deepseekHarness.settingsPath` | Optional absolute path to the official settings document. |

Stop the shared backend before reopening chat after changing the DSH path or data directory. Use **DeepSeek Harness: Connect to Running Backend** to attach an existing backend with its official token-bearing launch URL; the extension does not stop externally attached backends.

## Troubleshooting and compatibility

If the backend cannot be found, check `node --version`, DSH build outputs, and `deepseekHarness.harnessPath` on the extension host machine. Extension diagnostics appear under **Output → DeepSeek Harness**; shared backend diagnostics are in `~/.dsh-vscode/supervisor.log`. Do not publish discovery credentials or unchecked logs.

Use **DeepSeek Harness: Reload Current View** if a page stops loading. If buttons do not respond at all, inspect **Developer: Show Running Extensions**: another extension such as Copilot can block the shared extension host. Open the specific project directory instead of an entire user home directory.

Official Harness APIs and the Web interface are evolving; compatibility with every DSH version is not guaranteed. Browser-only VS Code cannot launch this backend. The extension does not install or upgrade DSH automatically.

## License

[MIT](LICENSE). Dependency and icon notices are included in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## First-start setup

The extension checks Node.js and the official DSH bin.js before starting its backend. Missing prerequisites show the whale, “Explore the Uncharted”, and “Preview”, with separate Node and DSH diagnostics. The Node prompt links to the official download page. DSH setup accepts an absolute bin.js file path or a complete installation directory, validates it, saves it to VS Code user settings (settings.json) on the extension host, then checks again and loads automatically. Invalid or cancelled input is not saved.

`deepseekHarness.binPath` selects a bin.js file and takes precedence over `deepseekHarness.harnessPath`. Choosing a DSH directory in setup clears the old binPath; clear a conflicting binPath when editing settings manually too. Entry validation checks a readable file, not the full DSH dependency installation; backend failures provide retry. External backends do not require local Node/DSH checks. A Harness spinner appears while the backend and official interface load. SSH paths refer to the remote host; restart VS Code after updating PATH.

The DSH setup message links to the [official project](https://github.com/deepseek-ai/deepseek-harness). The Enter bin.js path, Enter DSH directory, and Reload buttons use the whale blue. Reload checks the environment again and attempts to load the page.
