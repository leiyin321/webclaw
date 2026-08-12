import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  builtinToolDefinition,
  builtinToolDefinitions,
  builtinToolUiDefinitions
} from "../src/tool-registry.js";

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
const expectedOptionalPermissions = [
  "bookmarks", "clipboardRead", "clipboardWrite", "downloads", "history", "notifications", "sessions", "tabGroups"
];
requireCondition(
  expectedOptionalPermissions.every((permission) => manifest.optional_permissions?.includes(permission)),
  "optional browser Tool permissions are missing from optional_permissions"
);
requireCondition(
  expectedOptionalPermissions.every((permission) => !manifest.permissions?.includes(permission)),
  "optional browser Tool permissions must not become required permissions"
);
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
  ...(manifest.sandbox?.pages || []),
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
const runtimeJavaScriptSource = recursiveFiles(resolve(root, "src"))
  .filter((path) => path.endsWith(".js"))
  .map((path) => readFileSync(path, "utf8"))
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
requireCondition(!/\bimport\s*\(/.test(readText("src/document-service.js")), "document service worker code must not use dynamic import()");
requireCondition(manifest.sandbox?.pages?.includes("src/document-engine-sandbox.html"), "document engine page must be declared as a manifest sandbox page");
requireCondition(manifest.sandbox?.pages?.includes("src/script-runner-sandbox.html"), "run_js script runner must be declared as a manifest sandbox page");
requireCondition(
  readText("src/script-runner-sandbox.html").includes("connect-src 'none'") &&
    readText("src/script-runner-sandbox.html").includes("worker-src blob:") &&
    readText("src/script-runner-sandbox.js").includes("new Worker(url)") &&
    readText("src/script-runner-sandbox.js").includes("worker.terminate()") &&
    readText("src/script-runner-sandbox.js").includes('runtime === "extension"') &&
    !readText("src/script-runner-sandbox.js").includes("page: Object.freeze") &&
    readText("src/script-runner-offscreen.js").includes("WEBCLAW_SCRIPT_SANDBOX_RPC") &&
    source.includes("handleRunJsRpcMessage") &&
    source.includes("runJsRpcMethodAllowed") &&
    source.includes('runtime === "compute"') &&
    source.includes('normalizeRunJsRuntime(args.runtime) !== "compute" && !settings.allowUnsafePageJs') &&
    source.includes('if (runtime !== "compute") {') &&
    source.includes('if (run.runtime === "extension") activeScriptRuns.set') &&
    source.includes('runtime === "page-main" ? "MAIN" : "USER_SCRIPT"') &&
    source.includes("waitForPageJavaScript(") &&
    source.includes("run_js inline code exceeds the 200,000 character limit") &&
    source.includes("Page script result exceeds the 2,000,000 byte limit") &&
    source.includes("Page navigated after run_js approval") &&
    !source.includes("truncateText(code, 12000)") &&
    source.includes("missingPermissions.length === 0") &&
    source.includes('String(expected.details || "") === String(actual.details || "")') &&
    source.includes("JSON.stringify(uniqueStrings(expected.permissions))") &&
    !source.includes("RUN_JS_LEVELS") &&
    !source.includes("normalizeRunJsLevel") &&
    !source.includes('else if (path === "page.run")') &&
    source.includes("Script RPC call limit exceeded"),
  "run_js runtime isolation or capability-scoped RPC boundary is incomplete"
);
requireCondition(readText("src/document-engine-sandbox.html").includes("../build/document/document-sandbox.js"), "document sandbox page must load the packaged sandbox bundle");
requireCondition(existsSync(resolve(root, "build/document/document-sandbox.js")), "document sandbox bundle is missing; run npm run build:documents");
if (existsSync(resolve(root, "build/document"))) {
  const documentBundles = readdirSync(resolve(root, "build/document")).filter((name) => name.endsWith(".js"));
  requireCondition(documentBundles.join(",") === "document-sandbox.js", "document engines must be packaged only in document-sandbox.js");
  const sandboxBundle = existsSync(resolve(root, "build/document/document-sandbox.js")) ? readText("build/document/document-sandbox.js") : "";
  requireCondition(!/\bimport\s*\(/.test(sandboxBundle), "document sandbox bundle must not contain dynamic imports");
}
requireCondition(
  builtinToolDefinition("qiyewechat_notification")?.name === "qiyewechat_notification" &&
    builtinToolDefinition("send_wecom_message") === null &&
    source.includes("canonicalizeToolCall(hydrateToolArgs(toolObject, objects))") &&
    source.includes("[QIYEWECHAT_NOTIFICATION_TOOL_NAME, WEB_SEARCH_TOOL_NAME].includes(definition.name)"),
  "enterprise WeChat Tool canonical-name handling is missing"
);
const removedBuiltinToolNames = [
  "get_page_context", "click", "type_text", "navigate", "chrome_api", "wait", "send_wecom_message",
  "browser_clipboard", "fs_mkdir", "fs_move", "fs_delete", "fs_restore", "fs_purge", "fs_empty_trash", "search_web"
];
requireCondition(
  removedBuiltinToolNames.every((name) => builtinToolDefinition(name) === null),
  "removed legacy Tool names must not be restored or aliased"
);
requireCondition(
  readText("README.md").includes("Tool name 与 Display name 均固定为 `qiyewechat_notification`") &&
    readText("README.en.md").includes("Tool name and Display name are both fixed to `qiyewechat_notification`") &&
    readText("STORE_LISTING.md").includes("Tool name 与 Display name 使用同一规范名称") &&
    source.includes("The canonical Tool name and Display name are both qiyewechat_notification"),
  "enterprise WeChat Tool canonical name is not synchronized across documentation and default knowledge"
);
requireCondition(
  builtinToolDefinition("web_search")?.name === "web_search" &&
    builtinToolDefinition("search_web") === null &&
    readText("README.md").includes("Tool name 与 Display name 均固定为 `web_search`") &&
    readText("README.en.md").includes("Tool name and Display name are both fixed to `web_search`") &&
    source.includes("The canonical Tool name and Display name are both web_search"),
  "web_search canonical name and browser fallback documentation are not synchronized"
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
  source.includes("webclaw-default-manual: 0.7.3-r1") &&
    source.includes("REPLACEABLE_DEFAULT_KNOWLEDGE_MANUAL_HASHES") &&
    source.includes("qxBFf1iNGSrbPVRGoSSOQUH8Mu9b6rgnrTBznpwsH1s") &&
    source.includes("qmON25C52Otm3zxd8xOE_dlGJ9DX-j61ECdtgLwChHA") &&
    source.includes("kcQOQB5In4knHBpRgUGlvN7AVp-W6I435HqezmffziU") &&
    source.includes("XAX46BXypQ1LE7DWmgpSqdw78M-Tw_JjPFRkRPSb4yw") &&
    source.includes("04RN_x4Yj49RriWSQGBAn7Wqh1UaDHM0iq395QmQb30") &&
    source.includes("AUoWZDFRlU1yysJ_EojdS8ROqAgFMuvXzZz5yYheR8g") &&
    source.includes("ebvLDmJq-nzX4Kn5D2uASmSHK55uO-X6VMG8Fhg6Rwo") &&
    source.includes("8Q4-Lrp4wlIcHOAUmRZJZXbY-hxxTEOPi4HUEYIWegw") &&
    source.includes("yw9YuL1Vy3_VyqxVFkDzr5e4fJ3Nkhc-Z37vJmeoaOk") &&
    source.includes("t22iHPwq8td1DdSnld0Ey3QPw3A9eaQzClv8D4EfT38") &&
    source.includes("lD_L4uzIxOylcZH0I5DOQISmKUDao_KdL4tyvp0Y0Gw") &&
    source.includes("Fv9ygZ0Hf9ctlpzqjAHk8zAEi6qi2uk40UEca0bxtfY") &&
    source.includes("expectedVersion: existing.entry.version") &&
    source.includes('"webclaw", "manual", "operations", "0.7.3"'),
  "versioned default knowledge manual migration is missing"
);
requireCondition(
  source.includes("REPLACEABLE_WORKSPACE_TEMPLATE_HASHES") &&
    source.includes("SrbAKeFLmbsG8bXtt8nOdNQxIDB6LYO53ytdy5wTGeE") &&
    source.includes("GtOgr9Xxs9JBFQ3ZiFboJgUpLvgju8F2jinIU1YHRmU") &&
    source.includes("RzUjP_Mhrywu7-60z_Ij3Oto3zV37NSuOX-DyCvE_JE") &&
    source.includes("isReplaceableDefault") &&
    source.includes("isLegacyTemplate || isReplaceableDefault"),
  "versioned default workspace Tool instructions migration is missing"
);
requireCondition(
  builtinToolDefinition("browser_clipboard_read")?.optionalPermissions?.join(",") === "clipboardRead" &&
    builtinToolDefinition("browser_clipboard_write")?.optionalPermissions?.join(",") === "clipboardWrite" &&
    builtinToolDefinition("browser_clipboard") === null &&
    source.includes('reasons: ["DOM_SCRAPING", "CLIPBOARD"]'),
  "clipboard read/write Tool permissions must remain separate and use the clipboard offscreen reason"
);
const previewSandboxSource = readText("src/preview-sandbox.js");
requireCondition(
  previewSandboxSource.includes("window.opener || (window.parent !== window ? window.parent : null)") &&
    previewSandboxSource.includes("event.source !== previewHost") &&
    previewSandboxSource.includes("previewHost?.postMessage"),
  "VFS preview sandbox must handshake with its iframe parent or opener"
);
const backgroundSource = readText("src/background.js");
const sidepanelSource = readText("src/sidepanel.js");
const agentRuntimeSource = readText("src/agent-runtime.js");
const agentRunnerSource = readText("src/agent-runner.js");
const agentRecoveryPolicySource = readText("src/agent-recovery-policy.js");
const agentRunStoreSource = readText("src/agent-run-store.js");
const agentToolSchedulerSource = readText("src/agent-tool-scheduler.js");
const agentContextCompactorSource = readText("src/agent-context-compactor.js");
const agentContextProjectorSource = readText("src/agent-context-projector.js");
const agentStateSource = readText("src/agent-state.js");
const agentTaskSupervisorSource = readText("src/agent-task-supervisor.js");
const agentServiceSource = readText("src/agent-service.js");
const agentTerminalOutcomeSource = readText("src/agent-terminal-outcome.js");
requireCondition(
  sidepanelSource.includes("activeAgentStopRequested") &&
    sidepanelSource.includes("updateStopButtonState()") &&
    sidepanelSource.includes("elements.stop.disabled = !running || activeAgentStopRequested") &&
    !sidepanelSource.includes("elements.stop.disabled = !busy"),
  "conversation Stop button must follow the live Agent stream instead of generic busy state"
);
const runAgentSource = backgroundSource.match(
  /async function runAgent\([\s\S]*?\n}\n\nfunction emitAgentEvent/
)?.[0] || "";
requireCondition(
  backgroundSource.includes('from "./agent-runtime.js"') &&
    agentRuntimeSource.includes("planHistoryCompaction") &&
    agentRuntimeSource.includes("normalizeAgentPlan"),
  "the shared Agent Runtime module is missing"
);
requireCondition(
  backgroundSource.includes('from "./agent-terminal-outcome.js"') &&
    backgroundSource.includes("resolveAgentTerminalOutcome(loopResult, steps)") &&
    agentTerminalOutcomeSource.includes('eventType: completed ? "turn_completed" : "turn_failed"') &&
    agentTerminalOutcomeSource.includes('runStatus: completed ? "completed" : "failed"'),
  "Agent terminal failures must not be persisted or emitted as completed turns"
);
requireCondition(
  backgroundSource.includes("queueBackgroundSessionsMutation((sessionsState)") &&
    backgroundSource.includes("return queueBackgroundSessionsMutation((state)"),
  "background Channel and Agent event session writes must use one serialized mutation queue"
);
requireCondition(
  backgroundSource.includes("const PROVIDER_ADAPTER_DEFINITIONS = Object.freeze") &&
    backgroundSource.includes("providerAdapterFor(provider).sample") &&
    backgroundSource.includes("providerAdapterFor(provider).generateText") &&
    backgroundSource.includes("providerProtocolCapabilities(provider)") &&
    !/provider(?:\?|\.)?\.type/.test(runAgentSource),
  "Provider-specific behavior must stay behind the Provider Adapter boundary"
);
requireCondition(
  backgroundSource.includes('from "./agent-model-turn.js"') &&
    backgroundSource.includes("normalizeAgentModelTurn(response") &&
    !/response\.kind/.test(runAgentSource),
  "runAgent must consume the shared ModelTurn contract instead of legacy Provider response kinds"
);
requireCondition(
  backgroundSource.includes('from "./agent-runner.js"') &&
    runAgentSource.includes("const loopResult = await runAgentLoop({") &&
    agentRunnerSource.includes("export async function runAgentLoop") &&
    !agentRunnerSource.includes("dispatchTool(") &&
    !agentRunnerSource.includes("provider.type") &&
    !agentRunnerSource.includes("chrome."),
  "the shared AgentRunner must own loop control without depending on Providers, Tools, or Chrome APIs"
);
requireCondition(
  backgroundSource.includes('from "./agent-recovery-policy.js"') &&
    backgroundSource.includes("createAgentRecoveryPolicy({") &&
    agentRunnerSource.includes("recoveryPolicy?.recoverProtocolError") &&
    agentRecoveryPolicySource.includes("recoverEmptyResponse") &&
    agentRecoveryPolicySource.includes("recoverFinalValidation") &&
    !agentRecoveryPolicySource.includes("dispatchTool(") &&
    !agentRecoveryPolicySource.includes("provider.type") &&
    !agentRecoveryPolicySource.includes("chrome."),
  "Agent recovery policy must remain bounded and independent of Providers, Tools, and Chrome APIs"
);
requireCondition(
  backgroundSource.includes('from "./agent-run-store.js"') &&
    backgroundSource.includes("createAgentRunJournal(agentRunStore") &&
    backgroundSource.includes("checkpointAgentRun(runJournal") &&
    backgroundSource.includes('case "WEBCLAW_LIST_RECOVERABLE_AGENT_RUNS"') &&
    agentRunnerSource.includes('phase: "after_tool"') &&
    agentRunStoreSource.includes('const DATABASE_NAME = "webclaw-agent-runs"') &&
    agentRunStoreSource.includes("listRecoverableRuns") &&
    agentRunStoreSource.includes("claimRun") &&
    agentRunStoreSource.includes("acquireLease") &&
    agentRunStoreSource.includes("assertRunLease") &&
    agentRunStoreSource.includes("classifyAgentRunRecovery") &&
    agentRunStoreSource.includes("toolOperations") &&
    agentRunStoreSource.includes("artifacts") &&
    agentRunStoreSource.includes("deleteRunsForSession") &&
    agentRunStoreSource.includes("SENSITIVE_KEY") &&
    !agentRunStoreSource.includes("dispatchTool("),
  "Agent RunStore must persist redacted events and boundary checkpoints without depending on Tool handlers"
);
requireCondition(
  agentRunnerSource.includes('from "./agent-tool-scheduler.js"') &&
    agentToolSchedulerSource.includes("scheduleExecutionWaves") &&
    agentToolSchedulerSource.includes("operation_state_unknown") &&
    agentToolSchedulerSource.includes("tool_argument_validation_error") &&
    !agentToolSchedulerSource.includes("dispatchTool("),
  "ToolScheduler must own batching, validation, resource scheduling, and operation deduplication"
);
requireCondition(
  agentRunnerSource.includes('from "./agent-state.js"') &&
    agentStateSource.includes("Invalid Agent state transition") &&
    agentRunnerSource.includes('transition("evaluating_progress"') &&
    agentRunnerSource.includes('status: "stuck"'),
  "AgentRunner explicit state transitions and stuck detection are incomplete"
);
requireCondition(
  backgroundSource.includes('from "./agent-task-supervisor.js"') &&
    agentTaskSupervisorSource.includes("createAgentTaskSupervisor") &&
    backgroundSource.includes("taskSupervisor.recordModelStep") &&
    backgroundSource.includes("supervisor.push"),
  "TaskSupervisor is not the shared task-stack mutation boundary"
);
requireCondition(
  backgroundSource.includes('from "./agent-service.js"') &&
    backgroundSource.includes("agentService.run") &&
    agentServiceSource.includes("sessionTails") &&
    agentServiceSource.includes("activeRuns"),
  "AgentService must serialize external runs by session"
);
requireCondition(
  backgroundSource.includes('"opencode": {') &&
    backgroundSource.includes("callOpenCodeZen") &&
    backgroundSource.includes('return "responses"') &&
    backgroundSource.includes('return "messages"') &&
    backgroundSource.includes('return "google"') &&
    readText("src/sidepanel.html").includes('value="opencode"'),
  "OpenCode Zen Provider routing or configuration UI is incomplete"
);
requireCondition(
  backgroundSource.includes("callOpenAICompatibleResponses") &&
    backgroundSource.includes('openAICompatibleApiForConfig(config) === "responses"') &&
    backgroundSource.includes("responseTextFormatForOpenAICompatibleMode") &&
    readText("src/sidepanel.html").includes('id="openaiApiProtocol"') &&
    readText("src/sidepanel.js").includes("normalizeOpenAICompatibleApiProtocol"),
  "OpenAI-compatible Responses API routing or configuration is incomplete"
);
requireCondition(
  builtinToolDefinitions().some((tool) => tool.name === "update_plan") &&
    backgroundSource.includes('case "update_plan"') &&
    backgroundSource.includes('"plan_updated"'),
  "unified Agent planning support is incomplete"
);
requireCondition(
  builtinToolDefinitions().some((tool) => tool.name === "task_push") &&
    builtinToolDefinitions().some((tool) => tool.name === "task_stack") &&
    backgroundSource.includes("runTaskPush") &&
    backgroundSource.includes("validateTaskOutput") &&
    backgroundSource.includes("task_output_validation_error") &&
    backgroundSource.includes("outputSchema: null") &&
    backgroundSource.includes("taskMaxModelSteps") &&
    agentRuntimeSource.includes("normalizeAgentPlan") &&
    readText("src/task-stack.js").includes("export function pushTask") &&
    readText("src/task-stack.js").includes("export function validateTaskOutput") &&
    readText("src/sidepanel.html").includes('id="taskMaxDepth"') &&
    readText("src/sidepanel.html").includes('id="taskMaxTasks"'),
  "ephemeral task-stack runtime or structured result validation is incomplete"
);
requireCondition(
  backgroundSource.includes('emitAgentEvent(options, "task_started"') &&
    backgroundSource.includes('emitAgentEvent(options, "task_progress"') &&
    readText("src/sidepanel.js").includes('appendMessage("task", content') &&
    readText("src/sidepanel.js").includes("finalizeTaskRunView(event)") &&
    readText("src/sidepanel.css").includes(".message.task"),
  "live task execution UI is missing"
);
requireCondition(
  backgroundSource.includes('"context_compacted"') &&
    backgroundSource.includes("compactAgentContext({") &&
    backgroundSource.includes("projectAgentContext({") &&
    agentContextCompactorSource.includes("planHistoryCompaction") &&
    agentContextCompactorSource.includes("toolObservations") &&
    agentContextProjectorSource.includes("systemPrompt") &&
    backgroundSource.includes('case "agent_artifact_read"') &&
    readText("src/sidepanel.js").includes('event.type === "context_compacted"'),
  "context compaction is not wired through the unified Agent event stream"
);
requireCondition(
  backgroundSource.includes('case "WEBCLAW_RESUME_AGENT_RUN"') &&
    backgroundSource.includes("restoreRecoveredChannelApproval") &&
    backgroundSource.includes("resumeStoredRunInBackground") &&
    readText("src/sidepanel.js").includes("checkRecoverableAgentApprovals") &&
    readText("src/sidepanel.js").includes('event.type === "run_state_changed"'),
  "recoverable approvals, background run recovery, or live state UI is incomplete"
);
requireCondition(
  !backgroundSource.includes("TOOL_DECISION_SYSTEM_PROMPT") &&
    !backgroundSource.includes("decideToolExecution") &&
    !backgroundSource.includes("DIRECT_CHAT_SYSTEM_PROMPT"),
  "the removed alternate Tool-decision runtime must not be restored"
);
const sidepanelHtml = readText("src/sidepanel.html");
requireCondition(!sidepanelHtml.includes("<h2>Notifications</h2>"), "global Notifications settings are still present");

const htmlIds = [...sidepanelHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateHtmlIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);
requireCondition(duplicateHtmlIds.length === 0, `side panel has duplicate IDs: ${[...new Set(duplicateHtmlIds)].join(", ")}`);
const sidepanelSelectors = [...readText("src/sidepanel.js").matchAll(/querySelector\("#([^"]+)"\)/g)].map((match) => match[1]);
const missingSelectors = [...new Set(sidepanelSelectors.filter((id) => !htmlIds.includes(id)))];
requireCondition(missingSelectors.length === 0, `side panel selectors are missing from HTML: ${missingSelectors.join(", ")}`);

const backgroundTools = new Set(builtinToolDefinitions().map((tool) => tool.name));
const panelTools = new Set(builtinToolUiDefinitions().map((tool) => tool.name));
const mismatchedTools = [
  ...[...backgroundTools].filter((name) => !panelTools.has(name)),
  ...[...panelTools].filter((name) => !backgroundTools.has(name))
];
requireCondition(backgroundTools.size > 0 && mismatchedTools.length === 0, `built-in Tool registry projections differ: ${mismatchedTools.join(", ")}`);

function recursiveFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(path) : [path];
  });
}

if (errors.length > 0) {
  console.error("Release validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Release validation passed for WebClaw ${manifest.version}.`);
