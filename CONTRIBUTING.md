# Contributing

Thanks for helping improve WebClaw.

## Development Setup

1. Clone the repository.
2. Run `npm ci && npm run build:documents` to install the fixed document-engine dependencies and build `build/document/document-sandbox.js`.
3. Open `chrome://extensions`.
4. Enable Developer mode.
5. Click `Load unpacked`.
6. Select the repository directory.

The extension itself is plain Manifest V3 source, but the Office/PDF document engines require the local bundle generated in step 2.

## Validation

Run these checks before opening a pull request:

```bash
npm run build:documents
npm run test:documents
./scripts/check-syntax.sh
node scripts/test-agent-runtime.mjs
./scripts/test-agent-loop.sh
node scripts/test-provider-client-metadata.mjs
node scripts/test-openai-compatible-structured-output.mjs
node scripts/validate-release.mjs
```

## Pull Request Guidelines

- Keep changes focused.
- Do not commit generated extension packages such as `.zip`, `.crx`, or `.pem`.
- Avoid broadening extension permissions unless the feature requires it.
- For new tools, document the security boundary and default behavior.
- For provider or channel changes, avoid logging tokens, webhooks, cookies, or message contents.

## Security-sensitive Areas

Changes in these areas need extra review:

- `run_js` and `userScripts`
- `http_request`
- OAuth token handling
- channel auto-reply behavior
- media/file handling
- `chrome.storage.local` schema migrations
