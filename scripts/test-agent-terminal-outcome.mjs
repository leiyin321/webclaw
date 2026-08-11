import assert from "node:assert/strict";
import { resolveAgentTerminalOutcome } from "../src/agent-terminal-outcome.js";

const completed = resolveAgentTerminalOutcome({ status: "completed", final: "done", metadata: { taskOutput: 1 } });
assert.equal(completed.status, "completed");
assert.equal(completed.eventType, "turn_completed");
assert.equal(completed.runStatus, "completed");
assert.equal(completed.metadata.taskOutput, 1);

for (const loopResult of [
  { status: "protocol_error", protocolError: { message: "bad protocol", raw: "raw" } },
  { status: "empty_response" },
  { status: "model_error", error: { type: "rate_limit", message: "limited" } },
  { status: "budget_exhausted", budget: { reason: "tool_calls" } },
  { status: "step_limit" }
]) {
  const outcome = resolveAgentTerminalOutcome(loopResult);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.eventType, "turn_failed");
  assert.equal(outcome.runStatus, "failed");
  assert.equal(outcome.taskStatus, "failed");
  assert.ok(outcome.final);
}

const stuck = resolveAgentTerminalOutcome({ status: "stuck", progress: { reason: "repeat" } });
assert.equal(stuck.status, "stuck");
assert.equal(stuck.eventType, "turn_failed");
assert.equal(stuck.runStatus, "failed");

const limited = resolveAgentTerminalOutcome({ status: "step_limit" }, [
  { type: "tool", tool: "fs_read", result: { ok: false, error: "missing" } }
]);
assert.match(limited.final, /fs_read/);
assert.match(limited.final, /missing/);

console.log("Agent terminal outcome tests passed.");
