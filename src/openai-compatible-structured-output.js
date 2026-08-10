export const OPENAI_COMPATIBLE_STRUCTURED_OUTPUT_CACHE_KEY = "openAICompatibleStructuredOutputModes";
export const OPENAI_COMPATIBLE_STRUCTURED_OUTPUT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const STRUCTURED_OUTPUT_MODES = ["json_schema", "json_object", "prompt_only"];

export function openAICompatibleStructuredOutputCacheId(providerId, baseUrl, model) {
  return [
    String(providerId || "").trim(),
    String(baseUrl || "").trim().replace(/\/+$/, ""),
    String(model || "").trim()
  ].join("\n");
}

export function normalizeOpenAICompatibleStructuredOutputMode(value) {
  return STRUCTURED_OUTPUT_MODES.includes(value) ? value : "";
}

export function openAICompatibleStructuredOutputModes(responseFormat, cachedMode = "") {
  if (!responseFormat) return ["prompt_only"];
  const normalized = normalizeOpenAICompatibleStructuredOutputMode(cachedMode);
  if (!normalized) return [...STRUCTURED_OUTPUT_MODES];
  return STRUCTURED_OUTPUT_MODES.slice(STRUCTURED_OUTPUT_MODES.indexOf(normalized));
}

export function responseFormatForOpenAICompatibleMode(mode, responseFormat) {
  if (mode === "json_schema") return responseFormat;
  if (mode === "json_object") return { type: "json_object" };
  return undefined;
}

export function isOpenAICompatibleResponseFormatError(status, responseText) {
  if (Number(status) !== 400) return false;
  const text = String(responseText || "");
  let error = null;
  try {
    error = JSON.parse(text)?.error || null;
  } catch {
    // Some compatible backends return plain text errors.
  }
  const parameter = String(error?.param || "").toLowerCase();
  const message = String(error?.message || text).toLowerCase();
  if (parameter === "response_format" || parameter === "text.format" || parameter === "format") return true;
  return (
    /(response_format|text\.format|structured output|json_schema|json object)/.test(message) &&
    /(unavailable|unsupported|not supported|invalid|unknown|not allowed)/.test(message)
  );
}
