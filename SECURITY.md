# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for vulnerabilities involving credentials,
tokens, message contents, or browser data access.

Report security issues by opening a private GitHub security advisory when
available, or by contacting the repository owner directly.

Include:

- affected version or commit
- reproduction steps
- impact
- whether tokens, cookies, local storage, files, or channel messages are exposed

## Security Model

WebClaw is a browser extension AI agent. It can read the active page, call
configured model providers, execute selected extension tools, and optionally
execute JavaScript on pages when explicitly enabled.

Important boundaries:

- JavaScript execution is disabled by default.
- `run_js` can access data available to ordinary JavaScript on the active page,
  but cannot read HttpOnly cookies or bypass browser same-origin restrictions.
- OAuth tokens, API keys, webhook URLs, chat sessions, and channel state are
  stored in `chrome.storage.local`.
- Page content and channel messages may be sent to the active model provider
  selected by the user.
- Tools that send network requests or channel messages should remain visible in
  the chat transcript.

## Supported Versions

Only the latest commit on `main` is currently supported.
