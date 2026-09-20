# DeepSeek Harness for VS Code

[中文](README.md) | English

Use the official DeepSeek Harness Web interface in your VS Code workspace, with independent chat tabs, session history, editor selection context, and settings. This independently maintained integration uses a complete [official DSH installation](https://github.com/deepseek-ai/deepseek-harness), installed through setup or selected from an existing directory.

## Prerequisites

- Desktop VS Code 1.95 or newer.
- Node.js 22.x starting at 22.19, or 24+, available on `PATH`. Confirm with `node --version`; restart VS Code after changing PATH.
- Node.js with npx and network access for one-click installation, or an existing complete DSH installation. Copying `bin.js` alone is insufficient: its dependencies and Web resources are also required.

For Remote SSH, install the extension on the remote host and prepare Node.js and model credentials there. One-click installation runs on that remote host. Selected paths must also refer to the remote host.

## Install and start

1. Download `tangkeke-deepseek-harness-0.1.10.vsix` from [Releases](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/releases).
2. Choose **Install from VSIX…** in the VS Code Extensions panel and reload when prompted.
3. Open and trust a project workspace. Click the whale in the editor title bar, or search the Command Palette for `DeepSeek Harness` to open chat.
4. If the DSH path is missing, choose **Install official DSH** to run `npx @deepseek-ai/dsh web` and save its installed path automatically, or choose **Select DSH folder** or **Select bin file**. Valid selections are saved and loading starts automatically. Invalid selections display an error and reopen the picker; cancel to stop.
5. Configure models and credentials in the official settings page and start a conversation.

The working directory is the current VS Code workspace. Each workspace owns its own backend, which the extension starts or reuses automatically; **no manual `pnpm dsh web` command is needed**.

## DSH paths

| Installation | Typical bin.js location |
| --- | --- |
| Built source checkout | `<DSH project>/apps/cli/lib/bin.js` |
| Installed DSH package | `<package directory>/lib/bin.js` |

Search VS Code settings for `deepseekHarness`: `harnessPath` selects the DSH directory, while `binPath` selects the entry file and takes precedence. Choosing a folder through setup clears the previous `binPath`. The optional `home` setting selects the DSH data directory; empty uses `DSH_HOME` or `~/.dsh`.

## Stop the backend and install DSH plugins

**Once started, the backend does not automatically stop when chat closes, VS Code exits, or SSH disconnects.** To stop it, search the Command Palette for `DeepSeek Harness`: **Stop Current Workspace Backend** stops only the backend of the current workspace, and **Stop All Backends** stops every backend this extension started on the machine. Neither command stops a manually attached external backend.

When you switch workspace folders, the previous workspace's backend is stopped only when it is genuinely idle: no running tasks, queued messages, or scheduled work. After changing the DSH path or data directory, or installing DSH plugins, wait for active tasks to finish, stop that backend, and reopen chat. Install extra DSH plugins into the `web` profile under the same `DSH_HOME`; for example, run from the DSH project directory:

```sh
pnpm dsh plugin --profile web add <package-name>
```

## Support and development

Report problems at [GitHub Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues), including reproduction steps, OS, VS Code/DSH versions, and Remote SSH usage. Diagnostics appear under **Output → DeepSeek Harness**; remove API keys, tokens, and private information before sharing. Compatibility can vary across DSH and third-party plugin versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for build and contribution steps. Licensed under [MIT](LICENSE); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
