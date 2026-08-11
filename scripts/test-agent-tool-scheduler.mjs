import assert from "node:assert/strict";
import {
  createAgentToolScheduler,
  inferToolExecutionMetadata,
  scheduleExecutionWaves
} from "../src/agent-tool-scheduler.js";

const readA = { call: { callId: "a" }, metadata: inferToolExecutionMetadata("fs_read", { path: "/workspace/a" }) };
const readB = { call: { callId: "b" }, metadata: inferToolExecutionMetadata("fs_read", { path: "/workspace/b" }) };
const writeA = { call: { callId: "c" }, metadata: inferToolExecutionMetadata("fs_write", { path: "/workspace/a" }) };
assert.deepEqual(scheduleExecutionWaves([readA, readB]).map((wave) => wave.length), [2]);
assert.deepEqual(scheduleExecutionWaves([readA, writeA]).map((wave) => wave.length), [1, 1]);
assert.deepEqual(scheduleExecutionWaves([readA, writeA, readB]).map((wave) => wave.length), [1, 1, 1]);
assert.equal(inferToolExecutionMetadata("fs_shell", { command: "rm a" }).idempotency, "unknown");
assert.equal(inferToolExecutionMetadata("task_push", { instruction: "send" }).idempotency, "unknown");

let active = 0;
let peak = 0;
let executions = 0;
const scheduler = createAgentToolScheduler({
  execute: async (call) => {
    executions += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true, callId: call.callId };
  }
});
const calls = [
  { callId: "read-1", name: "fs_read", args: { path: "/workspace/a" } },
  { callId: "read-2", name: "fs_read", args: { path: "/workspace/b" } }
];
const first = await scheduler.executeBatch(calls, { runId: "run-1" });
assert.equal(peak, 2);
assert.equal(first.results.length, 2);
assert.equal(first.results[0].observation.ok, true);

const second = await scheduler.executeBatch(calls, { runId: "run-1" });
assert.equal(executions, 2);
assert.equal(second.results[0].deduplicated, true);

const failedScheduler = createAgentToolScheduler({
  execute: async () => { throw new Error("bad args"); }
});
const failed = await failedScheduler.executeBatch([
  { callId: "bad", name: "unknown", args: {} }
], { runId: "run-2" });
assert.equal(failed.results[0].observation.ok, false);
assert.match(failed.results[0].result.error, /bad args/);

const startedOperations = new Map();
const uncertainScheduler = createAgentToolScheduler({
  execute: async () => ({ ok: true }),
  operationStore: {
    async get(key) { return startedOperations.get(key) || null; },
    async start(key, value) { startedOperations.set(key, { status: "started", value }); },
    async complete(key, value) { startedOperations.set(key, { status: "completed", value }); }
  }
});
const uncertainCall = { callId: "notify", name: "qiyewechat_notification", args: { content: "x" } };
await uncertainScheduler.executeBatch([uncertainCall], { runId: "run-3" });
startedOperations.set("run-3:notify:qiyewechat_notification", {
  status: "started",
  value: { metadata: inferToolExecutionMetadata("qiyewechat_notification", uncertainCall.args) }
});
const uncertain = await uncertainScheduler.executeBatch([uncertainCall], { runId: "run-3" });
assert.equal(uncertain.results[0].result.errorType, "operation_state_unknown");

let invalidExecuted = false;
const validatingScheduler = createAgentToolScheduler({
  validate: (call) => {
    if (!call.args.path) throw new Error("path is required");
  },
  execute: async () => {
    invalidExecuted = true;
    return { ok: true };
  }
});
const invalid = await validatingScheduler.executeBatch([
  { callId: "invalid", name: "fs_read", args: {} }
], { runId: "run-4" });
assert.equal(invalid.results[0].result.errorType, "tool_argument_validation_error");
assert.equal(invalidExecuted, false);

const timedOperations = new Map();
let timeoutAborted = false;
const timeoutScheduler = createAgentToolScheduler({
  resolveMetadata: () => ({
    effects: ["external_write"],
    resources: [{ key: "external:test", mode: "write" }],
    idempotency: "unknown",
    timeoutMs: 5
  }),
  operationStore: {
    async get(key) { return timedOperations.get(key) || null; },
    async start(key, value) { timedOperations.set(key, { status: "started", value }); },
    async complete(key, value) { timedOperations.set(key, { status: "completed", value }); }
  },
  execute: async (_call, context) => new Promise((_resolve, reject) => {
    context.signal.addEventListener("abort", () => {
      timeoutAborted = true;
      reject(context.signal.reason);
    }, { once: true });
  })
});
const timed = await timeoutScheduler.executeBatch([
  { callId: "timeout", name: "external_send", args: {} }
], { runId: "run-timeout" });
assert.equal(timed.results[0].result.errorType, "tool_timeout");
assert.equal(timed.results[0].result.effectState, "unknown");
assert.equal(timeoutAborted, true);
assert.equal(timedOperations.get("run-timeout:timeout:external_send").status, "started");

const stoppedController = new AbortController();
stoppedController.abort(new Error("Stopped"));
let stoppedExecutions = 0;
const stoppedOperations = new Map();
const stoppedScheduler = createAgentToolScheduler({
  execute: async () => {
    stoppedExecutions += 1;
    return { ok: true };
  },
  operationStore: {
    async get(key) { return stoppedOperations.get(key) || null; },
    async start(key, value) { stoppedOperations.set(key, { status: "started", value }); },
    async complete(key, value) { stoppedOperations.set(key, { status: "completed", value }); }
  }
});
await assert.rejects(
  () => stoppedScheduler.executeBatch([
    { callId: "stopped", name: "fs_read", args: { path: "/workspace/a" } }
  ], { runId: "run-stopped", signal: stoppedController.signal }),
  /Stopped/
);
assert.equal(stoppedExecutions, 0);
assert.equal(stoppedOperations.size, 0);

console.log("Agent ToolScheduler tests passed.");
