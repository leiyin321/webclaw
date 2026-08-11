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
    case "WEBCLAW_CONTENT_PAGE_ACTION":
      return pageAction(message);
    case "WEBCLAW_CONTENT_PAGE_WAIT":
      return pageWait(message);
    case "WEBCLAW_CONTENT_PAGE_EXTRACT":
      return pageExtract(message);
    case "WEBCLAW_CONTENT_PAGE_STORAGE":
      return pageStorage(message);
    case "WEBCLAW_CONTENT_PAGE_FILE_INPUT":
      return pageFileInput(message);
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

function pageAction(options) {
  const action = String(options.action || "");
  if (action === "click") return clickElement(requiredValue(options.selector, "selector"));
  if (action === "type") return typeText(requiredValue(options.selector, "selector"), String(options.text ?? ""), options.clear !== false);
  const element = options.selector ? findElement(options.selector) : document.activeElement || document.body;
  element?.scrollIntoView?.({ block: options.block || "center", behavior: "instant" });
  if (action === "select") {
    if (!(element instanceof HTMLSelectElement)) throw new Error("page_action select requires a <select> element.");
    if (options.value !== undefined) element.value = String(options.value);
    else if (options.label !== undefined) {
      const option = Array.from(element.options).find((item) => item.label === String(options.label) || item.text === String(options.label));
      if (!option) throw new Error(`Select option not found: ${options.label}`);
      element.value = option.value;
    } else throw new Error("page_action select requires value or label.");
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, action, selector: options.selector, value: element.value };
  }
  if (action === "check") {
    if (!(element instanceof HTMLInputElement) || !["checkbox", "radio"].includes(element.type)) {
      throw new Error("page_action check requires a checkbox or radio input.");
    }
    element.checked = options.checked !== false;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, action, selector: options.selector, checked: element.checked };
  }
  if (action === "hover") {
    element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, view: window }));
  } else if (action === "focus") {
    element.focus();
  } else if (action === "keypress") {
    const init = {
      key: requiredValue(options.key, "key"), code: String(options.code || ""), bubbles: true,
      ctrlKey: options.ctrlKey === true, altKey: options.altKey === true,
      shiftKey: options.shiftKey === true, metaKey: options.metaKey === true
    };
    element.dispatchEvent(new KeyboardEvent("keydown", init));
    element.dispatchEvent(new KeyboardEvent("keypress", init));
    element.dispatchEvent(new KeyboardEvent("keyup", init));
  } else if (action === "scroll") {
    if (options.selector) {
      element.scrollIntoView({ block: options.block || "center", behavior: options.behavior || "auto" });
    } else if (Number.isFinite(Number(options.deltaX)) || Number.isFinite(Number(options.deltaY))) {
      window.scrollBy({ left: Number(options.deltaX || 0), top: Number(options.deltaY || 0), behavior: options.behavior || "auto" });
    } else {
      window.scrollTo({ left: Number(options.left || 0), top: Number(options.top || 0), behavior: options.behavior || "auto" });
    }
  } else if (action === "submit") {
    const form = element instanceof HTMLFormElement ? element : element.closest?.("form");
    if (!form) throw new Error("page_action submit could not find a form.");
    form.requestSubmit();
  } else {
    throw new Error(`Unsupported page_action action: ${action}`);
  }
  return { ok: true, action, selector: options.selector || "" };
}

async function pageWait(options) {
  const condition = String(options.condition || "");
  const timeoutMs = clampNumber(options.timeoutMs, 0, 30000, condition === "timeout" ? 1000 : 10000);
  const pollMs = clampNumber(options.pollMs, 50, 2000, 200);
  if (condition === "timeout") {
    await delay(timeoutMs);
    return { ok: true, condition, waitedMs: timeoutMs };
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (pageWaitSatisfied(condition, options)) {
      return { ok: true, condition, waitedMs: Date.now() - startedAt, url: location.href };
    }
    await delay(pollMs);
  }
  throw new Error(`page_wait timed out after ${timeoutMs} ms (${condition}).`);
}

function pageWaitSatisfied(condition, options) {
  if (condition === "selector_visible") return Boolean(document.querySelector(requiredValue(options.selector, "selector")) && isVisible(document.querySelector(options.selector)));
  if (condition === "selector_hidden") {
    const element = document.querySelector(requiredValue(options.selector, "selector"));
    return !element || !isVisible(element);
  }
  if (condition === "text") return visibleBodyText().includes(requiredValue(options.text, "text"));
  if (condition === "url") return location.href.includes(requiredValue(options.url, "url"));
  if (condition === "ready") return options.state === "interactive"
    ? ["interactive", "complete"].includes(document.readyState)
    : document.readyState === "complete";
  throw new Error(`Unsupported page_wait condition: ${condition}`);
}

function pageExtract(options) {
  const kind = String(options.kind || "");
  const maxItems = clampNumber(options.maxItems, 1, 200, 50);
  const maxChars = clampNumber(options.maxChars, 100, 30000, 12000);
  let data;
  if (kind === "text") data = visibleBodyText().slice(0, maxChars);
  else if (kind === "links") data = Array.from(document.querySelectorAll("a[href]")).filter(isVisible).slice(0, maxItems).map((item) => ({ text: normalizedText(item.innerText).slice(0, 300), href: item.href, rel: item.rel || "" }));
  else if (kind === "tables") data = Array.from(document.querySelectorAll("table")).slice(0, maxItems).map((table) => Array.from(table.rows).slice(0, 100).map((row) => Array.from(row.cells).map((cell) => normalizedText(cell.innerText).slice(0, 1000))));
  else if (kind === "forms") data = Array.from(document.forms).slice(0, maxItems).map((form) => ({ action: form.action, method: form.method, fields: Array.from(form.elements).slice(0, 100).map((field) => ({ name: field.name || "", type: field.type || field.tagName.toLowerCase(), value: String(field.value || "").slice(0, 500), required: field.required === true })) }));
  else if (kind === "metadata") data = { title: document.title, url: location.href, lang: document.documentElement.lang || "", description: document.querySelector('meta[name="description"]')?.content || "", canonical: document.querySelector('link[rel="canonical"]')?.href || "", openGraph: Object.fromEntries(Array.from(document.querySelectorAll('meta[property^="og:"]')).slice(0, maxItems).map((meta) => [meta.getAttribute("property"), meta.content])) };
  else if (kind === "jsonld") data = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).slice(0, maxItems).map((script) => { try { return JSON.parse(script.textContent); } catch { return { raw: script.textContent.slice(0, maxChars), parseError: true }; } });
  else if (kind === "selector") data = Array.from(document.querySelectorAll(requiredValue(options.selector, "selector"))).slice(0, maxItems).map((element) => options.attribute ? element.getAttribute(options.attribute) : normalizedText(element.innerText || element.textContent).slice(0, maxChars));
  else throw new Error(`Unsupported page_extract kind: ${kind}`);
  return { ok: true, kind, url: location.href, data: truncateStructured(data, maxChars) };
}

function pageStorage(options) {
  const action = String(options.action || "");
  const storage = options.storage === "session" ? sessionStorage : localStorage;
  const storageName = options.storage === "session" ? "session" : "local";
  const key = String(options.key || "");
  if (action === "get") return { ok: true, storage: storageName, key: requiredValue(key, "key"), value: storage.getItem(key) };
  if (action === "list") {
    const maxItems = clampNumber(options.maxItems, 1, 200, 50);
    const maxValueChars = clampNumber(options.maxValueChars, 100, 20000, 4000);
    const entries = [];
    for (let index = 0; index < Math.min(storage.length, maxItems); index += 1) {
      const itemKey = storage.key(index);
      entries.push({ key: itemKey, value: String(storage.getItem(itemKey) || "").slice(0, maxValueChars) });
    }
    return { ok: true, storage: storageName, entries, total: storage.length };
  }
  if (action === "set") storage.setItem(requiredValue(key, "key"), String(options.value ?? ""));
  else if (action === "remove") storage.removeItem(requiredValue(key, "key"));
  else if (action === "clear") storage.clear();
  else throw new Error(`Unsupported page_storage action: ${action}`);
  return { ok: true, storage: storageName, action, key };
}

async function pageFileInput(options) {
  const element = findElement(requiredValue(options.selector, "selector"));
  if (!(element instanceof HTMLInputElement) || element.type !== "file") {
    throw new Error("page_file_input requires an input[type=file] element.");
  }
  const response = await fetch(requiredValue(options.dataUrl, "dataUrl"));
  const blob = await response.blob();
  const file = new File([blob], String(options.filename || "file"), {
    type: String(options.mimeType || blob.type || "application/octet-stream"),
    lastModified: Date.now()
  });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  element.files = transfer.files;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, selector: options.selector, filename: file.name, size: file.size, type: file.type };
}

function requiredValue(value, name) {
  if (value === undefined || value === null || String(value) === "") throw new Error(`${name} is required.`);
  return value;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncateStructured(value, maxChars) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return value;
  return { truncated: true, preview: serialized.slice(0, maxChars), originalChars: serialized.length };
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
