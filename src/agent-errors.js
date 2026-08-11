export function classifyAgentError(error, context = {}) {
  const message = String(error?.message || error || "Unknown Agent error");
  const status = Number(error?.status || error?.statusCode || context.status || 0);
  const lower = message.toLowerCase();
  if (error?.name === "AbortError" || lower === "stopped" || context.aborted) {
    return agentError("aborted", message, false);
  }
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|token.*expired|login required/.test(lower)) {
    return agentError("authentication", message, false);
  }
  if (status === 429 || /rate.?limit|too many requests|quota/.test(lower)) {
    return agentError("rate_limit", message, true);
  }
  if (/input is too large|context.*(length|window)|maximum context|too many tokens/.test(lower)) {
    return agentError("context_length", message, true);
  }
  if (status >= 500 || /fetch failed|network|disconnected|timeout|temporar/.test(lower)) {
    return agentError("transient", message, true);
  }
  if (/schema|invalid.*json|protocol|parse/.test(lower)) {
    return agentError("protocol", message, true);
  }
  return agentError(context.scope === "tool" ? "tool_execution" : "fatal", message, false);
}

function agentError(type, message, retryable) {
  return { type, message, retryable };
}
