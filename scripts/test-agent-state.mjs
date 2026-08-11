import assert from "node:assert/strict";
import { createAgentStateMachine, isTerminalAgentState } from "../src/agent-state.js";

const machine = createAgentStateMachine();
assert.equal(machine.transition("sampling_model").previous, "initialized");
machine.transition("normalizing_response");
machine.transition("validating_actions");
machine.transition("executing_tools");
machine.transition("recording_observations");
machine.transition("evaluating_progress");
machine.transition("sampling_model");
assert.throws(() => machine.transition("completed"), /Invalid Agent state transition/);
machine.transition("normalizing_response");
machine.transition("validating_actions");
machine.transition("completed");
assert.equal(isTerminalAgentState(machine.current()), true);

console.log("Agent state tests passed.");
