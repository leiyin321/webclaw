const MODEL_TURN_TYPE = "model_turn";

export function normalizeAgentModelTurn(response, options = {}) {
  if (response?.type === MODEL_TURN_TYPE) return validateModelTurn(response);

  const source = response && typeof response === "object" ? response : {};
  const raw = String(source.raw ?? (typeof response === "string" ? response : ""));
  if (source.kind === "protocol_error") {
    return createProtocolErrorTurn(source.text, raw);
  }
  if (source.kind === "tool_call" && source.tool?.name) {
    return createToolCallTurn([normalizeToolCall(source.tool, options)], raw);
  }
  if (source.kind === "tool_calls" && Array.isArray(source.tools)) {
    return createToolCallTurn(source.tools.map((tool) => normalizeToolCall(tool, options)), raw);
  }
  if (source.kind === "assistant") {
    return createAssistantTurn(source.text, raw, source.value);
  }

  return createProtocolErrorTurn("Provider returned an unsupported Agent response.", raw);
}

export function createAssistantTurn(text, raw = "", value = undefined) {
  return {
    type: MODEL_TURN_TYPE,
    items: [{
      type: "assistant_text",
      text: String(text || ""),
      ...(value !== undefined ? { value } : {})
    }],
    finishReason: "stop",
    raw: String(raw || "")
  };
}

export function createToolCallTurn(toolCalls, raw = "") {
  const items = (Array.isArray(toolCalls) ? toolCalls : []).map((tool) => ({
    type: "tool_call",
    callId: String(tool.callId || ""),
    name: String(tool.name || ""),
    args: normalizeArgs(tool.args)
  }));
  if (!items.length || items.some((item) => !item.name || !item.callId)) {
    throw new Error("ModelTurn Tool Calls require name and callId.");
  }
  return {
    type: MODEL_TURN_TYPE,
    items,
    finishReason: "tool_calls",
    raw: String(raw || "")
  };
}

export function createProtocolErrorTurn(message, raw = "") {
  return {
    type: MODEL_TURN_TYPE,
    items: [],
    finishReason: "protocol_error",
    protocolError: {
      message: String(message || "Model response protocol error.")
    },
    raw: String(raw || "")
  };
}

export function modelTurnAssistantText(turn) {
  return (Array.isArray(turn?.items) ? turn.items : [])
    .filter((item) => item?.type === "assistant_text")
    .map((item) => String(item.text || ""))
    .join("");
}

export function modelTurnFinalValue(turn) {
  const item = (Array.isArray(turn?.items) ? turn.items : [])
    .find((candidate) => candidate?.type === "assistant_text");
  return item && Object.hasOwn(item, "value") ? item.value : modelTurnAssistantText(turn);
}

export function modelTurnToolCalls(turn) {
  return (Array.isArray(turn?.items) ? turn.items : [])
    .filter((item) => item?.type === "tool_call")
    .map((item) => ({
      callId: String(item.callId || ""),
      name: String(item.name || ""),
      args: normalizeArgs(item.args)
    }));
}

export function modelTurnProtocolError(turn) {
  if (turn?.finishReason !== "protocol_error") return null;
  return {
    message: String(turn?.protocolError?.message || "Model response protocol error."),
    raw: String(turn?.raw || "")
  };
}

function normalizeToolCall(tool, options) {
  const createCallId = typeof options.createCallId === "function"
    ? options.createCallId
    : () => crypto.randomUUID();
  return {
    name: String(tool?.name || ""),
    args: normalizeArgs(tool?.args),
    callId: String(tool?.callId || createCallId())
  };
}

function normalizeArgs(args) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : {};
}

function validateModelTurn(turn) {
  if (!Array.isArray(turn.items)) throw new Error("ModelTurn items must be an array.");
  if (!String(turn.finishReason || "")) throw new Error("ModelTurn finishReason is required.");
  return turn;
}
