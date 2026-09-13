# DeepSeek Harness for VS Code

[中文 / English](https://github.com/Tangkeke2016/deepseek-harness-for-vscode#readme)

## English guide

Use DeepSeek Harness in your VS Code workspace with independent chat tabs, session history, editor selection context, and official settings. This independently maintained integration requires a separate, complete DSH installation.

### Get started

1. Install desktop VS Code 1.95+ and Node.js 22.x starting at 22.19, or 24+. Add Node.js to PATH and confirm `node --version`. Restart VS Code after changing PATH.
2. Prepare the [official DSH runtime](https://github.com/deepseek-ai/deepseek-harness), including dependencies and build outputs. For Remote SSH, prepare it on the server.
3. Install the VSIX from [Releases](https://github.com/Tangkeke2016/deepseek-harness-for-vscode/releases). Uninstall the old harness-local extension first if present.
4. Open a workspace and click the whale. Choose **Select DSH folder** or **Select bin file**. VS Code chooses the filesystem for the current connection.
5. Invalid paths display an error and reopen the picker; cancel to stop. Valid selections are saved and loading starts automatically. Install Node.js first if it is missing.

The extension starts the backend automatically; no manual `pnpm dsh web` command is needed. Configure model credentials through official settings or the backend environment.

### Find bin.js

A built source checkout contains `apps/cli/lib/bin.js`. An installed DSH package contains `lib/bin.js`; for an npm global installation, check `@deepseek-ai/dsh/lib/bin.js` beneath the directory printed by `npm root -g`. Keep the full runtime installation, not just bin.js.

### Settings and support

Search VS Code settings for `deepseekHarness`. The `binPath` setting takes precedence over `harnessPath`; choosing a folder clears the previous binPath. The `home` setting selects the DSH data directory.

Closing a chat page keeps backend tasks running. To stop the managed backend, search the command palette for **Shared Backend**. Restart it after changing the runtime or its plugins.

Report problems at [GitHub Issues](https://github.com/Tangkeke2016/deepseek-harness-for-vscode/issues), including reproduction steps, OS, VS Code/DSH versions, and Remote SSH usage. Review Output → DeepSeek Harness for diagnostics and remove credentials and private information before sharing.

This README contains both languages with navigation at the top; VS Code does not automatically switch the extension details README by display language. Setup UI text follows the display language. Light themes use black text, dark themes white text; button labels stay white.

[Back to top](#deepseek-harness-for-vs-code)
