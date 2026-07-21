import { DEFAULT_BASE_URL, fetchQRCode, getUpdates, notifyStart, notifyStop, pollQRStatus, sendMessage } from "./wechat-api.js";
import {
  loadWechatChannelAccount,
  loadWechatSyncBuf,
  normalizeAccountId,
  saveWechatChannelAccount,
  saveWechatSyncBuf
} from "./wechat-storage.js";
import { downloadMessageMedia } from "./wechat-media.js";
import { summarizeMessage } from "./wechat-message.js";

const DEFAULT_BOT_TYPE = "3";
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 480_000;
const RECONNECT_DELAY_MS = 3000;

const bridges = new Map();

function createBridge(channelId) {
  return {
    state: {
      channelId,
      enabled: false,
      connected: false,
      loginState: "idle",
      accountId: "",
      baseUrl: DEFAULT_BASE_URL,
      qrcode: "",
      qrcodeUrl: "",
      lastError: "",
      lastEventAt: 0,
      receivedCount: 0,
      sentCount: 0,
      pendingCount: 0
    },
    activeController: null,
    activeSession: null,
    bridgeStartPromise: null,
    restartTimer: null
  };
}

function getBridge(channelId = "wechat") {
  const id = String(channelId || "wechat");
  if (!bridges.has(id)) bridges.set(id, createBridge(id));
  return bridges.get(id);
}

function allBridgeStates() {
  return Array.from(bridges.values()).map((bridge) => bridge.state);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isWechatBridgeMessage(message)) return false;
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

function isWechatBridgeMessage(message) {
  return (
    message?.type === "WEBCLAW_WECHAT_START" ||
    message?.type === "WEBCLAW_WECHAT_STOP" ||
    message?.type === "WEBCLAW_WECHAT_SEND_MESSAGE" ||
    message?.type === "WEBCLAW_WECHAT_GET_STATUS"
  );
}

async function handleMessage(message) {
  const bridge = getBridge(message?.channelId || message?.payload?.channelId || "wechat");
  switch (message?.type) {
    case "WEBCLAW_WECHAT_START":
      return startBridge(bridge, { forceLogin: Boolean(message.forceLogin) });
    case "WEBCLAW_WECHAT_STOP":
      return stopBridge(bridge, message.reason || "Stopped");
    case "WEBCLAW_WECHAT_SEND_MESSAGE":
      return sendWechatMessage(bridge, message.payload || {});
    case "WEBCLAW_WECHAT_GET_STATUS":
      return message.channelId ? bridge.state : { channels: allBridgeStates() };
    default:
      throw new Error(`Unknown WeChat bridge message: ${message?.type}`);
  }
}

async function startBridge(bridge, { forceLogin = false } = {}) {
  bridge.state = {
    ...bridge.state,
    enabled: true,
    lastError: "",
    lastEventAt: Date.now()
  };
  broadcastStatus(bridge);
  if (bridge.bridgeStartPromise) {
    if (!forceLogin) return bridge.state;
    const previousPromise = bridge.bridgeStartPromise;
    await stopBridge(bridge, "Relogin");
    try {
      await previousPromise;
    } catch {
      // The old bridge is being torn down in order to restart cleanly.
    }
  }
  bridge.bridgeStartPromise = runBridge(bridge, forceLogin)
    .catch((error) => {
      if (bridge.activeController?.signal.aborted || error?.name === "AbortError") {
        return;
      }
      bridge.state = {
        ...bridge.state,
        connected: false,
        loginState: "error",
        lastError: normalizeError(error),
        lastEventAt: Date.now()
      };
      broadcastStatus(bridge);
      scheduleRestart(bridge);
    })
    .finally(() => {
      bridge.bridgeStartPromise = null;
    });
  return bridge.state;
}

async function stopBridge(bridge, reason = "Stopped") {
  clearRestart(bridge);
  const controller = bridge.activeController;
  bridge.activeController = null;
  if (bridge.activeSession?.baseUrl && bridge.activeSession?.token) {
    notifyStop({ baseUrl: bridge.activeSession.baseUrl, token: bridge.activeSession.token }).catch(() => {});
  }
  bridge.activeSession = null;
  if (controller) {
    controller.abort();
  }
  bridge.state = {
    ...bridge.state,
    enabled: false,
    connected: false,
    loginState: "idle",
    lastError: reason === "Stopped" ? "" : reason,
    qrcode: "",
    qrcodeUrl: "",
    lastEventAt: Date.now()
  };
  broadcastStatus(bridge);
  return bridge.state;
}

async function runBridge(bridge, forceLogin) {
  clearRestart(bridge);
  const controller = new AbortController();
  bridge.activeController = controller;

  try {
    while (!controller.signal.aborted) {
      const storedAccount = await loadWechatChannelAccount(bridge.state.channelId);
      if (storedAccount && storedAccount.token && !forceLogin) {
        await resumeAccount(bridge, storedAccount, controller.signal);
        return;
      }
      forceLogin = false;
      await loginAndRun(bridge, controller.signal);
      return;
    }
  } finally {
    if (bridge.activeController === controller) bridge.activeController = null;
  }
}

async function loginAndRun(bridge, signal) {
  let currentBaseUrl = DEFAULT_BASE_URL;
  let pendingVerifyCode = "";
  bridge.state = {
    ...bridge.state,
    connected: false,
    loginState: "qr",
    qrcode: "",
    qrcodeUrl: "",
    lastError: "",
    lastEventAt: Date.now()
  };
  broadcastStatus(bridge);

  const qr = await fetchQRCode({
    baseUrl: DEFAULT_BASE_URL,
    botType: DEFAULT_BOT_TYPE,
    localTokenList: []
  });
  bridge.state = {
    ...bridge.state,
    loginState: "qr",
    qrcode: String(qr.qrcode || ""),
    qrcodeUrl: String(qr.qrcode_img_content || ""),
    baseUrl: currentBaseUrl,
    lastEventAt: Date.now()
  };
  broadcastStatus(bridge);

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline && !signal.aborted) {
    const status = await pollQRStatus({
      baseUrl: currentBaseUrl,
      qrcode: qr.qrcode,
      verifyCode: pendingVerifyCode,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      signal
    });
    switch (status.status) {
      case "wait":
        await sleep(1000);
        break;
      case "scaned":
        bridge.state = {
          ...bridge.state,
          loginState: "scanned",
          lastEventAt: Date.now()
        };
        broadcastStatus(bridge);
        break;
      case "need_verifycode":
        bridge.state = {
          ...bridge.state,
          loginState: "verify",
          lastEventAt: Date.now()
        };
        broadcastStatus(bridge);
        pendingVerifyCode = "";
        throw new Error("This login flow now requires manual verify code input, which is not wired into the extension yet.");
      case "scaned_but_redirect":
        if (status.redirect_host) currentBaseUrl = `https://${status.redirect_host}`;
        break;
      case "expired":
        throw new Error("二维码已过期，请重新连接。");
      case "binded_redirect":
        throw new Error("该微信账号已绑定过当前应用。");
      case "confirmed": {
        if (!status.ilink_bot_id || !status.bot_token) {
          throw new Error("登录确认成功，但服务端没有返回凭证。");
        }
        const accountId = normalizeAccountId(status.ilink_bot_id);
        bridge.activeSession = {
          accountId,
          token: status.bot_token,
          baseUrl: status.baseurl || currentBaseUrl || DEFAULT_BASE_URL,
          userId: status.ilink_user_id || "",
          getUpdatesBuf: ""
        };
        await saveWechatChannelAccount(bridge.state.channelId, accountId, {
          token: status.bot_token,
          baseUrl: bridge.activeSession.baseUrl,
          userId: bridge.activeSession.userId
        });
        await notifyStart({ baseUrl: bridge.activeSession.baseUrl, token: bridge.activeSession.token });
        bridge.state = {
          ...bridge.state,
          connected: true,
          loginState: "connected",
          accountId,
          baseUrl: bridge.activeSession.baseUrl,
          qrcode: "",
          qrcodeUrl: "",
          lastError: "",
          lastEventAt: Date.now()
        };
        broadcastStatus(bridge);
        await pollLoop(bridge, signal);
        return;
      }
      default:
        bridge.state = {
          ...bridge.state,
          lastError: `未知二维码状态：${String(status.status || JSON.stringify(status))}`,
          lastEventAt: Date.now()
        };
        broadcastStatus(bridge);
        await sleep(1000);
        break;
    }
  }
  throw new Error("登录超时，请重试。");
}

async function resumeAccount(bridge, storedAccount, signal) {
  const accountId = normalizeAccountId(storedAccount.accountId || storedAccount.rawAccountId || storedAccount.userId || "wechat");
  bridge.activeSession = {
    accountId,
    token: storedAccount.token,
    baseUrl: storedAccount.baseUrl || DEFAULT_BASE_URL,
    userId: storedAccount.userId || "",
    getUpdatesBuf: await loadWechatSyncBuf(accountId)
  };
  bridge.state = {
    ...bridge.state,
    connected: true,
    loginState: "connected",
    accountId,
    baseUrl: bridge.activeSession.baseUrl,
    lastError: "",
    qrcode: "",
    qrcodeUrl: "",
    lastEventAt: Date.now()
  };
  broadcastStatus(bridge);
  try {
    await notifyStart({ baseUrl: bridge.activeSession.baseUrl, token: bridge.activeSession.token });
  } catch (error) {
    bridge.state = {
      ...bridge.state,
      lastError: `notifyStart: ${normalizeError(error)}`,
      lastEventAt: Date.now()
    };
    broadcastStatus(bridge);
  }
  await pollLoop(bridge, signal);
}

async function pollLoop(bridge, signal) {
  if (!bridge.activeSession) return;
  while (!signal.aborted && bridge.activeSession) {
    try {
      const currentBuf = await loadWechatSyncBuf(bridge.activeSession.accountId);
      const response = await getUpdates({
        baseUrl: bridge.activeSession.baseUrl,
        token: bridge.activeSession.token,
        getUpdatesBuf: currentBuf || bridge.activeSession.getUpdatesBuf || "",
        timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
        signal
      });
      if (signal.aborted || !bridge.activeSession) break;
      if (Number(response?.ret || 0) !== 0 || Number(response?.errcode || 0) !== 0) {
        bridge.state = {
          ...bridge.state,
          connected: false,
          loginState: "relogin",
          lastError: `getUpdates ret=${response?.ret || ""} errcode=${response?.errcode || ""} ${response?.errmsg || ""}`.trim(),
          lastEventAt: Date.now()
        };
        broadcastStatus(bridge);
        await sleep(RECONNECT_DELAY_MS);
        continue;
      }
      const nextBuf = String(response.get_updates_buf || currentBuf || "");
      bridge.activeSession.getUpdatesBuf = nextBuf;
      await saveWechatSyncBuf(bridge.activeSession.accountId, nextBuf);
      bridge.state = {
        ...bridge.state,
        connected: true,
        loginState: "connected",
        lastError: "",
        lastEventAt: Date.now()
      };
      broadcastStatus(bridge);
      const msgs = Array.isArray(response.msgs) ? response.msgs : [];
      for (const message of msgs) {
        await handleInboundMessage(bridge, message);
      }
    } catch (error) {
      if (signal.aborted || !bridge.activeSession) break;
      bridge.state = {
        ...bridge.state,
        connected: false,
        loginState: "relogin",
        lastError: `getUpdates: ${normalizeError(error)}`,
        lastEventAt: Date.now()
      };
      broadcastStatus(bridge);
      await sleep(RECONNECT_DELAY_MS);
    }
  }
}

async function handleInboundMessage(bridge, message) {
  const summary = summarizeMessage(message);
  const media = await downloadMessageMedia(message, bridge.activeSession?.accountId || "");
  const payload = {
    queueId: crypto.randomUUID(),
    channelId: bridge.state.channelId || "wechat",
    accountId: bridge.activeSession?.accountId || "",
    peerId: summary.from,
    messageId: summary.id,
    text: summary.text,
    mediaTypes: summary.mediaTypes,
    media,
    contextToken: summary.contextToken,
    timestamp: summary.timestamp
  };
  await chrome.runtime.sendMessage({
    type: "WEBCLAW_WECHAT_INCOMING",
    payload
  }).catch(() => {});
}

async function sendWechatMessage(bridge, payload) {
  if (!bridge.activeSession) throw new Error(`WeChat session is not active for ${bridge.state.channelId}.`);
  const peerId = String(payload.peerId || "").trim();
  if (!peerId) throw new Error("peerId is required.");
  const text = String(payload.text || "").trim();
  if (!text) throw new Error("text is required.");
  const result = await sendMessage({
    baseUrl: bridge.activeSession.baseUrl,
    token: bridge.activeSession.token,
    to: peerId,
    text,
    contextToken: payload.contextToken || ""
  });
  bridge.state = {
    ...bridge.state,
    sentCount: Number(bridge.state.sentCount || 0) + 1,
    lastError: "",
    lastEventAt: Date.now()
  };
  broadcastStatus(bridge);
  return result;
}

function scheduleRestart(bridge) {
  if (bridge.restartTimer || !bridge.state.enabled) return;
  bridge.restartTimer = setTimeout(() => {
    bridge.restartTimer = null;
    if (bridge.state.enabled) {
      startBridge(bridge, { forceLogin: false }).catch(() => {});
    }
  }, RECONNECT_DELAY_MS);
}

function clearRestart(bridge) {
  if (!bridge.restartTimer) return;
  clearTimeout(bridge.restartTimer);
  bridge.restartTimer = null;
}

function broadcastStatus(bridge) {
  chrome.runtime.sendMessage({
    type: "WEBCLAW_WECHAT_BRIDGE_STATUS",
    payload: {
      ...bridge.state,
      channels: allBridgeStates()
    }
  }).catch(() => {});
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeError(error) {
  if (error instanceof Error) return error.message;
  return String(error || "Unknown error");
}
