import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { markdownToText, parseMarkdown, renderMarkdownFragment } from "../src/markdown.js";

const rendered = renderMarkdownFragment(`# Result

**bold**, *italic*, ~~removed~~, and \`code\`.

> quoted text

- first
- [x] complete

| Name | Value |
| --- | ---: |
| test | 1 |

\`\`\`js
const ok = true;
\`\`\`

[safe](https://example.com/path)`, { allowImages: false, headingIds: false });

assert.match(rendered, /^<h1>Result<\/h1>/);
assert.doesNotMatch(rendered, /<h1 id=/);
assert.match(rendered, /<strong>bold<\/strong>/);
assert.match(rendered, /<em>italic<\/em>/);
assert.match(rendered, /<del>removed<\/del>/);
assert.match(rendered, /<blockquote>quoted text<\/blockquote>/);
assert.match(rendered, /<input type="checkbox" disabled checked>/);
assert.match(rendered, /<table>/);
assert.match(rendered, /<pre><code class="language-js">const ok = true;<\/code><\/pre>/);
assert.match(rendered, /rel="noopener noreferrer"/);

const escaped = renderMarkdownFragment(`<script>alert(1)</script>

[unsafe](javascript:alert(1))

![remote](https://example.com/tracker.png)

[relative](settings.html)`, { allowImages: false, allowRelativeLinks: false, headingIds: false });

assert.doesNotMatch(escaped, /<script>/);
assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(escaped, /href="#"/);
assert.doesNotMatch(escaped, /<img/);
assert.match(escaped, /\[Image: remote\]/);
assert.equal((escaped.match(/href="#"/g) || []).length, 2);

const protectedInline = renderMarkdownFragment("`**literal**` and [underscored](https://example.com/a_b_c)");
assert.match(protectedInline, /<code>\*\*literal\*\*<\/code>/);
assert.doesNotMatch(protectedInline, /<code><strong>/);
assert.match(protectedInline, /href="https:\/\/example\.com\/a_b_c"/);

const plainPipe = parseMarkdown("Use A | B for fallback");
assert.deepEqual(plainPipe.blocks.map((block) => block.type), ["paragraph"]);
assert.match(renderMarkdownFragment("Use A | B for fallback"), /<p>Use A \| B for fallback<\/p>/);
assert.equal(markdownToText("> first line\n> second line"), "> first line\n> second line");

const sidepanel = readFileSync(new URL("../src/sidepanel.js", import.meta.url), "utf8");
const sidepanelCss = readFileSync(new URL("../src/sidepanel.css", import.meta.url), "utf8");
assert.match(sidepanel, /import \{ renderMarkdownFragment \} from "\.\/markdown\.js"/);
assert.equal((sidepanel.match(/messageNodeSource\(activeAssistantNode\)/g) || []).length, 2);
assert.match(sidepanel, /allowImages: false/);
assert.match(sidepanel, /allowRelativeLinks: false/);
assert.match(sidepanel, /node\.classList\.contains\("assistant"\)/);
assert.match(sidepanel, /STREAM_RENDER_INTERVAL_MS/);
assert.match(sidepanel, /STREAM_PERSIST_DEBOUNCE_MS/);
assert.match(sidepanel, /streaming: true/);
assert.match(sidepanelCss, /\.message\.assistant pre/);
assert.match(sidepanelCss, /\.message\.assistant table/);

console.log("Markdown rendering tests passed.");
