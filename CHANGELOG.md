# Changelog

All notable changes to WebClaw will be documented in this file.

## Unreleased

- Fix `extension` run_js RPC startup in Manifest Sandbox workers where `crypto.randomUUID()` is unavailable by using a run-local monotonic call ID.
- Render assistant final and streaming responses as locally parsed, HTML-escaped Markdown with compact chat styles for headings, emphasis, lists, quotes, code, tables, links, and task items; keep user, Tool, Plan, and Task messages as plain text.

## 0.7.3

- Replace the cumulative `run_js` L0-L5 protocol with four mutually exclusive execution environments: approval-free `compute`, direct `page-isolated` USER_SCRIPT, direct `page-main` MAIN-world code, and explicit allowlisted-RPC `extension`. Remove `level`, nested `webclaw.page.run`, RPC wildcards, and the duplicate global `chrome` proxy without compatibility aliases.
- Require exact extension RPC methods and narrow VFS/network scopes, revalidate the approved page URL inside injected code, and strictly validate explicit page targets.
- Bind recovered approval decisions to the complete disclosure, origin set, and Chrome permission set; remembered Schedule approvals no longer bypass a revoked optional permission.
- Apply Stop and `timeoutMs` waiting limits to page runtimes, cap inline source at 200,000 characters and page results at 2 MB, and show the complete source in the local approval dialog.
- Update the Tool Schema, Agent recovery guidance, default workspace instructions, built-in manual, privacy disclosures, store notes, and bilingual documentation for the new runtime protocol.

## 0.7.2

- Stop creating a visible root Task for every user message. Each message now starts an AgentRun with an empty task stack, and Tasks exist only when the model explicitly calls `task_push`.
- Reserve one final model turn to consume any Tool observation at the configured step limit, including `tool_search`; the reserved turn may return a final answer but cannot execute another Tool beyond the limit.
- Expand model-facing `run_js` guidance across its Tool Schema, dynamic Agent prompt, `tool_search` result example, default manual, and capability documentation, with correct Sandbox-controller, page RPC, VFS, HTTP, and Chrome API patterns plus failure recovery guidance.
- Drive the conversation Stop button from the live Agent stream instead of generic Settings/UI busy state, and show a non-repeatable Stopping state while cancellation propagates.

## 0.7.1

- Add provider-independent rich document generation for DOCX, XLSX, PPTX, and PDF through versioned Rich Schemas, built-in format-qualified templates, local sandboxed engines, VFS image assets, fidelity reporting, and bounded artifact transfer.
- Add Brave Search API support to the canonical `web_search` Tool with normalized structured results, bounded in-memory caching, optional browser fallback, Tool configuration UI, privacy disclosure, and cancellation-safe execution.
- Replace the single page-script runtime with cumulative `run_js` L0-L5 capability levels: isolated computation, scoped VFS RPC, declared-origin HTTP, USER_SCRIPT page access, MAIN-world page access, and allowlisted Chrome APIs.
- Run all `run_js` controller code inside a Manifest Sandbox worker, require explicit capability declarations and user approval, enforce per-call size/count/time limits, and retain exact Schedule approval fingerprints.
- Harden `run_js` authorization by revalidating the approved tab URL before every page RPC, authorizing resolved VFS copy/move destinations, and checking implicitly created parent directories.
- Propagate Agent cancellation through Brave Search and rich document generation so Stop does not open fallback tabs or commit a completed document after cancellation.
- Add local WebP-to-PNG conversion and signature-based image validation before document engines, preventing disguised unsupported image formats from reaching bundled parsers.
- Add expiring IndexedDB document artifacts, cancellation cleanup, format-qualified template IDs, expanded CI/package gates, bilingual documentation updates, and focused regression tests.

## 0.7.0

- Add one provider-independent document layer with eight Tools for inspecting, reading, creating, editing, rendering, exporting, and revising VFS documents.
- Support full Markdown workflows, basic DOCX/XLSX/PPTX generation and rebuild editing, ASCII text PDF generation, and bounded read projections for DOCX, XLSX, PPTX, and PDF.
- Add format-specific versioned schemas, optimistic version/hash checks, automatic pre-write snapshots, restore-before-replace snapshots, revision retention limits, and confirmed permanent revision purge.
- Add bounded Markdown/JSON Office projections with paragraph, cell, and slide locators; reject unsupported PDF page locators rather than attributing whole-document text to one page.
- Add Office/PDF projection export to Markdown or JSON and independent document previews from the VFS file manager.
- Harden OOXML ZIP parsing and generation with entry/path/size limits, valid ZIP version metadata, CRC verification tests, and no macro, external link, formula, embedded script, or remote conversion execution.
- Integrate supported document projections with the local knowledge base while retaining original VFS files and truthful source-location limits.
- Document fidelity limits explicitly: rebuild editing does not preserve unsupported Office structures, PDF extraction is conservative, and built-in PDF creation rejects non-ASCII text until embedded-font support is available.

## 0.6.1

- Centralize built-in Tool definitions, JSON Schemas, UI metadata, and scheduler effects in one Tool Registry.
- Add recursive JSON Schema validation for Tool arguments, including nested objects and arrays, bounds, enums, constants, required fields, and unknown-property rejection.
- Add structured page and tab Tools: `page_snapshot`, `page_action`, `page_wait`, `page_extract`, `page_storage`, `page_screenshot`, `page_file_input`, and `browser_tabs`; remove ambiguous legacy page and tab Tool names instead of retaining aliases.
- Add optional-permission Tools for tab groups, recent sessions, downloads, bookmarks, history, separate clipboard read/write access, and local Chrome notifications; disabled or ungranted capabilities are not exposed to the model.
- Add run-scoped `tool_search` discovery so models start with a compact core Tool set and can load matching enabled capabilities without changing global configuration.
- Extend `http_request` with timeouts, URL-encoded forms, multipart VFS uploads, bounded response decoding, binary handling, and direct VFS saves.
- Add VFS metadata, glob, hashing, text diff, portable archive, and static-preview Tools; consolidate file management and trash operations under `fs_manage` and `fs_trash`, removing the replaced single-action names.
- Add knowledge collections and path/tag/time filters, filtered status, and `knowledge_reindex` for changed VFS sources.
- Send bounded model-facing Tool observations through a stable `ok`/`data`/`error`/`meta` envelope while retaining the original Tool name and arguments in the conversation UI.
- Ensure the parent Agent always receives a continuation turn to consume a completed child Task result, including at the regular step limit and the shared task-tree model-step budget boundary.
- Add Tool category and bundle filters, optional-permission status, and unified Registry metadata to the Tool management window.
- Fix iframe preview host handshaking, filtered knowledge status totals and path boundaries, and the enterprise WeChat text/markdown input contract.
- Refresh the built-in workspace Tool instructions and operation manual for the 0.6.1 capability set.

## 0.6.0

- Replace the monolithic execution loop with one provider-independent AgentRunner,
  explicit state machine, normalized ModelTurn contract, bounded recovery policy,
  shared budgets, progress detection, and terminal-outcome mapping.
- Keep Provider-specific authentication, wire formats, streaming, media encoding,
  context limits, structured output, and Tool transport behind Provider Adapters.
- Add AgentService session serialization so Side Panel, Channel, Schedule, and
  recovery requests cannot advance the same session concurrently.
- Add a resource-aware ToolScheduler with argument validation, safe parallel reads,
  write barriers, operation-key deduplication, cooperative timeouts, cancellation
  before side effects, and conservative handling of unknown external effects.
- Add an IndexedDB Agent RunStore for redacted events, boundary checkpoints, Tool
  operation intent/results, leases, and large Tool-result artifacts, with session
  cleanup and an `agent_artifact_read` Tool for bounded result retrieval.
- Resume deterministic runs after interruption with their original budgets,
  recovery counters, progress state, task state, and model context. Reuse completed
  Tool observations, replay only safe or retry-safe calls, and require manual review
  for operations whose external effects are unknown.
- Restore pending approvals in the Side Panel or originating Channel and expose live
  state, Tool, Task, recovery, failure, and `stuck` progress without duplicating the
  final assistant response.
- Route task-stack mutations through TaskSupervisor, preserve task budgets across
  recovery, and report non-completed Agent outcomes consistently to Channels and
  Schedules.
- Serialize and merge background/session writes so Channel activity is not lost when
  the Side Panel saves concurrently; retain active Turn records when bounded history
  is trimmed and delete RunStore data when a session is cleared or removed.
- Add focused Agent Loop tests, a production-path IndexedDB test harness, CI and
  packaging gates, architecture documentation, and matching privacy disclosures.

## 0.5.3

- Align Codex and GitHub Copilot model discovery with the current compatible CLI client identities so server-side minimum-client-version gates do not hide newly available models.
- Preserve Copilot `supported_endpoints` model metadata and route each concrete model through Responses or Chat Completions as advertised, including Responses-only GPT-5.6 models.
- Migrate existing Copilot Providers from the legacy `vscode-chat` integration identity to `copilot-developer-cli` without requiring sign-in again.
- Add provider client metadata tests to CI and the extension packaging checks.
- Negotiate structured-output support for OpenAI-compatible providers, falling back from `json_schema` to `json_object` and then prompt-only validation on explicit compatibility errors; cache the successful mode per endpoint and model for seven days.
- Add `Auto`, `Responses API`, and `Chat Completions` protocol selection to OpenAI-compatible Providers; route Responses requests through `/responses` with `instructions`, `input`, `text.format`, reasoning effort, and semantic SSE event parsing.

## 0.5.2

- Show live hierarchical Task execution progress in the conversation, including model steps, active Tools, structured-output correction, and failures; completed runs collapse automatically.
- Add a provider-independent ephemeral task stack with `task_push` and
  `task_stack`, nested child-agent contexts, bounded depth and task counts,
  structured JSON Schema results, and local output validation.
- Persist active task-stack snapshots and retain only bounded run summaries
  after task completion or interruption.

## 0.5.1

- Add an OpenCode Zen Provider with official model discovery and per-model
  routing across Responses, Messages, and Chat Completions APIs.
- Filter OpenCode Gemini models that require the not-yet-supported Google
  GenerateContent protocol instead of allowing an invalid selection.

## 0.5.0

- Introduce one provider-independent Agent Runtime shared by the Side Panel,
  Channels, and Schedules, with typed Turn and Item lifecycle events.
- Isolate authentication, wire formats, streaming, context capabilities, and
  native versus JSON Tool transport in registered Provider Adapters.
- Add the `update_plan` Tool and persistent plan display for substantial tasks.
- Compact oversized conversation history against the active adapter's context
  budget while preserving recent messages and a bounded factual summary.
- Persist structured Tool calls, results, turn status, and compaction state so a
  session can continue across reloads and Provider switches.
- Add structured-output support at each Provider Adapter boundary: Chrome AI
  Prompt API constraints, Ollama JSON Schema, OpenAI-compatible response
  formats, and native Codex function calls where available.
- Add `fs_shell cd`, per-session working directories, and file-manager/session
  linkage. Remove the artificial upper bound from the global Max steps setting.
- Add VFS static preview for HTML, HTM, XHTML, and SVG files in a top-level
  Chrome tab using the Extension Sandbox, including relative CSS, JavaScript,
  image, font, and JSON resources.
- Add a project-scoped `localStorage` compatibility layer for VFS previews,
  folder selection with single-click versus double-click navigation, and
  preview controls in the file manager.
- Add release tests for the shared runtime and package validation, and update
  the bilingual documentation, privacy disclosure, and built-in knowledge
  manual for the 0.5.0 runtime.

## 0.4.7

- Standardize the enterprise WeChat notification Tool name and display name as
  `qiyewechat_notification`, while retaining `send_wecom_message` only as a
  hidden legacy input alias.
- Refresh the built-in WebClaw knowledge manual for the current Provider,
  permission, Channel, Schedule, VFS, and self-management behavior.
- Upgrade and re-index historical default manual copies while preserving any
  manual that the user has edited.

## 0.4.6

- Generate the matching default Provider name when the Provider type changes.
- Preserve a manually entered Provider name instead of replacing it during a
  later type change.
- Allow the controlled configuration-patch tools to switch the active Provider
  with `set_active_provider` and an existing Provider ID.
- Include active Provider changes in validation, previews, change history, and
  rollback without exposing or modifying Provider credentials.

## 0.4.5

- Replace mixed letter-and-number Channel approval codes with six-digit numeric
  codes that are easier to enter from WeChat and Telegram.
- Allow a remote operation by replying with the exact six-digit code alone, or
  reject pending approvals for that Channel conversation by replying with `0`.
- Keep numeric approvals bound to the originating Channel and peer, with the
  existing ten-minute expiration.

## 0.4.4

- Temporarily restore the public GitHub Copilot Client ID used by earlier
  WebClaw builds so a new Copilot Provider can start Device Flow without manual
  client registration.
- Backfill the compatibility Client ID for existing Copilot Providers whose
  saved `clientId` is empty, while preserving any non-empty user override.
- Centralize and disclose the compatibility identifier as a replaceable public
  client value rather than treating it as a secret credential.

## 0.4.3

- Open GitHub device authorization in the same dedicated-window flow used by
  ChatGPT, so the authorization page cannot replace the Settings popup.
- Keep GitHub Copilot device login running in the background when Settings is
  hidden or closed, then close the authorization window and restore Settings.
- Deduplicate concurrent Copilot token polls and recognize a token saved by
  another poll as a completed sign-in instead of reverting to a waiting error.

## 0.4.2

- Open ChatGPT device authorization in a dedicated window so the Settings popup
  is not replaced by an inaccessible authorization tab.
- Poll pending Codex device logins from the background with a Chrome Alarm, so
  closing or hiding Settings no longer prevents successful tokens from being saved.
- Deduplicate concurrent Codex polls from Settings, Channels, and the background,
  and treat a token saved by another poll as a completed login.
- Close the dedicated authorization window and focus the originating Settings
  window after token exchange succeeds.

## 0.4.1

- Temporarily restore the public Codex CLI Client ID as a centralized compatibility
  default so Codex / ChatGPT OAuth providers can be added without manual client setup.
- Start Codex device authorization from an agent request when its saved token is
  missing or revoked, then continue the original request after sign-in succeeds.
- Deliver authorization URL, device code, and operation approval prompts to the
  originating WeChat or Telegram conversation for remote sessions.
- Accept channel replies in the form `授权 CODE` or `拒绝 CODE`, bound to the exact
  channel and peer with a ten-minute expiration.
- Persist approval only for an exact scheduled JavaScript operation. Ad-hoc
  JavaScript still requires approval every time, and changes to the Schedule,
  target URL, execution world, or code require a new approval.
- Add a Settings control for clearing saved scheduled-operation approvals.

## 0.4.0

- Change required broad HTTP(S) access to optional host permissions, remove the
  persistent all-sites content script, and drop the unused `activeTab` permission.
- Add first-run product disclosure, first-use external-provider disclosure, and
  per-origin permission explanations.
- Pause previously enabled Channels, Schedules, and OAuth polling after upgrade
  until the current product disclosure has been accepted.
- Require explicit user approval with target and source preview before every
  `run_js` execution, in addition to the global JavaScript setting.
- Require Chrome 135+ for `userScripts.execute()` and remove the CSP-sensitive
  `eval` / `new Function` execution fallback from the extension package.
- Move enterprise WeChat robot configuration from global Notifications into the
  configurable `qiyewechat_notification` Tool with text and markdown support.
- Mark Schedules and self-management Tools as optional advanced features, with
  self-management disabled by default on fresh installs.
- Stop bundling third-party OAuth Client IDs and document per-distributor OAuth
  registration and public-client constraints.
- Add a bilingual privacy policy, Chrome Web Store listing material, manifest
  icons, store artwork, release validation, and reproducible packaging scripts.

## 0.3.0

- Add a local IndexedDB-backed knowledge base with VFS ingestion, keyword search,
  chunk reads, index removal, and status tools.
- Add a default WebClaw operation manual at
  `/workspace/knowledge/WEBCLAW_MANUAL.md`, indexed automatically on startup.
- Add OpenClaw-inspired VFS workspace bootstrap files for operating guidance,
  persona, tool conventions, identity, user preferences, and durable/daily memory.
- Add bounded structured tool trajectories to session history and reuse them in
  later model requests, including cross-provider continuation.
- Return recoverable tool errors, valid call examples, and recovery guidance to
  the model so it can correct tool arguments within the same agent run.
- Support `run_js` sources from VFS JavaScript files in addition to inline code.
- Initialize workspace defaults before opening the file manager and merge all
  workspace context into a single system message for Chrome AI compatibility.

## 0.2.0

- Add an IndexedDB-backed virtual filesystem shared by the agent and file manager.
- Add structured filesystem tools for listing, reading, writing, editing, searching,
  batched changes, moving, restoring, storage usage, and permanent trash deletion.
- Add the restricted `fs_shell` command tool for safe virtual filesystem commands.
- Add file management UI with browsing, text editing, upload, download, move, rename,
  trash restore, and permanent deletion.
- Archive downloaded WeChat media under the virtual `/inbox` directory.
- Open settings and the file manager in separate extension windows.
- Add trash metadata, conflict-aware restore, and irreversible purge controls.

## 0.1.0

- Initial browser extension implementation.
- Side panel chat UI.
- Provider support for Ollama, OpenAI-compatible APIs, Chrome AI, Codex OAuth,
  and GitHub Copilot OAuth.
- Browser agent tools for page context, navigation, DOM actions, JavaScript,
  HTTP requests, weather, search, translation, and selected Chrome APIs.
- Custom tools, skills, schedules, sessions, and channel support.
- WeChat, Telegram, and WeCom integrations.
