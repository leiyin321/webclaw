import assert from "node:assert/strict";
import {
  buildCompactionSource,
  estimateMessagesTokens,
  inferToolInputSchema,
  normalizeAgentPlan,
  planHistoryCompaction
} from "../src/agent-runtime.js";

const messages = Array.from({ length: 24 }, (_, index) => ({
  id: `message-${index}`,
  role: index % 2 === 0 ? "user" : "assistant",
  content: `${index}: ${"context ".repeat(180)}`
}));
assert.ok(estimateMessagesTokens(messages) > 3000);

const compaction = planHistoryCompaction(messages, 3000);
assert.ok(compaction);
assert.equal(compaction.retained.length, 12);
assert.equal(compaction.compactedMessageIds[0], "message-0");
assert.ok(buildCompactionSource(compaction.compacted, 4000).length <= 4120);

const plan = normalizeAgentPlan({
  explanation: "Implement and verify",
  plan: [
    { step: "Inspect", status: "completed" },
    { step: "Implement", status: "in_progress" },
    { step: "Verify", status: "pending" }
  ]
});
assert.equal(plan.plan.length, 3);
assert.throws(
  () => normalizeAgentPlan({
    plan: [
      { step: "One", status: "in_progress" },
      { step: "Two", status: "in_progress" }
    ]
  }),
  /At most one/
);

const weatherSchema = inferToolInputSchema(
  { location: "Shanghai", language: "zh" },
  ["location"]
);
assert.deepEqual(weatherSchema.required, ["location"]);
assert.equal(weatherSchema.properties.language.type, "string");

console.log("Agent runtime tests passed.");
