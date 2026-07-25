# WebClaw

[English](README.en.md)

WebClaw 是一个“用户控制的浏览器 AI 助手”，以 Chrome Manifest V3 扩展运行。它可以接入用户选择的模型 Provider，并在显著披露、按域名授权和高风险操作确认的约束下读取页面、操作 DOM 和调用受控 Tool。

## 项目状态

WebClaw 目前是实验性的浏览器原生 Agent 框架，适合本地开发、个人自动化和受控测试流程。它具备读取网页、调用模型、收发通道消息和执行工具的能力。在敏感网站、凭证、消息通道或自动发送场景中使用前，请先阅读 [隐私说明](PRIVACY.md) 和 [安全说明](SECURITY.md)。

## 功能概览

- Chrome Side Panel 会话界面。
- 设置与文件管理器通过独立扩展窗口打开，不遮挡会话。
- 多会话 Session 管理，所有通道消息进入当前活跃会话。
- Provider 管理：Local Ollama、OpenAI-compatible API、Chrome AI、Codex / ChatGPT OAuth、GitHub Copilot OAuth。
- 模型列表刷新、模型下拉选择、Thinking mode 配置。
- 浏览器工具：页面上下文、点击、输入、跳转、等待、页面翻译、天气查询、搜索网页、后台 HTTP 请求、企业微信推送、有限 Chrome API、可选页面 JavaScript 执行。
- 虚拟文件系统：文件管理器与 Agent Tool 共享 IndexedDB 文件系统；支持目录浏览、文本编辑、上传、下载、重命名、回收站、恢复、彻底删除，以及 `fs_list`、`fs_read`、`fs_write`、`fs_edit`、`fs_search`、`fs_apply_patch` 等结构化 Tool。
- 本地知识库：将 VFS 文本文件索引到浏览器本地 IndexedDB，支持 `knowledge_ingest`、`knowledge_search`、`knowledge_read`、`knowledge_forget`、`knowledge_status`；首次启动会创建并索引 WebClaw 操作手册。
- 工作区记忆：自动初始化 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md` 及每日记忆文件，并在每次 Agent 运行前按上下文预算注入。
- 受控 Tool 轨迹：保留受限长度的工具结果和失败原因，用于后续会话与 Provider 切换时的自我纠错。
- 受限 `fs_shell`：可在该虚拟文件系统中执行 `pwd`、`ls`、`stat`、`mkdir`、`touch`、`cat`、`cp`、`mv`、`rm`，不执行真实系统 Shell。
- 自定义 Tool、Skill，以及可选的高级 Schedule 和自我配置 Tool。
- 微信和 Telegram Channel；企业微信机器人通知由独立的 `qiyewechat_notification` Tool 提供。
- Chrome 内置 Prompt API 和 Summarizer API 支持。
- Agent 自管理能力：可通过受控 patch 增加 tool、skill、schedule，或切换现有默认 Provider。

## 仓库文档

- [English README](README.en.md)
- [隐私说明](PRIVACY.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)
- [发布检查清单](RELEASE.md)
- [OAuth 配置与发布建议](OAUTH.md)
- [Chrome Web Store 上架资料](STORE_LISTING.md)
- [许可证](LICENSE)

## 在 Chrome 中加载

1. 打开 `chrome://extensions`。
2. 开启右上角 `Developer mode`。
3. 点击 `Load unpacked`。
4. 选择本仓库目录，目录根部应直接包含 `manifest.json`。
5. 点击 WebClaw 扩展图标打开 Side Panel。

## Provider 配置

打开 Side Panel 右上角设置按钮，可以管理 Provider。WebClaw 支持添加多个 Provider，每个 Provider 可以有独立名称、类型和模型配置。当前激活 Provider 会用于会话、工具执行和 Schedule。

### Local Ollama

先启动 Ollama，然后配置：

- Provider type: `Local Ollama`
- Base URL: `http://localhost:11434`
- Model: 已拉取的模型，例如 `llama3.1`、`qwen3.6:latest`

模型列表刷新会调用：

```text
GET http://localhost:11434/api/tags
```

### OpenAI-compatible API

配置：

- Provider type: `OpenAI-compatible API`
- Base URL: OpenAI 可用 `https://api.openai.com/v1`，兼容服务填写对应 `/v1` 地址
- API key
- Model

模型列表刷新会调用兼容接口：

```text
GET /models
```

### Chrome AI

Provider type 选择 `Chrome AI` 后，WebClaw 会通过 Chrome 内置 Prompt API 使用本机模型。由于 MV3 background service worker 不能直接调用 Prompt API，WebClaw 会从 offscreen extension document 调用。

Chrome AI 需要支持内置 AI 的 Chrome 版本、合适硬件、足够磁盘空间，以及已下载或可下载的 Gemini Nano 模型。可在以下页面排查：

```text
chrome://on-device-internals
```

当 `get_page_context` 页面正文较长时，WebClaw 会优先用 Chrome Summarizer API 对页面内容做摘要，再把摘要传给 Prompt API，以降低上下文超限概率。

### Codex / ChatGPT OAuth

该 Provider 是实验性集成。为了让当前纯浏览器扩展仍可添加 Codex Provider，本仓库暂时集中内置 Codex CLI 的公开 Client ID 作为兼容默认值：

- Issuer URL: `https://auth.openai.com`
- Authorization URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- Client ID: 默认使用公开的 Codex CLI Client ID，也可在 Provider 中覆盖
- Codex backend URL: `https://chatgpt.com/backend-api/codex`

Client ID 不是秘密，但这个默认值是暂时的兼容依赖：OpenAI 当前没有文档化第三方 Chrome 扩展的 Client 注册流程，因此它可能因服务端或发布政策变化而失效。官方注册方式可用后应替换该默认值，扩展中不得加入 Client Secret。

点击 `Sign in with ChatGPT` 后，WebClaw 会请求设备登录码，并在独立窗口打开 ChatGPT 设备授权页面，避免授权页替换 Settings popup。Codex 待授权状态由扩展后台 Alarm 持续轮询，因此 Settings 被遮挡或关闭也不会中断 token 交换；成功后独立授权窗口会关闭并重新聚焦原 Settings 窗口。也可以直接在会话中发送消息：缺少可用 token 时，WebClaw 会先显示授权确认，允许后启动同一设备登录流程，并在成功后继续原请求。

从微信或 Telegram 发起的请求无法点击 Side Panel。此时 WebClaw 会向原 Channel 会话发送一个六位数字授权码；直接回复该六位数字（例如提示为 `123456` 时回复 `123456`）表示授权，回复 `0` 表示拒绝。授权码只对发起请求的 Channel 和联系人有效，十分钟后失效。允许后 WebClaw 会继续发送 ChatGPT 授权网址和设备码，完成网页授权后原任务自动继续。

access token 和 refresh token 保存在 `chrome.storage.local` 并自动刷新，因此正常情况下只登录一次；退出登录、token 被撤销或刷新凭证失效后才会重新授权。Chrome 对新域名的 optional host permission 必须先在运行扩展的浏览器中点击授予，Channel 回复不能代替这个浏览器系统权限。设计边界见 [OAuth 配置与发布建议](OAUTH.md)。

刷新 Codex 模型时，WebClaw 会调用：

```text
/models?client_version=0.142.0
```

### GitHub Copilot OAuth

WebClaw 使用 GitHub OAuth device flow 登录 Copilot：

- Device code URL: `https://github.com/login/device/code`
- Access token URL: `https://github.com/login/oauth/access_token`
- Client ID: 暂时默认使用早期 WebClaw 版本采用的公开 GitHub Copilot Client ID，可在 Provider 中覆盖
- Copilot token URL: `https://api.github.com/copilot_internal/v2/token`
- Copilot-compatible base URL: `https://api.githubcopilot.com`
- 默认 model: `auto`

该公开 Client ID 不是秘密，但它不由 WebClaw 发布者控制，也不是稳定的第三方扩展契约，可能随服务端或分发政策变化而失效。正式发行版应注册自己的 GitHub OAuth App 或 GitHub App、启用 Device Flow 并覆盖默认值。不要把 Client Secret 放进扩展。

点击 `Sign in with GitHub` 后，WebClaw 会显示设备码，并在独立窗口打开 GitHub 授权页面。待授权状态由扩展后台 Alarm 持续轮询，因此 Settings 被隐藏或关闭也不会中断 token 保存；授权成功后独立窗口会关闭，并尝试重新聚焦原 Settings 窗口。GitHub access token 保存在 `chrome.storage.local`，重新打开 Provider 时会显示已连接。

选择 `auto` 时，WebClaw 会省略请求体里的 `model` 字段，让 Copilot 服务端执行 auto model selection。

## Agent 协议

WebClaw 不依赖模型原生 function calling，而是提示模型每一步输出一个 JSON 对象：

```json
{"tool":{"name":"get_page_context","args":{}}}
```

完成任务时输出：

```json
{"final":"Done"}
```

这种协议可以兼容本地模型、OpenAI-compatible 模型、Chrome AI、Codex 和 Copilot。

## Tool、Skill 和 Schedule

- Tool：可执行动作或返回结果的能力，例如读取页面、点击按钮、发送 HTTP 请求、推送企业微信消息。
- Skill：长期规则、领域知识或操作流程，例如“分析币安公告时重点关注合约、杠杆、保证金调整”。
- Schedule：可选高级功能，定时触发自然语言任务，例如“每天 09:00 检查币安公告并推送摘要”。

WebClaw 支持通过配置管理工具受控地增加 tool、skill 和 schedule，也可以把默认 Provider 切换到一个已经存在的 Provider。模型应先调用 `list_webclaw_config` 获取 Provider ID，再通过 `propose_webclaw_config_patch` 提交 `set_active_provider` 操作，最后使用返回的 patch ID 调用 `apply_webclaw_config_patch`。该能力只能切换 Provider，不能读取或修改 OAuth token、API Key、端点及其他 Provider 配置，并可以用 `rollback_webclaw_config_patch` 回滚最近一次变更。切换从下一次 Agent 请求或 Channel/Schedule 任务开始生效，当前正在执行的请求仍由原 Provider 完成。

```json
{"tool":{"name":"propose_webclaw_config_patch","args":{"operations":[{"op":"set_active_provider","providerId":"现有 Provider ID"}]}}}
```

## 页面翻译

打开目标页面后，对 WebClaw 说：

```text
帮我把当前页面翻译成中文
```

WebClaw 会使用 `translate_page` 工具收集可见文本节点，调用当前 Provider 翻译，并把翻译结果写回页面 DOM。它适用于普通 `http://` 和 `https://` 页面，不适用于 `chrome://extensions` 等浏览器内部页面。

## 实时查询

模型本身不知道实时信息。WebClaw 通过工具提供实时能力：

- `search_web`：打开搜索结果、读取页面并总结。
- `get_weather`：通过 Open-Meteo 查询天气。
- `get_page_context`：读取当前页面上下文。

例如：

```text
今天上海天气怎么样？
```

或：

```text
查一下币安最新公告并总结重点。
```

## 通道

WebClaw 支持把外部消息通道接入当前活跃会话：

- 微信 channel
- Telegram bot channel

企业微信机器人 webhook 不作为全局配置或 Channel，而是在 Tools 中编辑并启用 `qiyewechat_notification`。它支持 `text` 和 `markdown` 消息。该 Tool 的 Tool name 与 Display name 均固定为 `qiyewechat_notification`，调用时只使用这一规范名称。

当前设计是：可以有多个会话，但只有一个活跃会话。所有 channel 收到的消息都会进入当前活跃会话，这样可以在 Side Panel、微信、Telegram 等多个终端延续同一个任务上下文。

当 Channel 请求需要操作确认或 Codex 重新登录时，提示会返回原 Channel 会话。操作确认使用十分钟有效、绑定 Channel 与联系人的回复码；Codex 网页授权完成后会自动继续原任务。

## 安全说明

- JavaScript 执行默认关闭。开启总开关后，临时会话中的 `run_js` 每次都会显示目标页面和待执行代码并要求批准。Schedule 可以在第一次批准时记住完全相同的操作；Schedule、完整目标 URL、执行 world 或代码任一变化都会重新询问。
- 已保存的 Schedule 操作授权位于 Settings 的 Privacy & control，可随时全部清除。Chrome 域名权限被撤销后仍必须在浏览器中重新授予，保存的操作授权不会绕过它。
- `run_js` 要求 Chrome 135 或更高版本，并且只使用 Chrome `userScripts.execute()`，不提供 `eval` / `new Function` 回退。Chrome 138 及以上如果提示 API 不可用，请在扩展详情页打开 **Allow User Scripts** 后重新加载扩展。
- `userScripts` 注入不受页面 CSP 的动态求值限制，但不能突破浏览器同源策略、HttpOnly Cookie、扩展权限或系统权限。
- `run_js` 可直接接收 `code`，或通过 `vfsPath` 执行 VFS 内的 `.js`、`.mjs`、`.cjs` 文件；两者只能提供一个。
- `http_request` 在扩展 background 中执行，用于调用页面 JS 因 CORS 无法调用的接口或 webhook。
- `fs_shell` 仅操作扩展 IndexedDB 中的虚拟文件系统；不访问本机文件。它拒绝管道、重定向、命令替换和多命令输入，`rm` 会移动到 `/.trash`。
- 回收站会保存原路径和删除时间。`fs_restore` 默认拒绝同名覆盖，可选择 `onConflict: "rename"` 自动改名，或在 `confirmOverwrite: true` 时把现有目标移入回收站后恢复；`fs_purge` 与 `fs_empty_trash` 只能永久删除 `/.trash` 中的内容，并要求 `confirm: true`。
- 通过微信通道收到且已下载成功的媒体会归档到 `/inbox/<channel>/`；文件内容仍按当前 Provider 的媒体能力发送给模型。
- API key、OAuth token、Webhook、会话和通道状态存储在 `chrome.storage.local`。
- 页面内容和通道消息可能会发送给你当前选择的模型 Provider。
- HTTP(S) host access 使用 optional host permissions；首次访问页面、Provider、Channel 或网络 Tool endpoint 前会说明原因并按域名申请。
- 新增工具、Provider、Channel 时应优先考虑权限边界和数据泄露风险。

## 开发检查

运行与 CI 相同的语法检查：

```bash
./scripts/check-syntax.sh
node scripts/validate-release.mjs
```

## 打包

执行发布校验并按 `manifest.json` 版本生成最小化扩展包：

```bash
./scripts/package-extension.sh
```

输出位于 `dist/webclaw-<version>.zip`，压缩包根目录直接包含 `manifest.json`。完整流程见 [发布检查清单](RELEASE.md)，商店文案和素材见 [Chrome Web Store 上架资料](STORE_LISTING.md)。

## License

MIT
