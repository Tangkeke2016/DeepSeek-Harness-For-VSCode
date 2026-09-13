# DeepSeek Harness for VS Code

中文 | [English](README.en.md)

在当前 VS Code 工作区中使用官方 DeepSeek Harness Web 界面，支持独立聊天标签页、历史会话、编辑器选区上下文和设置。作者：唐可可。版本：0.1.1。

这是独立维护的 VS Code 集成项目，不是 DeepSeek 官方扩展。插件不包含 DSH 安装，也不修改官方后台源码。

## 环境准备

1. 安装桌面版 VS Code 1.95 或更高版本。
2. 安装 Node.js 22.19.x 及以上的 22.x 版本，或 Node.js 24 及以上版本，并将 Node.js 安装目录加入 `PATH` 环境变量。开发和编译还需要 npm。在运行插件的机器上执行 `node --version` 确认能够找到 Node；修改环境变量后重新启动 VS Code。
3. 准备已安装完整依赖、已构建好的 [官方 DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。源码目录必须存在 `apps/cli/lib/bin.js`；已安装的 `@deepseek-ai/dsh` 包目录必须存在 `lib/bin.js`。仅复制 CLI 文件不够，还需要完整依赖和官方 Web 运行资源。
4. 在 VS Code 设置中配置 `deepseekHarness.harnessPath`，填写上述 DSH 安装目录的绝对路径，而不是 `dsh` 可执行文件或 `bin.js` 文件路径。

Windows 设置示例：

```json
{
  "deepseekHarness.harnessPath": "D:\\tools\\deepseek-harness"
}
```

Linux 设置示例：

```json
{
  "deepseekHarness.harnessPath": "/opt/deepseek-harness"
}
```

使用 Remote-SSH 时，把扩展安装在 SSH 远程端，并在远程设置中填写远端 DSH 路径。Node.js、`PATH`、DSH 及其模型凭据也必须在远程机器上准备好。本地 Windows 路径不能用于远端 Linux。工作目录使用当前打开的 VS Code 工作区，不需要额外选择。

## 编译与安装

本项目可单独克隆和编译，不依赖父目录中的 Harness 源码或 pnpm 工作区。在本项目根目录执行：

```sh
npm ci
npm run typecheck
npm run package
```

产物为 `dist/deepseek-harness-vscode-0.1.1.vsix`。在 VS Code 扩展面板的更多操作中选择“从 VSIX 安装…”，选择该文件，再按提示重新加载窗口。仅构建 JavaScript 时运行 `npm run build`。

源码仓库不提交 `node_modules`、构建产物、VSIX、调试日志、运行数据、旧版代码或开发历史。`package-lock.json` 用于固定插件构建依赖，请保留。安装 VSIX 的使用者不需要插件源码或 npm 构建依赖，但仍需要 Node.js 和已经安装好的 DSH。

## 使用

打开并信任工作区，点击编辑器右上角鲸鱼按钮，或在命令面板执行“DeepSeek Harness：新会话”。历史和设置入口位于聊天页面中。

插件自动通过官方 `dsh --profile web` 启动或复用当前用户的共享后台，使用系统分配的空闲端口，不固定为 3080。无需另外运行 `pnpm dsh web`。关闭聊天页面或 VS Code 后，共享后台继续运行；需要停止时执行“DeepSeek Harness：停止当前用户的共享后台”。

在官方设置界面配置模型及凭据；不要把 API Key、令牌或个人配置提交到仓库。

| 设置 | 用途 |
| --- | --- |
| `deepseekHarness.harnessPath` | 已安装 DSH 的绝对目录路径。 |
| `deepseekHarness.home` | 可选的 DSH 数据目录；留空时使用 `DSH_HOME` 或 `~/.dsh`。 |
| `deepseekHarness.startupTimeoutSeconds` | 后台启动等待时间，默认 90 秒。 |
| `deepseekHarness.webviewTimeoutSeconds` | 界面初始化和首份历史快照等待时间，默认 60 秒。 |
| `deepseekHarness.maxTransferMegabytes` | 附件或 API 响应缓冲上限，默认 64 MiB。 |
| `deepseekHarness.settingsPath` | 可选的官方设置文件绝对路径。 |

更换 DSH 路径或数据目录后，先停止共享后台再打开聊天。已有后台可通过“DeepSeek Harness：连接已运行的后台”连接，地址需包含官方启动令牌；外接后台不会被插件停止。

## 故障排查与兼容性

后台找不到时，检查运行插件的机器上的 `node --version`、DSH 构建文件和 `deepseekHarness.harnessPath`。插件输出记录位于“输出 → DeepSeek Harness”；共享后台诊断文件位于 `~/.dsh-vscode/supervisor.log`。请勿公开共享后台发现文件或未经检查的日志。

页面加载异常时，可执行“DeepSeek Harness：重新加载当前页面”。若点击按钮完全无响应，请在“开发人员：显示正在运行的扩展”检查扩展宿主；Copilot 等其他扩展占用同一宿主时也会阻塞本插件。优先打开具体项目目录，避免把整个用户目录作为工作区。

官方 Harness API 和 Web 界面仍在变化，不能保证所有 DSH 版本都兼容。浏览器版 VS Code 不支持此插件的后台启动方式。本插件不会自动安装或升级 DSH。

## 许可证

[MIT](LICENSE)。第三方依赖和图标声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 首次启动引导

插件启动时检查可用 Node.js 和官方 DSH bin.js。缺少环境时显示鲸鱼、“探索未至之境”和“预览版”，分别列出 Node 或 DSH 问题。Node 提示提供官方下载链接；DSH 提示可填写 bin.js 文件绝对路径或完整安装目录，校验通过后保存到当前运行主机的 VS Code 用户设置（settings.json），随后自动重新检查并加载。输入无效或取消时不保存。

`deepseekHarness.binPath` 指定 bin.js 文件，优先于 `deepseekHarness.harnessPath`。通过引导填写 DSH 目录会清除旧 binPath；直接编辑配置时也需清除冲突的 binPath。只检查入口是否为可读文件，不代替完整 DSH 依赖安装验证；启动失败会显示重试提示。外接后台无需检查本机 Node/DSH。等待后台和官方界面时显示 Harness 旋转加载页。SSH 下所有路径均指向远程主机；更新 PATH 后应重启 VS Code。
