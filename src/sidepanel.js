import { renderQrCodeToCanvas } from "./qr-code.js";
import {
  vfsDelete,
  vfsEmptyTrash,
  vfsGetFileBlob,
  vfsGetUsage,
  vfsList,
  vfsMkdir,
  vfsMove,
  vfsPurge,
  vfsReadFile,
  vfsRestore,
  vfsWriteFile
} from "./virtual-file-system.js";
import { CONTEXT_SUMMARY_PREFIX } from "./agent-runtime.js";
import { DISTRIBUTION_OAUTH_CLIENT_IDS } from "./oauth-clients.js";
import {
  COPILOT_INTEGRATION_ID,
  normalizeCopilotIntegrationId
} from "./provider-client-metadata.js";
import { normalizeOpenAICompatibleApiProtocol } from "./openai-compatible-api.js";
import { buildVfsPreviewDocument } from "./vfs-preview.js";
import { normalizeWebSearchConfig } from "./web-search.js";
import {
  builtinToolUiDefinitions,
  isRemovedBuiltinToolName
} from "./tool-registry.js";

const PROVIDER_DEFAULTS = {
  ollama: {
    baseUrl: "http://localhost:11434",
    model: "llama3.1",
    thinking: true
  },
  "openai-compatible": {
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    model: "gpt-4.1-mini",
    apiProtocol: "auto",
    thinking: true
  },
  opencode: {
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: "",
    model: "gpt-5.5",
    thinking: true
  },
  "chrome-ai": {
    model: "gemini-nano",
    thinking: true,
    includeImages: true
  },
  "codex-oauth": {
    issuerUrl: "https://auth.openai.com",
    authUrl: "https://auth.openai.com/oauth/authorize",
    tokenUrl: "https://auth.openai.com/oauth/token",
    clientId: DISTRIBUTION_OAUTH_CLIENT_IDS.codex,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    model: "gpt-5.4",
    thinking: true,
    accountId: "",
    email: "",
    planType: "",
    idToken: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
    deviceAuthId: "",
    userCode: "",
    verificationUrl: "",
    deviceCodeInterval: 5,
    deviceCodeExpiresAt: 0
  },
  "github-copilot-oauth": {
    deviceCodeUrl: "https://github.com/login/device/code",
    accessTokenUrl: "https://github.com/login/oauth/access_token",
    clientId: DISTRIBUTION_OAUTH_CLIENT_IDS.githubCopilot,
    scope: "read:user",
    copilotTokenUrl: "https://api.github.com/copilot_internal/v2/token",
    baseUrl: "https://api.githubcopilot.com",
    model: "auto",
    thinking: true,
    integrationId: COPILOT_INTEGRATION_ID,
    userLogin: "",
    githubAccessToken: "",
    githubTokenType: "",
    githubScope: "",
    copilotAccessToken: "",
    copilotTokenExpiresAt: 0,
    deviceCode: "",
    userCode: "",
    verificationUrl: "",
    deviceCodeInterval: 5,
    deviceCodeExpiresAt: 0
  }
};

const QIYEWECHAT_NOTIFICATION_TOOL_NAME = "qiyewechat_notification";
const WEB_SEARCH_TOOL_NAME = "web_search";

const BUILTIN_TOOLS = builtinToolUiDefinitions();

const ADVANCED_BUILTIN_TOOLS = new Set(BUILTIN_TOOLS.filter((tool) => tool.advanced).map((tool) => tool.name));
const DEFAULT_DISABLED_BUILTIN_TOOLS = new Set(BUILTIN_TOOLS.filter((tool) => !tool.enabled).map((tool) => tool.name));
const PRODUCT_DISCLOSURE_VERSION = 1;

const CHAT_HISTORY_KEY = "webclawChatHistory";
const CHAT_SESSIONS_KEY = "webclawChatSessions";
const OPERATION_APPROVAL_GRANTS_KEY = "webclawOperationApprovalGrants";
const MAX_STORED_CHAT_MESSAGES = 200;
const MAX_STORED_SESSIONS = 80;
const MAX_STORED_TURNS = 100;
const standaloneView = new URLSearchParams(window.location.search).get("view");

const elements = {
  status: document.querySelector("#status"),
  appTitle: document.querySelector("#appTitle"),
  settingsToggle: document.querySelector("#settingsToggle"),
  closeWindow: document.querySelector("#closeWindow"),
  settingsPanel: document.querySelector("#settingsPanel"),
  workspaceToggle: document.querySelector("#workspaceToggle"),
  workspacePanel: document.querySelector("#workspacePanel"),
  workspaceUsage: document.querySelector("#workspaceUsage"),
  workspacePath: document.querySelector("#workspacePath"),
  workspaceGo: document.querySelector("#workspaceGo"),
  workspaceUp: document.querySelector("#workspaceUp"),
  workspaceNewFolder: document.querySelector("#workspaceNewFolder"),
  workspaceNewFile: document.querySelector("#workspaceNewFile"),
  workspaceUpload: document.querySelector("#workspaceUpload"),
  workspaceFileInput: document.querySelector("#workspaceFileInput"),
  workspaceDownload: document.querySelector("#workspaceDownload"),
  workspaceRename: document.querySelector("#workspaceRename"),
  workspaceMove: document.querySelector("#workspaceMove"),
  workspaceRestore: document.querySelector("#workspaceRestore"),
  workspaceDelete: document.querySelector("#workspaceDelete"),
  workspacePurge: document.querySelector("#workspacePurge"),
  workspaceEmptyTrash: document.querySelector("#workspaceEmptyTrash"),
  workspaceList: document.querySelector("#workspaceList"),
  workspaceEditor: document.querySelector("#workspaceEditor"),
  workspaceEditorName: document.querySelector("#workspaceEditorName"),
  workspaceEditorVersion: document.querySelector("#workspaceEditorVersion"),
  workspaceEditorContent: document.querySelector("#workspaceEditorContent"),
  workspaceSaveFile: document.querySelector("#workspaceSaveFile"),
  activeProviderId: document.querySelector("#activeProviderId"),
  addProvider: document.querySelector("#addProvider"),
  editProvider: document.querySelector("#editProvider"),
  providerModal: document.querySelector("#providerModal"),
  providerModalTitle: document.querySelector("#providerModalTitle"),
  closeProviderModal: document.querySelector("#closeProviderModal"),
  modalDeleteProvider: document.querySelector("#modalDeleteProvider"),
  saveProvider: document.querySelector("#saveProvider"),
  providerEditState: document.querySelector("#providerEditState"),
  providerName: document.querySelector("#providerName"),
  providerType: document.querySelector("#providerType"),
  ollamaBaseUrl: document.querySelector("#ollamaBaseUrl"),
  ollamaModel: document.querySelector("#ollamaModel"),
  ollamaModelSelect: document.querySelector("#ollamaModelSelect"),
  ollamaModelOptions: document.querySelector("#ollamaModelOptions"),
  ollamaThinking: document.querySelector("#ollamaThinking"),
  refreshOllamaModels: document.querySelector("#refreshOllamaModels"),
  openaiBaseUrl: document.querySelector("#openaiBaseUrl"),
  openaiApiProtocol: document.querySelector("#openaiApiProtocol"),
  openaiApiKey: document.querySelector("#openaiApiKey"),
  openaiModel: document.querySelector("#openaiModel"),
  openaiModelSelect: document.querySelector("#openaiModelSelect"),
  openaiModelOptions: document.querySelector("#openaiModelOptions"),
  openaiThinking: document.querySelector("#openaiThinking"),
  refreshOpenAIModels: document.querySelector("#refreshOpenAIModels"),
  opencodeBaseUrl: document.querySelector("#opencodeBaseUrl"),
  opencodeApiKey: document.querySelector("#opencodeApiKey"),
  opencodeModel: document.querySelector("#opencodeModel"),
  opencodeModelSelect: document.querySelector("#opencodeModelSelect"),
  opencodeModelOptions: document.querySelector("#opencodeModelOptions"),
  opencodeThinking: document.querySelector("#opencodeThinking"),
  refreshOpenCodeModels: document.querySelector("#refreshOpenCodeModels"),
  chromeAIModel: document.querySelector("#chromeAIModel"),
  chromeAIModelSelect: document.querySelector("#chromeAIModelSelect"),
  chromeAIModelOptions: document.querySelector("#chromeAIModelOptions"),
  chromeAIThinking: document.querySelector("#chromeAIThinking"),
  chromeAIIncludeImages: document.querySelector("#chromeAIIncludeImages"),
  refreshChromeAIModels: document.querySelector("#refreshChromeAIModels"),
  codexTokenState: document.querySelector("#codexTokenState"),
  codexDeviceCodePanel: document.querySelector("#codexDeviceCodePanel"),
  codexDeviceCode: document.querySelector("#codexDeviceCode"),
  copyCodexDeviceCode: document.querySelector("#copyCodexDeviceCode"),
  codexIssuerUrl: document.querySelector("#codexIssuerUrl"),
  codexAuthUrl: document.querySelector("#codexAuthUrl"),
  codexTokenUrl: document.querySelector("#codexTokenUrl"),
  codexClientId: document.querySelector("#codexClientId"),
  codexScope: document.querySelector("#codexScope"),
  codexBaseUrl: document.querySelector("#codexBaseUrl"),
  codexModel: document.querySelector("#codexModel"),
  codexModelSelect: document.querySelector("#codexModelSelect"),
  codexModelOptions: document.querySelector("#codexModelOptions"),
  codexThinking: document.querySelector("#codexThinking"),
  refreshCodexModels: document.querySelector("#refreshCodexModels"),
  githubCopilotTokenState: document.querySelector("#githubCopilotTokenState"),
  githubCopilotDeviceCodePanel: document.querySelector("#githubCopilotDeviceCodePanel"),
  githubCopilotDeviceCode: document.querySelector("#githubCopilotDeviceCode"),
  copyGitHubCopilotDeviceCode: document.querySelector("#copyGitHubCopilotDeviceCode"),
  githubCopilotDeviceCodeUrl: document.querySelector("#githubCopilotDeviceCodeUrl"),
  githubCopilotAccessTokenUrl: document.querySelector("#githubCopilotAccessTokenUrl"),
  githubCopilotClientId: document.querySelector("#githubCopilotClientId"),
  githubCopilotScope: document.querySelector("#githubCopilotScope"),
  githubCopilotTokenUrl: document.querySelector("#githubCopilotTokenUrl"),
  githubCopilotBaseUrl: document.querySelector("#githubCopilotBaseUrl"),
  githubCopilotModel: document.querySelector("#githubCopilotModel"),
  githubCopilotModelSelect: document.querySelector("#githubCopilotModelSelect"),
  githubCopilotModelOptions: document.querySelector("#githubCopilotModelOptions"),
  githubCopilotThinking: document.querySelector("#githubCopilotThinking"),
  refreshGitHubCopilotModels: document.querySelector("#refreshGitHubCopilotModels"),
  githubCopilotIntegrationId: document.querySelector("#githubCopilotIntegrationId"),
  maxSteps: document.querySelector("#maxSteps"),
  taskMaxDepth: document.querySelector("#taskMaxDepth"),
  taskMaxTasks: document.querySelector("#taskMaxTasks"),
  taskMaxModelSteps: document.querySelector("#taskMaxModelSteps"),
  temperature: document.querySelector("#temperature"),
  allowUnsafePageJs: document.querySelector("#allowUnsafePageJs"),
  toolCount: document.querySelector("#toolCount"),
  toolSearch: document.querySelector("#toolSearch"),
  toolBundle: document.querySelector("#toolBundle"),
  toolList: document.querySelector("#toolList"),
  addTool: document.querySelector("#addTool"),
  saveTools: document.querySelector("#saveTools"),
  toolModal: document.querySelector("#toolModal"),
  toolModalTitle: document.querySelector("#toolModalTitle"),
  toolEditState: document.querySelector("#toolEditState"),
  closeToolModal: document.querySelector("#closeToolModal"),
  saveTool: document.querySelector("#saveTool"),
  deleteTool: document.querySelector("#deleteTool"),
  toolName: document.querySelector("#toolName"),
  toolTitle: document.querySelector("#toolTitle"),
  toolDescription: document.querySelector("#toolDescription"),
  toolType: document.querySelector("#toolType"),
  toolEnabled: document.querySelector("#toolEnabled"),
  toolHttpMethod: document.querySelector("#toolHttpMethod"),
  toolHttpUrl: document.querySelector("#toolHttpUrl"),
  toolHttpHeaders: document.querySelector("#toolHttpHeaders"),
  toolHttpBody: document.querySelector("#toolHttpBody"),
  toolResponseLimit: document.querySelector("#toolResponseLimit"),
  toolWorkflowInputSchema: document.querySelector("#toolWorkflowInputSchema"),
  toolWorkflowInstruction: document.querySelector("#toolWorkflowInstruction"),
  toolWorkflowMaxSteps: document.querySelector("#toolWorkflowMaxSteps"),
  toolQiyeWechatWebhookUrl: document.querySelector("#toolQiyeWechatWebhookUrl"),
  toolWebSearchProvider: document.querySelector("#toolWebSearchProvider"),
  toolWebSearchBraveApiKey: document.querySelector("#toolWebSearchBraveApiKey"),
  toolWebSearchBraveBaseUrl: document.querySelector("#toolWebSearchBraveBaseUrl"),
  toolWebSearchBrowserEngine: document.querySelector("#toolWebSearchBrowserEngine"),
  toolWebSearchFallback: document.querySelector("#toolWebSearchFallback"),
  toolWebSearchMaxResults: document.querySelector("#toolWebSearchMaxResults"),
  toolWebSearchTimeoutSeconds: document.querySelector("#toolWebSearchTimeoutSeconds"),
  toolWebSearchCacheTtlMinutes: document.querySelector("#toolWebSearchCacheTtlMinutes"),
  skillCount: document.querySelector("#skillCount"),
  skillList: document.querySelector("#skillList"),
  addSkill: document.querySelector("#addSkill"),
  saveSkills: document.querySelector("#saveSkills"),
  skillModal: document.querySelector("#skillModal"),
  skillModalTitle: document.querySelector("#skillModalTitle"),
  skillEditState: document.querySelector("#skillEditState"),
  closeSkillModal: document.querySelector("#closeSkillModal"),
  saveSkill: document.querySelector("#saveSkill"),
  deleteSkill: document.querySelector("#deleteSkill"),
  skillName: document.querySelector("#skillName"),
  skillTitle: document.querySelector("#skillTitle"),
  skillDescription: document.querySelector("#skillDescription"),
  skillContent: document.querySelector("#skillContent"),
  skillEnabled: document.querySelector("#skillEnabled"),
  channelCount: document.querySelector("#channelCount"),
  channelList: document.querySelector("#channelList"),
  addChannel: document.querySelector("#addChannel"),
  saveChannels: document.querySelector("#saveChannels"),
  channelModal: document.querySelector("#channelModal"),
  channelModalTitle: document.querySelector("#channelModalTitle"),
  channelEditState: document.querySelector("#channelEditState"),
  closeChannelModal: document.querySelector("#closeChannelModal"),
  saveChannel: document.querySelector("#saveChannel"),
  deleteChannel: document.querySelector("#deleteChannel"),
  channelName: document.querySelector("#channelName"),
  channelTitle: document.querySelector("#channelTitle"),
  channelType: document.querySelector("#channelType"),
  channelEnabled: document.querySelector("#channelEnabled"),
  telegramBotToken: document.querySelector("#telegramBotToken"),
  scheduleCount: document.querySelector("#scheduleCount"),
  scheduleList: document.querySelector("#scheduleList"),
  addSchedule: document.querySelector("#addSchedule"),
  saveSchedules: document.querySelector("#saveSchedules"),
  scheduleModal: document.querySelector("#scheduleModal"),
  scheduleModalTitle: document.querySelector("#scheduleModalTitle"),
  scheduleEditState: document.querySelector("#scheduleEditState"),
  closeScheduleModal: document.querySelector("#closeScheduleModal"),
  saveSchedule: document.querySelector("#saveSchedule"),
  deleteSchedule: document.querySelector("#deleteSchedule"),
  scheduleName: document.querySelector("#scheduleName"),
  scheduleTitle: document.querySelector("#scheduleTitle"),
  scheduleExpression: document.querySelector("#scheduleExpression"),
  scheduleInstruction: document.querySelector("#scheduleInstruction"),
  scheduleEnabled: document.querySelector("#scheduleEnabled"),
  scheduleNextRun: document.querySelector("#scheduleNextRun"),
  wechatBridgeState: document.querySelector("#wechatBridgeState"),
  wechatQrPanel: document.querySelector("#wechatQrPanel"),
  wechatQrCanvas: document.querySelector("#wechatQrCanvas"),
  wechatQrText: document.querySelector("#wechatQrText"),
  saveSettings: document.querySelector("#saveSettings"),
  disclosureState: document.querySelector("#disclosureState"),
  reviewDisclosure: document.querySelector("#reviewDisclosure"),
  approvalGrantState: document.querySelector("#approvalGrantState"),
  clearApprovalGrants: document.querySelector("#clearApprovalGrants"),
  productDisclosureModal: document.querySelector("#productDisclosureModal"),
  acceptProductDisclosure: document.querySelector("#acceptProductDisclosure"),
  declineProductDisclosure: document.querySelector("#declineProductDisclosure"),
  approvalModal: document.querySelector("#approvalModal"),
  approvalTitle: document.querySelector("#approvalTitle"),
  approvalKind: document.querySelector("#approvalKind"),
  approvalReason: document.querySelector("#approvalReason"),
  approvalOrigins: document.querySelector("#approvalOrigins"),
  approvalDetails: document.querySelector("#approvalDetails"),
  allowApproval: document.querySelector("#allowApproval"),
  denyApproval: document.querySelector("#denyApproval"),
  discoverCodex: document.querySelector("#discoverCodex"),
  authorizeCodex: document.querySelector("#authorizeCodex"),
  checkCodex: document.querySelector("#checkCodex"),
  clearCodex: document.querySelector("#clearCodex"),
  authorizeGitHubCopilot: document.querySelector("#authorizeGitHubCopilot"),
  checkGitHubCopilot: document.querySelector("#checkGitHubCopilot"),
  clearGitHubCopilot: document.querySelector("#clearGitHubCopilot"),
  sessionSelect: document.querySelector("#sessionSelect"),
  sessionWorkingDirectory: document.querySelector("#sessionWorkingDirectory"),
  newSession: document.querySelector("#newSession"),
  clearSession: document.querySelector("#clearSession"),
  deleteSession: document.querySelector("#deleteSession"),
  messages: document.querySelector("#messages"),
  composer: document.querySelector("#composer"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  stop: document.querySelector("#stop")
};

let settings = null;
let codexPollTimer = null;
let githubCopilotPollTimer = null;
let activeAgentPort = null;
let activeAgentStopRequested = false;
let activeAssistantNode = null;
let activeTurnId = "";
let activePlanNode = null;
const activeAgentItemNodes = new Map();
const activeTaskRunViews = new Map();
let pendingAgentApproval = null;
let chatSessionWriteQueue = Promise.resolve();
let contextCompactionWriteQueue = Promise.resolve();
let wechatDrainTimer = null;
let wechatAutoConnectStarted = false;
let providerDirty = false;
let providerModalOpen = false;
let providerDraft = null;
let providerDraftIsNew = false;
let toolModalOpen = false;
let toolDraft = null;
let toolDraftIsNew = false;
let toolDirty = false;
let skillModalOpen = false;
let skillDraft = null;
let skillDraftIsNew = false;
let skillDirty = false;
let channelModalOpen = false;
let channelDraft = null;
let channelDraftIsNew = false;
let channelDirty = false;
let scheduleModalOpen = false;
let scheduleDraft = null;
let scheduleDraftIsNew = false;
let scheduleDirty = false;
let wechatBridgeLatestStatus = {};
let renderingSettings = false;
let workspacePath = "/workspace";
let workspaceSyncInProgress = false;
let workspaceSelection = null;
let workspaceEditorState = null;
const incomingWechatQueue = [];
const renderedWechatEventIds = new Set();
const shownRecoverableApprovalRuns = new Set();
const chat = [];
let storedChatMessages = [];
let chatSessions = {
  activeSessionId: "",
  sessions: []
};

init();

async function init() {
  try {
    bindEvents();
    settings = normalizePanelSettings((await runtimeMessage({ type: "WEBCLAW_GET_SETTINGS" })).settings);
    renderSettings();
    showProductDisclosureIfNeeded();
    await restoreChatHistory();
    if (standaloneView === "settings" || standaloneView === "workspace") {
      await activateStandaloneView(standaloneView);
      return;
    }
    ensureWechatBridgeConnection();
    checkRecoverableAgentApprovals();
    setInterval(checkRecoverableAgentApprovals, 30000);
    drainWechatAgentEvents();
    startWechatDrainTimer();
  } catch (error) {
    elements.status.textContent = `Settings error: ${error.message}`;
    settings = normalizePanelSettings(settings);
    renderSettings();
  }
}

async function checkRecoverableAgentApprovals() {
  if (pendingAgentApproval) return;
  try {
    const response = await runtimeMessage({ type: "WEBCLAW_LIST_RECOVERABLE_AGENT_RUNS" });
    const runs = Array.isArray(response.result) ? response.result : [];
    const run = runs.find((candidate) => (
      candidate?.recovery?.action === "wait_approval" &&
      candidate?.source !== "channel" &&
      !shownRecoverableApprovalRuns.has(candidate.runId)
    ));
    if (!run?.checkpoint?.pendingApproval) return;
    shownRecoverableApprovalRuns.add(run.runId);
    const localPort = {
      postMessage: async (decision) => {
        try {
          elements.status.textContent = "Resuming approved Agent run";
          const resumed = await runtimeMessage({
            type: "WEBCLAW_RESUME_AGENT_RUN",
            runId: run.runId,
            options: {
              recoveredApprovalDecision: {
                approved: decision?.approved === true,
                remember: decision?.remember === true
              }
            }
          });
          if (resumed.result?.final) appendMessage("assistant", resumed.result.final);
          elements.status.textContent = "Ready";
        } catch (error) {
          shownRecoverableApprovalRuns.delete(run.runId);
          elements.status.textContent = `Unable to resume Agent run: ${error.message}`;
        }
      }
    };
    showAgentApproval(localPort, {
      requestId: run.runId,
      approval: run.checkpoint.pendingApproval
    });
  } catch (error) {
    console.warn("WebClaw could not inspect recoverable approvals", error);
  }
}

async function openAuxiliaryWindow(view) {
  try {
    await runtimeMessage({ type: "WEBCLAW_OPEN_AUXILIARY_WINDOW", view });
  } catch (error) {
    elements.status.textContent = `Unable to open window: ${error.message}`;
  }
}

async function activateStandaloneView(view) {
  document.body.classList.add("standalone-view");
  elements.closeWindow.classList.remove("hidden");
  if (view === "settings") {
    elements.appTitle.textContent = "WebClaw Settings";
    elements.settingsPanel.classList.remove("hidden");
    elements.workspacePanel.classList.add("hidden");
    await refreshSettingsFromStorage();
    return;
  }
  elements.appTitle.textContent = "WebClaw Files";
  elements.settingsPanel.classList.add("hidden");
  elements.workspacePanel.classList.remove("hidden");
  await runtimeMessage({ type: "WEBCLAW_ENSURE_WORKSPACE_DEFAULTS" });
  workspacePath = activeSession().workingDirectory;
  await renderWorkspace({ preserveEditor: false });
}

function bindEvents() {
  elements.settingsToggle.addEventListener("click", () => openAuxiliaryWindow("settings"));
  elements.workspaceToggle.addEventListener("click", () => openAuxiliaryWindow("workspace"));
  elements.closeWindow.addEventListener("click", () => window.close());
  window.addEventListener("message", handlePreviewMessage);
  elements.workspaceGo.addEventListener("click", () => openWorkspacePath(elements.workspacePath.value));
  elements.workspacePath.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    openWorkspacePath(elements.workspacePath.value);
  });
  elements.workspaceUp.addEventListener("click", () => openWorkspacePath(parentVirtualPath(workspacePath)));
  elements.workspaceNewFolder.addEventListener("click", createWorkspaceFolder);
  elements.workspaceNewFile.addEventListener("click", createWorkspaceFile);
  elements.workspaceUpload.addEventListener("click", () => elements.workspaceFileInput.click());
  elements.workspaceFileInput.addEventListener("change", uploadWorkspaceFiles);
  elements.workspaceDownload.addEventListener("click", downloadWorkspaceSelection);
  elements.workspaceRename.addEventListener("click", renameWorkspaceSelection);
  elements.workspaceMove.addEventListener("click", moveWorkspaceSelection);
  elements.workspaceRestore.addEventListener("click", restoreWorkspaceSelection);
  elements.workspaceDelete.addEventListener("click", deleteWorkspaceSelection);
  elements.workspacePurge.addEventListener("click", purgeWorkspaceSelection);
  elements.workspaceEmptyTrash.addEventListener("click", emptyWorkspaceTrash);
  elements.workspaceSaveFile.addEventListener("click", saveWorkspaceEditor);
  elements.activeProviderId.addEventListener("change", changeActiveProvider);
  elements.addProvider.addEventListener("click", openNewProviderModal);
  elements.editProvider.addEventListener("click", () => openProviderModal(elements.activeProviderId.value));
  elements.closeProviderModal.addEventListener("click", closeProviderModal);
  elements.modalDeleteProvider.addEventListener("click", deleteDraftProvider);
  elements.providerType.addEventListener("change", changeProviderType);
  elements.saveProvider.addEventListener("click", saveProviderModal);
  elements.saveSettings.addEventListener("click", saveSettings);
  elements.reviewDisclosure.addEventListener("click", () => showProductDisclosure(true));
  elements.clearApprovalGrants.addEventListener("click", clearSavedOperationApprovals);
  elements.acceptProductDisclosure.addEventListener("click", acceptProductDisclosure);
  elements.declineProductDisclosure.addEventListener("click", declineProductDisclosure);
  elements.allowApproval.addEventListener("click", () => resolveAgentApproval(true));
  elements.denyApproval.addEventListener("click", () => resolveAgentApproval(false));
  elements.discoverCodex.addEventListener("click", discoverActiveCodex);
  elements.authorizeCodex.addEventListener("click", authorizeActiveCodex);
  elements.checkCodex.addEventListener("click", checkActiveCodex);
  elements.clearCodex.addEventListener("click", clearActiveCodex);
  elements.authorizeGitHubCopilot.addEventListener("click", authorizeActiveGitHubCopilot);
  elements.checkGitHubCopilot.addEventListener("click", checkActiveGitHubCopilot);
  elements.clearGitHubCopilot.addEventListener("click", clearActiveGitHubCopilot);
  elements.copyCodexDeviceCode.addEventListener("click", () =>
    copyDeviceCode(elements.codexDeviceCode, "ChatGPT")
  );
  elements.copyGitHubCopilotDeviceCode.addEventListener("click", () =>
    copyDeviceCode(elements.githubCopilotDeviceCode, "GitHub")
  );
  elements.refreshOllamaModels.addEventListener("click", refreshActiveProviderModels);
  elements.refreshOpenAIModels.addEventListener("click", refreshActiveProviderModels);
  elements.refreshOpenCodeModels.addEventListener("click", refreshActiveProviderModels);
  elements.refreshChromeAIModels.addEventListener("click", refreshActiveProviderModels);
  elements.refreshCodexModels.addEventListener("click", refreshActiveProviderModels);
  elements.refreshGitHubCopilotModels.addEventListener("click", refreshActiveProviderModels);
  elements.addTool.addEventListener("click", openNewToolModal);
  elements.toolSearch.addEventListener("input", renderToolList);
  elements.toolBundle.addEventListener("change", renderToolList);
  elements.saveTools.addEventListener("click", saveSettings);
  elements.closeToolModal.addEventListener("click", closeToolModal);
  elements.saveTool.addEventListener("click", saveToolModal);
  elements.deleteTool.addEventListener("click", deleteToolModal);
  elements.toolType.addEventListener("change", changeToolType);
  elements.addSkill.addEventListener("click", openNewSkillModal);
  elements.saveSkills.addEventListener("click", saveSettings);
  elements.closeSkillModal.addEventListener("click", closeSkillModal);
  elements.saveSkill.addEventListener("click", saveSkillModal);
  elements.deleteSkill.addEventListener("click", deleteSkillModal);
  elements.addChannel.addEventListener("click", openNewChannelModal);
  elements.saveChannels.addEventListener("click", saveSettings);
  elements.closeChannelModal.addEventListener("click", closeChannelModal);
  elements.saveChannel.addEventListener("click", saveChannelModal);
  elements.deleteChannel.addEventListener("click", deleteChannelModal);
  elements.channelType.addEventListener("change", changeChannelType);
  elements.addSchedule.addEventListener("click", openNewScheduleModal);
  elements.saveSchedules.addEventListener("click", saveSettings);
  elements.closeScheduleModal.addEventListener("click", closeScheduleModal);
  elements.saveSchedule.addEventListener("click", saveScheduleModal);
  elements.deleteSchedule.addEventListener("click", deleteScheduleModal);
  elements.ollamaModelSelect.addEventListener("change", () => syncSelectedModel(elements.ollamaModelSelect, elements.ollamaModel));
  elements.openaiModelSelect.addEventListener("change", () => syncSelectedModel(elements.openaiModelSelect, elements.openaiModel));
  elements.opencodeModelSelect.addEventListener("change", () => syncSelectedModel(elements.opencodeModelSelect, elements.opencodeModel));
  elements.chromeAIModelSelect.addEventListener("change", () => syncSelectedModel(elements.chromeAIModelSelect, elements.chromeAIModel));
  elements.codexModelSelect.addEventListener("change", () => syncSelectedModel(elements.codexModelSelect, elements.codexModel));
  elements.githubCopilotModelSelect.addEventListener("change", () =>
    syncSelectedModel(elements.githubCopilotModelSelect, elements.githubCopilotModel)
  );
  elements.sessionSelect.addEventListener("change", changeActiveSession);
  elements.newSession.addEventListener("click", createManualSession);
  elements.clearSession.addEventListener("click", clearActiveSession);
  elements.deleteSession.addEventListener("click", deleteActiveSession);
  elements.composer.addEventListener("submit", sendPrompt);
  elements.prompt.addEventListener("keydown", handlePromptKeydown);
  elements.stop.addEventListener("click", stopActiveAgent);
  bindProviderDirtyEvents();
  bindToolDirtyEvents();
  bindSkillDirtyEvents();
  bindChannelDirtyEvents();
  bindScheduleDirtyEvents();
  chrome.runtime.onMessage.addListener(handleRuntimePushMessage);
  chrome.storage.onChanged.addListener(handleStorageChanged);
}

function bindProviderDirtyEvents() {
  [
    elements.providerName,
    elements.providerType,
    elements.ollamaBaseUrl,
    elements.ollamaModel,
    elements.ollamaModelSelect,
    elements.ollamaThinking,
    elements.openaiBaseUrl,
    elements.openaiApiProtocol,
    elements.openaiApiKey,
    elements.openaiModel,
    elements.openaiModelSelect,
    elements.openaiThinking,
    elements.opencodeBaseUrl,
    elements.opencodeApiKey,
    elements.opencodeModel,
    elements.opencodeModelSelect,
    elements.opencodeThinking,
    elements.chromeAIModel,
    elements.chromeAIModelSelect,
    elements.chromeAIIncludeImages,
    elements.codexIssuerUrl,
    elements.codexAuthUrl,
    elements.codexTokenUrl,
    elements.codexClientId,
    elements.codexScope,
    elements.codexBaseUrl,
    elements.codexModel,
    elements.codexModelSelect,
    elements.codexThinking,
    elements.githubCopilotDeviceCodeUrl,
    elements.githubCopilotAccessTokenUrl,
    elements.githubCopilotClientId,
    elements.githubCopilotScope,
    elements.githubCopilotTokenUrl,
    elements.githubCopilotBaseUrl,
    elements.githubCopilotModel,
    elements.githubCopilotModelSelect,
    elements.githubCopilotThinking,
    elements.githubCopilotIntegrationId
  ].forEach((element) => {
    element.addEventListener("input", markProviderDirty);
    element.addEventListener("change", markProviderDirty);
  });
}

function bindToolDirtyEvents() {
  [
    elements.toolName,
    elements.toolTitle,
    elements.toolDescription,
    elements.toolType,
    elements.toolEnabled,
    elements.toolHttpMethod,
    elements.toolHttpUrl,
    elements.toolHttpHeaders,
    elements.toolHttpBody,
    elements.toolResponseLimit,
    elements.toolWorkflowInputSchema,
    elements.toolWorkflowInstruction,
    elements.toolWorkflowMaxSteps,
    elements.toolQiyeWechatWebhookUrl,
    elements.toolWebSearchProvider,
    elements.toolWebSearchBraveApiKey,
    elements.toolWebSearchBraveBaseUrl,
    elements.toolWebSearchBrowserEngine,
    elements.toolWebSearchFallback,
    elements.toolWebSearchMaxResults,
    elements.toolWebSearchTimeoutSeconds,
    elements.toolWebSearchCacheTtlMinutes
  ].forEach((element) => {
    element.addEventListener("input", markToolDirty);
    element.addEventListener("change", markToolDirty);
  });
}

function bindSkillDirtyEvents() {
  [
    elements.skillName,
    elements.skillTitle,
    elements.skillDescription,
    elements.skillContent,
    elements.skillEnabled
  ].forEach((element) => {
    element.addEventListener("input", markSkillDirty);
    element.addEventListener("change", markSkillDirty);
  });
}

function bindChannelDirtyEvents() {
  [
    elements.channelName,
    elements.channelTitle,
    elements.channelType,
    elements.channelEnabled,
    elements.telegramBotToken
  ].forEach((element) => {
    element.addEventListener("input", markChannelDirty);
    element.addEventListener("change", markChannelDirty);
  });
}

function bindScheduleDirtyEvents() {
  [
    elements.scheduleName,
    elements.scheduleTitle,
    elements.scheduleExpression,
    elements.scheduleInstruction,
    elements.scheduleEnabled
  ].forEach((element) => {
    element.addEventListener("input", markScheduleDirty);
    element.addEventListener("change", markScheduleDirty);
  });
}

async function sendPrompt(event) {
  event.preventDefault();
  if (!hasAcceptedProductDisclosure()) {
    showProductDisclosure(true);
    elements.status.textContent = "Review and accept the disclosure before sending a message";
    return;
  }
  const content = elements.prompt.value.trim();
  if (!content) return;
  elements.prompt.value = "";
  await submitUserMessage(content, null);
}

function hasAcceptedProductDisclosure() {
  return Number(settings?.disclosures?.productVersion || 0) >= PRODUCT_DISCLOSURE_VERSION &&
    Number(settings?.disclosures?.productAcceptedAt || 0) > 0;
}

function showProductDisclosureIfNeeded() {
  if (!hasAcceptedProductDisclosure()) showProductDisclosure(false);
}

function showProductDisclosure(force) {
  if (!force && hasAcceptedProductDisclosure()) return;
  elements.declineProductDisclosure.textContent = hasAcceptedProductDisclosure() ? "Close" : "Decline";
  elements.productDisclosureModal.classList.remove("hidden");
  elements.productDisclosureModal.setAttribute("aria-hidden", "false");
}

function hideProductDisclosure() {
  elements.productDisclosureModal.classList.add("hidden");
  elements.productDisclosureModal.setAttribute("aria-hidden", "true");
}

async function acceptProductDisclosure() {
  elements.acceptProductDisclosure.disabled = true;
  try {
    settings.disclosures = {
      ...(settings.disclosures || {}),
      productVersion: PRODUCT_DISCLOSURE_VERSION,
      productAcceptedAt: Date.now()
    };
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    hideProductDisclosure();
    elements.status.textContent = "Ready";
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    elements.acceptProductDisclosure.disabled = false;
  }
}

function declineProductDisclosure() {
  if (hasAcceptedProductDisclosure()) {
    hideProductDisclosure();
    return;
  }
  elements.status.textContent = "Disclosure acceptance is required before WebClaw can store or process your data";
  window.close();
}

async function refreshSettingsFromStorage() {
  try {
    applySettings(await loadLatestSettings());
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

function handleStorageChanged(changes, areaName) {
  if (areaName !== "local") return;
  if (changes[OPERATION_APPROVAL_GRANTS_KEY]) refreshOperationApprovalGrantState();
  if (changes[CHAT_SESSIONS_KEY]?.newValue && !activeAgentPort) {
    chatSessions = normalizeChatSessions(changes[CHAT_SESSIONS_KEY].newValue);
    renderActiveSession();
    if (standaloneView === "workspace") {
      syncWorkspaceToActiveSession();
    }
  }
  if (!changes.settings?.newValue) return;
  if (providerModalOpen && providerDirty) return;
  if (toolModalOpen && toolDirty) return;
  if (skillModalOpen && skillDirty) return;
  if (channelModalOpen && channelDirty) return;
  if (scheduleModalOpen && scheduleDirty) return;
  applySettings(changes.settings.newValue);
}

async function loadLatestSettings() {
  const stored = await chrome.storage.local.get("settings");
  return normalizePanelSettings(stored.settings || {});
}

async function submitUserMessage(content, source) {
  if (activeAgentPort) {
    if (source?.type === "channel") incomingWechatQueue.push({ content, source });
    return;
  }
  syncGeneralFormToSettings();
  await persistSettings({ silent: true, authorizeCodex: false, authorizeGitHubCopilot: false });

  const userNode = appendMessage(
    source?.type === "channel" ? source.channelType || "channel" : "user",
    source?.type === "channel" ? `${formatChannelPeerLabel(source)}\n${content}` : content,
    {
      modelContent: content,
      media: source?.media || []
    }
  );
  chat.push({
    id: String(userNode?.dataset.historyId || ""),
    role: "user",
    content,
    media: source?.media || []
  });
  setBusy(true, "Thinking");
  activeAssistantNode = null;
  activePlanNode = null;
  activeAgentItemNodes.clear();
  activeTaskRunViews.clear();

  try {
    const result = await streamAgentMessage(chat, activeSession().workingDirectory);
    await applyContextCompaction(result.contextCompaction);
    await persistActiveSessionWorkingDirectory(result.workingDirectory);
    if (result.toolTrajectory) {
      appendMessage("tool", result.toolTrajectory.display, {
        modelContent: result.toolTrajectory.modelContent,
        hidden: true
      });
      chat.push({ role: "user", content: result.toolTrajectory.modelContent });
    }
    if (activeAssistantNode) {
      updateMessage(activeAssistantNode, result.final);
    } else {
      activeAssistantNode = appendMessage("assistant", result.final);
    }
    chat.push({ role: "assistant", content: result.final });
    if (source?.type === "channel") {
      await sendWechatReply(source, result.final);
    }
    elements.status.textContent = result.status === "completed"
      ? "Ready"
      : result.status === "stuck"
        ? "Stopped: no progress"
        : "Error";
  } catch (error) {
    if (error.message === "Stopped") {
      if (activeAssistantNode) {
        updateMessage(activeAssistantNode, "Stopped");
      } else {
        appendMessage("assistant", "Stopped");
      }
      elements.status.textContent = "Ready";
      return;
    }
    if (activeAssistantNode) {
      updateMessage(activeAssistantNode, `Error: ${error.message}`);
    } else {
      appendMessage("assistant", `Error: ${error.message}`);
    }
    elements.status.textContent = "Error";
  } finally {
    activeAgentPort = null;
    activeAssistantNode = null;
    activeTurnId = "";
    activePlanNode = null;
    activeAgentItemNodes.clear();
    activeTaskRunViews.clear();
    setBusy(false);
    processNextWechatMessage();
  }
}

function handlePromptKeydown(event) {
  if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  event.preventDefault();
  elements.composer.requestSubmit();
}

function stopActiveAgent() {
  if (!activeAgentPort || activeAgentStopRequested) return;
  activeAgentStopRequested = true;
  updateStopButtonState();
  elements.status.textContent = "Stopping";
  try {
    activeAgentPort.postMessage({ type: "stop" });
  } catch {
    // The stream completion/disconnect handler restores the idle UI state.
  }
}

function streamAgentMessage(messages, workingDirectory) {
  return streamAgentRequest({
    type: "start",
    messages,
    workingDirectory,
    sessionId: activeSession().id
  });
}

function streamScheduleRun(scheduleId) {
  return streamAgentRequest({
    type: "start_schedule",
    scheduleId,
    workingDirectory: activeSession().workingDirectory,
    sessionId: activeSession().id
  });
}

function streamAgentRequest(startMessage) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: "WEBCLAW_AGENT_STREAM" });
    activeAgentPort = port;
    activeAgentStopRequested = false;
    updateStopButtonState();
    let settled = false;
    const keepAlive = setInterval(() => {
      try {
        port.postMessage({ type: "ping" });
      } catch {
        clearInterval(keepAlive);
      }
    }, 10000);

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (activeAgentPort === port) activeAgentPort = null;
      activeAgentStopRequested = false;
      updateStopButtonState();
      clearAgentApproval(port);
      clearInterval(keepAlive);
      try {
        port.disconnect();
      } catch {
        // Port may already be closed by the service worker.
      }
      callback(value);
    };

    port.onMessage.addListener((message) => {
      if (message.type === "approval_request") {
        showAgentApproval(port, message);
        return;
      }
      if (message.type === "status") {
        elements.status.textContent = message.text || "Thinking";
        return;
      }
      if (message.type === "authorization_challenge") {
        const challenge = message.challenge || {};
        appendMessage("tool", [
          `${challenge.providerName || "ChatGPT"} authorization`,
          `Open: ${challenge.verificationUrl || ""}`,
          `Device code: ${challenge.userCode || ""}`,
          "WebClaw will continue automatically after authorization."
        ].join("\n"), { persist: false });
        elements.status.textContent = `Waiting for ${challenge.providerName || "ChatGPT"} authorization`;
        return;
      }
      if (message.type === "pong") {
        return;
      }
      if (message.type === "agent_event") {
        handleAgentEvent(message.event);
        return;
      }
      if (message.type === "delta") {
        if (!activeAssistantNode) activeAssistantNode = appendMessage("assistant", "");
        updateMessage(activeAssistantNode, `${activeAssistantNode.textContent}${message.delta || ""}`);
        return;
      }
      if (message.type === "tool_call") {
        appendMessage("tool", formatToolCall(message.tool), { persist: false });
        return;
      }
      if (message.type === "final") {
        finish(resolve, {
          final: message.final || "",
          toolTrajectory: normalizeToolTrajectory(message.toolTrajectory),
          contextCompaction: normalizeContextCompaction(message.contextCompaction),
          turnId: String(message.turnId || ""),
          status: String(message.status || "completed"),
          workingDirectory: normalizeWorkingDirectory(message.workingDirectory)
        });
        return;
      }
      if (message.type === "error") {
        finish(reject, new Error(message.error || "Unknown stream error"));
      }
    });
    port.onDisconnect.addListener(() => {
      if (!settled) finish(reject, new Error(chrome.runtime.lastError?.message || "Agent stream disconnected"));
    });
    port.postMessage({ type: "ping" });
    port.postMessage(startMessage);
  });
}

function handleAgentEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.type === "task_started") {
    updateTaskRunView(event, "running");
    elements.status.textContent = `Task ${Number(event.depth || 0) + 1}: ${event.title || "Running"}`;
    return;
  }
  if (event.type === "task_pushed") {
    updateTaskRunView(event, "running");
    elements.status.textContent = `Task ${Number(event.depth ?? event.taskDepth ?? 0) + 1}: ${event.title || "Running"}`;
    return;
  }
  if (event.type === "task_progress") {
    updateTaskRunView(event, "running");
    elements.status.textContent = event.phase === "tool"
      ? `Task tool: ${event.tool || "Running"}`
      : `Task step ${Number(event.step || 0)} of ${Number(event.maxSteps || 0)}`;
    return;
  }
  if (event.type === "task_completed") {
    updateTaskRunView(event, "completed");
    elements.status.textContent = `Task completed: ${event.title || event.taskId || ""}`;
    return;
  }
  if (event.type === "task_failed") {
    updateTaskRunView(event, "failed");
    elements.status.textContent = `Task failed: ${event.error || event.taskId || "Unknown error"}`;
    return;
  }
  if (event.type === "task_output_invalid") {
    updateTaskRunView(event, "correcting");
    elements.status.textContent = "Task is correcting its structured output";
    return;
  }
  if (event.type === "turn_started") {
    activeTurnId = String(event.turnId || "");
    recordTurnEvent(event);
    elements.status.textContent = "Thinking";
    return;
  }
  if (event.type === "run_state_changed") {
    const labels = {
      sampling_model: "Thinking",
      normalizing_response: "Reading model response",
      validating_actions: "Validating actions",
      executing_tools: "Running tools",
      recording_observations: "Recording tool results",
      evaluating_progress: "Evaluating progress",
      recovering: "Recovering",
      completed: "Completed",
      stuck: "Stopped: no progress",
      failed: "Stopped"
    };
    elements.status.textContent = labels[event.state] || "Thinking";
    return;
  }
  if (event.type === "agent_message_delta") {
    if (!activeAssistantNode) {
      activeAssistantNode = appendMessage("assistant", "", {
        turnId: event.turnId,
        itemId: event.itemId,
        kind: "agent_message",
        status: "in_progress"
      });
    }
    updateMessage(activeAssistantNode, `${activeAssistantNode.textContent}${event.delta || ""}`, {
      status: "in_progress"
    });
    return;
  }
  if (event.type === "item_started" && event.item?.type === "tool_call") {
    const node = appendMessage("tool", formatToolExecution(event.item), {
      turnId: event.turnId,
      itemId: event.item.id,
      kind: "tool_call",
      status: "in_progress",
      tool: event.item.tool,
      args: event.item.args
    });
    if (node) activeAgentItemNodes.set(String(event.item.id || ""), node);
    elements.status.textContent = `Running ${event.item.tool || "tool"}`;
    return;
  }
  if (event.type === "item_completed" && event.item?.type === "tool_call") {
    const itemId = String(event.item.id || "");
    const node = activeAgentItemNodes.get(itemId);
    if (node) {
      updateMessage(node, formatToolExecution(event.item), {
        status: event.item.status,
        result: event.item.result,
        durationMs: event.item.durationMs
      });
      activeAgentItemNodes.delete(itemId);
    }
    elements.status.textContent = event.item.status === "failed" ? "Tool failed; model is recovering" : "Thinking";
    return;
  }
  if (event.type === "plan_updated") {
    const text = formatAgentPlan(event);
    if (activePlanNode) {
      updateMessage(activePlanNode, text, {
        status: "completed",
        plan: event.plan
      });
    } else {
      activePlanNode = appendMessage("plan", text, {
        turnId: event.turnId,
        itemId: event.itemId,
        kind: "plan",
        status: "completed",
        plan: event.plan
      });
    }
    return;
  }
  if (event.type === "context_compacted") {
    applyContextCompaction(normalizeContextCompaction(event));
    elements.status.textContent = "Context compacted";
    return;
  }
  if (["turn_completed", "turn_failed", "turn_interrupted"].includes(event.type)) {
    recordTurnEvent(event);
    finalizeTaskRunView(event);
  }
}

function updateTaskRunView(event, status) {
  const runId = String(event.taskRunId || "");
  const taskId = String(event.taskId || "");
  if (!runId || !taskId) return;
  let view = activeTaskRunViews.get(runId);
  if (!view) {
    view = {
      runId,
      status: "running",
      tasks: new Map(),
      startedAt: Number(event.timestamp || Date.now()),
      node: null
    };
    activeTaskRunViews.set(runId, view);
  }
  const previous = view.tasks.get(taskId) || {};
  const depth = Number(event.depth ?? event.taskDepth ?? previous.depth ?? 0);
  const task = {
    ...previous,
    id: taskId,
    parentTaskId: String(event.parentTaskId ?? previous.parentTaskId ?? ""),
    depth,
    title: String(event.title || previous.title || "Task"),
    status,
    phase: String(event.phase || previous.phase || ""),
    tool: String(event.tool || (event.phase === "model" ? "" : previous.tool || "")),
    step: Number(event.step ?? previous.step ?? 0),
    maxSteps: Number(event.maxSteps ?? previous.maxSteps ?? 0),
    retries: Number(previous.retries || 0),
    error: String(event.error || previous.error || ""),
    usage: event.usage || previous.usage || null,
    startedAt: Number(previous.startedAt || event.timestamp || Date.now()),
    completedAt: ["completed", "failed"].includes(status) ? Number(event.timestamp || Date.now()) : 0
  };
  if (status === "correcting") {
    task.retries += 1;
    task.phase = "correcting";
    task.error = formatTaskValidationErrors(event.errors);
  }
  if (event.type === "task_pushed" && task.parentTaskId) {
    const parent = view.tasks.get(task.parentTaskId);
    if (parent) {
      parent.status = "waiting_child";
      parent.phase = "waiting_child";
    }
  }
  if (["completed", "failed"].includes(status) && task.parentTaskId) {
    const parent = view.tasks.get(task.parentTaskId);
    if (parent && parent.status === "waiting_child") {
      parent.status = "running";
      parent.phase = "model";
    }
  }
  view.tasks.set(taskId, task);
  renderLiveTaskRunView(view);
}

function finalizeTaskRunView(event) {
  const runId = String(event.taskRunId || "");
  const view = activeTaskRunViews.get(runId);
  if (!view || String(event.taskId || "")) return;
  const status = event.type === "turn_completed"
    ? "completed"
    : event.type === "turn_interrupted"
      ? "interrupted"
      : "failed";
  view.status = status;
  for (const task of view.tasks.values()) {
    if (!["running", "waiting_child", "correcting"].includes(task.status)) continue;
    task.status = status;
    task.phase = "";
    task.error = String(event.error || task.error || "");
    task.completedAt = Number(event.completedAt || event.timestamp || Date.now());
  }
  renderLiveTaskRunView(view);
  activeTaskRunViews.delete(runId);
}

function renderLiveTaskRunView(view) {
  const content = formatTaskRunView(view);
  if (!view.node) {
    view.node = appendMessage("task", content, {
      kind: "task_run",
      status: view.status,
      excludedFromContext: true
    });
  } else {
    updateMessage(view.node, content, { status: view.status });
  }
}

function formatTaskRunView(view) {
  const tasks = [...view.tasks.values()].sort((left, right) => {
    if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt;
    return left.depth - right.depth;
  });
  const done = tasks.filter((task) => task.status === "completed").length;
  const failed = tasks.filter((task) => ["failed", "interrupted"].includes(task.status)).length;
  const heading = view.status === "running"
    ? `Task execution (${done}/${tasks.length})`
    : `Task execution (${done} completed${failed ? `, ${failed} failed` : ""})`;
  const lines = tasks.map((task) => {
    const indent = "  ".repeat(Math.max(0, task.depth));
    const marker = task.status === "completed"
      ? "[x]"
      : ["failed", "interrupted"].includes(task.status)
        ? "[!]"
        : task.status === "waiting_child"
          ? "[-]"
          : "[>]";
    const detail = taskProgressLabel(task);
    return `${indent}${marker} ${task.title}${detail ? ` - ${detail}` : ""}`;
  });
  return [heading, ...lines].join("\n");
}

function taskProgressLabel(task) {
  if (task.status === "completed") {
    const modelSteps = Number(task.usage?.modelSteps || task.step || 0);
    const toolCalls = Number(task.usage?.toolCalls || 0);
    return `Completed${taskDurationLabel(task)}${modelSteps ? `, ${modelSteps} model step${modelSteps === 1 ? "" : "s"}` : ""}${toolCalls ? `, ${toolCalls} tool call${toolCalls === 1 ? "" : "s"}` : ""}`;
  }
  if (task.status === "failed") return `Failed${taskDurationLabel(task)}: ${task.error || "Unknown error"}`;
  if (task.status === "interrupted") return "Stopped";
  if (task.status === "correcting" || task.phase === "correcting") {
    return `Correcting structured output (attempt ${task.retries})${task.error ? `: ${task.error}` : ""}`;
  }
  if (task.status === "waiting_child" || task.phase === "waiting_child") return "Waiting for child task";
  if (task.phase === "tool") return `Running tool ${task.tool || "unknown"}${task.step ? `, model step ${task.step}/${task.maxSteps || "?"}` : ""}`;
  if (task.step) return `Model step ${task.step}/${task.maxSteps || "?"}`;
  return "Starting";
}

function taskDurationLabel(task) {
  const durationMs = Number(task.completedAt || 0) - Number(task.startedAt || 0);
  if (durationMs <= 0) return "";
  if (durationMs < 1000) return `, ${durationMs} ms`;
  return `, ${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
}

function taskStatusLabel(status) {
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
  if (status === "interrupted") return "Stopped";
  return "Running";
}

function formatTaskValidationErrors(errors) {
  return (Array.isArray(errors) ? errors : [])
    .slice(0, 2)
    .map((error) => `${error?.path || "$"} ${error?.message || "is invalid"}`)
    .join("; ");
}

function formatToolExecution(item) {
  const args = safeJsonPreview(item?.args || {});
  const status = String(item?.status || "in_progress");
  if (status === "in_progress") {
    return `tool: ${item?.tool || "unknown"}\n${formatJsonForDisplay(item?.args || {})}\nRunning`;
  }
  const duration = Number.isFinite(Number(item?.durationMs)) ? ` (${Number(item.durationMs)} ms)` : "";
  if (status === "failed" || item?.result?.ok === false) {
    return `tool: ${item?.tool || "unknown"}\n${formatJsonForDisplay(item?.args || {})}\nFailed${duration}: ${String(item?.result?.error || "Unknown error")}`;
  }
  return `tool: ${item?.tool || "unknown"}\n${args}\nCompleted${duration}`;
}

function formatJsonForDisplay(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return safeJsonPreview(value);
  }
}

function formatAgentPlan(value) {
  const explanation = String(value?.explanation || "").trim();
  const steps = (Array.isArray(value?.plan) ? value.plan : []).map((item) => {
    const marker = item.status === "completed" ? "[x]" : item.status === "in_progress" ? "[>]" : "[ ]";
    return `${marker} ${item.step}`;
  });
  return ["Plan", explanation, ...steps].filter(Boolean).join("\n");
}

function showAgentApproval(port, message) {
  if (pendingAgentApproval) {
    pendingAgentApproval.port.postMessage({
      type: "approval_response",
      requestId: pendingAgentApproval.requestId,
      approved: false
    });
  }
  const approval = message.approval && typeof message.approval === "object" ? message.approval : {};
  pendingAgentApproval = {
    port,
    requestId: String(message.requestId || ""),
    approval
  };
  elements.approvalTitle.textContent = String(approval.title || "Approval required");
  elements.approvalKind.textContent = approval.kind === "run_js"
    ? "JavaScript execution request"
    : approval.kind === "external_data"
      ? "External data disclosure"
      : approval.kind === "oauth"
        ? "Provider authorization request"
      : "Site or service access request";
  elements.approvalReason.textContent = String(approval.reason || "Review this request before allowing it.");
  const origins = uniqueStrings(approval.origins);
  const permissions = uniqueStrings(approval.permissions);
  elements.approvalOrigins.textContent = origins.length
    ? `Chrome access requested:\n${origins.join("\n")}${permissions.length ? `\nPermissions: ${permissions.join(", ")}` : ""}`
    : permissions.length
      ? `Chrome permissions requested:\n${permissions.join("\n")}`
    : "";
  elements.approvalOrigins.classList.toggle("hidden", origins.length === 0 && permissions.length === 0);
  elements.approvalDetails.textContent = String(approval.details || "");
  elements.approvalDetails.classList.toggle("hidden", !approval.details);
  elements.allowApproval.textContent = String(approval.allowLabel || "Allow once");
  elements.allowApproval.disabled = false;
  elements.denyApproval.disabled = false;
  elements.approvalModal.classList.remove("hidden");
  elements.approvalModal.setAttribute("aria-hidden", "false");
}

async function resolveAgentApproval(approved) {
  const pending = pendingAgentApproval;
  if (!pending) return;
  elements.allowApproval.disabled = true;
  elements.denyApproval.disabled = true;
  let granted = Boolean(approved);
  let error = "";
  if (granted) {
    const origins = uniqueStrings(pending.approval.origins);
    const permissions = uniqueStrings(pending.approval.permissions);
    if (origins.length > 0 || permissions.length > 0) {
      try {
        granted = await chrome.permissions.request({ ...(origins.length ? { origins } : {}), ...(permissions.length ? { permissions } : {}) });
        if (!granted) error = "Chrome permission was not granted.";
      } catch (permissionError) {
        granted = false;
        error = permissionError?.message || String(permissionError);
      }
    }
  }
  try {
    pending.port.postMessage({
      type: "approval_response",
      requestId: pending.requestId,
      approved: granted,
      remember: granted && pending.approval.rememberByDefault === true,
      error
    });
  } catch {
    // The agent port may close while the permission prompt is open.
  }
  clearAgentApproval(pending.port);
}

function clearAgentApproval(port) {
  if (pendingAgentApproval && port && pendingAgentApproval.port !== port) return;
  pendingAgentApproval = null;
  elements.approvalModal.classList.add("hidden");
  elements.approvalModal.setAttribute("aria-hidden", "true");
}

function requestLocalApproval(approval) {
  return new Promise((resolve) => {
    const localPort = {
      postMessage(message) {
        resolve(Boolean(message?.approved));
      }
    };
    showAgentApproval(localPort, {
      type: "approval_request",
      requestId: crypto.randomUUID(),
      approval
    });
  });
}

async function requestOriginPermissionsForUrls(urls, reason) {
  const requested = uniqueStrings((Array.isArray(urls) ? urls : [urls]).map(originPatternForUrl).filter(Boolean));
  const missing = [];
  for (const origin of requested) {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
  }
  if (missing.length === 0) return true;
  const approved = await requestLocalApproval({
    kind: "host_permission",
    title: "Allow site or service access",
    reason,
    origins: missing,
    details: "Chrome grants these origins to WebClaw until you revoke them from the extension's site access settings.",
    allowLabel: "Allow access"
  });
  if (!approved) {
    elements.status.textContent = "Site or service access was not granted";
    return false;
  }
  return true;
}

function originPatternForUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\/\*\./i.test(text) && text.endsWith("/*")) return text;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

function providerPermissionUrls(provider) {
  if (!provider) return [];
  const config = provider.config || {};
  if (provider.type === "chrome-ai") return [];
  if (provider.type === "ollama" || provider.type === "openai-compatible" || provider.type === "opencode") return [config.baseUrl];
  if (provider.type === "codex-oauth") {
    return [config.issuerUrl, config.authUrl, config.tokenUrl, config.baseUrl];
  }
  if (provider.type === "github-copilot-oauth") {
    return [
      config.deviceCodeUrl,
      config.accessTokenUrl,
      config.copilotTokenUrl,
      config.baseUrl,
      "https://api.github.com/"
    ];
  }
  return [];
}

function channelPermissionUrls(channel) {
  if (channel?.type === "telegram") return ["https://api.telegram.org/"];
  if (channel?.type === "wechat") {
    return ["https://*.weixin.qq.com/*"];
  }
  return [];
}

async function ensureExternalProviderDisclosureForAutomation(reason) {
  const provider = activeProvider();
  if (!hasAcceptedProductDisclosure()) {
    showProductDisclosure(true);
    elements.status.textContent = "Accept the product disclosure before enabling background automation";
    return false;
  }
  if (!isExternalProvider(provider)) {
    return requestOriginPermissionsForUrls(
      providerPermissionUrls(provider),
      `${reason} Chrome needs access to the configured local model service before background tasks can use it.`
    );
  }
  if (Number(settings?.disclosures?.externalProviders?.[provider.id] || 0) > 0) {
    return requestOriginPermissionsForUrls(providerPermissionUrls(provider), reason);
  }
  const approved = await requestLocalApproval({
    kind: "external_data",
    title: `Allow data sharing with ${provider.name}`,
    reason,
    origins: uniqueStrings(providerPermissionUrls(provider).map(originPatternForUrl).filter(Boolean)),
    details: "WebClaw will send prompts, relevant active-session history, and only the page content, files, media, or tool results needed for enabled channel or schedule tasks. Data goes directly from this browser to the configured provider.",
    allowLabel: "Accept and allow"
  });
  if (!approved) return false;
  settings.disclosures = normalizePanelDisclosures(settings.disclosures);
  settings.disclosures.externalProviders[provider.id] = Date.now();
  return true;
}

function isExternalProvider(provider) {
  if (!provider || provider.type === "chrome-ai") return false;
  if (provider.type !== "ollama" && provider.type !== "openai-compatible") return true;
  try {
    const hostname = new URL(provider.config?.baseUrl || "").hostname;
    return !isLoopbackHostname(hostname);
  } catch {
    return true;
  }
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]";
}

function formatToolCall(tool) {
  const name = tool?.name || "unknown";
  const args = tool?.args && Object.keys(tool.args).length > 0 ? `\n${JSON.stringify(tool.args, null, 2)}` : "";
  return `tool: ${name}${args}`;
}

function handleRuntimePushMessage(message) {
  if (message?.type === "WEBCLAW_WECHAT_INCOMING") {
    return;
  }
  if (message?.type === "WEBCLAW_WECHAT_AGENT_EVENT") {
    renderWechatAgentEvent(message.payload || {}).catch(() => {});
    return;
  }
  if (message?.type === "WEBCLAW_WECHAT_BRIDGE_STATUS") {
    renderWechatBridgeStatus(message.payload || {});
  }
}

async function drainWechatAgentEvents() {
  try {
    const response = await runtimeMessage({ type: "WEBCLAW_DRAIN_WECHAT_AGENT_EVENTS" });
    for (const event of response.result || []) {
      await renderWechatAgentEvent(event);
    }
  } catch {
    // The event log is best-effort; normal chat should still load.
  }
}

async function renderWechatAgentEvent(event) {
  if (event.id && renderedWechatEventIds.has(event.id)) return;
  if (event.id) {
    renderedWechatEventIds.add(event.id);
    if (renderedWechatEventIds.size > 500) {
      renderedWechatEventIds.clear();
    }
  }
  if (event.channelId && event.peerId) {
    const previousActive = chatSessions.activeSessionId;
    await reloadChatSessions();
    if (chatSessions.activeSessionId === previousActive) renderActiveSession();
    else renderSessionList();
    return;
  }
  appendMessage(event.role === "assistant" ? "assistant" : "tool", event.text || "");
}

async function reloadChatSessions() {
  const stored = await chrome.storage.local.get([CHAT_SESSIONS_KEY, CHAT_HISTORY_KEY]);
  const currentActive = chatSessions.activeSessionId;
  chatSessions = normalizeChatSessions(stored[CHAT_SESSIONS_KEY], stored[CHAT_HISTORY_KEY]);
  if (chatSessions.sessions.some((session) => session.id === currentActive)) {
    chatSessions.activeSessionId = currentActive;
  }
}

async function restoreChatHistory() {
  try {
    const stored = await chrome.storage.local.get([CHAT_SESSIONS_KEY, CHAT_HISTORY_KEY]);
    chatSessions = normalizeChatSessions(stored[CHAT_SESSIONS_KEY], stored[CHAT_HISTORY_KEY]);
    await persistChatSessions();
    renderSessionList();
    renderActiveSession();
  } catch (error) {
    elements.status.textContent = `Chat history restore failed: ${error.message}`;
  }
}

function normalizeChatSessions(value, legacyMessages = null) {
  const raw = value && typeof value === "object" ? value : {};
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
    .map(normalizeChatSession)
    .filter(Boolean)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, MAX_STORED_SESSIONS);
  if (sessions.length === 0) {
    const messages = normalizeStoredChatMessages(legacyMessages);
    sessions.push(createSession({
      title: "Chat",
      source: { type: "manual" },
      messages
    }));
  }
  const activeSessionId = sessions.some((session) => session.id === raw.activeSessionId)
    ? raw.activeSessionId
    : sessions[0].id;
  return { activeSessionId, sessions };
}

function normalizeChatSession(session) {
  if (!session || typeof session !== "object") return null;
  const id = String(session.id || "").trim() || crypto.randomUUID();
  const messages = normalizeStoredChatMessages(session.messages);
  return {
    id,
    title: String(session.title || "Chat").trim().slice(0, 120) || "Chat",
    source: normalizeSessionSource(session.source),
    workingDirectory: normalizeWorkingDirectory(session.workingDirectory),
    createdAt: Number(session.createdAt || Date.now()),
    updatedAt: Number(session.updatedAt || Date.now()),
    messages,
    turns: normalizeStoredTurns(session.turns)
  };
}

function normalizeStoredTurns(value) {
  return (Array.isArray(value) ? value : [])
    .map((turn) => ({
      id: String(turn?.id || ""),
      status: ["in_progress", "completed", "failed", "interrupted"].includes(turn?.status)
        ? turn.status
        : "completed",
      startedAt: Number(turn?.startedAt || Date.now()),
      completedAt: Number(turn?.completedAt || 0),
      durationMs: Number(turn?.durationMs || 0),
      error: String(turn?.error || "")
    }))
    .filter((turn) => turn.id)
    .slice(-MAX_STORED_TURNS);
}

function normalizeSessionSource(source) {
  const value = source && typeof source === "object" ? source : {};
  const type = String(value.type || "manual");
  if (type === "channel") {
    return {
      type: "channel",
      channelType: String(value.channelType || "channel"),
      channelId: String(value.channelId || "channel"),
      peerId: String(value.peerId || "unknown"),
      accountId: String(value.accountId || "")
    };
  }
  return { type: "manual" };
}

function normalizeWorkingDirectory(value) {
  const raw = String(value || "/workspace").trim().replace(/\\+/g, "/");
  if (!raw || raw === ".") return "/workspace";
  const absolute = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}` || "/";
}

function createSession({ title = "Chat", source = { type: "manual" }, messages = [] } = {}) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: String(title || "Chat").slice(0, 120),
    source: normalizeSessionSource(source),
    workingDirectory: "/workspace",
    createdAt: now,
    updatedAt: now,
    messages: normalizeStoredChatMessages(messages),
    turns: []
  };
}

function normalizeStoredChatMessages(value) {
  return (Array.isArray(value) ? value : [])
    .map((message) => ({
      id: String(message?.id || crypto.randomUUID()),
      role: normalizeMessageRole(message?.role),
      content: String(message?.content || ""),
      modelContent: String(message?.modelContent || message?.content || ""),
      hidden: Boolean(message?.hidden),
      excludedFromContext: Boolean(message?.excludedFromContext),
      contextSummary: Boolean(message?.contextSummary),
      turnId: String(message?.turnId || ""),
      itemId: String(message?.itemId || ""),
      kind: String(message?.kind || ""),
      status: String(message?.status || ""),
      tool: String(message?.tool || ""),
      args: message?.args && typeof message.args === "object" ? message.args : undefined,
      result: message?.result,
      durationMs: Number(message?.durationMs || 0),
      plan: Array.isArray(message?.plan) ? message.plan : undefined,
      media: Array.isArray(message?.media) ? message.media : [],
      time: Number(message?.time || Date.now())
    }))
    .filter((message) => message.content)
    .slice(-MAX_STORED_CHAT_MESSAGES);
}

function normalizeMessageRole(role) {
  const value = String(role || "");
  if (["user", "assistant", "tool", "plan", "task", "wechat", "telegram", "channel"].includes(value)) return value;
  return "tool";
}

function activeSession() {
  let session = chatSessions.sessions.find((item) => item.id === chatSessions.activeSessionId);
  if (!session) {
    session = createSession();
    chatSessions.sessions.unshift(session);
    chatSessions.activeSessionId = session.id;
  }
  return session;
}

function renderSessionList() {
  elements.sessionSelect.replaceChildren(
    ...chatSessions.sessions.map((session) => {
      const option = document.createElement("option");
      option.value = session.id;
      option.textContent = sessionLabel(session);
      return option;
    })
  );
  elements.sessionSelect.value = chatSessions.activeSessionId;
  const session = activeSession();
  elements.sessionWorkingDirectory.textContent = session.workingDirectory;
  elements.deleteSession.disabled = chatSessions.sessions.length <= 1;
}

function renderActiveSession() {
  const session = activeSession();
  if (standaloneView !== "workspace") workspacePath = session.workingDirectory;
  storedChatMessages = session.messages;
  elements.messages.replaceChildren();
  activeTaskRunViews.clear();
  renderedWechatEventIds.clear();
  for (const message of storedChatMessages) {
    const isToolTrajectory = message.role === "tool" && isToolTrajectoryContent(message.modelContent);
    if (!message.hidden && !isToolTrajectory) {
      appendMessage(message.role, message.content, {
        persist: false,
        kind: message.kind,
        status: message.status
      });
    }
  }
  rebuildChatContext();
  renderSessionList();
}

function rebuildChatContext() {
  chat.length = 0;
  for (const message of storedChatMessages) {
    if (message.excludedFromContext) continue;
    const isToolTrajectory = message.role === "tool" && isToolTrajectoryContent(message.modelContent);
    const isContextSummary = message.contextSummary || isContextSummaryContent(message.modelContent);
    if (
      message.role === "user" ||
      message.role === "assistant" ||
      message.role === "wechat" ||
      message.role === "telegram" ||
      message.role === "channel" ||
      isToolTrajectory ||
      isContextSummary
    ) {
      chat.push({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.modelContent || message.content,
        media: Array.isArray(message.media) ? message.media : []
      });
    }
  }
}

function sessionLabel(session) {
  const count = Array.isArray(session.messages) ? session.messages.length : 0;
  const source = session.source?.type === "channel"
    ? `${session.source.channelType}:${session.source.channelId}/${session.source.peerId}`
    : "manual";
  return `${session.title || "Chat"} (${source}, ${count})`;
}

async function changeActiveSession() {
  chatSessions.activeSessionId = elements.sessionSelect.value;
  renderActiveSession();
  await persistChatSessions();
  if (standaloneView === "workspace") await renderWorkspace({ preserveEditor: false });
}

async function createManualSession() {
  const session = createSession({ title: nextManualSessionTitle(), source: { type: "manual" } });
  chatSessions.sessions.unshift(session);
  chatSessions.activeSessionId = session.id;
  renderActiveSession();
  await persistChatSessions();
}

async function clearActiveSession() {
  const session = activeSession();
  if (session.messages.length > 0 && !window.confirm(`Clear session "${session.title}"?`)) return;
  await runtimeMessage({ type: "WEBCLAW_DELETE_AGENT_RUNS_FOR_SESSION", sessionId: session.id });
  session.messages = [];
  session.turns = [];
  session.updatedAt = Date.now();
  renderActiveSession();
  await persistChatSessions({ replaceSessionIds: [session.id] });
}

async function deleteActiveSession() {
  const session = activeSession();
  if (chatSessions.sessions.length <= 1) {
    await clearActiveSession();
    return;
  }
  if (!window.confirm(`Delete session "${session.title}"?`)) return;
  const deletedSessionId = session.id;
  await runtimeMessage({ type: "WEBCLAW_DELETE_AGENT_RUNS_FOR_SESSION", sessionId: deletedSessionId });
  chatSessions.sessions = chatSessions.sessions.filter((item) => item.id !== session.id);
  chatSessions.activeSessionId = chatSessions.sessions[0]?.id || "";
  renderActiveSession();
  await persistChatSessions({ deletedSessionIds: [deletedSessionId] });
}

function nextManualSessionTitle() {
  const count = chatSessions.sessions.filter((session) => session.source?.type !== "channel").length + 1;
  return `Chat ${count}`;
}

function persistChatHistory() {
  const session = activeSession();
  session.messages = storedChatMessages.slice(-MAX_STORED_CHAT_MESSAGES);
  session.updatedAt = Date.now();
  chatSessions.sessions = [
    session,
    ...chatSessions.sessions.filter((item) => item.id !== session.id)
  ].slice(0, MAX_STORED_SESSIONS);
  chatSessions.activeSessionId = session.id;
  renderSessionList();
  persistChatSessions();
}

function persistChatSessions(options = {}) {
  const payload = {
    activeSessionId: chatSessions.activeSessionId,
    sessions: chatSessions.sessions.map((session) => ({
      ...session,
      messages: normalizeStoredChatMessages(session.messages)
    })).slice(0, MAX_STORED_SESSIONS)
  };
  chatSessions = normalizeChatSessions(payload);
  const snapshot = structuredClone(chatSessions);
  chatSessionWriteQueue = chatSessionWriteQueue
    .catch(() => {})
    .then(() => runtimeMessage({
      type: "WEBCLAW_SAVE_CHAT_SESSIONS",
      state: snapshot,
      options
    }))
    .catch((error) => {
      elements.status.textContent = `Chat history save failed: ${error.message}`;
    });
  return chatSessionWriteQueue;
}

function recordTurnEvent(event) {
  const turnId = String(event?.turnId || "");
  if (!turnId) return;
  const session = activeSession();
  const existing = (Array.isArray(session.turns) ? session.turns : []).find((turn) => turn.id === turnId);
  const patch = {
    id: turnId,
    status: event.type === "turn_started"
      ? "in_progress"
      : event.type === "turn_interrupted"
        ? "interrupted"
        : event.type === "turn_failed"
          ? "failed"
          : "completed",
    startedAt: Number(event.startedAt || existing?.startedAt || Date.now()),
    completedAt: Number(event.completedAt || existing?.completedAt || 0),
    durationMs: Number(event.durationMs || existing?.durationMs || 0),
    error: String(event.error || existing?.error || "")
  };
  session.turns = [
    ...(Array.isArray(session.turns) ? session.turns : []).filter((turn) => turn.id !== turnId),
    patch
  ].slice(-MAX_STORED_TURNS);
  session.updatedAt = Date.now();
  persistChatSessions();
}

function normalizeContextCompaction(value) {
  if (!value || typeof value !== "object") return null;
  const summary = String(value.summary || "").trim();
  const compactedMessageIds = uniqueStrings(value.compactedMessageIds);
  if (!summary || compactedMessageIds.length === 0) return null;
  return {
    summary,
    compactedMessageIds,
    compactedCount: Number(value.compactedCount || compactedMessageIds.length),
    estimatedTokens: Number(value.estimatedTokens || 0),
    tokenBudget: Number(value.tokenBudget || 0)
  };
}

function applyContextCompaction(value) {
  const compaction = normalizeContextCompaction(value);
  if (!compaction) return Promise.resolve();
  contextCompactionWriteQueue = contextCompactionWriteQueue
    .catch(() => {})
    .then(() => applyContextCompactionNow(compaction));
  return contextCompactionWriteQueue;
}

async function applyContextCompactionNow(compaction) {
  const existingSummary = storedChatMessages.find(
    (message) => !message.excludedFromContext &&
      (message.contextSummary || isContextSummaryContent(message.modelContent)) &&
      message.modelContent === `${CONTEXT_SUMMARY_PREFIX}${compaction.summary}`
  );
  if (existingSummary) return;

  const compactedIds = new Set(compaction.compactedMessageIds);
  for (const message of storedChatMessages) {
    if (compactedIds.has(message.id)) message.excludedFromContext = true;
    if (message.contextSummary || isContextSummaryContent(message.modelContent)) {
      message.excludedFromContext = true;
    }
  }
  storedChatMessages.push({
    id: crypto.randomUUID(),
    role: "tool",
    content: "Context compacted",
    modelContent: `${CONTEXT_SUMMARY_PREFIX}${compaction.summary}`,
    hidden: true,
    excludedFromContext: false,
    contextSummary: true,
    kind: "context_compaction",
    status: "completed",
    media: [],
    time: Date.now()
  });
  while (storedChatMessages.length > MAX_STORED_CHAT_MESSAGES) storedChatMessages.shift();
  rebuildChatContext();
  await persistChatSessions();
}

function isContextSummaryContent(content) {
  return String(content || "").startsWith(CONTEXT_SUMMARY_PREFIX);
}

function handleWechatPayload(payload) {
  const content = buildWechatPromptContent(payload);
  if (!content.trim()) return;
  runtimeMessage({ type: "WEBCLAW_ACK_WECHAT_MESSAGE", queueId: payload.queueId }).catch(() => {});
  submitUserMessage(content, {
    type: "channel",
    channelType: payload.channelType || (payload.channelId === "wechat" ? "wechat" : "channel"),
    channelId: payload.channelId || "wechat",
    accountId: payload.accountId || "",
    peerId: payload.peerId || "",
    messageId: payload.messageId || "",
    contextToken: payload.contextToken || "",
    media: Array.isArray(payload.media) ? payload.media : [],
    timestamp: payload.timestamp || Date.now()
  });
}

function buildWechatPromptContent(payload) {
  const text = String(payload.text || "").trim();
  const media = Array.isArray(payload.media) ? payload.media : [];
  if (media.length === 0) return text;
  const mediaText = media
    .map((item, index) => {
      const size = Number(item.size || 0) > 0 ? `${item.size} bytes` : "unknown size";
      return [
        `媒体 ${index + 1}:`,
        `- kind: ${item.kind || "file"}`,
        `- fileName: ${item.fileName || ""}`,
        `- mime: ${item.mime || ""}`,
        `- size: ${size}`,
        `- mediaId: ${item.mediaId || ""}`,
        `- url: ${item.url || ""}`
      ].join("\n");
    })
    .join("\n\n");
  return [text, mediaText].filter(Boolean).join("\n\n");
}

function processNextWechatMessage() {
  if (activeAgentPort || incomingWechatQueue.length === 0) return;
  const next = incomingWechatQueue.shift();
  submitUserMessage(next.content, next.source);
}

async function sendWechatReply(source, text) {
  try {
    await runtimeMessage({
      type: "WEBCLAW_SEND_WECHAT_MESSAGE",
      payload: {
        type: "agent_result",
        channelId: source.channelId || "wechat",
        peerId: source.peerId,
        contextToken: source.contextToken,
        text
      }
    });
  } catch (error) {
    appendMessage("tool", `Channel reply failed: ${error.message}`);
  }
}

function formatChannelPeerLabel(source) {
  const channelId = source?.channelId || "channel";
  const peerId = source?.peerId || "unknown";
  if (source?.channelType === "telegram") return `${channelId} / Telegram ${peerId}`;
  if (source?.channelType === "wechat" || channelId === "wechat") return `${channelId} / 微信 ${peerId}`;
  return `${channelId} / ${peerId}`;
}

function renderWechatBridgeStatus(status) {
  wechatBridgeLatestStatus = status || {};
  renderChannelList();
  const channelStatuses = Array.isArray(status.channels) ? status.channels : [];
  if (channelStatuses.length > 0) {
    const connected = channelStatuses.filter((item) => item.connected).map((item) => item.channelId);
    const waiting = channelStatuses.filter((item) => !item.connected && item.enabled).map((item) => `${item.channelId}:${item.loginState || "disconnected"}`);
    const errors = channelStatuses.filter((item) => item.lastError).map((item) => `${item.channelId}: ${item.lastError}`);
    elements.wechatBridgeState.textContent = [
      `Channels: connected ${connected.length}/${channelStatuses.length}`,
      connected.length ? `connected=[${connected.join(", ")}]` : "",
      waiting.length ? `waiting=[${waiting.join(", ")}]` : "",
      errors.length ? `errors=[${errors.join("; ")}]` : ""
    ].filter(Boolean).join(". ");
    status = channelStatuses.find((item) => !item.connected && item.qrcodeUrl) || channelStatuses.find((item) => !item.connected && item.enabled) || status;
  }
  if (channelDraft?.type === "wechat") {
    const draftStatus = getChannelRuntimeStatus(channelDraft.id);
    status = draftStatus || {
      enabled: channelDraft.enabled !== false,
      connected: false,
      channelId: channelDraft.id,
      channelType: "wechat",
      loginState: channelDraft.enabled !== false ? "starting" : "idle",
      lastError: "",
      receivedCount: 0,
      pendingCount: 0
    };
  }
  const state = status.connected
    ? "connected"
    : status.loginState === "qr"
      ? "awaiting scan"
      : status.loginState === "starting"
        ? "starting"
        : status.loginState === "scanned"
          ? "scanned"
          : status.loginState === "verify"
            ? "verifying"
            : status.loginState === "relogin"
              ? "reconnecting"
      : status.enabled
        ? "disconnected"
        : "disabled";
  const error = status.lastError ? `, ${status.lastError}` : "";
  const counters = status.receivedCount || status.pendingCount
    ? `, received ${status.receivedCount || 0}, pending ${status.pendingCount || 0}`
    : "";
  const account = status.accountId ? `, account ${status.accountId}` : "";
  const loginState = status.loginState ? `, ${status.loginState}` : "";
  const prompt = status.connected ? "" : " QR login will appear below once the bridge starts.";
  elements.wechatBridgeState.textContent = `WeChat bridge: ${state} (internal bridge)${loginState}${account}${counters}${error}.${prompt}`;
  const showQr = Boolean(
    !status.connected &&
      (status.qrcodeUrl ||
      status.loginState === "qr" ||
      status.loginState === "starting" ||
      status.loginState === "scanned" ||
      status.loginState === "verify" ||
      status.loginState === "relogin")
  );
  elements.wechatQrPanel.classList.toggle("hidden", !showQr);
  if (showQr) {
    const qrPayload = String(status.qrcodeUrl || "");
    if (qrPayload) {
      renderQrCodeToCanvas(elements.wechatQrCanvas, qrPayload, { size: 240, quietZone: 4 });
    } else {
      clearQrCanvas(elements.wechatQrCanvas);
    }
    elements.wechatQrText.textContent = status.connected
      ? "WeChat bridge connected."
      : status.qrcode
        ? `Scan ${status.channelId || "wechat"} QR session: ${status.qrcode}`
        : status.lastError
          ? `Waiting for QR code: ${status.lastError}`
          : "Starting bridge, waiting for QR code...";
  } else {
    clearQrCanvas(elements.wechatQrCanvas);
    elements.wechatQrText.textContent = "";
  }
}

function clearQrCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const width = canvas.width || 240;
  const height = canvas.height || 240;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

async function ensureWechatBridgeConnection() {
  if (wechatAutoConnectStarted || !hasEnabledChannels()) return;
  wechatAutoConnectStarted = true;
  try {
    const response = await runtimeMessage({ type: "WEBCLAW_CONNECT_WECHAT_BRIDGE" });
    renderWechatBridgeStatus(response.result || {});
  } catch (error) {
    renderWechatBridgeStatus({
      enabled: true,
      connected: false,
      lastError: error.message
    });
  }
}

function startWechatDrainTimer() {
  if (wechatDrainTimer) return;
  wechatDrainTimer = window.setInterval(() => {
    if (hasEnabledChannels()) drainWechatAgentEvents();
  }, 2000);
}

function hasEnabledChannels() {
  return normalizePanelChannels(settings).items.some((channel) => channel.enabled);
}

function hasEnabledBackgroundAutomation() {
  return hasEnabledChannels() || normalizePanelSchedules(settings.schedules).some((schedule) => schedule.enabled);
}

async function changeActiveProvider() {
  settings = await loadLatestSettings();
  const previousProviderId = settings.activeProviderId;
  settings.activeProviderId = elements.activeProviderId.value;
  if (hasEnabledBackgroundAutomation() && !(await ensureExternalProviderDisclosureForAutomation(
    `Enabled Channels or Schedules can send tasks and relevant active-session context to ${activeProvider().name} while Chrome is running.`
  ))) {
    settings.activeProviderId = previousProviderId;
    renderSettings();
    return;
  }
  renderSettings();
  try {
    await persistSettings({ silent: true, authorizeCodex: false, authorizeGitHubCopilot: false });
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

async function openNewProviderModal() {
  const baseType = activeProvider()?.type || "ollama";
  const draft = {
    id: crypto.randomUUID(),
    name: defaultProviderName(baseType),
    type: baseType,
    config: structuredClone(PROVIDER_DEFAULTS[baseType])
  };
  await openProviderModal(draft, true);
}

async function openProviderModal(providerOrId, isNew = false) {
  if (providerDirty) {
    const discard = window.confirm("Discard unsaved provider changes?");
    if (!discard) return;
  }
  stopCodexPolling();
  stopGitHubCopilotPolling();
  settings = await loadLatestSettings();
  const provider = typeof providerOrId === "string"
    ? settings.providers.find((item) => item.id === providerOrId)
    : providerOrId;
  if (!provider && !isNew) {
    elements.status.textContent = "Provider not found";
    return;
  }
  providerModalOpen = true;
  providerDraftIsNew = Boolean(isNew || !provider);
  providerDraft = cloneProvider(provider || {
    id: crypto.randomUUID(),
    name: defaultProviderName("ollama"),
    type: "ollama",
    config: structuredClone(PROVIDER_DEFAULTS.ollama)
  });
  providerDirty = false;
  renderProviderModal();
}

function closeProviderModal() {
  if (providerDirty && !window.confirm("Discard unsaved provider changes?")) return;
  providerModalOpen = false;
  providerDraft = null;
  providerDraftIsNew = false;
  providerDirty = false;
  elements.providerModal.classList.add("hidden");
  elements.providerModal.setAttribute("aria-hidden", "true");
  renderSettings();
}

function changeProviderType() {
  if (!providerDraft) return;
  const previousType = providerDraft.type;
  const previousName = elements.providerName.value.trim();
  const nextType = elements.providerType.value;
  const shouldGenerateName = !previousName || previousName === defaultProviderName(previousType);
  providerDraft = {
    ...providerDraft,
    name: shouldGenerateName ? defaultProviderName(nextType) : previousName,
    type: nextType,
    config: structuredClone(PROVIDER_DEFAULTS[nextType])
  };
  providerDirty = true;
  renderProviderModal();
}

async function saveProviderModal() {
  if (!providerDraft) return;
  syncProviderFormToDraft();
  const nextProvider = normalizePanelProvider(providerDraft);
  if (!nextProvider) {
    elements.status.textContent = "Unsupported provider type";
    return;
  }
  settings = await loadLatestSettings();
  const providers = settings.providers.some((provider) => provider.id === nextProvider.id)
    ? settings.providers.map((provider) => (provider.id === nextProvider.id ? nextProvider : provider))
    : [...settings.providers, nextProvider];
  settings = normalizePanelSettings({
    ...settings,
    providers,
    activeProviderId: providerDraftIsNew ? nextProvider.id : settings.activeProviderId
  });
  if (
    settings.activeProviderId === nextProvider.id &&
    hasEnabledBackgroundAutomation() &&
    !(await ensureExternalProviderDisclosureForAutomation(
      `Saving this active Provider allows enabled Channels or Schedules to send tasks and relevant active-session context to ${nextProvider.name} while Chrome is running.`
    ))
  ) return;
  providerModalOpen = false;
  providerDraft = null;
  providerDraftIsNew = false;
  providerDirty = false;
  elements.providerModal.classList.add("hidden");
  elements.providerModal.setAttribute("aria-hidden", "true");
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function deleteDraftProvider() {
  if (!providerDraft) return;
  settings = await loadLatestSettings();
  if (settings.providers.length <= 1 && !providerDraftIsNew) {
    elements.status.textContent = "Keep at least one provider";
    return;
  }
  const label = providerDraftIsNew ? "Discard this new provider draft" : `Delete provider "${providerDraft.name}"?`;
  if (!window.confirm(`${label}`)) return;
  if (!providerDraftIsNew) {
    settings.providers = settings.providers.filter((provider) => provider.id !== providerDraft.id);
    if (settings.activeProviderId === providerDraft.id) {
      settings.activeProviderId = settings.providers[0]?.id || settings.activeProviderId;
    }
  }
  providerModalOpen = false;
  providerDraft = null;
  providerDraftIsNew = false;
  providerDirty = false;
  elements.providerModal.classList.add("hidden");
  elements.providerModal.setAttribute("aria-hidden", "true");
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

function renderToolList() {
  const tools = normalizePanelTools(settings.tools);
  const enabledCount = tools.filter((tool) => tool.enabled).length;
  elements.toolCount.textContent = `${enabledCount}/${tools.length} enabled`;
  const selectedBundle = elements.toolBundle.value;
  const bundles = [...new Set(tools.map((tool) => tool.bundle || tool.type).filter(Boolean))].sort();
  elements.toolBundle.replaceChildren(
    new Option("All bundles", ""),
    ...bundles.map((bundle) => new Option(bundle, bundle))
  );
  elements.toolBundle.value = bundles.includes(selectedBundle) ? selectedBundle : "";
  const query = elements.toolSearch.value.trim().toLowerCase();
  const visibleTools = tools.filter((tool) => {
    if (elements.toolBundle.value && (tool.bundle || tool.type) !== elements.toolBundle.value) return false;
    return !query || `${tool.name} ${tool.title} ${tool.description} ${tool.category} ${tool.bundle}`.toLowerCase().includes(query);
  }).sort((left, right) => String(left.category || left.type).localeCompare(String(right.category || right.type)) || left.name.localeCompare(right.name));
  elements.toolList.replaceChildren(
    ...visibleTools.map((tool) => {
      const item = document.createElement("div");
      item.className = "tool-item";

      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = tool.enabled;
      enabled.addEventListener("change", () => {
        settings.tools = normalizePanelTools(settings.tools).map((current) =>
          current.name === tool.name ? { ...current, enabled: enabled.checked } : current
        );
        renderToolList();
      });

      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = tool.title || tool.name;
      const description = document.createElement("span");
      const optionalPermissions = Array.isArray(tool.optionalPermissions) ? tool.optionalPermissions : [];
      description.textContent = `${tool.name} · ${tool.category || tool.type} · ${tool.bundle || tool.type}${tool.builtin ? " · built-in" : ""}${tool.advanced ? " · optional advanced" : ""}${optionalPermissions.length ? ` · permission: ${optionalPermissions.join(", ")}` : ""}${tool.description ? ` · ${tool.description}` : ""}`;
      text.append(title, description);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary";
      edit.textContent = tool.builtin && ![QIYEWECHAT_NOTIFICATION_TOOL_NAME, WEB_SEARCH_TOOL_NAME].includes(tool.name) ? "View" : "Edit";
      edit.addEventListener("click", () => openToolModal(tool.name));

      item.append(enabled, text, edit);
      if (optionalPermissions.length) {
        chrome.permissions.contains({ permissions: optionalPermissions }).then((granted) => {
          description.dataset.permission = granted ? "granted" : "not-granted";
          description.textContent += granted ? " · granted" : " · not granted";
        }).catch(() => {});
      }
      return item;
    })
  );
}

function openNewToolModal() {
  toolDraft = {
    id: crypto.randomUUID(),
    name: "custom_workflow",
    title: "Custom Workflow",
    type: "workflow",
    description: "Run a natural-language WebClaw workflow.",
    enabled: true,
    builtin: false,
    config: {
      method: "GET",
      url: "",
      headers: "",
      body: "",
      responseLimit: 12000,
      inputSchema: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Input for this workflow."
          }
        },
        required: ["input"]
      },
      instruction: "",
      maxSteps: 4
    }
  };
  toolDraftIsNew = true;
  toolDirty = false;
  toolModalOpen = true;
  renderToolModal();
}

function openToolModal(name) {
  const tool = normalizePanelTools(settings.tools).find((item) => item.name === name);
  if (!tool) return;
  toolDraft = cloneTool(tool);
  toolDraftIsNew = false;
  toolDirty = false;
  toolModalOpen = true;
  renderToolModal();
}

function closeToolModal() {
  if (toolDirty && !window.confirm("Discard unsaved tool changes?")) return;
  closeToolModalNow();
}

function closeToolModalNow() {
  toolModalOpen = false;
  toolDraft = null;
  toolDraftIsNew = false;
  toolDirty = false;
  elements.toolModal.classList.add("hidden");
  elements.toolModal.setAttribute("aria-hidden", "true");
}

function renderToolModal() {
  if (!toolModalOpen || !toolDraft) return;
  elements.toolModal.classList.remove("hidden");
  elements.toolModal.setAttribute("aria-hidden", "false");
  elements.toolModalTitle.textContent = toolDraftIsNew ? "New tool" : "Edit tool";
  elements.toolEditState.textContent = toolDirty ? "Unsaved" : "Saved";
  elements.toolEditState.classList.toggle("dirty", toolDirty);
  elements.toolName.value = toolDraft.name || "";
  elements.toolName.disabled = Boolean(toolDraft.builtin);
  elements.toolTitle.value = toolDraft.title || "";
  elements.toolTitle.disabled = [QIYEWECHAT_NOTIFICATION_TOOL_NAME, WEB_SEARCH_TOOL_NAME].includes(toolDraft.name);
  elements.toolDescription.value = toolDraft.description || "";
  elements.toolType.value = toolDraft.type || "http";
  elements.toolType.disabled = Boolean(toolDraft.builtin);
  elements.toolEnabled.checked = toolDraft.enabled !== false;
  elements.saveTool.textContent = toolDraftIsNew ? "Create tool" : "Save tool";
  elements.deleteTool.disabled = Boolean(toolDraft.builtin);
  elements.deleteTool.textContent = toolDraftIsNew ? "Discard draft" : "Delete";
  const config = normalizeToolConfig(toolDraft.config || {});
  elements.toolHttpMethod.value = config.method;
  elements.toolHttpUrl.value = config.url;
  elements.toolHttpHeaders.value = config.headers;
  elements.toolHttpBody.value = config.body;
  elements.toolResponseLimit.value = config.responseLimit;
  elements.toolWorkflowInputSchema.value = JSON.stringify(config.inputSchema, null, 2);
  elements.toolWorkflowInstruction.value = config.instruction;
  elements.toolWorkflowMaxSteps.value = config.maxSteps;
  elements.toolQiyeWechatWebhookUrl.value = String(toolDraft.config?.webhookUrl || "");
  const webSearchConfig = normalizeWebSearchConfig(toolDraft.config);
  elements.toolWebSearchProvider.value = webSearchConfig.provider;
  elements.toolWebSearchBraveApiKey.value = webSearchConfig.braveApiKey;
  elements.toolWebSearchBraveBaseUrl.value = webSearchConfig.braveBaseUrl;
  elements.toolWebSearchBrowserEngine.value = webSearchConfig.browserEngine;
  elements.toolWebSearchFallback.checked = webSearchConfig.fallbackToBrowser;
  elements.toolWebSearchMaxResults.value = webSearchConfig.maxResults;
  elements.toolWebSearchTimeoutSeconds.value = webSearchConfig.timeoutSeconds;
  elements.toolWebSearchCacheTtlMinutes.value = webSearchConfig.cacheTtlMinutes;
  const activeSection = toolDraft.name === QIYEWECHAT_NOTIFICATION_TOOL_NAME
    ? QIYEWECHAT_NOTIFICATION_TOOL_NAME
    : toolDraft.name === WEB_SEARCH_TOOL_NAME
      ? WEB_SEARCH_TOOL_NAME
    : toolDraft.type || "http";
  document.querySelectorAll(".tool-section").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.toolSection !== activeSection);
  });
}

function changeToolType() {
  if (!toolDraft || toolDraft.builtin) return;
  syncToolFormToDraft();
  toolDraft.type = elements.toolType.value;
  toolDirty = true;
  renderToolModal();
}

async function saveToolModal() {
  if (!toolDraft) return;
  try {
    if (elements.toolType.value === "workflow") {
      parseToolInputSchema(elements.toolWorkflowInputSchema.value);
    }
  } catch (error) {
    elements.status.textContent = error.message;
    return;
  }
  syncToolFormToDraft();
  if (isRemovedBuiltinToolName(toolDraft.name)) {
    elements.status.textContent = `Tool name was removed and is reserved: ${toolDraft.name}`;
    return;
  }
  const nextTool = normalizePanelTool(toolDraft);
  if (!nextTool) {
    elements.status.textContent = "Tool name is required.";
    return;
  }
  const tools = normalizePanelTools(settings.tools);
  if (tools.some((tool) => tool.name === nextTool.name && tool.id !== nextTool.id)) {
    elements.status.textContent = `Tool name already exists: ${nextTool.name}`;
    return;
  }
  if (!nextTool.builtin && nextTool.type === "http" && !nextTool.config.url) {
    elements.status.textContent = "Custom HTTP tool URL is required.";
    return;
  }
  if (!nextTool.builtin && nextTool.type === "workflow" && !nextTool.config.instruction) {
    elements.status.textContent = "Workflow instruction is required.";
    return;
  }
  if (nextTool.name === QIYEWECHAT_NOTIFICATION_TOOL_NAME && nextTool.enabled && !nextTool.config.webhookUrl) {
    elements.status.textContent = "企业微信机器人 webhook is required while this tool is enabled.";
    return;
  }
  if (nextTool.name === QIYEWECHAT_NOTIFICATION_TOOL_NAME && nextTool.enabled) {
    if (!(await requestOriginPermissionsForUrls(
      [nextTool.config.webhookUrl],
      "WebClaw needs access to this enterprise WeChat webhook only when the qiyewechat_notification tool sends a notification you requested."
    ))) return;
  }
  if (nextTool.name === WEB_SEARCH_TOOL_NAME && nextTool.enabled) {
    const webSearchConfig = normalizeWebSearchConfig(nextTool.config);
    if (webSearchConfig.provider === "brave" && !webSearchConfig.braveApiKey) {
      elements.status.textContent = "Brave Search API key is required when provider is Brave.";
      return;
    }
    if (webSearchConfig.braveApiKey && !(await requestOriginPermissionsForUrls(
      [webSearchConfig.braveBaseUrl],
      "WebClaw needs access to the configured Brave Search API endpoint to send search queries and receive structured results."
    ))) return;
  }
  settings.tools = toolDraftIsNew
    ? [...tools, nextTool]
    : tools.map((tool) => (tool.id === nextTool.id || tool.name === nextTool.name ? nextTool : tool));
  closeToolModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function deleteToolModal() {
  if (!toolDraft) return;
  if (toolDraft.builtin) {
    elements.status.textContent = "Built-in tools cannot be deleted. Disable them instead.";
    return;
  }
  if (!window.confirm(toolDraftIsNew ? "Discard this tool draft?" : `Delete tool "${toolDraft.name}"?`)) return;
  settings.tools = normalizePanelTools(settings.tools).filter((tool) => tool.id !== toolDraft.id && tool.name !== toolDraft.name);
  closeToolModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

function syncToolFormToDraft() {
  if (!toolDraft) return;
  let inputSchema = {};
  try {
    inputSchema = parseToolInputSchema(elements.toolWorkflowInputSchema.value);
  } catch {
    inputSchema = normalizeToolConfig(toolDraft.config || {}).inputSchema;
  }
  toolDraft = {
    ...toolDraft,
    name: toolDraft.builtin ? toolDraft.name : normalizeToolName(elements.toolName.value),
    title: [QIYEWECHAT_NOTIFICATION_TOOL_NAME, WEB_SEARCH_TOOL_NAME].includes(toolDraft.name)
      ? toolDraft.name
      : elements.toolTitle.value.trim() || elements.toolName.value.trim(),
    description: elements.toolDescription.value.trim(),
    type: toolDraft.builtin ? toolDraft.type : elements.toolType.value,
    enabled: elements.toolEnabled.checked,
    config: {
      method: elements.toolHttpMethod.value,
      url: elements.toolHttpUrl.value.trim(),
      headers: elements.toolHttpHeaders.value.trim(),
      body: elements.toolHttpBody.value,
      responseLimit: Number(elements.toolResponseLimit.value || 12000),
      inputSchema,
      instruction: elements.toolWorkflowInstruction.value.trim(),
      maxSteps: Number(elements.toolWorkflowMaxSteps.value || 4),
      webhookUrl: elements.toolQiyeWechatWebhookUrl.value.trim(),
      ...normalizeWebSearchConfig({
        provider: elements.toolWebSearchProvider.value,
        braveApiKey: elements.toolWebSearchBraveApiKey.value,
        braveBaseUrl: elements.toolWebSearchBraveBaseUrl.value,
        browserEngine: elements.toolWebSearchBrowserEngine.value,
        fallbackToBrowser: elements.toolWebSearchFallback.checked,
        maxResults: elements.toolWebSearchMaxResults.value,
        timeoutSeconds: elements.toolWebSearchTimeoutSeconds.value,
        cacheTtlMinutes: elements.toolWebSearchCacheTtlMinutes.value
      })
    }
  };
}

function markToolDirty() {
  if (renderingSettings || !toolModalOpen) return;
  toolDirty = true;
  updateToolEditState();
}

function updateToolEditState() {
  if (!toolModalOpen) return;
  elements.toolEditState.textContent = toolDirty ? "Unsaved" : "Saved";
  elements.toolEditState.classList.toggle("dirty", toolDirty);
}

function renderSkillList() {
  const skills = normalizePanelSkills(settings.skills);
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  elements.skillCount.textContent = `${enabledCount}/${skills.length} enabled`;
  elements.skillList.replaceChildren(
    ...skills.map((skill) => {
      const item = document.createElement("div");
      item.className = "tool-item";

      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = skill.enabled;
      enabled.addEventListener("change", () => {
        settings.skills = normalizePanelSkills(settings.skills).map((current) =>
          current.name === skill.name ? { ...current, enabled: enabled.checked } : current
        );
        renderSkillList();
      });

      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = skill.title || skill.name;
      const description = document.createElement("span");
      description.textContent = `${skill.name}${skill.description ? ` · ${skill.description}` : ""}`;
      text.append(title, description);

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openSkillModal(skill.name));

      item.append(enabled, text, edit);
      return item;
    })
  );
}

function openNewSkillModal() {
  skillDraft = {
    id: crypto.randomUUID(),
    name: "custom_skill",
    title: "Custom Skill",
    description: "",
    content: "",
    enabled: true
  };
  skillDraftIsNew = true;
  skillDirty = false;
  skillModalOpen = true;
  renderSkillModal();
}

function openSkillModal(name) {
  const skill = normalizePanelSkills(settings.skills).find((item) => item.name === name);
  if (!skill) return;
  skillDraft = cloneSkill(skill);
  skillDraftIsNew = false;
  skillDirty = false;
  skillModalOpen = true;
  renderSkillModal();
}

function closeSkillModal() {
  if (skillDirty && !window.confirm("Discard unsaved skill changes?")) return;
  closeSkillModalNow();
}

function closeSkillModalNow() {
  skillModalOpen = false;
  skillDraft = null;
  skillDraftIsNew = false;
  skillDirty = false;
  elements.skillModal.classList.add("hidden");
  elements.skillModal.setAttribute("aria-hidden", "true");
}

function renderSkillModal() {
  if (!skillModalOpen || !skillDraft) return;
  elements.skillModal.classList.remove("hidden");
  elements.skillModal.setAttribute("aria-hidden", "false");
  elements.skillModalTitle.textContent = skillDraftIsNew ? "New skill" : "Edit skill";
  elements.skillEditState.textContent = skillDirty ? "Unsaved" : "Saved";
  elements.skillEditState.classList.toggle("dirty", skillDirty);
  elements.skillName.value = skillDraft.name || "";
  elements.skillTitle.value = skillDraft.title || "";
  elements.skillDescription.value = skillDraft.description || "";
  elements.skillContent.value = skillDraft.content || "";
  elements.skillEnabled.checked = skillDraft.enabled !== false;
  elements.saveSkill.textContent = skillDraftIsNew ? "Create skill" : "Save skill";
  elements.deleteSkill.textContent = skillDraftIsNew ? "Discard draft" : "Delete";
}

async function saveSkillModal() {
  if (!skillDraft) return;
  syncSkillFormToDraft();
  const nextSkill = normalizePanelSkill(skillDraft);
  if (!nextSkill) {
    elements.status.textContent = "Skill name is required.";
    return;
  }
  if (!nextSkill.content) {
    elements.status.textContent = "Skill instructions are required.";
    return;
  }
  const skills = normalizePanelSkills(settings.skills);
  if (skills.some((skill) => skill.name === nextSkill.name && skill.id !== nextSkill.id)) {
    elements.status.textContent = `Skill name already exists: ${nextSkill.name}`;
    return;
  }
  settings.skills = skillDraftIsNew
    ? [...skills, nextSkill]
    : skills.map((skill) => (skill.id === nextSkill.id || skill.name === nextSkill.name ? nextSkill : skill));
  closeSkillModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function deleteSkillModal() {
  if (!skillDraft) return;
  if (!window.confirm(skillDraftIsNew ? "Discard this skill draft?" : `Delete skill "${skillDraft.name}"?`)) return;
  settings.skills = normalizePanelSkills(settings.skills).filter((skill) => skill.id !== skillDraft.id && skill.name !== skillDraft.name);
  closeSkillModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

function syncSkillFormToDraft() {
  if (!skillDraft) return;
  skillDraft = {
    ...skillDraft,
    name: normalizeSkillName(elements.skillName.value),
    title: elements.skillTitle.value.trim() || elements.skillName.value.trim(),
    description: elements.skillDescription.value.trim(),
    content: elements.skillContent.value.trim(),
    enabled: elements.skillEnabled.checked
  };
}

function markSkillDirty() {
  if (renderingSettings || !skillModalOpen) return;
  skillDirty = true;
  updateSkillEditState();
}

function updateSkillEditState() {
  if (!skillModalOpen) return;
  elements.skillEditState.textContent = skillDirty ? "Unsaved" : "Saved";
  elements.skillEditState.classList.toggle("dirty", skillDirty);
}

function renderChannelList() {
  const channels = normalizePanelChannels(settings).items;
  const connectedCount = channels.filter((channel) => getChannelRuntimeStatus(channel.id)?.connected).length;
  elements.channelCount.textContent = `${connectedCount}/${channels.length} connected`;
  elements.channelList.replaceChildren(
    ...channels.map((channel) => {
      const item = document.createElement("div");
      item.className = "tool-item";

      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = channel.enabled;
      enabled.addEventListener("change", () => {
        const next = normalizePanelChannels(settings).items.map((current) =>
          current.id === channel.id ? { ...current, enabled: enabled.checked } : current
        );
        settings.channels = channelsObjectFromItems(next);
        settings.wechatBridgeEnabled = Boolean(settings.channels.wechat?.enabled);
        renderChannelList();
      });

      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = channel.title || channel.name;
      const description = document.createElement("span");
      const runtime = getChannelRuntimeStatus(channel.id);
      description.textContent = [
        channel.name,
        channelTypeLabel(channel.type),
        channel.builtin ? "built-in" : "",
        channelRuntimeLabel(channel, runtime)
      ].filter(Boolean).join(" · ");
      text.append(title, description);

      const actions = document.createElement("div");
      actions.className = "item-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary";
      edit.textContent = channel.builtin ? "View" : "Edit";
      edit.addEventListener("click", () => openChannelModal(channel.id));
      actions.append(edit);

      item.append(enabled, text, actions);
      return item;
    })
  );
}

function getChannelRuntimeStatus(channelId) {
  const statuses = Array.isArray(wechatBridgeLatestStatus.channels) ? wechatBridgeLatestStatus.channels : [];
  return statuses.find((status) => status.channelId === channelId) || null;
}

function channelRuntimeLabel(channel, runtime) {
  if (!channel.enabled) return "disabled";
  if (!runtime) return "disconnected";
  if (runtime.connected) return `connected${runtime.accountId ? ` account ${runtime.accountId}` : ""}`;
  if (runtime.loginState === "qr") return "waiting for QR scan";
  if (runtime.loginState === "scanned") return "scanned";
  if (runtime.loginState === "verify") return "verifying";
  if (runtime.loginState === "relogin") return "reconnecting";
  if (runtime.lastError) return `error: ${runtime.lastError}`;
  return "disconnected";
}

function openNewChannelModal() {
  channelDraft = {
    id: crypto.randomUUID(),
    name: "wechat_secondary",
    title: "WeChat Secondary",
    type: "wechat",
    enabled: false,
    builtin: false,
    config: {
      botToken: ""
    }
  };
  channelDraftIsNew = true;
  channelDirty = false;
  channelModalOpen = true;
  renderChannelModal();
}

function openChannelModal(id) {
  const channel = normalizePanelChannels(settings).items.find((item) => item.id === id);
  if (!channel) return;
  channelDraft = cloneChannel(channel);
  channelDraftIsNew = false;
  channelDirty = false;
  channelModalOpen = true;
  renderChannelModal();
}

function closeChannelModal() {
  if (channelDirty && !window.confirm("Discard unsaved channel changes?")) return;
  closeChannelModalNow();
}

function closeChannelModalNow() {
  channelModalOpen = false;
  channelDraft = null;
  channelDraftIsNew = false;
  channelDirty = false;
  elements.channelModal.classList.add("hidden");
  elements.channelModal.setAttribute("aria-hidden", "true");
}

function renderChannelModal() {
  if (!channelModalOpen || !channelDraft) return;
  elements.channelModal.classList.remove("hidden");
  elements.channelModal.setAttribute("aria-hidden", "false");
  elements.channelModalTitle.textContent = channelDraftIsNew ? "New channel" : "Edit channel";
  elements.channelEditState.textContent = channelDirty ? "Unsaved" : "Saved";
  elements.channelEditState.classList.toggle("dirty", channelDirty);
  elements.channelName.value = channelDraft.name || "";
  elements.channelName.disabled = Boolean(channelDraft.builtin);
  elements.channelTitle.value = channelDraft.title || "";
  elements.channelType.value = channelDraft.type || "telegram";
  elements.channelType.disabled = Boolean(channelDraft.builtin);
  elements.channelEnabled.checked = channelDraft.enabled !== false;
  elements.saveChannel.textContent = channelDraftIsNew ? "Create channel" : "Save channel";
  elements.deleteChannel.disabled = Boolean(channelDraft.builtin);
  elements.deleteChannel.textContent = channelDraftIsNew ? "Discard draft" : "Delete";
  const config = channelDraft.config || {};
  elements.telegramBotToken.value = config.botToken || "";
  document.querySelectorAll(".channel-section").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.channelSection !== (channelDraft.type || "telegram"));
  });
  if (channelDraft.type === "wechat") {
    renderWechatBridgeStatus(wechatBridgeLatestStatus);
  }
}

function changeChannelType() {
  if (!channelDraft || channelDraft.builtin) return;
  syncChannelFormToDraft();
  channelDraft.type = elements.channelType.value;
  channelDirty = true;
  renderChannelModal();
}

async function saveChannelModal() {
  if (!channelDraft) return;
  syncChannelFormToDraft();
  const nextChannel = normalizePanelChannel(channelDraft);
  if (!nextChannel) {
    elements.status.textContent = "Channel name is required.";
    return;
  }
  const channels = normalizePanelChannels(settings).items;
  if (channels.some((channel) => channel.name === nextChannel.name && channel.id !== nextChannel.id)) {
    elements.status.textContent = `Channel name already exists: ${nextChannel.name}`;
    return;
  }
  if (nextChannel.enabled) {
    if (!(await requestOriginPermissionsForUrls(
      channelPermissionUrls(nextChannel),
      `WebClaw needs access to ${channelTypeLabel(nextChannel.type)} to receive messages and return model replies for this enabled channel.`
    ))) return;
    if (!(await ensureExternalProviderDisclosureForAutomation(
      `This enabled ${channelTypeLabel(nextChannel.type)} channel can send incoming messages and relevant media to ${activeProvider().name} and return its replies while Chrome is running.`
    ))) return;
  }
  settings.channels = channelsObjectFromItems(
    channelDraftIsNew
      ? [...channels, nextChannel]
      : channels.map((channel) => (channel.id === nextChannel.id ? nextChannel : channel))
  );
  settings.wechatBridgeEnabled = Boolean(settings.channels.wechat?.enabled);
  closeChannelModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function deleteChannelModal() {
  if (!channelDraft) return;
  if (channelDraft.builtin) {
    elements.status.textContent = "Built-in channels cannot be deleted. Disable them instead.";
    return;
  }
  if (!window.confirm(channelDraftIsNew ? "Discard this channel draft?" : `Delete channel "${channelDraft.name}"?`)) return;
  settings.channels = channelsObjectFromItems(
    normalizePanelChannels(settings).items.filter((channel) => channel.id !== channelDraft.id)
  );
  settings.wechatBridgeEnabled = Boolean(settings.channels.wechat?.enabled);
  closeChannelModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

function syncChannelFormToDraft() {
  if (!channelDraft) return;
  channelDraft = {
    ...channelDraft,
    name: channelDraft.builtin ? channelDraft.name : normalizeChannelName(elements.channelName.value),
    title: elements.channelTitle.value.trim() || elements.channelName.value.trim(),
    type: channelDraft.builtin ? channelDraft.type : elements.channelType.value,
    enabled: elements.channelEnabled.checked,
    config: {
      botToken: elements.telegramBotToken.value.trim()
    }
  };
}

function markChannelDirty() {
  if (renderingSettings || !channelModalOpen) return;
  channelDirty = true;
  updateChannelEditState();
}

function updateChannelEditState() {
  if (!channelModalOpen) return;
  elements.channelEditState.textContent = channelDirty ? "Unsaved" : "Saved";
  elements.channelEditState.classList.toggle("dirty", channelDirty);
}

function renderScheduleList() {
  const schedules = normalizePanelSchedules(settings.schedules);
  const enabledCount = schedules.filter((schedule) => schedule.enabled).length;
  elements.scheduleCount.textContent = `${enabledCount}/${schedules.length} enabled`;
  elements.scheduleList.replaceChildren(
    ...schedules.map((schedule) => {
      const item = document.createElement("div");
      item.className = "tool-item";

      const enabled = document.createElement("input");
      enabled.type = "checkbox";
      enabled.checked = schedule.enabled;
      enabled.addEventListener("change", () => {
        settings.schedules = normalizePanelSchedules(settings.schedules).map((current) =>
          current.id === schedule.id ? { ...current, enabled: enabled.checked } : current
        );
        renderScheduleList();
      });

      const text = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = schedule.title || schedule.name;
      const description = document.createElement("span");
      description.textContent = [
        schedule.name,
        schedule.expression,
        schedule.lastRunAt ? `last ${formatDateTime(schedule.lastRunAt)}` : "",
        schedule.nextRunAt ? `next ${formatDateTime(schedule.nextRunAt)}` : "",
        schedule.lastError ? `error ${schedule.lastError}` : ""
      ].filter(Boolean).join(" · ");
      text.append(title, description);

      const actions = document.createElement("div");
      actions.className = "item-actions";

      const run = document.createElement("button");
      run.type = "button";
      run.className = "secondary";
      run.textContent = "Run now";
      run.addEventListener("click", () => runScheduleNow(schedule.id));

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "secondary";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => openScheduleModal(schedule.id));
      actions.append(run, edit);

      item.append(enabled, text, actions);
      return item;
    })
  );
}

function openNewScheduleModal() {
  const now = Date.now();
  scheduleDraft = {
    id: crypto.randomUUID(),
    name: "custom_schedule",
    title: "Custom Schedule",
    expression: "0 9 * * *",
    instruction: "",
    enabled: true,
    lastRunAt: 0,
    nextRunAt: nextScheduleRun("0 9 * * *", now)
  };
  scheduleDraftIsNew = true;
  scheduleDirty = false;
  scheduleModalOpen = true;
  renderScheduleModal();
}

function openScheduleModal(id) {
  const schedule = normalizePanelSchedules(settings.schedules).find((item) => item.id === id);
  if (!schedule) return;
  scheduleDraft = cloneSchedule(schedule);
  scheduleDraftIsNew = false;
  scheduleDirty = false;
  scheduleModalOpen = true;
  renderScheduleModal();
}

function closeScheduleModal() {
  if (scheduleDirty && !window.confirm("Discard unsaved schedule changes?")) return;
  closeScheduleModalNow();
}

function closeScheduleModalNow() {
  scheduleModalOpen = false;
  scheduleDraft = null;
  scheduleDraftIsNew = false;
  scheduleDirty = false;
  elements.scheduleModal.classList.add("hidden");
  elements.scheduleModal.setAttribute("aria-hidden", "true");
}

function renderScheduleModal() {
  if (!scheduleModalOpen || !scheduleDraft) return;
  elements.scheduleModal.classList.remove("hidden");
  elements.scheduleModal.setAttribute("aria-hidden", "false");
  elements.scheduleModalTitle.textContent = scheduleDraftIsNew ? "New schedule" : "Edit schedule";
  elements.scheduleEditState.textContent = scheduleDirty ? "Unsaved" : "Saved";
  elements.scheduleEditState.classList.toggle("dirty", scheduleDirty);
  elements.scheduleName.value = scheduleDraft.name || "";
  elements.scheduleTitle.value = scheduleDraft.title || "";
  elements.scheduleExpression.value = scheduleDraft.expression || "";
  elements.scheduleInstruction.value = scheduleDraft.instruction || "";
  elements.scheduleEnabled.checked = scheduleDraft.enabled !== false;
  elements.saveSchedule.textContent = scheduleDraftIsNew ? "Create schedule" : "Save schedule";
  elements.deleteSchedule.textContent = scheduleDraftIsNew ? "Discard draft" : "Delete";
  const nextRunAt = nextScheduleRun(scheduleDraft.expression, Date.now());
  elements.scheduleNextRun.textContent = nextRunAt
    ? `Next run: ${formatDateTime(nextRunAt)}`
    : "Next run: invalid schedule";
}

async function saveScheduleModal() {
  if (!scheduleDraft) return;
  syncScheduleFormToDraft();
  const nextSchedule = normalizePanelSchedule(scheduleDraft);
  if (!nextSchedule) {
    elements.status.textContent = "Schedule name is required.";
    return;
  }
  if (!nextSchedule.instruction) {
    elements.status.textContent = "Natural language task is required.";
    return;
  }
  if (!nextScheduleRun(nextSchedule.expression, Date.now())) {
    elements.status.textContent = "Schedule expression is invalid.";
    return;
  }
  const schedules = normalizePanelSchedules(settings.schedules);
  if (schedules.some((schedule) => schedule.name === nextSchedule.name && schedule.id !== nextSchedule.id)) {
    elements.status.textContent = `Schedule name already exists: ${nextSchedule.name}`;
    return;
  }
  if (nextSchedule.enabled && !(await ensureExternalProviderDisclosureForAutomation(
    `This optional Schedule can send its natural-language task and relevant active-session context to ${activeProvider().name} while Chrome is running.`
  ))) return;
  settings.schedules = scheduleDraftIsNew
    ? [...schedules, nextSchedule]
    : schedules.map((schedule) => (schedule.id === nextSchedule.id ? nextSchedule : schedule));
  closeScheduleModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function deleteScheduleModal() {
  if (!scheduleDraft) return;
  if (!window.confirm(scheduleDraftIsNew ? "Discard this schedule draft?" : `Delete schedule "${scheduleDraft.name}"?`)) return;
  settings.schedules = normalizePanelSchedules(settings.schedules).filter((schedule) => schedule.id !== scheduleDraft.id);
  closeScheduleModalNow();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function runScheduleNow(scheduleId) {
  if (!(await ensureExternalProviderDisclosureForAutomation(
    `Running this Schedule now sends its task and relevant context to ${activeProvider().name}.`
  ))) return;
  setBusy(true, "Running schedule");
  try {
    await persistSettings({ silent: true, authorizeCodex: false, authorizeGitHubCopilot: false });
    const response = { result: await streamScheduleRun(scheduleId) };
    applySettings((await runtimeMessage({ type: "WEBCLAW_GET_SETTINGS" })).settings);
    const final = String(response.result?.final || "").trim();
    elements.status.textContent = final ? `Schedule completed: ${final.slice(0, 160)}` : "Schedule completed";
  } catch (error) {
    applySettings((await runtimeMessage({ type: "WEBCLAW_GET_SETTINGS" })).settings);
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function syncScheduleFormToDraft() {
  if (!scheduleDraft) return;
  const expression = elements.scheduleExpression.value.trim();
  scheduleDraft = {
    ...scheduleDraft,
    name: normalizeScheduleName(elements.scheduleName.value),
    title: elements.scheduleTitle.value.trim() || elements.scheduleName.value.trim(),
    expression,
    instruction: elements.scheduleInstruction.value.trim(),
    enabled: elements.scheduleEnabled.checked,
    nextRunAt: nextScheduleRun(expression, Date.now())
  };
}

function markScheduleDirty() {
  if (renderingSettings || !scheduleModalOpen) return;
  scheduleDirty = true;
  updateScheduleEditState();
}

function updateScheduleEditState() {
  if (!scheduleModalOpen) return;
  elements.scheduleEditState.textContent = scheduleDirty ? "Unsaved" : "Saved";
  elements.scheduleEditState.classList.toggle("dirty", scheduleDirty);
}

async function saveSettings() {
  const currentTools = normalizePanelTools(settings?.tools);
  const currentSkills = normalizePanelSkills(settings?.skills);
  const currentChannels = normalizePanelChannels(settings).object;
  const currentSchedules = normalizePanelSchedules(settings?.schedules);
  const configuredQiyeWechat = currentTools.find((tool) => tool.name === QIYEWECHAT_NOTIFICATION_TOOL_NAME && tool.enabled);
  const accessUrls = [
    ...Object.values(currentChannels).filter((channel) => channel.enabled).flatMap(channelPermissionUrls),
    configuredQiyeWechat?.config?.webhookUrl || ""
  ];
  if (!(await requestOriginPermissionsForUrls(
    accessUrls,
    "WebClaw needs access only to the enabled Channels and notification service configured in these settings."
  ))) return;
  if (
    (Object.values(currentChannels).some((channel) => channel.enabled) || currentSchedules.some((schedule) => schedule.enabled)) &&
    !(await ensureExternalProviderDisclosureForAutomation(
      `Enabled Channels or Schedules can send their task input and relevant active-session context to ${activeProvider().name} while Chrome is running.`
    ))
  ) return;
  const currentDisclosures = normalizePanelDisclosures(settings.disclosures);
  settings = await loadLatestSettings();
  const latestSchedulesById = new Map(normalizePanelSchedules(settings?.schedules).map((schedule) => [schedule.id, schedule]));
  settings.tools = currentTools;
  settings.skills = currentSkills;
  settings.channels = currentChannels;
  settings.schedules = currentSchedules.map((schedule) => {
    const latest = latestSchedulesById.get(schedule.id);
    if (!latest) return schedule;
    return {
      ...schedule,
      lastRunAt: latest.lastRunAt,
      nextRunAt: latest.expression === schedule.expression ? latest.nextRunAt : schedule.nextRunAt,
      lastResult: latest.lastResult,
      lastError: latest.lastError
    };
  });
  settings.wechatBridgeEnabled = Boolean(currentChannels.wechat?.enabled);
  settings.disclosures = currentDisclosures;
  syncGeneralFormToSettings();
  await persistSettings({ silent: false, authorizeCodex: false, authorizeGitHubCopilot: false });
}

async function persistSettings({ silent, authorizeCodex, authorizeGitHubCopilot }) {
  setBusy(true, silent ? "Saving" : "Saving settings");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    if (authorizeCodex && shouldStartCodexDeviceLogin(activeProvider())) {
      await authorizeActiveCodex();
      return;
    }
    if (authorizeCodex && shouldPollPendingCodex(activeProvider())) {
      startCodexPolling(activeProvider().id);
      elements.status.textContent = "Waiting for ChatGPT sign-in";
      return;
    }
    if (authorizeCodex && activeProvider().type === "codex-oauth" && !activeProvider().config.accessToken) {
      elements.status.textContent = "Sign in with ChatGPT to continue";
      return;
    }
    if (authorizeGitHubCopilot && shouldStartGitHubCopilotDeviceLogin(activeProvider())) {
      await authorizeActiveGitHubCopilot();
      return;
    }
    if (authorizeGitHubCopilot && shouldPollPendingGitHubCopilot(activeProvider())) {
      startGitHubCopilotPolling(activeProvider().id);
      elements.status.textContent = "Waiting for GitHub sign-in";
      return;
    }
    if (
      authorizeGitHubCopilot &&
      activeProvider().type === "github-copilot-oauth" &&
      !activeProvider().config.githubAccessToken
    ) {
      elements.status.textContent = "Sign in with GitHub to continue";
      return;
    }
    elements.status.textContent = silent ? "Ready" : "Settings saved";
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function authorizeActiveCodex() {
  stopCodexPolling();
  syncOpenProviderDraftToSettings();
  syncGeneralFormToSettings();
  if (activeProvider().type !== "codex-oauth" || !activeProvider().config.clientId) {
    elements.status.textContent = "Enter an authorized Codex OAuth client ID before signing in";
    return;
  }
  if (!(await requestOriginPermissionsForUrls(
    providerPermissionUrls(activeProvider()),
    "WebClaw needs access to the configured ChatGPT OAuth and Codex endpoints to sign you in and send model requests."
  ))) return;
  setBusy(true, "Starting ChatGPT sign-in");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    const provider = activeProvider();
    if (provider.type !== "codex-oauth") {
      elements.status.textContent = "Select a Codex provider first";
      return;
    }
    const response = await runtimeMessage({
      type: "WEBCLAW_START_CODEX_DEVICE_LOGIN",
      providerId: provider.id
    });
    applySettings(response.result.settings);
    syncProviderDraftFromSettings(provider.id);
    renderDeviceCode(elements.codexDeviceCodePanel, elements.codexDeviceCode, elements.copyCodexDeviceCode, response.result.userCode);
    elements.status.textContent = `Enter code ${response.result.userCode} in ChatGPT`;
    startCodexPolling(provider.id, response.result.interval);
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function checkActiveCodex() {
  stopCodexPolling();
  syncOpenProviderDraftToSettings();
  syncGeneralFormToSettings();
  setBusy(true, "Checking ChatGPT sign-in");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    const provider = activeProvider();
    if (provider.type !== "codex-oauth") {
      elements.status.textContent = "Select a Codex provider first";
      return;
    }
    if (provider.config.accessToken) {
      elements.status.textContent = "ChatGPT sign-in connected";
      return;
    }
    if (!shouldPollPendingCodex(provider)) {
      elements.status.textContent = "Start ChatGPT sign-in first";
      return;
    }
    const response = await runtimeMessage({
      type: "WEBCLAW_POLL_CODEX_DEVICE_LOGIN",
      providerId: provider.id
    });
    if (response.result.status === "complete") {
      applySettings(response.result.settings);
      syncProviderDraftFromSettings(provider.id);
      renderDeviceCode(elements.codexDeviceCodePanel, elements.codexDeviceCode, elements.copyCodexDeviceCode, "");
      elements.status.textContent = "ChatGPT sign-in connected";
      return;
    }
    if (response.result.settings) {
      applySettings(response.result.settings);
      syncProviderDraftFromSettings(provider.id);
    }
    elements.status.textContent = `Waiting for code ${response.result.userCode}`;
    startCodexPolling(provider.id, response.result.interval);
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function discoverActiveCodex(options = {}) {
  const continueToAuthorize = Boolean(options.continueToAuthorize);
  syncOpenProviderDraftToSettings();
  syncGeneralFormToSettings();
  if (!(await requestOriginPermissionsForUrls(
    providerPermissionUrls(activeProvider()),
    "WebClaw needs access to the configured OAuth issuer to discover its public authorization metadata."
  ))) return;
  setBusy(true, "Discovering OAuth");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    const provider = activeProvider();
    if (provider.type !== "codex-oauth") {
      elements.status.textContent = "Select a Codex provider first";
      return;
    }
    applySettings((await runtimeMessage({
      type: "WEBCLAW_DISCOVER_CODEX_OAUTH",
      providerId: provider.id
    })).settings);
    syncProviderDraftFromSettings(provider.id);
    if (continueToAuthorize && shouldStartCodexDeviceLogin(activeProvider())) {
      await authorizeActiveCodex();
      return;
    }
    elements.status.textContent = "OAuth metadata loaded";
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function clearActiveCodex() {
  setBusy(true, "Clearing");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_CLEAR_CODEX_TOKEN",
      providerId: settings.activeProviderId
    })).settings);
    stopCodexPolling();
    elements.status.textContent = "ChatGPT sign-in cleared";
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function authorizeActiveGitHubCopilot() {
  stopGitHubCopilotPolling();
  syncOpenProviderDraftToSettings();
  syncGeneralFormToSettings();
  if (activeProvider().type !== "github-copilot-oauth" || !activeProvider().config.clientId) {
    elements.status.textContent = "Enter your GitHub OAuth App client ID before signing in";
    return;
  }
  if (!(await requestOriginPermissionsForUrls(
    providerPermissionUrls(activeProvider()),
    "WebClaw needs access to GitHub and Copilot endpoints to complete Device Flow sign-in and send model requests."
  ))) return;
  setBusy(true, "Starting GitHub sign-in");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    const provider = activeProvider();
    if (provider.type !== "github-copilot-oauth") {
      elements.status.textContent = "Select a GitHub Copilot provider first";
      return;
    }
    const response = await runtimeMessage({
      type: "WEBCLAW_START_GITHUB_COPILOT_DEVICE_LOGIN",
      providerId: provider.id
    });
    applySettings(response.result.settings);
    syncProviderDraftFromSettings(provider.id);
    renderDeviceCode(
      elements.githubCopilotDeviceCodePanel,
      elements.githubCopilotDeviceCode,
      elements.copyGitHubCopilotDeviceCode,
      response.result.userCode
    );
    elements.status.textContent = `Enter code ${response.result.userCode} in GitHub`;
    startGitHubCopilotPolling(provider.id, response.result.interval);
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function checkActiveGitHubCopilot() {
  stopGitHubCopilotPolling();
  syncOpenProviderDraftToSettings();
  syncGeneralFormToSettings();
  setBusy(true, "Checking GitHub sign-in");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_SAVE_SETTINGS",
      settings: serializableSettings()
    })).settings);
    const provider = activeProvider();
    if (provider.type !== "github-copilot-oauth") {
      elements.status.textContent = "Select a GitHub Copilot provider first";
      return;
    }
    if (provider.config.githubAccessToken) {
      elements.status.textContent = "GitHub sign-in connected";
      return;
    }
    if (!shouldPollPendingGitHubCopilot(provider)) {
      elements.status.textContent = "Start GitHub sign-in first";
      return;
    }
    const response = await runtimeMessage({
      type: "WEBCLAW_POLL_GITHUB_COPILOT_DEVICE_LOGIN",
      providerId: provider.id
    });
    if (response.result.status === "complete") {
      applySettings(response.result.settings);
      syncProviderDraftFromSettings(provider.id);
      elements.status.textContent = "GitHub sign-in connected";
      return;
    }
    if (response.result.settings) {
      applySettings(response.result.settings);
      syncProviderDraftFromSettings(provider.id);
    }
    elements.status.textContent = `Waiting for code ${response.result.userCode}`;
    startGitHubCopilotPolling(provider.id, response.result.interval);
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

function syncOpenProviderDraftToSettings() {
  if (!providerModalOpen || !providerDraft) return;
  syncProviderFormToDraft();
  const nextProvider = normalizePanelProvider(providerDraft);
  if (!nextProvider) return;
  const providers = settings.providers.some((provider) => provider.id === nextProvider.id)
    ? settings.providers.map((provider) => (provider.id === nextProvider.id ? nextProvider : provider))
    : [...settings.providers, nextProvider];
  settings = normalizePanelSettings({
    ...settings,
    providers,
    activeProviderId: providerDraftIsNew ? nextProvider.id : settings.activeProviderId
  });
}

function syncProviderDraftFromSettings(providerId) {
  if (!providerModalOpen || !providerDraft) return;
  const latest = settings.providers.find((provider) => provider.id === providerId);
  if (!latest) return;
  providerDraft = cloneProvider(latest);
  providerDirty = false;
  renderProviderModal();
}

async function clearActiveGitHubCopilot() {
  setBusy(true, "Clearing");
  try {
    applySettings((await runtimeMessage({
      type: "WEBCLAW_CLEAR_GITHUB_COPILOT_TOKEN",
      providerId: settings.activeProviderId
    })).settings);
    stopGitHubCopilotPolling();
    elements.status.textContent = "GitHub sign-in cleared";
  } catch (error) {
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function refreshActiveProviderModels() {
  if (!providerDraft) return;
  syncProviderFormToDraft();
  const draftProvider = cloneProvider(providerDraft);
  if (!draftProvider) return;
  if (!(await requestOriginPermissionsForUrls(
    providerPermissionUrls(draftProvider),
    `WebClaw needs access to ${draftProvider.name} only to retrieve its available model list.`
  ))) return;
  setBusy(true, "Loading models");
  try {
    const response = await runtimeMessage({
      type: "WEBCLAW_LIST_PROVIDER_MODELS",
      providerId: draftProvider.id,
      provider: draftProvider
    });
    const result = response.result || {};
    if (!Array.isArray(result.models)) {
      throw new Error(
        `Provider model refresh returned invalid models payload: ${safeJsonPreview(result)}`
      );
    }
    const models = uniqueStrings(result.models);
    const modelDetails = Array.isArray(result.modelDetails) ? result.modelDetails : [];
    providerDraft = cloneProvider(providerDraft) || providerDraft;
    providerDraft.config.availableModels = models;
    providerDraft.config.availableModelDetails = modelDetails;
    if (models.length > 0 && !models.includes(providerDraft.config.model)) {
      providerDraft.config.model = models[0];
    }
    renderProviderModal();
    if (providerDraft.type === "ollama") {
      const selectCount = elements.ollamaModelSelect?.options?.length || 0;
      const datalistCount = elements.ollamaModelOptions?.options?.length || 0;
      if (models.length > 0 && (selectCount !== models.length || datalistCount !== models.length)) {
        throw new Error(
          [
            "Ollama model refresh rendered a different number of options than returned by the backend.",
            `returned=${models.length}`,
            `select=${selectCount}`,
            `datalist=${datalistCount}`,
            `provider=${draftProvider.id}`,
            `payload=${safeJsonPreview(result)}`
          ].join(" ")
        );
      }
    }
    if (providerDraftIsNew) {
      providerDirty = true;
    } else {
      settings = normalizePanelSettings({
        ...settings,
        providers: settings.providers.map((provider) =>
          provider.id === draftProvider.id
            ? cloneProvider(providerDraft) || provider
            : provider
        )
      });
      await runtimeMessage({
        type: "WEBCLAW_SAVE_SETTINGS",
        settings: serializableSettings()
      });
      providerDirty = false;
    }
    renderSettings();
    elements.status.textContent = models.length ? `Loaded ${models.length} models` : "No models returned";
  } catch (error) {
    console.error("Provider model refresh failed", error);
    renderProviderModal();
    renderSettings();
    elements.status.textContent = error.message;
  } finally {
    setBusy(false);
  }
}

async function renderWorkspace({ preserveEditor = true } = {}) {
  try {
    const [listing, usage] = await Promise.all([vfsList(workspacePath), vfsGetUsage()]);
    workspacePath = listing.path;
    elements.workspacePath.value = workspacePath;
    elements.workspaceUsage.textContent = `${usage.files} files, ${formatBytes(usage.bytes)}`;
    renderWorkspaceList(listing.entries);
    if (!preserveEditor || (workspaceEditorState && workspaceEditorState.path !== workspaceSelection?.path)) {
      hideWorkspaceEditor();
    }
    return listing;
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
    return null;
  }
}

function renderWorkspaceList(entries) {
  elements.workspaceList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "workspace-empty";
    empty.textContent = "Empty directory";
    elements.workspaceList.append(empty);
    updateWorkspaceActionState();
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("div");
    item.className = "workspace-item";
    item.classList.toggle("selected", entry.path === workspaceSelection?.path);
    item.title = entry.path;

    const icon = document.createElement("span");
    icon.textContent = entry.type === "directory" ? "\uD83D\uDCC1" : "\uD83D\uDCC4";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "workspace-entry-main";
    main.title = entry.type === "directory" ? "Select folder; double-click to open" : entry.path;
    main.addEventListener("click", () => selectWorkspaceEntry(entry));
    if (entry.type === "directory" && !isWorkspaceTrashItem(entry.path)) {
      main.addEventListener("dblclick", () => openWorkspacePath(entry.path));
    }
    const name = document.createElement("span");
    name.className = "workspace-name";
    name.textContent = entry.name;
    const meta = document.createElement("span");
    meta.className = "workspace-meta";
    meta.textContent = entry.trash
      ? `${entry.trash.originalPath} · ${formatDeletedAt(entry.trash.deletedAt)}`
      : entry.type === "directory" ? "Folder" : `${formatBytes(entry.size)} · v${entry.version}`;
    main.append(icon, name, meta);
    item.append(main);
    if (entry.type === "file" && isWebPreviewFile(entry.name) && !isWorkspaceTrashItem(entry.path)) {
      const preview = document.createElement("button");
      preview.type = "button";
      preview.className = "workspace-preview-button";
      preview.title = "Preview in new tab";
      preview.setAttribute("aria-label", `Preview ${entry.name} in new tab`);
      preview.textContent = "\u25B6";
      preview.addEventListener("click", (event) => {
        event.stopPropagation();
        openWorkspacePreview(entry.path);
      });
      item.append(preview);
    }
    elements.workspaceList.append(item);
  }
  updateWorkspaceActionState();
}

function isWebPreviewFile(name) {
  return /\.(?:html?|xhtml|svg|md|markdown|mdown|mkdn|docx|xlsx|pptx|pdf)$/i.test(String(name || ""));
}

async function openWorkspacePreview(path) {
  if (/\.(?:md|markdown|mdown|mkdn|docx|xlsx|pptx|pdf)$/i.test(String(path || ""))) {
    const previewWindow = window.open(chrome.runtime.getURL(`src/document-viewer.html?path=${encodeURIComponent(path)}`), "_blank");
    if (!previewWindow) {
      elements.status.textContent = "Preview was blocked by the browser. Allow pop-ups for WebClaw and try again.";
      return;
    }
    elements.status.textContent = `Preview opened: ${path}`;
    return;
  }
  const previewWindow = window.open(chrome.runtime.getURL("src/preview-sandbox.html"), "_blank");
  if (!previewWindow) {
    elements.status.textContent = "Preview was blocked by the browser. Allow pop-ups for WebClaw and try again.";
    return;
  }
  let delivered = false;
  let previewReady = false;
  let pendingPayload = null;
  const deliver = (payload) => {
    if (delivered || previewWindow.closed || (!payload?.html && !payload?.error)) return;
    pendingPayload = payload;
    if (!previewReady) return;
    delivered = true;
    previewWindow.postMessage(pendingPayload, "*");
  };
  const readyHandler = (event) => {
    if (event.source !== previewWindow || event.data?.type !== "WEBCLAW_PREVIEW_READY") return;
    previewReady = true;
    window.removeEventListener("message", readyHandler);
    if (pendingPayload) deliver(pendingPayload);
  };
  let pendingHtml = "";
  window.addEventListener("message", readyHandler);
  try {
    const storageNamespace = `preview:${parentVirtualPath(path)}`;
    const storageKey = `webclawPreviewLocalStorage:${storageNamespace}`;
    const stored = await chrome.storage.local.get(storageKey);
    pendingHtml = await buildVfsPreviewDocument(path, {
      storageNamespace,
      localStorage: stored[storageKey] && typeof stored[storageKey] === "object" ? stored[storageKey] : {}
    });
    deliver({ type: "WEBCLAW_RENDER_PREVIEW", entryPath: path, html: pendingHtml });
    elements.status.textContent = `Preview opened: ${path}`;
  } catch (error) {
    window.removeEventListener("message", readyHandler);
    deliver({ type: "WEBCLAW_PREVIEW_ERROR", entryPath: path, error: error.message });
    elements.status.textContent = `Preview: ${error.message}`;
  }
}

function handlePreviewMessage(event) {
  const message = event.data;
  if (
    message?.type !== "WEBCLAW_PREVIEW_STORAGE_SET" ||
    !String(message.namespace || "").startsWith("preview:")
  ) return;
  const storageKey = `webclawPreviewLocalStorage:${String(message.namespace)}`;
  chrome.storage.local.get(storageKey).then((stored) => {
    const values = stored[storageKey] && typeof stored[storageKey] === "object" ? stored[storageKey] : {};
    if (message.action === "clear") {
      return chrome.storage.local.set({ [storageKey]: {} });
    }
    if (message.action === "remove") {
      delete values[String(message.key || "")];
    } else {
      values[String(message.key || "")] = String(message.value ?? "");
    }
    return chrome.storage.local.set({ [storageKey]: values });
  }).catch((error) => console.warn("Preview localStorage persistence failed", error));
}

async function openWorkspacePath(path) {
  workspaceSelection = null;
  hideWorkspaceEditor();
  workspacePath = normalizeWorkingDirectory(path);
  updateWorkspaceActionState();
  const listing = await renderWorkspace({ preserveEditor: false });
  if (listing) await persistActiveSessionWorkingDirectory(listing.path);
}

async function persistActiveSessionWorkingDirectory(path) {
  const session = activeSession();
  const nextPath = normalizeWorkingDirectory(path);
  if (session.workingDirectory === nextPath) {
    elements.sessionWorkingDirectory.textContent = nextPath;
    return;
  }
  session.workingDirectory = nextPath;
  session.updatedAt = Date.now();
  renderSessionList();
  await persistChatSessions();
}

async function syncWorkspaceToActiveSession() {
  if (workspaceSyncInProgress || standaloneView !== "workspace") return;
  const nextPath = activeSession().workingDirectory;
  if (workspacePath === nextPath) return;
  workspaceSyncInProgress = true;
  try {
    await openWorkspacePath(nextPath);
  } finally {
    workspaceSyncInProgress = false;
  }
}

async function selectWorkspaceEntry(entry) {
  workspaceSelection = entry;
  updateWorkspaceActionState();
  renderWorkspaceList((await vfsList(workspacePath)).entries);
  if (entry.type === "directory" || isWorkspaceTrashItem(entry.path)) {
    hideWorkspaceEditor();
    return;
  }
  try {
    const file = await vfsReadFile(entry.path, { maxChars: 200_000 });
    if (!file.isText) {
      hideWorkspaceEditor();
      elements.status.textContent = `${entry.name}: binary file, download to inspect.`;
      return;
    }
    if (file.truncated) {
      hideWorkspaceEditor();
      elements.status.textContent = `${entry.name}: text file is too large for the editor.`;
      return;
    }
    workspaceEditorState = { path: entry.path, version: entry.version, mimeType: entry.mimeType || "text/plain" };
    elements.workspaceEditorName.textContent = entry.path;
    elements.workspaceEditorVersion.textContent = `v${entry.version}`;
    elements.workspaceEditorContent.value = file.content;
    elements.workspaceEditor.classList.remove("hidden");
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

function hideWorkspaceEditor() {
  workspaceEditorState = null;
  elements.workspaceEditor.classList.add("hidden");
  elements.workspaceEditorName.textContent = "";
  elements.workspaceEditorContent.value = "";
}

function updateWorkspaceActionState() {
  const selected = workspaceSelection;
  const trashItem = Boolean(selected && isWorkspaceTrashItem(selected.path));
  const inTrash = workspacePath === "/.trash" || isWorkspaceTrashItem(workspacePath);
  elements.workspaceUp.disabled = workspacePath === "/";
  elements.workspaceNewFolder.disabled = inTrash;
  elements.workspaceNewFile.disabled = inTrash;
  elements.workspaceUpload.disabled = inTrash;
  elements.workspaceDownload.disabled = !selected || selected.type !== "file" || trashItem;
  elements.workspaceRename.disabled = !selected || trashItem;
  elements.workspaceMove.disabled = !selected || trashItem;
  elements.workspaceDelete.disabled = !selected || trashItem;
  elements.workspaceRestore.disabled = !trashItem;
  elements.workspacePurge.disabled = !trashItem;
  elements.workspaceEmptyTrash.disabled = workspacePath !== "/.trash";
}

function isWorkspaceTrashItem(path) {
  return String(path || "").startsWith("/.trash/");
}

async function createWorkspaceFolder() {
  if (workspacePath === "/.trash" || isWorkspaceTrashItem(workspacePath)) return;
  const name = window.prompt("Folder name");
  if (!name) return;
  try {
    await vfsMkdir(joinVirtualPath(workspacePath, name), { parents: false });
    await renderWorkspace({ preserveEditor: false });
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function createWorkspaceFile() {
  if (workspacePath === "/.trash" || isWorkspaceTrashItem(workspacePath)) return;
  const name = window.prompt("File name");
  if (!name) return;
  try {
    const result = await vfsWriteFile(joinVirtualPath(workspacePath, name), "", { createParents: false });
    await renderWorkspace({ preserveEditor: false });
    await selectWorkspaceEntry(result.entry);
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function uploadWorkspaceFiles() {
  if (workspacePath === "/.trash" || isWorkspaceTrashItem(workspacePath)) return;
  const files = Array.from(elements.workspaceFileInput.files || []);
  if (!files.length) return;
  try {
    for (const file of files) {
      await vfsWriteFile(joinVirtualPath(workspacePath, file.name), file, {
        mimeType: file.type || "application/octet-stream",
        createParents: false
      });
    }
    elements.status.textContent = `Imported ${files.length} file${files.length === 1 ? "" : "s"}`;
    await renderWorkspace({ preserveEditor: false });
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  } finally {
    elements.workspaceFileInput.value = "";
  }
}

async function saveWorkspaceEditor() {
  if (!workspaceEditorState) return;
  try {
    const result = await vfsWriteFile(workspaceEditorState.path, elements.workspaceEditorContent.value, {
      mimeType: workspaceEditorState.mimeType,
      expectedVersion: workspaceEditorState.version
    });
    workspaceEditorState = { ...workspaceEditorState, version: result.entry.version };
    workspaceSelection = result.entry;
    elements.workspaceEditorVersion.textContent = `v${result.entry.version}`;
    elements.status.textContent = "File saved";
    await renderWorkspace();
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function renameWorkspaceSelection() {
  if (!workspaceSelection || isWorkspaceTrashItem(workspaceSelection.path)) return;
  const name = window.prompt("New name", workspaceSelection.name);
  if (!name || name === workspaceSelection.name) return;
  try {
    const result = await vfsMove(workspaceSelection.path, joinVirtualPath(parentVirtualPath(workspaceSelection.path), name));
    workspaceSelection = { ...workspaceSelection, path: result.destination, name };
    hideWorkspaceEditor();
    await renderWorkspace({ preserveEditor: false });
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function moveWorkspaceSelection() {
  if (!workspaceSelection || isWorkspaceTrashItem(workspaceSelection.path)) return;
  const destination = window.prompt("Move destination", parentVirtualPath(workspaceSelection.path));
  if (!destination) return;
  try {
    await vfsMove(workspaceSelection.path, destination);
    workspaceSelection = null;
    hideWorkspaceEditor();
    await renderWorkspace({ preserveEditor: false });
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function deleteWorkspaceSelection() {
  if (!workspaceSelection || isWorkspaceTrashItem(workspaceSelection.path)) return;
  if (!window.confirm(`Move ${workspaceSelection.name} to trash?`)) return;
  try {
    await vfsDelete(workspaceSelection.path, { recursive: true });
    workspaceSelection = null;
    hideWorkspaceEditor();
    await renderWorkspace({ preserveEditor: false });
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function restoreWorkspaceSelection() {
  if (!workspaceSelection?.path.startsWith("/.trash/")) return;
  const destination = window.prompt("Restore destination", workspaceSelection.trash?.originalPath || `/workspace/${workspaceSelection.name.replace(/^\d+-[\w-]+-/, "")}`);
  if (!destination) return;
  try {
    await finishWorkspaceRestore(destination, { onConflict: "error" });
  } catch (error) {
    if (!String(error.message || "").startsWith("Restore destination already exists:")) {
      elements.status.textContent = `Files: ${error.message}`;
      return;
    }
    const onConflict = window.prompt("Destination already exists. Choose: rename, overwrite, or error", "rename");
    if (!onConflict || !["rename", "overwrite", "error"].includes(onConflict) || onConflict === "error") return;
    const confirmOverwrite = onConflict !== "overwrite" || window.confirm("Move the existing destination to trash, then restore this item?");
    if (!confirmOverwrite) return;
    try {
      await finishWorkspaceRestore(destination, { onConflict, confirmOverwrite });
    } catch (restoreError) {
      elements.status.textContent = `Files: ${restoreError.message}`;
    }
  }
}

async function finishWorkspaceRestore(destination, options) {
  const result = await vfsRestore(workspaceSelection.path, destination, options);
  workspaceSelection = null;
  hideWorkspaceEditor();
  await renderWorkspace({ preserveEditor: false });
  elements.status.textContent = `Restored to ${result.destination}`;
}

async function purgeWorkspaceSelection() {
  if (!workspaceSelection?.path.startsWith("/.trash/")) return;
  if (!window.confirm(`Permanently delete ${workspaceSelection.name}? This cannot be undone.`)) return;
  try {
    await vfsPurge(workspaceSelection.path, { recursive: true });
    workspaceSelection = null;
    hideWorkspaceEditor();
    await renderWorkspace({ preserveEditor: false });
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function emptyWorkspaceTrash() {
  if (workspacePath !== "/.trash") return;
  if (!window.confirm("Permanently delete every item in trash? This cannot be undone.")) return;
  try {
    const result = await vfsEmptyTrash();
    workspaceSelection = null;
    hideWorkspaceEditor();
    await renderWorkspace({ preserveEditor: false });
    elements.status.textContent = `Permanently deleted ${result.purgedCount} item${result.purgedCount === 1 ? "" : "s"}`;
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

async function downloadWorkspaceSelection() {
  if (!workspaceSelection || workspaceSelection.type !== "file") return;
  try {
    const blob = await vfsGetFileBlob(workspaceSelection.path);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = workspaceSelection.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    elements.status.textContent = `Files: ${error.message}`;
  }
}

function parentVirtualPath(path) {
  const normalized = String(path || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") return "/";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function joinVirtualPath(parent, child) {
  const value = String(child || "").trim();
  if (!value) return parent;
  return value.startsWith("/") ? value : `${String(parent || "/").replace(/\/$/, "")}/${value}`;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDeletedAt(value) {
  const date = new Date(Number(value || 0));
  return Number.isNaN(date.getTime()) ? "Deleted" : date.toLocaleString();
}

function renderSettings() {
  renderingSettings = true;
  try {
    settings = normalizePanelSettings(settings);
    renderProviderOptions();
    renderToolList();
    renderSkillList();
    renderChannelList();
    renderScheduleList();
    elements.maxSteps.value = settings.maxSteps;
    elements.taskMaxDepth.value = settings.taskMaxDepth;
    elements.taskMaxTasks.value = settings.taskMaxTasks;
    elements.taskMaxModelSteps.value = settings.taskMaxModelSteps;
    elements.temperature.value = settings.temperature;
    elements.allowUnsafePageJs.checked = Boolean(settings.allowUnsafePageJs);
    elements.disclosureState.textContent = hasAcceptedProductDisclosure() ? "Accepted" : "Not accepted";
  } finally {
    renderingSettings = false;
  }
  if (providerModalOpen) {
    renderProviderModal();
  }
  if (toolModalOpen) {
    renderToolModal();
  }
  if (skillModalOpen) {
    renderSkillModal();
  }
  if (channelModalOpen) {
    renderChannelModal();
  }
  if (scheduleModalOpen) {
    renderScheduleModal();
  }
  runtimeMessage({ type: "WEBCLAW_GET_WECHAT_BRIDGE_STATUS" })
    .then((response) => renderWechatBridgeStatus(response.result || {}))
    .catch(() => renderWechatBridgeStatus({ enabled: false, connected: false }));
  refreshOperationApprovalGrantState();
}

async function refreshOperationApprovalGrantState() {
  try {
    const stored = await chrome.storage.local.get(OPERATION_APPROVAL_GRANTS_KEY);
    const count = Array.isArray(stored[OPERATION_APPROVAL_GRANTS_KEY])
      ? stored[OPERATION_APPROVAL_GRANTS_KEY].filter((grant) => grant?.key && Number(grant?.approvedAt) > 0).length
      : 0;
    elements.approvalGrantState.textContent = count === 0
      ? "No saved scheduled approvals"
      : `${count} saved scheduled approval${count === 1 ? "" : "s"}`;
    elements.clearApprovalGrants.disabled = count === 0;
  } catch (error) {
    elements.approvalGrantState.textContent = `Saved approvals unavailable: ${error.message}`;
  }
}

async function clearSavedOperationApprovals() {
  try {
    await runtimeMessage({ type: "WEBCLAW_CLEAR_OPERATION_APPROVAL_GRANTS" });
    await refreshOperationApprovalGrantState();
    elements.status.textContent = "Saved scheduled approvals cleared";
  } catch (error) {
    elements.status.textContent = error.message;
  }
}

function applySettings(nextSettings) {
  settings = normalizePanelSettings(nextSettings);
  providerDirty = false;
  toolDirty = false;
  skillDirty = false;
  channelDirty = false;
  renderSettings();
  return settings;
}

function markProviderDirty() {
  if (renderingSettings) return;
  providerDirty = true;
  updateProviderEditState();
}

function updateProviderEditState() {
  if (!elements.providerEditState) return;
  elements.providerEditState.textContent = providerDirty ? "Unsaved" : "Saved";
  elements.providerEditState.classList.toggle("dirty", providerDirty);
}

function renderProviderOptions() {
  if (!elements.activeProviderId) return;
  const currentId = settings.activeProviderId;
  elements.activeProviderId.replaceChildren(
    ...settings.providers.map((provider) => {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = `${provider.name} (${providerLabel(provider.type)})${provider.id === currentId ? " · active" : ""}`;
      return option;
    })
  );
  elements.activeProviderId.value = currentId;
  elements.editProvider.disabled = settings.providers.length === 0;
}

function renderProviderModal() {
  if (!providerModalOpen || !providerDraft) return;
  elements.providerModal.classList.remove("hidden");
  elements.providerModal.setAttribute("aria-hidden", "false");
  elements.providerModalTitle.textContent = providerDraftIsNew ? "New provider" : "Edit provider";
  elements.providerName.value = providerDraft.name || defaultProviderName(providerDraft.type);
  elements.providerType.value = providerDraft.type;
  elements.providerEditState.textContent = providerDirty ? "Unsaved" : "Saved";
  elements.providerEditState.classList.toggle("dirty", providerDirty);
  elements.saveProvider.textContent = providerDraftIsNew ? "Create provider" : "Save provider";
  elements.modalDeleteProvider.textContent = providerDraftIsNew ? "Discard draft" : "Delete";
  renderProviderConfig(providerDraft);
  renderProviderSectionsForDraft(providerDraft.type);
}

function renderProviderSectionsForDraft(type) {
  document.querySelectorAll(".provider-section").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.providerSection !== type);
  });
}

function renderProviderConfig(provider) {
  elements.ollamaBaseUrl.value = provider.config.baseUrl || "";
  elements.ollamaModel.value = provider.config.model || "";
  elements.ollamaThinking.checked = provider.config.thinking !== false;
  renderModelOptions(elements.ollamaModelOptions, elements.ollamaModelSelect, provider, "ollama");
  syncModelControls(elements.ollamaModel, elements.ollamaModelSelect);
  elements.openaiBaseUrl.value = provider.config.baseUrl || "";
  elements.openaiApiProtocol.value = normalizeOpenAICompatibleApiProtocol(provider.config.apiProtocol);
  elements.openaiApiKey.value = provider.config.apiKey || "";
  elements.openaiModel.value = provider.config.model || "";
  elements.openaiThinking.checked = provider.config.thinking !== false;
  renderModelOptions(elements.openaiModelOptions, elements.openaiModelSelect, provider, "openai-compatible");
  syncModelControls(elements.openaiModel, elements.openaiModelSelect);
  elements.opencodeBaseUrl.value = provider.config.baseUrl || "";
  elements.opencodeApiKey.value = provider.config.apiKey || "";
  elements.opencodeModel.value = provider.config.model || "";
  elements.opencodeThinking.checked = provider.config.thinking !== false;
  renderModelOptions(elements.opencodeModelOptions, elements.opencodeModelSelect, provider, "opencode");
  syncModelControls(elements.opencodeModel, elements.opencodeModelSelect);
  elements.chromeAIModel.value = provider.config.model || "";
  elements.chromeAIThinking.checked = false;
  elements.chromeAIThinking.disabled = true;
  elements.chromeAIIncludeImages.checked = provider.config.includeImages !== false;
  renderModelOptions(elements.chromeAIModelOptions, elements.chromeAIModelSelect, provider, "chrome-ai");
  syncModelControls(elements.chromeAIModel, elements.chromeAIModelSelect);
  elements.codexIssuerUrl.value = provider.config.issuerUrl || "";
  elements.codexAuthUrl.value = provider.config.authUrl || "";
  elements.codexTokenUrl.value = provider.config.tokenUrl || "";
  elements.codexClientId.value = provider.config.clientId || "";
  elements.codexScope.value = provider.config.scope || "";
  elements.codexBaseUrl.value = provider.config.baseUrl || "";
  elements.codexModel.value = provider.config.model || "";
  elements.codexThinking.checked = provider.config.thinking !== false;
  renderModelOptions(elements.codexModelOptions, elements.codexModelSelect, provider, "codex-oauth");
  syncModelControls(elements.codexModel, elements.codexModelSelect);
  elements.codexTokenState.textContent = codexTokenStateText(provider.config);
  renderDeviceCode(elements.codexDeviceCodePanel, elements.codexDeviceCode, elements.copyCodexDeviceCode, provider.config.userCode || "");
  if (provider.type === "codex-oauth" && shouldPollPendingCodex(provider) && !codexPollTimer) {
    startCodexPolling(provider.id, provider.config.deviceCodeInterval);
  }
  elements.githubCopilotDeviceCodeUrl.value = provider.config.deviceCodeUrl || "";
  elements.githubCopilotAccessTokenUrl.value = provider.config.accessTokenUrl || "";
  elements.githubCopilotClientId.value = provider.config.clientId || "";
  elements.githubCopilotScope.value = provider.config.scope || "";
  elements.githubCopilotTokenUrl.value = provider.config.copilotTokenUrl || "";
  elements.githubCopilotBaseUrl.value = provider.config.baseUrl || "";
  elements.githubCopilotModel.value = provider.config.model || "";
  elements.githubCopilotThinking.checked = provider.config.thinking !== false;
  renderModelOptions(
    elements.githubCopilotModelOptions,
    elements.githubCopilotModelSelect,
    provider,
    "github-copilot-oauth"
  );
  syncModelControls(elements.githubCopilotModel, elements.githubCopilotModelSelect);
  elements.githubCopilotIntegrationId.value = provider.config.integrationId || "";
  elements.githubCopilotTokenState.textContent = githubCopilotTokenStateText(provider.config);
  renderDeviceCode(
    elements.githubCopilotDeviceCodePanel,
    elements.githubCopilotDeviceCode,
    elements.copyGitHubCopilotDeviceCode,
    provider.config.userCode || ""
  );
  if (provider.type === "github-copilot-oauth" && shouldPollPendingGitHubCopilot(provider) && !githubCopilotPollTimer) {
    startGitHubCopilotPolling(provider.id, provider.config.deviceCodeInterval);
  }
}

function renderDeviceCode(panel, codeNode, copyButton, userCode) {
  const code = String(userCode || "").trim();
  panel.classList.toggle("hidden", !code);
  codeNode.textContent = code || "-";
  copyButton.disabled = !code;
}

async function copyDeviceCode(codeNode, label) {
  const code = String(codeNode.textContent || "").trim();
  if (!code || code === "-") return;
  try {
    await navigator.clipboard.writeText(code);
    elements.status.textContent = `Copied ${label} device code ${code}`;
  } catch (error) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(codeNode);
    selection.removeAllRanges();
    selection.addRange(range);
    elements.status.textContent = `Select and copy ${label} device code ${code}`;
  }
}

function renderModelOptions(datalist, select, provider, type) {
  const defaults = PROVIDER_DEFAULTS[type]?.model ? [PROVIDER_DEFAULTS[type].model] : [];
  const refreshed = provider.type === type && Array.isArray(provider.config.availableModels) && provider.config.availableModels.length > 0;
  const options = refreshed
    ? uniqueStrings(provider.config.availableModels)
    : provider.type === type
      ? uniqueStrings([provider.config.model, ...defaults])
      : defaults;
  const detailsById = new Map(
    (Array.isArray(provider.config.availableModelDetails) ? provider.config.availableModelDetails : []).map((model) => [
      model.id,
      model
    ])
  );
  datalist.replaceChildren(
    ...options.map((model) => {
      const option = document.createElement("option");
      option.value = model;
      const details = detailsById.get(model);
      if (details) {
        option.label = [details.name, details.vendor, details.preview ? "preview" : ""].filter(Boolean).join(" - ");
      }
      return option;
    })
  );
  select.replaceChildren(
    ...options.map((model) => {
      const option = document.createElement("option");
      option.value = model;
      const details = detailsById.get(model);
      option.textContent = details
        ? [
            details.name,
            details.vendor ? `(${details.vendor})` : "",
            details.category || "",
            details.preview ? "preview" : ""
          ]
            .filter(Boolean)
            .join(" ")
        : model;
      return option;
    })
  );
  select.value = options.includes(provider.config.model) ? provider.config.model : options[0] || "";
  select.disabled = options.length === 0;
}

function syncSelectedModel(select, input) {
  if (!select.value) return;
  input.value = select.value;
}

function syncModelControls(input, select) {
  if (!input || !select) return;
  input.value = select.value || "";
}

function syncGeneralFormToSettings() {
  settings.maxSteps = Number(elements.maxSteps.value || 8);
  settings.taskMaxDepth = Number(elements.taskMaxDepth.value || 4);
  settings.taskMaxTasks = Number(elements.taskMaxTasks.value || 16);
  settings.taskMaxModelSteps = Number(elements.taskMaxModelSteps.value || 0);
  settings.temperature = Number(elements.temperature.value || 0.2);
  settings.allowUnsafePageJs = elements.allowUnsafePageJs.checked;
  settings.channels = normalizePanelChannels(settings).object;
  settings.wechatBridgeEnabled = Boolean(settings.channels.wechat?.enabled);
}

function syncProviderFormToDraft() {
  if (!providerDraft) return;
  const existingConfig = structuredClone(providerDraft.config || {});
  providerDraft.name = elements.providerName.value.trim() || defaultProviderName(providerDraft.type);
  providerDraft.type = elements.providerType.value;
  providerDraft.config = {
    ...structuredClone(PROVIDER_DEFAULTS[providerDraft.type]),
    ...existingConfig,
    ...readProviderConfig(providerDraft.type)
  };
}

function readProviderConfig(type) {
  if (type === "ollama") {
    return {
      baseUrl: elements.ollamaBaseUrl.value.trim(),
      model: elements.ollamaModel.value.trim(),
      thinking: elements.ollamaThinking.checked
    };
  }
  if (type === "openai-compatible") {
    return {
      baseUrl: elements.openaiBaseUrl.value.trim(),
      apiProtocol: normalizeOpenAICompatibleApiProtocol(elements.openaiApiProtocol.value),
      apiKey: elements.openaiApiKey.value.trim(),
      model: elements.openaiModel.value.trim(),
      thinking: elements.openaiThinking.checked
    };
  }
  if (type === "opencode") {
    return {
      baseUrl: elements.opencodeBaseUrl.value.trim(),
      apiKey: elements.opencodeApiKey.value.trim(),
      model: elements.opencodeModel.value.trim(),
      thinking: elements.opencodeThinking.checked
    };
  }
  if (type === "chrome-ai") {
    return {
      model: elements.chromeAIModel.value.trim() || "gemini-nano",
      thinking: elements.chromeAIThinking.checked,
      includeImages: elements.chromeAIIncludeImages.checked
    };
  }
  if (type === "github-copilot-oauth") {
    return {
      deviceCodeUrl: elements.githubCopilotDeviceCodeUrl.value.trim(),
      accessTokenUrl: elements.githubCopilotAccessTokenUrl.value.trim(),
      clientId: elements.githubCopilotClientId.value.trim(),
      scope: elements.githubCopilotScope.value.trim(),
      copilotTokenUrl: elements.githubCopilotTokenUrl.value.trim(),
      baseUrl: elements.githubCopilotBaseUrl.value.trim(),
      model: elements.githubCopilotModel.value.trim(),
      thinking: elements.githubCopilotThinking.checked,
      integrationId: elements.githubCopilotIntegrationId.value.trim()
    };
  }
  return {
    issuerUrl: elements.codexIssuerUrl.value.trim(),
    authUrl: elements.codexAuthUrl.value.trim(),
    tokenUrl: elements.codexTokenUrl.value.trim(),
    clientId: elements.codexClientId.value.trim(),
    scope: elements.codexScope.value.trim(),
    baseUrl: elements.codexBaseUrl.value.trim(),
    model: elements.codexModel.value.trim(),
    thinking: elements.codexThinking.checked
  };
}

function serializableSettings() {
  return {
    activeProviderId: settings.activeProviderId,
    providers: settings.providers,
    tools: normalizePanelTools(settings.tools),
    skills: normalizePanelSkills(settings.skills),
    schedules: normalizePanelSchedules(settings.schedules),
    maxSteps: settings.maxSteps,
    taskMaxDepth: settings.taskMaxDepth,
    taskMaxTasks: settings.taskMaxTasks,
    taskMaxModelSteps: settings.taskMaxModelSteps,
    temperature: settings.temperature,
    allowUnsafePageJs: settings.allowUnsafePageJs,
    disclosures: normalizePanelDisclosures(settings.disclosures),
    channels: normalizePanelChannels(settings).object,
    wechatBridgeEnabled: Boolean(normalizePanelChannels(settings).object.wechat?.enabled),
    pendingConfigPatches: Array.isArray(settings.pendingConfigPatches) ? settings.pendingConfigPatches : [],
    configChangeLog: Array.isArray(settings.configChangeLog) ? settings.configChangeLog : []
  };
}

function activeProvider() {
  settings = normalizePanelSettings(settings);
  return settings.providers.find((provider) => provider.id === settings.activeProviderId) || settings.providers[0];
}

function cloneProvider(provider) {
  const normalized = normalizePanelProvider(provider);
  return normalized
    ? {
        id: normalized.id,
        name: normalized.name,
        type: normalized.type,
        config: {
          ...structuredClone(PROVIDER_DEFAULTS[normalized.type]),
          ...normalized.config
        }
      }
    : null;
}

function normalizePanelSettings(value) {
  const raw = value && typeof value === "object" ? value : {};
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map(normalizePanelProvider).filter(Boolean)
    : [];
  if (providers.length === 0) {
    providers.push({
      id: "local-ollama",
      name: "Local Ollama",
      type: "ollama",
      config: structuredClone(PROVIDER_DEFAULTS.ollama)
    });
  }
  const activeProviderId = providers.some((provider) => provider.id === raw.activeProviderId)
    ? raw.activeProviderId
    : providers[0].id;
  const channels = normalizePanelChannels(raw);
  return {
    activeProviderId,
    providers,
    tools: normalizePanelTools(raw.tools, { legacyWeComWebhookUrl: raw.weComWebhookUrl }),
    skills: normalizePanelSkills(raw.skills),
    schedules: normalizePanelSchedules(raw.schedules),
    maxSteps: positiveInteger(raw.maxSteps, 8),
    taskMaxDepth: positiveInteger(raw.taskMaxDepth, 4),
    taskMaxTasks: positiveInteger(raw.taskMaxTasks, 16),
    taskMaxModelSteps: nonNegativeInteger(raw.taskMaxModelSteps, 0),
    temperature: clampNumber(raw.temperature, 0, 2, 0.2),
    allowUnsafePageJs: Boolean(raw.allowUnsafePageJs),
    disclosures: normalizePanelDisclosures(raw.disclosures),
    channels: channels.object,
    wechatBridgeEnabled: channels.wechat.enabled,
    pendingConfigPatches: Array.isArray(raw.pendingConfigPatches) ? raw.pendingConfigPatches : [],
    configChangeLog: Array.isArray(raw.configChangeLog) ? raw.configChangeLog : []
  };
}

function normalizePanelChannels(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const channels = source.channels && typeof source.channels === "object" ? source.channels : source;
  const items = [];
  const wechatRaw = channels.wechat && typeof channels.wechat === "object" ? channels.wechat : {};
  items.push(normalizePanelChannel({
    id: "wechat",
    name: "wechat",
    title: wechatRaw.title || "WeChat",
    type: "wechat",
    enabled: wechatRaw.enabled !== undefined ? Boolean(wechatRaw.enabled) : Boolean(source.wechatBridgeEnabled),
    builtin: true,
    config: {}
  }));
  for (const [id, value] of Object.entries(channels)) {
    if (id === "wechat" || !value || typeof value !== "object") continue;
    const channel = normalizePanelChannel({ id, ...value });
    if (channel) items.push(channel);
  }
  const filtered = items.filter(Boolean);
  return {
    items: filtered,
    object: channelsObjectFromItems(filtered),
    wechat: filtered.find((channel) => channel.id === "wechat") || { enabled: false }
  };
}

function channelsObjectFromItems(items) {
  const object = {};
  for (const channel of Array.isArray(items) ? items : []) {
    object[channel.id] = {
      id: channel.id,
      name: channel.name,
      title: channel.title,
      type: channel.type,
      enabled: Boolean(channel.enabled),
      builtin: Boolean(channel.builtin),
      config: normalizeChannelConfig(channel.type, channel.config || {})
    };
  }
  return object;
}

function normalizePanelChannel(channel) {
  const type = channel?.type === "wechat" ? "wechat" : "telegram";
  const name = normalizeChannelName(channel?.name || channel?.title);
  if (!name) return null;
  const id = String(channel.id || name);
  const builtin = id === "wechat" || channel.builtin === true;
  return {
    id,
    name,
    title: String(channel.title || channel.name || channelTypeLabel(type)),
    type,
    enabled: channel.enabled === true,
    builtin,
    config: normalizeChannelConfig(type, channel.config || {})
  };
}

function normalizeChannelConfig(type, config) {
  if (type === "telegram") {
    return {
      botToken: String(config.botToken || "")
    };
  }
  return {};
}

function cloneChannel(channel) {
  const normalized = normalizePanelChannel(channel);
  return normalized ? structuredClone(normalized) : null;
}

function normalizeChannelName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function channelTypeLabel(type) {
  if (type === "wechat") return "WeChat";
  if (type === "telegram") return "Telegram";
  return type || "Channel";
}

function normalizePanelProvider(provider) {
  const type = provider?.type;
  if (!PROVIDER_DEFAULTS[type]) return null;
  const config = {
    ...structuredClone(PROVIDER_DEFAULTS[type]),
    ...(provider.config || {})
  };
  if (type === "codex-oauth" && !String(config.clientId || "").trim()) {
    config.clientId = PROVIDER_DEFAULTS["codex-oauth"].clientId;
  }
  if (type === "github-copilot-oauth" && !String(config.clientId || "").trim()) {
    config.clientId = PROVIDER_DEFAULTS["github-copilot-oauth"].clientId;
  }
  if (type === "github-copilot-oauth") {
    config.integrationId = normalizeCopilotIntegrationId(config.integrationId);
  }
  if (type === "openai-compatible") {
    config.apiProtocol = normalizeOpenAICompatibleApiProtocol(config.apiProtocol);
  }
  return {
    id: String(provider.id || crypto.randomUUID()),
    name: String(provider.name || defaultProviderName(type)),
    type,
    config
  };
}

function normalizePanelTools(value, options = {}) {
  const rawTools = Array.isArray(value) ? value : [];
  const byName = new Map();
  for (const tool of rawTools) {
    const rawName = String(tool?.name || "").trim();
    const name = canonicalPanelToolName(rawName);
    if (name && (!byName.has(name) || rawName === name)) byName.set(name, tool);
  }
  const tools = BUILTIN_TOOLS.map((definition) => {
    const matched = byName.get(definition.name);
    const raw = matched || {};
    const description = normalizeBuiltinToolDescription(definition, raw.description);
    return {
      ...definition,
      id: definition.name,
      title: [QIYEWECHAT_NOTIFICATION_TOOL_NAME, WEB_SEARCH_TOOL_NAME].includes(definition.name)
        ? definition.name
        : String(raw.title || definition.title),
      description,
      enabled: matched ? raw.enabled !== false : !DEFAULT_DISABLED_BUILTIN_TOOLS.has(definition.name),
      advanced: ADVANCED_BUILTIN_TOOLS.has(definition.name),
      config: definition.name === QIYEWECHAT_NOTIFICATION_TOOL_NAME
        ? { webhookUrl: String(raw.config?.webhookUrl || options.legacyWeComWebhookUrl || "") }
        : definition.name === WEB_SEARCH_TOOL_NAME
          ? normalizeWebSearchConfig(raw.config)
          : {}
    };
  });
  for (const raw of rawTools) {
    const name = canonicalPanelToolName(raw?.name);
    if (!raw || raw.builtin || raw.type === "builtin" || BUILTIN_TOOLS.some((tool) => tool.name === name)) continue;
    if (isRemovedBuiltinToolName(name)) continue;
    const tool = normalizePanelTool(raw);
    if (tool) tools.push(tool);
  }
  return tools;
}

function normalizeBuiltinToolDescription(definition, value) {
  const description = String(value || definition.description || "");
  if (definition.name === "fs_shell" && !/\bcd\b/i.test(description)) {
    return `${description} Supports cd <path>; cd changes the current session working directory.`;
  }
  return description;
}

function normalizePanelTool(tool) {
  const name = canonicalPanelToolName(normalizeToolName(tool?.name));
  if (!name || isRemovedBuiltinToolName(name)) return null;
  const builtin = BUILTIN_TOOLS.some((definition) => definition.name === name);
  const rawType = String(tool.type || "workflow");
  const type = builtin ? "builtin" : rawType === "http" ? "http" : "workflow";
  return {
    id: String(tool.id || name),
    name,
    title: builtin && [QIYEWECHAT_NOTIFICATION_TOOL_NAME, WEB_SEARCH_TOOL_NAME].includes(name)
      ? name
      : String(tool.title || name),
    type,
    description: String(tool.description || ""),
    enabled: tool.enabled !== false,
    builtin,
    advanced: ADVANCED_BUILTIN_TOOLS.has(name),
    config: builtin
      ? name === QIYEWECHAT_NOTIFICATION_TOOL_NAME
        ? { webhookUrl: String(tool.config?.webhookUrl || "") }
        : name === WEB_SEARCH_TOOL_NAME
          ? normalizeWebSearchConfig(tool.config)
          : {}
      : normalizeToolConfig(tool.config || {})
  };
}

function canonicalPanelToolName(value) {
  return String(value || "").trim();
}

function normalizeToolConfig(config) {
  const method = String(config.method || "GET").toUpperCase();
  return {
    method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) ? method : "GET",
    url: String(config.url || ""),
    headers: String(config.headers || ""),
    body: String(config.body || ""),
    responseLimit: clampNumber(config.responseLimit, 1000, 60000, 12000),
    inputSchema: normalizeInputSchema(config.inputSchema),
    instruction: String(config.instruction || ""),
    maxSteps: clampNumber(config.maxSteps, 1, 12, 4)
  };
}

function normalizePanelDisclosures(value) {
  const raw = value && typeof value === "object" ? value : {};
  const externalProviders = raw.externalProviders && typeof raw.externalProviders === "object"
    ? Object.fromEntries(
        Object.entries(raw.externalProviders)
          .filter(([id, acceptedAt]) => id && Number(acceptedAt) > 0)
          .map(([id, acceptedAt]) => [String(id), Number(acceptedAt)])
      )
    : {};
  return {
    productVersion: Number(raw.productVersion || 0),
    productAcceptedAt: Number(raw.productAcceptedAt || 0),
    externalProviders
  };
}

function parseToolInputSchema(value) {
  const text = String(value || "").trim();
  if (!text) return { type: "object", properties: {} };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Input schema JSON is invalid: ${error.message}`);
  }
  return normalizeInputSchema(parsed);
}

function normalizeInputSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  return {
    ...schema,
    type: schema.type || "object",
    properties: schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)
      ? schema.properties
      : {},
    required: Array.isArray(schema.required) ? schema.required.map(String) : []
  };
}

function cloneTool(tool) {
  const normalized = normalizePanelTool(tool);
  return normalized ? structuredClone(normalized) : null;
}

function normalizeToolName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function normalizePanelSkills(value) {
  const rawSkills = Array.isArray(value) ? value : [];
  const seen = new Set();
  const skills = [];
  for (const raw of rawSkills) {
    const skill = normalizePanelSkill(raw);
    if (!skill || seen.has(skill.name)) continue;
    seen.add(skill.name);
    skills.push(skill);
  }
  return skills;
}

function normalizePanelSkill(skill) {
  const name = normalizeSkillName(skill?.name || skill?.title);
  if (!name) return null;
  return {
    id: String(skill.id || name),
    name,
    title: String(skill.title || name),
    description: String(skill.description || ""),
    content: String(skill.content || skill.instructions || ""),
    enabled: skill.enabled !== false
  };
}

function cloneSkill(skill) {
  const normalized = normalizePanelSkill(skill);
  return normalized ? structuredClone(normalized) : null;
}

function normalizePanelSchedules(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizePanelSchedule)
    .filter(Boolean);
}

function normalizePanelSchedule(schedule) {
  const name = normalizeScheduleName(schedule?.name || schedule?.title);
  if (!name) return null;
  const expression = String(schedule.expression || schedule.schedule || "").trim();
  const now = Date.now();
  return {
    id: String(schedule.id || name),
    name,
    title: String(schedule.title || schedule.name || name),
    expression,
    instruction: String(schedule.instruction || schedule.task || "").trim(),
      enabled: schedule.enabled !== false,
      lastRunAt: Number(schedule.lastRunAt || 0),
      nextRunAt: Number(schedule.nextRunAt || 0) || nextScheduleRun(expression, now),
      lastResult: String(schedule.lastResult || ""),
      lastError: String(schedule.lastError || "")
    };
}

function cloneSchedule(schedule) {
  const normalized = normalizePanelSchedule(schedule);
  return normalized ? structuredClone(normalized) : null;
}

function normalizeSkillName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function normalizeScheduleName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function nextScheduleRun(expression, afterMs) {
  const parsed = parseScheduleExpression(expression);
  if (!parsed) return 0;
  const after = new Date(Number(afterMs || Date.now()) + 1000);
  if (parsed.type === "interval") return after.getTime() + parsed.minutes * 60000;
  for (let offset = 0; offset <= 366 * 24 * 60; offset += 1) {
    const date = new Date(after.getTime() + offset * 60000);
    date.setSeconds(0, 0);
    if (cronMatches(parsed, date) && date.getTime() > afterMs) return date.getTime();
  }
  return 0;
}

function parseScheduleExpression(expression) {
  const text = String(expression || "").trim().toLowerCase();
  if (!text) return null;
  if (text === "@hourly") return { type: "cron", minute: [0], hour: null, day: null, month: null, weekday: null };
  if (text === "@daily") return { type: "cron", minute: [0], hour: [0], day: null, month: null, weekday: null };
  const every = text.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours)$/);
  if (every) return { type: "interval", minutes: Number(every[1]) * (every[2].startsWith("hour") ? 60 : 1) };
  const chineseEvery = text.match(/^每\s*(\d+)\s*(分钟|小时)$/);
  if (chineseEvery) {
    const minutes = Number(chineseEvery[1]) * (chineseEvery[2] === "小时" ? 60 : 1);
    return minutes > 0 ? { type: "interval", minutes } : null;
  }
  const daily = text.match(/^daily\s+(\d{1,2}):(\d{2})$/);
  if (daily) {
    const hour = Number(daily[1]);
    const minute = Number(daily[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { type: "cron", minute: [minute], hour: [hour], day: null, month: null, weekday: null };
  }
  const chineseDaily = text.match(/^(每天|每日)\s*(\d{1,2})[:：](\d{2})$/);
  if (chineseDaily) {
    const hour = Number(chineseDaily[2]);
    const minute = Number(chineseDaily[3]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { type: "cron", minute: [minute], hour: [hour], day: null, month: null, weekday: null };
  }
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return null;
  const parsed = {
    type: "cron",
    minute: parseCronField(parts[0], 0, 59),
    hour: parseCronField(parts[1], 0, 23),
    day: parseCronField(parts[2], 1, 31),
    month: parseCronField(parts[3], 1, 12),
    weekday: parseCronField(parts[4], 0, 6)
  };
  return [parsed.minute, parsed.hour, parsed.day, parsed.month, parsed.weekday].some((field) => Array.isArray(field) && field.length === 0)
    ? null
    : parsed;
}

function parseCronField(value, min, max) {
  if (value === "*") return null;
  const step = value.match(/^\*\/(\d+)$/);
  if (step) {
    const amount = Number(step[1]);
    if (!amount || amount < 1) return [];
    const values = [];
    for (let current = min; current <= max; current += amount) values.push(current);
    return values;
  }
  const values = String(value || "").split(",").map((part) => Number(part));
  return values.every((number) => Number.isInteger(number) && number >= min && number <= max) ? values : [];
}

function cronMatches(parsed, date) {
  return cronFieldMatches(parsed.minute, date.getMinutes()) &&
    cronFieldMatches(parsed.hour, date.getHours()) &&
    cronFieldMatches(parsed.day, date.getDate()) &&
    cronFieldMatches(parsed.month, date.getMonth() + 1) &&
    cronFieldMatches(parsed.weekday, date.getDay());
}

function cronFieldMatches(values, current) {
  return values === null || values.includes(current);
}

function formatDateTime(value) {
  if (!value) return "";
  return new Date(Number(value)).toLocaleString();
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.floor(number));
}

function nonNegativeInteger(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

function shouldStartCodexDeviceLogin(provider) {
  return Boolean(
    provider.type === "codex-oauth" &&
      !provider.config.accessToken &&
      !provider.config.deviceAuthId &&
      provider.config.issuerUrl &&
      provider.config.clientId
  );
}

function shouldPollPendingCodex(provider) {
  return Boolean(
    provider.type === "codex-oauth" &&
      !provider.config.accessToken &&
      provider.config.deviceAuthId &&
      provider.config.userCode
  );
}

function shouldStartGitHubCopilotDeviceLogin(provider) {
  return Boolean(
    provider.type === "github-copilot-oauth" &&
      !provider.config.githubAccessToken &&
      !provider.config.deviceCode &&
      provider.config.deviceCodeUrl &&
      provider.config.accessTokenUrl &&
      provider.config.clientId
  );
}

function shouldPollPendingGitHubCopilot(provider) {
  return Boolean(
    provider.type === "github-copilot-oauth" &&
      !provider.config.githubAccessToken &&
      provider.config.deviceCode &&
      provider.config.userCode
  );
}

function codexTokenStateText(config) {
  if (config.accessToken) {
    const identity = config.email || config.accountId || "ChatGPT account";
    return `ChatGPT sign-in: connected (${identity})`;
  }
  if (config.userCode) {
    const url = config.verificationUrl || "https://auth.openai.com/codex/device";
    return `ChatGPT sign-in: waiting. Code ${config.userCode}. Open ${url}`;
  }
  return "ChatGPT sign-in: not connected";
}

function githubCopilotTokenStateText(config) {
  if (config.githubAccessToken) {
    const identity = config.userLogin || "GitHub account";
    return `GitHub sign-in: connected (${identity})`;
  }
  if (config.userCode) {
    const url = config.verificationUrl || "https://github.com/login/device";
    return `GitHub sign-in: waiting. Code ${config.userCode}. Open ${url}`;
  }
  return "GitHub sign-in: not connected";
}

function startCodexPolling(providerId, intervalSeconds) {
  stopCodexPolling();
  const delay = Math.max(Number(intervalSeconds || activeProvider().config.deviceCodeInterval || 5), 2) * 1000;

  const poll = async () => {
    try {
      const response = await runtimeMessage({
        type: "WEBCLAW_POLL_CODEX_DEVICE_LOGIN",
        providerId
      });
      if (response.result.status === "complete") {
        applySettings(response.result.settings);
        syncProviderDraftFromSettings(providerId);
        stopCodexPolling();
        elements.status.textContent = "ChatGPT sign-in connected";
        return;
      }
      if (response.result.settings) {
        applySettings(response.result.settings);
        syncProviderDraftFromSettings(providerId);
      }
      elements.status.textContent = `Waiting for code ${response.result.userCode}`;
      codexPollTimer = window.setTimeout(poll, Math.max(Number(response.result.interval || 5), 2) * 1000);
    } catch (error) {
      stopCodexPolling();
      elements.status.textContent = error.message;
    }
  };

  codexPollTimer = window.setTimeout(poll, delay);
}

function startGitHubCopilotPolling(providerId, intervalSeconds) {
  stopGitHubCopilotPolling();
  const delay = Math.max(Number(intervalSeconds || activeProvider().config.deviceCodeInterval || 5), 2) * 1000;

  const poll = async () => {
    try {
      const response = await runtimeMessage({
        type: "WEBCLAW_POLL_GITHUB_COPILOT_DEVICE_LOGIN",
        providerId
      });
      if (response.result.status === "complete") {
        applySettings(response.result.settings);
        syncProviderDraftFromSettings(providerId);
        stopGitHubCopilotPolling();
        renderDeviceCode(
          elements.githubCopilotDeviceCodePanel,
          elements.githubCopilotDeviceCode,
          elements.copyGitHubCopilotDeviceCode,
          ""
        );
        elements.status.textContent = "GitHub sign-in connected";
        return;
      }
      if (response.result.settings) {
        applySettings(response.result.settings);
        syncProviderDraftFromSettings(providerId);
      }
      elements.status.textContent = `Waiting for code ${response.result.userCode}`;
      githubCopilotPollTimer = window.setTimeout(
        poll,
        Math.max(Number(response.result.interval || 5), 2) * 1000
      );
    } catch (error) {
      stopGitHubCopilotPolling();
      elements.status.textContent = error.message;
    }
  };

  githubCopilotPollTimer = window.setTimeout(poll, delay);
}

function stopCodexPolling() {
  if (!codexPollTimer) return;
  window.clearTimeout(codexPollTimer);
  codexPollTimer = null;
}

function stopGitHubCopilotPolling() {
  if (!githubCopilotPollTimer) return;
  window.clearTimeout(githubCopilotPollTimer);
  githubCopilotPollTimer = null;
}

function defaultProviderName(type) {
  if (type === "ollama") return "Local Ollama";
  if (type === "openai-compatible") return "OpenAI Compatible";
  if (type === "opencode") return "OpenCode Zen";
  if (type === "chrome-ai") return "Chrome AI";
  if (type === "codex-oauth") return "Codex OAuth";
  if (type === "github-copilot-oauth") return "GitHub Copilot OAuth";
  return "Provider";
}

function providerLabel(type) {
  if (type === "ollama") return "Ollama";
  if (type === "openai-compatible") return "OpenAI";
  if (type === "opencode") return "OpenCode";
  if (type === "chrome-ai") return "Chrome AI";
  if (type === "codex-oauth") return "Codex";
  if (type === "github-copilot-oauth") return "Copilot";
  return type;
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function safeJsonPreview(value) {
  try {
    return JSON.stringify(value).slice(0, 800);
  } catch (error) {
    return `[unserializable: ${error.message}]`;
  }
}

function normalizeToolTrajectory(value) {
  if (!value || typeof value !== "object") return null;
  const modelContent = String(value.modelContent || "");
  const display = String(value.display || "");
  return isToolTrajectoryContent(modelContent) && display ? { modelContent, display } : null;
}

function isToolTrajectoryContent(content) {
  return String(content || "").startsWith("WEBCLAW_TOOL_TRAJECTORY ");
}

function appendMessage(role, content, options = {}) {
  if (options.hidden) {
    if (options.persist !== false) {
      storedChatMessages.push({
        id: crypto.randomUUID(),
        role: normalizeMessageRole(role),
        content: String(content || ""),
        modelContent: String(options.modelContent || content || ""),
        hidden: true,
        excludedFromContext: Boolean(options.excludedFromContext),
        contextSummary: Boolean(options.contextSummary),
        turnId: String(options.turnId || ""),
        itemId: String(options.itemId || ""),
        kind: String(options.kind || ""),
        status: String(options.status || ""),
        tool: String(options.tool || ""),
        args: options.args,
        result: options.result,
        durationMs: Number(options.durationMs || 0),
        plan: options.plan,
        media: Array.isArray(options.media) ? options.media : [],
        time: Date.now()
      });
      while (storedChatMessages.length > MAX_STORED_CHAT_MESSAGES) storedChatMessages.shift();
      persistChatHistory();
    }
    return null;
  }
  const node = document.createElement(role === "task" ? "details" : "div");
  node.className = `message ${role}`;
  setMessageNodeContent(node, content, options.status);
  if (options.persist !== false) {
    const id = crypto.randomUUID();
    node.dataset.historyId = id;
    storedChatMessages.push({
      id,
      role: normalizeMessageRole(role),
      content: String(content || ""),
      modelContent: String(options.modelContent || content || ""),
      hidden: false,
      excludedFromContext: Boolean(options.excludedFromContext),
      contextSummary: Boolean(options.contextSummary),
      turnId: String(options.turnId || ""),
      itemId: String(options.itemId || ""),
      kind: String(options.kind || ""),
      status: String(options.status || ""),
      tool: String(options.tool || ""),
      args: options.args,
      result: options.result,
      durationMs: Number(options.durationMs || 0),
      plan: options.plan,
      media: Array.isArray(options.media) ? options.media : [],
      time: Date.now()
    });
    while (storedChatMessages.length > MAX_STORED_CHAT_MESSAGES) storedChatMessages.shift();
    persistChatHistory();
  }
  elements.messages.append(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return node;
}

function updateMessage(node, content, options = {}) {
  setMessageNodeContent(node, content, options.status);
  const id = node.dataset.historyId;
  const stored = id ? storedChatMessages.find((message) => message.id === id) : null;
  if (stored) {
    stored.content = String(content || "");
    stored.modelContent = String(content || "");
    if (options.status !== undefined) stored.status = String(options.status || "");
    if (options.result !== undefined) stored.result = options.result;
    if (options.durationMs !== undefined) stored.durationMs = Number(options.durationMs || 0);
    if (options.plan !== undefined) stored.plan = options.plan;
    stored.time = Date.now();
    persistChatHistory();
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function setMessageNodeContent(node, content, status = undefined) {
  const text = String(content || "");
  if (!node.classList.contains("task")) {
    node.textContent = text;
    return;
  }
  const [heading = "Task execution", ...lines] = text.split("\n");
  const summary = document.createElement("summary");
  const state = document.createElement("span");
  state.className = "task-run-state";
  const currentStatus = String(status || node.dataset.status || "in_progress");
  state.textContent = ["in_progress", "running"].includes(currentStatus)
    ? "Running"
    : taskStatusLabel(currentStatus);
  const title = document.createElement("span");
  title.className = "task-run-title";
  title.textContent = heading;
  summary.append(state, title);
  const body = document.createElement("pre");
  body.className = "task-run-body";
  body.textContent = lines.join("\n");
  node.replaceChildren(summary, body);
  if (status !== undefined) node.dataset.status = String(status || "");
  node.open = ["in_progress", "running"].includes(currentStatus);
}

function setBusy(busy, text = "Ready") {
  elements.send.disabled = busy;
  updateStopButtonState();
  elements.sessionSelect.disabled = busy;
  elements.newSession.disabled = busy;
  elements.clearSession.disabled = busy;
  elements.deleteSession.disabled = busy || chatSessions.sessions.length <= 1;
  elements.saveSettings.disabled = busy;
  elements.saveProvider.disabled = busy;
  elements.addProvider.disabled = busy;
  elements.editProvider.disabled = busy || settings?.providers.length === 0;
  elements.modalDeleteProvider.disabled = busy;
  elements.closeProviderModal.disabled = busy;
  elements.discoverCodex.disabled = busy;
  elements.authorizeCodex.disabled = busy;
  elements.checkCodex.disabled = busy;
  elements.clearCodex.disabled = busy;
  elements.authorizeGitHubCopilot.disabled = busy;
  elements.checkGitHubCopilot.disabled = busy;
  elements.clearGitHubCopilot.disabled = busy;
  elements.refreshOllamaModels.disabled = busy;
  elements.refreshOpenAIModels.disabled = busy;
  elements.refreshOpenCodeModels.disabled = busy;
  elements.refreshChromeAIModels.disabled = busy;
  elements.refreshCodexModels.disabled = busy;
  elements.refreshGitHubCopilotModels.disabled = busy;
  elements.addTool.disabled = busy;
  elements.saveTools.disabled = busy;
  elements.saveTool.disabled = busy;
  elements.deleteTool.disabled = busy || Boolean(toolDraft?.builtin);
  elements.addSkill.disabled = busy;
  elements.saveSkills.disabled = busy;
  elements.saveSkill.disabled = busy;
  elements.deleteSkill.disabled = busy;
  elements.addChannel.disabled = busy;
  elements.saveChannels.disabled = busy;
  elements.saveChannel.disabled = busy;
  elements.deleteChannel.disabled = busy || Boolean(channelDraft?.builtin);
  elements.addSchedule.disabled = busy;
  elements.saveSchedules.disabled = busy;
  elements.saveSchedule.disabled = busy;
  elements.deleteSchedule.disabled = busy;
  if (busy) elements.status.textContent = text;
}

function updateStopButtonState() {
  const running = Boolean(activeAgentPort);
  elements.stop.disabled = !running || activeAgentStopRequested;
  elements.stop.textContent = activeAgentStopRequested ? "Stopping" : "Stop";
  elements.stop.setAttribute("aria-label", activeAgentStopRequested ? "Stopping active conversation" : "Stop active conversation");
}

async function runtimeMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "Unknown extension error");
  return response;
}
