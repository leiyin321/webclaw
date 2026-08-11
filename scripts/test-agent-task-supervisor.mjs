import assert from "node:assert/strict";
import { createAgentTaskSupervisor } from "../src/agent-task-supervisor.js";
import { createTaskRun, normalizeTaskSpec } from "../src/task-stack.js";

const run = createTaskRun({ title: "Root", maxSteps: 8, maxDepth: 2 });
const transitions = [];
let persists = 0;
const supervisor = createAgentTaskSupervisor(run, {
  persist: async () => { persists += 1; },
  onTransition: (event) => transitions.push(event)
});
const child = await supervisor.push(run.rootTaskId, normalizeTaskSpec({
  instruction: "Inspect file",
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"]
  }
}));
await supervisor.recordModelStep(child.id);
assert.equal(supervisor.snapshot().stack.length, 2);
await supervisor.complete(child.id, { ok: true });
assert.equal(supervisor.snapshot().stack.length, 1);
await supervisor.completeRoot("completed");
assert.equal(run.status, "completed");
assert.equal(persists, 4);
assert.deepEqual(transitions.map((event) => event.type), [
  "task_pushed",
  "task_model_step",
  "task_completed",
  "task_root_completed"
]);

const budgetedRun = createTaskRun({ title: "Budgeted", maxModelSteps: 1 });
const budgetedSupervisor = createAgentTaskSupervisor(budgetedRun);
await budgetedSupervisor.recordModelStep(budgetedRun.rootTaskId);
await assert.rejects(
  budgetedSupervisor.recordModelStep(budgetedRun.rootTaskId),
  /model-step budget reached/
);
await budgetedSupervisor.recordModelStep(budgetedRun.rootTaskId, {
  allowReservedContinuation: true
});
assert.equal(budgetedRun.budget.usedModelSteps, 2);

console.log("Agent TaskSupervisor tests passed.");
