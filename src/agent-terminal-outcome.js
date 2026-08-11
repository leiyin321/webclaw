export function resolveAgentTerminalOutcome(loopResult, steps = []) {
  const status = String(loopResult?.status || "step_limit");
  if (status === "completed") {
    return terminalOutcome("completed", String(loopResult.final || ""), loopResult.metadata || {});
  }
  if (status === "protocol_error") {
    const message = String(loopResult.protocolError?.message || "The model response did not match the required protocol.");
    const raw = truncateText(loopResult.protocolError?.raw, 6000);
    return terminalOutcome("failed", raw ? `${message}\n\nOriginal output:\n\n${raw}` : message, {
      reason: "protocol_error"
    });
  }
  if (status === "empty_response") {
    return terminalOutcome(
      "failed",
      "The model returned an empty response after the recovery retry limit was reached.",
      { reason: "empty_response" }
    );
  }
  if (status === "model_error") {
    const type = String(loopResult.error?.type || "unknown");
    const message = String(loopResult.error?.message || "Unknown model error");
    return terminalOutcome("failed", `Model request failed (${type}): ${message}`, {
      reason: "model_error",
      errorType: type
    });
  }
  if (status === "budget_exhausted") {
    const reason = String(loopResult.budget?.reason || "unknown");
    return terminalOutcome("failed", `Agent budget exhausted: ${reason}.`, {
      reason: "budget_exhausted",
      budgetReason: reason
    });
  }
  if (status === "stuck") {
    return terminalOutcome(
      "stuck",
      "Agent stopped because the same Tool Call and observation repeated without progress.",
      { reason: String(loopResult.progress?.reason || "no_progress") }
    );
  }
  return terminalOutcome("failed", maximumStepLimitMessage(steps), { reason: status || "step_limit" });
}

function terminalOutcome(status, final, metadata) {
  const completed = status === "completed";
  return {
    status,
    final,
    metadata,
    eventType: completed ? "turn_completed" : "turn_failed",
    runStatus: completed ? "completed" : "failed",
    taskStatus: completed ? "completed" : "failed"
  };
}

function maximumStepLimitMessage(steps) {
  const lastFailedTool = [...(Array.isArray(steps) ? steps : [])]
    .reverse()
    .find((step) => step?.type === "tool" && step?.result?.ok === false);
  if (lastFailedTool) {
    return `Reached the maximum number of agent steps before finishing. Last tool error (${lastFailedTool.tool}): ${lastFailedTool.result.error || "unknown error"}`;
  }
  return "Reached the maximum number of agent steps before finishing.";
}

function truncateText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength
    ? text
    : `${text.slice(0, maxLength)}\n\n... truncated ${text.length - maxLength} chars`;
}
