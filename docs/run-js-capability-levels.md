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

Controller source is an async-function body, so top-level `await` and `return` are valid. It is not page JavaScript. Do not access `window`, `document`, `confirm`, page `localStorage`, or page-owned globals directly, and do not use direct `fetch` for approved cross-origin access. Put page logic inside `webclaw.page.run({code})` and network access through `webclaw.http.request(...)`.

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

For active-page DOM work, use this complete Tool shape:

```json
{
  "tool": {
    "name": "run_js",
    "args": {
      "level": "L3",
      "code": "const page = await webclaw.page.run({ world: 'USER_SCRIPT', code: \"const ok = window.confirm('Continue?'); return { answer: ok ? 'yes' : 'no', title: document.title };\" }); return page.result;",
      "capabilities": {
        "page": { "worlds": ["USER_SCRIPT"] }
      }
    }
  }
}
```

Use `MAIN` only if the nested page code must read or call JavaScript objects owned by the website. DOM, visible text, forms, `window.confirm`, and most page storage operations should start with L3 `USER_SCRIPT`. L4/L5 do not make controller code a page script; they only permit `webclaw.page.run` to select additional worlds.

L5 supports both `webclaw.chrome.tabs.query(...)` and `chrome.tabs.query(...)`. Every method must be declared in `capabilities.chrome` and belong to WebClaw's fixed allowlist. Namespace wildcards such as `tabs.*` expand only to allowlisted methods. Sensitive extension internals such as `identity`, `storage`, `runtime`, `permissions`, `scripting`, `userScripts`, `alarms`, and `sidePanel` are not exposed.

## Selection checklist

Before calling `run_js`, determine which resources the controller actually needs:

1. Compute only: L0, no capabilities.
2. VFS: L1 plus narrow read/write paths. L1 defaults to `/workspace/**` only when VFS scopes are omitted.
3. HTTP: L2 plus every target origin. Add explicit VFS scopes too when the same controller reads files, uploads files, or saves a response.
4. DOM/page APIs: L3 plus `capabilities.page.worlds:["USER_SCRIPT"]`; omit `tabIds` to use the active tab.
5. Page-owned globals: L4 plus `MAIN` in the declared worlds.
6. Chrome APIs: L5 plus exact `capabilities.chrome` methods. Add page/network/VFS capabilities separately if also needed.

Provide exactly one source: inline `code`, or `vfsPath` to a complete `.js`, `.mjs`, or `.cjs` controller body. Pass variable data through `input` instead of interpolating untrusted values into source. Return compact JSON-serializable data; save large output in VFS and return its path.

## Common failures

| Error or symptom | Cause | Correction |
| --- | --- | --- |
| `window/document/confirm is not defined` | Page code was placed in the sandbox controller | Move it into the `code` passed to `webclaw.page.run` and use L3+ |
| `webclaw.vfs.* requires L1` | Selected level is too low | Raise to L1 or higher and declare the needed VFS scope |
| VFS access is outside the empty scope at L2-L5 | Higher level did not inherit L1's default paths | Add explicit `capabilities.vfs.read/write` entries |
| Network request is outside declared origins | Origin missing or too narrow | Add the exact HTTP(S) origin to `capabilities.network.origins` |
| `MAIN is outside declared worlds` | MAIN was not approved | Use USER_SCRIPT, or select L4+ and declare MAIN |
| L5 page call has no approved tab | L5 does not imply page scope | Add `capabilities.page`, usually with USER_SCRIPT |
| Chrome method was not declared/allowlisted | Missing `capabilities.chrome` entry or unsupported API | Declare the exact supported method; use a normal Tool for blocked extension internals |
| Approved tab navigated | Approval is bound to the reviewed URL | Issue a new `run_js` call for the current page |
| Result is not serializable or too large | Returned DOM objects, functions, cycles, or excessive data | Return plain JSON data, or write large data to VFS and return a path |

After a failure, change only the level, world, path, origin, tab, or Chrome method identified by the error. Repeating the same call unchanged cannot succeed.

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
