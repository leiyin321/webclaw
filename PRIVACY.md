# Privacy

WebClaw stores data locally in the browser extension profile and sends data only
as needed to user-configured services.

## Data Stored Locally

WebClaw may store the following in `chrome.storage.local` or browser extension
storage:

- provider settings
- OAuth access and refresh tokens
- API keys entered by the user
- webhook URLs
- chat sessions
- tools, skills, schedules, and channels
- WeChat or Telegram channel state
- downloaded channel media needed for model input

## Data Processed

Depending on enabled features, WebClaw may process:

- active page URL and title
- selected text and visible page text
- DOM element summaries
- user chat messages
- model responses and tool calls
- channel messages from WeChat or Telegram
- images, PDFs, and other files sent through supported channels

## Data Shared with Third Parties

WebClaw may send data to services configured by the user, including:

- local Ollama
- OpenAI-compatible APIs
- ChatGPT/Codex endpoints
- GitHub Copilot endpoints
- Chrome built-in AI APIs
- Telegram Bot API
- WeCom robot webhooks
- user-configured HTTP tools

The exact data sent depends on the active provider, enabled tools, and current
task. WebClaw does not operate a separate WebClaw-hosted backend in this
repository.

## User Control

Users can:

- switch providers
- delete providers, channels, tools, skills, and schedules
- clear or delete sessions
- disable JavaScript execution
- remove webhook URLs and API keys
- uninstall the extension to remove extension-local data from the browser

## Sensitive Data

Do not paste secrets into prompts unless you intend to send them to the active
provider. Be careful when enabling tools that read page context, run JavaScript,
or send HTTP requests.
