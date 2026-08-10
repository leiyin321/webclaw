import assert from "node:assert/strict";

import {
  CODEX_CLIENT_VERSION,
  COPILOT_CLIENT_VERSION,
  COPILOT_INTEGRATION_ID,
  copilotClientHeaders,
  copilotModelApi,
  normalizeCopilotIntegrationId
} from "../src/provider-client-metadata.js";

assert.equal(CODEX_CLIENT_VERSION, "0.145.0");
assert.equal(COPILOT_CLIENT_VERSION, "1.0.68");
assert.equal(normalizeCopilotIntegrationId(""), COPILOT_INTEGRATION_ID);
assert.equal(normalizeCopilotIntegrationId("vscode-chat"), COPILOT_INTEGRATION_ID);
assert.equal(normalizeCopilotIntegrationId("custom-integration"), "custom-integration");

assert.deepEqual(copilotClientHeaders("token", "vscode-chat"), {
  Authorization: "Bearer token",
  "Copilot-Integration-Id": "copilot-developer-cli",
  "Editor-Version": "copilot/1.0.68",
  "Editor-Plugin-Version": "copilot/1.0.68",
  "OpenAI-Intent": "conversation-panel"
});

assert.equal(copilotModelApi({ supported_endpoints: ["/responses", "ws:/responses"] }), "responses");
assert.equal(copilotModelApi({ supported_endpoints: ["/chat/completions"] }), "chat");
assert.equal(copilotModelApi({ supported_endpoints: ["/chat/completions", "/responses"] }), "responses");
assert.equal(copilotModelApi({ supported_endpoints: ["/v1/messages"] }), "");
assert.equal(copilotModelApi({ supported_endpoints: ["ws:/responses"] }), "");
assert.equal(copilotModelApi({}), "chat");

console.log("Provider client metadata tests passed.");
