# Release Checklist

Use this checklist before sharing a packaged build.

## Local Validation

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

## Package Unpacked Extension

```bash
zip -r webclaw-0.1.0.zip manifest.json src assets README.md LICENSE PRIVACY.md SECURITY.md \
  -x "*.DS_Store" \
  -x "*/.DS_Store"
```

The zip root must contain `manifest.json` directly.

## Before Public Distribution

- Verify the extension loads in `chrome://extensions`.
- Verify the provider setup flow you intend to support.
- Remove local test credentials from screenshots or docs.
- Review `PRIVACY.md` and `SECURITY.md`.
- Confirm broad permissions are still required for the release target.
