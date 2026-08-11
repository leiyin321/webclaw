import assert from "node:assert/strict";
import { createAgentRecoveryPolicy } from "../src/agent-recovery-policy.js";

const policy = createAgentRecoveryPolicy({
  maxProtocolRetries: 2,
  maxEmptyResponseRetries: 1,
  maxFinalValidationRetries: 1,
  rawOutputChars: 20
});

const firstProtocol = policy.recoverProtocolError({
  protocolError: {
    message: "invalid Tool JSON",
    raw: "x".repeat(50)
  }
});
assert.equal(firstProtocol.action, "retry");
assert.equal(firstProtocol.attempt, 1);
assert.match(firstProtocol.messages[0].content, /truncated 30 chars/);
assert.match(firstProtocol.messages[1].content, /MODEL_PROTOCOL_ERROR/);

assert.equal(policy.recoverProtocolError({ protocolError: {} }).action, "retry");
const exhaustedProtocol = policy.recoverProtocolError({ protocolError: {} });
assert.equal(exhaustedProtocol.action, "stop");
assert.equal(exhaustedProtocol.reason, "protocol_retry_limit");

assert.equal(policy.recoverEmptyResponse().action, "retry");
const exhaustedEmpty = policy.recoverEmptyResponse();
assert.equal(exhaustedEmpty.action, "stop");
assert.equal(exhaustedEmpty.reason, "empty_response_retry_limit");

const finalValidation = policy.recoverFinalValidation({
  assistantText: "invalid",
  validationResult: { ok: false, errors: [{ path: "$.summary" }] }
});
assert.equal(finalValidation.action, "retry");
assert.match(finalValidation.messages[1].content, /TASK_OUTPUT_VALIDATION_ERROR/);
const exhaustedValidation = policy.recoverFinalValidation({});
assert.equal(exhaustedValidation.action, "stop");
assert.equal(exhaustedValidation.reason, "final_validation_retry_limit");

assert.deepEqual(policy.snapshot(), {
  counters: { protocol: 2, emptyResponse: 1, finalValidation: 1, model: 0 },
  limits: { protocol: 2, emptyResponse: 1, finalValidation: 1, model: 2 }
});

const disabled = createAgentRecoveryPolicy({ maxProtocolRetries: 0 });
assert.equal(disabled.recoverProtocolError({ protocolError: {} }).action, "stop");

const restored = createAgentRecoveryPolicy({
  maxModelRetries: 2,
  counters: { model: 2 }
});
assert.equal(restored.recoverModelError({
  classifiedError: { type: "transient", retryable: true }
}).action, "stop");

console.log("Agent recovery policy tests passed.");
