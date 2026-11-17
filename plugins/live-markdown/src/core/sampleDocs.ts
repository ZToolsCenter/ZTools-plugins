export const TYPORA_QUICKSTART_MARKDOWN = `---
title: Welcome to Live Markdown
author: harris
---

# Welcome to Live Markdown :sparkles:

**Live Markdown** 为你提供读者与创作者合一的**无缝所见即所得体验**。它消除了传统双栏预览的视线割裂与排版噪点，让你全神贯注于内容创作：点击任意段落即可实时展开 Markdown 源码编辑，移开焦点后立即渲染为优美出版级排版。

[TOC]

## 1. 核心工作流与视图模式

- **实时预览 (Live Preview)**：单击任意块（标题、表格、公式、Mermaid 图表、代码块）即可直接内联修改源码；按 \`Cmd + /\`（或底部状态栏 \`</>\` 按钮）可随时在**实时预览**与**源码模式**之间秒级切换。
- **侧边栏 (Sidebar)**：支持**文件树 (File Tree)**、**文章列表 (File List)**、**可折叠大纲 (Outline)** 与**工作区全文检索 (Search)**，可通过 \`Cmd + Shift + L\` 快速显隐。
- **专注模式 (\`F8\`) & 打字机模式 (\`F9\`)**：开启专注模式后仅高亮当前正在输入的段落；开启打字机模式后光标所在行始终保持在屏幕纵向中央。
- **6 套经典内置排版主题**：随时在顶部菜单切换 \`Classic Light\`、\`Dark Modern\`、\`Warm Paper\`、\`Serif Book\`、\`Clean Minimal\` 与 \`Industrial Sans\` 主题。

> [!TIP]
> 试试按 \`Cmd + P\` 唤起 **Quick Open** 快速跳转文件，或按 \`Cmd + F\` / \`Cmd + H\` 打开文档内查找与替换面板！

## 2. 丰富的行内样式与扩展语法

Live Markdown 支持完整的 GitHub Flavored Markdown (GFM) 行内语法以及扩展排版标记：

- **基础强调**：这是 **加粗文本 (\`Cmd+B\`)**、*斜体文本 (\`Cmd+I\`)*、<u>下划线 (\`Cmd+U\`)</u> 以及 ~~删除线 (\`Alt+Shift+5\`)~~。
- **扩展标记**：支持 ==高亮荧光笔标记==、行内代码 \`const mode = "live-preview"\`、化学分子式 H~2~O 下标与数学幂次 x^2^ 上标。
- **行内数学公式**：在质能方程 $E = mc^2$ 与欧拉恒等式 $e^{i\\pi} + 1 = 0$ 中，行内公式与正文基线自然对齐。
- **Emoji 与脚注**：输入冒号加短代码即可渲染 :rocket: :tada: :fire: :bulb:，同时支持学术脚注引用[^1]。
- **超链接跳转**：按住 \`Cmd\` 点击 [Markdown 语法标准指南](https://www.markdownguide.org) 或点击文档内大纲锚点即可跳转。

## 3. 任务列表与 GFM 警告框 (Alerts)

- [x] 所见即所得 Live Preview 与源码模式双向同步
- [x] 可折叠大纲、文件树、文章列表与文件夹级正则搜索
- [x] 内置 LaTeX 数学公式渲染器与 Mermaid 矢量图表引擎
- [ ] 点击左侧复选框可直接切换任务完成状态

> [!NOTE]
> **GFM Callout / Alert 支持**：你可以使用 \`[!NOTE]\`、\`[!TIP]\`、\`[!IMPORTANT]\`、\`[!WARNING]\` 与 \`[!CAUTION]\` 创建醒目的提示框。

> [!WARNING]
> 在处理重要本地文稿时，建议开启偏好设置中的**自动保存 (Auto Save)** 功能。

## 4. 交互式可视化表格

点击下方表格任意单元格即可直接编辑，悬浮工具栏支持**增删行列、上下左右移动行列 (\`Alt + 方向键\`)、调整列对齐方式**以及一键**美化 Markdown 表格源码**：

| 功能模块 | 快捷键 | 状态 | 核心能力说明 |
| :--- | :---: | :---: | :--- |
| 切换源码模式 | \`Cmd + /\` | :check: 已就绪 | 实时预览与行号源码双向同步 |
| 快速打开文档 | \`Cmd + P\` | :check: 已就绪 | 模糊检索工作区与最近文件 |
| 插入/管理表格 | \`Cmd + Alt + T\` | :check: 已就绪 | 网格选区创建、对齐切换与行列重排 |
| 专注 / 打字机 | \`F8\` / \`F9\` | :check: 已就绪 | 沉浸式长文写作体验 |

## 5. 数学公式块 (LaTeX / MathJax)

双击或点击下方公式块即可编辑 LaTeX 源码，并实时查看排版预览：

$$
\\mathcal{L}_{\\text{Attention}}(Q, K, V) = \\operatorname{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V \\quad , \\quad \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

$$
\\mathbf{A} = \\begin{pmatrix} a_{11} & a_{12} & \\cdots & a_{1n} \\\\ a_{21} & a_{22} & \\cdots & a_{2n} \\\\ \\vdots & \\vdots & \\ddots & \\vdots \\\\ a_{m1} & a_{m2} & \\cdots & a_{mn} \\end{pmatrix}
$$

## 6. Mermaid 流程图与时序图

原生支持在代码块中使用 \`mermaid\` 绘制流程图、时序图与饼图：

\`\`\`mermaid
graph LR
  Input[Markdown 源码] --> Parser{AST 解析引擎}
  Parser -->|聚焦块| RawEditor[内联源码编辑]
  Parser -->|非聚焦块| LiveDOM[所见即所得排版]
  RawEditor --> Sync((双向同步))
  LiveDOM --> Sync
\`\`\`

\`\`\`mermaid
sequenceDiagram
  participant User as 创作者
  participant Editor as Live Preview Editor
  participant FS as 本地工作区 (Preload)
  User->>Editor: 输入 Markdown / 粘贴截图
  Editor->>FS: 自动保存文稿 & 复制图片至 ./assets
  FS-->>Editor: 返回相对路径与最新文件树
\`\`\`

## 7. 代码块与语法高亮

\`\`\`typescript
interface LiveMarkdownBlock {
  id: string;
  type: "heading" | "paragraph" | "table" | "math" | "diagram" | "code";
  raw: string;
}

export function renderLivePreview(blocks: LiveMarkdownBlock[]): string {
  // 聚焦时展开 Markdown 标记，失焦时渲染纯净排版
  return blocks.map((block) => block.raw.trim()).join("\\n\\n");
}
\`\`\`

---

[^1]: 这是一条底部的 Markdown 脚注定义，将鼠标悬停在正文的 \`[1]\` 角标上即可直接预览脚注内容。
`;

export const TYPORA_MARKDOWN_REFERENCE = `# Markdown Syntax Reference

本文档汇总了 Live Markdown 支持的完整 Markdown 语法速查手册与键盘快捷键。

[TOC]

## 块级元素 (Block Elements)

### 标题 (Headers \`Cmd + 1..6\`)

在行首使用 1–6 个 \`#\` 字符即可创建 H1–H6 标题，或者使用快捷键 \`Cmd + 1\` 至 \`Cmd + 6\`（\`Cmd + 0\` 恢复为普通段落）。

### 引用与警告框 (Blockquotes & Alerts \`Alt + Cmd + Q\`)

> 引用块以 \`>\` 开头，支持多段落与嵌套引用。

> [!IMPORTANT]
> 在引用块首行写入 \`[!NOTE]\`、\`[!TIP]\`、\`[!IMPORTANT]\`、\`[!WARNING]\` 或 \`[!CAUTION]\` 即可渲染为 GitHub 风格警告卡片。

### 列表与任务清单 (Lists)

1. 有序列表使用 \`1. \` 开头
2. 无序列表使用 \`- \`、\`* \` 或 \`+ \` 开头
3. 任务列表使用 \`- [ ] \` 或 \`- [x] \` 开头

### 代码围栏 (Code Fences \`Alt + Cmd + C\`)

使用三个反引号 \`\`\` 加语言名称（如 \`typescript\`、\`python\`、\`rust\`、\`sql\`、\`json\`、\`bash\`）即可创建带语法高亮与行号的代码块。

### 数学公式块 (Math Blocks \`Alt + Cmd + B\`)

输入 \`$$\` 并回车即可插入独立公式块：

$$
f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x - a)^n
$$

### 饼图示例 (Mermaid Pie Chart)

\`\`\`mermaid
pie title 创作者常用内容块占比
  "正文段落与列表" : 45
  "代码与架构图" : 25
  "数据表格" : 18
  "数学公式" : 12
\`\`\`

## 常用快捷键速查表

| 动作 | macOS 快捷键 | Windows / Linux 快捷键 |
| :--- | :--- | :--- |
| 新建文档 | \`Cmd + N\` | \`Ctrl + N\` |
| 打开文件 | \`Cmd + O\` | \`Ctrl + O\` |
| 保存文档 | \`Cmd + S\` | \`Ctrl + S\` |
| 快速打开 (Quick Open) | \`Cmd + P\` | \`Ctrl + P\` |
| 切换源码模式 | \`Cmd + /\` | \`Ctrl + /\` |
| 查找 / 替换 | \`Cmd + F\` / \`Cmd + H\` | \`Ctrl + F\` / \`Ctrl + H\` |
| 显示/隐藏侧边栏 | \`Cmd + Shift + L\` | \`Ctrl + Shift + L\` |
| 一级至六级标题 | \`Cmd + 1\` .. \`Cmd + 6\` | \`Ctrl + 1\` .. \`Ctrl + 6\` |
| 提升 / 降低标题级别 | \`Cmd + =\` / \`Cmd + -\` | \`Ctrl + =\` / \`Ctrl + -\` |
| 插入表格 | \`Cmd + Alt + T\` | \`Ctrl + Alt + T\` |
| 插入代码块 | \`Cmd + Alt + C\` | \`Ctrl + Alt + C\` |
| 插入数学公式块 | \`Cmd + Alt + B\` | \`Ctrl + Alt + B\` |
| 加粗 / 斜体 / 下划线 | \`Cmd + B\` / \`I\` / \`U\` | \`Ctrl + B\` / \`I\` / \`U\` |
| 行内代码 / 行内公式 | \`Cmd + Shift + K\` / \`M\` | \`Ctrl + Shift + K\` / \`M\` |
| 超链接 / 插入图片 | \`Cmd + K\` / \`Cmd + Shift + I\` | \`Ctrl + K\` / \`Ctrl + Shift + I\` |
| 清除选中格式 | \`Cmd + \\\` | \`Ctrl + \\\` |
| 专注模式 / 打字机模式 | \`F8\` / \`F9\` | \`F8\` / \`F9\` |
`;

export const SAMPLE_QUICKSTART_DOC = TYPORA_QUICKSTART_MARKDOWN;
export const SAMPLE_MARKDOWN_REFERENCE_DOC = TYPORA_MARKDOWN_REFERENCE;
