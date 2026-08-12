# Chrome Web Store 上架资料

## 基本信息

**名称**

WebClaw - 浏览器 AI 助手

**简短说明**

用户控制的浏览器 AI 助手：连接自选模型，在逐项授权后对话、读取页面并执行受控操作。

**Single purpose**

WebClaw lets a user converse with a model they select and explicitly authorize that assistant to inspect or act on browser content needed for the user's request.

## 详细说明

WebClaw 是一个用户控制的 Chrome 浏览器 AI 助手。用户可以连接 Local Ollama、OpenAI-compatible API、OpenCode Zen、Chrome AI，以及实验性的 OAuth Provider。Codex 和 GitHub Copilot 集成暂时使用公开 Client ID 作为兼容默认值，相关来源边界、替换方式和失效风险在产品及 `OAUTH.md` 中披露。

在会话中，WebClaw 可以根据用户请求读取当前页面上下文、点击或输入、翻译页面、搜索网页、调用受控 HTTP Tool，以及管理扩展本地的虚拟文件和知识库。文件管理器可以在隔离的 Chrome 标签页中预览 VFS 内的静态 HTML 网站及其相对资源，也可以打开 Markdown、DOCX、XLSX、PPTX 和 PDF 的本地受限投影。办公文档处理不执行宏、外部链接、公式或嵌入脚本，也不使用远程转换服务。网页和外部服务采用按域名申请的 optional host permissions；向外部模型首次发送数据前会披露数据范围；JavaScript 执行默认关闭，临时调用逐次批准，Schedule 只有在用户首次检查并允许后才能复用完全相同操作的授权。

内置 Tool 由统一 Registry 定义并在执行前校验参数。每轮模型只接收核心 Tool；`tool_search` 可以把用户已启用、且已具备权限的匹配能力加载到当前运行。书签、历史、下载、最近关闭页面、标签组、剪贴板和本机通知均为默认关闭的可选 Tool，并在首次使用时单独申请对应 Chrome optional permission。

复杂请求可以使用临时任务栈拆分为独立上下文的子任务。子任务只继承当前 Provider 和不超过父任务范围的已启用 Tool，其结果按照声明的 JSON Schema 在浏览器本地校验；完成后子任务上下文从活动栈删除。

所有 Provider 共用同一 Agent Runtime。运行状态、脱敏事件、边界 checkpoint 和 Tool operation 状态保存在浏览器本地，用于在扩展后台中断后恢复确定性任务；已经完成的 Tool 结果不会重复执行，只有明确标记为安全或可重试的操作才会自动继续，外部副作用不确定的操作保持待检查状态。

Channels、Schedules 和自我配置 Tool 是可选高级功能。只有用户显式配置并启用后才工作。WebClaw 仓库版本不运营用于转发提示词、页面内容或模型响应的后端服务。

企业微信机器人推送不使用全局通知配置，而是通过用户单独配置并启用的 `qiyewechat_notification` Tool 发送；其 Tool name 与 Display name 使用同一规范名称。

## 权限用途

- `alarms`: 运行用户明确启用的 Schedule、OAuth 轮询和 Channel 保活。
- `identity`: 支持用户配置的 OAuth 流程和扩展 redirect URL。
- `offscreen`: 在 MV3 service worker 不支持对应 DOM/API 时运行 Chrome AI 和内置微信 Channel 文档。
- `sidePanel`: 提供主要会话界面。
- `scripting`: 在用户已授权的目标站点按需注入页面操作脚本。
- `storage`: 保存配置、凭证、披露确认和扩展状态。
- `tabs`: 管理用户请求的标签页操作，并支持受限的标签页 Tool。
- `userScripts`: 仅供 `run_js` 的 `page-isolated`/`page-main` 在批准的页面直接运行模型代码；`compute` 在 Manifest Sandbox 中无授权运行纯计算，`extension` 在 Sandbox 中只调用显式白名单 RPC。非 compute 临时调用逐次批准，Schedule 仅复用 runtime、capabilities、页面目标和代码均相同的批准。
- `windows`: 把设置和文件管理器放在独立扩展窗口中。
- `optional_permissions`: 仅当用户启用并使用相应 Tool 时，访问书签、历史、下载、最近关闭页面、标签组、剪贴板或创建本机通知；未授权能力不会暴露给模型。
- `optional_host_permissions`: 首次访问具体网页、模型 Provider、Channel 或 HTTP Tool endpoint 前说明原因并按 origin 请求；安装时不要求全站访问。

## 数据披露摘要

- 本地保存：Provider、token/API key、会话、Tools、Skills、Schedules、Channels、VFS、知识库和 Channel 媒体。
- 外部发送：用户提示词、相关会话历史，以及当前任务明确需要的页面内容、文件、媒体、知识片段和 Tool 结果。
- 接收方：仅用户配置或启用的模型 Provider、Channel、webhook 或 HTTP endpoint。
- 不出售数据，不投放广告，不包含 WebClaw 自有遥测或人工内容审阅后台。
- 完整政策：[PRIVACY.md](PRIVACY.md)。公开 URL 可先使用 `https://github.com/leiyin321/webclaw/blob/main/PRIVACY.md`，正式发布更推荐固定的 GitHub Pages URL。

## 素材

- Manifest icons: `assets/icons/icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-128.png`
- Store icon source: `assets/icons/icon.svg`
- Screenshot: `assets/store/screenshot-chat-1280x800.png`
- Permission screenshot: `assets/store/screenshot-approval-1280x800.png`
- Small promo tile: `assets/store/promo-small-440x280.png`
- Marquee promo tile: `assets/store/marquee-1400x560.png`

提交前应在最终发布构建中重新截图，确保 Provider 名称、披露文案和操作界面与商店图片一致。

## Dashboard 检查

1. Category 选择 `Productivity`。
2. Language 默认选择中文，并补充英文说明。
3. Privacy policy 填公开 HTTPS URL。
4. Data usage 表单与 `PRIVACY.md` 保持一致，声明 authentication information、website content、user activity 和 personal communications（启用 Channel 时）。
5. 说明 optional host permissions 的逐域名申请方式。
6. 测试账号或审核说明不得包含真实用户 token；说明 Local Ollama 和可选 Provider 的测试方式。
7. 对 `run_js` 明确说明默认关闭、临时调用逐次批准、精确 Schedule 授权复用和 `userScripts` 用途。
8. Remote Code 字段如实选择使用远程逻辑，并说明模型返回的 `compute` 代码在 Manifest Sandbox 中无外部能力运行，页面 runtime 通过 Chrome 135+ 的 `userScripts.execute()` 直接执行，`extension` 只使用显式白名单 RPC；非 compute 需要总开关和逐次批准，Schedule 只复用 Schedule、runtime、capabilities、页面目标和代码均相同的批准；代码中没有 `eval` / `new Function` 回退。不要选择 “No” 隐瞒该功能。
9. Reviewer notes 中给出复现步骤：接受首次披露，先运行一个纯计算 `compute`，确认不申请页面或 RPC 权限；再启用 JavaScript 总开关并要求模型使用 `page-isolated` 读取 `document.title`，确认审批框显示目标站点和完整代码且拒绝时不执行。创建同一 Schedule，确认首次批准后完全相同的执行可复用授权、修改代码会重新询问、Settings 可清除授权。
10. Reviewer notes 如实披露 Codex CLI 与 GitHub Copilot public Client ID 的临时兼容用途，并提供 `OAUTH.md`。这不保证审核接受这些应用身份；若审核要求发布者自有客户端，应在提交前替换默认值或移除对应 OAuth 集成。

## 已知审核风险

Chrome Web Store 的 Remote Hosted Code 政策可能把模型生成并执行的 JavaScript 视为远程代码，即使它使用 `userScripts` 且经过用户批准。Schedule 授权复用会进一步提高审核风险。当前实现降低了权限和告知风险，但不能保证该功能一定通过审核。若审核结论要求完全禁止模型生成代码执行，应为商店构建移除 `run_js`、`userScripts` 权限和相关 UI，而不是尝试隐藏该行为。
