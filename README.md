# WebClaw

[English](README.en.md)

WebClaw 是一个“用户控制的浏览器 AI 助手”，以 Chrome Manifest V3 扩展运行。它可以接入用户选择的模型 Provider，并在显著披露、按域名授权和高风险操作确认的约束下读取页面、操作 DOM 和调用受控 Tool。

## 项目状态

WebClaw 目前是实验性的浏览器原生 Agent 框架，适合本地开发、个人自动化和受控测试流程。它具备读取网页、调用模型、收发通道消息和执行工具的能力。在敏感网站、凭证、消息通道或自动发送场景中使用前，请先阅读 [隐私说明](PRIVACY.md) 和 [安全说明](SECURITY.md)。

## 功能概览

- Chrome Side Panel 会话界面；模型最终回复和流式文本支持安全 Markdown 渲染，包括标题、强调、列表、引用、代码块、表格与链接。
- 设置与文件管理器通过独立扩展窗口打开，不遮挡会话。
- 多会话 Session 管理，所有通道消息进入当前活跃会话。
- Provider 管理：Local Ollama、OpenAI-compatible API、OpenCode Zen、Chrome AI、Codex / ChatGPT OAuth、GitHub Copilot OAuth。
- 模型列表刷新、模型下拉选择、Thinking mode 配置。
- 统一 Tool Registry：内置 Tool 的名称、JSON Schema、权限、风险、调度和管理界面元数据来自同一事实源；参数在执行前递归校验，结果以统一信封反馈给模型。
- 浏览器 Tool：通过 `page_snapshot`、`page_action`、`page_wait`、`page_extract`、`page_screenshot`、`page_storage`、`page_file_input` 和 `browser_tabs` 执行可验证的页面与标签页操作；`run_js` 仅作为需审批的高级能力。
- 可选浏览器能力：标签组、最近关闭页面、下载、书签、历史、剪贴板和本机通知按 Tool 启用，并按需申请 Chrome optional permissions；剪贴板读取与写入分别使用 `browser_clipboard_read` 和 `browser_clipboard_write`，不会为只读任务申请写权限。
- 虚拟文件系统：文件管理器与 Agent Tool 共享 IndexedDB 文件系统；支持结构化读写、搜索、glob、hash、diff、patch、归档、预览，以及由 `fs_manage` 和 `fs_trash` 提供的统一文件管理与回收站操作。
- VFS 静态网页预览：文件管理器中的 HTML/HTM/XHTML/SVG 文件可直接打开到独立 Chrome 标签页，预览运行时会从 VFS 加载同目录的 CSS、JS、图片、字体和 JSON 资源。
- 预览页面运行在隔离的 Extension Sandbox 中；网页可使用由 WebClaw 提供的项目级 `localStorage` 兼容层，数据保存在浏览器本地，不访问扩展凭证。该兼容层不是网站真实 origin 的 `localStorage`。
- 本地知识库：将 VFS 文本文件索引到浏览器本地 IndexedDB，支持 collection/path/tag/time 过滤和 `knowledge_reindex`；首次启动会创建并索引 WebClaw 操作手册。
- 办公文档：统一的 `documents` Tool bundle 支持 Markdown 完整操作、DOCX/XLSX/PPTX/PDF Rich Schema 创建、DOCX/XLSX/PPTX rebuild 编辑，以及四种二进制格式的受限投影读取、导出和 revision 恢复；未实现能力通过 `warnings` 和 `partial` fidelity 明确返回。
- 动态 Tool 暴露：每轮只向模型注入核心能力，模型可调用 `tool_search` 按任务、分类或 bundle 加载当前运行所需的已启用 Tool，减少小模型选择歧义。
- 工作区记忆：自动初始化 `AGENTS.md`、`SOUL.md`、`TOOLS.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md` 及每日记忆文件，并在每次 Agent 运行前按上下文预算注入。
- 受控 Tool 轨迹：保留受限长度的工具结果和失败原因，用于后续会话与 Provider 切换时的自我纠错。
- 统一 Agent Runtime：所有 Provider、Side Panel、Channel 和 Schedule 共用 Turn、Item、Tool、Plan、审批、停止和上下文压缩机制。
- 临时任务栈：复杂任务可通过 `task_push` 创建独立上下文的子任务；子任务可以继续压入次级任务，并以 JSON Schema 约束的结构化结果返回父任务。
- 结构化 Agent 响应：Chrome AI 使用 Prompt API `responseConstraint`，Ollama 使用 `format` JSON Schema，OpenAI-compatible 在 Provider Adapter 内协商 `json_schema`、`json_object` 或仅提示词约束，Copilot 根据模型元数据自动选择 Responses 或 Chat Completions 并使用兼容的 JSON Tool 协议，Codex 使用原生函数调用。
- 受限 `fs_shell`：可在该虚拟文件系统中执行 `pwd`、`cd`、`ls`、`stat`、`mkdir`、`touch`、`cat`、`cp`、`mv`、`rm`，`cd` 会更新当前会话的工作目录，不执行真实系统 Shell。
- 自定义 Tool、Skill，以及可选的高级 Schedule 和自我配置 Tool。
- 微信和 Telegram Channel；企业微信机器人通知由独立的 `qiyewechat_notification` Tool 提供。
- Chrome 内置 Prompt API 和 Summarizer API 支持。
- Agent 自管理能力：可通过受控 patch 增加 tool、skill、schedule，或切换现有默认 Provider。

## Agent 架构

WebClaw 只维护一套外层 Agent Runtime。它把一次请求表示为 `Turn`，把模型输出、Tool 调用、Tool 结果和计划表示为有状态的 `Item`，并统一处理流式输出、停止、审批、错误反馈、历史持久化和上下文压缩。Side Panel、微信、Telegram 和 Schedule 都调用同一运行时。

核心循环由显式状态机驱动，并通过 AgentService 按会话串行。ToolScheduler 支持 JSON Schema 参数校验、Codex 原生多 Tool Call、相邻只读调用并行、写操作屏障、operation key 去重和未知外部副作用保护。RunStore 使用独立 IndexedDB 保存脱敏事件、checkpoint、Tool operation 和大型结果 artifact；run lease 与写入 owner 在同一事务中校验，checkpoint 或 lease 写入失败会停止执行。确定性边界可在 Service Worker 中断后继续，并恢复原有预算、重试次数和无进展检测状态；已完成 Tool 会复用 observation，安全或可重试 Tool 可从原调用继续，未知副作用不会自动重放。等待审批会重新呈现在 Side Panel 或原 Channel。重复 Tool Call 与相同 observation 会先触发纠偏，持续无进展时进入 `stuck`，不会无限循环。

模型差异限制在 Provider Adapter 内。每种 Provider 只负责认证、消息与媒体编码、请求端点、流解析、上下文能力，以及原生 function calling 或 JSON Tool transport 的转换。适配器最终都返回统一的 assistant 或 tool-call 响应，因此切换 Provider 不会切换 Agent 工作流。Codex 当前使用原生 function calling；未提供可用原生 Tool 响应的 Provider 使用适配器内的 JSON transport fallback。

复杂任务可调用 `update_plan` 发布或更新计划。长会话超过当前模型的适配器预算时，运行时会压缩较早历史，保留近期消息、目标、约束、已验证 Tool 结果、错误和未完成事项。压缩摘要属于 WebClaw 生成的执行状态，不作为用户指令。

### 临时任务栈

每次用户输入只创建一次 AgentRun，初始任务栈为空，不会自动创建根 Task。`task_push` 用于让模型按需把可独立完成的工作压入一次性任务栈。每个 Task 有独立模型上下文，只接收明确传入的 `instruction`、`context`、工作目录和 `outputSchema`；调用它的 Agent 或父 Task 同步等待结构化结果。Task 可以继续调用 `task_push`，默认最大深度为 4、每个 AgentRun 最多创建 16 个 Task。Settings 可调整这两个值和显式任务树的模型步骤预算，其中步骤预算 `0` 表示不设总上限；根 AgentRun 的普通模型步骤不计入 Task 预算。`task_stack` 可读取当前显式任务栈和预算。

Task 不会写入 Tool 配置，也不会固化成 Workflow。完成或失败后，其完整上下文从活动栈删除；调用方收到统一结果信封及符合 JSON Schema 的 `output`，并至少再执行一个模型回合来整合结果，然后才判断当前 Agent 是否完成。即使 `task_push` 位于最后一个常规步骤，运行时也会保留该整合回合，但这个保留回合不能绕过步骤限制继续执行 Tool。活动栈快照和最近运行的状态、计数、预算及错误摘要保存在当前 Chrome 配置文件，用于诊断中断，不重复保存最终回答，也不会自动恢复或重放不确定的外部操作。

当前 `outputSchema` 支持受控 JSON Schema 子集：`type`、`properties`、`required`、`additionalProperties`、`items`、`enum`、`const`、字符串/数组长度和数值上下限；不接受 `$ref`、`$defs`、`oneOf`、`anyOf`、`allOf` 或递归 Schema。

```json
{"tool":{"name":"task_push","args":{"title":"核对来源","instruction":"检查候选来源并返回可靠项","context":{"sources":["https://example.com"]},"outputSchema":{"type":"object","properties":{"reliable":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"}},"required":["reliable","summary"],"additionalProperties":false},"maxSteps":6}}}
```

Workflow 仍是持久化、可复用的自定义 Tool；Task 是仅在一次执行中存在的调度实例。Task 可以调用 Workflow，Workflow 也可以使用 `task_push` 动态拆分临时子任务。

## 仓库文档

- [English README](README.en.md)
- [隐私说明](PRIVACY.md)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)
- [发布检查清单](RELEASE.md)
- [OAuth 配置与发布建议](OAUTH.md)
- [Chrome Web Store 上架资料](STORE_LISTING.md)
- [Agent Loop 架构与恢复语义](docs/agent-loop-architecture.md)
- [0.6.1 Tool 升级改造规划](docs/tool-upgrade-plan.md)
- [0.7.x 办公文档能力设计与实现状态](docs/office-document-capability-plan.md)
- [0.7.x 复杂样式文档生成迭代计划](docs/rich-document-generation-plan.md)
- [许可证](LICENSE)

## 在 Chrome 中加载

1. 在仓库目录执行 `npm ci && npm run build:documents`。
2. 打开 `chrome://extensions`。
3. 开启右上角 `Developer mode`。
4. 点击 `Load unpacked`，选择根部包含 `manifest.json` 的本仓库目录。
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
- API protocol: `Auto`、`Responses API` 或 `Chat Completions`
- API key
- Model

模型列表刷新会调用兼容接口：

```text
GET /models
```

`Auto` 会优先采用 `/models` 为当前模型声明的 `supported_endpoints`；服务端没有返回端点元数据时继续使用 Chat Completions，以保持旧配置兼容。也可以明确选择 Responses API，使 WebClaw 调用 `POST /responses`，使用 `instructions + input`、`text.format`、`reasoning.effort` 和 Responses SSE 事件。DeepSeek `deepseek-v4-flash` 可将 Base URL 设置为 `https://api.deepseek.com` 并明确选择 Responses API。

“OpenAI-compatible”不代表服务端实现了 OpenAI 的全部可选能力。两种协议都会在 Provider Adapter 内协商结构化输出：优先 JSON Schema，服务端明确表示不支持时降级为 JSON Object，再降级到仅提示词约束和 WebClaw 本地 Schema 校验。成功模式按协议、Provider、端点和模型在扩展本地缓存 7 天。

### OpenCode Zen

Provider type 选择 `OpenCode Zen`，填写从 OpenCode Zen 获取的 API key，然后点击 Refresh 获取官方模型列表。默认 Base URL 为：

```text
https://opencode.ai/zen/v1
```

WebClaw 根据 OpenCode 官方模型协议自动路由：GPT 系列使用 `/responses`，Claude 和 Qwen 系列使用 `/messages`，Grok、DeepSeek、GLM、MiniMax、Kimi 及兼容模型使用 `/chat/completions`。当前下拉列表会过滤需要 Google GenerateContent 专用协议的 Gemini 模型，避免选择后产生不兼容请求。

### Chrome AI

Provider type 选择 `Chrome AI` 后，WebClaw 会通过 Chrome 内置 Prompt API 使用本机模型。由于 MV3 background service worker 不能直接调用 Prompt API，WebClaw 会从 offscreen extension document 调用。

Chrome AI 需要支持内置 AI 的 Chrome 版本、合适硬件、足够磁盘空间，以及已下载或可下载的 Gemini Nano 模型。可在以下页面排查：

```text
chrome://on-device-internals
```

当 `page_snapshot` 页面正文较长时，WebClaw 会优先用 Chrome Summarizer API 对页面内容做摘要，再把摘要传给 Prompt API，以降低上下文超限概率。

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
/models?client_version=0.145.0
```

`client_version` 与当前兼容的 Codex CLI 身份保持同步。Codex 服务端会按最低客户端版本控制模型可见性，因此版本过旧时，即使账号已经具备权限，刷新结果也可能缺少新模型。WebClaw 只显示服务端返回且标记为可列出、API 可用的模型，不额外混入写死的旧模型目录。

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

刷新模型时，WebClaw 以当前兼容的 Copilot CLI 客户端身份请求 `GET /models`。下拉列表只显示服务端针对当前账号、套餐和组织策略返回的可选模型，产品范围可参考 GitHub 的[官方支持模型列表](https://docs.github.com/en/copilot/reference/ai-models/supported-models)。每个模型的 `supported_endpoints` 会保存在 Provider 模型元数据中：支持 `/responses` 的模型自动使用 Responses API，只支持 `/chat/completions` 的模型使用 Chat Completions；同时支持两者时优先使用 Responses。这使仅提供 Responses API 的 GPT-5.3、GPT-5.4 mini、GPT-5.5 和 GPT-5.6 系列可以被选择并正常调用，而不是因缺少 `/chat/completions` 被过滤。

选择 `auto` 时，WebClaw 会省略请求体里的 `model` 字段，让 Copilot 服务端执行 auto model selection。

Copilot Responses 模型的 Thinking mode 会转换为标准 reasoning effort：开启为 `medium`，关闭为 `low`。Chat Completions 模型不附加未文档化的 thinking 参数。

## Agent 协议

所有 Provider 共用同一个 Agent Runtime。Provider Adapter 负责认证、消息格式、流式响应、媒体编码、上下文能力，以及原生 function calling 或 JSON Tool transport；因此切换 Provider 不会改变会话、Tool、Plan、审批、停止和持久化机制。模型每一步通常输出一个 JSON Tool 对象：

```json
{"tool":{"name":"page_snapshot","args":{}}}
```

完成任务时输出：

```json
{"final":"Done"}
```

支持结构化输出的 Provider 会使用对应的 JSON Schema 或原生 Tool calling；不支持时使用兼容的 JSON transport。运行时将它们统一成相同的 Tool 调用和最终结果格式。

全局 `Max steps` 只要求填写正整数，不设置人为的最大值；它限制单次 Agent 运行的步数，不等同于 Provider 的上下文或服务端限额。

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

- `web_search`：优先通过用户在该 Tool 中配置的 Brave Search API 返回结构化标题、URL 和摘要，并缓存相同查询；未配置 Brave API Key 或 Brave 调用失败且允许回退时，使用配置的浏览器搜索引擎打开结果页。搜索结果属于不可信外部内容，Agent 应继续检查可靠来源页面后再回答。
- `get_weather`：通过 Open-Meteo 查询天气。
- `page_snapshot`：读取当前页面上下文；`page_extract` 可进一步提取链接、表格、表单和元数据。

配置方法：打开 Settings -> Tools，编辑 `web_search`，选择 `Auto` 或 `Brave Search API`，填写从 Brave Search API 控制台获取的 API Key 并保存。Tool name 与 Display name 均固定为 `web_search`；旧名称 `search_web` 已移除，仅保留其浏览器搜索行为作为内部回退。

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

- `run_js` 使用四种互斥运行环境：`compute` 隔离计算、`page-isolated` USER_SCRIPT 页面代码、`page-main` MAIN 页面代码、`extension` 显式白名单 RPC。它们不是累积权限等级。`compute` 无外部能力，可直接执行；其余环境默认关闭并要求批准。
- 临时会话中的非 compute 执行会显示 runtime、RPC scope 或页面目标及代码。Schedule 可以记住完全相同的操作；Schedule、runtime、capabilities、页面目标或代码任一变化都会重新询问。
- 已保存的 Schedule 操作授权位于 Settings 的 Privacy & control，可随时全部清除。Chrome 域名权限被撤销后仍必须在浏览器中重新授予，保存的操作授权不会绕过它。
- 两种页面 runtime 要求 Chrome 135 或更高版本，并使用 Chrome `userScripts.execute()` 直接执行普通 `window`/`document` 代码，不再使用嵌套页面 RPC。Chrome 138 及以上如果提示 API 不可用，请在扩展详情页打开 **Allow User Scripts** 后重新加载扩展。
- `extension` 只暴露 `webclaw.*`；每次 RPC 都会校验精确 methods、VFS 路径、网络 origin 和 Chrome optional permission。不会开放 `identity`、`storage`、`runtime`、`permissions`、`scripting`、`userScripts` 等控制 API。详细接口见 [run_js execution runtimes](docs/run-js-runtimes.md)。
- `run_js` 可接收 `code`，或通过 `vfsPath` 执行 VFS 内的 `.js`、`.mjs`、`.cjs` 文件；两者只能提供一个。无授权的 `compute` 只接受内联代码。
- `http_request` 在扩展 background 中执行，用于调用页面 JS 因 CORS 无法调用的接口或 webhook；支持超时、JSON、表单、VFS multipart 文件、二进制响应和直接保存到 VFS。
- `fs_shell` 仅操作扩展 IndexedDB 中的虚拟文件系统；支持 `pwd`、`cd`、`ls`、`stat`、`mkdir`、`touch`、`cat`、`cp`、`mv`、`rm`。`cd` 会校验目标目录并更新当前会话的工作目录，后续相对路径从该目录解析；它不访问本机文件，也拒绝管道、重定向、命令替换和多命令输入，`rm` 会移动到 `/.trash`。
- `fs_manage` 统一执行 mkdir、move、copy、touch 和可恢复删除；`fs_trash` 统一执行 list、restore、purge 和 empty。恢复默认拒绝同名覆盖，可选择 `onConflict: "rename"` 自动改名，或在 `confirmOverwrite: true` 时把现有目标移入回收站后恢复；purge 与 empty 只处理 `/.trash`，并要求 `confirm: true`。
- 通过微信通道收到且已下载成功的媒体会归档到 `/inbox/<channel>/`；文件内容仍按当前 Provider 的媒体能力发送给模型。
- API key、OAuth token、Webhook、会话和通道状态存储在 `chrome.storage.local`。
- 页面内容和通道消息可能会发送给你当前选择的模型 Provider。
- HTTP(S) host access 使用 optional host permissions；首次访问页面、Provider、Channel 或网络 Tool endpoint 前会说明原因并按域名申请。
- 新增工具、Provider、Channel 时应优先考虑权限边界和数据泄露风险。

## 开发检查

运行与 CI 相同的语法、Agent Loop 和发布检查：

```bash
npm ci
npm run build:documents
npm run test:documents
./scripts/check-syntax.sh
node scripts/test-agent-runtime.mjs
./scripts/test-agent-loop.sh
node scripts/test-provider-client-metadata.mjs
node scripts/test-openai-compatible-structured-output.mjs
node scripts/validate-release.mjs
```

复杂文档生成按 [复杂样式文档迭代计划](docs/rich-document-generation-plan.md) 分阶段启用。当前 0.7.x 已接入 DOCX、PDF、XLSX、PPTX 的首版生成引擎；图表、中文 PDF 字体、复杂样式编辑和视觉 QA 仍按计划增强，工具返回的 `warnings` 是能力边界的正式说明。

## 打包

执行发布校验并按 `manifest.json` 版本生成最小化扩展包：

```bash
./scripts/package-extension.sh
```

输出位于 `dist/webclaw-<version>.zip`，压缩包根目录直接包含 `manifest.json`。完整流程见 [发布检查清单](RELEASE.md)，商店文案和素材见 [Chrome Web Store 上架资料](STORE_LISTING.md)。

## License

MIT
