# DeepSeek Harness for VS Code

[中文](#中文使用指南) · [English](#english-guide) · [GitHub](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode)

## 中文使用指南

在当前 VS Code 工作区中使用官方 DeepSeek Harness Web 界面，支持独立聊天标签页、历史会话和官方设置。本扩展独立维护，需要另行安装完整的 DSH。

### 开始使用

1. 安装桌面版 VS Code 1.95+ 和 Node.js 22.x（至少 22.19）或 24+。将 Node.js 加入 `PATH`，运行 `node --version` 确认；修改 PATH 后重启 VS Code。
2. 按照 [官方 DSH](https://github.com/deepseek-ai/deepseek-harness) 的说明安装依赖并完成构建。Remote SSH 用户将扩展安装到远程端，并在服务器准备 Node.js、DSH 和模型凭据。
3. 打开并信任项目工作区，点击编辑器右上角鲸鱼按钮打开独立聊天标签页。
4. 首次配置时选择“选择 DSH 目录”或“选择 bin 文件”。文件选择器使用当前连接的文件系统；有效路径自动保存并加载，无效路径提示后重新选择，取消即可停止。
5. 在官方设置页面配置模型及凭据，开始会话。扩展自动启动或复用后台，无需手动运行 `pnpm dsh web`。

### DSH 路径

- 已构建的源码项目：`<DSH 项目>/apps/cli/lib/bin.js`
- 已安装的 DSH 包：`<包目录>/lib/bin.js`
- npm 全局安装：`<npm 全局目录>/@deepseek-ai/dsh/lib/bin.js`（运行 `npm root -g` 查看全局目录）

需要保留完整 DSH 安装及 Web 资源，不能只复制 `bin.js`。在 VS Code 设置中搜索 `deepseekHarness` 可查看配置：`binPath` 优先于 `harnessPath`，通过引导选择目录会清除旧的 `binPath`；可选的 `home` 指定数据目录，留空使用 `DSH_HOME` 或 `~/.dsh`。

### 后台管理

**后台一旦启动，不会随聊天页关闭、VS Code 退出或 SSH 断开而自动关闭。** 需要停止时，在命令面板搜索 `Shared Backend`，执行“停止当前用户的共享后台”。该命令不停止手动连接的外部后台。

### 遇到问题

新建会话失败时仍可访问历史。若更新 DSH 后提示预设依赖无法解析，可点击“重启后台并重试”；该操作会停止共享后台的所有任务。

请前往 [项目 Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues) 提交复现步骤、系统、VS Code/DSH 版本及 Remote SSH 使用情况。日志位于“输出 → DeepSeek Harness”，分享前移除凭据和私人信息。扩展不会自动安装或升级 DSH，第三方插件兼容性取决于对应版本。

## English guide

Use the official DeepSeek Harness Web interface in the current VS Code workspace, with independent chat tabs, session history, and official settings. This independently maintained extension requires a separate, complete DSH installation.

### Get started

1. Install desktop VS Code 1.95+ and Node.js 22.x starting at 22.19, or 24+. Add Node.js to `PATH` and confirm `node --version`; restart VS Code after changing PATH.
2. Follow the [official DSH instructions](https://github.com/deepseek-ai/deepseek-harness) to install dependencies and build. For Remote SSH, install the extension on the remote host and prepare Node.js, DSH, and model credentials there.
3. Open and trust a project workspace. Click the whale in the editor title bar to open an independent chat tab.
4. During setup, choose **Select DSH folder** or **Select bin file**. The picker uses the current connection's filesystem. Valid paths are saved and loaded automatically; invalid paths show an error and reopen the picker. Cancel to stop.
5. Configure models and credentials in official settings and start chatting. The extension starts or reuses the backend automatically; no manual `pnpm dsh web` command is needed.

### DSH paths

- Built source checkout: `<DSH project>/apps/cli/lib/bin.js`
- Installed DSH package: `<package directory>/lib/bin.js`
- npm global installation: `<npm global directory>/@deepseek-ai/dsh/lib/bin.js` (run `npm root -g` to find the global directory)

Keep the complete DSH installation and Web resources; copying `bin.js` alone is insufficient. Search VS Code settings for `deepseekHarness`: `binPath` takes precedence over `harnessPath`, and choosing a folder through setup clears the previous `binPath`. The optional `home` selects the data directory; empty uses `DSH_HOME` or `~/.dsh`.

### Backend management

**Once started, the backend does not automatically stop when chat closes, VS Code exits, or SSH disconnects.** To stop it, search the Command Palette for `Shared Backend` and run **Stop Current User's Shared Backend**. This command does not stop manually attached external backends.

### Support

History stays available if creating a session fails. If preset dependencies cannot be resolved after updating DSH, choose **Restart backend and retry**; this stops all tasks on the shared backend.

Report problems at [GitHub Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues) with reproduction steps, OS, VS Code/DSH versions, and Remote SSH usage. Logs appear under **Output → DeepSeek Harness**; remove credentials and private information before sharing. The extension does not install or upgrade DSH automatically; third-party plugin compatibility depends on the versions involved.

[Back to top / 返回顶部](#deepseek-harness-for-vs-code)
