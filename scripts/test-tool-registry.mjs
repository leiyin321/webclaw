import assert from "node:assert/strict";
import {
  builtinToolDefinition,
  builtinToolDefinitions,
  builtinToolExecutionMetadata,
  builtinToolInputSchema,
  builtinToolUiDefinitions,
  isRemovedBuiltinToolName
} from "../src/tool-registry.js";

const definitions = builtinToolDefinitions();
const names = definitions.map((tool) => tool.name);

assert.equal(definitions.length, 61);
assert.equal(new Set(names).size, names.length);
assert.deepEqual(builtinToolUiDefinitions().map((tool) => tool.name), names);
for (const removed of ["get_page_context", "click", "type_text", "navigate", "chrome_api", "wait", "send_wecom_message", "browser_clipboard", "fs_mkdir", "fs_move", "fs_delete", "fs_restore", "fs_purge", "fs_empty_trash"]) {
  assert.equal(builtinToolDefinition(removed), null, `${removed} must not remain registered or aliased`);
  assert.equal(isRemovedBuiltinToolName(removed), true, `${removed} must remain reserved after removal`);
}

assert.equal(definitions.length, 61, "the reviewed canonical built-in Tool set count changed; update this assertion intentionally");
assert.ok(definitions.find((tool) => tool.name === "document_create").inputSchema.properties.expectedHash);
assert.doesNotMatch(definitions.find((tool) => tool.name === "document_read").inputSchema.properties.locator.description, /pdf_page/);
for (const definition of definitions) {
  assert.ok(definition.inputSchema && definition.inputSchema.type === "object", `${definition.name} must have an object input Schema`);
  assert.ok(Array.isArray(definition.effects) && definition.effects.length > 0, `${definition.name} must declare effects`);
  assert.ok(definition.resourceKind, `${definition.name} must declare a resource kind`);
  assert.ok(definition.bundle, `${definition.name} must declare a bundle`);
}

for (const name of ["browser_tab_groups", "browser_sessions", "browser_downloads", "browser_bookmarks", "browser_history", "browser_clipboard_read", "browser_clipboard_write", "browser_notification"]) {
  const definition = builtinToolDefinition(name);
  assert.ok(definition, `${name} must be registered`);
  assert.equal(definition.defaultEnabled, false, `${name} must be disabled by default`);
  assert.ok(definition.optionalPermissions.length > 0, `${name} must use optional permissions`);
}

assert.deepEqual(builtinToolDefinition("browser_clipboard_read").optionalPermissions, ["clipboardRead"]);
assert.deepEqual(builtinToolDefinition("browser_clipboard_write").optionalPermissions, ["clipboardWrite"]);
assert.deepEqual(builtinToolInputSchema("qiyewechat_notification").required, ["content"]);
assert.equal(Object.hasOwn(builtinToolInputSchema("qiyewechat_notification").properties, "payload"), false);

for (const tool of definitions) {
  assert.equal(tool.builtin, true, `${tool.name} must be marked built-in`);
  assert.equal(tool.inputSchema?.type, "object", `${tool.name} must define an object input schema`);
  assert.equal(
    tool.inputSchema?.additionalProperties === false || tool.inputSchema?.additionalProperties === true,
    true,
    `${tool.name} must declare additionalProperties`
  );
  assert.equal(tool.example?.tool?.name, tool.name, `${tool.name} must provide a canonical example`);
  assert.ok(builtinToolExecutionMetadata(tool.name, tool.example.tool.args), `${tool.name} must provide execution metadata`);
}

assert.deepEqual(builtinToolInputSchema("fs_read")?.required, ["path"]);
assert.equal(builtinToolExecutionMetadata("fs_read", { path: "/workspace/a" }).parallelSafe, true);
assert.equal(builtinToolExecutionMetadata("fs_write", { path: "/workspace/a" }).idempotency, "retry_safe");
assert.equal(builtinToolExecutionMetadata("http_request", { url: "https://example.com/a", method: "GET" }).effects[0], "read");
assert.equal(builtinToolExecutionMetadata("http_request", { url: "https://example.com/a", method: "POST" }).risk, "external");
assert.equal(builtinToolExecutionMetadata("browser_tabs", { action: "list" }).parallelSafe, true);
assert.equal(builtinToolExecutionMetadata("browser_tabs", { action: "close", tabId: 12 }).idempotency, "unknown");
assert.equal(builtinToolExecutionMetadata("page_storage", { action: "get" }).parallelSafe, true);
assert.equal(builtinToolExecutionMetadata("page_storage", { action: "set" }).parallelSafe, false);

console.log("Tool registry tests passed.");
