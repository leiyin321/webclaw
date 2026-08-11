import assert from "node:assert/strict";
import { createAgentTaskSupervisor } from "../src/agent-task-supervisor.js";
import { createTaskRun, normalizeTaskSpec } from "../src/task-stack.js";

const run = createTaskRun({ maxSteps: 8, maxDepth: 2 });
const transitions = [];
let persists = 0;
const supervisor = createAgentTaskSupervisor(run, {
  persist: async () => { persists += 1; },
  onTransition: (event) => transitions.push(event)
});
assert.equal(supervisor.snapshot().stack.length, 0);
const child = await supervisor.push("", normalizeTaskSpec({
  instruction: "Inspect file",
  outputSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"]
  }
}));
await supervisor.recordModelStep(child.id);
assert.equal(supervisor.snapshot().stack.length, 1);
await supervisor.complete(child.id, { ok: true });
assert.equal(supervisor.snapshot().stack.length, 0);
await supervisor.completeRun("completed");
assert.equal(run.status, "completed");
assert.equal(persists, 4);
assert.deepEqual(transitions.map((event) => event.type), [
  "task_pushed",
  "task_model_step",
  "task_completed",
  "task_run_completed"
]);

const budgetedRun = createTaskRun({ title: "Budgeted", maxModelSteps: 1 });
const budgetedSupervisor = createAgentTaskSupervisor(budgetedRun);
await budgetedSupervisor.recordModelStep("");
assert.equal(budgetedRun.runFrame.step, 1);
assert.equal(budgetedRun.budget.usedModelSteps, 0);
const budgetedTask = await budgetedSupervisor.push("", normalizeTaskSpec({
  instruction: "Use the explicit Task budget."
}));
await budgetedSupervisor.recordModelStep(budgetedTask.id);
await assert.rejects(
  budgetedSupervisor.recordModelStep(budgetedTask.id),
  /model-step budget reached/
);
await budgetedSupervisor.recordModelStep(budgetedTask.id, {
  allowReservedContinuation: true
});
assert.equal(budgetedRun.budget.usedModelSteps, 2);
assert.equal(budgetedTask.step, 2);

console.log("Agent TaskSupervisor tests passed.");
