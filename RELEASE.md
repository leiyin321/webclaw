# Release Checklist

Use this checklist for GitHub and Chrome Web Store releases.

## 1. Prepare the version

1. Start from a clean release branch.
2. Update `manifest.json` version using Chrome's one-to-four integer format.
3. Add the matching section to `CHANGELOG.md`.
4. Review all user-facing documentation against the diff: `README.md`, `README.en.md`, `CHANGELOG.md`, relevant `docs/` files, `PRIVACY.md`, `OAUTH.md`, and `STORE_LISTING.md`. Add or update a focused document when a behavior or security boundary changes.
5. Confirm credentials and Client Secrets are absent. The temporary public Codex CLI and GitHub Copilot compatibility Client IDs must each appear only in `src/oauth-clients.js`, be disclosed in `OAUTH.md`, and be replaced with distributor-controlled identities when practical. Do not add any other borrowed OAuth Client ID.
6. Review `PRIVACY.md`, `OAUTH.md`, `STORE_LISTING.md`, and permission justifications.

## 2. Validate

```bash
./scripts/check-syntax.sh
node scripts/test-agent-runtime.mjs
./scripts/test-agent-loop.sh
node scripts/test-provider-client-metadata.mjs
node scripts/test-openai-compatible-structured-output.mjs
node scripts/validate-release.mjs
```

Load the unpacked extension in a clean Chrome profile and verify:

- first-run disclosure can be accepted and is remembered;
- declining first-run disclosure leaves the blocking disclosure visible and prevents Channels, Schedules, and OAuth polling from resuming;
- installation does not request all-site access;
- first model request explains external data sharing and asks for the configured provider origin;
- first page action explains and asks for that page origin;
- `run_js` is blocked when its setting is off, and ad-hoc execution requires approval every time when on;
- an exact Schedule `run_js` operation is remembered after approval, survives reload, asks again when its Schedule, full URL, world, or code changes, and can be revoked from Settings;
- denying an approval returns a useful Tool error and performs no action;
- missing Codex credentials prompt in the Side Panel, complete device login, and automatically continue the original request;
- Settings starts Codex login in a separate window; hide or close Settings, complete authorization, then confirm the background poll stores the token and reopening Settings shows connected without another login;
- Settings starts GitHub Copilot login in a separate window; hide or close Settings, complete authorization, then confirm the background poll stores the token and reopening Settings shows connected without another login;
- Codex model Refresh returns the current account catalog using the declared compatible client version, including a newly available model that an older client identity would hide;
- Copilot model Refresh includes both Chat Completions and Responses-only models returned for the account; selecting a Responses-only GPT-5.6 model sends the conversation through `/responses`, streams the result, and does not produce `model_not_supported`;
- an existing Copilot Provider saved with the legacy `vscode-chat` integration ID migrates to `copilot-developer-cli` without losing its OAuth tokens;
- a Codex request from both WeChat and Telegram receives a six-digit numeric approval code, accepts that code alone, rejects with `0`, then sends a verification URL and device code and continues after login; wrong-peer, denied, and expired replies do not authorize it;
- the enterprise WeChat notification Tool shows `qiyewechat_notification` as both Tool name and Display name, sends text and markdown through its Tool-specific webhook, and rejects the removed `send_wecom_message` name;
- the Tools window filters by text, category, and bundle, displays optional-permission state, and never restores removed Page or VFS Tool names from saved settings;
- an Agent run starts with the compact core Tool set, uses `tool_search` to load an enabled non-core Tool for that run, and does not persist that exposure into the next run;
- tab groups, recent sessions, downloads, bookmarks, history, clipboard, and local notifications remain disabled by default, request only their declared optional permission when enabled and loaded, and disappear from model schemas when that permission is absent; specifically, `browser_clipboard_read` requests only `clipboardRead` and `browser_clipboard_write` requests only `clipboardWrite`;
- `page_file_input` attaches a VFS file to an authorized page input; `fs_archive` round-trips a directory; `fs_manage` and `fs_trash` handle recoverable deletion, conflict-aware restore, and confirmed permanent deletion without accepting removed VFS names;
- `knowledge_search`, `knowledge_status`, and `knowledge_reindex` honor collection, path, tag, and time filters;
- `list_webclaw_config` returns redacted Provider IDs, `set_active_provider` switches only to an existing ID through propose/apply, and rollback restores the previous Provider without exposing credentials;
- the same session can switch among Ollama, Chrome AI, Codex, Copilot, and OpenAI-compatible Providers without changing Tool, Plan, approval, stop, or Turn behavior;
- a DeepSeek OpenAI-compatible Provider retries an unsupported `json_schema` request with `json_object`, completes the Agent turn, caches that mode, and does not repeat the initial compatibility 400 on the next turn;
- an OpenAI-compatible Provider set to Responses API sends `POST /responses`, streams `response.output_text.delta` events, preserves Stop behavior, and completes structured JSON Tool turns; verify `deepseek-v4-flash` against `https://api.deepseek.com`;
- a substantial task can display and persist an `update_plan` plan, and interruption records the Turn as interrupted;
- stopping immediately after a model returns Tool calls prevents any not-yet-started Tool operation from being created or executed;
- reloading after a deterministic `before_model` or `after_tool` checkpoint resumes with the saved model/Tool/time budgets, retry counters, progress state, task state, and working directory;
- reloading at `before_tool` reuses a completed operation result, retries only `safe` or `retry_safe` operations with the original call, and never automatically replays an operation with unknown external effects;
- a pending local approval reappears in the Side Panel and a pending Channel approval returns to the originating Channel and peer after service-worker recovery;
- a Tool result that exceeds the context limit is represented by `FULL_RESULT_REF` and can be read in bounded ranges with `agent_artifact_read`;
- clearing or deleting a session removes its related Agent RunStore records, while a running Turn remains present when a session already contains 100 completed Turn records;
- a long session compacts older context, remains usable after reload, and preserves recent messages, Tool errors, and unfinished work without showing the generated summary as a user message;
- the global Max steps field accepts a large positive integer without an artificial UI maximum;
- the file manager selects a directory on single click and enters it on double click, while HTML/HTM/XHTML/SVG Preview opens a top-level sandbox tab and Markdown/DOCX/XLSX/PPTX/PDF Preview opens the independent bounded document viewer;
- `document_schema` returns format-specific create fields, generated DOCX/XLSX/PPTX files open in at least one target Office application, PDF non-ASCII creation fails clearly, edits create restorable revisions, and permanent revision purge requires explicit confirmation;
- a static preview loads relative CSS, JavaScript, images, fonts, and JSON, executes inline page JavaScript, and persists its project-scoped localStorage compatibility layer after reload; verify that this is not treated as real website-origin storage;
- Provider sign-in, model refresh, Channels, and enabled Schedules work only after their origins and disclosures are granted;
- settings, sessions, VFS, knowledge, and credentials persist across extension reloads;
- revoking a site permission in Chrome causes a new permission request rather than a silent failure, even when a Schedule operation approval is saved.

## 3. Package

```bash
./scripts/package-extension.sh
```

The script reads the version from `manifest.json`, validates release invariants, creates `dist/webclaw-<version>.zip`, and writes a SHA-256 file. The zip contains only runtime files and required legal documents; store screenshots remain outside the extension package.

Inspect the archive before uploading:

```bash
unzip -l dist/webclaw-*.zip
```

The archive root must contain `manifest.json` directly. It must not contain `.git`, test credentials, `.env`, local logs, store artwork, source maps, or a previous release zip.

## 4. Chrome Web Store

1. Use the listing copy and permission explanations in `STORE_LISTING.md`.
2. Upload the PNG assets under `assets/store/` and the 128px icon under `assets/icons/`.
3. Publish `PRIVACY.md` at a stable public HTTPS URL; GitHub Pages is preferred over a branch-dependent blob URL.
4. Complete the Data usage form so it matches the in-product disclosure and privacy policy.
5. In reviewer notes, explain optional per-origin permissions, external-provider disclosure, optional advanced features, and the exact `run_js` approval flow.
6. Submit for review without changing code or listing behavior after the final package was tested.

## 5. GitHub release

Commit the release files, push them, then create and push the matching tag:

```bash
git tag -a v<version> -m "WebClaw v<version>"
git push origin v<version>
```

`.github/workflows/release.yml` verifies that the tag matches `manifest.json`, rebuilds the package, and creates or updates the GitHub Release with the zip and SHA-256 file. Do not create the tag until the exact commit has passed CI and clean-profile testing.
