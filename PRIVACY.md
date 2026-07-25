# WebClaw 隐私政策 / Privacy Policy

生效日期 / Effective date: 2026-07-25

WebClaw 是一个“用户控制的浏览器 AI 助手”。它的单一用途是让用户在 Chrome 中与自己选择的模型对话，并在用户授权后执行网页操作、Tool、Channel 和可选的高级自动化。WebClaw 项目不运营用于转发提示词、网页内容或模型响应的后端服务。

WebClaw is a user-controlled browser AI assistant. Its single purpose is to let users converse with a model they select and, after user authorization, perform browser actions, Tools, Channels, and optional advanced automation. The WebClaw project does not operate a backend that proxies prompts, page content, or model responses.

## 1. 本地存储的数据 / Data Stored Locally

WebClaw 可在 Chrome 扩展存储和浏览器 IndexedDB 中保存：

- Provider 配置、模型选项、API key、OAuth access/refresh token 和登录状态；
- 会话消息、模型回复和受控长度的 Tool 轨迹；
- Tools、Skills、Schedules、Channels 及其启用状态；
- Telegram bot token、企业微信机器人 webhook、微信登录凭证和通道状态；
- 虚拟文件系统（VFS）、知识库索引以及 Channel 接收的图片或文件；
- VFS 静态预览使用的项目级 `localStorage` 兼容数据；这些数据保存在扩展的浏览器存储中，不是网页真实 origin 的存储，也不包含扩展凭证；
- 用户对产品披露、外部 Provider 和站点权限作出的选择；
- 最近的 Channel 授权回复路由，以及用户保存的精确 Schedule 操作授权指纹。

WebClaw may store the following in Chrome extension storage and browser IndexedDB:

- provider configuration, model choices, API keys, OAuth access/refresh tokens, and sign-in state;
- conversations, model replies, and length-limited Tool trajectories;
- Tools, Skills, Schedules, Channels, and their enabled state;
- Telegram bot tokens, enterprise WeChat robot webhooks, WeChat credentials, and channel state;
- the virtual file system (VFS), local knowledge index, and images or files received from Channels;
- project-scoped `localStorage` compatibility data used by VFS static previews; it is stored in extension browser storage, is not the website's real origin storage, and does not include extension credentials;
- user choices for product disclosure, external providers, and site permissions;
- recent Channel routes used for authorization replies and fingerprints of exact Schedule operations approved by the user.

这些数据默认留在当前 Chrome 用户配置文件中。请不要在公开的问题单中提交 token、私聊内容或其他秘密。

This data remains in the current Chrome profile by default. Do not post tokens, private messages, or other secrets in public issue reports.

## 2. 何时读取网页数据 / When Page Data Is Read

WebClaw 不再向所有网页常驻注入脚本。只有当用户请求的操作需要时，它才会申请当前站点的可选 host permission，并可能读取：当前 URL、标题、用户选中文本、可见文本、有限的 DOM 元素摘要，以及由已批准 JavaScript 返回的数据。

WebClaw does not inject a persistent script into every website. It requests an optional host permission only when a requested action needs it, and may then read the current URL, title, selected text, visible text, a limited DOM element summary, and data returned by approved JavaScript.

`run_js` 默认关闭。即使用户打开总开关，临时会话中的每次执行仍会显示目标页面和代码并要求批准。Schedule 可以在首次批准后保存完全相同操作的授权；指纹绑定 Schedule ID、完整目标 URL、执行 world 和代码，任一变化都会重新询问。保存记录包含哈希和简短范围说明，不另存一份源代码，并可在 Settings 的 Privacy & control 中清除。被批准的代码可能读取或修改页面可见内容，以及该页面脚本本身可访问的 Cookie、localStorage、sessionStorage 和 IndexedDB；它不能绕过浏览器同源策略、HttpOnly Cookie、Chrome 权限或操作系统权限。

`run_js` is disabled by default. Even after the global setting is enabled, every ad-hoc execution shows the target page and source and requires approval. A Schedule may save approval for an exact operation after first approval; its fingerprint binds the Schedule ID, full target URL, execution world, and code, and any change asks again. The saved record contains a hash and short scope description rather than a second copy of the source, and can be cleared under Settings > Privacy & control. Approved code may read or change page-visible content and page-accessible cookies, localStorage, sessionStorage, and IndexedDB. It cannot bypass the same-origin policy, HttpOnly cookies, Chrome permissions, or operating-system permissions.

## 3. 发送给模型 Provider 的数据 / Data Sent to Model Providers

首次向外部 Provider 发送数据前，WebClaw 会显示显著披露并要求确认。根据当前任务，发送内容可能包括：

- 用户提示词和当前活跃会话中相关的历史消息；
- WebClaw system instructions 和用户管理的 workspace 初始化文件；
- 用户要求读取的网页内容、Tool 结果或错误；
- 用户提供或通过 Channel 收到、且当前模型支持的图片和文件原始数据；
- 为完成请求所需的知识库片段。

Before first sending data to an external provider, WebClaw presents a prominent disclosure and asks for confirmation. Depending on the task, transmitted data may include:

- the user's prompt and relevant history from the active session;
- WebClaw system instructions and user-managed workspace initialization files;
- page content, Tool results, or errors requested for the task;
- original image or file data supplied by the user or received through a Channel when supported by the model;
- knowledge-base excerpts needed to answer the request.

数据直接从浏览器发送到用户配置的服务，例如本地 Ollama、OpenAI-compatible API、ChatGPT/Codex endpoint 或 GitHub Copilot endpoint。Chrome AI 内容由 Chrome 的内置 AI API 处理。第三方服务按照各自的条款和隐私政策处理数据。

Data is sent directly from the browser to the user-configured service, such as local Ollama, an OpenAI-compatible API, a ChatGPT/Codex endpoint, or a GitHub Copilot endpoint. Chrome AI content is processed through Chrome's built-in AI APIs. Each third-party service processes data under its own terms and privacy policy.

## 4. Channels、通知和网络 Tool / Channels, Notifications, and Network Tools

启用 Channel 后，来自微信或 Telegram 的消息和相关媒体会进入当前活跃会话，并可发送给当前模型 Provider；模型回复会返回原始会话。企业微信通知通过独立的 `qiyewechat_notification` Tool 发送。自定义 HTTP Tool 只在被调用时访问其配置的 endpoint。

When a Channel is enabled, messages and related media from WeChat or Telegram enter the active session and may be sent to the active model provider; model replies return to the originating conversation. Enterprise WeChat notifications are sent through the separate `qiyewechat_notification` Tool. A custom HTTP Tool accesses its configured endpoint only when invoked.

当 Channel 发起的任务需要产品内操作确认或 Codex 设备登录时，WebClaw 会把授权原因、短期回复码、授权网址或设备码发送回原 Channel 联系人。操作回复码绑定具体 Channel 和联系人并在十分钟后失效。最近路由仅用于把授权提示送回发起会话。OAuth token 成功签发后会复用并刷新，直到退出、撤销或失效。

When a Channel-originated task needs an in-product operation approval or Codex device login, WebClaw sends the reason, short-lived reply code, authorization URL, or device code back to the originating Channel peer. An operation reply code is bound to that Channel and peer and expires after ten minutes. Recent route data is used only to return authorization prompts to the originating conversation. Issued OAuth tokens are reused and refreshed until sign-out, revocation, or failure.

Channel、Schedules 和自我配置 Tool 是可选高级功能。启用后，它们可能在 Chrome 运行期间处理消息或任务。后台任务不能绕过尚未授予的站点权限或外部 Provider 披露。临时 `run_js` 仍逐次批准；Schedule 只能复用用户已保存的完全相同操作授权。

Channels, Schedules, and self-configuration Tools are optional advanced features. When enabled, they may process messages or tasks while Chrome is running. Background tasks cannot bypass missing site permissions or external-provider disclosure. Ad-hoc `run_js` remains per-execution; a Schedule can reuse only a user-saved approval for the exact same operation.

## 5. 数据出售、广告和分析 / Sale, Advertising, and Analytics

WebClaw 不出售或出租个人数据，不使用数据进行广告投放、信用评估或与产品单一用途无关的分析。本仓库版本不包含 WebClaw 自有遥测服务，也不会让开发者人工查看用户内容。

WebClaw does not sell or rent personal data, use it for advertising or credit decisions, or analyze it for purposes unrelated to the product's single purpose. This repository version contains no WebClaw-operated telemetry service and does not provide developer access for human review of user content.

## 6. 保留、删除和撤销 / Retention, Deletion, and Revocation

本地数据会保留到用户在 WebClaw 中删除相应会话、文件、Provider、Channel、Tool、Skill 或 Schedule，清除扩展存储，或卸载扩展。卸载扩展不会自动撤销第三方账户已经签发的 OAuth token；用户还应在相应服务的账户安全页面撤销授权。第三方已经接收的数据由其自身保留政策管理。

Local data remains until the user deletes the corresponding conversation, file, Provider, Channel, Tool, Skill, or Schedule; clears extension storage; or uninstalls the extension. Uninstalling does not automatically revoke OAuth tokens already issued by a third party; users should also revoke access from that service's account-security page. Data already received by a third party is governed by that party's retention policy.

用户可以在 Chrome 的扩展详情页撤销站点访问权限。撤销后，相关网页、Provider、Channel 或网络 Tool 将无法工作，直到用户再次明确授权。

Users can revoke site access from Chrome's extension details. The affected page action, Provider, Channel, or network Tool will stop working until the user explicitly grants access again.

用户还可以在 WebClaw Settings 的 Privacy & control 中清除全部已保存的 Schedule 操作授权。删除 Provider 或退出登录会删除 WebClaw 保存的相应 OAuth token；第三方账户侧的授权仍应在第三方安全页面撤销。

Users can also clear all saved Schedule operation approvals under Settings > Privacy & control. Deleting a Provider or signing out removes the corresponding OAuth tokens stored by WebClaw; authorization at the third-party account should still be revoked from that service's security page.

## 7. 安全 / Security

敏感配置保存在扩展本地存储中，但本地存储不应视为硬件级秘密保险库。使用共享设备时，应保护 Chrome 用户配置文件。只安装受信任的版本，只配置受信任的 Provider、webhook 和自定义 HTTP Tool，并在批准 `run_js` 前检查代码。

Sensitive configuration is kept in extension-local storage, but local storage is not a hardware-backed secret vault. Protect the Chrome profile on shared devices. Install only trusted builds, configure only trusted providers, webhooks, and custom HTTP Tools, and inspect code before approving `run_js`.

## 8. Chrome Web Store Limited Use

WebClaw 对从 Chrome API 或用户授权的网站获得的信息的使用和传输，将遵守 Chrome Web Store User Data Policy，包括 Limited Use 要求。数据只用于提供或改进用户明确请求的 WebClaw 功能。

WebClaw's use and transfer of information received from Chrome APIs or user-authorized websites will comply with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide or improve the WebClaw functionality explicitly requested by the user.

## 9. 变更与联系 / Changes and Contact

本政策发生实质变化时，会在仓库提交历史和发布说明中记录，并更新生效日期。隐私问题可通过 [GitHub Issues](https://github.com/leiyin321/webclaw/issues) 联系维护者；涉及漏洞或秘密时，请使用 [GitHub Security Advisories](https://github.com/leiyin321/webclaw/security/advisories/new)，不要创建公开 issue。

Material changes will be recorded in repository history and release notes, with an updated effective date. Contact the maintainer through [GitHub Issues](https://github.com/leiyin321/webclaw/issues) for privacy questions. For vulnerabilities or secrets, use [GitHub Security Advisories](https://github.com/leiyin321/webclaw/security/advisories/new) instead of a public issue.
