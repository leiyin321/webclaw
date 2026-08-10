import assert from "node:assert/strict";

import {
  isOpenAICompatibleResponseFormatError,
  openAICompatibleStructuredOutputCacheId,
  openAICompatibleStructuredOutputModes,
  responseFormatForOpenAICompatibleMode
} from "../src/openai-compatible-structured-output.js";
import {
  normalizeOpenAICompatibleApiProtocol,
  openAICompatibleApiForConfig,
  openAICompatibleModelApi,
  responseTextFormatForOpenAICompatibleMode
} from "../src/openai-compatible-api.js";

const schemaFormat = {
  type: "json_schema",
  json_schema: {
    name: "result",
    schema: { type: "object" }
  }
};

assert.deepEqual(openAICompatibleStructuredOutputModes(schemaFormat), [
  "json_schema",
  "json_object",
  "prompt_only"
]);
assert.deepEqual(openAICompatibleStructuredOutputModes(schemaFormat, "json_object"), [
  "json_object",
  "prompt_only"
]);
assert.deepEqual(openAICompatibleStructuredOutputModes(schemaFormat, "prompt_only"), ["prompt_only"]);
assert.deepEqual(openAICompatibleStructuredOutputModes(null), ["prompt_only"]);
assert.equal(responseFormatForOpenAICompatibleMode("json_schema", schemaFormat), schemaFormat);
assert.deepEqual(responseFormatForOpenAICompatibleMode("json_object", schemaFormat), { type: "json_object" });
assert.equal(responseFormatForOpenAICompatibleMode("prompt_only", schemaFormat), undefined);
assert.deepEqual(responseTextFormatForOpenAICompatibleMode("json_schema", schemaFormat), {
  type: "json_schema",
  name: "result",
  strict: false,
  schema: { type: "object" }
});
assert.deepEqual(responseTextFormatForOpenAICompatibleMode("json_object", schemaFormat), {
  type: "json_object"
});
assert.equal(responseTextFormatForOpenAICompatibleMode("prompt_only", schemaFormat), undefined);
assert.equal(
  isOpenAICompatibleResponseFormatError(
    400,
    JSON.stringify({ error: { message: "This response_format type is unavailable now" } })
  ),
  true
);
assert.equal(
  isOpenAICompatibleResponseFormatError(
    400,
    JSON.stringify({ error: { message: "Bad request", param: "response_format" } })
  ),
  true
);
assert.equal(isOpenAICompatibleResponseFormatError(401, "response_format unsupported"), false);
assert.equal(isOpenAICompatibleResponseFormatError(400, '{"error":{"message":"model not found"}}'), false);
assert.equal(
  isOpenAICompatibleResponseFormatError(
    400,
    JSON.stringify({ error: { message: "text.format json_schema is unsupported", param: "text.format" } })
  ),
  true
);
assert.equal(
  openAICompatibleStructuredOutputCacheId("provider-1", "https://api.deepseek.com/", "deepseek-chat"),
  "provider-1\nhttps://api.deepseek.com\ndeepseek-chat"
);
assert.equal(normalizeOpenAICompatibleApiProtocol("responses"), "responses");
assert.equal(normalizeOpenAICompatibleApiProtocol("chat-completions"), "chat-completions");
assert.equal(normalizeOpenAICompatibleApiProtocol("unknown"), "auto");
assert.equal(openAICompatibleApiForConfig({ apiProtocol: "responses" }), "responses");
assert.equal(openAICompatibleApiForConfig({ apiProtocol: "chat-completions" }), "chat-completions");
assert.equal(
  openAICompatibleApiForConfig({
    apiProtocol: "auto",
    model: "model-a",
    availableModelDetails: [{ id: "model-a", api: "responses" }]
  }),
  "responses"
);
assert.equal(openAICompatibleApiForConfig({ apiProtocol: "auto", model: "model-a" }), "chat-completions");
assert.equal(openAICompatibleModelApi({ supported_endpoints: ["/responses"] }), "responses");
assert.equal(openAICompatibleModelApi({ supported_endpoints: ["/chat/completions"] }), "chat");
assert.equal(openAICompatibleModelApi({ supported_endpoints: [] }), "");

console.log("OpenAI-compatible structured output tests passed.");
