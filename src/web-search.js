const DEFAULT_BRAVE_BASE_URL = "https://api.search.brave.com";
const MAX_RESULTS = 10;
const MAX_CACHE_ENTRIES = 100;
const searchCache = new Map();

export function normalizeWebSearchConfig(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const provider = ["auto", "brave", "browser"].includes(String(raw.provider || ""))
    ? String(raw.provider)
    : "auto";
  return {
    provider,
    braveApiKey: String(raw.braveApiKey || "").trim(),
    braveBaseUrl: normalizeBraveBaseUrl(raw.braveBaseUrl),
    browserEngine: normalizeBrowserEngine(raw.browserEngine),
    fallbackToBrowser: raw.fallbackToBrowser !== false,
    maxResults: boundedInteger(raw.maxResults, 1, MAX_RESULTS, 5),
    timeoutSeconds: boundedInteger(raw.timeoutSeconds, 1, 120, 30),
    cacheTtlMinutes: boundedInteger(raw.cacheTtlMinutes, 0, 1440, 15)
  };
}

export function resolveWebSearchProvider(config) {
  const normalized = normalizeWebSearchConfig(config);
  if (normalized.provider === "browser") return "browser";
  if (normalized.provider === "brave") return "brave";
  return normalized.braveApiKey ? "brave" : "browser";
}

export async function runBraveWebSearch(configValue, args = {}, options = {}) {
  throwIfSearchAborted(options.signal);
  const config = normalizeWebSearchConfig(configValue);
  if (!config.braveApiKey) throw new Error("Brave Search API key is not configured.");
  assertSafeBraveBaseUrl(config.braveBaseUrl);
  const query = requiredQuery(args.query);
  const count = boundedInteger(args.count, 1, MAX_RESULTS, config.maxResults);
  const requestUrl = buildBraveSearchUrl(config, args, count);
  const cacheKey = JSON.stringify({ provider: "brave", baseUrl: config.braveBaseUrl, requestUrl });
  const cached = readCache(cacheKey, config.cacheTtlMinutes);
  if (cached) return { ...cached, cached: true };

  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.signal?.reason || new Error("Stopped"));
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  if (options.signal?.aborted) abortFromParent();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Brave Search timed out after ${config.timeoutSeconds} seconds.`)),
    config.timeoutSeconds * 1000
  );
  const startedAt = Date.now();
  try {
    const response = await (options.fetch || fetch)(requestUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": config.braveApiKey
      },
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Brave Search returned HTTP ${response.status}: ${boundedErrorText(text)}`);
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Brave Search returned invalid JSON: ${error.message}`);
    }
    const results = normalizeBraveResults(payload, count);
    const output = webSearchResults({
      provider: "brave",
      query,
      results,
      tookMs: Date.now() - startedAt
    });
    writeCache(cacheKey, output, config.cacheTtlMinutes);
    return output;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromParent);
  }
}

export function isWebSearchAbort(error, signal) {
  const message = String(error?.message || error || "").toLowerCase();
  return Boolean(signal?.aborted || error?.name === "AbortError" || message === "stopped" || message.includes("operation was aborted"));
}

export function shouldFallbackFromBrave(error, signal, fallbackEnabled) {
  return fallbackEnabled === true && !isWebSearchAbort(error, signal);
}

export function webSearchResults({ provider, query, results, tookMs, fallback }) {
  const normalizedResults = (Array.isArray(results) ? results : [])
    .map(normalizeResult)
    .filter(Boolean)
    .slice(0, MAX_RESULTS);
  return {
    kind: "results",
    provider: String(provider || "unknown"),
    query: requiredQuery(query),
    count: normalizedResults.length,
    ...(Number.isFinite(Number(tookMs)) ? { tookMs: Math.max(0, Math.floor(Number(tookMs))) } : {}),
    results: normalizedResults,
    externalContent: {
      untrusted: true,
      source: "web_search",
      wrapped: true,
      provider: String(provider || "unknown")
    },
    ...(fallback ? { fallback } : {})
  };
}

export function normalizeBrowserSearchResults(context, engine, count = 5) {
  const limit = boundedInteger(count, 1, MAX_RESULTS, 5);
  const results = [];
  const seen = new Set();
  for (const item of Array.isArray(context?.interactive) ? context.interactive : []) {
    if (item?.tag !== "a" || !item.href) continue;
    const url = canonicalBrowserResultUrl(item.href, engine);
    if (!url || seen.has(url)) continue;
    const title = sanitizeExternalText(item.text || item.ariaLabel || url, 500);
    if (!title) continue;
    seen.add(url);
    results.push({ title, url });
    if (results.length >= limit) break;
  }
  return results;
}

export function clearWebSearchCache() {
  searchCache.clear();
}

function buildBraveSearchUrl(config, args, count) {
  const url = new URL("res/v1/web/search", `${config.braveBaseUrl}/`);
  url.searchParams.set("q", requiredQuery(args.query));
  url.searchParams.set("count", String(count));
  appendParam(url, "country", normalizeCode(args.country, 2, 2));
  appendParam(url, "search_lang", String(args.search_lang || args.language || "").trim());
  appendParam(url, "ui_lang", String(args.ui_lang || "").trim());
  const dateAfter = normalizeDate(args.date_after, "date_after");
  const dateBefore = normalizeDate(args.date_before, "date_before");
  if (dateBefore && !dateAfter) throw new Error("date_before requires date_after for Brave Search.");
  if (dateAfter) url.searchParams.set("freshness", `${dateAfter}to${dateBefore || new Date().toISOString().slice(0, 10)}`);
  else if (args.freshness) url.searchParams.set("freshness", normalizeFreshness(args.freshness));
  return url.toString();
}

function throwIfSearchAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Stopped");
  error.name = "AbortError";
  throw error;
}

function normalizeBraveResults(payload, count) {
  return (Array.isArray(payload?.web?.results) ? payload.web.results : [])
    .map((item) => ({
      title: item?.title,
      url: item?.url,
      snippet: item?.description,
      published: isoDate(item?.page_age),
      siteName: item?.profile?.long_name || item?.profile?.name
    }))
    .map(normalizeResult)
    .filter(Boolean)
    .slice(0, count);
}

function normalizeResult(value) {
  const url = canonicalHttpUrl(value?.url);
  const title = sanitizeExternalText(value?.title, 500);
  if (!url || !title) return null;
  const snippet = sanitizeExternalText(value?.snippet, 4000);
  const published = isoDate(value?.published);
  const siteName = sanitizeExternalText(value?.siteName, 300);
  return {
    title,
    url,
    ...(snippet ? { snippet } : {}),
    ...(published ? { published } : {}),
    ...(siteName ? { siteName } : {})
  };
}

function canonicalBrowserResultUrl(value, engine) {
  try {
    const url = new URL(String(value));
    const normalizedEngine = normalizeBrowserEngine(engine);
    if (normalizedEngine === "duckduckgo" && /(^|\.)duckduckgo\.com$/i.test(url.hostname)) {
      const redirected = url.searchParams.get("uddg");
      return redirected ? canonicalHttpUrl(redirected) : "";
    }
    if (normalizedEngine === "google" && /(^|\.)google\.[a-z.]+$/i.test(url.hostname)) {
      const redirected = url.searchParams.get("q") || url.searchParams.get("url");
      return redirected ? canonicalHttpUrl(redirected) : "";
    }
    if (["duckduckgo.com", "www.bing.com", "bing.com"].includes(url.hostname.toLowerCase())) return "";
    return canonicalHttpUrl(url.toString());
  } catch {
    return "";
  }
}

function canonicalHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function sanitizeExternalText(value, maxChars) {
  return String(value || "")
    .replace(/^\s*(?:BEGIN|END)[ _-]*(?:UNTRUSTED|EXTERNAL)[ _-]*CONTENT.*$/gim, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxChars);
}

function normalizeBraveBaseUrl(value) {
  const text = String(value || DEFAULT_BRAVE_BASE_URL).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(text);
  } catch {
    return DEFAULT_BRAVE_BASE_URL;
  }
  return ["http:", "https:"].includes(url.protocol) ? url.toString().replace(/\/+$/, "") : DEFAULT_BRAVE_BASE_URL;
}

function assertSafeBraveBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && isLocalOrPrivateHost(url.hostname)) return;
  throw new Error("Brave Search base URL must use HTTPS unless it targets a loopback or private-network proxy.");
}

function isLocalOrPrivateHost(value) {
  const host = String(value || "").replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
}

function normalizeBrowserEngine(value) {
  const engine = String(value || "duckduckgo").toLowerCase();
  return ["duckduckgo", "bing", "google"].includes(engine) ? engine : "duckduckgo";
}

function requiredQuery(value) {
  const query = String(value || "").trim();
  if (!query) throw new Error("query is required.");
  return query.slice(0, 1000);
}

function normalizeFreshness(value) {
  const freshness = String(value || "").toLowerCase();
  if (!["day", "week", "month", "year"].includes(freshness)) throw new Error("freshness must be day, week, month, or year.");
  return freshness;
}

function normalizeDate(value, name) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }
  return text;
}

function normalizeCode(value, min, max) {
  const text = String(value || "").trim();
  return text.length >= min && text.length <= max ? text.toUpperCase() : "";
}

function isoDate(value) {
  const text = String(value || "").trim();
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function appendParam(url, name, value) {
  if (value) url.searchParams.set(name, value);
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback;
}

function boundedErrorText(value) {
  return sanitizeExternalText(value, 1000) || "empty response";
}

function readCache(key, ttlMinutes) {
  if (ttlMinutes <= 0) return null;
  const item = searchCache.get(key);
  if (!item || item.expiresAt <= Date.now()) {
    searchCache.delete(key);
    return null;
  }
  return structuredClone(item.value);
}

function writeCache(key, value, ttlMinutes) {
  if (ttlMinutes <= 0) return;
  searchCache.set(key, { value: structuredClone(value), expiresAt: Date.now() + ttlMinutes * 60_000 });
  while (searchCache.size > MAX_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value);
}
