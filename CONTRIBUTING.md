# Contributing

Thanks for helping improve WebClaw.

## Development Setup

1. Clone the repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click `Load unpacked`.
5. Select the repository directory.

No build step is required. WebClaw is a plain Manifest V3 extension.

## Validation

Run these checks before opening a pull request:

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
