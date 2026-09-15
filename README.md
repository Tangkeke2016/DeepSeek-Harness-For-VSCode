# DeepSeek Harness for VS Code

中文 | [English](README.en.md)

在 VS Code 工作区中使用官方 DeepSeek Harness Web 界面，支持独立聊天标签页、历史会话、编辑器选区上下文和设置。本项目独立维护，需要另行安装 [官方 DSH](https://github.com/deepseek-ai/deepseek-harness)。

## 环境准备

- 桌面版 VS Code 1.95 或更高版本。
- Node.js 22.x（至少 22.19）或 24 及以上版本，安装目录已加入 `PATH`。执行 `node --version` 确认，修改 PATH 后重启 VS Code。
- 已安装完整依赖并构建完成的 DSH。不能只复制 `bin.js`，还需要其依赖和 Web 资源。

使用 Remote SSH 时，将扩展安装在远程端，并在远程服务器准备 Node.js、DSH 和模型凭据；选择的路径也必须属于远程服务器。

## 安装与启动

1. 从 [Releases](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/releases) 下载 `tangkeke-deepseek-harness-0.1.5.vsix`。
2. 在 VS Code 扩展面板中选择“从 VSIX 安装…”，安装后按提示重新加载窗口。
3. 打开并信任项目工作区，点击编辑器右上角鲸鱼按钮，或在命令面板搜索 `DeepSeek Harness` 打开聊天。
4. 首次启动缺少 DSH 路径时，点击“选择 DSH 目录”或“选择 bin 文件”。有效选择会保存并自动尝试加载；无效选择会提示并重新打开选择器，取消即可停止。
5. 在官方设置页面配置模型及凭据，开始会话。

历史会话按最新活动时间排序，右侧显示秒、分钟、小时或月/日。编辑器上下文及阅读提示在待处理插话和正式聊天记录中均隐藏。

工作目录使用当前 VS Code 工作区，无需另行选择。插件自动启动或复用共享后台，**无需手动运行 `pnpm dsh web`**。

## DSH 路径

| 安装方式 | bin.js 常见位置 |
| --- | --- |
| 源码项目完成构建后 | `<DSH 项目>/apps/cli/lib/bin.js` |
| 已安装的 DSH 包 | `<包目录>/lib/bin.js` |

在 VS Code 设置中搜索 `deepseekHarness` 可查看路径：`harnessPath` 指定 DSH 目录，`binPath` 指定入口文件且优先级更高；通过引导选择目录会清除旧的 `binPath`。可选的 `home` 指定 DSH 数据目录，留空时使用 `DSH_HOME` 或 `~/.dsh`。

## 停止后台与安装 DSH 插件

**后台一旦启动，不会随聊天页关闭、VS Code 退出或 SSH 断开而自动关闭。** 需要停止时，在命令面板搜索 `Shared Backend`，执行“停止当前用户的共享后台”。该命令不停止手动连接的外部后台。

更换 DSH 路径、数据目录或安装 DSH 插件后，等待当前任务结束，停止共享后台再打开聊天。额外 DSH 插件应安装到同一 `DSH_HOME` 的 `web` profile，例如在 DSH 项目目录执行：

```sh
pnpm dsh plugin --profile web add <插件包名>
```

## 问题反馈与开发

遇到问题请前往 [GitHub Issues](https://github.com/Tangkeke2016/DeepSeek-Harness-For-VSCode/issues)，提供复现步骤、系统、VS Code/DSH 版本以及是否使用 Remote SSH。诊断信息位于“输出 → DeepSeek Harness”；分享前移除 API Key、令牌及私人信息。不同 DSH 或第三方插件版本的兼容性可能不同。

源码构建与贡献步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)。本项目采用 [MIT 许可证](LICENSE)，第三方声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
