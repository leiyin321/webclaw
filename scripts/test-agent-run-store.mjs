import assert from "node:assert/strict";
import {
  classifyAgentRunRecovery,
  createAgentRunJournal,
  createAgentRunStore,
  resolveAgentRunRecovery,
  sanitizeAgentRunValue
} from "../src/agent-run-store.js";
import { createFakeIndexedDB } from "./test-support/fake-indexeddb.mjs";

const store = createAgentRunStore({ indexedDB: null });
const journal = createAgentRunJournal(store, {
  runId: "run-1",
  sessionId: "session-1",
  providerId: "provider-1"
});

await journal.start();
journal.append("turn_started", { turnId: "run-1" });
journal.append("item_completed", {
  item: { type: "tool_call", result: { ok: true, token: "must-not-persist" } }
});
journal.checkpoint({
  phase: "after_tool",
  step: 1,
  messages: [{ role: "user", content: "continue" }]
});
assert.deepEqual(await journal.flush(), { ok: true });

let run = await store.getRun("run-1");
assert.equal(run.status, "waiting");
assert.equal(run.lastSequence, 2);
assert.equal(run.events[0].type, "turn_started");
assert.equal(run.events[1].payload.item.result.token, "[redacted]");
assert.equal(run.checkpoint.phase, "after_tool");
assert.equal((await store.listRecoverableRuns()).length, 0);

const competingJournal = createAgentRunJournal(store, { runId: "run-1" });
await assert.rejects(() => competingJournal.start(), /lease is already held/);
run = await store.getRun("run-1", { includeEvents: false });
assert.equal(run.sessionId, "session-1");
assert.equal(run.status, "waiting");

await store.startRun({ runId: "run-expired" });
await store.acquireLease("run-expired", "old-worker", 1);
await store.saveCheckpoint(
  "run-expired",
  { phase: "before_model", messages: [{ role: "system", content: "x" }] },
  "old-worker",
  1
);
await new Promise((resolve) => setTimeout(resolve, 5));
assert.ok((await store.listRecoverableRuns()).some((item) => item.runId === "run-expired"));
await store.acquireLease("run-expired", "new-worker");
await assert.rejects(
  () => store.appendEvent("run-expired", { type: "stale" }, "old-worker"),
  /lease was lost/
);
await assert.rejects(
  () => store.saveCheckpoint("run-expired", { phase: "after_tool" }, "old-worker"),
  /lease was lost/
);
await store.completeRun("run-expired", "failed", {}, "new-worker");

await store.startOperation("run-1:call-1:fs_write", { args: { apiKey: "hidden" } }, journal.ownerId);
let operation = await store.getOperation("run-1:call-1:fs_write");
assert.equal(operation.status, "started");
assert.equal(operation.value.args.apiKey, "[redacted]");
await store.completeOperation("run-1:call-1:fs_write", { result: { ok: true } }, journal.ownerId);
operation = await store.getOperation("run-1:call-1:fs_write");
assert.equal(operation.status, "completed");

const artifactId = await store.putArtifact({
  runId: "run-1",
  kind: "tool_result",
  value: { body: "full result" }
});
assert.equal((await store.getArtifact(artifactId)).value.body, "full result");

journal.close("completed", { final: "done" });
await journal.flush();
run = await store.getRun("run-1");
assert.equal(run.status, "completed");
assert.equal(run.summary.final, "done");
assert.equal((await store.listRecoverableRuns()).length, 0);
const completedJournal = createAgentRunJournal(store, { runId: "run-1" });
await assert.rejects(() => completedJournal.start(), /lease is already held/);
assert.equal(await store.deleteRunsForSession("session-1"), 1);
assert.equal(await store.getRun("run-1"), null);
assert.equal(await store.getArtifact(artifactId), null);

assert.deepEqual(sanitizeAgentRunValue({ apiKey: "x", nested: { cookie: "y" } }), {
  apiKey: "[redacted]",
  nested: { cookie: "[redacted]" }
});
assert.deepEqual(sanitizeAgentRunValue({
  authorizationScope: { type: "schedule", id: "schedule-1" },
  authorizationMode: "sidepanel"
}), {
  authorizationScope: { type: "schedule", id: "schedule-1" },
  authorizationMode: "sidepanel"
});
assert.match(sanitizeAgentRunValue("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"), /Bearer \[redacted\]/);
assert.doesNotMatch(sanitizeAgentRunValue("key=sk-abcdefghijklmnop"), /sk-abcdefghijklmnop/);
assert.equal(classifyAgentRunRecovery({ checkpoint: { phase: "after_tool" } }).action, "resume_model");
assert.equal(classifyAgentRunRecovery({ checkpoint: { phase: "waiting_approval" } }).action, "wait_approval");
assert.equal(classifyAgentRunRecovery({ checkpoint: { phase: "approval_decided" } }).action, "inspect_operation");
assert.equal(classifyAgentRunRecovery({ nested: true, checkpoint: { phase: "after_tool" } }).action, "manual_review");

const operationRecoveryRun = {
  runId: "recovery-run",
  checkpoint: {
    phase: "before_tool",
    toolCall: { callId: "call-1", name: "fs_read", args: { path: "/workspace/a" } }
  }
};
const safeRecovery = await resolveAgentRunRecovery(operationRecoveryRun, async () => ({
  status: "started",
  value: { metadata: { idempotency: "safe" } }
}));
assert.equal(safeRecovery.action, "resume_tool");
const unknownRecovery = await resolveAgentRunRecovery(operationRecoveryRun, async () => ({
  status: "started",
  value: { metadata: { idempotency: "unknown" } }
}));
assert.equal(unknownRecovery.action, "inspect_operation");
const completedRecovery = await resolveAgentRunRecovery(operationRecoveryRun, async () => ({
  status: "completed",
  value: { result: { ok: true } }
}));
assert.equal(completedRecovery.action, "resume_tool");

let requestedOperationKey = "";
const checkpointKeyRecovery = await resolveAgentRunRecovery({
  ...operationRecoveryRun,
  checkpoint: {
    ...operationRecoveryRun.checkpoint,
    operationKey: "recovery-run:call-1:external_send"
  }
}, async (key) => {
  requestedOperationKey = key;
  return { status: "started", value: { metadata: { idempotency: "unknown" } } };
});
assert.equal(requestedOperationKey, "recovery-run:call-1:external_send");
assert.equal(checkpointKeyRecovery.action, "inspect_operation");

const failingJournal = createAgentRunJournal({
  async claimRun() { return true; },
  async appendEvent() { throw new Error("storage unavailable"); },
  async completeRun() {}
}, { runId: "run-failing" });
await failingJournal.start();
const originalWarn = console.warn;
console.warn = () => {};
try {
  failingJournal.append("turn_started");
  await assert.rejects(() => failingJournal.flush(), /storage unavailable/);
} finally {
  console.warn = originalWarn;
}

let completeCalls = 0;
const partiallyFailingJournal = createAgentRunJournal({
  async claimRun() { return true; },
  async appendEvent() { throw new Error("event write failed"); },
  async completeRun() { completeCalls += 1; }
}, { runId: "run-partial-failure" });
await partiallyFailingJournal.start();
console.warn = () => {};
try {
  partiallyFailingJournal.append("turn_completed");
  await partiallyFailingJournal.close("completed");
  assert.equal(partiallyFailingJournal.terminalCommitted, true);
  assert.deepEqual(await partiallyFailingJournal.flush(), { ok: true });
  await partiallyFailingJournal.close("failed");
  assert.equal(completeCalls, 1);
} finally {
  console.warn = originalWarn;
}

const indexedStore = createAgentRunStore({
  indexedDB: createFakeIndexedDB(),
  databaseName: "agent-run-store-test"
});
const indexedJournal = createAgentRunJournal(indexedStore, {
  runId: "indexed-run",
  sessionId: "indexed-session"
});
await indexedJournal.start();
indexedJournal.append("turn_started", { source: "indexeddb" });
await indexedJournal.checkpoint({
  phase: "before_tool",
  messages: [{ role: "system", content: "test" }],
  toolCall: { callId: "call-1", name: "fs_read", args: { path: "/workspace/a" } }
});
await indexedStore.startOperation("indexed-run:call-1:fs_read", {
  metadata: { idempotency: "safe" }
}, indexedJournal.ownerId);
assert.equal((await indexedStore.getOperation("indexed-run:call-1:fs_read")).status, "started");
const indexedCompetingJournal = createAgentRunJournal(indexedStore, { runId: "indexed-run" });
await assert.rejects(() => indexedCompetingJournal.start(), /lease is already held/);
await indexedStore.completeOperation("indexed-run:call-1:fs_read", {
  result: { ok: true }
}, indexedJournal.ownerId);
await indexedJournal.close("completed", { final: "done" });
await indexedJournal.flush();
const indexedRun = await indexedStore.getRun("indexed-run");
assert.equal(indexedRun.status, "completed");
assert.equal(indexedRun.events.length, 1);
assert.equal(await indexedStore.deleteRunsForSession("indexed-session"), 1);
assert.equal(await indexedStore.getRun("indexed-run"), null);

console.log("Agent RunStore tests passed.");
