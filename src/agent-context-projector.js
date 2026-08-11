import { estimateMessagesTokens } from "./agent-runtime.js";

export function projectAgentContext(options = {}) {
  const instructions = [
    String(options.systemPrompt || "").trim(),
    options.workingDirectory
      ? `Current virtual filesystem working directory: ${options.workingDirectory}`
      : "",
    String(options.workspaceBootstrap || "").trim()
  ].filter(Boolean).join("\n\n");
  if (!instructions) throw new Error("Agent context requires system instructions.");

  const history = (Array.isArray(options.messages) ? options.messages : [])
    .filter((message) => message && String(message.content || "").trim())
    .map((message) => ({
      ...message,
      role: message.role === "assistant" ? "assistant" : "user"
    }));
  const messages = [{ role: "system", content: instructions }, ...history];
  const estimatedTokens = estimateMessagesTokens(messages);
  return {
    messages,
    revision: contextRevision(messages),
    stats: {
      messageCount: messages.length,
      estimatedTokens,
      tokenBudget: Number(options.tokenBudget || 0),
      overBudget: Number(options.tokenBudget || 0) > 0 && estimatedTokens > Number(options.tokenBudget)
    }
  };
}

function contextRevision(messages) {
  let hash = 2166136261;
  const text = messages.map((message) => `${message.role}\n${message.content}`).join("\n\n");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ctx-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
