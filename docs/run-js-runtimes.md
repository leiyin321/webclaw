# run_js execution runtimes

`run_js` selects one of four mutually exclusive JavaScript environments. They are not cumulative permission levels. Code should be written for exactly one environment, and WebClaw rejects fields belonging to another runtime.

A single script cannot combine page globals and extension RPC. Split mixed workflows into separate `run_js` calls and pass a bounded JSON-serializable result through the Agent loop.

## Runtime summary

| Runtime | Chrome environment | Available APIs | Approval |
| --- | --- | --- | --- |
| `compute` | Manifest Sandbox Worker | `input` and standard computation APIs | No interactive approval |
| `page-isolated` | `chrome.userScripts.execute()` in `USER_SCRIPT` | `window`, `document`, DOM, page storage; isolated from website JS globals | Required |
| `page-main` | `chrome.userScripts.execute()` in `MAIN` | DOM and website-owned JavaScript globals | Required with MAIN-world warning |
| `extension` | Manifest Sandbox Worker with RPC | Explicitly declared `webclaw.vfs`, `webclaw.http`, and `webclaw.chrome` methods | Required |

All source is an async-function body, so top-level `await` and `return` are valid. Provide exactly one of inline `code` or `vfsPath`. Results must be JSON-serializable and remain within the result-size limit.

`timeoutMs` and Stop bound how long WebClaw waits and prevent subsequent Agent processing. Chrome cannot forcibly undo JavaScript already injected into a page, so page-side effects that started before a timeout or Stop may still have occurred.

## compute

Use `compute` for parsing, transformation, validation, algorithms, and other work with no external state:

```json
{
  "tool": {
    "name": "run_js",
    "args": {
      "runtime": "compute",
      "code": "return input.values.reduce((sum, value) => sum + value, 0);",
      "input": { "values": [1, 2, 3] }
    }
  }
}
```

`compute` does not require the JavaScript setting or an approval prompt. It has no `webclaw`, page, network, VFS, or Chrome capability. It accepts inline code only; loading a VFS source would be a file read and therefore would not be pure approval-free computation.

## page-isolated

Use `page-isolated` for normal DOM work. Write ordinary page JavaScript directly:

```json
{
  "tool": {
    "name": "run_js",
    "args": {
      "runtime": "page-isolated",
      "code": "const ok = window.confirm('Continue?'); return { ok, title: document.title, draft: localStorage.getItem('draft') };",
      "target": { "tab": "active" }
    }
  }
}
```

The code runs in Chrome's `USER_SCRIPT` world. It can access DOM and page-origin storage but cannot access JavaScript variables owned by the website's MAIN world. Use either `target.tab:"active"` or one explicit `target.tabId`. The approved tab URL is revalidated immediately before injection.

Do not call `webclaw.page.run`. That RPC no longer exists.

## page-main

Use `page-main` only when the script must access website-owned JavaScript globals:

```json
{
  "tool": {
    "name": "run_js",
    "args": {
      "runtime": "page-main",
      "code": "return { route: window.__APP_STATE__?.route, url: location.href };",
      "target": { "tab": "active" }
    }
  }
}
```

This code runs in the page's MAIN world. The website can observe, modify, or interfere with it, so WebClaw shows a stronger approval warning. Try `page-isolated` first when DOM access is sufficient.

Neither page runtime exposes VFS, background HTTP, WebClaw RPC, or Chrome extension APIs.

## extension

Use `extension` to combine computation with VFS, cross-origin HTTP, or allowlisted Chrome APIs:

```json
{
  "tool": {
    "name": "run_js",
    "args": {
      "runtime": "extension",
      "code": "const file = await webclaw.vfs.read('/workspace/input.json'); const response = await webclaw.http.request({ url: 'https://api.example.com/analyze', method: 'POST', json: JSON.parse(file.content) }); const tabs = await webclaw.chrome.tabs.query({ currentWindow: true }); return { result: response.json, tabCount: tabs.length };",
      "capabilities": {
        "methods": ["vfs.read", "http.request", "chrome.tabs.query"],
        "vfs": { "read": ["/workspace/input.json"] },
        "network": { "origins": ["https://api.example.com"] }
      }
    }
  }
}
```

Every RPC must pass two checks:

1. The exact method is in WebClaw's built-in RPC Registry.
2. The exact method is listed in this call's `capabilities.methods`.

Wildcards are not supported. VFS methods additionally require matching read/write scopes. `http.request` requires matching origins, uses manual redirects, and cannot redirect outside the approved scope. Chrome methods may require their matching optional Chrome permission.

The extension runtime exposes only `webclaw.*`:

```js
await webclaw.vfs.read(path);
await webclaw.http.request(options);
await webclaw.chrome.tabs.query(query);
```

There is no global `chrome` proxy, no `window` or `document`, and no page RPC. Sensitive extension control APIs such as `identity`, `storage`, `runtime`, `permissions`, `scripting`, `userScripts`, `alarms`, and `sidePanel` are not in the Registry.

## Resource scopes

VFS read and write are independent. Copy requires both source read and destination write. Move, restore, parent creation, trash purge, and similar operations validate their resolved paths rather than only the user-supplied parent.

```json
{
  "methods": ["vfs.read", "vfs.write", "http.request"],
  "vfs": {
    "read": ["/workspace/data/**"],
    "write": ["/workspace/reports/**"]
  },
  "network": {
    "origins": ["https://api.example.com"]
  }
}
```

Scopes without a matching method are rejected, except that `http.request` may use VFS read scope for multipart sources and VFS write scope for `saveToVfs`. VFS methods missing their required scopes are rejected.

## Selection checklist

1. No page, file, network, or Chrome access: `compute`.
2. DOM, forms, visible content, dialogs, or page storage: `page-isolated`.
3. Website-owned globals or framework runtime objects: `page-main`.
4. VFS, background HTTP, tabs, windows, bookmarks, history, downloads, sessions, tab groups, or notifications: `extension` with exact methods.

If one request needs both page and extension work, use separate Tool calls and pass the first result into the next call. A single script never spans page and extension environments.

## Common failures

| Error or symptom | Cause | Correction |
| --- | --- | --- |
| Invalid runtime `L3` | Old cumulative protocol | Select one current runtime name |
| `webclaw.page.run` unavailable | Removed nested page RPC | Put page code directly in page-isolated or page-main |
| `window/document is not defined` | Page code used in compute or extension | Select a page runtime |
| `webclaw is not defined` | Extension RPC used in compute or a page runtime | Select extension and declare exact methods/scopes |
| RPC method not declared | Missing `capabilities.methods` entry | Add the exact method; wildcards are invalid |
| VFS read/write denied | Path outside declared scope | Add the narrow matching read/write path |
| Network denied | Origin missing or too narrow | Add the exact HTTP(S) origin |
| Website global is undefined | Isolated world cannot see MAIN globals | Use page-main only if the global is actually required |
| Page target navigated | Approved URL changed | Submit a new call for the current page |
| Result cannot be serialized | Returned DOM objects, functions, cycles, or excessive data | Return plain JSON or save large output to VFS |

## Authorization and limits

The global JavaScript setting applies to `page-isolated`, `page-main`, and `extension`. Ad-hoc runs require approval every time. `compute` is approval-free because it has no external capability.

Exact Schedule approval fingerprints bind the Schedule ID, runtime, normalized capabilities, page target URL, and source code. Any change requires approval again. Extension Sandbox runs are limited to 100 RPC calls, a maximum 120-second timeout, 1,000,000-byte RPC arguments, and a 2,000,000-byte result. Large data should be stored in VFS and returned by path.
