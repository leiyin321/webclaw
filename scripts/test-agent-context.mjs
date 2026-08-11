import assert from "node:assert/strict";
import { compactAgentContext, normalizeStructuredCompaction } from "../src/agent-context-compactor.js";
import { projectAgentContext } from "../src/agent-context-projector.js";

const messages = Array.from({ length: 20 }, (_, index) => ({
  id: `m-${index}`,
  role: index % 2 ? "assistant" : "user",
  content: `${index} ${"history ".repeat(220)}`
}));
const compacted = await compactAgentContext({
  messages,
  tokenBudget: 2500,
  sourceLimit: 10000,
  createSummaryId: () => "summary-1",
  summarize: async () => JSON.stringify({
    goal: "Finish the task",
    facts: ["Tool fs_read succeeded"],
    unfinished: ["Verify output"]
  })
});
assert.equal(compacted.contextCompaction.version, 2);
assert.equal(compacted.messages[0].id, "summary-1");
assert.match(compacted.messages[0].content, /Goal: Finish the task/);

const normalized = normalizeStructuredCompaction("plain summary");
assert.equal(normalized.summary, "plain summary");

const projection = projectAgentContext({
  systemPrompt: "Core policy",
  workingDirectory: "/workspace/demo",
  workspaceBootstrap: "Workspace notes",
  messages: compacted.messages,
  tokenBudget: 5000
});
assert.equal(projection.messages[0].role, "system");
assert.equal(projection.messages.filter((message) => message.role === "system").length, 1);
assert.match(projection.messages[0].content, /\/workspace\/demo/);
assert.match(projection.revision, /^ctx-/);

console.log("Agent context tests passed.");
