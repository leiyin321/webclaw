# WebClaw Tool 升级改造规划

状态：实施中。阶段 1 已完成；阶段 2 主体完成；阶段 3 已完成首批网络与 VFS 增强。

目标版本：0.6.1

适用范围：内置 Tool、自定义 Tool、Provider Tool Schema、ToolScheduler、权限审批、设置 UI、默认知识库

最后更新：2026-08-11

## 1. 目标

WebClaw 的运行环境是 Chrome 扩展，而不是普通网页或操作系统。Tool 体系应最大化利用 Chrome Manifest V3、扩展 Service Worker、受控页面注入、offscreen document、可选权限、VFS 和本地 IndexedDB，同时保持以下约束：

1. 所有 Provider 使用同一套 Tool 定义、调用、校验、审批、调度和结果协议。
2. Tool 是可验证的执行能力，不把操作结果交给模型猜测。
3. 默认权限保持克制；新增 Chrome 能力通过 `optional_permissions` 和 `optional_host_permissions` 按需授权。
4. 高风险能力默认隐藏并禁用，不能因为模型调用而静默启用。
5. 不保留含义重叠的旧 Tool 名称；升级后只接受当前 Registry 中的规范名称，避免模型和配置出现歧义。
6. 小上下文模型不需要在每轮接收全部 Tool Schema。

## 2. 当前实现现状

### 2.1 改造前内置 Tool 基线

审计开始时共有 39 个内置 Tool，下表仅用于记录改造前基线，其中页面和 Tab 的 6 个旧名称现已移除。

| 分类 | 数量 | 当前 Tool |
| --- | ---: | --- |
| 页面与浏览器 | 9 | `get_page_context`、`click`、`type_text`、`navigate`、`run_js`、`translate_page`、`web_search`、`chrome_api`、`wait` |
| 网络与信息 | 2 | `http_request`、`get_weather` |
| 外部通知 | 1 | `qiyewechat_notification` |
| Agent 调度 | 4 | `update_plan`、`task_push`、`task_stack`、`agent_artifact_read` |
| VFS | 14 | `fs_shell`、`fs_list`、`fs_read`、`fs_write`、`fs_edit`、`fs_search`、`fs_apply_patch`、`fs_mkdir`、`fs_move`、`fs_delete`、`fs_restore`、`fs_purge`、`fs_empty_trash`、`fs_usage` |
| 知识库 | 5 | `knowledge_ingest`、`knowledge_search`、`knowledge_read`、`knowledge_forget`、`knowledge_status` |
| 配置管理 | 4 | `list_webclaw_config`、`propose_webclaw_config_patch`、`apply_webclaw_config_patch`、`rollback_webclaw_config_patch` |

### 2.2 自定义 Tool

当前支持两种自定义 Tool：

- `http`：通过 URL、method、headers、body 模板调用跨域 HTTP 接口。
- `workflow`：用自然语言 instruction 和输入 Schema 启动一个受限 Agent 子循环。

自定义 Tool 可以声明输入 Schema，但执行风险、资源、幂等性、权限、输出 Schema 和超时仍没有统一声明模型。

### 2.3 Tool 调用链

当前调用链为：

```text
Settings tools
  -> enabledTools
  -> Provider native definitions / JSON transport examples
  -> ModelTurn Tool Call
  -> validateAgentToolCall
  -> ToolScheduler
  -> dispatchTool / runCustomTool
  -> Tool Observation
  -> AgentRunner
```

AgentRunner 和 ToolScheduler 已经统一，但 Tool 元数据仍分散：

- `background.js` 保存内置 Tool 名称、说明、示例和 required 参数。
- `sidepanel.js` 保存另一份 Tool 名称和说明。
- 大多数输入 Schema 由示例值推断。
- `agent-tool-scheduler.js` 单独硬编码 effects、resources、risk 和 idempotency。
- 权限和审批规则位于各执行函数内部。
- 默认知识库和 README 再维护一份人工说明。

### 2.4 当前参数校验

除 `run_js` 和 `task_push` 外，大部分内置 Tool 使用示例自动推断 Schema。当前校验器主要检查：

- required 字段；
- 顶层基础类型；
- 顶层 enum。

尚未完整检查嵌套对象、数组 item、数值范围、字符串长度、条件字段和 `additionalProperties:false`。这会导致小模型看似返回 JSON，实际参数仍不可靠。

### 2.5 当前 Chrome 能力

已有能力：

- 读取活动页面文本和交互元素；
- CSS selector 点击和输入；
- 页面跳转、创建 Tab、列出 Tab、刷新活动 Tab；
- 经独立审批执行页面 JavaScript；
- 扩展后台跨域 HTTP 请求；
- optional host permission；
- VFS、知识库、Channel、Schedule 和本地 Agent 状态。

主要缺口：

- 下拉框、复选框、键盘、滚动、hover、条件等待等页面交互；
- 页面截图、表格/链接/表单/JSON-LD 等结构化提取；
- 页面 `localStorage` 和 `sessionStorage` 的受控访问；
- 完整 Tab 生命周期和 Tab Group；
- 下载、书签、历史、最近关闭页面、剪贴板和本机通知；
- 二进制 HTTP 响应、multipart 上传和直接保存到 VFS；
- VFS glob、stat、diff、hash、归档和统一 patch；
- Agent 运行中结构化询问用户；
- Tool 太多时的按需发现和本轮动态加载。

## 3. 主要问题

### 3.1 定义存在多个事实来源

Tool 名称、UI 说明、模型 Schema、Scheduler 风险元数据和执行器没有来自同一个注册表。新增或改名时容易只修改其中一处。

### 3.2 Tool 数量分布失衡

VFS 有完整原子能力，Chrome 页面操作却集中在少数简单 Tool 和语义模糊的 `chrome_api` 中。模型容易熟练操作 VFS，却只能通过 `run_js` 补足普通页面交互。

### 3.3 重复能力同时暴露

`fs_shell` 与多个结构化 VFS Tool 重叠；`navigate`、`chrome_api.create_tab` 与 Tab 管理重叠；固定 `wait` 无法表达等待页面条件。小模型会在多个近似 Tool 中随机选择。

### 3.4 Schema 不能表达实际约束

例如 `chrome_api` 的示例只包含 `operation`，但 `create_tab` 实际还需要 `url`。`run_js` 的 code/vfsPath 二选一也只能在执行期检查。

### 3.5 全量暴露影响小模型

改造前 39 个内置 Tool 加自定义 Tool 已占用较多上下文，重复名称会进一步降低选择准确率。0.6.1 Registry 有 53 个规范内置 Tool，并通过 bundle 和 `tool_search` 控制每轮实际暴露数量。

## 4. 设计原则

1. **一个注册表**：Tool Registry 是名称、Schema、UI、调度、权限和文档的事实来源。
2. **资源优先命名**：采用 `page_*`、`browser_*`、`net_*`、`fs_*`、`knowledge_*`、`agent_*`、`config_*`、`notification_*` 命名域。
3. **原子执行，适度聚合**：同一资源的低风险动作可用 action 枚举聚合；不可逆或审批不同的动作保持独立。
4. **显式 Schema**：不再以示例推断作为内置 Tool 的最终 Schema。
5. **统一结果信封**：Tool 结果使用稳定的 ok/data/error/meta 结构。
6. **权限按需申请**：没有权限的 Tool 不对模型宣称可执行。
7. **风险默认保守**：外部写入、Cookie、历史删除、下载打开和 DevTools 操作不得自动重放。
8. **单一规范名称**：每项能力只保留一个 Tool 名称；旧名称直接移除，不设置 alias。
9. **按需暴露**：核心 Tool 常驻；能力包通过 Tool Search 在当前 Run 中加载。

## 5. 统一 Tool Registry

目标定义：

```js
{
  name,
  title,
  category,
  description,
  inputSchema,
  outputSchema,
  permissions,
  hostPermissions,
  effects,
  resources,
  risk,
  idempotency,
  timeoutMs,
  defaultEnabled,
  advanced,
  bundle,
  executor
}
```

Registry 同时生成：

- Provider native Tool definitions；
- JSON transport Tool examples；
- 参数校验；
- ToolScheduler execution metadata；
- Settings Tool 列表和分类；
- 权限及审批说明；
- Tool Search 索引；
- 默认知识库 Tool 说明；
- 发布校验。

自定义 Tool 使用相同结构的受限子集。HTTP Tool 根据 method 推导 read/write effect，Workflow 默认使用 unknown effect，除非用户明确选择更严格的声明。

## 6. 目标 Tool 目录

### 6.1 核心 Agent Tool

始终暴露：

- `update_plan`
- `task_push`
- `task_stack`
- `agent_artifact_read`
- `agent_ask_user`
- `tool_search`

`agent_ask_user` 应暂停当前 Run，向 Side Panel 或来源 Channel 发送结构化问题，收到回答后继续同一上下文。

`tool_search` 根据自然语言和 category 搜索当前已启用且已授权的 Tool，并把选中的定义加入本次 Run 后续模型请求。

### 6.2 页面 Tool

- `page_snapshot`：替代 `get_page_context`，读取文本、选择内容、交互元素、链接、表单、frame 摘要和页面元数据。
- `page_action`：聚合 click、type、select、check、hover、focus、keypress、scroll、submit。
- `page_wait`：等待 timeout、selector visible/hidden、text、URL 或 document readyState。
- `page_extract`：按类型提取正文、链接、表格、表单、meta、JSON-LD 或 selector 内容。
- `page_screenshot`：截取可见 Tab，结果保存为 image artifact，可传给支持视觉的 Provider。
- `page_storage`：读取、设置或删除当前 origin 的 localStorage/sessionStorage；不访问 Cookie。
- `page_file_input`：把指定 VFS 文件设置到网页文件输入控件。
- `run_js`：保留为高级逃生能力，继续使用总开关和逐次审批。
- `translate_page`：保留为 convenience Tool。

旧的 `get_page_context`、`click`、`type_text` 和 `wait` 已直接移除。模型、Skill 和 Schedule 应使用上面的规范 Tool 名称与参数。

### 6.3 浏览器 Tool

- `browser_tabs`：list、get、open、activate、navigate、reload、duplicate、move、pin、mute、close。
- `browser_tab_groups`：list、create、update、move、ungroup。
- `browser_sessions`：查询和恢复最近关闭的 Tab/窗口。
- `browser_downloads`：list、download、pause、resume、cancel、erase、show。
- `browser_bookmarks`：search、create、update、move、remove。
- `browser_history`：search、visits；删除作为单独高风险 action。
- `browser_clipboard_read`：只申请 clipboardRead，通过 offscreen document 读取文本。
- `browser_clipboard_write`：只申请 clipboardWrite，通过 offscreen document 写入文本。
- `browser_notification`：创建和清除 Chrome 本机通知。

旧的 `navigate` 和 `chrome_api` 已直接移除，统一使用 `browser_tabs`。

Downloads、Bookmarks、History、Sessions、Clipboard、Notifications 使用 manifest `optional_permissions`，只在用户启用对应 bundle 时请求。

### 6.4 网络 Tool

- `http_request` 暂时保留名称，避免破坏自定义 HTTP Tool 和已有 Skill。
- 增加 timeout、responseType、maxBytes、redirect、form、multipart、saveToVfs。
- 文本和 JSON 返回受控长度；二进制直接保存 VFS 或 artifact，不转换成无限 data URL。
- `web_search` 和 `get_weather` 归入 convenience bundle。

未来如需命名统一，可在兼容期后将 `http_request` 映射为 `net_request`，但 0.6.1 不做无收益改名。

### 6.5 VFS Tool

保持结构化文件操作为主：

- `fs_list`
- `fs_stat`
- `fs_read`
- `fs_write`
- `fs_edit`
- `fs_search`
- `fs_glob`
- `fs_diff`
- `fs_hash`
- `fs_apply_patch`
- `fs_manage`：mkdir、move、copy、touch、trash。
- `fs_trash`：list、restore、purge、empty。
- `fs_usage`
- `fs_archive`：create、extract、list。
- `fs_preview_open`

在 `fs_manage` 和 `fs_trash` 真正实现前，现有 VFS Tool 仍是当前规范能力；替代 Tool 上线时直接移除被替代名称，不建立 alias。`fs_shell` 作为独立兼容 bundle，不与全部结构化 FS Tool 默认同时暴露给小模型。

`fs_apply_patch` 应在保留当前 operations 格式的同时支持受限 unified diff，便于编码 Agent 精确修改多行文件。

### 6.6 知识库 Tool

- 保留 ingest、search、read、forget、status。
- 增加 `knowledge_reindex`。
- search 增加 path、tag、collection 和时间过滤。
- status 同时承担 list 文档职责，暂不增加重复的 list Tool。

### 6.7 配置、通知和 Channel

配置管理继续保持四阶段边界，不合并：

- `list_webclaw_config`
- `propose_webclaw_config_patch`
- `apply_webclaw_config_patch`
- `rollback_webclaw_config_patch`

外部发送在执行层使用 notification adapter。0.6.1 的唯一公开通知 Tool 是 `qiyewechat_notification`，其配置不进入模型上下文。交互式 Channel 回复仍由会话路由自动返回原 Channel 和 peer，不增加可绕过路由的通用 `channel_send` Tool。

### 6.8 高风险高级能力

以下能力不进入默认 Tool 集：

- `browser_cookies`：需要 cookies 权限和目标 host permission，可能读取 HttpOnly Cookie。
- `browser_devtools`：基于 `chrome.debugger`，可访问 Network、Console、DOM 和 Performance。
- 浏览数据清理、扩展管理、桌面捕获。

如实现，必须满足：独立设置开关、显著披露、逐目标审批、不可自动重放、Channel 远程调用受限、商店构建可排除。

## 7. Tool Bundle 和动态暴露

建议 bundle：

- `core`
- `page`
- `browser_tabs`
- `network`
- `vfs`
- `knowledge`
- `tasks`
- `notifications`
- `self_management`
- `browser_personal_data`
- `advanced_debugging`

每次 Run 初始只注入：

1. core；
2. 用户显式启用的常用 bundle；
3. 当前 Task 的 allowedTools；
4. 与来源相关的必要 Tool，例如 Channel reply。

其他 Tool 通过 `tool_search` 加入当前 Run。动态加载属于 Agent Runtime 外层机制，不放到 Provider Adapter 中，因此切换模型不会改变行为。

## 8. 统一结果和错误协议

建议结果：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "tool": "page_action",
    "resource": ["chrome:tab:123"],
    "effect": "write",
    "idempotency": "unknown",
    "durationMs": 25,
    "artifactIds": []
  }
}
```

错误：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "element_not_found",
    "message": "Element not found: #submit",
    "retryable": true,
    "details": {},
    "validExample": {}
  },
  "meta": {}
}
```

兼容期内 AgentRunner 继续接受现有结果格式，并在 Tool Observation 层归一化，避免一次性修改全部执行器。

## 9. 权限与审批模型

Tool Registry 为每个 Tool 声明：

- required manifest permissions；
- optional permissions；
- 动态 host permissions；
- 是否需要本地用户手势；
- 风险等级；
- 是否允许 Schedule 保存精确授权；
- 是否允许 Channel 远程批准；
- operation idempotency。

审批规则：

1. 只读页面操作首次申请 origin，后续在同 origin 复用 Chrome 权限。
2. 页面写操作使用已授权 origin，但外部发送、Cookie、历史删除和 run_js 有独立审批。
3. optional permission 只能由浏览器前的用户授予，Channel 数字批准不能替代 Chrome 权限弹窗。
4. Schedule 只对 Registry 明确允许且 fingerprint 完全一致的操作保存授权。
5. unknown 外部副作用在中断后不自动重放。

## 10. 分阶段实施

### 当前进度（2026-08-11）

- 已完成统一 Tool Registry、显式输入 Schema、递归参数校验、调度元数据和 UI 投影；旧名称直接删除，不保留别名。
- 已新增 `page_snapshot`、`page_action`、`page_wait`、`page_extract`、`page_storage`、`page_screenshot`、`page_file_input` 和 `browser_tabs`。
- 旧页面与 Tab Tool 已从 Registry 和 dispatch 删除，不保留执行别名。
- `http_request` 已支持 timeout、JSON、URL-encoded form、multipart VFS 文件、响应类型、大小限制和保存到 VFS。
- 已新增 `fs_stat`、`fs_glob`、`fs_hash`、`fs_diff`、`fs_archive` 和 `fs_preview_open`，并用 `fs_manage`、`fs_trash` 替代重复的单动作名称。
- 已完成 Tab Group、Sessions、Downloads、Bookmarks、History、Clipboard、Notifications 可选能力，均使用 optional permissions。
- 已完成 `tool_search` 当前运行动态暴露、统一模型结果信封、知识库过滤/reindex 和 notification adapter 执行层抽象。
- 已完成 Tools 管理页 category/bundle 搜索过滤和可选权限状态显示。

### 阶段 0：现状审计与规划

交付：本文档。

验收：现有 Tool、调用链、权限、重复能力和目标目录均有明确记录。

### 阶段 1：Tool Registry 基础

改动：

- 新建共享 `tool-registry.js`。
- background 和 sidepanel 从同一注册表读取内置 Tool。
- 为现有 Tool 补显式 input Schema。
- Scheduler metadata 从 Registry 读取。
- 删除旧名称和历史 alias，Registry 只接受规范 Tool 名称。
- 增加 Registry 一致性、Schema 和迁移测试。

验收：

- background 与 sidepanel 不再各自维护内置 Tool 列表。
- 每个内置 Tool 有 category、Schema、effect、risk、idempotency 和 timeout。
- 旧 Tool 保存项在归一化时被丢弃，不会重新进入设置或模型上下文。

### 阶段 2：页面和 Tab 能力

改动：

- 实现 page_snapshot、page_action、page_wait、page_extract、page_screenshot、page_storage。
- 实现 browser_tabs。
- 删除 click/type_text/get_page_context/wait/navigate/chrome_api 的注册与执行分支。
- 增加 frame、条件等待、页面动作和 Tab 生命周期测试。

验收：

- 模型和运行时只接受新名称，旧调用明确失败。
- 页面动作返回执行后状态，不只返回“已调用”。
- Stop 发生后不启动新的页面写操作。

### 阶段 3：VFS、网络、知识和通知整合

改动：

- 增加 fs_stat/glob/diff/hash/archive/preview。
- 增加 fs_manage 和 fs_trash，并移除被替代的旧名称。
- http_request 支持二进制、multipart、timeout 和 saveToVfs。
- 增加 knowledge_reindex 和过滤条件。
- 建立 notification adapter 抽象，`qiyewechat_notification` 作为当前唯一规范名称。

验收：所有写操作都有稳定 resource key、effect 和恢复策略；二进制不会无限进入模型上下文。

### 阶段 4：可选 Chrome 能力和动态暴露

改动：

- 实现 Tool bundle 和 tool_search。
- 增加 Downloads、Bookmarks、History、Sessions、Tab Groups、Clipboard、Notifications 可选能力。
- Settings 显示 bundle、权限状态、连接/启用状态和风险说明。
- Cookie/DevTools 只做高级实验能力评估，不默认启用。

验收：

- 首次安装不增加新的必选敏感权限。
- 未授权 Tool 不发送给模型。
- Tool Search 加载结果只影响当前 Run，不修改全局配置。

### 阶段 5：发布迁移

改动：

- 更新 README、PRIVACY、STORE_LISTING、RELEASE、CHANGELOG。
- 更新 VFS 默认知识手册和 TOOLS.md 模板。
- 更新 Tool 管理 UI 分类和搜索。
- 增加旧内置 Tool 保存项清理测试，并验证旧名称不会重新进入 Registry。
- 版本更新为 0.6.1 并执行完整打包验证。

验收：升级后用户设置、Webhook、自定义 Tool、Schedule 和历史 Tool 轨迹不丢失；其中引用已移除 Tool 的 Skill、Schedule 或历史调用不会被转换或执行。发布包不包含远程代码或未披露权限。

## 11. 旧 Tool 清理策略

1. Registry、模型 Schema 和执行分发只接受规范名称。
2. 旧内置 Tool 保存项在 settings 规范化时丢弃，不转换成自定义 Tool。
3. 历史 Tool 轨迹保留原始名称作为历史事实，但不能再次执行。
4. 引用旧名称的 Skill 和 Schedule 必须显式更新；系统不猜测参数转换。
5. 旧 Schedule 授权 fingerprint 不迁移到新 Tool，避免把旧授权扩展到语义不同的新操作。
6. 发布校验反向禁止旧名称重新进入 Registry。

## 12. 测试矩阵

- Registry 唯一名称、无历史 alias 和分类完整性。
- 每个 Tool example 通过自己的 input Schema。
- background 与 sidepanel 生成相同 Tool 列表。
- 旧名称不注册、不暴露且不能执行。
- Provider native Tool 与 JSON transport 使用同一 Schema。
- Scheduler resource conflict、并行、安全重试和 unknown 副作用。
- optional permission 未授权、拒绝、授权和撤销。
- Side Panel、Channel、Schedule、子任务和恢复路径行为一致。
- 小上下文 Provider 只收到 core 和已加载 bundle。
- 清空会话同步删除 Tool artifacts 和 RunStore operation。

## 13. 非目标

0.6.1 不实现真实操作系统 Shell，不绕过网页同源策略，不读取 Chrome 未授权的个人数据，不允许模型直接读写 `chrome.storage.local`，不通过远程下载脚本扩展 Tool，也不把 Provider 差异带回 Agent Loop。
