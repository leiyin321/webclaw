import assert from "node:assert/strict";
import {
  createAssistantTurn,
  createProtocolErrorTurn,
  createToolCallTurn
} from "../src/agent-model-turn.js";
import { runAgentLoop } from "../src/agent-runner.js";
import { createAgentRecoveryPolicy } from "../src/agent-recovery-policy.js";

const completed = await runAgentLoop({
  maxSteps: 3,
  messages: [{ role: "user", content: "hello" }],
  sampleModel: async () => createAssistantTurn("hi"),
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(completed.status, "completed");
assert.equal(completed.final, "hi");

const toolMessages = [{ role: "user", content: "list" }];
let samples = 0;
const toolThenFinal = await runAgentLoop({
  maxSteps: 3,
  messages: toolMessages,
  sampleModel: async () => {
    samples += 1;
    if (samples === 1) {
      return createToolCallTurn([
        { callId: "call-1", name: "fs_shell", args: { command: "ls" } }
      ]);
    }
    return createAssistantTurn("finished");
  },
  executeTool: async ({ toolCall }) => ({
    messages: [
      { role: "assistant", content: JSON.stringify(toolCall) },
      { role: "user", content: "TOOL_RESULT ok" }
    ]
  }),
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(toolThenFinal.status, "completed");
assert.equal(toolThenFinal.final, "finished");
assert.equal(toolMessages.length, 3);

const recoveredMessages = [{ role: "user", content: "continue" }];
let recoveredToolExecutions = 0;
let recoveredModelSawToolResult = false;
const recoveredTool = await runAgentLoop({
  runId: "recovered-run",
  maxSteps: 2,
  messages: recoveredMessages,
  pendingToolCalls: [{ callId: "recovered-call", name: "fs_read", args: { path: "/workspace/a" } }],
  pendingToolStep: 0,
  executeTool: async () => {
    recoveredToolExecutions += 1;
    return { ok: true, content: "file contents" };
  },
  sampleModel: async ({ messages }) => {
    recoveredModelSawToolResult = messages.some((message) => String(message.content || "").includes("file contents"));
    return createAssistantTurn("recovered tool finished");
  },
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(recoveredTool.status, "completed");
assert.equal(recoveredToolExecutions, 1);
assert.equal(recoveredModelSawToolResult, true);

let completedRecoveryExecutions = 0;
let completedRecoverySawResult = false;
const completedOperationKey = "completed-recovery:completed-call:fs_read";
const completedOperation = {
  status: "completed",
  value: {
    call: { callId: "completed-call", name: "fs_read", args: { path: "/workspace/a" } },
    result: { ok: true, content: "persisted file contents" },
    metadata: { idempotency: "safe", effects: ["read"], resources: [] }
  }
};
await runAgentLoop({
  runId: "completed-recovery",
  maxSteps: 2,
  messages: [{ role: "user", content: "continue" }],
  pendingToolCalls: [{ callId: "completed-call", name: "fs_read", args: { path: "/workspace/a" } }],
  toolOperationStore: {
    async get(key) { return key === completedOperationKey ? completedOperation : null; },
    async start() { throw new Error("completed operation must not restart"); },
    async complete() { throw new Error("completed operation must not be rewritten"); }
  },
  executeTool: async () => {
    completedRecoveryExecutions += 1;
    return { ok: false };
  },
  sampleModel: async ({ messages }) => {
    completedRecoverySawResult = messages.some((message) => String(message.content || "").includes("persisted file contents"));
    return createAssistantTurn("deduplicated recovery finished");
  },
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(completedRecoveryExecutions, 0);
assert.equal(completedRecoverySawResult, true);

let correctionCount = 0;
const corrected = await runAgentLoop({
  maxSteps: 3,
  messages: [],
  sampleModel: async () => createAssistantTurn(correctionCount === 0 ? "invalid" : "valid"),
  handleAssistant: async ({ assistantText }) => {
    if (assistantText === "invalid") {
      correctionCount += 1;
      return {
        continue: true,
        messages: [
          { role: "assistant", content: assistantText },
          { role: "user", content: "correct the output" }
        ]
      };
    }
    return { final: assistantText, metadata: { corrected: true } };
  }
});
assert.equal(corrected.final, "valid");
assert.equal(corrected.metadata.corrected, true);

const protocol = await runAgentLoop({
  maxSteps: 2,
  messages: [],
  sampleModel: async () => createProtocolErrorTurn("bad protocol", "raw"),
  handleAssistant: async () => {
    throw new Error("must not handle protocol errors as assistant output");
  }
});
assert.equal(protocol.status, "protocol_error");
assert.equal(protocol.protocolError.message, "bad protocol");

let protocolSamples = 0;
const recoveredProtocol = await runAgentLoop({
  maxSteps: 3,
  messages: [],
  recoveryPolicy: createAgentRecoveryPolicy({ maxProtocolRetries: 1 }),
  sampleModel: async () => {
    protocolSamples += 1;
    return protocolSamples === 1
      ? createProtocolErrorTurn("bad protocol", "{broken")
      : createAssistantTurn("recovered");
  },
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(recoveredProtocol.status, "completed");
assert.equal(recoveredProtocol.final, "recovered");

const exhaustedProtocol = await runAgentLoop({
  maxSteps: 3,
  messages: [],
  recoveryPolicy: createAgentRecoveryPolicy({ maxProtocolRetries: 1 }),
  sampleModel: async () => createProtocolErrorTurn("still bad", "raw"),
  handleAssistant: async () => ({ final: "unexpected" })
});
assert.equal(exhaustedProtocol.status, "protocol_error");
assert.equal(exhaustedProtocol.recovery.reason, "protocol_retry_limit");

let emptySamples = 0;
const recoveredEmpty = await runAgentLoop({
  maxSteps: 3,
  messages: [],
  recoveryPolicy: createAgentRecoveryPolicy({ maxEmptyResponseRetries: 1 }),
  sampleModel: async () => {
    emptySamples += 1;
    return createAssistantTurn(emptySamples === 1 ? "" : "not empty");
  },
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(recoveredEmpty.final, "not empty");

const exhaustedEmpty = await runAgentLoop({
  maxSteps: 3,
  messages: [],
  recoveryPolicy: createAgentRecoveryPolicy({ maxEmptyResponseRetries: 1 }),
  sampleModel: async () => createAssistantTurn(""),
  handleAssistant: async () => ({ final: "unexpected" })
});
assert.equal(exhaustedEmpty.status, "empty_response");

let modelAttempts = 0;
const recoveredModelError = await runAgentLoop({
  maxSteps: 3,
  messages: [],
  recoveryPolicy: createAgentRecoveryPolicy({ maxModelRetries: 1 }),
  wait: async () => {},
  sampleModel: async () => {
    modelAttempts += 1;
    if (modelAttempts === 1) throw new Error("fetch failed");
    return createAssistantTurn("network recovered");
  },
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(recoveredModelError.final, "network recovered");

let executedCalls = 0;
const boundaryPhases = [];
const limited = await runAgentLoop({
  maxSteps: 2,
  messages: [],
  sampleModel: async ({ step }) => createToolCallTurn([
    { callId: `call-${step}`, name: "noop", args: {} },
    { callId: `deferred-${step}`, name: "noop", args: {} }
  ]),
  executeTool: async () => {
    executedCalls += 1;
    return { messages: [] };
  },
  onBoundary: ({ phase }) => boundaryPhases.push(phase),
  handleAssistant: async () => ({ final: "unexpected" })
});
assert.equal(limited.status, "step_limit");
assert.equal(executedCalls, 4);
assert.deepEqual(boundaryPhases, ["after_tool", "after_tool"]);

const lastStepProtocol = await runAgentLoop({
  maxSteps: 1,
  messages: [],
  recoveryPolicy: createAgentRecoveryPolicy({ maxProtocolRetries: 2 }),
  sampleModel: async () => createProtocolErrorTurn("bad at limit", "raw"),
  handleAssistant: async () => ({ final: "unexpected" })
});
assert.equal(lastStepProtocol.status, "protocol_error");
assert.equal(lastStepProtocol.protocolError.message, "bad at limit");

let resumedSamples = 0;
const resumedAtBudget = await runAgentLoop({
  maxSteps: 2,
  messages: [],
  runtimeState: {
    budgets: { used: { modelSteps: 2, toolCalls: 0 }, startedAt: Date.now() }
  },
  sampleModel: async () => {
    resumedSamples += 1;
    return createAssistantTurn("must not run");
  },
  handleAssistant: async ({ assistantText }) => ({ final: assistantText })
});
assert.equal(resumedAtBudget.status, "budget_exhausted");
assert.equal(resumedSamples, 0);

console.log("AgentRunner tests passed.");
