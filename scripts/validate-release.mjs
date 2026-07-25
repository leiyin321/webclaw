import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const readText = (path) => readFileSync(resolve(root, path), "utf8");
const manifest = JSON.parse(readText("manifest.json"));
const errors = [];

function requireCondition(condition, message) {
  if (!condition) errors.push(message);
}

requireCondition(manifest.manifest_version === 3, "manifest_version must be 3");
requireCondition(/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(manifest.version || "")), "manifest version is invalid");
requireCondition(
  readText("CHANGELOG.md").includes(`## ${manifest.version}`),
  `CHANGELOG.md must contain a ${manifest.version} section`
);
requireCondition(Number(manifest.minimum_chrome_version) >= 135, "minimum_chrome_version must be 135 or newer");
requireCondition(!Array.isArray(manifest.host_permissions), "required host_permissions must not be present");
requireCondition(!manifest.permissions?.includes("activeTab"), "unused activeTab permission must not be present");
requireCondition(
  Array.isArray(manifest.optional_host_permissions) &&
    manifest.optional_host_permissions.includes("http://*/*") &&
    manifest.optional_host_permissions.includes("https://*/*"),
  "optional HTTP(S) host permissions are missing"
);
requireCondition(!Array.isArray(manifest.content_scripts), "global content_scripts must not be present");

const runtimeFiles = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {})
].filter(Boolean);
for (const path of runtimeFiles) {
  requireCondition(existsSync(resolve(root, path)), `manifest file is missing: ${path}`);
}

function validatePng(path, expectedWidth, expectedHeight) {
  const file = resolve(root, path);
  requireCondition(existsSync(file), `PNG asset is missing: ${path}`);
  if (!existsSync(file)) return;
  const data = readFileSync(file);
  const isPng = data.length >= 24 && data.subarray(1, 4).toString("ascii") === "PNG";
  requireCondition(isPng, `asset is not PNG: ${path}`);
  if (!isPng) return;
  requireCondition(
    data.readUInt32BE(16) === expectedWidth && data.readUInt32BE(20) === expectedHeight,
    `asset dimensions must be ${expectedWidth}x${expectedHeight}: ${path}`
  );
}

for (const [sizeText, path] of Object.entries(manifest.icons || {})) {
  const expected = Number(sizeText);
  validatePng(path, expected, expected);
}

for (const [path, width, height] of [
  ["assets/store/screenshot-chat-1280x800.png", 1280, 800],
  ["assets/store/screenshot-approval-1280x800.png", 1280, 800],
  ["assets/store/promo-small-440x280.png", 440, 280],
  ["assets/store/marquee-1400x560.png", 1400, 560]
]) {
  validatePng(path, width, height);
}

for (const path of ["PRIVACY.md", "SECURITY.md", "OAUTH.md", "STORE_LISTING.md", "LICENSE"]) {
  requireCondition(existsSync(resolve(root, path)), `release document is missing: ${path}`);
}

const oauthClients = readText("src/oauth-clients.js");
const runtimeJavaScriptSource = readdirSync(resolve(root, "src"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => readText(`src/${name}`))
  .join("\n");
const source = runtimeJavaScriptSource;
const codexCliClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const githubCopilotClientId = "Iv1.b507a08c87ecfe98";
requireCondition(
  oauthClients.includes(`codex: "${codexCliClientId}"`),
  "the temporary Codex CLI compatibility client ID must remain centralized in src/oauth-clients.js"
);
requireCondition(
  source.split(codexCliClientId).length - 1 === 1,
  "the temporary Codex CLI client ID must appear exactly once in runtime source"
);
requireCondition(
  oauthClients.includes(`githubCopilot: "${githubCopilotClientId}"`),
  "the temporary GitHub Copilot compatibility client ID must remain centralized in src/oauth-clients.js"
);
requireCondition(
  source.split(githubCopilotClientId).length - 1 === 1,
  "the temporary GitHub Copilot client ID must appear exactly once in runtime source"
);
requireCondition(
  source.split('type === "github-copilot-oauth" && !String(config.clientId || "").trim()').length - 1 === 2,
  "empty GitHub Copilot client IDs must be backfilled in both background and Settings normalization"
);
requireCondition(!/client(?:_|)secret\s*:/i.test(oauthClients), "OAuth client secrets must not be configured in the extension");
requireCondition(!/\bnew\s+Function\s*\(/.test(runtimeJavaScriptSource), "runtime code must not contain new Function");
requireCondition(!/\beval\s*\(/.test(runtimeJavaScriptSource), "runtime code must not contain eval");
requireCondition(
  source.includes('const QIYEWECHAT_NOTIFICATION_TOOL_NAME = "qiyewechat_notification"') &&
    source.includes('const LEGACY_QIYEWECHAT_NOTIFICATION_TOOL_NAME = "send_wecom_message"') &&
    source.includes("canonicalizeToolCall(hydrateToolArgs(toolObject, objects))") &&
    source.includes("title: definition.name === QIYEWECHAT_NOTIFICATION_TOOL_NAME"),
  "enterprise WeChat Tool canonical-name handling is missing"
);
requireCondition(
  readText("README.md").includes("Tool name 与 Display name 均固定为 `qiyewechat_notification`") &&
    readText("README.en.md").includes("Tool name and Display name are both fixed to `qiyewechat_notification`") &&
    readText("STORE_LISTING.md").includes("Tool name 与 Display name 使用同一规范名称") &&
    source.includes("The canonical Tool name and Display name are both qiyewechat_notification"),
  "enterprise WeChat Tool canonical name is not synchronized across documentation and default knowledge"
);
requireCondition(
  source.includes("webclawOperationApprovalGrants") && source.includes("schedule-run-js:"),
  "exact Schedule operation approvals are missing"
);
requireCondition(
  source.includes("webclawChannelAuthorizationRoutes") && source.includes("authorization_challenge"),
  "Channel authorization routing is missing"
);
requireCondition(
  source.includes('response !== "0" && !/^\\d{6}$/.test(response)') &&
    source.includes("100000 + randomValue % 900000") &&
    source.includes("直接回复 ${code} 表示授权，回复 0 表示拒绝。") &&
    !source.includes("[A-Z0-9]{6}"),
  "Channel approval replies must use a six-digit numeric code to allow and 0 to deny"
);
requireCondition(
  source.includes("WEBCLAW_CODEX_DEVICE_ALARM") && source.includes("openDeviceAuthorizationPopup"),
  "background Codex device authorization completion is missing"
);
requireCondition(
  source.includes("WEBCLAW_GITHUB_COPILOT_DEVICE_ALARM") &&
    source.includes("githubCopilotDevicePollRequests") &&
    source.includes("startGitHubCopilotDeviceLogin(message.providerId, {") &&
    source.includes('openMode: "popup"'),
  "background GitHub Copilot device authorization completion is missing"
);
requireCondition(
  source.includes("previousName === defaultProviderName(previousType)") &&
    source.includes("name: shouldGenerateName ? defaultProviderName(nextType) : previousName"),
  "Provider type changes must generate a matching default name without overwriting custom names"
);
requireCondition(
  source.includes('"set_active_provider"') &&
    source.includes('target: "provider"') &&
    source.includes("activeProviderId: String(settings.activeProviderId") &&
    source.includes("Cannot restore missing Provider"),
  "controlled active Provider switching and rollback are missing"
);
requireCondition(
  source.includes("webclaw-default-manual: 0.4.7-r1") &&
    source.includes("REPLACEABLE_DEFAULT_KNOWLEDGE_MANUAL_HASHES") &&
    source.includes("expectedVersion: existing.entry.version") &&
    source.includes('"webclaw", "manual", "operations", "0.4.7"'),
  "versioned default knowledge manual migration is missing"
);
const sidepanelHtml = readText("src/sidepanel.html");
requireCondition(!sidepanelHtml.includes("<h2>Notifications</h2>"), "global Notifications settings are still present");

const htmlIds = [...sidepanelHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateHtmlIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
requireCondition(duplicateHtmlIds.length === 0, `side panel has duplicate IDs: ${[...new Set(duplicateHtmlIds)].join(", ")}`);
const sidepanelSelectors = [...readText("src/sidepanel.js").matchAll(/querySelector\("#([^"]+)"\)/g)].map((match) => match[1]);
const missingSelectors = [...new Set(sidepanelSelectors.filter((id) => !htmlIds.includes(id)))];
requireCondition(missingSelectors.length === 0, `side panel selectors are missing from HTML: ${missingSelectors.join(", ")}`);

const backgroundToolBlock = readText("src/background.js").match(
  /const BUILTIN_TOOLS = \[([\s\S]*?)\n\];\n\nconst FALLBACK_MODEL_OPTIONS/
)?.[1] || "";
const panelToolBlock = readText("src/sidepanel.js").match(/const BUILTIN_TOOLS = \[([\s\S]*?)\n\]\.map/)?.[1] || "";
const backgroundTools = new Set([...backgroundToolBlock.matchAll(/^    name:\s*"([^"]+)"/gm)].map((match) => match[1]));
const panelTools = new Set([...panelToolBlock.matchAll(/^  \["([^"]+)"/gm)].map((match) => match[1]));
const mismatchedTools = [
  ...[...backgroundTools].filter((name) => !panelTools.has(name)),
  ...[...panelTools].filter((name) => !backgroundTools.has(name))
];
requireCondition(backgroundTools.size > 0 && mismatchedTools.length === 0, `built-in Tool registries differ: ${mismatchedTools.join(", ")}`);

if (errors.length > 0) {
  console.error("Release validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Release validation passed for WebClaw ${manifest.version}.`);
