import assert from "node:assert/strict";
import {
  clearWebSearchCache,
  isWebSearchAbort,
  normalizeBrowserSearchResults,
  normalizeWebSearchConfig,
  resolveWebSearchProvider,
  runBraveWebSearch,
  shouldFallbackFromBrave
} from "../src/web-search.js";

assert.equal(resolveWebSearchProvider({ provider: "auto" }), "browser");
assert.equal(resolveWebSearchProvider({ provider: "auto", braveApiKey: "secret" }), "brave");
assert.equal(resolveWebSearchProvider({ provider: "browser", braveApiKey: "secret" }), "browser");
assert.equal(normalizeWebSearchConfig({ maxResults: 99, timeoutSeconds: 0 }).maxResults, 10);
assert.equal(isWebSearchAbort(new DOMException("Aborted", "AbortError")), true);
assert.equal(isWebSearchAbort(new Error("network failed")), false);
assert.equal(shouldFallbackFromBrave(new Error("network failed"), null, true), true);
assert.equal(shouldFallbackFromBrave(new DOMException("Aborted", "AbortError"), null, true), false);

const calls = [];
const mockFetch = async (url, init) => {
  calls.push({ url, init });
  return new Response(JSON.stringify({
    web: {
      results: [{
        title: "Example result",
        url: "https://example.com/article#section",
        description: "A useful result.",
        page_age: "2026-08-10T12:00:00Z",
        profile: { long_name: "Example" }
      }]
    }
  }), { status: 200, headers: { "content-type": "application/json" } });
};

clearWebSearchCache();
const config = { provider: "brave", braveApiKey: "test-key", cacheTtlMinutes: 15, maxResults: 5 };
const args = {
  query: "web search test",
  count: 3,
  country: "us",
  language: "en",
  freshness: "week"
};
const first = await runBraveWebSearch(config, args, { fetch: mockFetch });
assert.equal(first.kind, "results");
assert.equal(first.provider, "brave");
assert.equal(first.results[0].url, "https://example.com/article");
assert.equal(first.results[0].published, "2026-08-10");
assert.equal(first.externalContent.untrusted, true);
assert.equal(calls[0].init.headers["X-Subscription-Token"], "test-key");
assert.match(calls[0].url, /count=3/);
assert.match(calls[0].url, /country=US/);
assert.match(calls[0].url, /search_lang=en/);
assert.match(calls[0].url, /freshness=week/);

const cached = await runBraveWebSearch(config, args, { fetch: mockFetch });
assert.equal(cached.cached, true);
assert.equal(calls.length, 1);

await assert.rejects(
  () => runBraveWebSearch({ provider: "brave" }, { query: "missing key" }, { fetch: mockFetch }),
  /API key is not configured/
);
const stopped = new AbortController();
stopped.abort();
await assert.rejects(
  () => runBraveWebSearch(config, { query: "stopped" }, { fetch: mockFetch, signal: stopped.signal }),
  (error) => error.name === "AbortError"
);
await assert.rejects(
  () => runBraveWebSearch(config, { query: "dates", date_before: "2026-08-10" }, { fetch: mockFetch }),
  /date_before requires date_after/
);
await assert.rejects(
  () => runBraveWebSearch({ ...config, braveBaseUrl: "http://public.example" }, { query: "unsafe proxy" }, { fetch: mockFetch }),
  /must use HTTPS/
);

const browserResults = normalizeBrowserSearchResults({
  interactive: [
    { tag: "a", text: "Redirected result", href: "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpage%23part" },
    { tag: "a", text: "DuckDuckGo navigation", href: "https://duckduckgo.com/settings" }
  ]
}, "duckduckgo", 5);
assert.deepEqual(browserResults, [{ title: "Redirected result", url: "https://example.org/page" }]);

console.log("Web search tests passed.");
