# WebClaw

[English](README.en.md)

WebClaw 是一个 Chrome Manifest V3 浏览器扩展，把 AI Agent 运行在浏览器扩展环境中。它可以读取当前页面上下文、操作 DOM、调用受控的 Chrome 扩展 API、接入多种模型 Provider，并在用户明确开启后执行页面 JavaScript。

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
- 自定义 Tool、Skill、Schedule。
- 微信、Telegram、企业微信机器人通道。
- Chrome 内置 Prompt API 和 Summarizer API 支持。
- Agent 自管理能力：可通过受控 patch 增加 tool、skill、schedule。

## 仓库文档

- [English README](README.en.md)
- [隐私说明](PRIVACY.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)
- [发布检查清单](RELEASE.md)
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

WebClaw 内置 Codex CLI 兼容的设备码登录默认值：

- Issuer URL: `https://auth.openai.com`
- Authorization URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Codex backend URL: `https://chatgpt.com/backend-api/codex`

点击 `Sign in with ChatGPT` 后，WebClaw 会请求设备登录码，打开 ChatGPT 设备授权页面，在 Side Panel 显示设备码并轮询授权结果。授权成功后，access token 和 refresh token 会存入 `chrome.storage.local`。

刷新 Codex 模型时，WebClaw 会调用：

```text
/models?client_version=0.142.0
```

### GitHub Copilot OAuth

WebClaw 使用 GitHub OAuth device flow 登录 Copilot：

- Device code URL: `https://github.com/login/device/code`
- Access token URL: `https://github.com/login/oauth/access_token`
- Copilot token URL: `https://api.github.com/copilot_internal/v2/token`
- Copilot-compatible base URL: `https://api.githubcopilot.com`
- 默认 model: `auto`

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
- Schedule：定时触发自然语言任务，例如“每天 09:00 检查币安公告并推送摘要”。

WebClaw 支持通过配置管理工具受控地增加 tool、skill 和 schedule。模型只能提出结构化 patch，真正写入前会经过校验。

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
- 企业微信机器人 webhook

当前设计是：可以有多个会话，但只有一个活跃会话。所有 channel 收到的消息都会进入当前活跃会话，这样可以在 Side Panel、微信、Telegram 等多个终端延续同一个任务上下文。

## 安全说明

- JavaScript 执行默认关闭。只有在你信任当前任务和页面时才应开启。
- `run_js` 使用 Chrome `userScripts` API，能绕过页面 CSP 对动态脚本的限制，但不能突破浏览器同源策略、HttpOnly Cookie、扩展权限或系统权限。
- `run_js` 可直接接收 `code`，或通过 `vfsPath` 执行 VFS 内的 `.js`、`.mjs`、`.cjs` 文件；两者只能提供一个。
- `http_request` 在扩展 background 中执行，用于调用页面 JS 因 CORS 无法调用的接口或 webhook。
- `fs_shell` 仅操作扩展 IndexedDB 中的虚拟文件系统；不访问本机文件。它拒绝管道、重定向、命令替换和多命令输入，`rm` 会移动到 `/.trash`。
- 回收站会保存原路径和删除时间。`fs_restore` 默认拒绝同名覆盖，可选择 `onConflict: "rename"` 自动改名，或在 `confirmOverwrite: true` 时把现有目标移入回收站后恢复；`fs_purge` 与 `fs_empty_trash` 只能永久删除 `/.trash` 中的内容，并要求 `confirm: true`。
- 通过微信通道收到且已下载成功的媒体会归档到 `/inbox/<channel>/`；文件内容仍按当前 Provider 的媒体能力发送给模型。
- API key、OAuth token、Webhook、会话和通道状态存储在 `chrome.storage.local`。
- 页面内容和通道消息可能会发送给你当前选择的模型 Provider。
- 新增工具、Provider、Channel 时应优先考虑权限边界和数据泄露风险。

## 开发检查

运行与 CI 相同的语法检查：

```bash
node --check src/background.js
node --check src/content.js
node --check src/sidepanel.js
node --check src/chrome-ai-offscreen.js
node --check src/wechat-offscreen.js
node --check src/wechat-api.js
node --check src/wechat-media.js
node --check src/wechat-message.js
node --check src/wechat-storage.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8')); console.log('manifest ok')"
```

## 打包

开发者模式分享可直接打包 unpacked extension：

```bash
zip -r webclaw-0.1.0.zip manifest.json src assets README.md README.en.md LICENSE PRIVACY.md SECURITY.md \
  -x "*.DS_Store" \
  -x "*/.DS_Store"
```

压缩包根目录必须直接包含 `manifest.json`。

## License

MIT
