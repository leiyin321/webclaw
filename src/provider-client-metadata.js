// Keep model discovery aligned with the upstream CLI client identities.
export const CODEX_CLIENT_VERSION = "0.145.0";
export const COPILOT_CLIENT_VERSION = "1.0.68";
export const COPILOT_INTEGRATION_ID = "copilot-developer-cli";
const LEGACY_COPILOT_INTEGRATION_IDS = new Set(["vscode-chat"]);

export function normalizeCopilotIntegrationId(value) {
  const integrationId = String(value || "").trim();
  if (!integrationId || LEGACY_COPILOT_INTEGRATION_IDS.has(integrationId)) {
    return COPILOT_INTEGRATION_ID;
  }
  return integrationId;
}

export function copilotClientHeaders(accessToken, integrationId, options = {}) {
  const clientIdentity = `copilot/${COPILOT_CLIENT_VERSION}`;
  return {
    Authorization: `Bearer ${accessToken}`,
    "Copilot-Integration-Id": normalizeCopilotIntegrationId(integrationId),
    "Editor-Version": clientIdentity,
    "Editor-Plugin-Version": clientIdentity,
    "OpenAI-Intent": options.intent || "conversation-panel"
  };
}

export function copilotModelApi(model) {
  const endpoints = Array.isArray(model?.supported_endpoints)
    ? model.supported_endpoints
    : Array.isArray(model?.supportedEndpoints)
      ? model.supportedEndpoints
      : null;
  if (!endpoints) return "chat";
  const normalized = endpoints.map((endpoint) => String(endpoint || "").toLowerCase());
  if (normalized.some((endpoint) => endpoint === "/responses" || endpoint === "responses")) {
    return "responses";
  }
  if (normalized.some((endpoint) => endpoint === "/chat/completions" || endpoint === "chat/completions")) {
    return "chat";
  }
  return "";
}
