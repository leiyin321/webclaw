# WebClaw

WebClaw is a user-controlled browser AI assistant built as a Chrome Manifest V3 extension. It connects to a model provider selected by the user and can inspect or operate pages only after prominent disclosure, per-origin access, and high-risk action approval.

## Project Status

WebClaw is an experimental browser-native agent framework. It is intended for
local development, testing, and controlled personal workflows. Review the
security and privacy notes before using it with sensitive websites, credentials,
or message channels.

## Features

- Side panel chat UI.
- Settings and the file manager open in separate extension windows, leaving chat unobstructed.
- Local Ollama provider through `http://localhost:11434/api/chat`.
- OpenAI API format compatible provider through either `/v1/responses` or `/v1/chat/completions`.
- OpenCode Zen with per-model routing to Responses, Messages, or Chat Completions.
- Chrome AI provider through Chrome's built-in Prompt API and Gemini Nano.
- Codex / ChatGPT sign-in provider using a Codex CLI-compatible device OAuth flow.
- GitHub Copilot sign-in provider using GitHub OAuth device flow.
- Multiple custom providers. Each provider is one of `Codex / ChatGPT OAuth`, `GitHub Copilot OAuth`, `Chrome AI`, `Local Ollama`, `OpenAI-compatible API`, or `OpenCode Zen`.
- Browser tools: page snapshot, click, type, navigate, wait, page translation, current weather lookup, background HTTP requests, limited tab APIs, and JavaScript execution.
- Virtual filesystem: the file manager and agent tools share an IndexedDB-backed filesystem with directory browsing, text editing, upload, download, rename, trash, restore, permanent deletion, and structured tools including `fs_list`, `fs_read`, `fs_write`, `fs_edit`, `fs_search`, and `fs_apply_patch`.
- VFS static site preview: HTML/HTM/XHTML/SVG files in the file manager can open in a separate Chrome tab; the preview runtime loads relative CSS, JavaScript, images, fonts, and JSON resources from VFS.
- Preview pages run in an isolated Extension Sandbox. They receive a project-scoped `localStorage` compatibility layer persisted in this browser, without access to extension credentials. This compatibility layer is not the real website-origin `localStorage`.
- Restricted `fs_shell`: provides `pwd`, `cd`, `ls`, `stat`, `mkdir`, `touch`, `cat`, `cp`, `mv`, and `rm` in that extension-private filesystem without running a real system shell. `cd` updates the current session's working directory.
- Local knowledge base: indexes VFS text files in browser-local IndexedDB with `knowledge_ingest`, `knowledge_search`, `knowledge_read`, `knowledge_forget`, and `knowledge_status`; a WebClaw operation manual is created and indexed on first startup.
- Workspace memory: initializes `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, and daily memory files, then injects bounded workspace context before each agent run.
- Bounded structured tool trajectories: preserves tool outcomes and failure reasons for later turns and cross-provider continuation.
- Structured agent responses: Chrome AI uses Prompt API `responseConstraint`, Ollama uses a JSON Schema in `format`, OpenAI-compatible adapters negotiate `json_schema`, `json_object`, or prompt-only constraints, Copilot selects Responses or Chat Completions from discovered model metadata and uses the compatible JSON Tool protocol, and Codex uses native function calling.
- Unified Agent Runtime: every Provider, Side Panel conversation, Channel, and Schedule shares the same Turn, Item, Tool, Plan, approval, stop, and context-compaction lifecycle.
- Ephemeral task stack: `task_push` runs a child task with an independent model context; children may push deeper tasks and return JSON Schema-validated structured results.
- Controlled self-management patches can add tools, skills, and schedules or switch the active Provider to an existing Provider ID. They cannot read or modify Provider credentials.

## Agent Architecture

WebClaw maintains one outer Agent Runtime. A request is represented as a `Turn`; model output, Tool calls, Tool results, and plans are stateful `Item` records. Streaming, interruption, approvals, error feedback, history persistence, and context compaction are handled once for the Side Panel, WeChat, Telegram, and Schedules.

The core loop uses an explicit state machine and AgentService serializes work per session. ToolScheduler provides JSON Schema argument validation, native multi-call execution for Codex, adjacent read-only parallelism, write barriers, operation-key deduplication, and protection for unknown external side effects. A dedicated IndexedDB RunStore persists redacted events, checkpoints, Tool operations, and large-result artifacts; run leases and write owners are checked atomically, and checkpoint or lease failures stop execution. Deterministic boundaries resume with their original budgets, retry counters, and no-progress state: completed Tool observations are reused, safe or retry-safe calls can continue from the original call, and unknown side effects are never replayed automatically. Pending approvals are presented again in the Side Panel or original Channel. Repeated identical calls and observations trigger a correction nudge and eventually a `stuck` stop instead of looping indefinitely.

Model-specific behavior is isolated in Provider Adapters. An adapter owns authentication, message and media encoding, endpoints, stream parsing, context capabilities, and conversion of native function calling or JSON Tool transport into the same assistant/tool-call response. Switching Providers therefore does not switch the Agent workflow. Codex currently uses native function calling; Providers without a usable native Tool response use the adapter-level JSON transport fallback.

For substantial work, the model can call `update_plan` to publish and update a plan. When a conversation exceeds the active adapter's context budget, the runtime compacts older history while retaining recent messages, goals, constraints, verified Tool results, relevant errors, and unfinished work. The resulting summary is WebClaw-generated execution state, not a user instruction.

### Ephemeral task stack

`task_push` places a separable unit of work on a one-time task stack. Each child has an independent model context and receives only its explicit `instruction`, structured `context`, working directory, and `outputSchema`; the parent waits synchronously for the structured result. A child may call `task_push` again. The defaults allow four levels and sixteen tasks per root run. Settings can raise those values and set a whole-tree model-step budget; zero means unlimited. `task_stack` reports the active frames and budget.

Tasks are never added to Tool configuration and do not become Workflows. Their full execution context is removed from the active stack after completion or failure; the parent receives a standard result envelope whose `output` is locally validated against the JSON Schema. Active snapshots and recent status, count, budget, and error summaries stay in the current Chrome profile for interruption diagnostics without duplicating final answers. WebClaw does not automatically replay uncertain external operations after a service-worker interruption.

The current `outputSchema` supports a controlled JSON Schema subset: `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, string/array length limits, and numeric bounds. It rejects `$ref`, `$defs`, `oneOf`, `anyOf`, `allOf`, and recursive schemas.

```json
{"tool":{"name":"task_push","args":{"title":"Verify sources","instruction":"Check the candidate sources and return the reliable ones.","context":{"sources":["https://example.com"]},"outputSchema":{"type":"object","properties":{"reliable":{"type":"array","items":{"type":"string"}},"summary":{"type":"string"}},"required":["reliable","summary"],"additionalProperties":false},"maxSteps":6}}}
```

A Workflow remains a persistent reusable custom Tool, while a Task is an ephemeral execution instance. Tasks may call Workflows, and Workflows may use `task_push` for runtime decomposition.

## Repository Guide

- [Privacy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [OAuth configuration and release guidance](OAUTH.md)
- [Release checklist](RELEASE.md)
- [Chrome Web Store listing material](STORE_LISTING.md)
- [Agent Loop architecture and recovery semantics](docs/agent-loop-architecture.md)
- [License](LICENSE)

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this repository directory.
5. Click the WebClaw extension icon to open the side panel.

## Development Checks

Run the same syntax, Agent Loop, and release checks used by CI:

```bash
./scripts/check-syntax.sh
node scripts/test-agent-runtime.mjs
./scripts/test-agent-loop.sh
node scripts/test-provider-client-metadata.mjs
node scripts/test-openai-compatible-structured-output.mjs
node scripts/validate-release.mjs
```

## Provider setup

Open Settings in the side panel to manage providers. You can add multiple providers, give each one a custom name, choose its type, and switch the active provider from the Provider dropdown.

When the optional self-management tools are enabled, the agent can also switch the default Provider through the validated patch flow. It first reads redacted IDs with `list_webclaw_config`, proposes `{"op":"set_active_provider","providerId":"..."}`, and applies the returned patch ID. The operation cannot create or edit Providers and cannot access OAuth tokens or API keys. The latest switch can be restored with `rollback_webclaw_config_patch` while the previous Provider still exists. A switch takes effect on the next agent request or Channel/Schedule task; the request applying the patch finishes with its original Provider.

For a `Codex / ChatGPT OAuth` provider, open Edit provider and click `Sign in with ChatGPT` after entering an authorized public Client ID.

For a `GitHub Copilot OAuth` provider, open Edit provider and click `Sign in with GitHub`. This compatibility build supplies a temporary public Client ID, which distributors can override with an app they control.

Each provider's `Model` field is a typeable dropdown. Click `Refresh` next to the model field to load available models from the active provider:

- Ollama: `GET /api/tags`
- OpenAI-compatible API: `GET /models`
- Chrome AI: Chrome Prompt API `LanguageModel.availability()`
- Codex / ChatGPT OAuth: configured Codex backend `/models` when available, with built-in fallback options
- GitHub Copilot OAuth: configured Copilot OpenAI-compatible `/models` when available, with built-in fallback options

If model discovery fails because a local server is offline, an API key is missing, or a provider does not expose a model-list endpoint, you can still type the model name manually.

Each provider also has a `Thinking mode` toggle in its model configuration. For Ollama, WebClaw sends Ollama's `think` flag. For Codex, OpenAI-compatible reasoning models, and Copilot Responses models, WebClaw sends a reasoning effort hint (`medium` when enabled, `low` when disabled). Chrome AI and Copilot Chat Completions do not receive undocumented thinking parameters.

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
- API protocol: `Auto`, `Responses API`, or `Chat Completions`.
- API key and model.

`Auto` uses `supported_endpoints` metadata returned by `/models` when available and otherwise keeps the backward-compatible Chat Completions route. Selecting Responses API explicitly sends `POST /responses` with `instructions + input`, `text.format`, `reasoning.effort`, and semantic Responses SSE events. For DeepSeek `deepseek-v4-flash`, set the Base URL to `https://api.deepseek.com` and select Responses API.

“OpenAI-compatible” does not imply support for every optional OpenAI feature. Both protocols negotiate structured output inside the Provider Adapter: JSON Schema first, then JSON Object after an explicit compatibility error, then prompt-only output with local Schema validation. The successful mode is cached for seven days per protocol, Provider, endpoint, and model.

### OpenCode Zen

Choose provider type `OpenCode Zen`, enter an API key from OpenCode Zen, and click Refresh to load the official model catalog. The default base URL is `https://opencode.ai/zen/v1`.

WebClaw routes GPT models to `/responses`, Claude and Qwen models to `/messages`, and Grok, DeepSeek, GLM, MiniMax, Kimi, and compatible models to `/chat/completions`. Gemini models that require the Google GenerateContent protocol are currently filtered from the selector instead of being exposed as unusable choices.

### Chrome AI

Set provider type to `Chrome AI` to use Chrome's built-in Prompt API with the on-device Gemini Nano model. WebClaw calls the API from an offscreen extension document because Chrome's Prompt API is not available in MV3 background service workers.

Chrome AI requires a Chrome build with built-in AI support, supported hardware, enough free disk space, and a downloaded or downloadable Gemini Nano model. Check `chrome://on-device-internals` when availability is unclear. First use may download the model.

### Codex / ChatGPT OAuth

This provider is experimental. To keep Codex providers usable in the current browser-only build, the repository temporarily centralizes the public Codex CLI Client ID as its compatibility default:

- Issuer URL: `https://auth.openai.com`
- Authorization URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- Client ID: the public Codex CLI Client ID by default, overridable per Provider
- Codex backend URL: `https://chatgpt.com/backend-api/codex`

The Client ID is not a secret, but this default is a temporary compatibility dependency. OpenAI does not currently document a client-registration path for third-party Chrome extensions, so service or distribution policy changes may break it. Replace the default when an official registration path exists, and never package a Client Secret.

Click `Sign in with ChatGPT`. WebClaw requests a device login code and opens the ChatGPT device page in a dedicated window so it cannot replace the Settings popup. A background Chrome Alarm keeps polling even when Settings is hidden or closed; after token exchange, WebClaw closes the dedicated authorization window and refocuses the originating Settings window. An ordinary chat request can start the same flow when no usable token exists: approve the request in the side panel, sign in, and WebClaw continues the original request.

For a request originating from WeChat or Telegram, WebClaw sends a six-digit numeric approval code back to that conversation. Reply with that six-digit code alone to allow, or reply with `0` to deny. On approval, WebClaw sends the ChatGPT verification URL and device code. The code is bound to the originating Channel and peer and expires after ten minutes. The original task resumes after web authorization succeeds.

Access and refresh tokens are stored in `chrome.storage.local` and refreshed automatically, so sign-in is normally one-time. Sign-out, revocation, or an unusable refresh token starts authorization again. A new Chrome optional host permission still requires a click in the browser running WebClaw; a Channel reply cannot grant browser-level site access. See [OAuth configuration and release guidance](OAUTH.md).

When refreshing Codex models, WebClaw calls `/models?client_version=0.145.0`; the ChatGPT Codex backend requires a Codex client version on the model-list endpoint. WebClaw keeps this compatibility identity aligned with the supported Codex CLI because the service can hide models whose minimum client version is newer than the declared version. The returned catalog is filtered by Codex fields such as `slug`, `display_name`, `visibility`, and `supported_in_api`, without mixing a hard-coded legacy catalog into a successful refresh.

This follows the Codex CLI device-login shape instead of the default local callback server shape. A Chrome extension cannot bind a `127.0.0.1` callback server like a native CLI process, so device auth is the browser-extension friendly path.

The older `Discover metadata` button remains for custom OAuth-compatible providers. It tries `/.well-known/oauth-authorization-server` and `/.well-known/openid-configuration`, and can fill endpoints or dynamically register a public PKCE client when the provider supports that.

For enterprise automation, OpenAI also documents Codex access tokens created from the ChatGPT admin console. Those are intended for trusted non-interactive local workflows, not public browser-extension distribution.

### GitHub Copilot OAuth

The extension ships with GitHub device-flow defaults:

- Device code URL: `https://github.com/login/device/code`
- Access token URL: `https://github.com/login/oauth/access_token`
- GitHub OAuth client ID: temporarily defaults to the public compatibility ID used by earlier WebClaw builds and remains configurable in Settings
- Scope: `read:user`
- Copilot token URL: `https://api.github.com/copilot_internal/v2/token`
- Copilot-compatible base URL: `https://api.githubcopilot.com`
- Default model: `auto`

The compatibility Client ID is not a secret, but WebClaw's distributor does not control it and it is not a stable third-party extension contract. It may stop working because of service, risk-control, or distribution-policy changes. Each distributor should register its own GitHub OAuth App or GitHub App, enable Device Flow, and override the default. Never package a Client Secret in the extension.

Click `Sign in with GitHub`. WebClaw requests a GitHub device code, opens `https://github.com/login/device` in a dedicated window, and shows the code in Settings. A background Alarm keeps polling even if Settings is hidden or closed. After GitHub returns an OAuth access token, WebClaw saves it in `chrome.storage.local`, closes the authorization window, restores Settings when possible, and exchanges the GitHub token for a Copilot session token before calling the endpoint supported by the selected model.

GitHub's OAuth device flow is public and documented. GitHub documents the currently supported Copilot models in the GitHub Copilot AI model reference, but does not document a stable account-level model-list REST endpoint. WebClaw tries the Copilot OpenAI-compatible `GET /models` endpoint after exchanging the GitHub token for a Copilot token; the returned IDs depend on your plan, client surface, and organization or enterprise model policies. The Copilot chat/token endpoint shape is not a stable public REST contract, so WebClaw keeps the Copilot token URL, chat base URL, model, and integration ID configurable.

Model discovery uses the current compatible Copilot CLI identity. Account availability still depends on the plan and policy; see GitHub's [official supported-model list](https://docs.github.com/en/copilot/reference/ai-models/supported-models). WebClaw retains each returned model's `supported_endpoints`: models that support `/responses` use the Responses API, models limited to `/chat/completions` use Chat Completions, and models supporting both prefer Responses. This allows Responses-only GPT-5.3, GPT-5.4 mini, GPT-5.5, and GPT-5.6 models to remain selectable and callable instead of being discarded by a Chat Completions-only filter.

GitHub's native `Auto` model option is a Copilot routing mode, not a single fixed model. GitHub's documentation says auto model selection chooses from supported models based on task complexity, system health, model availability, policies, and subscription type. Paid Copilot plans qualify for a 10% discount on model costs while using auto model selection in supported Copilot surfaces.

When you choose `auto` in WebClaw, WebClaw omits the `model` field from the Copilot request body and lets the Copilot service apply server-side auto model selection. Concrete model selections are sent as `model` and routed through their discovered API.

## Agent protocol

All Providers share one Agent Runtime. Provider Adapters own authentication, wire format, streaming, media encoding, context capabilities, and native function calling versus JSON Tool transport. Switching Providers therefore does not change session, Tool, Plan, approval, stop, or persistence behavior. A model step commonly emits one JSON Tool object:

```json
{"tool":{"name":"get_page_context","args":{}}}
```

or:

```json
{"final":"Done"}
```

Providers with structured-output support use their JSON Schema or native Tool
calling; others use the compatible JSON transport. The Runtime normalizes all
of them into the same Tool-call and final-result lifecycle.

The global `Max steps` setting accepts any positive integer and has no artificial
upper bound. It limits one Agent run, not a Provider's context or server quota.

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

- JavaScript execution is disabled by default. After enabling it, every ad-hoc `run_js` call shows the target and source and requires approval. A Schedule can remember an exact operation after its first approval; changing the Schedule, full target URL, execution world, or code requires another approval.
- Saved Schedule operation approvals can be cleared under Settings > Privacy & control. Revoking the Chrome origin permission still requires a new browser grant and is never bypassed by the saved operation approval.
- `run_js` requires Chrome 135 or newer and uses only `userScripts.execute()`; there is no `eval` / `new Function` fallback. In Chrome 138+, enable `Allow User Scripts` for WebClaw on the extension details page if Chrome reports that the API is unavailable.
- `userScripts` injection is not blocked by page CSP dynamic-evaluation rules, but it cannot bypass the same-origin policy, HttpOnly cookies, extension permissions, or operating-system permissions.
- `run_js` accepts inline `code` or `vfsPath` for a VFS `.js`, `.mjs`, or `.cjs` file; provide exactly one.
- Use `http_request` for cross-origin webhooks or APIs that pages cannot call because of CORS. HTTP(S) access uses optional host permissions requested per origin with a reason before first use.
- `fs_shell` only operates on the IndexedDB-backed virtual filesystem and cannot access local machine files. It supports `pwd`, `cd`, `ls`, `stat`, `mkdir`, `touch`, `cat`, `cp`, `mv`, and `rm`; `cd` validates the target directory, updates the current session working directory, and makes later relative paths resolve from it. It rejects pipes, redirection, command substitution, and multi-command input; `rm` moves entries into `/.trash`.
- Trash records retain the original path and deletion time. `fs_restore` rejects a conflicting destination by default, supports `onConflict: "rename"`, and can move the existing destination to trash when `confirmOverwrite: true`; `fs_purge` and `fs_empty_trash` permanently delete only trash entries and require `confirm: true`.
- Successfully downloaded WeChat channel media is also archived under `/inbox/<channel>/`. Its content is still sent to the active provider according to that provider's media capabilities.
- Edit and enable the `qiyewechat_notification` Tool to configure an enterprise WeChat robot webhook. Its Tool name and Display name are both fixed to `qiyewechat_notification`; use only this canonical identifier. It supports text and markdown payloads without putting the webhook into model prompts.
- API keys and OAuth tokens are stored in `chrome.storage.local`.
- The current Chrome API tool surface is intentionally small. Add operations deliberately instead of exposing all extension APIs to the model.

## Packaging

Validate the release and build a minimal archive named from the manifest version:

```bash
./scripts/package-extension.sh
```

The result is written to `dist/webclaw-<version>.zip`. See [RELEASE.md](RELEASE.md) for clean-profile testing, Chrome Web Store submission, and tag-based GitHub releases.
