# run_js L0-L5 capability runtime

`run_js` always executes its controller code in a Manifest Sandbox. Higher levels do not move the controller into a more privileged JavaScript realm. Instead, each level makes additional capability-scoped RPC methods available. The background service worker owns the approved run record and validates every RPC call again.

## Levels

| Level | Adds | Typical use |
| --- | --- | --- |
| L0 | Isolated JavaScript computation | Parsing, transformation, validation, algorithms |
| L1 | Scoped VFS RPC | Read, generate, edit, move, or inspect approved VFS paths |
| L2 | Declared-origin HTTP RPC | Combine computation, VFS data, and cross-origin requests |
| L3 | `USER_SCRIPT` page RPC | Read or modify DOM with an isolated script world |
| L4 | `MAIN` page RPC | Interact with page-owned JavaScript globals when DOM access is insufficient |
| L5 | Allowlisted Chrome API RPC | Tabs, windows, bookmarks, history, downloads, sessions, tab groups, notifications |

Levels are cumulative capability ceilings. `capabilities` is the narrower scope actually approved for a run. L1 alone defaults read/write to `/workspace/**` for convenience. At L2-L5, lower-level VFS and network scopes must be explicit; L5 receives page access only when `capabilities.page` is present. Declaring a capability above the selected level is an argument error. Calls outside the approved scope are rejected at the RPC boundary.

## Script API

The sandbox provides `input`, `webclaw`, and a controlled `chrome` proxy:

```js
const source = await webclaw.vfs.read("/workspace/input.json");
const response = await webclaw.http.request({
  url: "https://api.example.com/analyze",
  method: "POST",
  json: JSON.parse(source.content)
});
await webclaw.vfs.write("/workspace/output.json", JSON.stringify(response.json, null, 2), {
  createParents: true,
  mimeType: "application/json"
});
return { status: response.status, path: "/workspace/output.json" };
```

VFS methods are `list`, `stat`, `read`, `glob`, `hash`, `diff`, `search`, `usage`, `write`, `edit`, `mkdir`, `move`, `copy`, `touch`, `delete`, `restore`, `purge`, and `emptyTrash`. Read and write paths are checked independently against `capabilities.vfs.read` and `capabilities.vfs.write`.
Copy and move authorize the resolved destination rather than only the requested directory. Operations that create missing parent directories require write scope for those directories as well.

Network calls use `webclaw.http.request(options)` and the same request format as `http_request`. The URL must match `capabilities.network.origins`; multipart source files and `saveToVfs` paths also require matching VFS scopes. Sandbox RPC uses manual redirect mode so an approved origin cannot redirect a request to an undeclared origin.

Page calls use:

```js
const pageResult = await webclaw.page.run({
  tabId: 123,
  world: "USER_SCRIPT",
  code: "return { title: document.title, url: location.href };"
});
return pageResult.result;
```

If `tabId` is omitted, WebClaw uses the first approved tab. L3 permits only `USER_SCRIPT`; L4 and L5 can declare `MAIN`. Page Content Security Policy does not block the User Scripts injection path.

L5 supports both `webclaw.chrome.tabs.query(...)` and `chrome.tabs.query(...)`. Every method must be declared in `capabilities.chrome` and belong to WebClaw's fixed allowlist. Namespace wildcards such as `tabs.*` expand only to allowlisted methods. Sensitive extension internals such as `identity`, `storage`, `runtime`, `permissions`, `scripting`, `userScripts`, `alarms`, and `sidePanel` are not exposed.

## Example call

```json
{
  "tool": {
    "name": "run_js",
    "args": {
      "level": "L2",
      "vfsPath": "/workspace/scripts/report.js",
      "input": { "date": "2026-08-11" },
      "timeoutMs": 30000,
      "capabilities": {
        "vfs": {
          "read": ["/workspace/data/**"],
          "write": ["/workspace/reports/**"]
        },
        "network": {
          "origins": ["https://api.example.com"]
        }
      }
    }
  }
}
```

The global JavaScript setting must be enabled. Ad-hoc runs require approval every time. Exact Schedule approval fingerprints bind the Schedule ID, level, normalized capabilities, page targets, and source code. An offscreen run is limited to 100 RPC calls, a maximum 120-second timeout, 1,000,000-byte RPC arguments, and a 2,000,000-byte RPC/script result; large data should be stored in VFS and returned by path.
