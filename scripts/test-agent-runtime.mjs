import assert from "node:assert/strict";
import {
  buildCompactionSource,
  estimateMessagesTokens,
  inferToolInputSchema,
  normalizeAgentPlan,
  planHistoryCompaction
} from "../src/agent-runtime.js";
import {
  completeRootTask,
  completeTask,
  createTaskRun,
  normalizeTaskSpec,
  pushTask,
  recordTaskModelStep,
  taskStackSnapshot,
  validateTaskOutput
} from "../src/task-stack.js";

const messages = Array.from({ length: 24 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  content: `${index}: ${"context ".repeat(180)}`
}));
assert.ok(estimateMessagesTokens(messages) > 3000);

const compaction = planHistoryCompaction(messages, 3000);
assert.ok(compaction);
assert.equal(compaction.retained.length, 12);
assert.equal(compaction.compactedMessageIds[0], "message-0");
assert.ok(buildCompactionSource(compaction.compacted, 4000).length <= 4120);

const plan = normalizeAgentPlan({
  explanation: "Implement and verify",
  plan: [
    { step: "Inspect", status: "completed" },
    { step: "Implement", status: "in_progress" },
    { step: "Verify", status: "pending" }
  ]
});
assert.equal(plan.plan.length, 3);
assert.throws(
  () => normalizeAgentPlan({
    plan: [
      { step: "One", status: "in_progress" },
      { step: "Two", status: "in_progress" }
    ]
  }),
  /At most one/
);

const weatherSchema = inferToolInputSchema(
  { location: "Shanghai", language: "zh" },
  ["location"]
);
assert.deepEqual(weatherSchema.required, ["location"]);
assert.equal(weatherSchema.properties.language.type, "string");

const taskSpec = normalizeTaskSpec({
  title: "Verify files",
  instruction: "Inspect the generated files.",
  context: { paths: ["/workspace/index.html"] },
  outputSchema: {
    type: "object",
    properties: {
      valid: { type: "boolean" },
      errors: { type: "array", items: { type: "string" } }
    },
    required: ["valid", "errors"],
    additionalProperties: false
  },
  maxSteps: 6
});
const taskRun = createTaskRun({
  title: "Build site",
  maxSteps: 20,
  maxDepth: 3,
  maxTasks: 6
});
const child = pushTask(taskRun, taskRun.rootTaskId, taskSpec);
assert.equal(taskStackSnapshot(taskRun).stack.length, 2);
assert.equal(taskRun.tasks[taskRun.rootTaskId].status, "waiting_child");
const grandchild = pushTask(taskRun, child.id, normalizeTaskSpec({
  instruction: "Check one file.",
  context: { path: "/workspace/index.html" },
  outputSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"],
    additionalProperties: false
  }
}));
assert.equal(taskStackSnapshot(taskRun).stack.length, 3);
completeTask(taskRun, grandchild.id);
assert.equal(taskStackSnapshot(taskRun).stack.length, 2);
recordTaskModelStep(taskRun, child.id);
assert.equal(child.step, 1);
assert.equal(validateTaskOutput({ valid: true, errors: [] }, taskSpec.outputSchema).valid, true);
const invalidTaskOutput = validateTaskOutput({ valid: "yes", unexpected: true }, taskSpec.outputSchema);
assert.equal(invalidTaskOutput.valid, false);
assert.ok(invalidTaskOutput.errors.some((error) => error.path === "$.valid"));
assert.ok(invalidTaskOutput.errors.some((error) => error.path === "$.errors"));
assert.ok(invalidTaskOutput.errors.some((error) => error.path === "$.unexpected"));
completeTask(taskRun, child.id);
assert.equal(taskStackSnapshot(taskRun).stack.length, 1);
assert.equal(taskRun.tasks[taskRun.rootTaskId].status, "running");
completeRootTask(taskRun);
assert.equal(taskStackSnapshot(taskRun).active, false);
assert.throws(
  () => normalizeTaskSpec({
    instruction: "Invalid output contract",
    outputSchema: { $ref: "#/$defs/result" }
  }),
  /not supported/
);
const boundedRun = createTaskRun({ maxDepth: 1, maxTasks: 2 });
const boundedChild = pushTask(boundedRun, boundedRun.rootTaskId, normalizeTaskSpec({
  instruction: "Only child",
  outputSchema: {
    type: "object",
    properties: { summary: { type: "string" } },
    required: ["summary"]
  }
}));
assert.throws(
  () => pushTask(boundedRun, boundedChild.id, taskSpec),
  /depth limit/
);
completeTask(boundedRun, boundedChild.id);
const secondBoundedChild = pushTask(boundedRun, boundedRun.rootTaskId, taskSpec);
completeTask(boundedRun, secondBoundedChild.id);
assert.throws(
  () => pushTask(boundedRun, boundedRun.rootTaskId, taskSpec),
  /count limit/
);

console.log("Agent runtime tests passed.");
