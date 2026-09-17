# DeepSeek Harness for VS Code

[中文](README.md) | English

Use the official DeepSeek Harness Web interface in your VS Code workspace, with independent chat tabs, session history, editor selection context, and settings. This independently maintained integration uses a complete [official DSH installation](https://github.com/deepseek-ai/deepseek-harness), installed through setup or selected from an existing directory.

## Prerequisites

- Desktop VS Code 1.95 or newer.
- Node.js 22.x starting at 22.19, or 24+, available on `PATH`. Confirm with `node --version`; restart VS Code after changing PATH.
- Node.js with npx and network access for one-click installation, or an existing complete DSH installation. Copying `bin.js` alone is insufficient: its dependencies and Web resources are also required.

For Remote SSH, install the extension on the remote host and prepare Node.js and model credentials there. One-click installation runs on that remote host. Selected paths must also refer to the remote host.

## Install and start

1. Download `tangkeke-deepseek-harness-0.1.7.vsix` from [Releases](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/releases).
2. Choose **Install from VSIX…** in the VS Code Extensions panel and reload when prompted.
3. Open and trust a project workspace. Click the whale in the editor title bar, or search the Command Palette for `DeepSeek Harness` to open chat.
4. If the DSH path is missing, choose **Install official DSH** to run `npx @deepseek-ai/dsh web` and save its installed path automatically, or choose **Select DSH folder** or **Select bin file**. Valid selections are saved and loading starts automatically. Invalid selections display an error and reopen the picker; cancel to stop.
5. Configure models and credentials in the official settings page and start a conversation.

History is sorted by latest activity, with seconds, minutes, hours, or month/day shown on the right. Editor context and reading hints are hidden in both pending interjections and the transcript.

The working directory is the current VS Code workspace. The extension starts or reuses a shared backend automatically; **no manual `pnpm dsh web` command is needed**.

New sessions display “New session” while being created, and the loading page follows VS Code colors. Briefly queued messages do not immediately occupy space above the input; queues that persist for the default 250 milliseconds remain visible, without delaying submission. Adjust `deepseekHarness.queueRevealDelayMilliseconds` in VS Code settings, or set it to 0 to show queues immediately. Reopen the view after changing it.

With “Follow VS Code” selected, the conversation and settings backgrounds use the current VS Code editor background color and update as the theme changes. Explicit light and dark selections retain the official palettes.

When a hidden tab or unfocused window returns, failed connections automatically reload the original session without restarting the backend or resending messages. A failed reconnect shows an error instead of retrying indefinitely.

One-click installation follows the version selected by the official npx command. Keep its saved installation directory. Installation progress supports cancellation; `deepseekHarness.installTimeoutSeconds` sets the deadline (default: 600 seconds).

## DSH paths

| Installation | Typical bin.js location |
| --- | --- |
| Built source checkout | `<DSH project>/apps/cli/lib/bin.js` |
| Installed DSH package | `<package directory>/lib/bin.js` |

Search VS Code settings for `deepseekHarness`: `harnessPath` selects the DSH directory, while `binPath` selects the entry file and takes precedence. Choosing a folder through setup clears the previous `binPath`. The optional `home` setting selects the DSH data directory; empty uses `DSH_HOME` or `~/.dsh`.

## Stop the backend and install DSH plugins

**Once started, the backend does not automatically stop when chat closes, VS Code exits, or SSH disconnects.** Search the Command Palette for `Shared Backend` and run **Stop Current User's Shared Backend** to stop it. This command does not stop manually attached external backends.

After changing the DSH path or data directory, or installing DSH plugins, wait for active tasks to finish, stop the shared backend, and reopen chat. Install extra DSH plugins into the `web` profile under the same `DSH_HOME`; for example, run from the DSH project directory:

```sh
pnpm dsh plugin --profile web add <package-name>
```

## Support and development

Report problems at [GitHub Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues), including reproduction steps, OS, VS Code/DSH versions, and Remote SSH usage. Diagnostics appear under **Output → DeepSeek Harness**; remove API keys, tokens, and private information before sharing. Compatibility can vary across DSH and third-party plugin versions.

See [CONTRIBUTING.md](CONTRIBUTING.md) for build and contribution steps. Licensed under [MIT](LICENSE); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
