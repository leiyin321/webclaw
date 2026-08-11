import {
  CONTEXT_SUMMARY_PREFIX,
  buildCompactionSource,
  planHistoryCompaction
} from "./agent-runtime.js";

const COMPACTION_INSTRUCTION = `Compact browser Agent history into one strict JSON object. Preserve the active user goal, constraints, decisions, verified Tool observations, exact identifiers and VFS paths, relevant errors, and unfinished work. Exclude credentials, tokens, cookies, secrets, redundant prose, and superseded guesses. Do not call tools.

Return this shape:
{"goal":"","constraints":[],"decisions":[],"facts":[],"toolObservations":[],"errors":[],"unfinished":[],"summary":""}`;

export async function compactAgentContext(options) {
  const messages = Array.isArray(options?.messages) ? options.messages : [];
  const plan = planHistoryCompaction(messages, options.tokenBudget, options.planOptions);
  if (!plan) return { messages, contextCompaction: null };
  options.onCompacting?.(plan);

  const source = buildCompactionSource(plan.compacted, options.sourceLimit);
  let structured;
  let method = "model";
  try {
    const response = await options.summarize([
      { role: "system", content: COMPACTION_INSTRUCTION },
      { role: "user", content: source }
    ]);
    structured = normalizeStructuredCompaction(response);
  } catch (error) {
    if (options.isInterrupted?.(error)) throw error;
    method = "extractive";
    options.onFallback?.(error);
    structured = extractiveCompaction(source);
  }

  const rendered = renderStructuredCompaction(structured);
  const contextCompaction = {
    version: 2,
    method,
    structured,
    summary: rendered,
    compactedMessageIds: plan.compactedMessageIds,
    compactedCount: plan.compacted.length,
    estimatedTokens: plan.estimatedTokens,
    tokenBudget: plan.tokenBudget
  };
  return {
    messages: [
      {
        id: options.createSummaryId?.() || `summary-${Date.now()}`,
        role: "user",
        content: `${CONTEXT_SUMMARY_PREFIX}${rendered}`
      },
      ...plan.retained
    ],
    contextCompaction
  };
}

export function normalizeStructuredCompaction(value) {
  const text = typeof value === "string" ? value.trim() : "";
  let parsed = value && typeof value === "object" ? value : null;
  if (!parsed && text) {
    const unwrapped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
      parsed = JSON.parse(unwrapped);
      if (parsed?.final && typeof parsed.final === "object") parsed = parsed.final;
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return structuredCompactionDefaults({ summary: text || "Earlier conversation was compacted." });
  }
  return structuredCompactionDefaults(parsed);
}

export function renderStructuredCompaction(value) {
  const compacted = structuredCompactionDefaults(value);
  const sections = [
    compacted.goal ? `Goal: ${compacted.goal}` : "",
    renderList("Constraints", compacted.constraints),
    renderList("Decisions", compacted.decisions),
    renderList("Verified facts", compacted.facts),
    renderList("Tool observations", compacted.toolObservations),
    renderList("Relevant errors", compacted.errors),
    renderList("Unfinished work", compacted.unfinished),
    compacted.summary ? `Summary: ${compacted.summary}` : ""
  ].filter(Boolean);
  return sections.join("\n");
}

function extractiveCompaction(source) {
  const text = String(source || "");
  const bounded = text.length <= 12000
    ? text
    : `${text.slice(0, 4000)}\n\n[earlier details compacted]\n\n${text.slice(-8000)}`;
  return structuredCompactionDefaults({ summary: bounded });
}

function structuredCompactionDefaults(value = {}) {
  return {
    goal: boundedString(value.goal, 2000),
    constraints: boundedList(value.constraints),
    decisions: boundedList(value.decisions),
    facts: boundedList(value.facts),
    toolObservations: boundedList(value.toolObservations),
    errors: boundedList(value.errors),
    unfinished: boundedList(value.unfinished),
    summary: boundedString(value.summary, 8000)
  };
}

function boundedList(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => boundedString(entry, 1200))
    .filter(Boolean)
    .slice(0, 30);
}

function boundedString(value, limit) {
  const text = typeof value === "string" ? value.trim() : value == null ? "" : JSON.stringify(value);
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

function renderList(title, values) {
  return values.length ? `${title}:\n${values.map((value) => `- ${value}`).join("\n")}` : "";
}
