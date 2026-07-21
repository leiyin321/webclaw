if (!globalThis.__WEBCLAW_CONTENT_INSTALLED__) {
  globalThis.__WEBCLAW_CONTENT_INSTALLED__ = true;
  globalThis.__WEBCLAW_TEXT_NODE_MAP__ = new Map();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleContentMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  });
}

async function handleContentMessage(message) {
  switch (message?.type) {
    case "WEBCLAW_CONTENT_GET_CONTEXT":
      return getPageContext(message);
    case "WEBCLAW_CONTENT_CLICK":
      return clickElement(message.selector);
    case "WEBCLAW_CONTENT_TYPE_TEXT":
      return typeText(message.selector, message.text, message.clear);
    case "WEBCLAW_CONTENT_RUN_JS":
      return runJavaScript(message.code);
    case "WEBCLAW_CONTENT_COLLECT_TEXT_NODES":
      return collectTextNodes(message.maxItems, message.maxTotalChars);
    case "WEBCLAW_CONTENT_APPLY_TEXT_TRANSLATIONS":
      return applyTextTranslations(message.translations);
    default:
      throw new Error(`Unknown content message: ${message?.type}`);
  }
}

function getPageContext(options = {}) {
  const maxTextChars = clampNumber(options.maxTextChars, 500, 12000, 12000);
  const maxSelectedTextChars = clampNumber(options.maxSelectedTextChars, 500, 4000, 4000);
  const maxInteractive = clampNumber(options.maxInteractive, 0, 120, 120);
  const fullText = visibleBodyText();
  const selectedText = String(getSelection?.() || "");
  const interactive = collectInteractiveElements(maxInteractive);
  return {
    ok: true,
    url: location.href,
    title: document.title,
    selectedText: selectedText.slice(0, maxSelectedTextChars),
    text: fullText.slice(0, maxTextChars),
    interactive,
    originalTextChars: fullText.length,
    originalSelectedTextChars: selectedText.length,
    originalInteractiveCount: interactive.originalCount || interactive.length
  };
}

function collectInteractiveElements(maxItems = 120) {
  const selectors = [
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[contenteditable='true']"
  ];
  const visible = Array.from(document.querySelectorAll(selectors.join(","))).filter(isVisible);
  const items = visible
    .slice(0, maxItems)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        selector: uniqueSelector(element),
        tag: element.tagName.toLowerCase(),
        type: element.getAttribute("type") || "",
        text: elementText(element).slice(0, 140),
        ariaLabel: element.getAttribute("aria-label") || "",
        placeholder: element.getAttribute("placeholder") || "",
        href: element.href || "",
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      };
    });
  Object.defineProperty(items, "originalCount", {
    value: visible.length,
    enumerable: false
  });
  return items;
}

function clickElement(selector) {
  const element = findElement(selector);
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  element.click();
  return { ok: true, selector };
}

function typeText(selector, text, clear = true) {
  const element = findElement(selector);
  element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  element.focus();

  if (element.isContentEditable) {
    if (clear) element.textContent = "";
    element.textContent += text;
  } else {
    if (clear) element.value = "";
    element.value += text;
  }

  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selector, textLength: String(text).length };
}

async function runJavaScript(code) {
  const fn = new Function(`"use strict"; return (async () => { ${code}\n })();`);
  const value = await fn();
  return {
    ok: true,
    result: serializeValue(value)
  };
}

function collectTextNodes(maxItems = 320, maxTotalChars = 24000) {
  const limit = Math.max(1, Number(maxItems || 320));
  const charLimit = Math.max(1000, Number(maxTotalChars || 24000));
  const map = new Map();
  const items = [];
  let totalChars = 0;
  let index = 0;
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = normalizedText(node.nodeValue);
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || shouldSkipTextParent(parent) || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  while (items.length < limit) {
    const node = walker.nextNode();
    if (!node) break;
    const text = normalizedText(node.nodeValue);
    if (totalChars + text.length > charLimit) break;
    const id = `t${Date.now().toString(36)}_${index}`;
    index += 1;
    map.set(id, node);
    items.push({ id, text });
    totalChars += text.length;
  }

  globalThis.__WEBCLAW_TEXT_NODE_MAP__ = map;
  return {
    ok: true,
    url: location.href,
    title: document.title,
    items,
    totalChars
  };
}

function applyTextTranslations(translations) {
  const map = globalThis.__WEBCLAW_TEXT_NODE_MAP__ || new Map();
  let translatedCount = 0;
  for (const translation of Array.isArray(translations) ? translations : []) {
    const node = map.get(String(translation.id));
    if (!node || typeof translation.text !== "string") continue;
    node.nodeValue = preserveOuterWhitespace(node.nodeValue, translation.text);
    translatedCount += 1;
  }
  return {
    ok: true,
    translatedCount
  };
}

function findElement(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);
  return element;
}

function visibleBodyText() {
  return (document.body?.innerText || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function shouldSkipTextParent(element) {
  return Boolean(
    element.closest(
      "script,style,noscript,template,svg,canvas,code,pre,textarea,input,select,[contenteditable='true'],[aria-hidden='true']"
    )
  );
}

function preserveOuterWhitespace(original, replacement) {
  const match = String(original || "").match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return replacement;
  return `${match[1]}${replacement}${match[3]}`;
}

function elementText(element) {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || element.placeholder || element.name || element.id || "";
  }
  return element.innerText || element.textContent || element.getAttribute("title") || "";
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function uniqueSelector(element) {
  if (element.id) return `#${escapeCss(element.id)}`;
  const testId = element.getAttribute("data-testid") || element.getAttribute("data-test");
  if (testId) return `[data-testid="${escapeAttribute(testId)}"]`;

  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const name = current.getAttribute("name");
    if (name) part += `[name="${escapeAttribute(name)}"]`;
    const siblings = Array.from(current.parentElement?.children || []).filter(
      (sibling) => sibling.tagName === current.tagName
    );
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    const selector = parts.join(" > ");
    if (document.querySelectorAll(selector).length === 1) return selector;
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function escapeCss(value) {
  return CSS.escape ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeAttribute(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function serializeValue(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}
