const string = (options = {}) => ({ type: "string", ...options });
const integer = (options = {}) => ({ type: "integer", ...options });
const boolean = (options = {}) => ({ type: "boolean", ...options });
const array = (items = {}, options = {}) => ({ type: "array", items, ...options });
const object = (properties = {}, required = [], options = {}) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
  ...options
});
const openObject = (description = "") => ({
  type: "object",
  properties: {},
  additionalProperties: true,
  ...(description ? { description } : {})
});

const definition = (name, category, description, inputSchema, exampleArgs, execution = {}, options = {}) => ({
  id: name,
  name,
  title: name,
  type: "builtin",
  category,
  description,
  inputSchema,
  outputSchema: options.outputSchema || openObject(),
  example: { tool: { name, args: exampleArgs } },
  effects: execution.effects || ["write"],
  risk: execution.risk || "normal",
  idempotency: execution.idempotency || "unknown",
  parallelSafe: execution.parallelSafe === true,
  timeoutMs: Number(execution.timeoutMs || 120000),
  resourceKind: execution.resourceKind || `tool:${name}`,
  permissions: options.permissions || [],
  optionalPermissions: options.optionalPermissions || [],
  hostPermissions: options.hostPermissions || [],
  bundle: options.bundle || category,
  defaultEnabled: options.defaultEnabled !== false,
  advanced: options.advanced === true,
  builtin: true,
  executor: options.executor || name
});

const read = (resourceKind, options = {}) => ({
  effects: ["read"],
  risk: "low",
  idempotency: "safe",
  parallelSafe: true,
  resourceKind,
  ...options
});
const write = (resourceKind, idempotency = "unknown", risk = "normal", options = {}) => ({
  effects: ["write"],
  risk,
  idempotency,
  parallelSafe: false,
  resourceKind,
  ...options
});

const BUILTIN_TOOL_DEFINITIONS = [
  definition(
    "page_snapshot",
    "page",
    "Read a bounded snapshot of the active page including URL, title, selected text, visible text, and interactive elements.",
    object({
      mode: string({ enum: ["default", "compact"] }),
      maxChars: integer({ minimum: 500, maximum: 30000 }),
      maxInteractive: integer({ minimum: 0, maximum: 200 }),
      disableSummary: boolean()
    }),
    { mode: "compact", maxChars: 6000, maxInteractive: 50 },
    read("chrome:active-tab"),
    { hostPermissions: ["active_tab_origin"] }
  ),
  definition("page_action", "page", "Perform a structured page action: click, type, select, check, hover, focus, keypress, scroll, or submit.",
    object({
      action: string({ enum: ["click", "type", "select", "check", "hover", "focus", "keypress", "scroll", "submit"] }),
      selector: string(), text: string(), clear: boolean(), value: string(), label: string(), checked: boolean(),
      key: string(), code: string(), ctrlKey: boolean(), altKey: boolean(), shiftKey: boolean(), metaKey: boolean(),
      top: integer(), left: integer(), deltaX: integer(), deltaY: integer(),
      behavior: string({ enum: ["auto", "instant", "smooth"] }),
      block: string({ enum: ["start", "center", "end", "nearest"] })
    }, ["action"]),
    { action: "click", selector: "button[type=submit]" }, write("chrome:active-tab", "unknown", "interactive"),
    { hostPermissions: ["active_tab_origin"] }),
  definition("page_wait", "page", "Wait for a timeout, selector visibility, selector disappearance, page text, URL substring, or document readiness.",
    object({
      condition: string({ enum: ["timeout", "selector_visible", "selector_hidden", "text", "url", "ready"] }),
      selector: string(), text: string(), url: string(), state: string({ enum: ["interactive", "complete"] }),
      timeoutMs: integer({ minimum: 0, maximum: 30000 }), pollMs: integer({ minimum: 50, maximum: 2000 })
    }, ["condition"]),
    { condition: "selector_visible", selector: "main", timeoutMs: 10000 }, read("chrome:active-tab", { timeoutMs: 35000 }),
    { hostPermissions: ["active_tab_origin"] }),
  definition("page_extract", "page", "Extract bounded structured data from the active page: text, links, tables, forms, metadata, JSON-LD, or selector matches.",
    object({
      kind: string({ enum: ["text", "links", "tables", "forms", "metadata", "jsonld", "selector"] }),
      selector: string(), attribute: string(), maxItems: integer({ minimum: 1, maximum: 200 }),
      maxChars: integer({ minimum: 100, maximum: 30000 })
    }, ["kind"]),
    { kind: "links", maxItems: 50 }, read("chrome:active-tab"),
    { hostPermissions: ["active_tab_origin"] }),
  definition("page_storage", "page", "Read or modify localStorage or sessionStorage for the active page origin. This does not access cookies.",
    object({
      action: string({ enum: ["list", "get", "set", "remove", "clear"] }),
      storage: string({ enum: ["local", "session"] }), key: string(), value: string(),
      maxItems: integer({ minimum: 1, maximum: 200 }), maxValueChars: integer({ minimum: 100, maximum: 20000 })
    }, ["action"]),
    { action: "list", storage: "local", maxItems: 50 }, write("chrome:active-tab", "action_dependent", "interactive"),
    { hostPermissions: ["active_tab_origin"], advanced: true }),
  definition("page_screenshot", "page", "Capture the visible area of the active tab and save the image to the virtual filesystem.",
    object({
      path: string(), format: string({ enum: ["png", "jpeg"] }), quality: integer({ minimum: 0, maximum: 100 })
    }),
    { path: "/workspace/screenshots/page.png", format: "png" }, write("vfs:args.path", "unknown", "interactive"),
    { permissions: ["tabs"], hostPermissions: ["active_tab_origin"] }),
  definition("page_file_input", "page", "Set one VFS file on a file input in the active page and dispatch input/change events.",
    object({ selector: string({ minLength: 1 }), path: string({ minLength: 1 }), filename: string() }, ["selector", "path"]),
    { selector: "input[type=file]", path: "/uploads/document.pdf" }, write("chrome:active-tab", "unknown", "interactive"),
    { hostPermissions: ["active_tab_origin"] }),
  definition("run_js", "page", "Execute JavaScript in a cumulative L0-L5 capability sandbox. L0 is isolated compute; L1 adds scoped VFS RPC; L2 adds declared-origin HTTP RPC; L3 adds USER_SCRIPT page RPC; L4 adds MAIN-world page RPC; L5 adds allowlisted Chrome API RPC. Requires the setting plus explicit approval.",
    object({
      code: string({ description: "Inline JavaScript source. Provide code or vfsPath, not both." }),
      vfsPath: string({ description: "VFS path to a .js, .mjs, or .cjs file. Provide code or vfsPath, not both." }),
      level: string({ enum: ["L0", "L1", "L2", "L3", "L4", "L5"] }),
      input: openObject("Structured input available to the script as input."),
      timeoutMs: integer({ minimum: 100, maximum: 120000 }),
      capabilities: object({
        vfs: object({
          read: array(string(), { description: "Allowed absolute VFS paths or path scopes ending in /* or /**." }),
          write: array(string(), { description: "Allowed absolute VFS paths or path scopes ending in /* or /**." })
        }),
        network: object({
          origins: array(string(), { description: "Allowed HTTP(S) origins, such as https://api.example.com or https://*.example.com/*." })
        }),
        page: object({
          tabIds: array(integer({ minimum: 0 })),
          worlds: array(string({ enum: ["USER_SCRIPT", "MAIN"] }))
        }),
        chrome: array(string(), { description: "Allowlisted Chrome methods such as tabs.query or bookmarks.search. Namespace wildcards such as tabs.* are accepted." })
      })
    }, ["level"]),
    { vfsPath: "/workspace/test.js", level: "L1", capabilities: { vfs: { read: ["/workspace/**"], write: ["/workspace/**"] } } },
    write("sandbox:declared-capabilities", "unknown", "interactive"),
    { permissions: ["userScripts"], hostPermissions: ["args.capabilities.network.origins", "args.capabilities.page.tabIds"], advanced: true }),
  definition("translate_page", "page", "Translate visible text on the active page and replace it in-place.",
    object({ targetLanguage: string({ minLength: 1 }) }),
    { targetLanguage: "Chinese" }, write("chrome:active-tab", "unknown", "interactive"),
    { hostPermissions: ["active_tab_origin"], bundle: "convenience" }),
  definition("web_search", "network", "Search the current web through the configured Brave Search API, with the browser search page as the internal fallback.",
    object({
      query: string({ minLength: 1 }),
      count: integer({ minimum: 1, maximum: 10 }),
      country: string(),
      language: string(),
      search_lang: string(),
      ui_lang: string(),
      freshness: string({ enum: ["day", "week", "month", "year"] }),
      date_after: string(),
      date_before: string()
    }, ["query"]),
    { query: "latest Chrome extension platform changes", count: 5, freshness: "month" },
    write("chrome:active-tab", "unknown", "interactive"),
    { permissions: ["tabs"], hostPermissions: ["web_search_provider_origin"], bundle: "convenience" }),
  definition("get_weather", "network", "Fetch current weather from Open-Meteo.",
    object({ location: string({ minLength: 1 }), language: string() }, ["location"]),
    { location: "Beijing", language: "zh" }, read("tool:get_weather"),
    { hostPermissions: ["https://*.open-meteo.com/*"], bundle: "convenience" }),
  definition("http_request", "network", "Send an HTTP or HTTPS request from the extension background.",
    object({
      url: string({ minLength: 1 }),
      method: string({ enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] }),
      headers: openObject("Request headers except browser-restricted headers."),
      json: {},
      body: string(),
      form: openObject("URL-encoded form fields."),
      multipart: object({
        fields: openObject("Multipart text fields."),
        files: array(object({
          field: string({ minLength: 1 }), path: string({ minLength: 1 }), filename: string(), contentType: string()
        }, ["field", "path"]), { maxItems: 20 })
      }),
      redirect: string({ enum: ["follow", "manual"] }),
      timeoutMs: integer({ minimum: 100, maximum: 120000 }),
      responseType: string({ enum: ["auto", "text", "json", "binary"] }),
      maxBytes: integer({ minimum: 1000, maximum: 20971520 }),
      saveToVfs: string()
    }, ["url"]),
    { url: "https://example.com/webhook", method: "POST", json: { text: "hello" } },
    write("network:args.url", "method_dependent", "external"),
    { hostPermissions: ["args.url"] }),
  definition("qiyewechat_notification", "notification", "Send a text or markdown notification through the enterprise WeChat robot webhook configured on this tool.",
    object({
      content: string({ minLength: 1 }),
      msgtype: string({ enum: ["text", "markdown"] }),
      mentioned_list: array(string()),
      mentioned_mobile_list: array(string())
    }, ["content"]),
    { content: "hello from WebClaw", msgtype: "text" },
    write("external:qiyewechat", "unknown", "external"),
    { defaultEnabled: false }),
  definition("browser_tabs", "browser", "Manage Chrome tabs with explicit actions: list, get, open, activate, navigate, reload, duplicate, move, pin, mute, or close. Actions that omit tabId use the active page tab.",
    object({
      action: string({ enum: ["list", "get", "open", "activate", "navigate", "reload", "duplicate", "move", "pin", "mute", "close"] }),
      tabId: integer({ minimum: 0 }),
      url: string(),
      active: boolean(),
      windowId: integer(),
      index: integer({ minimum: -1 }),
      pinned: boolean(),
      muted: boolean()
    }, ["action"]),
    { action: "list" }, write("chrome:tabs", "action_dependent", "interactive"),
    { permissions: ["tabs", "windows"] }),
  definition("browser_tab_groups", "browser", "List, create, update, move, or ungroup Chrome tab groups.",
    object({
      action: string({ enum: ["list", "create", "update", "move", "ungroup"] }), groupId: integer(), tabIds: array(integer()),
      title: string(), color: string({ enum: ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] }),
      collapsed: boolean(), windowId: integer(), index: integer({ minimum: -1 })
    }, ["action"]),
    { action: "list" }, write("chrome:tab-groups", "action_dependent", "interactive"),
    { optionalPermissions: ["tabGroups"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_sessions", "browser", "List or restore recently closed Chrome tabs and windows.",
    object({ action: string({ enum: ["list", "restore"] }), sessionId: string(), maxResults: integer({ minimum: 1, maximum: 25 }) }, ["action"]),
    { action: "list", maxResults: 10 }, write("chrome:sessions", "action_dependent", "interactive"),
    { optionalPermissions: ["sessions"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_downloads", "browser", "Search, start, pause, resume, cancel, erase, or show Chrome downloads.",
    object({
      action: string({ enum: ["search", "download", "pause", "resume", "cancel", "erase", "show"] }), id: integer(),
      url: string(), filename: string(), saveAs: boolean(), query: openObject("Chrome downloads search query.")
    }, ["action"]),
    { action: "search", query: {} }, write("chrome:downloads", "action_dependent", "interactive"),
    { optionalPermissions: ["downloads"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_bookmarks", "browser", "Search, create, update, move, or remove Chrome bookmarks.",
    object({
      action: string({ enum: ["search", "create", "update", "move", "remove"] }), id: string(), query: string(),
      parentId: string(), title: string(), url: string(), index: integer({ minimum: 0 }), recursive: boolean()
    }, ["action"]),
    { action: "search", query: "WebClaw" }, write("chrome:bookmarks", "action_dependent", "personal_data"),
    { optionalPermissions: ["bookmarks"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_history", "browser", "Search browser history, inspect visits, or delete one URL after explicit approval.",
    object({
      action: string({ enum: ["search", "visits", "delete_url"] }), text: string(), url: string(),
      startTime: integer({ minimum: 0 }), endTime: integer({ minimum: 0 }), maxResults: integer({ minimum: 1, maximum: 100 })
    }, ["action"]),
    { action: "search", text: "", maxResults: 20 }, write("chrome:history", "action_dependent", "personal_data"),
    { optionalPermissions: ["history"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_clipboard_read", "browser", "Read plain text from the browser clipboard after optional permission approval.",
    object(), {}, read("chrome:clipboard"),
    { optionalPermissions: ["clipboardRead"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_clipboard_write", "browser", "Write plain text to the browser clipboard after optional permission approval.",
    object({ text: string() }, ["text"]), { text: "Copied by WebClaw" },
    write("chrome:clipboard", "retry_safe", "personal_data"),
    { optionalPermissions: ["clipboardWrite"], bundle: "browser_personal_data", defaultEnabled: false, advanced: true }),
  definition("browser_notification", "browser", "Create or clear a local Chrome notification.",
    object({ action: string({ enum: ["create", "clear"] }), id: string(), title: string(), message: string(), requireInteraction: boolean() }, ["action"]),
    { action: "create", title: "WebClaw", message: "Task completed" }, write("chrome:notifications", "unknown", "external"),
    { optionalPermissions: ["notifications"], bundle: "notifications", defaultEnabled: false, advanced: true }),
  definition("update_plan", "agent", "Create or update the current turn plan for substantial multi-step work. Keep at most one step in_progress.",
    object({
      explanation: string(),
      plan: array(object({
        step: string({ minLength: 1 }),
        status: string({ enum: ["pending", "in_progress", "completed"] })
      }, ["step", "status"]), { minItems: 1, maxItems: 20 })
    }, ["plan"]),
    { explanation: "Initial implementation plan", plan: [{ step: "Inspect the current state", status: "in_progress" }] },
    write("agent:task-state", "retry_safe")),
  definition("task_push", "agent", "Create and synchronously execute an ephemeral child task with an independent model context and a JSON Schema result contract.",
    object({
      title: string(),
      instruction: string({ minLength: 1 }),
      context: openObject("Only the structured parent context needed by the child."),
      outputSchema: openObject("JSON Schema for the child task output."),
      outputInstructions: string(),
      maxSteps: integer({ minimum: 1 }),
      allowedTools: array(string()),
      workingDirectory: string()
    }, ["instruction"]),
    { instruction: "Verify the supplied sources.", context: {}, outputSchema: { type: "object" }, maxSteps: 6 },
    write("agent:task-state", "unknown")),
  definition("task_stack", "agent", "Inspect the current ephemeral task stack, active task frames, and remaining run budget.",
    object(), {}, read("tool:task_stack")),
  definition("tool_search", "agent", "Search enabled WebClaw capabilities by task description, category, or bundle and load matching Tool definitions into the current Agent run.",
    object({ query: string({ minLength: 1 }), category: string(), bundle: string(), limit: integer({ minimum: 1, maximum: 12 }) }, ["query"]),
    { query: "capture a screenshot and inspect page metadata", limit: 6 }, write("agent:tool-exposure", "retry_safe"),
    { bundle: "core" }),
  definition("fs_shell", "vfs", "Run one safe virtual filesystem command. Supported commands: pwd, cd, ls, stat, mkdir, touch, cat, cp, mv, rm. cd changes the current session working directory.",
    object({ command: string({ minLength: 1 }), cwd: string() }, ["command"]),
    { command: "cd notes" }, write("vfs:/", "unknown"), { bundle: "vfs_compatibility" }),
  definition("fs_list", "vfs", "List a virtual filesystem directory or inspect one file.",
    object({ path: string() }), { path: "/workspace" }, read("vfs:args.path")),
  definition("fs_stat", "vfs", "Read metadata for one virtual filesystem file or directory.",
    object({ path: string({ minLength: 1 }) }, ["path"]), { path: "/workspace/README.md" }, read("vfs:args.path")),
  definition("fs_read", "vfs", "Read a virtual filesystem file with optional text line and character limits.",
    object({
      path: string({ minLength: 1 }), startLine: integer({ minimum: 1 }), endLine: integer({ minimum: 1 }),
      maxChars: integer({ minimum: 1 }), includeData: boolean()
    }, ["path"]),
    { path: "/workspace/notes/today.md", startLine: 1, endLine: 80 }, read("vfs:args.path")),
  definition("fs_write", "vfs", "Create or replace a text file in the virtual filesystem with optional optimistic version checking.",
    object({
      path: string({ minLength: 1 }), content: string(), mimeType: string(), expectedVersion: integer({ minimum: 0 }), createParents: boolean()
    }, ["path", "content"]),
    { path: "/workspace/notes/today.md", content: "# Today", createParents: true },
    write("vfs:args.path", "retry_safe")),
  definition("fs_edit", "vfs", "Safely replace exact text in a virtual text file.",
    object({
      path: string({ minLength: 1 }), oldText: string(), newText: string(), expectedVersion: integer({ minimum: 0 }), replaceAll: boolean()
    }, ["path", "oldText", "newText"]),
    { path: "/workspace/notes/today.md", oldText: "# Today", newText: "# Today\n\n- Review tasks", expectedVersion: 1 },
    write("vfs:args.path", "unknown")),
  definition("fs_search", "vfs", "Search text files in a virtual filesystem directory and return matching lines.",
    object({ query: string({ minLength: 1 }), path: string(), maxResults: integer({ minimum: 1 }) }, ["query"]),
    { query: "TODO", path: "/workspace", maxResults: 30 }, read("vfs:/")),
  definition("fs_glob", "vfs", "Find virtual filesystem files and directories by glob pattern. Supports *, ?, and **.",
    object({ pattern: string({ minLength: 1 }), path: string(), maxResults: integer({ minimum: 1, maximum: 1000 }) }, ["pattern"]),
    { pattern: "**/*.js", path: "/workspace", maxResults: 200 }, read("vfs:/")),
  definition("fs_hash", "vfs", "Calculate a SHA-256, SHA-384, or SHA-512 hash for a virtual filesystem file.",
    object({ path: string({ minLength: 1 }), algorithm: string({ enum: ["SHA-256", "SHA-384", "SHA-512"] }) }, ["path"]),
    { path: "/workspace/app.js", algorithm: "SHA-256" }, read("vfs:args.path")),
  definition("fs_diff", "vfs", "Compare two virtual text files and return a bounded unified diff.",
    object({ from: string({ minLength: 1 }), to: string({ minLength: 1 }), maxChars: integer({ minimum: 1000, maximum: 200000 }) }, ["from", "to"]),
    { from: "/workspace/app.old.js", to: "/workspace/app.js", maxChars: 60000 }, read("vfs:args.from+args.to")),
  definition("fs_apply_patch", "vfs", "Apply a validated batch of virtual filesystem mkdir, write, edit, move, or delete operations.",
    object({ operations: array(openObject("A VFS patch operation."), { minItems: 1 }) }, ["operations"]),
    { operations: [{ op: "write", path: "/workspace/README.md", content: "# Project", createParents: true }] },
    write("vfs:/", "unknown")),
  definition("fs_manage", "vfs", "Manage normal VFS entries with mkdir, move, copy, touch, or trash actions.",
    object({
      action: string({ enum: ["mkdir", "move", "copy", "touch", "trash"] }),
      path: string(), from: string(), to: string(), parents: boolean(), recursive: boolean()
    }, ["action"]),
    { action: "mkdir", path: "/workspace/notes", parents: true }, write("vfs:manage", "action_dependent")),
  definition("fs_trash", "vfs", "List, restore, permanently purge, or empty VFS trash. Purge and empty require confirm=true.",
    object({
      action: string({ enum: ["list", "restore", "purge", "empty"] }),
      trashPath: string(), destination: string(), path: string(), recursive: boolean(), confirm: boolean(),
      onConflict: string({ enum: ["error", "rename", "overwrite"] }), confirmOverwrite: boolean()
    }, ["action"]),
    { action: "list" }, write("vfs:trash", "action_dependent", "irreversible"), { advanced: true }),
  definition("fs_usage", "vfs", "Get virtual filesystem file count and browser storage usage.",
    object(), {}, read("tool:fs_usage")),
  definition("fs_archive", "vfs", "Create, list, or extract a portable WebClaw JSON archive of VFS files and directories.",
    object({
      action: string({ enum: ["create", "list", "extract"] }), source: string(), archivePath: string(), destination: string(), overwrite: boolean()
    }, ["action"]),
    { action: "create", source: "/workspace/project", archivePath: "/exports/project.webclaw-archive.json" },
    write("vfs:/", "unknown")),
  definition("fs_preview_open", "vfs", "Open an HTML, HTM, XHTML, or SVG VFS file in WebClaw's isolated static-site preview tab.",
    object({ path: string({ minLength: 1 }) }, ["path"]), { path: "/workspace/site/index.html" },
    write("chrome:tabs", "unknown", "interactive"), { permissions: ["tabs"] }),
  definition("document_inspect", "document", "Inspect a VFS document format, structure, version, hash, capabilities, and warnings without returning the full content.",
    object({ path: string({ minLength: 1 }), includeOutline: boolean() }, ["path"]),
    { path: "/workspace/documents/report.md", includeOutline: true },
    read("document:args.path"), { bundle: "documents" }),
  definition("document_read", "document", "Read a bounded Markdown, DOCX, XLSX, PPTX, or PDF projection by line range, heading, paragraph, cell, or slide when supported. PDF page isolation is unavailable.",
    object({
      path: string({ minLength: 1 }), locator: openObject("Optional line_range, heading, docx_paragraph, xlsx_cell, or pptx_slide locator."), output: string({ enum: ["markdown", "json"] }), maxChars: integer({ minimum: 500, maximum: 200000 })
    }, ["path"]),
    { path: "/workspace/documents/report.md", output: "markdown", maxChars: 12000 },
    read("document:args.path"), { bundle: "documents" }),
  definition("document_schema", "document", "Return the exact versioned create, edit, or export schema for a supported document format.",
    object({ format: string({ minLength: 1 }), operation: string({ enum: ["read", "create", "edit", "export"] }), mode: string({ enum: ["basic", "rich"] }), schemaVersion: string(), actions: array(string()) }, ["format", "operation"]),
    { format: "markdown", operation: "edit", mode: "basic", actions: ["replace_text", "insert_after_heading"] },
    read("document:schema"), { bundle: "documents" }),
  definition("document_create", "document", "Create a supported document in VFS from a versioned format-specific structured specification.",
    object({ path: string({ minLength: 1 }), format: string({ minLength: 1 }), schemaVersion: string({ minLength: 1 }), templateId: string(), spec: openObject(), overwrite: boolean(), expectedVersion: integer({ minimum: 0 }), expectedHash: string(), createParents: boolean() }, ["path", "format", "schemaVersion", "spec"]),
    { path: "/workspace/documents/report.md", format: "markdown", schemaVersion: "markdown-1", spec: { content: "# Report\n" }, createParents: true },
    write("document:args.path", "retry_safe"), { bundle: "documents" }),
  definition("document_edit", "document", "Apply version-checked structured edits to a supported VFS document and return the new version, hash, changes, and warnings.",
    object({ path: string({ minLength: 1 }), format: string({ minLength: 1 }), schemaVersion: string({ minLength: 1 }), expectedVersion: integer({ minimum: 0 }), expectedHash: string(), editMode: string({ enum: ["preserve", "rebuild"] }), operations: array(openObject("Format-specific document edit operation."), { minItems: 1, maxItems: 100 }) }, ["path", "format", "schemaVersion", "operations"]),
    { path: "/workspace/documents/report.md", format: "markdown", schemaVersion: "markdown-1", expectedVersion: 1, operations: [{ op: "replace_text", oldText: "Draft", newText: "Final" }] },
    write("document:args.path", "retry_safe"), { bundle: "documents" }),
  definition("document_render", "document", "Render a supported document to a safe local VFS HTML preview for inspection or model visual review.",
    object({ path: string({ minLength: 1 }), outputPath: string(), title: string(), selection: openObject() }, ["path"]),
    { path: "/workspace/documents/report.md", outputPath: "/cache/document-previews/report.html" },
    write("document:args.path", "retry_safe"), { bundle: "documents" }),
  definition("document_export", "document", "Export a supported document to another supported VFS representation without overwriting the source.",
    object({ path: string({ minLength: 1 }), targetFormat: string({ enum: ["markdown", "html", "json"] }), outputPath: string({ minLength: 1 }), options: openObject() }, ["path", "targetFormat", "outputPath"]),
    { path: "/workspace/documents/report.md", targetFormat: "html", outputPath: "/exports/report.html" },
    write("document:args.path", "retry_safe"), { bundle: "documents" }),
  definition("document_revision", "document", "Create, list, restore, or permanently purge versioned VFS document snapshots with optimistic concurrency checks.",
    object({ action: string({ enum: ["snapshot", "list", "restore", "purge"] }), path: string({ minLength: 1 }), revisionId: string(), expectedVersion: integer({ minimum: 0 }), expectedHash: string(), limit: integer({ minimum: 1, maximum: 200 }), confirm: boolean() }, ["action", "path"]),
    { action: "list", path: "/workspace/documents/report.md", limit: 20 },
    write("document:args.path", "action_dependent"), { bundle: "documents" }),
  definition("knowledge_ingest", "knowledge", "Index a text file from VFS for local knowledge search.",
    object({ path: string({ minLength: 1 }), title: string(), tags: array(string()), collection: string() }, ["path"]),
    { path: "/workspace/knowledge/product-notes.md", tags: ["product", "notes"] },
    write("tool:knowledge_ingest", "unknown")),
  definition("knowledge_search", "knowledge", "Search the local knowledge base and return small cited chunks.",
    object({
      query: string({ minLength: 1 }), limit: integer({ minimum: 1 }), tags: array(string()), path: string(), collection: string(),
      updatedAfter: integer({ minimum: 0 }), updatedBefore: integer({ minimum: 0 })
    }, ["query"]),
    { query: "product launch decision", limit: 5 }, read("knowledge:index")),
  definition("knowledge_read", "knowledge", "Read indexed knowledge chunks by documentId and optional chunk range.",
    object({ documentId: string({ minLength: 1 }), chunkStart: integer({ minimum: 0 }), chunkEnd: integer({ minimum: 0 }) }, ["documentId"]),
    { documentId: "vfs:/workspace/knowledge/product-notes.md", chunkStart: 0, chunkEnd: 1 }, read("knowledge:index")),
  definition("knowledge_forget", "knowledge", "Remove a document from the local knowledge index without deleting its VFS source.",
    object({ path: string(), documentId: string() }),
    { path: "/workspace/knowledge/product-notes.md" }, write("tool:knowledge_forget", "unknown")),
  definition("knowledge_status", "knowledge", "Show local knowledge base document, chunk, and source-size status.",
    object({ path: string(), tags: array(string()), collection: string(), limit: integer({ minimum: 1, maximum: 10000 }) }),
    {}, read("tool:knowledge_status")),
  definition("knowledge_reindex", "knowledge", "Reindex matching VFS-backed knowledge documents using optional path, tag, collection, and time filters.",
    object({
      path: string(), tags: array(string()), collection: string(), updatedAfter: integer({ minimum: 0 }),
      updatedBefore: integer({ minimum: 0 }), chunkChars: integer({ minimum: 500, maximum: 4000 })
    }),
    { path: "/workspace/knowledge" }, write("knowledge:index", "retry_safe")),
  definition("agent_artifact_read", "agent", "Read a bounded character range from a large Agent Tool Result referenced by FULL_RESULT_REF.",
    object({ artifactId: string({ minLength: 1 }), offset: integer({ minimum: 0 }), maxChars: integer({ minimum: 500, maximum: 12000 }) }, ["artifactId"]),
    { artifactId: "artifact-id", offset: 0, maxChars: 8000 }, read("tool:agent_artifact_read")),
  definition("list_webclaw_config", "configuration", "Read a redacted summary of WebClaw tools, skills, schedules, providers, channels, and pending patches.",
    object(), {}, read("tool:list_webclaw_config"), { advanced: true, bundle: "self_management" }),
  definition("propose_webclaw_config_patch", "configuration", "Propose validated changes to tools, skills, schedules, or the active Provider without applying them.",
    object({ operations: array(openObject("A supported configuration patch operation."), { minItems: 1, maxItems: 20 }) }, ["operations"]),
    { operations: [{ op: "set_active_provider", providerId: "provider-id" }] },
    write("webclaw:configuration", "unknown", "configuration"), { advanced: true, defaultEnabled: false, bundle: "self_management" }),
  definition("apply_webclaw_config_patch", "configuration", "Apply a patch previously returned by propose_webclaw_config_patch.",
    object({ patchId: string({ minLength: 1 }) }, ["patchId"]),
    { patchId: "patch-id" }, write("webclaw:configuration", "unknown", "configuration"),
    { advanced: true, defaultEnabled: false, bundle: "self_management" }),
  definition("rollback_webclaw_config_patch", "configuration", "Rollback the latest applied self-management patch by changeId.",
    object({ changeId: string({ minLength: 1 }) }, ["changeId"]),
    { changeId: "change-id" }, write("webclaw:configuration", "unknown", "configuration"),
    { advanced: true, defaultEnabled: false, bundle: "self_management" })
];

const BY_NAME = new Map(BUILTIN_TOOL_DEFINITIONS.map((item) => [item.name, item]));
const REMOVED_TOOL_NAMES = new Set([
  "get_page_context",
  "click",
  "type_text",
  "navigate",
  "chrome_api",
  "wait",
  "send_wecom_message",
  "browser_clipboard",
  "fs_mkdir",
  "fs_move",
  "fs_delete",
  "fs_restore",
  "fs_purge",
  "fs_empty_trash",
  "search_web"
]);

export function builtinToolDefinitions() {
  return BUILTIN_TOOL_DEFINITIONS;
}

export function builtinToolDefinition(name) {
  return BY_NAME.get(String(name || "").trim()) || null;
}

export function isRemovedBuiltinToolName(name) {
  return REMOVED_TOOL_NAMES.has(String(name || "").trim());
}

export function builtinToolUiDefinitions() {
  return BUILTIN_TOOL_DEFINITIONS.map((item) => ({
    id: item.name,
    name: item.name,
    title: item.title,
    type: "builtin",
    category: item.category,
    description: item.description,
    enabled: item.defaultEnabled,
    builtin: true,
    advanced: item.advanced,
    bundle: item.bundle,
    optionalPermissions: item.optionalPermissions
  }));
}

export function builtinToolInputSchema(name) {
  return builtinToolDefinition(name)?.inputSchema || null;
}

export function builtinToolExecutionMetadata(name, args = {}) {
  const item = builtinToolDefinition(name);
  if (!item) return null;
  const resources = resolveResourceKeys(item.resourceKind, args).map((key) => ({
    key,
    mode: item.effects.includes("write") ? "write" : "read"
  }));
  const method = String(args.method || "GET").toUpperCase();
  const methodReadOnly = item.name === "http_request" && method === "GET";
  const tabAction = String(args.action || "").toLowerCase();
  const tabReadOnly = item.name === "browser_tabs" && ["list", "get"].includes(tabAction);
  const chromeReadOnly = ["browser_tab_groups", "browser_sessions", "browser_downloads", "browser_bookmarks", "browser_history"]
    .includes(item.name) && ["list", "search", "visits"].includes(tabAction);
  const storageAction = String(args.action || "").toLowerCase();
  const storageReadOnly = item.name === "page_storage" && ["list", "get"].includes(storageAction);
  const trashReadOnly = item.name === "fs_trash" && storageAction === "list";
  const readOnly = methodReadOnly || tabReadOnly || chromeReadOnly || storageReadOnly || trashReadOnly;
  const manageRetrySafe = item.name === "fs_manage" && ["mkdir", "touch"].includes(storageAction);
  return {
    effects: readOnly ? ["read"] : [...item.effects],
    resources: readOnly ? resources.map((resource) => ({ ...resource, mode: "read" })) : resources,
    risk: readOnly ? "low" : item.risk,
    idempotency: readOnly ? "safe" : manageRetrySafe ? "retry_safe" : ["method_dependent", "action_dependent"].includes(item.idempotency) ? "unknown" : item.idempotency,
    parallelSafe: readOnly || item.parallelSafe,
    timeoutMs: item.timeoutMs
  };
}

function resolveResourceKeys(kind, args) {
  if (kind === "network:args.url") return [`network:${safeOrigin(args.url)}`];
  if (kind === "vfs:args.path") return [`vfs:${String(args.path || "/workspace")}`];
  if (kind === "document:args.path") return [`vfs:${String(args.path || "/workspace")}`];
  if (kind === "vfs:args.from+args.to") return [
    `vfs:${String(args.from || "/")}`,
    `vfs:${String(args.to || "/")}`
  ];
  if (kind === "vfs:args.restore") {
    return [`vfs:${String(args.path || args.destination || args.trashPath || "/")}`];
  }
  if (kind === "vfs:manage") {
    const resources = [args.from, args.to, args.path]
      .filter(Boolean)
      .map((path) => `vfs:${String(path)}`)
      .slice(0, 2);
    return resources.length > 0 ? resources : ["vfs:/"];
  }
  if (kind === "vfs:trash") return [`vfs:${String(args.trashPath || args.path || "/.trash")}`];
  return [String(kind || "tool:unknown")];
}

function safeOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "unknown";
  }
}
