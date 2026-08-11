# WebClaw 复杂样式文档生成迭代计划

状态：0.7.x 基础实现完成，高级增强暂停

目标版本：0.7.1 - 0.7.5

当前实现进度：0.7.1 核心规范、模板注册、资源校验、构建链和错误分层已完成并通过阶段测试；0.7.2 已完成 DOCX/PDF Rich Spec 首个可用引擎，0.7.3 已完成 XLSX 工作表引擎，0.7.4 已完成 PPTX 基础演示引擎；0.7.5 已补充 DOCX/PDF/PPTX 的本地图片资源嵌入与 PPTX 原生图表。格式引擎由共享 Offscreen Document 调用 manifest sandbox 中的本地静态 bundle，生成结果通过临时 IndexedDB Artifact Store 交回 Service Worker，避免 MV3 Service Worker 动态导入和扩展页 CSP 冲突。CJK PDF 字体、XLSX 图表、复杂 Office 编辑和视觉 QA 仍是后续增强项。

基线版本：0.7.0

最后更新：2026-08-11

适用范围：DOCX、XLSX、PPTX、PDF、Markdown、DocumentService、VFS、Offscreen Document、Tool Registry、文件管理器、知识库和发布构建

## 1. 文档目的

本文定义 WebClaw 在 Chrome Manifest V3 扩展环境中生成可直接交付的复杂样式办公文档所需的产品目标、架构、公开 Tool 契约、富文档数据模型、模板模型、格式适配器、浏览器运行方式、质量校验、测试矩阵和分版本实施步骤。

后续开发应以本文为实现依据。若实现需要改变本文规定的公开 Tool 语义、VFS 路径、Schema 版本或安全边界，必须先更新本文并说明迁移方式。

## 2. 决策摘要

1. 保留 0.7.0 已有的 8 个 Document Tool，不为 Word、Excel、PowerPoint、PDF 分别新增重复 Tool。
2. 复杂生成不能只增加模板。必须同时引入 Rich Document Spec、成熟浏览器生成器、模板系统、布局检查和输出验证。
3. 模型只生成结构化 JSON，不生成并执行文档 JavaScript、JSX、OOXML 或 PDF 指令流。
4. 所有 Provider 继续使用相同的 Tool Schema 和 Agent Loop；Provider Adapter 不处理文档格式。
5. 新建复杂文档优先于保真编辑已有复杂文档。0.7.x 聚焦高质量生成，已有文档 preserve 编辑另行规划。
6. DOCX、XLSX、PPTX、PDF 使用独立格式适配器，但共享主题、资产、图表、表格、模板和验证模型。
7. 共享 Offscreen Document 负责资产读取和 Artifact Store，DOM、Canvas、字体测量及第三方浏览器库运行在 manifest sandbox；Service Worker 保持 Tool 生命周期、VFS 最终提交、revision 和错误反馈所有权。
8. 第三方库必须固定版本、本地打包、可复现构建、记录许可证，不允许 CDN、远程模块或运行时下载代码。
9. 每次生成必须经过 Schema 校验、资产解析、布局预检、格式生成、包结构验证和重新读取验证，成功后才写入最终 VFS 路径。
10. 模板控制稳定的视觉质量，模型负责内容、数据和语义布局选择。模型不得为每个元素随意生成绝对坐标。

## 3. 0.7.0 基线与缺口

0.7.0 已具备：

- `document_inspect`、`document_read`、`document_schema`、`document_create`、`document_edit`、`document_render`、`document_export`、`document_revision`；
- Markdown 完整基础操作；
- DOCX/XLSX/PPTX 基础创建和 rebuild 编辑；
- ASCII 文本 PDF 创建；
- Office/PDF 受控 Markdown/JSON 投影；
- VFS version/hash 并发保护、自动 revision、恢复和确认清理；
- 文件管理器独立投影视图；
- 知识库投影 ingest；
- ZIP 安全限制和基础回归测试。

0.7.0 不能满足专业交付的主要原因：

- 创建 Schema 只表达基础段落、单元格和幻灯片文本；
- 手工 OOXML writer 不支持完整样式、主题、图片、图表和页面布局；
- PDF writer 没有字体嵌入和高级排版；
- 没有跨格式统一的主题、资产和图表模型；
- 没有模板选择、布局容量、溢出检查和视觉 QA；
- 预览是文本投影，不能反映最终页面或幻灯片视觉结果；
- 没有真实 Office 应用 fixture 和稳定的互操作回归门槛。

## 4. 产品目标

### 4.1 目标用户场景

#### 场景 A：业务报告

输入为网页资料、Markdown、表格、图片和用户要求，输出可编辑 DOCX 和固定版式 PDF，至少包含：

- 封面、摘要、目录、章节、结论和附录；
- 多级标题、页眉、页脚、页码和分页；
- 专业表格、数据图表、图片和图注；
- 统一字体、颜色、间距和品牌元素；
- 来源说明和生成警告。

#### 场景 B：数据分析工作簿

输入为 CSV、JSON、网页表格或已有 VFS 数据，输出可编辑 XLSX，至少包含：

- 原始数据、清洗结果、分析结果和说明工作表；
- 表头、数字格式、列宽、冻结窗格、筛选和条件格式；
- 公式、汇总、数据验证和图表；
- 打印区域、页面设置和可理解的工作表命名。

#### 场景 C：演示文稿

输入为报告、数据、图片和目标受众，输出可编辑 PPTX，至少包含：

- 封面、议程、章节、内容、数据分析和结论页；
- Slide Master、主题色、字体、Logo 和页脚；
- 原生文本、Shape、表格、图片和常用图表；
- 内容容量限制、自动拆页和演讲者备注；
- 16:9 默认布局及可选 4:3。

#### 场景 D：固定版式 PDF

输入与业务报告相同，输出支持中文的 PDF，至少包含：

- 字体嵌入、段落、列表、表格、图片和图表；
- 页眉、页脚、页码、目录、链接和书签；
- A4/Letter、横向/纵向和分页控制；
- 可访问性基础元数据和文档属性。

### 4.2 可量化目标

- 内置至少 3 套跨格式专业主题：`corporate`、`minimal`、`research`；
- 每种格式至少 3 个可复用文档模板；
- 中文、英文和中英混排均可生成；
- 常规 30 页 DOCX、10 万单元格 XLSX、30 页 PPTX、50 页 PDF 在规定资源预算内完成；
- 新生成文件通过 WebClaw 重新读取，并通过对应格式包结构校验；
- 发布前 fixture 必须能被指定的 Microsoft Office 或 LibreOffice 版本打开且无修复提示；
- 模型无法通过 Rich Document Spec 注入脚本、宏、外部关系或任意文件读取；
- 相同模板、Spec 和引擎版本产生语义一致的输出。

## 5. 非目标

0.7.x 不承诺：

- 在浏览器中复刻 Word、Excel 或 PowerPoint 的完整交互式编辑器；
- 对已有复杂 Office 文件进行任意无损编辑；
- 执行 VBA、Office Scripts、Excel 外部连接或嵌入代码；
- 完整计算 Excel 公式；公式结果由 Excel 打开后计算，或由 WebClaw 明确支持的简单计算器预计算；
- 生成或保留复杂动画、SmartArt、任意 3D 图表和专有 Office 特性；
- 像排版软件一样任意重排已有 PDF 正文；
- 使用远程文档转换 SaaS；
- 让模型直接编写并执行 PptxGenJS、ExcelJS、docx、pdfmake 或 OOXML 代码。

## 6. 总体架构

```text
AgentRunner
  -> Tool Registry: documents bundle
  -> DocumentService
       -> schema/version validation
       -> template resolution
       -> asset resolution
       -> layout preflight
       -> DocumentRenderClient
            -> shared Offscreen Document
                 -> Rich Document normalizer
                 -> chart/image/font services
                 -> DOCX adapter
                 -> XLSX adapter
                 -> PPTX adapter
                 -> PDF adapter
                 -> visual preview renderer
                 -> temporary RenderArtifactStore
       -> generated artifact validation
       -> optimistic version/hash check
       -> automatic revision
       -> atomic VFS commit
       -> projection/cache invalidation
  -> file manager / document viewer
  -> knowledge base
```

### 6.1 模块职责

#### DocumentService

- 保持 8 个 Tool 的唯一业务入口；
- 选择 Schema 和 Adapter；
- 解析模板 ID 和用户覆盖项；
- 校验 VFS 资产路径和大小；
- 启动/取消生成任务；
- 从临时 artifact store 获取生成 Blob；
- 执行重新读取、结构校验、version/hash 检查、revision 和最终写入；
- 返回统一 `fidelity`、`warnings`、`validation` 和 `changes`。

#### Rich Document Core

- 校验和规范化模型返回的 Rich Document Spec；
- 合并模板、主题和局部覆盖；
- 生成稳定节点 ID；
- 统一颜色、长度、字体、数字格式和资产引用；
- 执行通用内容密度和布局预检；
- 不访问 VFS，不调用模型，不产生副作用。

#### Format Adapter

- 接收规范化 Spec、已解析模板和资产句柄；
- 调用本地打包的格式库；
- 产生 Blob、格式统计和 Adapter 警告；
- 不直接写最终 VFS 路径；
- 不负责 Agent 重试、权限或 revision。

#### RenderArtifactStore

Chrome runtime messaging 对大型二进制不适合作为稳定传输通道。Offscreen 生成结果写入独立临时 IndexedDB：

```text
Database: webclaw-document-render-artifacts
Store: artifacts
Key: artifactId
Fields:
  artifactId
  requestId
  format
  mimeType
  blob
  size
  sha256
  createdAt
  expiresAt
  metadata
```

Offscreen 只返回 `artifactId` 和小型元数据。DocumentService 读取 Blob、验证并写入 VFS。成功、失败或取消后清理 artifact；启动时清理超过 1 小时的孤立 artifact。

## 7. Tool 契约

### 7.1 保留的 Tool

不新增 `create_word_report`、`create_excel_analysis`、`create_powerpoint` 或 `create_pdf_report`。现有 Tool 保持格式无关：

| Tool | 复杂文档阶段职责 |
| --- | --- |
| `document_inspect` | 返回格式、版本、模板、引擎、结构、能力和质量信息 |
| `document_read` | 返回受控语义投影和 locator |
| `document_schema` | 返回指定格式、操作和 capability slice 的精确 Schema |
| `document_create` | 使用模板和 Rich Document Spec 创建文件 |
| `document_edit` | 0.7.x 继续支持既有操作；富文档 preserve 编辑不在本计划范围 |
| `document_render` | 生成页面/工作表/幻灯片视觉预览与 QA 结果 |
| `document_export` | 导出投影或按支持路径转换格式 |
| `document_revision` | 快照、列表、恢复和确认清理 |

### 7.2 `document_schema` 扩展

现有 Tool 参数中的 `actions` 用作 capability slice 查询，避免把完整大型 Schema 永久塞入小模型上下文：

```json
{
  "format": "pptx",
  "operation": "create",
  "actions": ["root", "theme", "slides", "charts", "tables"]
}
```

返回：

```json
{
  "format": "pptx",
  "operation": "create",
  "schemaVersion": "pptx-2",
  "engineVersion": "pptxgenjs:<pinned-version>",
  "templates": [
    {
      "id": "builtin:pptx:corporate-deck",
      "name": "Corporate deck",
      "layouts": ["title", "section", "content", "chart_insights", "comparison", "closing"]
    }
  ],
  "capabilities": {
    "nativeCharts": true,
    "speakerNotes": true,
    "embeddedFonts": false
  },
  "schema": {},
  "examples": []
}
```

规则：

- 未传 `actions` 时只返回 root、必填字段、支持列表和一个最小示例；
- 需要图表、表格、图片等复杂能力时，Agent 再查询对应 slice；
- Schema 查询不得改变配置或加载远程代码；
- `schemaVersion` 必须传给后续 `document_create`；
- `*-1` 仍可读取，但创建默认推荐 `*-2`。

### 7.3 `document_create` 扩展

```json
{
  "path": "/workspace/reports/q2-review.pptx",
  "format": "pptx",
  "schemaVersion": "pptx-2",
  "templateId": "builtin:pptx:corporate-deck",
  "quality": "professional",
  "spec": {},
  "createParents": true,
  "overwrite": false
}
```

新增参数：

- `templateId`：`builtin:<format>:<id>` 或 `vfs:/templates/documents/...`；
- `quality`：`draft | standard | professional`，默认 `standard`；
- `locale`：可选 BCP 47 语言标签；
- `validationMode`：`strict | normal`，默认 `normal`；
- `preview`：是否同时生成视觉预览缓存；
- `expectedVersion` / `expectedHash`：覆盖已有文件时继续必需。

成功结果：

```json
{
  "path": "/workspace/reports/q2-review.pptx",
  "format": "pptx",
  "schemaVersion": "pptx-2",
  "templateId": "builtin:pptx:corporate-deck",
  "version": 1,
  "hash": "...",
  "size": 582140,
  "fidelity": "native_generated",
  "engine": "pptxgenjs:<pinned-version>",
  "validation": {
    "valid": true,
    "errors": [],
    "warnings": [],
    "overflow": [],
    "missingAssets": [],
    "missingFonts": []
  },
  "previewPath": "/cache/document-previews/.../index.json",
  "warnings": []
}
```

### 7.4 是否新增 `document_template`

0.7.1 - 0.7.4 不新增。内置模板由 `document_schema` 列出，用户模板通过 VFS 文件管理器和 `fs_*` Tool 管理。

只有同时满足以下条件时，0.7.5 才增加 `document_template`：

- 已支持导入至少一种原生 Office 模板；
- 模板需要独立安装、验证、升级和删除生命周期；
- 使用 VFS Tool 管理会显著增加模型错误；
- 新 Tool 能保持格式无关，动作限定为 `list | inspect | install | validate | delete`。

## 8. Rich Document Spec

### 8.1 设计原则

- 语义优先：表达“标题、指标、图表、结论”，而不是直接表达 OOXML 节点；
- 模板优先：优先使用 `styleRef` 和 `layout`，避免模型逐元素指定坐标；
- 受控覆盖：只开放安全、跨格式可解释的样式字段；
- 稳定节点：每个主要节点有可选 `id`，规范化时补齐；
- VFS 资产：图片、字体和附件只能引用 VFS 绝对路径或内置资产 ID；
- 无脚本：不允许函数、表达式、HTML script、宏或远程 URL；
- 有界：数组数量、文本长度、图片尺寸、表格单元格和图表数据均有硬限制；
- 可降级：Adapter 不支持的字段必须返回 warning 或 strict mode error，不能静默丢弃。

### 8.2 通用根结构

```json
{
  "document": {
    "title": "2026 Q2 Business Review",
    "subject": "Quarterly operating report",
    "author": "WebClaw",
    "company": "Example Corp",
    "language": "zh-CN",
    "keywords": ["Q2", "business review"],
    "createdAt": "2026-08-11"
  },
  "theme": {
    "preset": "corporate",
    "colors": {
      "primary": "#176B5B",
      "secondary": "#2D6CDF",
      "accent": "#D97706",
      "text": "#1F2937",
      "muted": "#6B7280",
      "background": "#FFFFFF"
    },
    "fonts": {
      "heading": "Noto Sans SC",
      "body": "Noto Sans SC",
      "mono": "Noto Sans Mono"
    },
    "logo": {
      "path": "/workspace/assets/logo.png",
      "alt": "Example Corp"
    }
  },
  "dataSources": [],
  "content": []
}
```

### 8.3 通用安全类型

#### Color

- 仅接受 `#RRGGBB` 或模板 token；
- 不接受 CSS 函数、URL、变量和渐变字符串；
- 透明度使用独立 `opacity`，范围 0 - 1。

#### Length

- 文档和 PDF 使用 pt；
- PPTX 内部统一为 inch，模型优先使用布局槽位而不是坐标；
- XLSX 使用列字符宽度和行 pt；
- 所有长度必须为有限数字并有格式上限。

#### AssetRef

```json
{
  "path": "/workspace/assets/chart.png",
  "alt": "Revenue chart",
  "fit": "contain",
  "crop": null
}
```

规则：

- 路径必须是 VFS 绝对路径；
- 禁止 `http:`、`https:`、`data:`、`blob:` 和扩展外部 URL；
- 网络图片必须先通过 `http_request` 明确保存到 VFS；
- 校验 MIME、文件签名、尺寸、像素总量和文件大小；
- SVG 必须净化，不执行脚本或外部引用。

#### ChartSpec

```json
{
  "type": "column",
  "title": "Monthly revenue",
  "categories": ["Apr", "May", "Jun"],
  "series": [
    {"name": "Revenue", "values": [120, 155, 183]}
  ],
  "legend": "bottom",
  "showValues": false,
  "numberFormat": "#,##0",
  "styleRef": "chart.primary"
}
```

首批图表类型：`column`、`bar`、`line`、`area`、`pie`、`doughnut`、`scatter`。数据必须是有限数字或 null，不接受公式字符串和可执行表达式。

#### TableSpec

```json
{
  "columns": [
    {"key": "region", "title": "Region", "width": 28},
    {"key": "revenue", "title": "Revenue", "format": "currency:CNY"},
    {"key": "growth", "title": "YoY", "format": "percent:1"}
  ],
  "rows": [
    {"region": "East", "revenue": 1200000, "growth": 0.18}
  ],
  "styleRef": "table.standard",
  "repeatHeader": true
}
```

### 8.4 DOCX `docx-2`

支持的 block：

- `cover`
- `toc`
- `heading`
- `paragraph`
- `list`
- `quote`
- `callout`
- `table`
- `image`
- `chart`
- `page_break`
- `section_break`
- `references`
- `appendix`

页面配置：A4/Letter、页边距、方向、分节、页眉、页脚、页码起始值。首版复杂生成不提供任意浮动对象定位；图片和图表使用 inline 或受控 block 布局。

### 8.5 XLSX `xlsx-2`

根结构：

```json
{
  "workbook": {
    "title": "Sales analysis",
    "company": "Example Corp",
    "date1904": false,
    "calculationMode": "auto"
  },
  "worksheets": []
}
```

Worksheet 支持：

- 名称、标签颜色和可见性；
- 列定义、行数据和表格；
- 单元格值、公式、number format、alignment、border、fill、font；
- 冻结窗格、筛选、排序提示、合并单元格；
- 条件格式白名单；
- 数据验证白名单；
- 图片和图表；
- 页面方向、纸张、打印区域、重复标题行；
- 保护设置仅用于防误改，不宣称安全加密。

公式仅允许以 `=` 开头的字符串，禁止外部工作簿引用、DDE、WEBSERVICE、HYPERLINK 到非用户明确提供地址等高风险形式。执行器需要公式安全扫描。

### 8.6 PPTX `pptx-2`

根结构：

```json
{
  "presentation": {
    "title": "Q2 Review",
    "layout": "LAYOUT_WIDE",
    "company": "Example Corp"
  },
  "slides": []
}
```

Slide 必须优先选择模板布局：

- `title`
- `agenda`
- `section`
- `content`
- `two_column`
- `chart_insights`
- `table`
- `comparison`
- `timeline`
- `metrics`
- `image_focus`
- `closing`

模型提供槽位内容，模板负责坐标。只有 `layout: "freeform"` 才允许受限绝对坐标，且默认不向模型示例推荐。

首批元素：文本、图片、Shape、表格、图表、指标卡、页码、Logo 和 speaker notes。视频、任意嵌入对象、动画和远程媒体不支持。

### 8.7 PDF `pdf-2`

PDF 复用 DOCX 的 flow block 子集，增加：

- PDF 元数据；
- 目录、书签和内部链接；
- 水印；
- 页眉、页脚和页码；
- PDF/A 或加密能力仅在依赖验证通过后开放；
- 中文字体解析和嵌入。

PDF 不是 DOCX 的附属导出。相同语义内容可共享 Spec 片段，但 PDF Adapter 独立执行分页和字体嵌入。

## 9. 模板系统

### 9.1 模板 ID

- 内置模板：`builtin:<format>:<template-id>`；
- 用户模板：`vfs:/templates/documents/<format>/<template-id>/template.json`；
- 不接受相对路径；
- 不允许模板跨出 `/templates/documents` 读取任意文件；模板引用的资产必须位于模板目录或显式 `/workspace/assets`。

### 9.2 模板目录

```text
/templates/documents/
  docx/
    company-report/
      template.json
      preview.png
      assets/logo.png
  xlsx/
    analysis-workbook/
      template.json
  pptx/
    company-deck/
      template.json
      assets/logo.png
  pdf/
    research-report/
      template.json
```

内置模板位于扩展只读资源中，使用相同 manifest 结构。

### 9.3 Template Manifest

```json
{
  "templateVersion": "1",
  "id": "corporate-deck",
  "format": "pptx",
  "name": "Corporate deck",
  "description": "Business review presentation",
  "engine": "pptx-2",
  "theme": {},
  "layouts": {},
  "styles": {},
  "defaults": {},
  "limits": {
    "maxTitleChars": 60,
    "maxBodyChars": 500,
    "maxBullets": 6
  },
  "assets": []
}
```

### 9.4 模板合并顺序

```text
engine defaults
  < built-in format defaults
  < selected template
  < user theme overrides
  < node styleRef
  < allowed node overrides
```

禁止模型覆盖：脚本、外部 relationship、包路径、宏、任意 XML、任意字体文件路径和模板安全限制。

### 9.5 初始模板清单

#### DOCX

- `builtin:docx:business-report`
- `builtin:docx:research-report`
- `builtin:docx:meeting-minutes`

#### XLSX

- `builtin:xlsx:data-analysis`
- `builtin:xlsx:financial-summary`
- `builtin:xlsx:project-tracker`

#### PPTX

- `builtin:pptx:corporate-deck`
- `builtin:pptx:research-deck`
- `builtin:pptx:product-review`

#### PDF

- `builtin:pdf:business-report`
- `builtin:pdf:research-report`
- `builtin:pdf:one-page-brief`

每个模板必须包含中英文示例 fixture、视觉基线和最大推荐内容量。

## 10. 格式引擎与依赖策略

### 10.1 候选引擎

| 格式 | 首选候选 | 用途 | 许可证门槛 |
| --- | --- | --- | --- |
| DOCX | [`docx`](https://github.com/dolanmiu/docx) | 从 Rich Spec 新建复杂 DOCX | 必须为可分发的宽松许可证 |
| DOCX 模板编辑 | [`@office-kit/docx`](https://office-kit.github.io/docx/) | 后续 preserve/template round-trip spike | 通过成熟度和 fixture 验证后再采用 |
| XLSX | [`exceljs`](https://github.com/exceljs/exceljs) | 样式、公式、表格、图片和页面设置 | 固定版本并验证 browser bundle |
| PPTX | [`pptxgenjs`](https://github.com/gitbrent/PptxGenJS) | Master、Shape、表格、图片和原生图表 | 固定版本并验证 browser bundle |
| PDF | [`pdfmake`](https://pdfmake.org/) | 声明式 flow、表格、字体和分页 | 固定稳定版本；不采用远程字体 |
| 图表位图 | [`chart.js`](https://github.com/chartjs/Chart.js) 或自有 Canvas renderer | DOCX/PDF/XLSX 图表图片 fallback | 仅本地 Canvas，不联网 |
| PDF 读取/预览 | [`pdfjs-dist`](https://github.com/mozilla/pdf.js) | 页级文本和 Canvas 预览 | 单独评估 worker 与 MV3 CSP |

[`Ream`](https://reamkit.dev/)、[OfficeOxide](https://github.com/yfedoseev/office_oxide)、`@office-kit/docx` 和 [LLM-friendly PPTX 声明层](https://github.com/artifact-kit/pptxgenjs-jsx)作为技术观察项，不在没有 spike 数据前直接替换核心生成路径。

### 10.2 依赖准入门槛

每个候选库必须先完成 ADR 和 spike：

1. 浏览器 ESM 或可被 bundler 转为浏览器 bundle；
2. 不依赖 Node 原生模块、动态 `require`、远程 worker 或 CDN；
3. 不需要 `eval`、`new Function` 或 CSP 例外；
4. 许可证允许开源和 Chrome Web Store 分发；
5. 锁定版本，无未审计 postinstall 下载；
6. 生成最小、中型、复杂 fixture；
7. 测量 bundle 大小、冷启动、峰值内存和生成时间；
8. 输出可被目标 Office 应用打开；
9. malformed input 不导致扩展崩溃或任意网络访问；
10. 能返回 Blob/Uint8Array，且不强制下载到本机。

### 10.3 构建链

0.7.1 已增加 npm 构建链，当前实现包括：

```text
package.json
package-lock.json
scripts/build-document-bundles.mjs
src/document-runtime/
build/document/
THIRD_PARTY_LICENSES.md
```

要求：

- 使用固定版本 Node 22 和固定版本 bundler；
- `npm ci` 后可离线完成构建；
- 输出 `build/document/document-offscreen.js` 及必要 worker/font/assets；
- `package-extension.sh` 先执行构建，再把 `build/document` 放入 ZIP；
- `validate-release.mjs` 校验 bundle、许可证清单、禁止远程 import 和禁止 source map；
- CI 从干净 checkout 重建，不依赖开发机缓存；
- README 增加开发模式 `npm ci && npm run build:documents`；
- `node_modules`、临时渲染文件和测试输出不得进入 Git。

是否提交 `build/document` 在 0.7.1 ADR 中决定。无论是否提交，Release 必须由干净环境重建。

## 11. Offscreen 运行设计

Chrome 同一扩展只能共享有限的 Offscreen Document。继续复用：

```text
src/chrome-ai-offscreen.html
src/offscreen.js
```

增加：

```text
src/document-runtime/document-offscreen.js
src/document-runtime/render-dispatcher.js
src/document-runtime/render-artifact-store.js
```

消息协议：

```json
{
  "type": "WEBCLAW_DOCUMENT_RENDER_START",
  "requestId": "...",
  "format": "pptx",
  "schemaVersion": "pptx-2",
  "template": {},
  "spec": {},
  "assetPaths": [],
  "options": {}
}
```

进度：

```json
{
  "type": "WEBCLAW_DOCUMENT_RENDER_PROGRESS",
  "requestId": "...",
  "phase": "layout",
  "completed": 4,
  "total": 12,
  "message": "Laying out slide 4 of 12"
}
```

完成：

```json
{
  "type": "WEBCLAW_DOCUMENT_RENDER_DONE",
  "requestId": "...",
  "artifactId": "...",
  "metadata": {}
}
```

取消：

```json
{
  "type": "WEBCLAW_DOCUMENT_RENDER_CANCEL",
  "requestId": "..."
}
```

取消后 Adapter 应在安全边界停止，删除临时 artifact，不写最终 VFS。不能取消的第三方同步阶段必须有时间上限，并在完成后检查取消状态再提交。

## 12. 字体、图表和资产

### 12.1 字体策略

DOCX/XLSX/PPTX 初期只写字体名称，不嵌入字体；模板提供按平台回退：

```text
Noto Sans SC
Microsoft YaHei
PingFang SC
Arial
sans-serif
```

PDF 必须嵌入字体。0.7.2 前完成字体 ADR：

- 选择一套允许再分发的中英文字体；
- 记录许可证；
- 测量扩展包增量；
- 支持 regular/bold；
- 若完整 CJK 字体过大，评估运行时子集化，但子集器也必须本地打包；
- 不允许运行时从 Google Fonts 或其他网络地址加载。

用户字体可放在 `/templates/documents/fonts/`，使用前校验 TTF/OTF 签名、大小和许可证由用户负责的提示。用户字体不得被发送给模型。

### 12.2 图表策略

- PPTX 优先原生图表；
- XLSX 若选定引擎不能稳定生成原生图表，先使用高分辨率 PNG/SVG 图表并保留源数据工作表；
- DOCX/PDF 使用本地 Canvas/SVG 渲染后的静态图表；
- 所有图表必须包含 title、series name 和可选数据表，避免只有图片无法理解；
- 图表配色来自主题 token；
- 视觉和原始数据必须使用同一规范化 ChartSpec，禁止分别生成造成数据不一致。

### 12.3 图片处理

- 解码前检查文件签名和大小；
- 限制最大像素数，防止解压炸弹；
- 支持 PNG、JPEG、WebP；SVG 需净化；
- 自动读取尺寸和方向；
- `contain`、`cover`、受控 crop；
- 生成前报告缺失资产；
- 图片失败不得写出半成品最终文件。

## 13. 布局与质量验证

### 13.1 验证阶段

```text
Schema validation
  -> semantic validation
  -> template validation
  -> asset validation
  -> layout preflight
  -> format generation
  -> container/package validation
  -> adapter reopen/readback
  -> semantic reconciliation
  -> optional visual regression
  -> VFS commit
```

### 13.2 通用预检

- 标题、正文、列表和表格数量上限；
- 空标题、重复 ID、非法颜色和非有限数字；
- 缺失模板槽位；
- 资产不存在、MIME 不匹配、图片过大；
- 图表类别与 series 长度不一致；
- 表格行列数量和列 key 不一致；
- 文本密度超过模板建议值；
- 语言与字体覆盖不匹配；
- 外部 URL、脚本、宏和危险公式。

### 13.3 PPTX 溢出策略

每个布局定义容量：标题字符、正文字符、bullet 数、表格行数和图表数量。处理顺序：

1. 使用模板标准字号；
2. 在允许范围内缩小到模板最小字号；
3. 拆分列表或表格到 continuation slide；
4. 仍无法容纳则 strict mode 报错；normal mode 生成并返回明确 overflow warning；
5. 禁止把字体缩小到不可读尺寸。

### 13.4 DOCX/PDF 分页

- 标题避免孤行；
- 表格允许跨页并重复表头；
- 图片和图注尽量同页；
- 封面、目录、章节和附录使用明确 page/section break；
- PDF 生成后统计页数并验证目录页码能力；
- 超大不可分割 block 返回错误或缩放警告。

### 13.5 XLSX 质量检查

- 列宽覆盖表头和典型值；
- 数字、日期、百分比和货币使用正确 number format；
- 公式引用范围有效；
- 冻结窗格不越界；
- 合并区域不重叠；
- 打印区域存在且不为空；
- 危险公式和外部关系为零；
- 图表源范围存在。

### 13.6 重新读取一致性

生成后使用独立于写入对象的读取路径检查：

- 文档类型和 MIME；
- 必要 OOXML part；
- 页/工作表/幻灯片数量；
- 关键标题和表格数据；
- 图片和关系数量；
- 公式和图表源数据；
- PDF 页数、字体和文本抽样；
- 无宏、外部关系和脚本。

关键内容不一致时返回 `document_validation_failed`，不写最终路径。

## 14. 视觉预览

### 14.1 预览产物

```text
/cache/document-previews/<source-hash>/
  index.json
  page-1.png
  page-2.png
  ...
```

`index.json`：

```json
{
  "format": "pptx",
  "sourceHash": "...",
  "engineVersion": "...",
  "pages": [
    {"number": 1, "path": "page-1.png", "width": 1600, "height": 900}
  ],
  "validation": {},
  "createdAt": 0
}
```

### 14.2 预览实现顺序

- PDF：使用本地 PDF.js Canvas 渲染；
- PPTX：优先使用同一布局模型生成 HTML/Canvas 预览；不把它宣称为 PowerPoint 像素级渲染；
- DOCX：评估 `docx-preview` 或选定 DOCX 引擎的预览模块；
- XLSX：生成只读工作表网格和图表预览；
- imported Office 文件在没有高保真 renderer 时继续显示投影并明确标注。

文件管理器 Preview 不执行文档脚本、宏、外部关系或远程资源。视觉预览缓存由 source hash 和 engine version 失效。

## 15. 错误模型

新增或规范以下错误码：

| 错误码 | 含义 | Agent 建议动作 |
| --- | --- | --- |
| `document_schema_version_unsupported` | Schema 版本不支持 | 重新调用 `document_schema` |
| `document_template_not_found` | 模板不存在 | 查询可用模板 |
| `document_template_invalid` | 模板结构或资产非法 | 修复模板或换内置模板 |
| `document_asset_missing` | VFS 资产不存在 | 保存或选择正确资产 |
| `document_asset_unsupported` | 资产格式或大小不支持 | 转换或缩小资产 |
| `document_font_missing` | 必需字体不可用 | 使用回退字体或导入字体 |
| `document_layout_overflow` | 内容无法放入布局 | 缩短内容、拆页或换布局 |
| `document_formula_unsafe` | 公式包含危险能力 | 使用本地数据或安全公式 |
| `document_generation_failed` | 格式引擎失败 | 根据 stage/details 修正 Spec |
| `document_validation_failed` | 输出重新读取不一致 | 不提交，保留诊断 artifact |
| `document_cancelled` | 用户停止 | 清理临时 artifact |
| `document_resource_limit` | 超出内存、时间或数量限制 | 拆分文档或降低质量 |

错误结果必须包含：

```json
{
  "code": "document_layout_overflow",
  "message": "Slide 6 exceeds the chart_insights layout capacity.",
  "stage": "layout",
  "path": "/workspace/reports/q2-review.pptx",
  "nodeId": "slide-6",
  "details": {
    "bodyChars": 920,
    "maxBodyChars": 500
  },
  "retryable": true,
  "suggestedActions": ["split_slide", "shorten_body", "choose_content_layout"]
}
```

## 16. 安全与隐私

- 文档引擎不联网；
- 外部资产先经过用户已启用的网络 Tool 保存到 VFS；
- 不执行宏、公式、脚本、嵌入对象或外部 relationship；
- ZIP entry、展开大小、压缩比、路径穿越和 XML 大小继续受限；
- XML parser 禁止外部实体；
- SVG 净化并移除 script、event handler、foreignObject 和远程引用；
- 模板不能读取其允许根目录之外的文件；
- 文档、图片、字体和模板默认保留在当前 Chrome profile；
- 只有 Agent 任务明确需要时，文档内容才发送给当前 Provider；
- 第三方库和字体许可证加入 `THIRD_PARTY_LICENSES.md` 与发布包；
- 新依赖不增加 host permission；
- Chrome Web Store Remote Hosted Code 声明保持真实，文档功能不引入额外远程代码。

## 17. 性能与资源预算

初始硬限制：

| 项目 | 限制 |
| --- | --- |
| 单个输入文档 | 50 MB |
| 单个图片 | 15 MB |
| 图片最大像素 | 40 MP |
| 单个 Rich Spec JSON | 5 MB |
| DOCX 页数建议/最大 | 30 / 100 |
| PPTX 幻灯片建议/最大 | 30 / 100 |
| PDF 页数建议/最大 | 50 / 200 |
| XLSX 工作表 | 50 |
| XLSX 总单元格建议/最大 | 100,000 / 500,000 |
| 单次生成默认超时 | 120 秒 |
| 临时 artifact TTL | 1 小时 |

0.7.1 spike 后根据实测调整。超限必须在生成前尽早失败，不能让 Service Worker 或 Offscreen Document 因内存耗尽无提示消失。

## 18. 代码结构计划

```text
src/
  document-service.js
  document-revision-store.js
  document-viewer.*
  document-core/
    rich-document-normalizer.js
    rich-document-validator.js
    document-errors.js
    document-capabilities.js
    document-schema-registry.js
    template-registry.js
    template-resolver.js
    asset-resolver.js
    chart-spec.js
    table-spec.js
    layout-preflight.js
    generated-document-validator.js
  document-adapters/
    markdown-adapter.js
    docx-adapter.js
    xlsx-adapter.js
    pptx-adapter.js
    pdf-adapter.js
  document-runtime/
    document-offscreen.js
    document-render-client.js
    render-dispatcher.js
    render-artifact-store.js
    preview-renderer.js
    font-registry.js
    image-service.js
    chart-renderer.js
  document-schemas/
    common.js
    docx-2.js
    xlsx-2.js
    pptx-2.js
    pdf-2.js
  document-templates/
    ...
scripts/
  build-document-bundles.mjs
  test-rich-document-core.mjs
  test-document-templates.mjs
  test-document-adapters.mjs
  test-document-offscreen.mjs
  test-document-visual.mjs
  fixtures/documents/
build/document/
package.json
package-lock.json
THIRD_PARTY_LICENSES.md
```

`document-service.js` 应逐步收缩为 orchestration，不继续堆积每种格式的 XML 细节。0.7.0 手工 writer 在对应新 Adapter 验证完成前保留，切换后删除，不长期维护两套同版本创建引擎。

## 19. Schema 与数据迁移

- `markdown-1` 保持；
- `docx-1`、`xlsx-1`、`pptx-1`、`pdf-1` 继续可读取和创建一段过渡期；
- 新复杂创建使用 `docx-2`、`xlsx-2`、`pptx-2`、`pdf-2`；
- `document_schema` 默认返回最新稳定版本，并允许显式查询旧版本；
- v1 不自动转换为 v2 后覆盖已有文件；
- 内置模板含独立 `templateVersion`，与文档 Schema 解耦；
- 输出 metadata 记录 `schemaVersion`、`templateId`、`templateVersion` 和 `engineVersion`；
- preview cache key 包含上述版本；
- 0.7.x 完成后评估是否在后续主版本移除 v1 创建路径。

## 20. 分版本开发计划

### 20.1 0.7.1：Rich Document Core 与构建基础

目标：建立不依赖具体格式库的稳定数据和运行基础。

实施状态：已完成。Offscreen 消息协议和 RenderArtifactStore 仍保留在后续阶段，不在本轮首版格式引擎中伪装为已完成。

任务：

1. 添加 `package.json`、lockfile、bundler 和许可证生成脚本；
2. 完成四个候选引擎的 browser spike 和 ADR；
3. 建立 `document-core`、Schema Registry 和统一错误类；
4. 实现通用 theme、asset、table、chart 规范化和限制；
5. 实现模板 manifest、内置模板 registry 和 VFS 模板解析；
6. 扩展 `document_schema` capability slices；
7. 扩展 `document_create` 参数但暂不切换默认 v1 引擎；
8. 实现共享 offscreen 消息协议、取消和 RenderArtifactStore；
9. 更新 package/CI/release 检查，确保无远程代码；
10. 增加 core、模板、artifact store 和 CSP 测试。

验收：

- 四种 v2 Schema 可查询和本地验证；
- 非法颜色、路径、图表、表格和超限数据被拒绝；
- 内置模板可列出、加载和合并；
- Offscreen 可生成并传回一个测试 Blob artifact；
- 完整 0.7.0 回归不变；
- clean checkout 可执行 `npm ci`、构建和打包。

### 20.2 0.7.2：专业 DOCX 与中文 PDF

目标：优先交付报告场景。首版已完成 DOCX/PDF 的 Rich Spec 生成接入；本节列出的中文字体、图片嵌入、图表和视觉验收仍是增强目标。

任务：

1. 集成 DOCX 创建引擎；
2. 实现 `docx-2` blocks、styles、页面、页眉页脚、目录、表格、图片和图表图片；
3. 集成 PDF 声明式排版引擎；
4. 完成 CJK 字体 ADR、许可证和本地嵌入；
5. 实现 `pdf-2` flow、目录、书签、链接、页眉页脚和分页；
6. 创建 DOCX/PDF 三套模板；
7. 实现 DOCX/PDF 重新读取验证；
8. 实现 PDF Canvas 预览和 DOCX 近似预览；
9. 支持相同报告内容生成 DOCX 与 PDF；
10. 删除 v2 路径中的手工 DOCX/PDF writer，v1 保留兼容。

验收：

- 中文业务报告 DOCX/PDF 可生成；
- 包含封面、目录、3 级标题、页码、表格、图片和至少两类图表；
- 30 页报告在预算内完成；
- PDF 字体已嵌入且中文可复制；
- Word 和 LibreOffice 打开 DOCX 无修复提示；
- PDF 阅读器打开无错误；
- 缺字体、缺图片、分页失败有明确错误。

### 20.3 0.7.3：专业 XLSX

目标：交付可分析、可继续编辑的工作簿。首版已完成工作表、列定义、表头样式、冻结窗格、筛选和数字格式；公式安全扫描、条件格式、验证、图表和性能验收仍是增强目标。

任务：

1. 集成 XLSX 引擎和 `xlsx-2`；
2. 实现工作表、列、行、单元格、style token 和 number format；
3. 实现公式安全扫描、冻结、筛选、表格、条件格式和数据验证白名单；
4. 实现图片和图表 fallback；
5. 实现打印区域和页面设置；
6. 创建三套 XLSX 模板；
7. 实现工作表 HTML preview 和数据/样式抽样验证；
8. 加入 10 万/50 万单元格性能测试；
9. 对生成后 workbook 重新读取并核对关键公式和数据；
10. 删除 v2 路径中的手工 XLSX writer。

验收：

- 生成至少含 Raw Data、Analysis、Dashboard、Notes 的工作簿；
- 样式、公式、筛选、冻结、条件格式和打印设置生效；
- Excel 和 LibreOffice Calc 打开无修复提示；
- 图表与源数据一致；
- 危险公式被拒绝；
- 大工作簿超限有明确错误而非后台断开。

### 20.4 0.7.4：专业 PPTX

首版已完成标题/内容/表格页面、主题色和可打开的 PPTX 输出；图表、图片、母版、备注、演讲者视图和视觉 QA 仍是增强目标。

目标：交付可编辑的专业演示文稿。

任务：

1. 集成 PPTX 引擎和 `pptx-2`；
2. 实现 Slide Master、主题、布局槽位和页脚；
3. 实现文本、Shape、图片、表格、原生图表、指标卡和 speaker notes；
4. 实现内容密度预检、自动拆页和最小字号；
5. 创建三套 PPTX 模板和布局覆盖；
6. 实现基于相同布局模型的视觉预览；
7. 实现生成后 slide count、文本、图表和 relationship 验证；
8. 添加 16:9 和 4:3 fixture；
9. 在 PowerPoint、Keynote 或 LibreOffice Impress 中人工验证；
10. 删除 v2 路径中的手工 PPTX writer。

验收：

- 生成 12 - 30 页可编辑 PPTX；
- 至少覆盖 title、section、content、chart_insights、comparison、timeline、metrics、closing；
- 无文本越界、重叠或不可读字号；
- 表格和图表数据正确；
- PowerPoint 打开无修复提示；
- 预览明确标注近似渲染边界。

### 20.5 0.7.5：模板、视觉 QA 与产品闭环

目标：把格式能力转化为稳定的实际用户工作流。

任务：

1. 文件管理器增加模板浏览、示例和文档质量状态；
2. 支持 VFS JSON 模板导入、校验和预览；
3. 评估并决定是否增加 `document_template`；
4. 增加统一“从数据生成报告/工作簿/演示文稿”默认 Skill；
5. 默认知识库加入 v2 Tool 用法和限制；
6. 增加生成进度 UI 和 Stop；
7. 增加视觉基线、截图 diff 和布局异常报告；
8. 增加模板兼容版本和迁移检查；
9. 完善隐私、许可证、商店说明和包体积披露；
10. 清理 v2 已替代的内部临时代码。

验收：

- 用户可从文件管理器选择模板并由 Agent 使用；
- 模型可通过 `document_schema` 找到模板和正确 Spec；
- 生成过程有进度，可停止；
- 四种格式有统一质量报告；
- 至少完成 12 个端到端真实业务 fixture；
- 所有文档、Agent Loop、Channel、Schedule、VFS 和发布回归通过。

## 21. PR 拆分顺序

每个 PR 只引入一个可验证边界，建议顺序：

1. `build(documents): add reproducible browser bundle pipeline`
2. `feat(documents): add Rich Document Spec and schema registry`
3. `feat(documents): add template registry and asset resolver`
4. `feat(documents): add offscreen render artifact protocol`
5. `feat(docx): add docx-2 professional generator`
6. `feat(pdf): add pdf-2 CJK report generator`
7. `feat(xlsx): add xlsx-2 analysis workbook generator`
8. `feat(pptx): add pptx-2 presentation generator`
9. `feat(documents): add visual previews and layout QA`
10. `docs(documents): add templates, manual, privacy and release guidance`

每个 PR 必须：

- 先增加失败测试或 fixture；
- 不改变 Provider Adapter；
- 不绕开 DocumentService 直接写最终 VFS；
- 更新相关 Schema 和能力声明；
- 运行完整 Agent Loop 和发布校验；
- 记录 bundle 体积变化。

## 22. 测试矩阵

### 22.1 单元测试

- Schema 版本和 capability slice；
- theme/template 合并顺序；
- Color、Length、AssetRef、ChartSpec、TableSpec；
- 安全路径和资产限制；
- 公式扫描；
- 布局容量和拆分算法；
- 错误码与建议动作；
- artifact TTL、取消和清理；
- engine metadata 和 cache key。

### 22.2 格式测试

#### DOCX

- 中英混排、标题层级、目录、页眉页脚、分页；
- 合并表格、重复表头、图片和图表；
- 横向 section；
- 特殊字符和 emoji 降级；
- 重新读取关键内容和 relationships。

#### XLSX

- 类型、公式、number format、样式；
- 冻结、筛选、条件格式、验证；
- 多工作表、合并、图片和图表；
- 10 万/50 万单元格；
- CSV injection 与危险公式。

#### PPTX

- 每种布局；
- 长标题、长列表、大表格和多系列图表；
- 图片 contain/cover；
- 中文字体、RTL 观察项；
- 自动拆页、最小字号和 speaker notes。

#### PDF

- 中文字体、粗体、链接、目录和书签；
- 表格跨页、图片、图表；
- A4/Letter、横向/纵向；
- 文本复制和页数；
- 字体缺失和损坏图片。

### 22.3 安全测试

- ZIP bomb、路径穿越、重复 entry；
- XML 外部实体；
- SVG script/event/remote href；
- 模板目录越界；
- 远程 URL 和 data URL；
- Excel 危险公式和外部引用；
- 大图片解压；
- malformed fonts；
- 取消后无最终 VFS 写入；
- 生成失败后 revision 和原文件不变。

### 22.4 互操作矩阵

每个 Release Candidate 至少人工验证：

| 格式 | 必测应用 |
| --- | --- |
| DOCX | Microsoft Word、LibreOffice Writer |
| XLSX | Microsoft Excel、LibreOffice Calc |
| PPTX | Microsoft PowerPoint、LibreOffice Impress；macOS 可加 Keynote |
| PDF | Chrome PDF Viewer、Preview 或 Acrobat Reader |

记录应用版本、操作系统、是否修复、视觉问题和 fixture hash。

### 22.5 端到端业务 fixture

至少包含：

1. 中文季度经营报告 DOCX；
2. 同内容 PDF；
3. 销售分析 XLSX；
4. 财务摘要 XLSX；
5. 12 页经营汇报 PPTX；
6. 研究报告 DOCX；
7. 研究演示 PPTX；
8. 一页 PDF brief；
9. 中英双语报告；
10. 带 Logo 和企业主题的三种输出；
11. 超长内容自动拆分；
12. 缺失资产、非法公式和超限失败路径。

## 23. 开发与发布命令目标

0.7.1 完成后统一命令：

```bash
npm ci
npm run build:documents
npm run test:documents
./scripts/test-agent-loop.sh
./scripts/package-extension.sh
```

`package-extension.sh` 必须包含：

- 文档 bundle 重建；
- bundle hash 和许可证检查；
- 禁止 CDN/远程 import/eval 检查；
- 文档单元测试；
- 现有 Agent Loop、Provider 和发布校验；
- ZIP 内必须存在必要字体、worker 和 bundle；
- ZIP 内不得存在 fixtures、node_modules、source map、缓存和用户文档。

## 24. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 第三方库包体过大 | 商店下载和冷启动变差 | 按格式拆 bundle、lazy load、测量门槛 |
| CJK 字体过大 | 包体显著增加 | 字体 ADR、压缩、子集化评估、只打包必要字重 |
| Service Worker 中断 | 生成任务失联 | Offscreen requestId、artifact store、可诊断状态和清理 |
| 大二进制消息失败 | 输出丢失 | IndexedDB artifact handoff，不通过 runtime message 传 Blob |
| 模型生成非法复杂 Spec | 重试循环 | capability slices、精确错误、模板槽位和本地验证 |
| PPTX 文本溢出 | 文件不可交付 | 容量模型、自动拆页、视觉 QA 和最小字号 |
| XLSX 公式风险 | 打开文件触发外部行为 | 公式白名单/扫描、禁止外部关系 |
| Office 兼容差异 | 用户打开时修复或错版 | 多应用 fixture、固定引擎版本、逐版本升级 |
| 模板随意覆盖安全字段 | 路径/外部资源风险 | Manifest Schema、受控合并、模板根限制 |
| 新旧创建器长期并存 | 行为漂移和维护成本 | v2 验证后删除对应临时 writer，明确迁移窗口 |

## 25. 完成定义

复杂样式生成阶段完成必须同时满足：

- 模型通过现有 Document Tool 和 v2 Schema 生成文档，不执行模型生成代码；
- DOCX、XLSX、PPTX、PDF 至少各有 3 个专业模板；
- 业务报告、分析工作簿和演示文稿 fixture 达到可直接继续编辑和交付的质量；
- 中文字体、图表、图片、表格、页眉页脚和页面设置按格式支持矩阵工作；
- 所有生成经过结构、语义和布局验证；
- 生成失败、取消和版本冲突不会覆盖已有文件；
- 视觉预览和质量报告可从文件管理器访问；
- 第三方依赖固定版本、本地打包、许可证完整且无远程代码；
- 所有 Provider、Side Panel、Channel、Schedule 和 Task 使用相同 Document Tool 机制；
- 完整测试、人工 Office 互操作、Chrome MV3 CSP 和发布打包通过；
- README、默认知识库、PRIVACY、STORE_LISTING、RELEASE 和 CHANGELOG 与实际能力一致。

## 26. 后续范围

完成 0.7.x 专业生成后，再单独设计：

- 基于原始 OOXML package 的 `editMode=preserve`；
- 原生 `.dotx`、`.xltx`、`.potx` 模板导入；
- Word tracked changes、comments 和 fields；
- Excel 原生复杂图表和计算引擎；
- PowerPoint 复杂母版、动画和既有对象编辑；
- PDF 表单、签名、合并、拆分和批注；
- 模板市场或组织级模板同步。

这些能力不得阻塞 0.7.x 的高质量新文档生成主线。
