# Chat Markdown Rendering

The Side Panel renders assistant responses as Markdown while preserving the existing Agent message model and execution UI.

## Scope

Only messages with the `assistant` role use Markdown rendering. User and Channel messages remain text, and Tool calls, Tool results, Plans, and Task execution views remain structured/plain text. This prevents JSON Tool arguments, errors, and progress state from being interpreted as user-interface markup.

The same behavior applies to streamed assistant deltas and the final response. The UI keeps the original source string separately from the rendered DOM, so a new delta is appended to Markdown source rather than to `textContent` generated from HTML.

Streaming updates are rendered at a bounded interval and chat-history persistence is debounced. The final response always cancels pending work, renders the complete Markdown source, and queues the latest session snapshot immediately. This avoids reparsing and storing the full response for every token-sized delta.

Supported chat syntax includes:

- headings, bold, italic, and strikethrough;
- ordered and unordered lists, including disabled task checkboxes;
- blockquotes and horizontal separators;
- inline code and fenced code blocks;
- pipe tables and alignment markers;
- links with `http`, `https`, `mailto`, `tel`, and fragment targets.

This is the shared local parser in `src/markdown.js`, not a remote Markdown service or a new runtime dependency. Document preview continues to use the same parser with document-specific options. Inline code and link destinations are tokenized before emphasis is rendered, and a pipe table is recognized only when its header is followed by a valid delimiter row.

## Security boundary

Chat Markdown is rendered into a temporary `DOMParser` document and cloned into the message node. Raw HTML is escaped before inline Markdown replacements. The chat renderer disables relative links, which prevents model output from navigating to extension-relative resources, and rejects unsafe URL schemes such as `javascript:`.

Remote images are not loaded automatically in chat. An image syntax is displayed as an inert link labeled `[Image: ...]`; this avoids tracking requests and unexpected network access from model output. Document preview may use its own local-resource policy and must not be treated as equivalent to chat rendering.

The renderer does not execute scripts, event attributes, HTML forms, or embedded page content. The existing Content Security Policy remains in force.

## Layout behavior

The chat stylesheet keeps Markdown compact for a narrow Side Panel. Code blocks and tables scroll inside the message, long URLs wrap, and dark mode supplies matching code, table, quote, and link colors. The renderer does not change Tool trajectory persistence or the model-facing conversation history; Markdown source remains plain text in stored messages and model context.

## Verification

`scripts/test-markdown.mjs` checks supported syntax, protected inline code and URL underscores, table delimiter requirements, blockquote text preservation, HTML escaping, unsafe and relative link blocking, remote-image suppression, and the Side Panel integration. `scripts/test-agent-loop.sh` includes this test in the full Agent regression suite.
