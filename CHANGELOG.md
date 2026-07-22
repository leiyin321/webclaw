# Changelog

All notable changes to WebClaw will be documented in this file.

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
