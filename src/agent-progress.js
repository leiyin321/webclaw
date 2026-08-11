export function createAgentProgressTracker(options = {}) {
  const nudgeAt = positiveInteger(options.nudgeAt, 2);
  const stopAt = Math.max(nudgeAt + 1, positiveInteger(options.stopAt, 4));
  let previousSignature = String(options.previousSignature || "");
  let repeated = nonNegativeInteger(options.repeated, 0);

  return {
    recordToolBatch(toolCalls, results) {
      const signature = progressSignature(toolCalls, results);
      if (signature && signature === previousSignature) repeated += 1;
      else repeated = 1;
      previousSignature = signature;
      if (repeated >= stopAt) {
        return { action: "stop", reason: "repeated_tool_observation", repeated, signature };
      }
      if (repeated === nudgeAt) {
        return {
          action: "nudge",
          repeated,
          signature,
          message: "AGENT_PROGRESS_WARNING\nThe same Tool Call and observation repeated without new progress. Reassess the plan, change arguments or use a different Tool. Do not repeat the same call unchanged."
        };
      }
      return { action: "continue", repeated, signature };
    },
    snapshot() { return { previousSignature, repeated, nudgeAt, stopAt }; }
  };
}

export function progressSignature(toolCalls, results) {
  const calls = (Array.isArray(toolCalls) ? toolCalls : []).map((call) => ({
    name: String(call?.name || ""),
    args: stableValue(call?.args)
  }));
  const observations = (Array.isArray(results) ? results : []).map((entry) => ({
    ok: entry?.observation?.ok !== false,
    errorType: String(entry?.observation?.errorType || ""),
    result: stableValue(entry?.result?.result ?? entry?.result)
  }));
  return stableStringify({ calls, observations });
}

function stableValue(value, depth = 0) {
  if (depth > 5) return "[depth]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (Array.isArray(value)) return value.slice(0, 30).map((entry) => stableValue(entry, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().slice(0, 50).map((key) => [key, stableValue(value[key], depth + 1)]));
  }
  return String(value);
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : fallback;
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}
