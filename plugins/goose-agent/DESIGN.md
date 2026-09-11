# 鹅的 Agent — 设计意图

## 主表面

- **主表面是 Agent 对话**（消息流 + 工具过程 + **Composer**），不是笔记编辑器。  
- **不**搬 BlockNote / 笔记页树；不以笔记编辑为主路径。  
- 视觉与交互第一阶段：**完全照搬** goose-note 内 Notebook AI 面板（`NotebookAiPanel` 一脉），避免另起一套皮肤。  
- **一期无审批卡**（不做 ApprovalPlanCard / batch-plan 审批执行 UI）；工具过程以进度卡 / 结果呈现为主。

## 垂直布局意图（Workspace shell）

目标形态：垂直工作台（侧栏 + 主区），参考鹅的笔记工作台与「鹅的运行」handoff（左列表 + 右详情），以及 **Codex app** 的工作区 + 权限模式心智。**不是**纯聊天气泡 App。

```
+------------------+----------------------------------------+
|                  |  顶栏：标题 / 会话操作（照搬 note AI）     |
|  左栏            +----------------------------------------+
|  工作区 /        |                                        |
|  本地文件夹      |   垂直消息流                             |
|  （第一版主内容） |   · 用户 / 助手气泡                      |
|                  |   · ToolCall 进度卡                      |
|  （会话等次级    |   · （一期无审批卡）                      |
|   入口可后置）   |                                        |
|                  +----------------------------------------+
|                  |  Composer（Codex 式卡内布局）             |
|                  |  [工作区] [branch?]                       |
|                  |  ┌────────────────────────────────────┐  |
|                  |  │  输入…                              │  |
|                  |  │  [+] [权限]    [模型][思考] [环] [↑] │  |
|                  |  └────────────────────────────────────┘  |
+------------------+----------------------------------------+
```

### 布局原则

1. **左栏第一版 = 工作区 / 本地文件夹**（不是会话列表优先）；侧栏服务**工作区上下文**，主区服务当前 **Session** 的 Turn 流。  
2. **右主区 = 消息流 + Composer**，垂直布局，对齐 goose-note AI 体系。  
3. **信息密度对齐插件窗**：uTools 窗口高度有限；避免大 Hero、避免为风格牺牲可扫读。  
4. **工具过程可见**：进度是一等 UI；**不做** note 式审批卡执行路径（ADR 0007）。  
4b. **子代理卡（已锁 · ADR 0021）**：`runSubagent` 在消息流中渲染可折叠 **SubAgentCard**（非黑盒）。头栏必显：名称、模型、思考长度（低/中/高）、状态、elapsed、当前工具；展开：任务说明、内部 tool 步骤（复用 ToolProgressCard）、摘要；可选 Modal 看完整轨迹。展开动效 CSS 150–250ms `cubic-bezier(0.23,1,0.32,1)`，`prefers-reduced-motion` 降级，不引 Motion 库。并行多卡 OK。  
4c. **Artifact 卡片（已锁 · ADR 0022）**：**消息流内嵌**（非独立侧栏）。HTML 沙箱 iframe 预览 + 下载；Mermaid 真渲染（dark/base）+ SVG/源码下载；Office/生图以预览或文件摘要 + 下载；有工作区可「保存到工作区」。Composer `+` 统一附件：图片 → vision；Office/PDF → 解析文本注入（气泡短 displayText）。  
5. **Composer 卡内控件（已锁 · Codex 参考图）**：控件均在输入卡内底栏，**不**在卡外再挂一行。语义序仍为模型 → 思考 → 权限，但按空间分区：左 `+`/权限，右 模型|思考 → 用量环 → 发送。思考长度默认 **中**，UI 不写「默认」字眼。权限三档（只读工作区 / 工作区读写 / 完整权限）；完整权限 = 整机（uTools gooseFs），**切换无二次确认**。  

6. **工作区可空（已锁）**：无工作区时主区仍可对话；文件工具不可用，直至挂载工作区（完整权限 FS 细则见 ADR 0007）。  
7. **全页视图（已锁）**：设置、**变更差异**、**技能编辑**等与工作台互斥的表面用 **`AppView` 全页切换**（同设置页），**不**在对话旁再塞侧栏。

### 技能编辑页（已锁 · ADR 0016）

- 全页：左 skills 文件树 + 右 **CodeMirror 6 源码编辑**（非 WYSIWYG、无分栏预览）。  
- `.md` / `.mdx` 语法着色；其它文本 plain；内容 **原样**读写。  
- 页壳（顶栏、按钮、树）用 HeroUI；编辑内核为 CM，**lazy** 进技能路由，不进首屏。  
- 主题 hex token，忌 `color-mix` / `oklch` / `hsl(var(--token)/alpha)`。

### 变更差异页（已锁 · ADR 0010 + 0013）

Codex 心智：本会话 Agent **成功落盘**后可回顾差异；**不依赖 git**；diff 视图只读。变更快照经 `ga:` **可刷新回顾**；支持用户主动 **单文件还原**（ADR 0013）。

```
+------------------+----------------------------------------+
|  返回 / 标题「变更」 |  unified | split （默认 unified）        |
+------------------+----------------------------------------+
|                  |                                        |
|  本会话文件列表    |   选中文件的 diff（@pierre/diffs）       |
|  · path  写/删/改名|   红删 / 绿增                            |
|  · …             |   「还原此文件」（可还原时）               |
|                  |                                        |
+------------------+----------------------------------------+
```

- **形态**：独立全页（`AppView = "changes"`），**不是**主区右侧栏。  
- **结构**：左 = 变更文件列表；右 = 当前文件 diff。  
- **入口**：顶栏「变更」；工具进度卡「查看差异」。  
- **还原**：列表项或 diff 区提供 **「还原此文件」**；`truncated` / `binary` / 无可用 before（create 除外）时禁用并说明；成功后该条从列表移除（语义见 ADR 0013）。  
- **Diff**：默认 **unified**，可选手动切 **split**；渲染库 `@pierre/diffs` / `@pierre/diffs/react`（+ Shiki 语法着色）。  
- **语法 token 色（uTools）**：pierre 默认 token 规则含 `light-dark(var(--diffs-token-light), …)`，旧内核会整段失效导致无着色；须用 `unsafeCSS` 以 **hex 实色 var** 覆盖 token 色（与行背景 hex 覆盖同一模式），禁止依赖 `light-dark`。  
- **代码字体**：Diff 正文经 pierre 官方 CSS 变量 `--diffs-font-family: var(--font-mono)` 穿透 Shadow DOM；与设置 → 外观「代码字体」一致。默认 **JetBrains Mono**（`codeFont: "jetbrains"`），经 `@fontsource/jetbrains-mono` **lazy 打包**，不走 Google CDN。  
- **覆盖**：写 / 删 / 重命名；mkdir 可不进列表。  
- 密度与 token 同工作台；旧内核颜色禁忌见下文。

### Composer 布局与控件（已锁 · Codex 式）

按用户参考图重构：阻断 chip → **ContextBar** → 输入卡（纵向：缩略图 / 全宽 textarea / 底栏）。

```
|  [工作区] [branch?]                              |
|  ┌──────────────────────────────────────────┐  |
|  │  输入…                                    │  |
|  │  [+] [权限]          [模型][思考] [环] [↑] │  |
|  └──────────────────────────────────────────┘  |
```

- **上方 ContextBar**：工作区 chip（可点切换，含「不选择工作区」）+ Git 分支 chip（有则显示）。空会话可切换 / 可不选工作区；当前会话 `messages.length > 0` 后整条隐藏（workspace 已绑定）。  
- **卡内底栏**：
  - 左：`+` 选图 + **权限模式**三档  
  - 右：模型|思考分组 pill → **上下文用量圆环** → 圆形发送 / 停止  
- **语义序**仍是模型 → 思考 → 权限；实现上权限在左、模型在右（空间分区）。思考默认「中」，不写「默认」装饰词。  
- 用量环 Hover 精简 / Click 明细（ADR 0011）。  

有工作区时文件工具按当前档沙箱；完整权限下可越出工作区根（本机 FS）。无工作区时文件 tool 不可用。

### 文案克制（已锁）

- 当前选中态用勾选 / 高亮即可，**不要**再挂「默认」「推荐」等无信息量角标。  
- 设置页「默认模型」等**确有语义**的标签可保留；Composer 与列表项不堆装饰词。

## 视觉与 Token 策略

### 主背景与留白层级（已锁）

- 浅色主背景 `--color-bg`：**`#F4F4F4`**（`#f4f4f4`）。  
- 深色主背景 `--color-bg`：**`#303133`**（贴合 uTools 默认深底）。  
- **壳层一体**：左栏 + 顶栏用 `--color-bg`，视觉上连成一圈 chrome，不被标题条隔断。  
- **内容抬升**：消息区 + Composer 用 `--color-surface*`（深 `#38393b`）；输入框再凹回 `bg`，用细边框做 affordance。  
- 壳层主分割（侧栏/顶栏/内容交界）**不用全宽描边线**；靠背景阶梯分区。

### 浅色模式（质量约定 · 已锁）

目标：灰底工作台上白卡清晰、描边不 muddy、次级文案可读；**不另起品牌色**，仍 mono/accent 变体 + HeroUI 桥接。

#### Surface ladder（浅）

| 阶 | Token | Hex | 用途 |
|----|--------|-----|------|
| Canvas / chrome | `--color-bg` | `#f4f4f4` | 侧栏、顶栏、壳层、Composer 输入凹回 |
| Elevated | `--color-surface` | `#ffffff` | 主对话面板、设置大卡、白浮层 |
| Hover | `--color-surface-hover` | `#ebebeb` | 行 hover、次级控件底 |
| Active | `--color-surface-active` | `#e1e1e1` | 按下 / 选中底（非品牌 accent） |
| Field | `--color-input` / HeroUI `--field-background` | `#f4f4f4` | 表单字段凹在白卡上 |

- 层级靠 **背景阶梯 + 细描边**，不用半透明叠层、不用 `color-mix`。  
- 助手气泡：`bg-bg` 凹在 `surface` 上；浅色可加 soft 内描边（`agent-chat.css`）。用户气泡：`accent-subtle`。  
- Composer 输入卡：`bg-bg` + `border-soft`，相对主面板微抬。

#### 描边与文字（浅）

| Token | Hex | 说明 |
|-------|-----|------|
| `--color-border-soft` | `#dedede` | 卡片/气泡弱边；在 `#f4f4f4` 与白上均可见 |
| `--color-border` | `#d0d0d0` | 默认描边（设置卡、分隔） |
| `--color-border-strong` | `#9a9a9a` | focus / 强调边 |
| `--color-fg` | `#171717` | 主文案 |
| `--color-fg-muted` | `#525252` | 次级（状态行、说明） |
| `--color-fg-faint` | `#5c5c5c` | 更弱标签；仍须在白 / `#f4f4f4` 上可读 |

#### Overlay / 浮层

- HeroUI `--overlay`：**实色白** `#ffffff`（禁止半透明毛玻璃）。  
- 浮层兜底：`background: var(--overlay)` + `border: 1px solid var(--border)` + 轻实色阴影（`src/index.css`）。  
- 深色浮层贴 surface `#38393b`，同规则。

#### Accent 归属（与 ADR 0009 一致）

- **HeroUI 品牌主色**：`--accent` / `--accent-foreground` / `--accent-hover` → primary、ToggleButton 选中、Switch 开态。  
- **本仓业务**：`--color-accent*`（`bg-accent` 等）；`data-accent` 变体只改 `--color-accent*`，桥接同步到 HeroUI。  
- **禁止**在 shadcn 兼容层把 `--accent` 改写成 subtle 灰（会毁掉 primary rest/hover 对比）。

#### HeroUI 浅色控件

- **Field**：浅色用 canvas 底 + soft 描边（`--field-border` / hover / focus 预展开实色）；勿透明描边导致白卡上「消失」。深色仍可靠背景阶梯、描边可透明。  
- **ToggleButton 选中**：品牌 `--accent` 实底 + `--accent-foreground` 字色（深浅同一套）。  
- **Switch**：关态轨预展开灰阶（浅 `#c8c8c8` 起）；开态跟 accent；拇指实色。组件上覆盖，勿只写 `:root`（会被 HeroUI 变量盖掉）。

#### 浅色质量清单（uTools）

1. 主面板白卡在 `#f4f4f4` chrome 上边界清晰（阶梯或 soft 边）。  
2. 设置卡 / Composer / 下拉浮层：描边可见，不「糊成一片灰」。  
3. `fg-muted` / `fg-faint` 在白与 `#f4f4f4` 上均可扫读。  
4. primary / CTA：rest + hover 字色与底色各自对比（真机优先）。  
5. 输入框在白卡上可辨（底或边至少一处与 surface 不同）。  
6. 无 `color-mix` / `oklch` / `hsl(var(--x)/α)` / `light-dark()`；hover 均为预展开 hex。  
7. 浏览器预览正常 **≠** uTools 真机结论；改色后至少浅色走一遍侧栏 + 对话 + 设置 + 下拉。

### 圆角标准（已锁）

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-panel` / `rounded-panel` | **16px** | **主面板与大卡片标准**（主内容区、侧栏空态卡、设置大卡等） |
| `--radius-cell` / `rounded-cell` | 14px | 气泡、表单单元格、中等卡片 |
| 控件 | `rounded-lg` / `rounded-[10px]` 等 | 按钮、输入控件；勿用直角硬切主表面 |

- **新 UI 大表面一律 `rounded-panel`**，禁止主面板直角、禁止再写随意 `rounded-[12px]` 当大卡。  
- 主内容区为独立 surface 面板（`overflow-hidden rounded-panel`），顶栏留在壳层 `bg` 上，避免「标题条直角切断」主区。

### 照搬策略

- **完全照搬** goose-note AI 相关视觉：面板结构、消息流、Composer、工具进度卡、模型选择浮层等。  
- **不**照搬：笔记页树、BlockNote 编辑壳、ApprovalPlanCard 审批执行 UI。  
- 颜色、圆角、字号优先复用 note 已验证 token / CSS 变量命名习惯；本仓独立维护副本，不运行时依赖 note 包。  
- 品牌可沿用鹅系列克制、略暖的专业感；强调色服务状态与主操作，不重做营销风皮肤。

### uTools 旧内核颜色与交互禁忌

uTools 插件窗内核偏旧（Electron / Chromium 能力落后于日常 Chrome）。**浏览器 `bun run dev` 看起来正常，不等于真机可用**；样式与 hover/focus 结论以 uTools 真机优先。

#### 禁止的颜色函数（与 goose-note / goose-2fa 一致）

- 避免 `hsl(var(--xxx) / alpha)`、`hsl(var(--xxx)/0.5)`：旧内核常退化成整块实色，文字与底同色不可读。
- 避免 `color-mix()`、`oklch()`、`lab()`、`lch()`：支持差或无。
- 避免 `light-dark()`：旧内核无效（变更页 pierre 语法 token 曾因此整段无色；须 hex 实色覆盖，见上文「变更差异页」）。
- 避免 Tailwind 依赖现代颜色函数的透明度写法；构建产物需抽查。
- 关键链路只用 **hex / rgb / 传统 hsl 实色 token**；透明度用已展开的实色或可预测的 rgba，不以「现代 CSS 颜色」当默认。

#### 交互态必须预展开、保持对比

- hover / active / disabled 的背景与文字各自是**独立实色 token**（如 `--accent` + `--accent-hover` + `--accent-foreground`），**禁止**指望 `color-mix`、`opacity`、或「同一 token 加减亮度」在旧内核上自动出正确 hover。
- 旧内核忽略现代颜色函数时，常只剩 fallback 实色：若 rest 与 hover 共用了错误 token，会出现「默认灰底、hover 深底深字」一类不可读态。
- 改 primary / 主 CTA 样式后，至少核对 rest + hover 的**字色与底色对比**（浅色主题与深色主题各一次）；真机优先。

#### CSS 变量归属（勿混用语义）

| Token 族 | 归属 | 用途 |
|----------|------|------|
| `--accent` / `--accent-foreground` / `--accent-hover` | **HeroUI 品牌主色** | primary 按钮等主操作 |
| `--color-accent` / `--color-accent-fg` / `--color-accent-hover` / `--color-accent-subtle` | 本仓 Tailwind `@theme` | 业务 class（`bg-accent`、`text-accent-fg`…） |
| shadcn 菜单高亮 | `--color-shadcn-accent` → `--color-accent-subtle` | 仅存量 `components/ui` 高亮 |

- **禁止**在 shadcn 兼容层或其它后置 CSS 块里把 `--accent` 改写成 subtle 灰：会盖掉 HeroUI primary，rest/hover 对比崩坏（实锤：定时任务「新建」按钮 hover 深底深字）。
- HeroUI 品牌色须桥到 `--color-accent*`（见 `src/index.css` 末段桥接），`data-accent` 变体只改 `--color-accent*`，由桥接同步到 HeroUI。
- 浮层 token `--overlay` 必须 hex 实色（浅 `#ffffff` / 深 `#38393b`），不得半透明。

### 组件库（HeroUI）

- **新 UI 先查 [HeroUI](https://heroui.com/)**，有则用 `@/lib/heroui`；**禁止**再为业务手写平行 Dropdown/Popover/Select/Button/Modal 等；**禁止**新增 `src/components/ui/*`。  
- 主题与 token 覆盖集中在 `src/index.css`；组件库默认主题若含 oklch/color-mix，**运行时靠本仓 hex 覆盖**，旧内核走实色 fallback。  
- 目标态：未用 shadcn `components/ui` 删除；白名单例外见 `docs/adr/0009-heroui-ui.md`（panels / CM / Streamdown·Mermaid / diffs / lucide）。

### 动效与反馈

- 动效短、可降级；尊重 `prefers-reduced-motion`。  
- Toast、错误、提醒：**HeroUI Toast**（目标态）；不手写平行体系，勿新增 sonner。  
- **Composer 快捷键（已锁）**：**Enter 发送**，**Shift+Enter 换行**；IME 组字中不发送。  
- **Composer 发送钮**：卡内底栏右侧圆形 `rounded-full size-8`（`ArrowUp`）；与底栏控件同行对齐，不挡字。  
- **状态指示（已锁）**：仅在 Agent 进行中使用 Beautiful UI 原语（CSS + React state），不做常驻装饰；idle 无 shimmer / loader。  
  - 预设集中在 `src/components/agent/aiMotionPresets.ts`；原语在 `src/components/agent/beautiful-ui/`。  
  - 流式生成中 Composer：`PromptBarChrome` CSS shimmer + `LoadingState` Drive（label + tabular elapsed）。  
  - 思考中：`ThinkingTraces`（可展开）+ `LoadingState`；仅 `showThinking` 时挂载。  
  - 壳层/面板：`ChatChrome` + `agent-panel-enter`；空态鹅标轻浮；图标控件 hover 微抬 + svg 轻弹（`agent-chat.css`）。  
  - 工具处理中：`ToolChips` + `TaskRows`；写操作紧凑 `CompactDiff`（跳转现有 Changes 页，不替换 `@pierre/diffs`）。  
  - 消息入场：仅 opacity + 微位移（`agent-chat.css`，≤200ms，ease-out）。  
  - 尊重 `prefers-reduced-motion`；不引入 color-mix / oklch / 半透明 token。

## 反模式

- 做成全屏气泡聊天，丢掉 **Workspace shell**  
- 左栏第一版做成「仅会话列表」、工作区后置或缺失  
- 主区默认进笔记编辑器  
- 为「新品牌」重做一套与 note AI 无关的视觉（照搬阶段禁止）  
- 在旧内核上用半透明 token「看起来现代」导致实色糊屏  
- 一期实现 ApprovalPlanCard / 强制写前审批流（与 R5 冲突）  

## 已锁（原 OPEN，R8）

- Permission Mode 三档文案：只读工作区 / 工作区读写 / 完整权限  
- 完整权限：**无二次确认**  
- 工作区：**可空**；建议持久化上次列表与选中 + 首次空态引导  

## 首次引导（独立页 + 短导览）

**形态**：独立全屏起步页为主；Driver.js 三步导览为辅（MIT）。**不**在主界面空态内嵌清单。不单开 ADR。

### 独立引导页（`OnboardingScreen`）

- **门控**：启动时无 API Key → 全屏引导；已有 Key（或点「进入工作台」）→ 主 shell。  
- **主界面不显示**起步清单；空会话仅轻空态（鹅标 +「开始对话」）。  
- 引导页两项实时推导（不假勾选、不单独持久化完成态）：  
  1. 已配供应商 + API Key（**必做**，挡「进入工作台」）  
  2. 已有工作区（可选）  
- Key CTA → 打开现有「设置 → AI」（不重做第二套表单）。  
- 工作区 CTA → 本机选文件夹（与侧栏同源）。  
- 壳层主区控件**无描边框**（背景阶梯分区）；输入/小控件可保留 affordance。

### Tour（已实现）

- 依赖：`driver.js`（MIT）。  
- **自动触发**：进入工作台后，只要 **已有 API Key** 且 `ga:tour` phase=`pending`，在 idle / 非 streaming 约 700ms 自动播 **1 次**可跳过。**不**再要求「Key + 工作区 + 首条消息」三项齐。  
- **无顶栏常驻导览入口**（不放 Compass「界面导览」）；`done` / `skipped` 后不自动。  
- 3 步：工作区侧栏 → Composer（含权限）→ 设置入口。  
- 锚点：`data-tour="workspace|composer|settings"`。  
- 持久化仅 tour 态：`ga:tour` → `{ phase: "pending" | "done" | "skipped" }`；清单（Key + 工作区两项）仅实时推导、不单独存完成态。  
- 自动仅 `pending`；关闭/跳过 → `skipped`，走完 → `done`。  
- **再触发（仅开发）**：`resetOnboardingTour()` 将 phase 置回 `pending` 并派发 `goose-agent:tour-reset`（清自动播闸）；**不**清 Key/工作区。设置内「重置界面导览」是唯一再播入口，**仅 `import.meta.env.DEV` 渲染**，生产构建不可见。

### 实现入口

- 推导：`src/lib/onboarding/checklist.ts`  
- Tour 态：`src/lib/onboarding/tourState.ts`（含 `resetOnboardingTour`）  
- Driver 封装：`src/lib/onboarding/runTour.ts`  
- 自动触发：`src/hooks/useOnboardingTour.ts`  
- UI：`src/components/onboarding/OnboardingScreen.tsx`  
- 门控：`App.tsx`（`enteredWorkbench`）  
- 开发重置入口：`SettingsPage`（DEV only）  
- 主题：`src/components/onboarding/tour.css`  


## B 阶段 · 壳层界面打磨（Impeccable）

目标：一体舒适、层级清晰、hover/深浅色正确、图标语义准、少 AI 说明噪音。仍用本仓 token 与短动效，不另起皮肤。

### 壳层审计（摘要）

| 表面 | 问题 | 状态 |
|------|------|------|
| WorkspaceSidebar | 空态啰嗦；选中弱；无移除；图标无开合语义 | **已改**（密扫 + 选中轨 + 短空态 + hover 移除） |
| 空态 / 清单 | 主区嵌清单 | **已改**（独立 `OnboardingScreen`；主区仅轻空态） |
| Composer | 段落提示噪、发送按钮重、层级平 | **已改**（Codex 卡内底栏 + ContextBar + 圆形发送） |
| SettingsAI | 文案噪、行底与卡片同色对比弱 | **已改**（密排 + bg 行抬层 + 短文案） |
| 消息流 / 工具卡 | 基础可用；气泡层级与工具卡可统一 | 后置 |
| 会话历史 | 次级 popover；密度尚可 | 后置 |

### 侧栏已选方案

- **密扫专业 + 轻层级**（否决纯扁平无轨、否决过重卡片堆叠）。  
- 空态：图标 + 两行短文案 + 主色 CTA；不强调 Agent 话术。  
- 列表：选中左侧指示轨 + `FolderOpen`；路径仅 title；hover 显示移除。  
- 有列表时「添加文件夹」在标题行 `FolderPlus`（hover 显）；无底栏次级入口。  
- **可拖宽度（ADR 0014）**：`ResizablePanel` 默认 200px、min 160、max 360；布局 `ga:` 持久化；壳层分割仍靠间距/细 handle，不做粗描边。  
- **工作区 → 会话子树（ADR 0014 / 0015）**：点选工作区展开（可多展开）；子级 = 该工作区会话列表 + 新会话；会话绑 `workspaceId`。**滚动区仅工作区树**。  
- **快速对话（ADR 0020）**：`workspaceId: null` 的会话；侧栏**底部独占固定 dock**，**始终可见**（可空）；组内 `+` 新建；列表过长时 dock 内滚动（header 固定）。取代中部条件「未挂载」IA。顶栏 History 与侧栏同源过滤。

### 空态 / 引导已选方案

- **独立引导全屏**（否决主区嵌清单；否决大 hero / 营销空态）。  
- 主区空态：小鹅标 +「开始对话」+ 一行快捷键。  
- 配置：`OnboardingScreen` 进度条 + Key 主 CTA + 可选工作区。

### Composer 已选方案

- **Codex 式卡内布局 + 阻断 chip**（否决卡外底栏控件行、否决常驻长段落提示）。  
- 无 Key：可点 danger-soft chip「未配置 Key · 点此设置」；发送仍禁用/ toast。  
- 有 Key 无工作区：不单独占 chip（ContextBar 已可「不选择工作区」）。  
- 结构：阻断 chip（凭证 / 视觉）→ ContextBar（工作区 + 可选分支；仅空会话）→ 输入卡。  
- 输入卡：`bg-bg` + `border-border-soft`；`rounded-[12px]`；纵向 = 缩略图 / 全宽 textarea / 底栏。  
- 底栏左：`+` + 权限；右：模型|思考分组 pill + 用量环 + 圆形 `ArrowUp` 发送；停止保留文案。  
- 控件语义序：模型 → 思考 → 权限（权限左、模型右为空间分区，非改语义）。

### SettingsAI 已选方案

- **密排分组 + 行抬层**（否决大段协议说明、否决 surface-on-surface 糊成一块）。  
- 分区卡：`border` + 紧 padding；行块 `bg-bg` + `border-soft` 抬对比。  
- 文案极短；开关区去掉重复 description；保存区合并「保存并拉取模型」。  
- 下拉触发器用本仓 `surface/hover` token，不用 muted/background 混用。  
- Dialog 头/内边距同步收紧。  
- **供应商与凭证 · 认证区（ADR 0018，auth-mode-first）**：  
  - **顶层 HeroUI Tabs**：**本机账号** | **API 密钥**（非整页导航）。  
  - **本机账号**：仅列可导入行（`importAllowed && hasAuthMaterial`：已登录 Grok、OpenCodex xAI），紧凑单行；presence-only CLI 不展示 → `oauthSession`；**OAuth token 永不写入 API Key 槽**。  
  - **API 密钥**：供应商下拉仅 DeepSeek + 自定义（无 GLM/MiniMax 内置）；单列 Key 表单。  
  - 生效方式以 `preferredAuthMode` + 凭证有效性为准；Claude/Codex 订阅仅检测不导入。

### B 阶段门禁（完成）

空态/清单、WorkspaceSidebar、Composer、SettingsAI 均已改造并记入上表。消息流/工具卡/会话历史标后置，不阻塞本循环 done。

## 仍 OPEN（非阻塞设计细节）

- 会话历史入口的最终位置（次级区 / 顶栏 popover 等；实现期 PR10 默认可照搬 note 顶栏历史）  
