# WebClaw Agent Loop 架构与实现

状态：0.6.0 已实现

目标版本：0.6.0

适用范围：WebClaw 浏览器扩展中的主 Agent、Channel、Schedule 与子任务运行时

最后更新：2026-08-11

## 1. 文档目的

本文定义并记录 WebClaw 0.6.0 Agent Loop 的目标架构、运行语义、数据结构、模块边界、错误恢复、上下文管理、持久化策略、迁移步骤与验收标准，也作为后续维护的统一依据。

本文不是单纯的重构建议。实现过程中如需偏离本文定义的核心约束，应先更新设计，再修改代码。

### 1.1 改造边界

本项目的首要目标是重构核心 Agent Loop。本文提到的外围模块改造遵循以下约束：

- 保持 Provider 配置、OAuth、Tool 功能、审批规则、Task、Session、Channel、Schedule、VFS 和 UI 的用户可见行为不变。
- 允许为接入新 Agent Loop 增加 Adapter、Bridge 或兼容事件转换。
- 只有核心 Loop 的状态、恢复或统一协议无法由现有接口承载时，才修改外围模块内部实现。
- 外围改造不得借机引入与 Agent Loop 无关的产品功能、配置项或 UI 重设计。
- 每个阶段先达到行为等价，再单独启用多 Tool Call、纠错和 stuck detection 等核心增强。

因此，“外围功能不变”指业务语义和外部契约兼容，不代表外围代码完全禁止修改。

## 2. 背景

WebClaw 已经具备以下 Agent 能力：

- 多 Provider，并支持 Codex、GitHub Copilot、Ollama、OpenAI-compatible、OpenCode 和 Chrome AI。
- 浏览器页面操作、网络请求、VFS、知识库、Tools、Skills、Schedules 与 Channels。
- 会话历史、工具轨迹、上下文压缩、审批、停止与流式输出。
- 任务栈和独立子任务上下文。
- 微信、Telegram 等远程通道，并能通过通道完成审批。

当前核心循环集中在 `src/background.js` 的 `runAgent()`。它已经实现基本的 Model -> Tool -> Model 循环，但协议解析、模型调用、上下文构造、工具调度、错误处理、任务状态和结束判断耦合在一个函数中。随着 Provider、Tool、Channel 和长期任务增加，这种结构会带来以下问题：

1. 单个模型响应只能稳定处理一个 Tool Call。
2. Provider 输出差异容易泄漏到外层循环。
3. 错误恢复策略依赖局部 `try/catch`，难以一致处理。
4. `maxSteps` 同时承担多种预算含义。
5. Service Worker 被回收后无法从 turn 中间边界恢复。
6. 压缩后的模型上下文与完整执行事实没有严格分离。
7. 缺少通用的重复调用、无进展和卡死检测。
8. 审批、工具执行、Channel 回复等副作用缺少统一幂等语义。

## 3. 调研结论

本设计参考以下 Agent Harness 的公开实现和设计：

- Codex：typed turn item、流式生命周期、同一 turn 内 follow-up、工具并行、取消、pending input、自动压缩。
- Claude Code：权限系统、生命周期 hooks、session resume/fork、checkpoint/rewind、subagent 隔离。
- OpenHands：事件溯源、无状态 Agent step、Action/Observation、Condenser、stuck detector、资源锁。
- SWE-agent：Agent-Computer Interface、格式错误反馈、临时纠错上下文、轨迹保存。
- mini-SWE-agent：简单、线性、可重放的循环设计。
- LangGraph：checkpoint、interrupt/resume、durable execution、pending writes。
- Goose：Provider 无关、MCP/Skills/Recipes/Subagent 组合能力。

综合结论是：

> 模型负责提出下一步行动；Agent Runtime 负责确定性状态迁移、权限、执行、恢复、预算和持久化。

WebClaw 不应复制某个产品的完整框架，而应采用适合 Chrome 扩展环境的事件溯源状态机。

## 4. 设计目标

### 4.1 核心目标

1. 所有 Provider 使用同一套外层 Agent Loop。
2. Agent 执行过程可观察、可停止、可恢复、可审计。
3. 完整执行事实与模型可见上下文分离。
4. 支持一次模型响应中的多个 Tool Call。
5. 支持无冲突工具并行，并保证有副作用工具的安全性。
6. 对协议错误、参数错误、网络错误和上下文超限进行分层恢复。
7. 在 Side Panel 未打开时继续处理 Channel 和 Schedule 任务。
8. Service Worker 重启后能够恢复等待审批或未完成的 run。
9. 保留现有任务栈的嵌套子任务能力，并纳入统一运行时。
10. 让 UI 能准确展示 Agent 当前阶段，而不是只显示“Thinking”。

### 4.2 非目标

本轮改造不要求：

- 把 Agent Loop 改造成通用 DAG/Workflow 引擎。
- 为每个 Provider 建立独立运行机制。
- 默认让所有工具并行。
- 对已开始的外部不可逆操作提供真正的事务回滚。
- 自动保存或展示模型私有 reasoning 内容。
- 用另一个模型评估每一步是否正确。
- 一次性重写全部 `background.js`。

## 5. 核心原则

### 5.1 Provider 无关

Agent Runtime 只能依赖统一的 `ProviderAdapter` 接口，不得根据 Provider 类型改变外层状态迁移。

允许存在于 Provider 层的差异包括：

- Chat Completions、Responses、Prompt API 等请求格式。
- 原生 Function Calling 与 JSON 文本协议。
- Structured Output 参数。
- Thinking/Reasoning 参数。
- 流式事件格式。
- 图片和文件输入格式。
- Provider 自身的会话或 response ID。

不得存在于 Provider 层的行为包括：

- 是否执行工具。
- 工具审批策略。
- Agent 是否继续循环。
- Tool Call 错误如何反馈。
- 任务栈调度。
- Context compaction 的全局策略。
- Agent run 的完成、失败或暂停状态。

### 5.2 事件是事实，消息是投影

完整执行过程保存为 append-only 事件。发送给模型的 messages/input 是根据事件和当前状态生成的投影，不是唯一事实来源。

### 5.3 每个边界可恢复

模型响应、审批决定、工具结果、压缩结果和任务切换都必须形成稳定边界。浏览器进程或 Service Worker 在边界之后终止，不应导致已完成副作用被重复执行。

### 5.4 错误应反馈给正确的责任方

- Provider 网络错误由 Retry Policy 处理。
- 模型协议错误反馈给模型纠正。
- Tool 参数错误以结构化 Observation 反馈给模型。
- 用户拒绝授权是明确结果，不是系统异常。
- Runtime 内部不变量破坏才标记为内部失败。

### 5.5 简单循环，模块化策略

核心仍是清晰的 `while` 状态机，不引入通用图执行框架。复杂性通过独立策略模块处理，而不是把所有分支写回主循环。

## 6. 目标运行模型

### 6.1 层次结构

```text
Channel / Side Panel / Schedule / Internal Trigger
                       |
                       v
                  AgentService
                       |
                       v
                   AgentRunner
        +--------------+---------------+
        |              |               |
 ContextProjector  ProviderAdapter  RecoveryPolicy
        |              |               |
        +---------- ToolScheduler ------+
                       |
              Approval + ToolRuntime
                       |
                    RunStore
```

### 6.2 主状态机

```text
CREATED
  -> INGESTING
  -> BUILDING_CONTEXT
  -> SAMPLING_MODEL
  -> NORMALIZING_RESPONSE
  -> VALIDATING_ACTIONS
  -> WAITING_APPROVAL       -- 可暂停并持久化
  -> EXECUTING_TOOLS
  -> RECORDING_OBSERVATIONS
  -> EVALUATING_PROGRESS
       -> BUILDING_CONTEXT  -- 继续
       -> COMPACTING        -- 压缩后继续
       -> WAITING_INPUT     -- 等待用户或外部事件
       -> COMPLETED
       -> FAILED
       -> STUCK
       -> CANCELLED
```

### 6.3 状态定义

| 状态 | 含义 | 是否终态 |
| --- | --- | --- |
| `created` | Run 已创建但未处理输入 | 否 |
| `ingesting` | 记录输入、路由和附件 | 否 |
| `building_context` | 生成本次模型可见上下文 | 否 |
| `sampling_model` | Provider 请求进行中 | 否 |
| `normalizing_response` | Provider 输出转换为统一结构 | 否 |
| `validating_actions` | 校验 Tool Call、最终输出和协议 | 否 |
| `waiting_approval` | 等待 Side Panel 或 Channel 授权 | 否 |
| `executing_tools` | 执行一个工具批次 | 否 |
| `recording_observations` | 保存工具结果和副作用摘要 | 否 |
| `evaluating_progress` | 决定继续、压缩、等待或结束 | 否 |
| `compacting` | 生成新的上下文摘要投影 | 否 |
| `waiting_input` | 当前 turn 没有更多动作，等待新输入 | 否 |
| `completed` | 正常完成 | 是 |
| `failed` | 不可恢复失败 | 是 |
| `stuck` | 检测到无进展循环 | 是 |
| `cancelled` | 用户或系统取消 | 是 |

状态迁移必须由 `AgentRunner` 执行。UI、Provider、Tool 和 Channel 只能发送事件或返回结果，不能直接改变 run 状态。

## 7. 统一数据结构

以下结构是概念契约，实际实现可以使用 JSDoc typedef 和运行时校验器。

### 7.1 AgentRunState

```js
{
  schemaVersion: 1,
  runId: "run-...",
  turnId: "turn-...",
  sessionId: "session-...",
  source: {
    type: "sidepanel | channel | schedule | internal",
    channelId: "",
    peerId: "",
    scheduleId: ""
  },
  provider: {
    providerId: "...",
    providerType: "...",
    model: "..."
  },
  status: "building_context",
  statusReason: "",
  eventCursor: 0,
  contextRevision: 0,
  workingDirectory: "/workspace",
  taskRunId: "",
  taskFrameId: "",
  pendingModelAttempt: null,
  pendingToolCalls: [],
  pendingApproval: null,
  budgets: {},
  counters: {},
  retryState: {},
  progressState: {},
  lease: {
    ownerId: "",
    expiresAt: 0,
    heartbeatAt: 0
  },
  createdAt: 0,
  updatedAt: 0,
  completedAt: 0
}
```

Run 创建后固定记录 `providerId` 和实际 model。用户在运行中切换默认 Provider，只影响下一个根 turn；子任务是否继承或覆盖 Provider 由任务规范明确决定。

### 7.2 AgentEvent

```js
{
  schemaVersion: 1,
  eventId: "event-...",
  sequence: 42,
  runId: "run-...",
  turnId: "turn-...",
  taskFrameId: "task-...",
  type: "tool_call_completed",
  timestamp: 0,
  payload: {},
  visibility: "model | user | internal",
  sensitivity: "normal | secret | private"
}
```

要求：

- `sequence` 在单个 run 内严格递增。
- `eventId` 全局唯一。
- 已写入事件不可原地修改；修正通过新事件表达。
- secret 数据不得进入模型投影或普通日志。
- UI 展示与模型可见性分别控制。

### 7.3 ModelTurn

所有 Provider Adapter 必须返回：

```js
{
  attemptId: "attempt-...",
  items: [
    { type: "assistant_text", text: "..." },
    {
      type: "tool_call",
      callId: "call-...",
      name: "fs_shell",
      args: { command: "ls" },
      rawArguments: "{...}"
    }
  ],
  finishReason: "stop | tool_calls | length | content_filter | error | unknown",
  usage: {
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null
  },
  providerState: {
    responseId: "",
    conversationId: ""
  },
  rawOutputRef: ""
}
```

约束：

- 一次响应可以包含零到多个 Tool Call。
- 文本和 Tool Call 可以同时存在。
- Adapter 不执行 Tool。
- Adapter 不决定 run 是否完成。
- 原始输出较大时写入受控存储，只在事件中保留引用。

### 7.4 ToolCallRecord

```js
{
  callId: "call-...",
  runId: "run-...",
  batchId: "batch-...",
  toolName: "fs_write",
  args: {},
  canonicalArgsHash: "sha256-...",
  effects: ["vfs.write"],
  resources: ["vfs:/workspace/app.js"],
  risk: "read | write | external | unsafe",
  idempotency: "safe | keyed | unsafe",
  approval: {},
  status: "proposed | approved | running | completed | failed | rejected | cancelled",
  attempt: 1,
  resultRef: "",
  startedAt: 0,
  completedAt: 0
}
```

### 7.5 ToolObservation

```js
{
  callId: "call-...",
  toolName: "fs_shell",
  ok: false,
  output: null,
  error: {
    type: "tool_input_validation_error",
    message: "command is required",
    retryable: true,
    validationErrors: [
      { path: "$.command", message: "is required" }
    ],
    expectedSchema: {},
    validExample: { command: "ls" }
  },
  artifacts: [],
  stateChanges: [],
  truncated: false,
  fullResultRef: ""
}
```

Tool 失败必须以 Observation 返回给模型。只有 Runtime 无法继续工作时才抛出 run 级异常。

## 8. 模块划分

建议最终形成以下模块。当前项目源码采用扁平目录，渐进迁移阶段先使用
`src/agent-model-turn.js`、`src/agent-runner.js` 等顶层文件，避免仅为目录结构制造大范围 import 变更；职责稳定后再决定是否移动到子目录。命名可在实施时微调，但职责不可重新混合。

```text
src/agent/
  agent-service.js
  agent-runner.js
  agent-state.js
  agent-events.js
  agent-errors.js
  agent-budgets.js
  agent-progress.js
  context-projector.js
  context-compactor.js
  recovery-policy.js
  run-store.js
  checkpoint-store.js
  tool-scheduler.js
  tool-policy.js
  tool-resources.js
  task-supervisor.js
  provider-adapter.js
```

### 8.1 AgentService

负责：

- 接收 Side Panel、Channel、Schedule 和内部请求。
- 创建、恢复、取消 Agent Run。
- 保证同一 session 的输入顺序。
- 将 Agent Event 广播给 UI 和 Channel 路由。
- 管理后台活跃 run 注册表。

不负责模型协议或工具执行。

### 8.2 AgentRunner

负责：

- 执行状态机。
- 在每个边界写 checkpoint。
- 调用 ContextProjector、ProviderAdapter、ToolScheduler 和 RecoveryPolicy。
- 产生统一生命周期事件。
- 根据确定性规则决定下一状态。

AgentRunner 不包含具体 Provider URL、Tool switch 或 UI DOM 逻辑。

### 8.3 ProviderAdapter

统一接口：

```js
class ProviderAdapter {
  capabilities(provider) {}
  async sample(request, runtime) {}
  async compact(request, runtime) {}
  classifyError(error) {}
  estimateTokens(input) {}
}
```

`sample()` 输入必须使用统一请求：

```js
{
  model,
  instructions,
  inputItems,
  tools,
  outputSchema,
  thinking,
  stream,
  signal,
  previousProviderState
}
```

Adapter capabilities 至少包含：

```js
{
  nativeTools: true,
  multipleToolCalls: true,
  parallelToolCalls: true,
  structuredOutput: "native | json | prompt | none",
  streaming: true,
  imageInput: true,
  fileInput: true,
  contextWindow: null,
  compaction: "provider | model | local"
}
```

### 8.4 ContextProjector

负责从事件、session、任务和 VFS 初始化文件中构造模型可见输入。它不得修改完整事件日志。

### 8.5 ToolScheduler

负责：

- Tool 名称规范化与查找。
- JSON Schema 参数校验。
- effects/resources/risk 解析。
- 审批合并与等待。
- 并行分组与资源锁。
- 幂等检查。
- 执行、超时、取消和结果归一化。

### 8.6 RecoveryPolicy

负责根据错误分类、预算和历史决定：

- 重试同一 Provider 请求。
- 反馈给模型纠正。
- 压缩上下文后重试。
- 重新鉴权。
- 暂停等待用户。
- 标记 stuck 或 failed。

### 8.7 TaskSupervisor

在现有 `task-stack.js` 之上统一：

- 父子上下文隔离。
- 栈顶任务执行权。
- 子任务 Provider 和工具白名单。
- 结构化 expected output。
- 子任务完成事件与父任务 Observation。
- 深度、数量、模型调用、时间和并发预算。

## 9. Agent Loop 伪代码

```js
async function runAgentLoop(runId, runtime) {
  let state = await runtime.runStore.load(runId);

  while (!isTerminal(state.status)) {
    runtime.abortSignal.throwIfAborted();

    switch (state.status) {
      case "created":
        state = await ingestRun(state, runtime);
        break;

      case "building_context": {
        const projection = await runtime.contextProjector.build(state);
        state = await transition(state, "sampling_model", {
          contextRevision: projection.revision,
          modelRequestRef: await runtime.runStore.putArtifact(projection)
        });
        break;
      }

      case "sampling_model": {
        const attempt = await runtime.provider.sample(
          await loadModelRequest(state),
          runtime
        );
        await appendModelEvents(attempt);
        state = await transition(state, "normalizing_response");
        break;
      }

      case "normalizing_response":
        state = await normalizeLatestModelTurn(state, runtime);
        break;

      case "validating_actions":
        state = await validateLatestActions(state, runtime);
        break;

      case "waiting_approval":
        return;

      case "executing_tools":
        state = await runtime.toolScheduler.executePendingBatch(state, runtime);
        break;

      case "recording_observations":
        state = await recordToolObservations(state, runtime);
        break;

      case "evaluating_progress":
        state = await evaluateNextTransition(state, runtime);
        break;

      case "compacting":
        state = await runtime.contextCompactor.compact(state, runtime);
        break;

      case "waiting_input":
        return;

      default:
        state = await failInvariant(state, `Unknown status: ${state.status}`);
    }

    await runtime.checkpoints.save(state);
  }
}
```

实现时不要求使用一个巨大 `switch`。可以让每个 handler 返回 `{state, events}`，但最终状态迁移必须集中校验。

## 10. 继续与结束规则

`AgentRunner` 使用以下确定性优先级决定下一步：

1. 用户取消：`cancelled`。
2. 不可恢复 Runtime 错误：`failed`。
3. 等待授权：`waiting_approval`。
4. 存在已验证 Tool Call：`executing_tools`。
5. Tool Observation 尚未反馈给模型：`building_context`。
6. 输出协议可纠正：记录纠错 Observation 后 `building_context`。
7. 上下文需要压缩：`compacting`。
8. 检测到 stuck 且 nudge 已使用：`stuck`。
9. 有 pending user input：合并输入后 `building_context`。
10. 模型返回有效 final：`completed`。
11. 模型返回空结果且仍有纠错预算：纠错后继续。
12. 其他情况：`failed`。

模型文本中声称“完成”不构成完成依据。最终输出必须满足当前 task 的 output schema，并且没有未处理 Tool Call、审批或子任务。

## 11. Tool 调度

### 11.1 Tool 元数据扩展

每个 Tool Definition 增加：

```js
{
  name: "fs_write",
  inputSchema: {},
  effects: ["vfs.write"],
  risk: "write",
  idempotency: "keyed",
  resources(args, context) {
    return [`vfs:${resolvePath(args.path, context.cwd)}`];
  },
  timeoutMs: 30000,
  concurrency: "parallel | serial | exclusive"
}
```

### 11.2 默认资源规则

| Tool 类型 | 资源键 | 默认执行方式 |
| --- | --- | --- |
| VFS 只读 | `vfs-read:<path>` | 不同路径可并行 |
| VFS 写入 | `vfs:<path>` | 同路径及祖先冲突串行 |
| 页面读取 | `tab:<tabId>:read` | 可与其他只读并行 |
| 页面修改 | `tab:<tabId>` | 同一 tab 串行 |
| 导航 | `tab:<tabId>` | 独占 |
| 网络 GET | `origin:<origin>:read` | 限流并行 |
| 网络写请求 | `origin:<origin>:write` | 默认串行 |
| Channel 回复 | `channel:<channelId>:peer:<peerId>` | 保序串行 |
| 配置修改 | `webclaw:settings` | 全局独占 |
| 子任务创建 | `task-run:<runId>` | 栈状态串行 |

### 11.3 并行算法

1. 保留模型返回的 Tool Call 顺序。
2. 解析每个调用的资源集合。
3. 资源不冲突、已获授权且 Tool 允许并行时放入同一 batch。
4. 有冲突的调用按原顺序分批。
5. 同一批次使用 `Promise.allSettled()`。
6. Observation 按原 Tool Call 顺序写入事件，避免 Provider history 配对混乱。
7. 一个调用失败不取消无依赖的其他调用，除非 run 被整体取消。

### 11.4 幂等策略

| 类型 | 示例 | 恢复策略 |
| --- | --- | --- |
| `safe` | 读取文件、搜索 | 可重新执行 |
| `keyed` | VFS 写入、通知发送 | 使用 `callId` 或 operation key 去重 |
| `unsafe` | 任意页面 JS、未知 POST | 状态不明时不得自动重试，要求用户确认 |

Tool 执行前写入 `tool_call_started` checkpoint，执行后写入 `tool_call_completed`。对于 `keyed` Tool，ToolRuntime 必须保存 operation key 与结果。

## 12. 审批模型

### 12.1 ApprovalRequest

```js
{
  approvalId: "approval-...",
  runId: "run-...",
  callIds: ["call-..."],
  operationFingerprint: "sha256-...",
  title: "Execute page JavaScript",
  reason: "...",
  risk: "unsafe",
  scope: {
    type: "once | session | schedule",
    sessionId: "",
    scheduleId: "",
    channelId: "",
    peerId: ""
  },
  expiresAt: 0,
  status: "pending | approved | rejected | expired"
}
```

### 12.2 规则

- 审批必须绑定规范化后的操作 fingerprint。
- 参数、目标 URL、代码、Provider、Schedule 或 Channel scope 变化后不得复用。
- Side Panel 审批和 Channel 六位数字审批写入同一 ApprovalStore。
- `waiting_approval` 必须持久化，不依赖打开的 Port 或未完成 Promise。
- UI 重新打开后从 RunStore 查询待审批项。
- Channel 回复 `0` 表示拒绝，六位码表示批准；路由必须绑定 channel 与 peer。
- Chrome 原生 permission prompt 无法远程点击时，Channel 应收到明确说明，run 保持等待或失败，不得假装授权成功。

## 13. 错误分类与恢复

### 13.1 AgentError

```js
{
  type: "provider_transport_error",
  layer: "provider | protocol | tool | approval | context | runtime | task",
  message: "...",
  retryable: true,
  retryAfterMs: null,
  details: {},
  causeRef: "",
  userVisible: true,
  modelVisible: false
}
```

### 13.2 错误矩阵

| 错误类型 | 处理方式 |
| --- | --- |
| Provider 429/5xx/断流 | 指数退避，受 transport retry budget 限制 |
| Provider 401/403 | 尝试刷新 token；失败则进入授权流程 |
| Provider 不支持参数 | Adapter 内降级协商一次并缓存能力 |
| Structured output 无法解析 | 将原始输出和简化 schema 反馈模型纠正 |
| Tool 名不存在 | 返回可用 Tool 名和近似匹配，不执行 |
| Tool 参数校验失败 | 返回 JSON path、schema 和有效示例 |
| Tool 业务失败 | 返回结构化 Observation，由模型决定重试或替代方案 |
| 用户拒绝授权 | 返回 `approval_rejected` Observation，不自动重复请求 |
| 上下文超限 | 触发 compaction 后重试一次或受预算控制多次 |
| 输出 schema 校验失败 | 返回校验错误，使用 protocol retry budget |
| 重复 action/error | 先 nudge，再次达到阈值则 `stuck` |
| Storage 写失败 | 不继续副作用；标记 runtime failure |
| Service Worker 重启 | 从最近 checkpoint 恢复 |

### 13.3 Protocol Correction

协议错误不能直接作为最终回答。Runtime 应添加内部纠错输入：

```text
PROTOCOL_ERROR
The previous output could not be accepted.
Error: $.tool.args.command is required.
Return either a valid final response or valid Tool Call JSON.
Do not repeat the invalid output unchanged.
```

必须同时保存原始输出供 UI 调试，但默认截断后发送给模型，避免错误输出占满上下文。

当前渐进实现采用独立 `agent-recovery-policy.js`，默认允许 2 次协议纠错、1 次空响应纠错和 3 次子任务最终输出校验纠错。这些恢复仍计入现有 `maxSteps`，但同时受各自的内部安全上限约束。Tool 参数和执行错误继续作为 Tool Observation 回传模型，不在 Recovery Policy 中重复实现另一套 Tool 重试循环。

### 13.4 Transport Retry

- 只重试没有产生已确认 Provider completion 的请求。
- 每次 attempt 使用新 `attemptId`，但关联同一 logical model step。
- 流中断且 Provider 无 resume 能力时，废弃不完整 assistant item，重新采样。
- 已显示给 UI 的不完整流必须标记 `interrupted`，不能伪装为最终文本。

## 14. Budget 设计

废除单一 `maxSteps` 的多重含义。保留 UI 兼容字段，但内部转换为：

```js
{
  modelCalls: { limit: 0, used: 0 },
  toolCalls: { limit: 0, used: 0 },
  toolBatches: { limit: 0, used: 0 },
  protocolRetries: { limit: 3, used: 0 },
  transportRetries: { limit: 3, used: 0 },
  compactions: { limit: 3, used: 0 },
  approvals: { limit: 0, used: 0 },
  childTasks: { limit: 16, used: 0 },
  taskDepth: { limit: 4 },
  wallTimeMs: { limit: 0, used: 0 },
  outputChars: { limit: 0, used: 0 }
}
```

其中 `0` 表示用户不设硬上限，但以下安全限制仍始终生效：

- 协议纠错必须有默认上限。
- Transport retry 必须有默认上限。
- 连续 compaction 必须有默认上限。
- stuck detection 不可因 `0 = unlimited` 关闭。
- 单次 Tool timeout 和单个结果大小必须有限制。

预算耗尽时应生成结构化 `budget_exhausted` 事件，并尽可能返回当前已完成工作、最后错误和未完成事项。

## 15. 上下文管理

### 15.1 上下文层次

ContextProjector 按以下顺序分配 token：

1. 核心安全与 Agent 协议。
2. Tool schemas 和当前权限信息。
3. 当前用户目标与 task contract。
4. 当前 cwd、计划、未完成审批和子任务状态。
5. `/workspace/AGENTS.md`、`SOUL.md`、`TOOLS.md` 等初始化文件。
6. 已压缩的历史摘要。
7. 最近的原始用户、assistant、Tool Call 和 Observation。
8. 按当前目标检索出的知识库或 VFS 片段。
9. 低优先级历史。

核心策略和当前用户输入不得因压缩被移除。

### 15.2 完整事件与模型投影

```text
Run Event Log                     Model Projection
-------------                     ----------------
全部用户消息         ------+
全部模型输出               |
全部 Tool Call              +--> ContextProjector --> 有界输入
全部 Tool Result            |
审批/错误/压缩/任务事件 -----+
```

### 15.3 Tool Result 截断

大结果采用三层表示：

1. 模型可见摘要。
2. 可按需读取的 artifact reference。
3. RunStore 中的完整原始结果。

例如：

```js
{
  ok: true,
  summary: "Matched 34 files; first 20 shown.",
  output: [...],
  truncated: true,
  fullResultRef: "artifact-...",
  suggestedNextAction: {
    tool: "agent_artifact_read",
    args: { artifactId: "artifact-...", offset: 20 }
  }
}
```

不应把任意大结果直接塞回消息历史。

## 16. Context Compaction

### 16.1 原则

- Compaction 创建摘要事件，不删除原始事件。
- 摘要必须记录覆盖的 event sequence 范围。
- 最近活动窗口保持原始形式。
- Tool Call 和 Tool Result 必须保持配对。
- 系统策略、初始化文件和当前任务状态在压缩后重新注入。
- 压缩前后记录 token/字符估计和摘要版本。

### 16.2 CompactionEvent

```js
{
  type: "context_compacted",
  payload: {
    revision: 3,
    fromSequence: 1,
    toSequence: 120,
    summary: {
      goal: "...",
      constraints: [],
      decisions: [],
      verifiedFacts: [],
      filesChanged: [],
      toolOutcomes: [],
      errors: [],
      openWork: []
    },
    sourceHash: "sha256-...",
    estimatedTokensBefore: 32000,
    estimatedTokensAfter: 6400
  }
}
```

摘要优先使用结构化 schema。Provider 不支持结构化输出时，在 Adapter 中降级到 JSON 文本并本地校验。

### 16.3 触发条件

- 预计下一次请求超过 Provider context budget。
- Tool result 使 follow-up 请求可能超限。
- Provider 返回 context length error。
- 用户手动请求压缩。

禁止仅根据消息数量触发。应综合 Provider context window、系统 prompt、Tool schemas、附件和当前投影估算。

### 16.4 防止压缩循环

- 每个 turn 限制连续 compaction 次数。
- 新摘要必须比被替代投影显著缩小。
- `sourceHash + targetBudget` 相同的压缩不得重复执行。
- 无法缩小时保留关键状态并返回明确错误，不无限重试。

## 17. Progress 与 Stuck Detection

### 17.1 Progress Signature

每个模型/工具周期生成：

```js
{
  actionHash: hash(toolName + canonicalArgs),
  observationHash: hash(normalizedResult),
  stateChangeHash: hash(filesChanged + urlChanged + planChanged + taskChanged),
  errorType: "",
  timestamp: 0
}
```

### 17.2 检测模式

- 相同 action + 相同 observation 连续出现。
- 相同 action 连续产生相同错误。
- A/B 两组调用交替但无状态变化。
- 连续空响应或只有无法执行的说明文本。
- 连续 compaction 后上下文仍超限。
- 连续 final schema 校验失败且错误不变。

### 17.3 处理方式

第一次达到预警阈值：向模型注入一次 nudge，要求检查错误、改变策略或向用户说明阻塞原因。

再次达到终止阈值：状态变为 `stuck`，保留当前成果、重复模式和建议恢复方式。

不建议默认使用额外模型作为进度裁判。确定性 fingerprint 更便宜、更稳定，也更容易调试。

## 18. Task 与子 Agent

### 18.1 保留任务栈语义

现有规则继续保留：

- 用户输入创建 AgentRun，显式任务栈初始为空；只有模型调用 `task_push` 才创建 Task。
- 只有栈顶任务可以创建直接子任务。
- 子任务拥有独立上下文。
- 父任务等待子任务完成。
- 子任务输出必须匹配 JSON Schema。
- 子任务完成后销毁运行上下文，只把结构化结果反馈父任务。
- 任意 Tool 在常规步骤上限执行后，都保留一个只用于消费 ToolObservation 和生成最终结果的模型回合；该回合不能继续执行 Tool。

### 18.2 改造后的变化

- 子任务也拥有独立 `runId/turnId/event log`，并关联父 `taskFrameId`。
- 子任务调用通过 `TaskSupervisor`，不递归调用旧 `runAgent()`。
- 父任务收到标准 `ToolObservation` 风格的子任务结果。
- 子任务失败、stuck、取消、预算耗尽均有结构化状态。
- UI 可展开查看子任务事件，但完成后默认折叠。

### 18.3 Provider 策略

默认继承父任务锁定的 Provider。未来可以允许任务显式指定 `providerId`，但必须：

- Provider 存在且已授权。
- 用户配置允许子任务切换 Provider。
- 事件中明确记录实际 Provider。
- 不允许子任务通过模型输出直接读取或修改 Provider token。

### 18.4 并行子任务

第一阶段继续使用严格任务栈和同步等待。完成工具资源调度与 checkpoint 后，再考虑兄弟子任务并行。并行子任务必须使用任务树而不是共享一个可变栈。

## 19. Session、Channel 与并发

### 19.1 Session 输入队列

每个 session 使用持久化 FIFO inbox：

```js
{
  messageId: "...",
  source: {},
  content: "...",
  media: [],
  receivedAt: 0,
  status: "queued | claimed | processed | failed",
  claimedByRunId: ""
}
```

### 19.2 单活跃会话

保持现有产品规则：用户界面只有一个活跃会话，所有 connected channel 默认进入该会话。但每条输入仍保存 `channelId + peerId + messageId`，以保证回复路由正确。

### 19.3 同一 session 的并发规则

- 默认同一 session 同时只有一个根 Agent Run 执行。
- 新消息进入 inbox，不直接创建竞争 run。
- Agent 在一个模型/工具边界后检查 pending input。
- 可安全合并时，将 pending input 注入当前 run。
- 当前 run 在等待不可合并的审批时，新消息保持排队。
- 不同 session 可并发，但受全局 Provider 和 Tool 限流器控制。

### 19.4 回复路由

Run 完成时，根据触发输入记录回复目标：

- Side Panel 输入只更新会话 UI。
- Channel 输入同时更新 UI 并回复原 `channelId + peerId`。
- Schedule 根据任务配置决定是否发往 Channel。
- 后续 Side Panel 消息不能意外回复到上一条 Channel。

## 20. 持久化与 Chrome 生命周期

### 20.1 存储选择

- `chrome.storage.local`：小型设置、索引、待审批摘要、活跃 run 指针。
- IndexedDB：事件日志、checkpoint、完整 Tool Result、模型原始输出、附件引用。
- `chrome.storage.session`：仅用于可丢失的 UI window/port 临时状态，不作为 run 恢复依据。

### 20.2 RunStore 表

建议 IndexedDB object stores：

```text
runs            key: runId
events          key: [runId, sequence]
checkpoints     key: [runId, checkpointId]
artifacts       key: artifactId
toolOperations  key: operationKey
inbox           key: messageId
```

### 20.3 原子事务与 Run Lease

单个 run 在任何时刻只能由一个 AgentRunner 实例推进。AgentService 启动 run 前必须在 IndexedDB 事务中领取租约：

```js
{
  ownerId: "worker-instance-...",
  expiresAt: 0,
  heartbeatAt: 0
}
```

规则：

- 领取租约时同时检查 run 不是终态，且现有租约不存在或已经过期。
- Runner 在模型流、长工具调用和等待内部任务期间定期续租。
- 正常暂停、等待输入或进入终态时主动释放租约。
- 新 Service Worker 只能接管过期租约，不能仅因 Port 断开就抢占。
- 所有状态迁移使用 compare-and-swap，校验 `runId + eventCursor + lease.ownerId`。
- 发现 event cursor 已变化时，当前 Runner 必须停止并重新加载，不能覆盖新状态。

以下内容必须在同一个 IndexedDB transaction 中提交：

1. 追加本次状态迁移产生的事件。
2. 更新 run state、event cursor 和 checkpoint 指针。
3. 更新活跃 run 索引或 inbox claim。

外部 Tool 副作用无法与 IndexedDB 形成同一事务，因此采用 intent/result 两阶段记录：

```text
transaction: tool_call_started + operationKey + checkpoint
external side effect
transaction: tool_call_completed + result + checkpoint
```

如果进程在两阶段之间退出，恢复逻辑必须根据 Tool 的 idempotency 类型处理，不能假设操作一定失败或一定成功。

当前实现对 `safe` 和 `retry_safe` 操作允许按既定策略恢复。`unknown` 副作用操作若在启动后超时，会额外写入由 `runId + Tool name + 规范化参数摘要` 组成的不确定副作用标记；同一 Run 中即使模型换用新的 `callId` 重试相同参数，也会返回 `operation_state_unknown`，直到用户核验目标状态或改用不同操作。正常完成的相同参数调用仍按各自 `callId` 执行，不会被该保护误判为重复。

### 20.4 Checkpoint 时机

必须保存：

1. Run 创建并领取输入后。
2. Model request 发出前。
3. Model response 完整归一化后。
4. Approval request 创建和决定后。
5. Tool batch 开始前。
6. 每个 Tool 完成后。
7. Tool observations 写入后。
8. Compaction 完成后。
9. 子任务 push/pop 后。
10. Run 进入任何终态后。

### 20.5 启动恢复

Service Worker 启动时：

1. 查询非终态 runs。
2. 只领取不存在有效租约或租约已经过期的 run。
3. 校验 checkpoint schema version 和 event cursor。
4. `waiting_approval` 保持等待并重新通知可用 UI/Channel。
5. `waiting_input` 不自动运行。
6. `sampling_model` 视为不完整 attempt，按 Adapter 恢复能力处理。
7. `executing_tools` 查询 operation key：
   - 已有结果则补写 Observation。
   - safe Tool 可重新执行。
   - unsafe 且状态未知则请求人工确认。
8. 其他边界从最近 checkpoint 继续。

### 20.6 Schema Migration

所有持久化对象带 `schemaVersion`。迁移必须：

- 保留旧数据备份或支持只读导出。
- 逐版本迁移，不假设跨多个版本字段一致。
- 遇到未知未来版本时停止运行，不能用默认值覆盖。

## 21. 生命周期事件与 Hooks

统一事件至少包括：

```text
run_created
turn_started
context_build_started
context_built
model_attempt_started
model_item_delta
model_attempt_completed
model_protocol_error
tool_call_proposed
approval_requested
approval_resolved
tool_call_started
tool_call_completed
tool_call_failed
observations_recorded
context_compaction_started
context_compacted
task_started
task_progress
task_completed
task_failed
stuck_warning
run_waiting
turn_completed
turn_failed
turn_cancelled
```

第一阶段只实现内部 EventBus。未来 Hooks 可以订阅事件，但必须遵循：

- Hook 默认只观察，不修改状态。
- 可阻塞 Hook 只能用于明确定义的边界。
- Hook 返回值必须 schema 校验。
- Hook 失败不能破坏主事件日志。
- 防止 Hook 递归触发自身。

## 22. UI 与可观察性

### 22.1 会话显示

用户可见内容分为：

- Assistant 流式文本。
- 模型提出的 Tool 名称和参数。
- Tool 成功或失败摘要。
- 审批请求。
- 任务树进度。
- 最终结果。

内部 compact trajectory、Provider 原始响应和 stack trace 默认隐藏，可在调试详情中展开。

### 22.2 状态显示

UI 不再只有模糊的 Thinking，而显示：

```text
Preparing context
Waiting for model
Validating tool calls
Waiting for approval
Running fs_shell (1/3)
Compacting context
Waiting for child task
Recovering interrupted run
```

### 22.3 完成后折叠

- 活跃任务树始终展开当前栈。
- 完成的子任务默认折叠。
- Tool Call 保留名称和参数；大结果折叠。
- 成功的内部 trajectory 不额外显示。
- 失败必须显示类型、原因和可重试建议。

### 22.4 调试导出

提供脱敏 run export：

```json
{
  "run": {},
  "events": [],
  "checkpoints": [],
  "providerCapabilities": {},
  "toolDefinitions": []
}
```

导出前移除 token、cookie、API key、OAuth 数据、私密附件正文和网页敏感字段。

## 23. 安全要求

1. RunStore 不保存 Provider secret 到普通事件。
2. Model 永远不能通过配置管理 Tool 读取 token。
3. `run_js` 保持显式审批要求，并记录 URL、world 和 code hash。
4. Tool Result 中可能包含 cookie/token 时必须由 Tool 标记 sensitivity。
5. ContextProjector 默认排除 `secret` 事件。
6. Channel 审批码只能使用一次并有过期时间。
7. 外部消息发送必须有明确 peer 路由和 operation key。
8. 恢复 unknown unsafe operation 时不得自动重放。
9. Tool schema、effects 和 resources 由扩展代码或受控配置定义，模型不能在单次调用中篡改。

## 24. 与现有代码的映射

| 现有位置 | 目标模块 | 处理方式 |
| --- | --- | --- |
| `background.js::runAgent` | `agent-runner.js` | 渐进抽取并最终替换 |
| Provider 返回的 `{kind, text, tool}` | `agent-model-turn.js` | 先转换为统一 ModelTurn，再由 Runner 消费 |
| `callAgentModel` | `provider-adapter.js` | 保留各 Provider 请求实现，统一返回 ModelTurn |
| `callTextProtocolAgent` | Provider text fallback | 移入 Adapter，不暴露给 Runner |
| `prepareAgentHistory` | `context-projector.js` | 改为事件投影 |
| compaction helpers | `context-compactor.js` | 改为结构化 CompactionEvent |
| `dispatchTool` | ToolRuntime | 保留具体 Tool handler |
| Tool switch/definitions | ToolRegistry | 补充 schema/effects/resources/risk |
| operation approvals | `tool-policy.js` | 统一 Side Panel/Channel/Schedule |
| `task-stack.js` | `task-supervisor.js` | 保留纯状态函数并增加持久事件 |
| `activeTaskRuns` | RunStore active index | 从内存 Map 迁移到可恢复索引 |
| chat sessions storage | AgentService/session inbox | 保持兼容后逐步迁移 |
| UI `onEvent` | Agent Event subscriber | 兼容旧事件并逐步升级 |

## 25. 渐进迁移计划

### 当前实现状态

核心重构已按本计划落地，外围 Provider、Tool、Channel、Schedule、Session 和文件管理行为继续通过兼容回调接入同一个 Runtime：

| 阶段 | 实现模块 | 状态 |
| --- | --- | --- |
| 统一模型返回 | `agent-model-turn.js` | 已完成，Runner 不解析 Provider 私有返回类型 |
| 显式循环与状态 | `agent-runner.js`、`agent-state.js` | 已完成，包含确定性 transition 和统一生命周期事件 |
| 事件、checkpoint 与恢复 | `agent-run-store.js` | 已完成，IndexedDB 保存 events/checkpoint/artifacts/tool operations，并使用 run lease 防止重复推进 |
| 统一外部入口 | `agent-service.js` | 已完成，同一 session 串行，不同 session 可独立推进 |
| Tool 调度 | `agent-tool-scheduler.js` | 已完成，参数校验、相邻只读并行、写屏障、operation key 和未知副作用保护 |
| 上下文 | `agent-context-projector.js`、`agent-context-compactor.js` | 已完成，结构化摘要、Provider 能力预算和大型结果 artifact 引用 |
| 恢复与控制 | `agent-recovery-policy.js`、`agent-errors.js`、`agent-budgets.js`、`agent-progress.js` | 已完成，有界重试、错误分类、预算和 stuck detection |
| 子任务 | `agent-task-supervisor.js`、`task-stack.js` | 已完成，Supervisor 是任务栈变更与持久化边界 |

恢复只从确定性边界自动继续。`before_tool` 会检查 keyed operation：已有 result 时直接恢复 Tool Observation，`safe`/`retry_safe` 的 started operation 使用原 callId 和参数继续，`unknown` 副作用保持待检查状态且不会自动重放。`approval_decided` 也遵循相同检查，但未知状态保持人工确认。等待审批会持久化完整审批摘要，Side Panel 重新打开后再次显示审批窗口；Channel 审批会重新发送六位授权码。`WEBCLAW_GET_AGENT_RUN` 可导出已脱敏事件用于排错。

### Phase 0：冻结行为并补测试

目标：为当前行为建立回归基线。

- 为各 Provider 的 normalized response 添加 fixture tests。
- 为 Tool Call、Tool error、审批、停止、压缩、任务栈添加集成测试。
- 记录当前 side panel、channel、schedule 的完整事件序列。
- 不改变用户可见行为。

完成标准：当前主要路径能由自动测试重放。

### Phase 1：统一类型与错误

- 新增 `AgentError`、`ModelTurn`、`ToolObservation`。
- Provider 调用统一返回 ModelTurn。
- Tool failure 统一返回 Observation。
- 保持旧 `runAgent` 循环。

完成标准：`runAgent` 不再直接解析 Provider 特有输出。

### Phase 2：抽取 AgentRunner

- 将 Context、Model、Tool、Finish 分支拆成 handler。
- 建立显式状态和 transition validator。
- 旧回调转换为统一 Agent Events。

完成标准：Runner 不引用 Provider 类型，也不包含具体 Tool handler。

### Phase 3：事件日志与 checkpoint

- 实现 IndexedDB RunStore。
- 每个边界写事件和 checkpoint。
- 实现启动恢复和待审批恢复。
- 旧 chat history 保持用户显示兼容。

完成标准：关闭 Side Panel、回收 Service Worker 后，等待审批的 run 不丢失。

实现状态：RunStore 使用 IndexedDB 保存按序事件、边界 checkpoint、artifact 和 operation intent/result。run claim、lease 与 metadata 更新在同一事务完成，后续事件、checkpoint 和 operation 写入均校验 owner；checkpoint、lease 或终态提交失败会终止执行，终态已经提交后的非关键事件日志失败只记录诊断告警。安全模型边界由 recovery alarm 自动继续，并恢复预算、RecoveryPolicy 计数和无进展检测状态；审批可在 Side Panel 或原 Channel 恢复。Tool 超时会触发专用 AbortSignal，已取消的 signal 不会创建 operation 或执行 Tool，状态不确定的外部副作用和嵌套任务不会自动重放。

### Phase 4：ToolScheduler

- Tool Registry 补充 effects/resources/idempotency。
- 支持多 Tool Call。
- 实现资源冲突分组和并行执行。
- 实现 operation key 去重。

完成标准：多个只读调用可并行，同一页面/VFS 路径写入保持串行。

### Phase 5：ContextProjector 与 Compactor

- 完整事件与模型投影分离。
- 引入结构化 compaction。
- 大 Tool Result 使用 artifact 引用。
- 根据 Provider context capability 分配预算。

完成标准：长会话可持续运行，切换 Provider 后仍能保留关键事实。

### Phase 6：Recovery、Budgets 与 Stuck Detection

- 独立错误分类和恢复矩阵。
- 拆分预算。
- 增加 progress signature、nudge 和 stuck 状态。

其中基础的有界协议错误、空响应和子任务最终输出校验恢复已提前落地到 `agent-recovery-policy.js`，用于降低 Runner 抽取期间的分支复杂度。Phase 6 仍需完成统一错误分类、独立预算、进度签名和 stuck detection，不应把已完成的基础恢复重复实现为 Provider 特例。

实现状态：统一错误分类、模型错误有界退避、模型/Tool/时间预算、Tool Call + Observation 进度签名、一次 nudge 和最终 stuck 停止均已接入共享 Runner。

完成标准：重复错误不会无限消耗模型调用，UI 能解释停止原因。

### Phase 7：TaskSupervisor 与高级能力

- 子任务接入独立 run/event log。
- 支持任务恢复与结构化失败。
- 评估并行兄弟任务、fork/rewind 和 hooks。

## 26. 测试策略

### 26.1 单元测试

- 状态迁移合法性。
- ModelTurn 归一化。
- JSON Schema 校验错误路径。
- Resource key 和冲突判断。
- Approval fingerprint。
- Error classification。
- Budget consumption。
- Progress signature 和 stuck pattern。
- Context token 分配与 compaction projection。

### 26.2 Provider Contract Tests

每种 Provider 使用固定 fixture 验证：

- final only。
- 单 Tool Call。
- 多 Tool Call。
- 文本 + Tool Call。
- malformed JSON。
- invalid arguments。
- stream disconnect。
- structured output unsupported fallback。
- context overflow。
- auth expired。

Contract test 只验证 Adapter，不复制整个 Agent Loop 测试。

### 26.3 Tool Scheduler Tests

- 同资源写操作串行。
- 不同资源只读操作并行。
- batch 中单个失败不丢失其他结果。
- Observation 顺序与 Tool Call 顺序一致。
- keyed operation 恢复时不重复执行。
- unsafe operation 状态未知时请求确认。

### 26.4 恢复测试

在以下边界模拟 Service Worker 终止：

- Model request 前后。
- Approval 等待时。
- Tool started 后、result 写入前。
- Tool result 写入后、Observation 前。
- Compaction 中。
- 子任务 push/pop 时。

### 26.5 端到端测试

- Side Panel 发起浏览器任务并完成。
- 微信/Telegram 发起任务并正确回复原 peer。
- Schedule 复用已授权操作。
- Side Panel 关闭时 Channel 任务继续。
- 长会话触发压缩并继续。
- Provider 切换后继续同一 session。
- 多任务栈嵌套并返回结构化结果。
- 用户中途 Stop。

## 27. 验收标准

改造完成必须满足：

1. 所有 Provider 共享同一个 AgentRunner。
2. Provider Adapter contract tests 全部通过。
3. 一次响应可执行多个 Tool Call。
4. Tool 参数错误会反馈模型并允许纠正。
5. 协议错误不会直接伪装成最终回答。
6. Tool 失败原因在模型下一步上下文中可见。
7. Tool 成功调用仍在 UI 显示名称和参数。
8. Side Panel 关闭不影响 Channel/Schedule 执行。
9. 等待审批状态可跨 Service Worker 重启恢复。
10. 已完成 keyed 副作用不会因恢复重复执行。
11. 完整事件日志不因 compaction 丢失。
12. 上下文超限时可以压缩并继续，且不会无限压缩。
13. 重复 action/error 能被检测并停止。
14. 子任务上下文独立，输出经过 schema 校验。
15. UI 能显示当前实际阶段和任务进度。
16. Run export 可用于定位问题且不泄露 secret。

## 28. 开发约束

- 每个 Phase 单独提交，避免一次性替换主循环。
- 新模块必须有单元测试后再接入 `background.js`。
- 新旧事件并存期间应提供兼容转换层。
- 不允许在 Provider Adapter 中调用 `dispatchTool`。
- 不允许 Tool handler 直接修改 AgentRunState。
- 不允许 UI 以本地状态推断 run 已完成，必须以终态事件为准。
- 不允许用 `chrome.storage.session` 保存唯一审批或恢复数据。
- 不允许忽略无法识别的持久化 schema version。
- 不允许以无限 retry 代替明确的错误处理。

## 29. 已确定的实现决策

以下问题在实现中采用了确定方案：

1. RunStore 使用独立 `webclaw-agent-runs` IndexedDB，避免与 VFS/Knowledge schema 耦合。
2. 内建 Tool metadata 由扩展代码确定；自定义 Tool 使用保守的未知副作用策略。
3. Scheduler 始终接受多 Tool Call；Provider capability 决定是否向服务端请求并行 Tool Call。当前 Codex Adapter 支持原生多调用，单调用 Provider 仍走相同 batch 路径。
4. UI 保留聚合预算设置，Runner 内部拆分模型步骤、Tool Call、恢复和时间预算。
5. 事件、checkpoint 和 artifact 写入前脱敏；后续版本可在不改变 Runner contract 的情况下增加按容量清理策略。
6. 是否在第一版提供 run replay UI；建议先实现脱敏导出和内部恢复，后续再做完整 time travel。

## 30. 参考资料

- Codex turn loop: https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn.rs
- Codex context history: https://github.com/openai/codex/blob/main/codex-rs/core/src/context_manager/history.rs
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code sessions: https://code.claude.com/docs/en/sessions
- Claude Code checkpointing: https://code.claude.com/docs/en/checkpointing
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- OpenHands Agent architecture: https://docs.openhands.dev/sdk/arch/agent
- OpenHands stuck detector: https://docs.openhands.dev/sdk/guides/agent-stuck-detector
- OpenHands parallel tools: https://docs.openhands.dev/sdk/guides/parallel-tool-execution
- SWE-agent ACI: https://swe-agent.com/latest/background/aci/
- mini-SWE-agent: https://github.com/SWE-agent/mini-swe-agent
- LangGraph persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- LangGraph interrupts: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- Goose: https://block.github.io/goose/
