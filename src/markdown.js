const SAFE_PROTOCOLS = new Set(["", "http:", "https:", "mailto:", "tel:"]);

export function parseMarkdown(source) {
  const text = String(source || "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const frontMatter = {};
  let index = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) {
      for (const line of lines.slice(1, end)) {
        const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
        if (match) frontMatter[match[1]] = parseFrontMatterValue(match[2]);
      }
      index = end + 1;
    }
  }

  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;
  let table = null;
  let quote = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph.splice(0) });
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushTable = () => {
    if (table) blocks.push(table);
    table = null;
  };
  const flushQuote = () => {
    if (quote.length) blocks.push({ type: "blockquote", lines: quote.splice(0) });
  };

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (code) {
      if (line.startsWith("```")) {
        blocks.push({ type: "code", language: code.language, content: code.lines.join("\n") });
        code = null;
      } else code.lines.push(line);
      continue;
    }
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      flushParagraph(); flushList(); flushTable(); flushQuote();
      code = { language: fence[1] || "", lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushParagraph(); flushList(); flushTable(); flushQuote();
      continue;
    }
    const blockquote = line.match(/^\s{0,3}>\s?(.*)$/);
    if (blockquote) {
      flushParagraph(); flushList(); flushTable();
      quote.push(blockquote[1]);
      continue;
    }
    flushQuote();
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph(); flushList(); flushTable();
      const textValue = stripInlineMarkdown(heading[2]);
      blocks.push({ type: "heading", level: heading[1].length, text: textValue, raw: heading[2] });
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph(); flushList(); flushTable();
      blocks.push({ type: "separator" });
      continue;
    }
    const task = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (task || unordered || ordered) {
      flushParagraph(); flushTable();
      const orderedList = Boolean(ordered);
      if (!list || list.ordered !== orderedList) {
        flushList();
        list = { type: "list", ordered: orderedList, items: [] };
      }
      list.items.push({
        checked: task ? task[1].toLowerCase() === "x" : undefined,
        text: task ? task[2] : ordered ? ordered[2] : unordered[1]
      });
      continue;
    }
    const tableRow = isTableRow(line);
    if (table && tableRow) {
      table.rows.push(splitTableRow(line));
      continue;
    }
    if (!table && tableRow) {
      const cells = splitTableRow(line);
      const separatorCells = splitTableRow(lines[index + 1] || "");
      if (isTableSeparator(separatorCells, cells.length)) {
        flushParagraph(); flushList();
        table = {
          type: "table",
          header: cells,
          rows: [],
          alignments: separatorCells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "")
        };
        index += 1;
        continue;
      }
    }
    flushList(); flushTable();
    paragraph.push(line);
  }
  if (code) blocks.push({ type: "code", language: code.language, content: code.lines.join("\n") });
  flushParagraph(); flushList(); flushTable(); flushQuote();
  return { frontMatter, blocks, lines, text };
}

export function renderMarkdown(source, options = {}) {
  const document = typeof source === "string" ? parseMarkdown(source) : source;
  const body = renderMarkdownFragment(document, options);
  const title = escapeHtml(options.title || findTitle(document) || "Markdown document");
  const frontMatter = Object.keys(document.frontMatter || {}).length
    ? `<details class="front-matter"><summary>Front Matter</summary><pre>${escapeHtml(JSON.stringify(document.frontMatter, null, 2))}</pre></details>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${MARKDOWN_CSS}</style></head><body><main>${frontMatter}${body}</main></body></html>`;
}

export function renderMarkdownFragment(source, options = {}) {
  const document = typeof source === "string" ? parseMarkdown(source) : source;
  return document.blocks.map((block) => renderBlock(block, options)).join("\n");
}

export function markdownOutline(documentOrSource) {
  const document = typeof documentOrSource === "string" ? parseMarkdown(documentOrSource) : documentOrSource;
  return document.blocks.filter((block) => block.type === "heading").map((block, index) => ({
    id: `heading-${index + 1}`,
    level: block.level,
    text: block.text
  }));
}

export function markdownToText(documentOrSource) {
  const document = typeof documentOrSource === "string" ? parseMarkdown(documentOrSource) : documentOrSource;
  return document.blocks.map((block) => {
    if (block.type === "heading") return `${"#".repeat(block.level)} ${block.text}`;
    if (block.type === "paragraph") return block.lines.join("\n");
    if (block.type === "code") return `\n\`\`\`${block.language}\n${block.content}\n\`\`\``;
    if (block.type === "blockquote") return block.lines.map((line) => `> ${line}`).join("\n");
    if (block.type === "list") return block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : "-"} ${item.text}`).join("\n");
    if (block.type === "table") return [block.header, ...block.rows].map((row) => `| ${row.join(" | ")} |`).join("\n");
    if (block.type === "separator") return "---";
    return "";
  }).join("\n\n");
}

function renderBlock(block, options = {}) {
  if (block.type === "heading") {
    const id = options.headingIds === false ? "" : ` id="${slugify(block.text)}"`;
    return `<h${block.level}${id}>${renderInline(block.raw || block.text, options)}</h${block.level}>`;
  }
  if (block.type === "paragraph") return `<p>${renderInline(block.lines.join("\n"), options).replace(/\n/g, "<br>\n")}</p>`;
  if (block.type === "code") return `<pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.content)}</code></pre>`;
  if (block.type === "blockquote") return `<blockquote>${renderInline(block.lines.join("\n"), options).replace(/\n/g, "<br>\n")}</blockquote>`;
  if (block.type === "separator") return "<hr>";
  if (block.type === "list") {
    const tag = block.ordered ? "ol" : "ul";
    return `<${tag}>${block.items.map((item) => `<li>${item.checked === undefined ? "" : `<input type="checkbox" disabled ${item.checked ? "checked" : ""}> `}${renderInline(item.text, options)}</li>`).join("")}</${tag}>`;
  }
  if (block.type === "table") {
    const head = `<thead><tr>${block.header.map((cell, index) => `<th${alignment(block.alignments?.[index])}>${renderInline(cell, options)}</th>`).join("")}</tr></thead>`;
    const rows = block.rows.map((row) => `<tr>${row.map((cell, index) => `<td${alignment(block.alignments?.[index])}>${renderInline(cell, options)}</td>`).join("")}</tr>`).join("");
    return `<table>${head}<tbody>${rows}</tbody></table>`;
  }
  return "";
}

function renderInline(value, options = {}) {
  const source = String(value || "");
  const tokenPattern = /(`[^`\n]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(tokenPattern)) {
    output += renderInlineEmphasis(source.slice(cursor, match.index));
    output += renderInlineToken(match[0], options);
    cursor = Number(match.index) + match[0].length;
  }
  output += renderInlineEmphasis(source.slice(cursor));
  return output;
}

function renderInlineEmphasis(value) {
  let output = escapeHtml(value);
  output = output.replace(/`([^`]+)`/g, "<code>$1</code>");
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  output = output.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  output = output.replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>");
  return output;
}

function renderInlineToken(token, options) {
  if (token.startsWith("`")) return `<code>${escapeHtml(token.slice(1, -1))}</code>`;
  const image = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
  if (image) {
    const alt = image[1] || "image";
    return options.allowImages === false
      ? `<a href="${safeUrl(image[2], options)}" target="_blank" rel="noopener noreferrer">[Image: ${escapeHtml(alt)}]</a>`
      : `<img alt="${escapeHtml(alt)}" src="${safeUrl(image[2], options)}">`;
  }
  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) return `<a href="${safeUrl(link[2], options)}" target="_blank" rel="noopener noreferrer">${renderInlineEmphasis(link[1])}</a>`;
  return renderInlineEmphasis(token);
}

function stripInlineMarkdown(value) {
  return String(value || "").replace(/[`*_~]/g, "").replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, "$1");
}

function splitTableRow(line) {
  const value = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return value.split("|").map((cell) => cell.trim());
}

function isTableRow(line) {
  const value = String(line || "");
  return value.includes("|") && splitTableRow(value).length >= 2;
}

function isTableSeparator(cells, expectedColumns) {
  return cells.length === expectedColumns && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseFrontMatterValue(value) {
  const text = String(value || "").trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  return text.replace(/^['"]|['"]$/g, "");
}

function findTitle(document) {
  return document.blocks.find((block) => block.type === "heading")?.text || "";
}

function slugify(value) {
  return String(value || "heading").toLowerCase().trim().replace(/[^\w\u4e00-\u9fff -]/g, "").replace(/\s+/g, "-") || "heading";
}

function safeUrl(value, options = {}) {
  const raw = String(value || "").trim();
  if (options.allowRelativeLinks === false && !/^(?:https?:|mailto:|tel:|#)/i.test(raw)) return "#";
  try {
    const parsed = new URL(raw, "https://webclaw.invalid/");
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return "#";
    return escapeHtml(raw);
  } catch {
    return "#";
  }
}

function alignment(value) {
  return value ? ` style="text-align:${escapeHtml(value)}"` : "";
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

const MARKDOWN_CSS = `:root{color-scheme:light dark}body{margin:0;background:#f6f7f9;color:#1f2937;font:16px/1.65 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{box-sizing:border-box;max-width:900px;margin:0 auto;padding:40px 48px;background:#fff;min-height:100vh}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.4em 0 .55em}h1{font-size:2em}h2{font-size:1.55em}h3{font-size:1.25em}p{margin:.8em 0}pre{padding:14px 16px;overflow:auto;border-radius:6px;background:#111827;color:#f9fafb}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}p code,li code{padding:2px 4px;border-radius:3px;background:#eef0f3;color:#111827}blockquote{margin:1em 0;padding-left:16px;border-left:3px solid #9ca3af;color:#4b5563}table{border-collapse:collapse;width:100%;margin:1em 0}th,td{border:1px solid #d1d5db;padding:7px 9px;text-align:left;vertical-align:top}th{background:#f3f4f6}img{max-width:100%}.front-matter{margin-bottom:20px;padding:8px 12px;background:#f3f4f6}@media(prefers-color-scheme:dark){body{background:#111827;color:#e5e7eb}main{background:#1f2937}p code,li code,th,.front-matter{background:#374151;color:#f9fafb}th,td{border-color:#4b5563}blockquote{color:#cbd5e1}}@media(max-width:700px){main{padding:24px 18px}}`;
