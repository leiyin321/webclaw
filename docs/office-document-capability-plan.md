# WebClaw 办公文档能力设计与开发计划

状态：0.7.0 浏览器基础能力已实现；保真编辑、复杂渲染和真实 Office 应用互操作仍属于后续阶段

建议目标版本：0.7.0

适用范围：Markdown、DOCX、XLSX、PPTX、PDF、VFS、Tool Registry、知识库、文件管理器和文档预览

最后更新：2026-08-11

当前实现说明：已提供统一 `DocumentService`、Markdown 解析/渲染、基础 DOCX/XLSX/PPTX 创建和 rebuild 编辑、ASCII 文本 PDF 创建、DOCX/XLSX/PPTX/PDF 的受控只读投影、段落/单元格/幻灯片 locator、版本与哈希保护、自动 pre-write revision、恢复与确认清理、8 个文档 Tools、独立投影视图、知识库投影 ingest 和自动化测试。当前 Office/PDF 读取使用浏览器原生 ZIP/XML/TextDecoder，不执行宏、外部关系、公式重算、脚本或 OCR。PDF 解析器不能可靠隔离单页文本，因此 0.7.0 明确拒绝 `pdf_page` locator。DOCX/XLSX/PPTX rebuild 编辑不保证样式、图片、动画和未知 OOXML 部件保留。

0.7.1 及后续复杂样式生成的可执行开发方案见 [复杂样式文档生成迭代计划](rich-document-generation-plan.md)。

## 1. 文档目的

本文定义 WebClaw 在纯 Chrome 扩展环境中读取、创建、编辑、渲染和导出常用办公文档的目标架构、能力边界、Tool 契约、安全约束、模块拆分、测试矩阵和分阶段开发计划，可直接作为后续代码开发依据。

本阶段明确不集成 MarkItDown，不引入 Python、Pyodide、本地 Bridge 或必须联网的文档转换服务。所有基础文档处理能力必须在浏览器中离线执行，第三方 JavaScript 依赖必须随扩展本地打包，不允许从 CDN 动态加载代码。

## 2. 目标与非目标

### 2.1 核心目标

1. 支持 Markdown、DOCX、XLSX、PPTX 和 PDF 的格式识别、结构检查和受控内容读取。
2. 支持 Markdown、DOCX、XLSX 和 PPTX 的新文件生成；支持 PDF 的新建、页面组合和表单填写。
3. 支持格式能力范围内的结构化编辑，并明确报告不支持或可能损失保真度的操作。
4. 原始文件、生成文件、预览和派生内容全部使用现有 VFS，不访问本机任意路径。
5. 所有 Provider 使用同一套文档 Tool、参数校验、Agent Loop、审批、Artifact 和错误恢复机制。
6. 大文档按页、段落、工作表区域或幻灯片分块读取，不能默认把整个文件放入模型上下文。
7. 文档修改使用乐观并发控制和原子替换，避免模型基于旧版本覆盖用户修改。
8. 文档可进入现有知识库，并保留页码、段落、工作表、单元格区域或幻灯片等来源定位信息。
9. 文件管理器为支持的格式提供独立预览入口，不在会话或设置窗口中叠加复杂编辑界面。

### 2.2 非目标

首版不承诺：

- 实现完整的 Microsoft Word、Excel 或 PowerPoint WYSIWYG 编辑器；
- 100% 还原 Office 桌面应用的分页、字体替换、动画、宏、嵌入对象和高级图表；
- 在浏览器中执行 VBA、Office Scripts、外部链接或任意嵌入脚本；
- 对加密、密码保护、数字签名或 DRM 文档进行破解或静默降级；
- 像 Word 一样重排和原位修改任意 PDF 正文；
- 在浏览器中实现完整 Excel 公式计算引擎；
- 使用“转成 Markdown 后再转回原格式”的方式冒充保真编辑。

首版 Office 范围仅包括 OOXML 格式 `.docx`、`.xlsx` 和 `.pptx`。旧版二进制 `.doc`、`.xls`、`.ppt` 只识别并返回 `document_format_unsupported`，要求用户先用可信 Office 应用转换；不因文件扩展名相近而尝试错误解析。

## 3. 格式能力边界

下表描述完整目标。0.7.0 实际交付范围以紧随其后的基础能力表为准，未实现项不能由 Agent 推断为可用。

| 格式 | 读取 | 创建 | 编辑已有文件 | 渲染 | 首版边界 |
| --- | --- | --- | --- | --- | --- |
| Markdown | 完整 | 完整 | 完整 | HTML | CommonMark + GFM + YAML Front Matter；精确文本编辑仍可使用 `fs_edit` |
| DOCX | 段落、标题、列表、表格、链接、图片元数据、页眉页脚 | 支持 | 受控文本、段落、表格、图片和模板字段 | 近似 HTML/分页预览 | 不承诺复杂排版、修订、域、SmartArt 和嵌入对象的无损修改 |
| XLSX | 工作表、区域、值、公式、样式摘要、合并单元格 | 支持 | 单元格、区域、工作表、基础样式、公式和表格 | HTML/Canvas | 保存公式但不完整计算；不执行宏和外部数据连接 |
| PPTX | 幻灯片、文本、备注、表格、图表数据摘要、图片元数据 | 支持 | 文本替换、备注和有限对象修改 | 近似幻灯片预览 | 生成能力优先；不承诺动画、母版和复杂对象的无损编辑 |
| PDF | 文本、页、元数据、链接、表单、页面图像 | 支持 | 合并、拆分、旋转、表单填写、覆盖文字/图片、批注 | Canvas | 不提供任意正文重排；扫描 PDF 的 OCR 由支持视觉的模型按需完成 |

必须在 Tool Result 中返回 `fidelity` 和 `warnings`。当操作会重建文档或可能损失未知结构时，执行前必须显式选择 `editMode: "rebuild"`；默认 `editMode: "preserve"` 只能执行适配器确认可保真的操作。

### 3.1 0.7.0 基础能力

| 格式 | 读取投影 | 创建 | 编辑 | 独立预览 |
| --- | --- | --- | --- | --- |
| Markdown | 完整文本、行范围、Heading | 完整基础结构 | 精确文本/Heading/Front Matter | 安全 HTML |
| DOCX | 段落、标题和表格；段落 locator | 标题、段落、列表、表格 | rebuild 文本替换 | Markdown 投影 |
| XLSX | 工作表、值和公式；单元格 locator | 工作表、值和公式 | rebuild 单元格设置/清空 | Markdown 投影 |
| PPTX | 幻灯片文本；幻灯片 locator | 基础标题和正文 | rebuild 文本/幻灯片操作 | Markdown 投影 |
| PDF | 保守的全文件文本字符串投影 | ASCII 简单文本页 | 不支持 | Markdown 投影 |

Office/PDF 可导出 Markdown 或 JSON 投影。结构化结果受 `maxChars` 约束，超限时要求 Agent 使用更窄的格式 locator 或 Markdown 投影。所有 DocumentService 覆盖、编辑和恢复都会先保存旧 Blob；每个路径保留最近 20 个 revision 且总容量默认不超过 100 MB，单个最新 revision 即使较大也会保留。

## 4. 总体架构

```text
AgentRunner
  -> Tool Registry (documents bundle)
  -> DocumentService
       -> format detection and policy
       -> operation/schema validation
       -> optimistic version check
       -> adapter dispatch
       -> artifact/projection management
       -> atomic VFS commit
          -> MarkdownAdapter
          -> DocxAdapter
          -> XlsxAdapter
          -> PptxAdapter
          -> PdfAdapter
  -> Offscreen Document
       -> lazy format bundles
       -> DOM/Canvas rendering
  -> VFS / Agent Artifact / Knowledge Base
  -> document viewer window
```

### 4.1 保持单一 Agent 外层机制

文档能力只增加 Tool 和执行适配器，不修改 Provider 决策逻辑：

- Provider 仍只返回统一 ModelTurn；
- ToolScheduler 仍负责校验、资源冲突、超时、取消和幂等性；
- DocumentService 返回统一 Tool Observation；
- AgentRunner 必须根据实际文档 Tool Result 决定下一步；
- Channel、Schedule、Task 和 Side Panel 继续使用同一个 AgentService；
- 不为 Chrome AI、本地模型或线上模型建立不同的文档执行流程。

### 4.2 DocumentService 职责

新增 `src/document-service.js`，作为文档能力唯一入口：

1. 从 VFS 读取 Blob、entry、version 和 SHA-256；
2. 根据扩展名、MIME 和文件签名识别格式，不能只信任扩展名；
3. 检查大小、压缩包展开限制、加密、宏和外部关系；
4. 选择 Adapter 并执行操作；
5. 对大文本创建 Agent Artifact，返回受控摘要；
6. 写操作验证 `expectedVersion` 或 `expectedHash`；
7. 在内存中生成完整新 Blob，验证可重新打开后再原子替换 VFS 文件；
8. 返回新 version、hash、修改摘要、保真度和警告；
9. 管理派生 Markdown、预览和缓存失效。

### 4.3 格式 Adapter 接口

```js
{
  format,
  detect({ entry, bytes }),
  inspect({ blob, limits, signal }),
  read({ blob, locator, output, limits, signal }),
  create({ spec, limits, signal }),
  edit({ blob, operations, editMode, limits, signal }),
  render({ blob, selection, options, signal }),
  export({ blob, targetFormat, options, signal }),
  validate({ blob, limits, signal })
}
```

Adapter 不直接写 VFS，也不调用模型。所有副作用由 DocumentService 统一提交。

## 5. 内容表示

### 5.1 不建立虚假的“无损统一文档模型”

Office 和 PDF 的布局语义差异很大。系统只统一读取投影和 Tool Result，不强迫所有格式转换成一个可逆 IR。

每个 Adapter 保留自己的原生结构；对 Agent 提供两种投影：

- `markdown`：适合模型理解、摘要和知识库索引；
- `json`：适合精确定位和后续结构化编辑。

Markdown 投影不是原始文档的权威副本，不允许用“Office -> Markdown -> Office”作为默认编辑链路。

### 5.2 通用描述对象

```json
{
  "path": "/workspace/documents/report.docx",
  "format": "docx",
  "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "size": 183240,
  "version": 4,
  "hash": "sha256:...",
  "encrypted": false,
  "capabilities": {
    "read": true,
    "create": true,
    "edit": "limited",
    "render": "approximate",
    "export": ["markdown"]
  },
  "structure": {
    "sections": 3,
    "paragraphs": 126,
    "tables": 4,
    "images": 8
  },
  "warnings": []
}
```

### 5.3 来源定位

读取结果必须携带绑定当前 source version/hash 的格式定位信息。源文档改变后旧 locator 自动失效，Agent 必须重新读取：

- Markdown：行号、Heading path、AST node ID；
- DOCX：section、paragraph ID、table/row/cell；
- XLSX：sheet name、A1 range、table name；
- PPTX：slide number、shape ID、notes；
- PDF：page number、text item range、bounding box。

知识库 chunk 保存 `sourceLocator`，回答时可以引用“第 5 页”“Sheet1!A2:F20”或“第 8 张幻灯片”，而不是只引用文件名。

## 6. Tool 设计

文档 Tool 放入 `documents` bundle，默认启用但不属于常驻 core，由 `tool_search` 按当前任务加载。首版使用 8 个规范名称，不保留别名。

### 6.1 `document_inspect`

识别格式、能力、结构、风险和版本，不返回完整正文。

```json
{"path":"/workspace/documents/report.docx","includeOutline":true}
```

### 6.2 `document_read`

按 locator 分块读取，输出 `markdown` 或 `json`。`maxChars` 只限制模型可见投影；完整结果过大时使用 `FULL_RESULT_REF`。

```json
{
  "path":"/workspace/documents/budget.xlsx",
  "locator":{"kind":"sheet_range","sheet":"Summary","range":"A1:H40"},
  "output":"markdown",
  "maxChars":12000
}
```

### 6.3 `document_schema`

返回某格式创建或编辑操作的精确 Schema、能力和示例。这样不需要向所有模型永久暴露大量格式专用 Tool，同时避免 `document_edit.operations` 变成无约束对象。

```json
{"format":"xlsx","operation":"edit","actions":["set_cells","style_range"]}
```

结果包含 `schemaVersion`。Agent 在首次创建/编辑某种格式前必须先调用此 Tool，并把版本写入后续调用；执行器仍会独立校验，不能只依赖模型遵守说明。Adapter 操作契约升级后，旧版本调用返回 `document_operation_invalid` 和新的查询示例。

### 6.4 `document_create`

按 `document_schema` 返回的 spec 创建新文档。默认拒绝覆盖。

```json
{
  "path":"/workspace/documents/weekly-report.docx",
  "format":"docx",
  "schemaVersion":"docx-create-1",
  "spec":{"title":"周报","blocks":[{"type":"paragraph","text":"本周完成..."}]},
  "overwrite":false
}
```

覆盖已有文件时还必须提供 `expectedVersion` 或 `expectedHash`，并进入与 `document_edit` 相同的 revision 和原子提交流程。

### 6.5 `document_edit`

对原生文档执行一组结构化操作。

```json
{
  "path":"/workspace/documents/budget.xlsx",
  "expectedVersion":3,
  "schemaVersion":"xlsx-edit-1",
  "editMode":"preserve",
  "operations":[
    {"op":"set_cells","sheet":"Summary","start":"B2","values":[[1200,1300],[1400,1500]]}
  ]
}
```

约束：

- `expectedVersion` 或 `expectedHash` 至少提供一个；
- 每次最多 100 个 operations；
- 同一个 Tool Call 中全部操作成功才提交；
- 验证失败不修改原文件；
- 返回可恢复 revision ID。

### 6.6 `document_render`

把选定页、工作表或幻灯片渲染为 VFS PNG/HTML，并返回路径。渲染用于用户预览和视觉模型复核，不把大量 base64 放进 Tool Result。

```json
{
  "path":"/workspace/documents/deck.pptx",
  "selection":{"slides":[1,2,3]},
  "outputDirectory":"/cache/document-previews",
  "scale":1.5
}
```

### 6.7 `document_export`

转换或导出到新的 VFS 路径，绝不隐式覆盖源文件。

```json
{
  "path":"/workspace/documents/report.docx",
  "targetFormat":"markdown",
  "outputPath":"/exports/report.md",
  "options":{"includeImages":true}
}
```

支持范围由 Adapter 报告；不支持的转换必须返回明确错误，不能生成伪文件。

### 6.8 `document_revision`

列出、恢复或永久删除 DocumentService 创建的 revision，使文档修改真正闭环。恢复时必须提供当前文件的 `expectedVersion`，并先把当前版本保存为一个新 revision；永久删除要求 `confirm: true`。

```json
{
  "action":"restore",
  "path":"/workspace/documents/budget.xlsx",
  "revisionId":"revision-id",
  "expectedVersion":4
}
```

Revision 不等同于通用 VFS 版本控制，只覆盖 DocumentService 对二进制文档的修改。

### 6.9 调度与副作用语义

Tool Registry 为文档 Tool 提供明确 Scheduler 元数据：

| Tool | effect | resource | idempotency |
| --- | --- | --- | --- |
| `document_inspect`、`document_read`、`document_schema` | read | `vfs:<source>` 或 `document:schema` | safe |
| `document_create` | write | `vfs:<target>` | retry_safe（依赖 operation key 和默认不覆盖） |
| `document_edit` | write | `vfs:<source>`、`document:revision:<source>` | retry_safe（依赖 operation key 和 version/hash） |
| `document_render` | read + write | `vfs:<source>`、`vfs:<outputDirectory>` | retry_safe |
| `document_export` | read + write | `vfs:<source>`、`vfs:<outputPath>` | retry_safe |
| `document_revision` | write | `vfs:<source>`、`document:revision:<source>` | action_dependent |

同一路径的读取和写入由现有资源冲突规则排序；不同文档的只读操作可并行。`editMode: "rebuild"`、覆盖创建和 revision 永久删除属于提高风险的操作，必须进入现有审批/确认机制。

当前 Registry 以 Tool 级读写模式生成资源锁，不能为一个调用同时描述只读源和写入目标。首版对 `document_render` 和 `document_export` 的全部相关资源保守地使用 write lock，不为并行性能扩展一套新的 Scheduler；后续只有测量证明必要时才增加逐资源 mode。

所有面向文件的成功结果至少在 data 中返回：`path`、`format`、`version`、`hash`、`fidelity` 和 `warnings`；写操作额外返回 `revisionId` 和规范化的 `changes`。`document_schema` 返回 format、operation、schemaVersion、Schema 和示例。耗时继续使用现有 Observation `meta.durationMs`，不在 data 中复制。这些字段进入现有 `ok/data/error/meta` Tool Observation，不建立第二套结果信封。

## 7. Markdown 一等支持

Markdown 不是 Office 的附属输出，而是一等文档格式。

### 7.1 支持语法

- CommonMark；
- GitHub Flavored Markdown 表格、任务列表、删除线和自动链接；
- YAML Front Matter；
- 标题、段落、列表、引用、链接、图片、代码块和脚注的结构读取；
- UTF-8 和现有 VFS 文本版本控制。

首版不默认支持执行 MDX、HTML script 或 Markdown 内嵌 JavaScript。

候选实现采用 `unified`/`remark-parse`、`remark-gfm` 和 `remark-frontmatter` 生成 mdast，再通过受控 renderer 输出 HTML。依赖仍需通过 Phase 0 的 CSP、许可证、体积和安全准入。

参考：

- https://github.com/unifiedjs/unified
- https://github.com/remarkjs/remark

### 7.2 编辑策略

- 精确行和文本修改继续使用现有 `fs_read`、`fs_edit` 和 `fs_apply_patch`；
- 语义操作通过 `document_edit`，例如更新 Front Matter、替换指定 Heading 下的 section、插入表格行、更新任务状态和修复链接；
- AST 重写必须尽量保留无关原文；无法保留时返回格式化警告；
- Markdown 渲染必须清理危险 HTML、事件属性和 `javascript:` URL。

### 7.3 预览

文件管理器为 `.md` 和 `.markdown` 增加 Preview。预览在独立窗口或标签页中显示目录、正文和本地 VFS 图片，不执行文档内脚本，不使用现有允许网页脚本运行的静态站点 sandbox。

## 8. 格式适配器设计

### 8.1 DOCX

候选浏览器库：

- `mammoth`：DOCX 到 HTML/结构化文本读取；
- `docx`：浏览器端 DOCX 生成；
- `fflate`：OOXML ZIP 的受控读取和写回；
- 浏览器 DOMParser/XMLSerializer：关系和 XML 部件处理。

读取投影保留标题、列表、表格、链接、图片引用和基本样式语义。创建使用声明式 blocks。保真编辑直接修改 OOXML 部件并保留未知 ZIP entry；不支持的结构在 `preserve` 模式下拒绝，在 `rebuild` 模式下才允许重建。

参考：

- https://github.com/mwilliamson/mammoth.js
- https://github.com/dolanmiu/docx
- https://github.com/101arrowz/fflate

### 8.2 XLSX

候选库：`ExcelJS`。浏览器端读取、修改和写出 workbook，覆盖值、公式、基础样式、工作表、合并单元格、表格和图片的常用场景。

关键规则：

- 默认读取公式和缓存值；
- 写入公式后标记 workbook 打开时重算，不宣称浏览器已得到真实计算结果；
- 不自动刷新外部数据源；
- `.xlsm`、VBA 和外部连接首版拒绝写入；
- CSV 导出对以 `=`, `+`, `-`, `@` 开头的非公式文本给出注入警告。

参考：https://github.com/exceljs/exceljs

### 8.3 PPTX

候选库：`PptxGenJS` 用于创建；读取和有限保真编辑通过 OOXML ZIP Adapter 完成。

创建支持主题、母版选择、文本、图片、表格、常用图表和备注。已有文件首版只承诺文本、备注和已验证对象属性的保真修改；动画、SmartArt、OLE、视频和未知扩展拒绝修改但允许原样保留。

参考：https://github.com/gitbrent/PptxGenJS

### 8.4 PDF

候选库：

- Mozilla PDF.js：文本提取和 Canvas 渲染；
- pdf-lib：创建、页面组合、旋转、表单填写、文字和图片覆盖。

PDF 编辑操作按页面和坐标执行。正文提取结果只用于阅读，不能直接映射成可重排段落。扫描页可以先渲染成图片，再按 Provider 媒体能力交给模型，但 OCR 结果必须标记为模型推断。

参考：

- https://github.com/mozilla/pdf.js
- https://github.com/Hopding/pdf-lib

### 8.5 依赖准入

所有候选依赖在实施 Phase 0 必须完成：

- 浏览器和 MV3 CSP 兼容验证；
- 许可证、NOTICE 和传递依赖审计；
- bundle 大小和冷启动测量；
- 无远程代码加载确认；
- 恶意 ZIP/XML/PDF 样本测试；
- 最小版本锁定和 lockfile；
- Chrome Web Store 包内容检查。

候选库不是预先批准的最终依赖；任一库未通过准入时更换实现，不改变公开 Tool 契约。

## 9. 浏览器执行与打包

### 9.1 Offscreen 复用

Chrome 同一扩展只能谨慎管理 offscreen document。文档能力复用当前 `src/chrome-ai-offscreen.html` 和 `src/offscreen.js`：

- 新增轻量 `document-offscreen.js` 消息路由；
- 首次文档请求时由共享 Offscreen Document 把规范化请求转交给 manifest 声明的独立 document sandbox；sandbox 通过静态打包的单一 IIFE bundle 加载格式引擎，Service Worker 不使用动态 `import()`；
- DOM、Canvas、字体测量和渲染在 offscreen 中执行；
- Service Worker 保持 DocumentService、VFS 提交和 Tool 生命周期所有权；
- 取消请求通过 request ID 和 AbortController 传播；
- 不静态加载全部 Office/PDF 库，避免影响普通聊天和 Channel 启动。

### 9.2 构建策略

当前仓库没有通用前端构建链。办公文档依赖不能散落为手工复制的 minified 文件。建议只为文档模块增加受限构建步骤：

1. 添加 `package.json` 和 lockfile；
2. 使用固定版本 bundler 生成 `build/document/*.js`；
3. `npm run build:documents` 只打包文档 Adapter 依赖，不转译现有 WebClaw 主代码；
4. `package-extension.sh` 在复制扩展前执行并验证文档 bundle；
5. CI 从 lockfile 重建，比较预期入口和许可证清单；
6. 扩展运行时只加载 `chrome-extension://` 本地 bundle。

开发模式必须在 README 中明确先执行 `npm ci && npm run build:documents`。是否提交生成 bundle 在 Phase 0 决定；发布 ZIP 必须始终由干净环境重建。

## 10. VFS、版本和缓存

### 10.1 原子写入

文档写操作流程：

1. `vfsStat` 和 `vfsGetFileBlob` 读取版本；
2. 在内存中执行全部操作；
3. Adapter 重新打开输出 Blob 并做结构验证；
4. 调用新增的内部 `vfsCommitDocument`；
5. 在同一个 IndexedDB readwrite transaction 中重新读取并校验 version/hash、保存旧 Blob revision、更新 entry 和替换 content；
6. transaction 成功后失效派生缓存，失败时不改变源文件。

不能用“写临时 VFS 文件后普通 move”冒充原子提交，因为当前目录树 move 不是覆盖 entry、content 和 revision 的单事务。

现有 VFS 只有 path 和 entry version，没有可跨重命名识别文件的稳定 ID，也没有旧内容版本。实施时升级 VFS schema：

- 为 file entry 增加不可变 `entryId`，旧 entry 懒迁移；
- move 保留 `entryId`，copy 创建新 `entryId`，trash/restore 保留；
- 新增以 `entryId` 为主关联的 `document-revisions` store；
- 默认每个文件保留最近 5 个 revision，并受全局 100 MB 上限控制；
- revision 保存 source path、version、hash、Blob、Adapter version、change summary 和创建时间；
- Revision 只保存 DocumentService 修改前的 Blob，不复制普通 `fs_write` 历史。

### 10.2 派生缓存

```text
/cache/documents/<source-sha256>/content.md
/cache/documents/<source-sha256>/structure.json
/cache/documents/<source-sha256>/assets/*
/cache/document-previews/<source-sha256>/*
```

缓存以源 hash 和 Adapter version 为键。源文件变更后自动失效；缓存不作为原文事实，不进入文件管理器默认列表，允许用户清理。

## 11. 知识库集成

扩展 `knowledge_ingest`：

1. 文本和 Markdown 保持现有路径；
2. Office/PDF 先调用 DocumentService 生成 Markdown 投影；
3. index 记录源 VFS path、version、hash、format、Adapter version 和 locator map；
4. `knowledge_search` 返回 chunk 时附带 `sourceLocator`；
5. `knowledge_reindex` 检查源 hash，仅重建变化文档；
6. 删除知识索引不删除原文档或派生缓存；
7. 文档内容发送给外部 Provider 时继续遵守现有显著披露和 Provider 权限。

图片、图表和扫描页面默认不做后台隐式 OCR。只有用户任务需要且当前 Provider 支持图片时，Agent 才通过 `document_render` 获取指定页面图片并显式处理。

## 12. 文件管理器和预览 UI

### 12.1 文件列表

支持格式显示统一文档图标、格式、大小和修改时间，并提供 Preview 按钮。单击仍选中文件，不改变现有文件夹单击/双击规则。

### 12.2 独立文档查看器

新增独立 `document-viewer.html/js/css`：

- Markdown：目录和安全渲染正文；
- DOCX：近似页面/HTML 预览和 Outline；
- XLSX：工作表 Tab、冻结表头的只读网格和范围定位；
- PPTX：幻灯片缩略图和主预览；
- PDF：页缩略图、缩放、翻页和文本选择。

查看器首版只读。Agent 修改后通过消息刷新对应 hash，不在查看器中实现完整手工 Office 编辑器。下载继续复用文件管理器现有能力。

### 12.3 状态与错误

长操作显示 `Parsing`、`Rendering`、`Validating`、`Saving` 阶段及可停止按钮。错误必须显示格式、文件、Adapter、阶段和可操作建议，不能只显示 `Failed to parse`。

## 13. 安全、隐私和资源限制

### 13.1 文件安全

- 根据签名和内部结构验证格式，拒绝伪造扩展名；
- OOXML 解压默认限制：25 MB 源文件、100 MB 展开总量、10,000 entries、单 entry 25 MB；
- 拒绝路径穿越、绝对 ZIP 路径和重复覆盖 entry；
- XML 禁止外部实体和外部资源解析；
- 不获取 Office 外部 relationship、PDF 外部资源或 Markdown 远程图片；
- 拒绝加密文档写操作；
- 宏格式默认只读或直接拒绝，绝不执行；
- HTML/Markdown 预览清理脚本、事件属性和危险 URL；
- PDF JavaScript、Launch action 和嵌入文件不执行。

### 13.2 运行限制

- 单次 `document_read` 模型可见文本默认 20,000 字符；
- 单次最多读取 50 页、10,000 个单元格或 50 张幻灯片；
- 单次渲染最多 20 页/幻灯片，最长边默认 2,048 px；
- 单次编辑最多 100 operations；
- 默认超时 120 秒；
- 每个步骤检查 AbortSignal；
- 大结果进入 Agent Artifact；
- 超限错误返回当前规模和建议 locator，不静默截断关键结构。

### 13.3 权限和隐私

处理 VFS 本地文档不新增 host permission。导入、下载和发送给模型继续使用现有权限与披露机制。文档库不得自行联网，不能把文档上传给第三方转换服务。

## 14. 错误协议

统一错误码：

| code | 含义 | Agent 恢复方式 |
| --- | --- | --- |
| `document_format_unsupported` | 格式或版本不支持 | 查询 inspect capabilities 或换格式 |
| `document_encrypted` | 文档加密 | 要求用户提供未加密副本 |
| `document_too_large` | 超过安全/资源限制 | 缩小 locator、拆分文件 |
| `document_version_conflict` | version/hash 已变化 | 重新 inspect/read 后生成新操作 |
| `document_operation_invalid` | operation 不符合格式 Schema | 调用 `document_schema` 后修正 |
| `document_fidelity_risk` | preserve 模式无法保证 | 改用支持操作，或经用户确认使用 rebuild |
| `document_parse_failed` | 文件损坏或解析器失败 | 返回阶段和内部部件，不修改源文件 |
| `document_validation_failed` | 输出无法重新打开 | 保留源文件并报告失败 |
| `document_render_failed` | 渲染失败 | 仍可尝试结构化读取 |
| `document_cancelled` | 用户停止 | 清理临时文件，不提交修改 |

Tool Result 使用现有 `ok/data/error/meta` 信封；参数错误附带对应 `document_schema` 查询示例，让小模型能纠正调用。

## 15. 测试策略

### 15.1 单元测试

- 格式签名检测和 MIME 冲突；
- locator 解析、范围限制和 Schema 校验；
- Markdown AST 读取、语义编辑和危险 HTML 清理；
- OOXML ZIP 安全检查、关系解析和未知 entry 保留；
- XLSX 值、公式、样式和合并单元格 round-trip；
- PDF page/form 操作；
- expectedVersion/hash 冲突；
- revision 创建、上限和恢复；
- 缓存 key、失效和 Artifact 分流；
- AbortSignal 和临时文件清理。

### 15.2 Fixture 语料库

仓库增加小型、可公开分发的 fixtures：

- 每种格式的最小文件；
- 中文、英文、Emoji、RTL 和常用 CJK 字体；
- 多页、表格、图片、链接、公式、图表和备注；
- 损坏 ZIP、路径穿越、超高压缩比、错误 MIME；
- 加密、宏、外部链接等必须拒绝的文件；
- 已知复杂结构用于验证“保留或明确拒绝”，不能静默损坏。

二进制 fixture 需记录来源、许可证和生成脚本。

### 15.3 集成测试

每种格式至少覆盖：

```text
VFS import
  -> inspect
  -> scoped read
  -> schema
  -> edit/create
  -> validate
  -> render
  -> knowledge ingest/search
  -> download and reopen
```

验证 ToolScheduler 对同一文档写操作串行、不同文档读取可并行；验证 Agent 在 Tool 失败后能读取错误并修正参数。

### 15.4 视觉与互操作验证

- 使用 Playwright 检查 Markdown、表格、幻灯片和 PDF 查看器桌面尺寸；
- Canvas 像素检查确认预览非空；
- 用 Microsoft Office、LibreOffice 和浏览器 PDF Viewer 人工打开生成文件；
- 对生成前后结构、文本和关键布局截图做基线比较；
- Chrome 扩展重新加载后验证 VFS、revision、缓存和知识索引持久化。

## 16. 分阶段开发计划

### Phase 0：依赖与格式 Spike

交付：

- 创建最小浏览器测试页验证候选库和 MV3 CSP；
- 测量每个 bundle 的压缩/解压大小、首次加载和 25 MB 文件内存峰值；
- 完成许可证与安全记录；
- 用 fixtures 验证读取、写回和重新打开；
- 确定构建产物策略并形成 ADR。

退出条件：每种格式至少有一个浏览器端可行实现；不通过的格式调整首版边界，而不是引入 Python 服务。

### Phase 1：Document Core + Markdown

交付：

- `document-service.js`、Markdown Adapter 和格式识别；
- `document_inspect/read/schema/create/edit/render/export/revision` Registry 定义；
- Tool dispatch、错误码、预算、取消和 Artifact；
- Markdown Adapter、AST 语义编辑和安全预览；
- 文件管理器 Markdown Preview；
- DocumentService 与 VFS version/hash 集成。

阶段状态：已完成核心代码和自动化测试。模型能创建、读取、精确编辑和预览 Markdown；DOCX、XLSX、PPTX、PDF 可 inspect/read 并进入知识库投影；所有已注册 Tool 通过统一 Agent Loop。Office/PDF 也可从文件管理器打开独立投影视图。下一步是浏览器真实压缩 OOXML 文件回归、派生缓存和大结果 Artifact。

### Phase 2：Office/PDF 统一读取与知识库

交付：

- DOCX、XLSX、PPTX、PDF inspect/read（基础投影已完成）；
- Markdown/JSON 投影和 locator map；
- 派生缓存和失效；
- 知识库 ingest/reindex/search 来源定位（当前已支持投影 ingest，locator 元数据待补）；
- 大结果 Artifact 和分块读取。

阶段状态：基础读取、知识库投影以及 DOCX 段落、XLSX 单元格、PPTX 幻灯片 locator 已完成；PDF 页级 locator 因当前解析器无法准确隔离页面而明确拒绝。退出条件仍需真实压缩文件、Artifact 分块和浏览器内存/恶意文件测试。

### Phase 3：XLSX 创建与编辑

交付：

- workbook 创建、工作表管理、值/公式基础操作（已完成最小版本）；样式、合并和表格操作待补；
- 工作表只读预览；
- 公式未计算状态和 CSV 注入警告；
- 原子写入、revision 和恢复。

阶段状态：最小 XLSX 生成和 `editMode=rebuild` 的 set_cell/clear_cell 已完成。退出条件仍需 Excel/LibreOffice 互操作验证、样式/合并/表格支持和 preserve 模式。

### Phase 4：DOCX 创建与保真编辑

交付：

- blocks 创建（基础版本已完成）；
- 标题、段落、列表、表格、链接、图片和模板字段；
- rebuild 模式（基础版本已完成）；preserve 模式待后续实现；
- DOCX HTML/近似页面预览；
- 未知 OOXML part 保留验证。

阶段状态：基础段落、标题、列表、表格生成和 rebuild 文本编辑已完成。退出条件仍需 preserve 模式、图片/模板字段、未知 OOXML 部件保留和 Word/LibreOffice 互操作验证。

### Phase 5：PDF 能力

交付：

- 基础文本 PDF 创建（已完成）；PDF.js 文本/链接/表单读取和 Canvas 预览待补；
- 创建、合并、拆分、旋转、表单填写、页面覆盖；
- 指定页渲染给视觉模型；
- PDF 危险 action 禁用测试。

退出条件：页面级操作稳定；系统不宣称支持任意正文重排。

### Phase 6：PPTX 创建与有限编辑

交付：

- 基础文本幻灯片创建（已完成）；主题、母版、图片、表格、常用图表和备注待补；
- rebuild 文本编辑（已完成）；文本/备注等白名单保真编辑待补；
- 幻灯片查看器和缩略图；
- 未知对象、动画和嵌入内容保留/拒绝策略。

阶段状态：基础文本幻灯片生成和 rebuild 文本编辑已完成。退出条件仍需 PowerPoint/Keynote/LibreOffice 互操作验证、布局和未知部件保留。

### Phase 7：整合、文档和发布

交付：

- 文件管理器统一 Preview；
- 默认知识库和中英文 README 使用示例；
- PRIVACY、STORE_LISTING、第三方许可证和 Release checklist；
- 包体积、内存、恶意文件和长任务回归；
- Chrome Web Store 发布包验证。

退出条件：完整测试矩阵通过，发布 ZIP 不含远程代码、测试文档隐私数据或未声明依赖。

阶段状态：文件管理器统一 Preview、默认知识库、中英文 README、CHANGELOG、独立 ZIP/CRC 校验和发布脚本接入已完成。真实 Word/Excel/PowerPoint/LibreOffice 互操作和更大恶意 fixture 矩阵仍需人工发布前验证。

## 17. 建议模块和文件

```text
src/
  document-service.js
  document-types.js
  document-errors.js
  document-offscreen.js
  document-viewer.html
  document-viewer.js
  document-viewer.css
  document-adapters/
    markdown-adapter.js
    docx-adapter.js
    xlsx-adapter.js
    pptx-adapter.js
    pdf-adapter.js
    ooxml-safety.js
  document-schemas/
    markdown.js
    docx.js
    xlsx.js
    pptx.js
    pdf.js
scripts/
  build-document-bundles.mjs
  test-document-*.mjs
  fixtures/documents/
docs/
  office-document-capability-plan.md
  third-party-document-libraries.md
```

Tool 定义继续放在 `src/tool-registry.js`，执行分发继续通过 `background.js`，不能在 Adapter 中维护第二份 Tool 名称或 Schema。

## 18. 开发顺序与提交纪律

每个 Phase 独立提交，遵循：

1. 先增加测试 fixture 和失败测试；
2. 实现 Adapter 或核心能力；
3. 接入 Tool Registry 和 dispatch；
4. 接入 UI/知识库；
5. 更新中英文文档和 CHANGELOG；
6. 运行完整 Agent Loop、VFS、Provider、发布校验；
7. 人工用真实 Office/PDF 应用验证后再进入下一 Phase。

不在同一提交中同时引入全部大型依赖和全部格式。Phase 0 结束后先锁定公开 Tool 契约，后续可以替换内部库而不改变 Agent 调用方式。

## 19. 完成定义

0.7.0 浏览器基础版本可发布必须同时满足：

- 五种格式的能力矩阵与实际行为一致；
- Agent 只根据真实 Tool Result 描述文档内容和修改结果；
- 所有写操作具备版本冲突检查、输出验证和恢复 revision；
- 大文档不会默认注入完整上下文；
- 所有 Provider 共用相同 Tool 契约和外层循环；
- 文档内容不会被后台隐式上传或远程转换；
- 恶意或损坏文件不会导致路径穿越、远程加载、脚本执行或静默源文件损坏；
- 生成 OOXML 通过独立 ZIP 结构、版本字段和 CRC 校验；真实目标应用互操作作为发布前人工验证项记录；
- 文件管理器、知识库、Channel、Schedule、Task 和普通会话没有行为回归；
- 发布包通过 Chrome MV3 CSP、依赖许可证和商店隐私检查。
