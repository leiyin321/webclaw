export function createAgentBudgets(options = {}) {
  const limits = {
    modelSteps: positiveInteger(options.maxModelSteps, 8),
    toolCalls: nonNegativeInteger(options.maxToolCalls, 0),
    elapsedMs: nonNegativeInteger(options.maxElapsedMs, 0)
  };
  const used = {
    modelSteps: nonNegativeInteger(options.used?.modelSteps, 0),
    toolCalls: nonNegativeInteger(options.used?.toolCalls, 0)
  };
  const startedAt = Number(options.startedAt || Date.now());

  return {
    consume(kind, amount = 1) {
      if (!Object.hasOwn(used, kind)) throw new Error(`Unknown Agent budget: ${kind}`);
      used[kind] += Math.max(0, Number(amount || 0));
      return this.check();
    },
    check() {
      const elapsedMs = Date.now() - startedAt;
      if (used.modelSteps > limits.modelSteps) return exhausted("model_steps", used, limits, elapsedMs);
      if (limits.toolCalls > 0 && used.toolCalls > limits.toolCalls) return exhausted("tool_calls", used, limits, elapsedMs);
      if (limits.elapsedMs > 0 && elapsedMs > limits.elapsedMs) return exhausted("elapsed_time", used, limits, elapsedMs);
      return { exhausted: false, used: { ...used }, limits: { ...limits }, elapsedMs };
    },
    snapshot() { return { ...this.check(), startedAt }; }
  };
}

function exhausted(reason, used, limits, elapsedMs) {
  return { exhausted: true, reason, used: { ...used }, limits: { ...limits }, elapsedMs };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}
