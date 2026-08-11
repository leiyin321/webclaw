import assert from "node:assert/strict";
import {
  createAssistantTurn,
  createProtocolErrorTurn,
  createToolCallTurn,
  modelTurnAssistantText,
  modelTurnFinalValue,
  modelTurnProtocolError,
  modelTurnToolCalls,
  normalizeAgentModelTurn
} from "../src/agent-model-turn.js";

const assistant = normalizeAgentModelTurn({
  kind: "assistant",
  text: "done",
  value: { ok: true },
  raw: "raw"
});
assert.equal(assistant.finishReason, "stop");
assert.equal(modelTurnAssistantText(assistant), "done");
assert.deepEqual(modelTurnFinalValue(assistant), { ok: true });

const tool = normalizeAgentModelTurn({
  kind: "tool_call",
  tool: { name: "fs_shell", args: { command: "ls" } },
  raw: "tool raw"
}, {
  createCallId: () => "call-generated"
});
assert.deepEqual(modelTurnToolCalls(tool), [{
  callId: "call-generated",
  name: "fs_shell",
  args: { command: "ls" }
}]);

const multiple = createToolCallTurn([
  { callId: "call-1", name: "fs_read", args: { path: "/a" } },
  { callId: "call-2", name: "fs_read", args: { path: "/b" } }
]);
assert.equal(modelTurnToolCalls(multiple).length, 2);

const normalizedMultiple = normalizeAgentModelTurn({
  kind: "tool_calls",
  tools: [
    { callId: "call-a", name: "fs_read", args: { path: "/a" } },
    { callId: "call-b", name: "fs_read", args: { path: "/b" } }
  ]
});
assert.equal(modelTurnToolCalls(normalizedMultiple).length, 2);

const protocolError = createProtocolErrorTurn("invalid JSON", "{broken");
assert.deepEqual(modelTurnProtocolError(protocolError), {
  message: "invalid JSON",
  raw: "{broken"
});

assert.equal(modelTurnAssistantText(createAssistantTurn("hello")), "hello");
assert.throws(
  () => createToolCallTurn([{ name: "fs_read", args: {} }]),
  /name and callId/
);
assert.throws(
  () => normalizeAgentModelTurn({ type: "model_turn", finishReason: "stop" }),
  /items must be an array/
);

console.log("Agent ModelTurn tests passed.");
