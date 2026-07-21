const activeSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isChromeAIMessage(message)) return false;
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

function isChromeAIMessage(message) {
  return (
    message?.type === "WEBCLAW_CHROME_AI_AVAILABILITY" ||
    message?.type === "WEBCLAW_CHROME_AI_ABORT" ||
    message?.type === "WEBCLAW_CHROME_AI_PROMPT" ||
    message?.type === "WEBCLAW_CHROME_AI_SUMMARIZE"
  );
}

async function handleMessage(message) {
  if (message?.type === "WEBCLAW_CHROME_AI_AVAILABILITY") {
    const languageModel = getLanguageModel();
    const options = { expectedInputs: [{ type: "text" }], expectedOutputs: [{ type: "text" }] };
    const availability = await languageModel.availability(options);
    return { availability };
  }
  if (message?.type === "WEBCLAW_CHROME_AI_ABORT") {
    const controller = activeSessions.get(message.requestId);
    controller?.abort();
    activeSessions.delete(message.requestId);
    return { stopped: true };
  }
  if (message?.type === "WEBCLAW_CHROME_AI_PROMPT") {
    runPrompt(message).catch((error) => {
      chrome.runtime.sendMessage({
        type: "WEBCLAW_CHROME_AI_ERROR",
        requestId: message.requestId,
        error: normalizeError(error)
      }).catch(() => {});
    });
    return { started: true };
  }
  if (message?.type === "WEBCLAW_CHROME_AI_SUMMARIZE") {
    return summarizeText(message);
  }
  throw new Error(`Unknown Chrome AI message: ${message?.type}`);
}

async function summarizeText(message) {
  const summarizerApi = getSummarizer();
  const availability = await summarizerApi.availability();
  if (availability === "unavailable") {
    throw new Error("Chrome Summarizer API is unavailable on this device/profile.");
  }
  const summarizer = await summarizerApi.create({
    type: allowedValue(message.summaryType, ["key-points", "tldr", "teaser", "headline"], "key-points"),
    format: allowedValue(message.format, ["markdown", "plain-text"], "markdown"),
    length: allowedValue(message.length, ["short", "medium", "long"], "medium"),
    sharedContext: String(message.context || "").slice(0, 1000),
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        chrome.runtime.sendMessage({
          type: "WEBCLAW_CHROME_AI_STATUS",
          requestId: message.requestId,
          text: `Chrome Summarizer model download ${Math.round(Number(event.loaded || 0) * 100)}%`
        }).catch(() => {});
      });
    }
  });
  try {
    const summary = await summarizer.summarize(String(message.text || ""), {
      context: String(message.context || "").slice(0, 1000)
    });
    return { summary: String(summary || "") };
  } finally {
    summarizer.destroy?.();
  }
}

async function runPrompt(message) {
  const languageModel = getLanguageModel();
  const controller = new AbortController();
  activeSessions.set(message.requestId, controller);
  const hasImages = (message.messages || []).some((item) => Array.isArray(item.media) && item.media.length > 0);
  const createOptions = {
    signal: controller.signal,
    initialPrompts: initialPrompts(message.messages || []),
    expectedInputs: hasImages
      ? [{ type: "text" }, { type: "image" }]
      : [{ type: "text" }],
    expectedOutputs: [{ type: "text" }],
    monitor(monitor) {
      monitor.addEventListener("downloadprogress", (event) => {
        chrome.runtime.sendMessage({
          type: "WEBCLAW_CHROME_AI_STATUS",
          requestId: message.requestId,
          text: `Chrome AI model download ${Math.round(Number(event.loaded || 0) * 100)}%`
        }).catch(() => {});
      });
    }
  };
  try {
    const params = await languageModel.params?.();
    if (params?.defaultTopK && Number.isFinite(Number(message.temperature))) {
      createOptions.topK = params.defaultTopK;
      createOptions.temperature = Math.max(0, Math.min(Number(message.temperature || params.defaultTemperature || 1), params.maxTemperature || 2));
    }
  } catch {
    // Parameter tuning is optional.
  }
  const session = await languageModel.create(createOptions);
  try {
    const prompt = await finalPrompt(message.messages || []);
    const stream = session.promptStreaming(prompt, { signal: controller.signal });
    let content = "";
    for await (const chunk of stream) {
      const delta = String(chunk || "");
      content += delta;
      chrome.runtime.sendMessage({
        type: "WEBCLAW_CHROME_AI_DELTA",
        requestId: message.requestId,
        delta
      }).catch(() => {});
    }
    chrome.runtime.sendMessage({
      type: "WEBCLAW_CHROME_AI_DONE",
      requestId: message.requestId,
      content
    }).catch(() => {});
  } finally {
    activeSessions.delete(message.requestId);
    session.destroy?.();
  }
}

function initialPrompts(messages) {
  const items = messages.slice(0, -1).map((message) => ({
    role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
    content: String(message.content || "")
  }));
  return items.length ? items : undefined;
}

async function finalPrompt(messages) {
  const message = messages[messages.length - 1] || { role: "user", content: "" };
  if (!Array.isArray(message.media) || message.media.length === 0) {
    return String(message.content || "");
  }
  const content = [{ type: "text", value: String(message.content || "") }];
  for (const item of message.media) {
    content.push({
      type: "image",
      value: await dataUrlToBlob(item.dataUrl, item.mime)
    });
  }
  return [{ role: "user", content }];
}

async function dataUrlToBlob(dataUrl, fallbackMime = "image/jpeg") {
  if (!dataUrl) throw new Error("Missing image data URL.");
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (blob.type) return blob;
  return new Blob([await blob.arrayBuffer()], { type: fallbackMime });
}

function getLanguageModel() {
  const languageModel = globalThis.LanguageModel || globalThis.ai?.languageModel;
  if (!languageModel) {
    throw new Error("Chrome Prompt API is unavailable. Check Chrome version, built-in AI settings, hardware requirements, and chrome://on-device-internals.");
  }
  return languageModel;
}

function getSummarizer() {
  const summarizer = globalThis.Summarizer || globalThis.ai?.summarizer;
  if (!summarizer) {
    throw new Error("Chrome Summarizer API is unavailable. Check Chrome version, built-in AI settings, hardware requirements, and chrome://on-device-internals.");
  }
  return summarizer;
}

function allowedValue(value, allowed, fallback) {
  const text = String(value || "");
  return allowed.includes(text) ? text : fallback;
}

function normalizeError(error) {
  if (error instanceof Error) {
    const parts = [error.message || error.name || "Chrome AI error"];
    if (error.name === "QuotaExceededError" || /input is too large|quota/i.test(error.message || "")) {
      parts.push("Chrome AI Prompt API input is too large for the current context window.");
      if (error.requested !== undefined) parts.push(`requested=${error.requested}`);
      if (error.contextWindow !== undefined) parts.push(`contextWindow=${error.contextWindow}`);
      parts.push("WebClaw compacts page context for Chrome AI, but this prompt still does not fit. Try a shorter page/query or switch to a larger-context provider.");
    }
    return parts.join(" ");
  }
  return String(error || "Unknown error");
}
