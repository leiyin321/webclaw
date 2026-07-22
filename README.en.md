# WebClaw

WebClaw is a Chrome Manifest V3 extension that runs an AI agent inside the browser extension environment. It can inspect the active page, operate DOM elements, call selected Chrome extension APIs, and optionally execute JavaScript in the page through a guarded tool.

## Project Status

WebClaw is an experimental browser-native agent framework. It is intended for
local development, testing, and controlled personal workflows. Review the
security and privacy notes before using it with sensitive websites, credentials,
or message channels.

## Features

- Side panel chat UI.
- Settings and the file manager open in separate extension windows, leaving chat unobstructed.
- Local Ollama provider through `http://localhost:11434/api/chat`.
- OpenAI API format compatible provider through `/v1/chat/completions`.
- Chrome AI provider through Chrome's built-in Prompt API and Gemini Nano.
- Codex / ChatGPT sign-in provider using a Codex CLI-compatible device OAuth flow.
- GitHub Copilot sign-in provider using GitHub OAuth device flow.
- Multiple custom providers. Each provider is one of `Codex / ChatGPT OAuth`, `GitHub Copilot OAuth`, `Chrome AI`, `Local Ollama`, or `OpenAI-compatible API`.
- Browser tools: page snapshot, click, type, navigate, wait, page translation, current weather lookup, background HTTP requests, limited tab APIs, and JavaScript execution.
- Virtual filesystem: the file manager and agent tools share an IndexedDB-backed filesystem with directory browsing, text editing, upload, download, rename, trash, restore, permanent deletion, and structured tools including `fs_list`, `fs_read`, `fs_write`, `fs_edit`, `fs_search`, and `fs_apply_patch`.
- Restricted `fs_shell`: provides `pwd`, `ls`, `stat`, `mkdir`, `touch`, `cat`, `cp`, `mv`, and `rm` in that extension-private filesystem without running a real system shell.
- Local knowledge base: indexes VFS text files in browser-local IndexedDB with `knowledge_ingest`, `knowledge_search`, `knowledge_read`, `knowledge_forget`, and `knowledge_status`; a WebClaw operation manual is created and indexed on first startup.
- Workspace memory: initializes `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, and daily memory files, then injects bounded workspace context before each agent run.
- Bounded structured tool trajectories: preserves tool outcomes and failure reasons for later turns and cross-provider continuation.

## Repository Guide

- [Privacy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository directory.
5. Click the WebClaw extension icon to open the side panel.

## Development Checks

Run the same syntax checks used by CI:

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

## Provider setup

Open Settings in the side panel to manage providers. You can add multiple providers, give each one a custom name, choose its type, and switch the active provider from the Provider dropdown.

When the active provider is a `Codex / ChatGPT OAuth` provider and it does not already have a token, WebClaw automatically starts the ChatGPT sign-in flow after you select or save that provider.

When the active provider is a `GitHub Copilot OAuth` provider and it does not already have a token, WebClaw automatically starts the GitHub device sign-in flow after you select or save that provider.

Each provider's `Model` field is a typeable dropdown. Click `Refresh` next to the model field to load available models from the active provider:

- Ollama: `GET /api/tags`
- OpenAI-compatible API: `GET /models`
- Chrome AI: Chrome Prompt API `LanguageModel.availability()`
- Codex / ChatGPT OAuth: configured Codex backend `/models` when available, with built-in fallback options
- GitHub Copilot OAuth: configured Copilot OpenAI-compatible `/models` when available, with built-in fallback options

If model discovery fails because a local server is offline, an API key is missing, or a provider does not expose a model-list endpoint, you can still type the model name manually.

Each provider also has a `Thinking mode` toggle in its model configuration. For Ollama, WebClaw sends Ollama's `think` flag. For Codex and OpenAI-compatible reasoning model names, WebClaw sends a reasoning effort hint (`medium` when enabled, `low` when disabled). Chrome AI and GitHub Copilot keep the setting for consistency but WebClaw does not send undocumented thinking parameters.

For custom OAuth providers that publish standard metadata, set `OAuth issuer URL` and click `Discover metadata`. WebClaw will try:

- `/.well-known/oauth-authorization-server`
- `/.well-known/openid-configuration`

It fills the authorization and token endpoints from metadata. If the metadata advertises a dynamic client registration endpoint, WebClaw registers itself as a public PKCE client and fills `clientId`.

### Ollama

Start Ollama locally, then set:

- Provider type: `Local Ollama`
- Base URL: `http://localhost:11434`
- Model: any model you have pulled, for example `llama3.1`

### OpenAI-compatible API

Set:

- Provider type: `OpenAI-compatible API`
- Base URL: for OpenAI use `https://api.openai.com/v1`; for compatible services use their `/v1` base URL.
- API key and model.

### Chrome AI

Set provider type to `Chrome AI` to use Chrome's built-in Prompt API with the on-device Gemini Nano model. WebClaw calls the API from an offscreen extension document because Chrome's Prompt API is not available in MV3 background service workers.

Chrome AI requires a Chrome build with built-in AI support, supported hardware, enough free disk space, and a downloaded or downloadable Gemini Nano model. Check `chrome://on-device-internals` when availability is unclear. First use may download the model.

### Codex / ChatGPT OAuth

The extension ships with Codex CLI-compatible defaults:

- Issuer URL: `https://auth.openai.com`
- Authorization URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Codex backend URL: `https://chatgpt.com/backend-api/codex`

Click `Sign in with ChatGPT`. WebClaw requests a device login code from ChatGPT, opens the ChatGPT device page, shows the code in the side panel, and polls until ChatGPT returns the authorization code. The extension then exchanges that code for an access token and refresh token, stores them in `chrome.storage.local`, and calls the Codex backend `/responses` endpoint with the bearer token.

When refreshing Codex models, WebClaw calls `/models?client_version=0.142.0`; the ChatGPT Codex backend requires a Codex client version on the model-list endpoint. The returned model catalog uses Codex fields such as `slug`, `display_name`, `visibility`, and `supported_in_api`.

This follows the Codex CLI device-login shape instead of the default local callback server shape. A Chrome extension cannot bind a `127.0.0.1` callback server like a native CLI process, so device auth is the browser-extension friendly path.

The older `Discover metadata` button remains for custom OAuth-compatible providers. It tries `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`, and can fill endpoints or dynamically register a public PKCE client when the provider supports that.

For enterprise automation, OpenAI also documents Codex access tokens created from the ChatGPT admin console. Those are intended for trusted non-interactive local workflows, not public browser-extension distribution.

### GitHub Copilot OAuth

The extension ships with GitHub device-flow defaults:

- Device code URL: `https://github.com/login/device/code`
- Access token URL: `https://github.com/login/oauth/access_token`
- GitHub OAuth client ID: configurable in Settings
- Scope: `read:user`
- Copilot token URL: `https://api.github.com/copilot_internal/v2/token`
- Copilot-compatible base URL: `https://api.githubcopilot.com`
- Default model: `auto`

Click `Sign in with GitHub`. WebClaw requests a GitHub device code, opens `https://github.com/login/device`, shows the code in the side panel, and polls until GitHub returns an OAuth access token. It then exchanges that GitHub token for a Copilot session token and calls the configured Copilot-compatible `/chat/completions` endpoint.

GitHub's OAuth device flow is public and documented. GitHub documents the currently supported Copilot models in the GitHub Copilot AI model reference, but does not document a stable account-level model-list REST endpoint. WebClaw tries the Copilot OpenAI-compatible `GET /models` endpoint after exchanging the GitHub token for a Copilot token; the returned IDs depend on your plan, client surface, and organization or enterprise model policies. The Copilot chat/token endpoint shape is not a stable public REST contract, so WebClaw keeps the Copilot token URL, chat base URL, model, and integration ID configurable.

GitHub's native `Auto` model option is a Copilot routing mode, not a single fixed model. GitHub's documentation says auto model selection chooses from supported models based on task complexity, system health, model availability, policies, and subscription type. Paid Copilot plans qualify for a 10% discount on model costs while using auto model selection in supported Copilot surfaces.

When you choose `auto` in WebClaw, WebClaw omits the `model` field from the Copilot `/chat/completions` request body and lets the Copilot service decide whether to apply server-side auto model selection. Concrete model selections are still sent as `model`.

## Agent protocol

The model is prompted to emit a single JSON object per step:

```json
{"tool":{"name":"get_page_context","args":{}}}
```

or:

```json
{"final":"Done"}
```

This keeps the agent provider-neutral and works with local models that do not support native function calling.

## Translating a page

Open the page you want to translate in the active Chrome tab, then ask WebClaw:

```text
帮我把当前页面翻译成中文
```

WebClaw uses the `translate_page` tool to collect visible text nodes, translate them with the active provider, and replace the text in the page DOM. It works on normal `http://` and `https://` pages. It cannot translate browser-internal pages such as `about:blank`, `chrome://extensions`, or pages where Chrome blocks extension content scripts.

## Real-time queries

Models do not know live data by themselves. WebClaw adds live data by exposing browser and search tools to the agent.

For current or recent facts, WebClaw can use `search_web` to open a search page, inspect the results, navigate to a likely source, read the page with `get_page_context`, and summarize the result. This is the general path for questions such as match results, news, public schedules, prices, and recently changed facts.

For example:

```text
昨晚湖人比赛结果是什么
```

Weather questions also have a faster direct `get_weather` tool. For example:

```text
今天北京的天气怎么样
```

The direct weather tool geocodes the location with Open-Meteo, fetches current conditions and today's forecast, and returns the result to the model for a human-readable answer. For other domains, prefer the generic search-and-read workflow first; add a narrow API-backed tool only when a workflow needs higher reliability or structured data.

## Security notes

- JavaScript execution is disabled by default. Enable it only when you trust the task and page.
- `run_js` uses Chrome's `userScripts` API so model-provided JavaScript can run without page CSP or extension `unsafe-eval` blocking it. In Chrome 138+, enable `Allow User Scripts` for WebClaw on the extension details page if Chrome reports that `userScripts` is unavailable.
- `run_js` accepts inline `code` or `vfsPath` for a VFS `.js`, `.mjs`, or `.cjs` file; provide exactly one.
- Use `http_request` for cross-origin webhooks or APIs that pages cannot call because of CORS. It runs in the extension background service worker and uses the extension host permissions.
- `fs_shell` only operates on the IndexedDB-backed virtual filesystem and cannot access local machine files. It rejects pipes, redirection, command substitution, and multi-command input; `rm` moves entries into `/.trash`.
- Trash records retain the original path and deletion time. `fs_restore` rejects a conflicting destination by default, supports `onConflict: "rename"`, and can move the existing destination to trash when `confirmOverwrite: true`; `fs_purge` and `fs_empty_trash` permanently delete only trash entries and require `confirm: true`.
- Successfully downloaded WeChat channel media is also archived under `/inbox/<channel>/`. Its content is still sent to the active provider according to that provider's media capabilities.
- Configure `企业微信机器人 webhook` in settings to let the agent call `send_wecom_message` without exposing the webhook URL in prompts. Text messages use the Work WeCom robot payload shape documented at `https://developer.work.weixin.qq.com/document/path/99110`: `{"msgtype":"text","text":{"content":"..."}}`.
- API keys and OAuth tokens are stored in `chrome.storage.local`.
- The current Chrome API tool surface is intentionally small. Add operations deliberately instead of exposing all extension APIs to the model.
