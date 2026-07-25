# Release Checklist

Use this checklist for GitHub and Chrome Web Store releases.

## 1. Prepare the version

1. Start from a clean release branch.
2. Update `manifest.json` version using Chrome's one-to-four integer format.
3. Add the matching section to `CHANGELOG.md`.
4. Confirm credentials and Client Secrets are absent. The temporary public Codex CLI and GitHub Copilot compatibility Client IDs must each appear only in `src/oauth-clients.js`, be disclosed in `OAUTH.md`, and be replaced with distributor-controlled identities when practical. Do not add any other borrowed OAuth Client ID.
5. Review `PRIVACY.md`, `OAUTH.md`, `STORE_LISTING.md`, and permission justifications.

## 2. Validate

```bash
./scripts/check-syntax.sh
node scripts/test-agent-runtime.mjs
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
- a Codex request from both WeChat and Telegram receives a six-digit numeric approval code, accepts that code alone, rejects with `0`, then sends a verification URL and device code and continues after login; wrong-peer, denied, and expired replies do not authorize it;
- the enterprise WeChat notification Tool shows `qiyewechat_notification` as both Tool name and Display name, preserves an existing webhook migrated from `send_wecom_message`, and displays any legacy model call under the canonical name;
- `list_webclaw_config` returns redacted Provider IDs, `set_active_provider` switches only to an existing ID through propose/apply, and rollback restores the previous Provider without exposing credentials;
- the same session can switch among Ollama, Chrome AI, Codex, Copilot, and OpenAI-compatible Providers without changing Tool, Plan, approval, stop, or Turn behavior;
- a substantial task can display and persist an `update_plan` plan, and interruption records the Turn as interrupted;
- a long session compacts older context, remains usable after reload, and preserves recent messages, Tool errors, and unfinished work without showing the generated summary as a user message;
- the global Max steps field accepts a large positive integer without an artificial UI maximum;
- the file manager selects a directory on single click and enters it on double click, while HTML/HTM/XHTML/SVG Preview opens a top-level sandbox tab;
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
