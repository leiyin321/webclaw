import assert from "node:assert/strict";
import { createAgentBudgets } from "../src/agent-budgets.js";
import { classifyAgentError } from "../src/agent-errors.js";
import { createAgentProgressTracker } from "../src/agent-progress.js";

const budgets = createAgentBudgets({ maxModelSteps: 2, maxToolCalls: 2 });
assert.equal(budgets.consume("modelSteps").exhausted, false);
assert.equal(budgets.consume("toolCalls", 2).exhausted, false);
assert.equal(budgets.consume("modelSteps").exhausted, false);
assert.equal(budgets.consume("modelSteps").reason, "model_steps");

const restoredBudgets = createAgentBudgets({
  maxModelSteps: 2,
  used: { modelSteps: 2, toolCalls: 1 },
  startedAt: Date.now() - 100
});
assert.equal(restoredBudgets.snapshot().used.modelSteps, 2);
assert.equal(restoredBudgets.consume("modelSteps").reason, "model_steps");

assert.equal(classifyAgentError(new Error("fetch failed")).type, "transient");
assert.equal(classifyAgentError(Object.assign(new Error("denied"), { status: 403 })).type, "authentication");
assert.equal(classifyAgentError(new Error("The input is too large")).type, "context_length");

const tracker = createAgentProgressTracker({ nudgeAt: 2, stopAt: 3 });
const calls = [{ name: "fs_read", args: { path: "/same" } }];
const results = [{ observation: { ok: true }, result: { result: { content: "same" } } }];
assert.equal(tracker.recordToolBatch(calls, results).action, "continue");
assert.equal(tracker.recordToolBatch(calls, results).action, "nudge");
assert.equal(tracker.recordToolBatch(calls, results).action, "stop");

const restoredTracker = createAgentProgressTracker({
  nudgeAt: 2,
  stopAt: 3,
  previousSignature: tracker.snapshot().previousSignature,
  repeated: 2
});
assert.equal(restoredTracker.recordToolBatch(calls, results).action, "stop");

console.log("Agent control tests passed.");
