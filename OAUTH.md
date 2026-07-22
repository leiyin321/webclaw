# OAuth 配置与发布建议

浏览器扩展属于 public client，扩展包中的任何值都可以被用户读取。因此：

- OAuth Client ID 是公开标识，不是凭证，但发行版通常应使用发布者有权使用的应用身份；
- OAuth Client Secret 不能放进扩展、Git 仓库、构建变量产物或商店审核说明；
- 当前仓库对 Codex 和 GitHub Copilot 做了明确记录的临时例外：分别使用公开的兼容 Client ID 维持现有 Provider 可用性；
- 发行版的公开 Client ID 统一配置在 `src/oauth-clients.js`，用户仍可在 Provider 页面覆盖；
- token 只保存在扩展本地存储，不写入日志、会话、VFS 或截图。

## GitHub Copilot

当前纯扩展实现使用 GitHub Device Flow。为了让 Copilot Provider 无需先注册应用即可连接，本仓库暂时恢复早期 WebClaw 使用的公开 GitHub Copilot Client ID。它不是 Client Secret，但不由 WebClaw 发布者控制，也不是面向第三方扩展的稳定集成契约，可能因服务端、风控或分发政策变化而失效。

正式发行版仍应注册一个由发布者控制、只用于 WebClaw 的 GitHub OAuth App 或 GitHub App，启用 Device Flow，并替换 `src/oauth-clients.js` 中的默认值。Provider 页面中的非空 Client ID 会覆盖临时默认值。

1. 在 GitHub Developer settings 创建应用。
2. 设置可识别的应用名、主页和隐私政策 URL。
3. 启用 Device Flow。
4. 只把 Client ID 配置到 WebClaw；Device Flow 不需要把 Client Secret 放进扩展。
5. 在应用信息、Chrome Web Store 披露和隐私政策中保持开发者身份一致。

官方资料：

- [Creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)
- [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [Best practices for creating an OAuth app](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app)
- [GitHub OAuth for the Copilot SDK](https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth)

GitHub 提醒 public client 无法保护 Client Secret，并更偏好 Authorization Code + PKCE，而 Device Flow 主要面向 CLI、IoT 或无头环境。对 WebClaw 有三个可选阶段：

- **当前兼容阶段**：使用公开兼容 Client ID，明确披露其来源边界和失效风险，并允许用户覆盖；
- **正式纯扩展发布**：继续使用 Device Flow，但换成发布者自己的 Client ID，明确显示设备码和 GitHub 域名，并保持最小 scope；
- **采用生产级 OAuth 后端**：由发布者后端保管 Client Secret、完成 Authorization Code + PKCE 的 token exchange，并在隐私政策中增加该后端及数据处理说明。

当前项目仍保持纯扩展架构，不引入 WebClaw 运营的凭证后端。若未来采用 OAuth 后端，回调地址应使用 `chrome.identity.getRedirectURL()` 并在 GitHub 应用中登记完全一致的 redirect URI。

## Codex / ChatGPT OAuth

OpenAI 的公开 Codex app-server 文档描述了由 app-server 管理的 ChatGPT browser/device-code 登录和 token 刷新，但没有文档化一个供任意第三方 Chrome 扩展注册客户端的通用流程。

为了保留当前 Codex Provider，本仓库暂时使用公开的 Codex CLI Client ID。这个值是 public client identifier，不是 Client Secret；但它仍属于 Codex CLI 的应用身份，是一个未被文档化为第三方扩展契约的兼容依赖。服务端、OAuth 风控或 Chrome Web Store 审核策略变化都可能使它失效。

当前实现遵循以下边界：

- 临时默认值只在 `src/oauth-clients.js` 出现一次，Provider 可以显式覆盖；
- 不包含、请求或记录 Client Secret；
- access token、refresh token 和设备登录状态只保存在当前 Chrome profile 的扩展本地存储；
- Side Panel 请求缺少 token 时，用户在产品内确认后启动设备登录；
- 微信或 Telegram 请求缺少 token 时，授权提示、验证网址和设备码返回原 Channel，会话在网页授权成功后继续；
- token 正常刷新时不重复登录；退出、撤销或 refresh token 失效后重新授权；
- 新的 OAuth/Provider origin 仍必须由用户在 Chrome 中通过 user gesture 授予，远程 Channel 回复不能授予 optional host permission。

官方提供第三方客户端注册方式后，应迁移到发布者自己的应用身份。若该临时 Client ID 失效，可由用户覆盖获授权的 public Client ID，或改用 OpenAI-compatible API Provider。更稳妥但不再是纯扩展的方案，是让独立本地应用运行官方 Codex app-server 并管理登录。

官方资料：

- [Codex app-server](https://learn.chatgpt.com/docs/app-server)
- [Codex app-server auth endpoints](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [OpenAI API authentication](https://platform.openai.com/docs/api-reference/authentication)

## 发布检查

- 商店包中不存在任何 Client Secret。
- Codex CLI 和 GitHub Copilot 临时兼容 ID 都只在 `src/oauth-clients.js` 出现一次，并在产品、仓库和商店审核说明中分别披露。
- 发布者自有 Client ID 所属应用、商店开发者身份、主页和隐私政策应保持一致；提交审核前优先替换两个临时兼容 ID。
- OAuth scope 保持最小化。
- token 只保存在扩展本地存储，不写入日志、会话或 VFS。
- 退出登录会删除本地 token；用户仍可在第三方账户页面撤销已签发授权。
- OAuth endpoint 的 host permission 在首次访问前按域名申请。
- 在 Side Panel 与微信/Telegram 分别测试缺少 token、授权成功、拒绝、过期和 token 撤销后的恢复流程。
