const API_PROTOCOLS = new Set(["auto", "chat-completions", "responses"]);

export function normalizeOpenAICompatibleApiProtocol(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return API_PROTOCOLS.has(normalized) ? normalized : "auto";
}

export function openAICompatibleApiForConfig(config = {}) {
  const configured = normalizeOpenAICompatibleApiProtocol(config.apiProtocol);
  if (configured !== "auto") return configured;
  const model = String(config.model || "");
  const detail = (Array.isArray(config.availableModelDetails) ? config.availableModelDetails : [])
    .find((item) => String(item?.id || "") === model);
  return detail?.api === "responses" ? "responses" : "chat-completions";
}

export function openAICompatibleModelApi(model) {
  const endpoints = Array.isArray(model?.supported_endpoints)
    ? model.supported_endpoints
    : Array.isArray(model?.supportedEndpoints)
      ? model.supportedEndpoints
      : [];
  const normalized = endpoints.map((endpoint) => String(endpoint || "").trim().toLowerCase());
  if (normalized.some((endpoint) => endpoint === "/responses" || endpoint === "responses" || endpoint === "/v1/responses")) {
    return "responses";
  }
  if (normalized.some((endpoint) => endpoint === "/chat/completions" || endpoint === "chat/completions" || endpoint === "/v1/chat/completions")) {
    return "chat";
  }
  return "";
}

export function responseTextFormatForOpenAICompatibleMode(mode, responseFormat) {
  const schema = responseFormat?.json_schema;
  if (mode === "json_schema" && schema?.schema) {
    return {
      type: "json_schema",
      name: schema.name || "webclaw_agent_response",
      strict: schema.strict === true,
      schema: schema.schema
    };
  }
  if (mode === "json_object") return { type: "json_object" };
  return undefined;
}
