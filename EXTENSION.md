# DeepSeek Harness for VS Code

[中文](#中文使用指南) · [English](#english-guide) · [项目主页](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode) · [反馈问题](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues)

## 中文使用指南

在 VS Code 工作区中使用 DeepSeek Harness：独立聊天标签页、历史会话、编辑器选区上下文和官方设置页面。本项目独立维护，使用官方后台与 Web 界面；需要另行准备 DSH 运行环境。

### 开始使用

1. 安装桌面版 VS Code 1.95 或更高版本，以及 Node.js 22.19+ 的 22.x 或 24+。将 Node.js 加入 PATH，终端执行 `node --version` 确认；修改 PATH 后重启 VS Code。
2. 准备已安装依赖并完成构建的 [官方 DSH](https://github.com/deepseek-ai/deepseek-harness)。Remote SSH 用户在远程服务器准备这些环境。
3. 从本项目 [Releases](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/releases) 下载 VSIX，通过“扩展：从 VSIX 安装”安装。旧的 harness-local 版本或 TangKeke.deepseek-harness-vscode 需先卸载，避免与新的 TangKeke.tangkeke-deepseek-harness 重复启用。
4. 打开项目工作区，点击鲸鱼图标。环境引导中点击“选择 DSH 目录”或“选择 bin 文件”；文件选择器由 VS Code 根据当前连接决定路径来源。
5. 路径校验失败会提示并重新打开选择器，取消即可停止。有效选择自动保存并尝试加载，无需点击重新加载按钮。Node.js 缺失需先安装 Node.js。

后台一旦启动，不会随聊天页关闭、VS Code 退出或 SSH 断开而自动关闭。需要停止时，在命令面板执行“停止当前用户的共享后台”（搜索 Shared Backend）。后台由扩展自动启动，无需手动运行 `pnpm dsh web`。模型凭据在官方设置页面或后台环境中配置。

### bin.js 在哪里

| 安装方式 | 常见位置 |
| --- | --- |
| DSH 源码项目，已构建 | `<项目目录>/apps/cli/lib/bin.js` |
| 已安装的 DSH npm 包 | `<包目录>/lib/bin.js` |
| npm 全局安装 | `npm root -g` 输出目录下的 `@deepseek-ai/dsh/lib/bin.js` |

不要只复制 bin.js：它还依赖完整的 DSH 安装和 Web 资源。找不到源码项目的 lib 目录时，先按官方说明完成构建。

### 路径和常用操作

路径保存在 VS Code 用户配置中：`deepseekHarness.binPath` 优先于 `deepseekHarness.harnessPath`；选择目录会清除旧 binPath。`deepseekHarness.home` 可指定 DSH 数据目录。通过设置搜索 `deepseekHarness` 查看当前配置。

编辑器右上角鲸鱼按钮打开独立聊天标签页。关闭页面不会停止后台任务；要停止扩展管理的后台，运行命令 `DeepSeek Harness: Stop Current User’s Shared Backend`（可搜索 Shared Backend）。修改后台安装或插件后，停止后台再打开聊天。

### 遇到问题

请前往 [项目 Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues) 提交问题，说明操作步骤、系统、VS Code/DSH 版本以及是否使用 Remote SSH。日志位于“输出 → DeepSeek Harness”；分享前删除令牌、API Key 和私人路径等敏感信息。扩展不会自动安装或升级 DSH，第三方 DSH 插件兼容性取决于对应版本。

本页提供中英双语，顶部导航跳转到对应段落；扩展详情 README 不会根据 VS Code 语言自动切换。启动引导和按钮会跟随显示语言，正文浅色黑字、深色白字，按钮保持白字蓝底。

## English guide

Use DeepSeek Harness in your VS Code workspace with independent chat tabs, session history, editor selection context, and official settings. This independently maintained integration requires a separate, complete DSH installation.

### Get started

1. Install desktop VS Code 1.95+ and Node.js 22.x starting at 22.19, or 24+. Add Node.js to PATH and confirm `node --version`. Restart VS Code after changing PATH.
2. Prepare the [official DSH runtime](https://github.com/deepseek-ai/deepseek-harness), including dependencies and build outputs. For Remote SSH, prepare it on the server.
3. Install the VSIX from [Releases](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/releases). Uninstall old harness-local or TangKeke.deepseek-harness-vscode installations first; the new extension ID is TangKeke.tangkeke-deepseek-harness.
4. Open a workspace and click the whale. Choose **Select DSH folder** or **Select bin file**. VS Code chooses the filesystem for the current connection.
5. Invalid paths display an error and reopen the picker; cancel to stop. Valid selections are saved and loading starts automatically. Install Node.js first if it is missing.

Once started, the backend does not automatically stop when chat pages close, VS Code exits, or SSH disconnects. Stop it explicitly using the Stop Current User's Shared Backend command. The extension starts the backend automatically; no manual `pnpm dsh web` command is needed. Configure model credentials through official settings or the backend environment.

### Find bin.js

A built source checkout contains `apps/cli/lib/bin.js`. An installed DSH package contains `lib/bin.js`; for an npm global installation, check `@deepseek-ai/dsh/lib/bin.js` beneath the directory printed by `npm root -g`. Keep the full runtime installation, not just bin.js.

### Settings and support

Search VS Code settings for `deepseekHarness`. The `binPath` setting takes precedence over `harnessPath`; choosing a folder clears the previous binPath. The `home` setting selects the DSH data directory.

Closing a chat page keeps backend tasks running. To stop the managed backend, search the command palette for **Shared Backend**. Restart it after changing the runtime or its plugins.

Report problems at [GitHub Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues), including reproduction steps, OS, VS Code/DSH versions, and Remote SSH usage. Review Output → DeepSeek Harness for diagnostics and remove credentials and private information before sharing.

This README contains both languages with navigation at the top; VS Code does not automatically switch the extension details README by display language. Setup UI text follows the display language. Light themes use black text, dark themes white text; button labels stay white.

[Back to top](#deepseek-harness-for-vs-code)

### DSH 插件 / DSH plugins

额外插件安装到相同 DSH_HOME 的 web profile。安装后等待任务结束，手动停止共享后台，再打开聊天以加载插件；仅关闭页面不会重启后台。支持通过转发加载插件图片、动态脚本及 REST 设置请求。桌宠 dsh-pet-remielle 0.4.0 的 GIF 和辅助脚本已验证；原生 EventSource 尚未转发，桌宠通过自带的轮询回退更新状态。

Install DSH plugins into the web profile under the same DSH_HOME. After active tasks finish, stop the shared backend and reopen chat to load newly installed plugins. Plugin images, dynamic scripts, and REST settings requests use the authenticated carrier. Remielle 0.4.0 GIFs and helper scripts have been checked; native EventSource is not bridged, so Remielle uses its polling fallback.
