import assert from "node:assert/strict";
import { createAgentService } from "../src/agent-service.js";

const order = [];
const service = createAgentService({
  execute: async (messages, options) => {
    order.push(`start:${messages[0].content}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    order.push(`end:${messages[0].content}`);
    return { final: messages[0].content, turnId: options.turnId };
  }
});
const first = service.run([{ role: "user", content: "one" }], { sessionId: "same" });
const second = service.run([{ role: "user", content: "two" }], { sessionId: "same" });
const third = service.run([{ role: "user", content: "other" }], { sessionId: "other" });
await Promise.all([first, second, third]);
assert.ok(order.indexOf("end:one") < order.indexOf("start:two"));
assert.ok(order.indexOf("start:other") < order.indexOf("start:two"));
assert.equal(service.active().length, 0);

let lazyBuilt = false;
const lazy = await service.run(async () => {
  lazyBuilt = true;
  return [{ role: "user", content: "lazy" }];
}, { sessionId: "lazy" });
assert.equal(lazyBuilt, true);
assert.equal(lazy.final, "lazy");

console.log("AgentService tests passed.");
