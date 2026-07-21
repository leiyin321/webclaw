const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const MESSAGE_ITEM_TYPE = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5
};

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function buildClientVersion(version) {
  const [major = 0, minor = 0, patch = 0] = String(version || "0.0.0")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function randomWechatUin() {
  const bytes = new Uint8Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function buildBaseInfo() {
  return {
    channel_version: "0.1.0",
    bot_agent: "WebClawWechatBridge/0.1.0"
  };
}

function buildCommonHeaders() {
  return {
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": String(buildClientVersion("0.1.0"))
  };
}

function buildHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": randomWechatUin(),
    ...buildCommonHeaders()
  };
  if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  return headers;
}

function timeoutSignal(timeoutMs, externalSignal) {
  const controller = timeoutMs ? new AbortController() : null;
  let timer = null;
  let cleanupExternal = () => {};
  if (controller && timeoutMs) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  if (controller && externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      const onAbort = () => controller.abort();
      externalSignal.addEventListener("abort", onAbort, { once: true });
      cleanupExternal = () => externalSignal.removeEventListener("abort", onAbort);
    }
  }
  return {
    signal: controller?.signal || externalSignal,
    cleanup() {
      if (timer) clearTimeout(timer);
      cleanupExternal();
    }
  };
}

export async function apiGet({ baseUrl, endpoint, timeoutMs, label }) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  const { signal, cleanup } = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildCommonHeaders(),
      ...(signal ? { signal } : {})
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${text}`);
    return text;
  } finally {
    cleanup();
  }
}

export async function apiPost({ baseUrl, endpoint, body, token, timeoutMs, label, signal: externalSignal }) {
  const url = new URL(endpoint, ensureTrailingSlash(baseUrl));
  const { signal, cleanup } = timeoutSignal(timeoutMs, externalSignal);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(body),
      ...(signal ? { signal } : {})
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${text}`);
    return text;
  } finally {
    cleanup();
  }
}

export async function fetchQRCode({ baseUrl = DEFAULT_BASE_URL, botType, localTokenList = [] }) {
  const raw = await apiPost({
    baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType || "3")}`,
    body: { local_token_list: localTokenList },
    label: "fetchQRCode"
  });
  return JSON.parse(raw);
}

export async function pollQRStatus({ baseUrl = DEFAULT_BASE_URL, qrcode, verifyCode, timeoutMs, signal }) {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    const raw = await apiGet({
      baseUrl,
      endpoint,
      timeoutMs: timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
      label: "pollQRStatus",
      signal
    });
    return JSON.parse(raw);
  } catch (error) {
    if (error.name === "AbortError") return { status: "wait" };
    if (String(error.message || error).includes("524")) return { status: "wait" };
    throw error;
  }
}

export async function getUpdates({ baseUrl, token, getUpdatesBuf, timeoutMs, signal }) {
  try {
    const text = await apiPost({
      baseUrl,
      endpoint: "ilink/bot/getupdates",
      body: {
        get_updates_buf: getUpdatesBuf || "",
        base_info: buildBaseInfo()
      },
      token,
      timeoutMs: timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
      label: "getUpdates",
      signal
    });
    return JSON.parse(text);
  } catch (error) {
    if (error.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf || "" };
    }
    throw error;
  }
}

export async function sendMessage({ baseUrl, token, to, text, contextToken }) {
  const clientId = `webclaw-wechat-${crypto.randomUUID()}`;
  const body = {
    msg: {
      from_user_id: "",
      to_user_id: to,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: text
        ? [
            {
              type: MESSAGE_ITEM_TYPE.TEXT,
              text_item: { text }
            }
          ]
        : undefined,
      context_token: contextToken || undefined
    },
    base_info: buildBaseInfo()
  };
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/sendmessage",
    body,
    token,
    timeoutMs: DEFAULT_API_TIMEOUT_MS,
    label: "sendMessage"
  });
  const response = JSON.parse(raw);
  if (response.ret && response.ret !== 0) {
    throw new Error(`sendMessage ret=${response.ret} errmsg=${response.errmsg || ""}`);
  }
  return { messageId: clientId };
}

export async function notifyStart({ baseUrl, token }) {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/msg/notifystart",
    body: { base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: "notifyStart"
  });
  return JSON.parse(raw);
}

export async function notifyStop({ baseUrl, token }) {
  const raw = await apiPost({
    baseUrl,
    endpoint: "ilink/bot/msg/notifystop",
    body: { base_info: buildBaseInfo() },
    token,
    timeoutMs: DEFAULT_CONFIG_TIMEOUT_MS,
    label: "notifyStop"
  });
  return JSON.parse(raw);
}
