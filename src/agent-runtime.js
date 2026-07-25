export const CONTEXT_SUMMARY_PREFIX = "WEBCLAW_CONTEXT_SUMMARY ";

const PLAN_STATUSES = new Set(["pending", "in_progress", "completed"]);

export function createAgentId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function estimateTextTokens(value) {
  const text = String(value || "");
  let ascii = 0;
  let nonAscii = 0;
  for (const character of text) {
    if (character.codePointAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.max(1, Math.ceil(ascii / 4 + nonAscii / 1.5));
}

export function estimateMessagesTokens(messages) {
  return (Array.isArray(messages) ? messages : []).reduce((total, message) => {
    const mediaCost = Array.isArray(message?.media) ? message.media.length * 256 : 0;
    return total + 8 + estimateTextTokens(message?.content) + mediaCost;
  }, 0);
}

export function planHistoryCompaction(messages, tokenBudget, options = {}) {
  const normalized = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && typeof message === "object" && String(message.content || "").trim());
  const estimatedTokens = estimateMessagesTokens(normalized);
  const budget = Math.max(1000, Number(tokenBudget || 0));
  if (estimatedTokens <= budget || normalized.length < 10) return null;

  const retainCount = Math.max(6, Math.min(20, Number(options.retainCount || 12)));
  const splitAt = Math.max(1, normalized.length - retainCount);
  const compacted = normalized.slice(0, splitAt);
  const retained = normalized.slice(splitAt);
  if (compacted.length < 4) return null;

  return {
    estimatedTokens,
    tokenBudget: budget,
    compacted,
    retained,
    compactedMessageIds: compacted.map((message) => String(message.id || "")).filter(Boolean)
  };
}

export function buildCompactionSource(messages, maxChars = 60_000) {
  const source = (Array.isArray(messages) ? messages : [])
    .map((message) => {
      const role = message.role === "assistant" ? "ASSISTANT" : "USER";
      return `${role}:\n${String(message.content || "").slice(0, 6000)}`;
    })
    .join("\n\n");
  const limit = Math.max(500, Number(maxChars || 0));
  if (source.length <= limit) return source;
  const marker = (omitted) => `\n\n[${omitted} characters omitted from the middle]\n\n`;
  let markerText = marker(source.length);
  const retainedChars = Math.max(200, limit - markerText.length);
  const headChars = Math.max(100, Math.floor(retainedChars * 0.25));
  const tailChars = retainedChars - headChars;
  markerText = marker(Math.max(0, source.length - headChars - tailChars));
  return `${source.slice(0, headChars)}${markerText}${source.slice(-tailChars)}`.slice(0, limit);
}

export function normalizeAgentPlan(value) {
  const source = value && typeof value === "object" ? value : {};
  const rawSteps = Array.isArray(source.plan) ? source.plan : Array.isArray(source.steps) ? source.steps : [];
  const plan = rawSteps.slice(0, 20).map((item, index) => {
    if (typeof item === "string") {
      return {
        step: item.trim().slice(0, 500) || `Step ${index + 1}`,
        status: "pending"
      };
    }
    const step = String(item?.step || item?.text || "").trim().slice(0, 500);
    const status = String(item?.status || "pending");
    if (!step) throw new Error(`plan[${index}].step is required.`);
    if (!PLAN_STATUSES.has(status)) {
      throw new Error(`plan[${index}].status must be pending, in_progress, or completed.`);
    }
    return { step, status };
  });
  if (plan.length === 0) throw new Error("plan must contain at least one step.");
  if (plan.filter((item) => item.status === "in_progress").length > 1) {
    throw new Error("At most one plan step can be in_progress.");
  }
  return {
    explanation: String(source.explanation || "").trim().slice(0, 1000),
    plan
  };
}

export function inferToolInputSchema(exampleArgs, requiredNames = Object.keys(exampleArgs || {})) {
  const args = exampleArgs && typeof exampleArgs === "object" && !Array.isArray(exampleArgs)
    ? exampleArgs
    : {};
  const properties = Object.fromEntries(
    Object.entries(args).map(([name, value]) => [name, inferValueSchema(value)])
  );
  return {
    type: "object",
    properties,
    required: (Array.isArray(requiredNames) ? requiredNames : [])
      .map(String)
      .filter((name) => Object.hasOwn(properties, name)),
    additionalProperties: true
  };
}

function inferValueSchema(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? inferValueSchema(value[0]) : {}
    };
  }
  if (value === null) return {};
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "object") {
    const properties = Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, inferValueSchema(item)])
    );
    return {
      type: "object",
      properties,
      required: Object.keys(properties),
      additionalProperties: true
    };
  }
  return { type: "string" };
}
