# Changelog

All notable changes to WebClaw will be documented in this file.

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
