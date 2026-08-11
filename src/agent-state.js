const TRANSITIONS = Object.freeze({
  initialized: ["sampling_model", "executing_tools", "failed", "interrupted"],
  sampling_model: ["normalizing_response", "recovering", "failed", "interrupted"],
  normalizing_response: ["validating_actions", "recovering", "failed", "interrupted"],
  validating_actions: ["executing_tools", "completed", "recovering", "failed", "interrupted"],
  executing_tools: ["recording_observations", "failed", "interrupted"],
  recording_observations: ["evaluating_progress", "failed", "interrupted"],
  evaluating_progress: ["sampling_model", "completed", "stuck", "failed", "interrupted"],
  recovering: ["sampling_model", "failed", "interrupted"],
  completed: [],
  stuck: [],
  failed: [],
  interrupted: []
});

export function createAgentStateMachine(options = {}) {
  let state = String(options.initialState || "initialized");
  if (!Object.hasOwn(TRANSITIONS, state)) throw new Error(`Unknown Agent state: ${state}`);
  let revision = 0;
  return {
    current() { return state; },
    transition(nextState, data = {}) {
      const next = String(nextState || "");
      if (!TRANSITIONS[state].includes(next)) {
        throw new Error(`Invalid Agent state transition: ${state} -> ${next || "unknown"}`);
      }
      const previous = state;
      state = next;
      revision += 1;
      return { previous, state, revision, timestamp: Date.now(), ...data };
    },
    snapshot() { return { state, revision }; }
  };
}

export function isTerminalAgentState(state) {
  return ["completed", "stuck", "failed", "interrupted"].includes(String(state || ""));
}
