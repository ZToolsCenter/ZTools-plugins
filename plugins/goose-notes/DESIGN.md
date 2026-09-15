---
name: 鹅的笔记
description: uTools 本地化笔记应用，BlockNote 驱动，Notion 风格

colors:
  shell-bg: "#f7f7f7"
  editor-bg: "#ffffff"
  selected-bg: "#f1f1ef"
  primary: "#6366f1"
  foreground: "#1e1e1e"
  muted-foreground: "#6d6d6d"
  border: "#dbdbdb"
  destructive: "#ee4444"
  notion-blue: "#2383e2"
  ai-teal: "#58d7b8"
  ai-amber: "#ffb56a"

typography:
  title:
    fontFamily: "var(--font-default)"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "var(--font-default)"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "0.01em"
  label:
    fontFamily: "var(--font-default)"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.02em"
  serif:
    fontFamily: "var(--font-serif)"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  mono:
    fontFamily: "var(--font-mono)"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"

rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "14px"
  slash: "18px"

spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.editor-bg}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "{colors.shell-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.editor-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  input:
    backgroundColor: "{colors.shell-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  dialog:
    backgroundColor: "{colors.shell-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
    padding: "24px"
  chip:
    backgroundColor: "{colors.selected-bg}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "6px 12px"
---

# Design System: 鹅的笔记

## 1. Overview

**Creative North Star: "The Quiet Study"**

鹅的笔记的界面像一间空书房。大面积留白，没有装饰性元素干扰视线。用户坐下来，面前只有纸和笔——编辑器就是全部。侧边栏缩在边缘， barely 可见的分割线界定了空间，但不争夺注意力。暗色模式不是"夜间主题"的噱头，而是同一间书房在傍晚灯光下的自然延续：墙色深了，纸色暖了，但空间感不变。

这种设计系统刻意回避 SaaS 工具常见的视觉噪音：没有品牌色 banner，没有渐变按钮，没有悬浮 action button。色彩被极度克制地使用，以至于当 AI 区域的彩虹渐变出现时，它的出现本身就成为一种信号——"这里有别的东西"。

**Key Characteristics:**
- 暖调中性灰，不是冷白也不是工业灰。壳色 (shell-bg) 略带 60° 暖色相，像宣纸的底色。
- 投影是"耳语"级的存在感，统一使用 slate 色系 (rgba(15,23,42))，从不抢戏。
- 圆角是软陶质感而非锐利切割，10–14px 的温和弧度让元素感觉可以被触摸。
- 中文书法字体（仓耳今楷）作为可选衬线，为长文阅读提供人文温度。
- 全局移除 focus ring，操作反馈靠颜色变化和微投影，而非边框闪烁。
- 编辑器选择高亮使用 Notion 蓝 (#2383e2)，是界面中唯一固定的彩色锚点。

## 2. Colors

鹅的笔记以中性色为基底，依靠明度差异构建层次；唯一的 UI 强调色是鸢尾靛蓝。AI 区域是唯一的多彩例外。

### Primary
- **Iris Indigo** (#6366f1 / hsl 239 84% 67%): 主色调，用于主按钮填充、开关 ON、focus 指示。激活导航/选中项用浅底 #e0e7ff + 强调文字 #4f46e5，图标徽章底 #eef2ff；暗色对应：填充 #6366f1、强调文字 #a5b4fc、浅底 rgba(99,102,241,0.20)、徽章底 rgba(99,102,241,0.14)。克制、单一色相，让内容本身成为焦点。

### Secondary
- *(无独立 secondary accent。层次由明度差异承担)*

### Tertiary
- *(无独立 tertiary accent)*

### Neutral
- **Warm Shell** (#f7f7f7 / 暗色 #202020): 应用壳层背景，侧边栏底色。比纯白暖一点，像宣纸的米白。暗色变为深石墨。
- **Pure Paper** (#ffffff / 暗色 #2e2e2c): 编辑器主画布，内容区。始终纯白（亮色模式），提供最高对比度的阅读面。暗色是暖深灰，像傍晚灯光下的纸。
- **Selected Parchment** (#f1f1ef / 暗色 #2a2a28): 选中/悬停状态背景，暖灰带微黄相。列表项 hover、菜单高亮、次级按钮底色。暗色保持暖调。
- **Ink** (#1e1e1e / 暗色 #e5e5e5): 前景文字，近黑但不纯黑。带 0.005 chroma 的暖色 tint。暗色反转为暖白。
- **Faded Ink** (#6d6d6d / 暗色 #a8a8a8): 辅助文字、占位符、图标默认色。Muted foreground。暗色亮度提升以保可读性。
- **Hairline** (#dbdbdb / 暗色 #3d3d3d): 分割线、输入框 inset shadow、表框。几乎不可见。
- **Alert Red** (#ee4444 / 暗色 #7f1d1d): 破坏性操作、错误提示。仅用于需要立即注意的反馈。暗色饱和度降低避免刺眼。
- **Notion Blue** (#2383e2): 编辑器内文本选择高亮（28% 透明度亮色 / 40% 暗色）。不用于 UI 元素，专属于编辑体验。唯一不随模式改变色相的颜色。

### AI Signature Colors
- **AI Teal** (#58d7b8) to **AI Amber** (#ffb56a): 仅用于 AI 相关区域（LingCai 卡片、流式加载指示器、AI 工作区）。彩虹渐变从青绿到紫到粉到橙，是冷静界面中唯一的情绪出口。

### Named Rules

**The One Color Rule.** 任何非 AI 区域，屏幕上同时出现的彩色应只有鸢尾靛蓝一种色相。灰色是默认，白色是画布，黑色是文字，靛蓝只承担强调角色（主按钮、开关 ON、激活项、focus）。AI 区域的多彩是刻意打破规则的信号——它告诉用户"这里发生了不同的事"。

**The Warmth-Not-Color Rule.** 层次由明度和极微的暖色 tint 区分，不是由色相。goose-selected-bg 比 shell-bg 暗 3%，暖 6°，这个差异几乎无法被有意识察觉，但手指能"感觉"到。

**The Notion Blue Reservation Rule.** #2383e2 仅用于编辑器文本选择高亮和 BlockNote 相关交互。禁止用于按钮、链接、图标或任何 UI chrome。

## 3. Typography

**Display/Title Font:** DM Sans + HarmonyOS Sans SC（系统 fallback）
**Body Font:** 同上
**Serif/阅读 Font:** 仓耳今楷 + Georgia/Cambria
**Mono Font:** DM Mono + HarmonyOS Sans SC

**Character:** DM Sans 的现代几何骨架提供清晰的功能性，HarmonyOS Sans SC 确保中文排版的中性专业感。仓耳今楷作为可选衬线字体，为长文阅读注入书法的人文温度——像是手写在宣纸上的批注。三套字体在用户设置中自由切换，UI 始终跟随。

### Hierarchy
- **Title** (600, 1.5rem/24px, line-height 1.25, tracking -0.01em): 对话框标题、设置页头部、AI 面板标题。紧凑有力，不喧宾夺主。
- **Body** (400, 16px, line-height 1.7, tracking 0.01em): 编辑器正文、笔记内容、列表项。65–75ch 的最大行宽。这是整个系统的核心——所有其他层级都服务于让正文可读。
- **Label** (500, 12px, line-height 1.4, tracking 0.02em): 按钮文字、小标签、辅助说明、时间戳。稍宽的字距让短文本在小型尺寸下保持清晰。
- **Serif Body** (400, 16px, line-height 1.7): 当用户选择衬线模式时，编辑器正文切换为仓耳今楷。 Georgia 作为 fallback，确保在任何系统上都有可读的衬线回退。
- **Mono Body** (400, 14px, line-height 1.6): 代码块、行内代码。DM Mono 的字宽和标点设计适合代码阅读。

### Named Rules

**The Editor-First Rule.** 正文 (Body) 的样式是系统的锚点。所有其他层级的尺寸和字重选择都基于"不干扰正文阅读"这一原则。对话框标题再大也不超过 24px。

**The No-Bold-Without-Reason Rule.** 加粗 (600+) 仅用于标题层级和极少数强调。正文不使用 bold 做强调——依靠字色对比和留白替代。

## 4. Elevation

几乎扁平，投影只是耳语。深度不是靠元素"浮起来"，而是靠颜色的冷暖层叠。鹅的笔记的层级系统更像纸张堆叠：不同明度的纸叠在一起，最上面的纸（编辑器）最白最亮，下面的纸（侧边栏/壳层）略暖略暗。

投影只在需要暗示"这个动作会产生结果"时出现——按钮 hover、卡片浮现、对话框弹出。即使是这些时刻，投影也保持克制：统一的 slate 色系，小半径，低透明度。

### Shadow Vocabulary
- **Ambient** (`box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04)`): 卡片默认状态。存在感极低，只是让卡片从背景中轻微分离。
- **Lifted** (`box-shadow: 0 16px 36px rgba(15, 23, 42, 0.16), 0 2px 8px rgba(15, 23, 42, 0.08)`): 对话框、模态框。表示"这是一层新的空间"。
- **Button Press** (`box-shadow: 0 6px 14px rgba(15, 23, 42, 0.12)`): 主按钮默认状态。暗示可点击性，但不夸张。
- **Workspace Frame** (`box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.03), 0 0 8px rgba(15, 23, 42, 0.05)`): 编辑器主工作区的外框。1px 的 hairline 外描边 + 极微弱的弥散投影，定义了"这是内容区"的边界。
- **Inset Border** (`box-shadow: inset 0 0 0 1px hsl(var(--input) / 0.8)`): 输入框的边框。不用真 border，用 inset shadow 模拟压痕感。hover/focus 时 shadow 加深或变色。
- **Dark Ambient** (`box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.05), 0 0 12px rgba(0, 0, 0, 0.32)`): 暗色模式下的 Workspace Frame。暗色模式下投影反而更明显，因为需要对抗纯黑背景的吞噬感。

### Named Rules

**The Flat-By-Default Rule.** 表面在静止时是平的。投影只作为响应出现：hover、elevation、focus。如果一个元素不需要用户操作，它就不应该有投影。

**The Slate-Only Rule.** 所有投影的颜色基准统一为 slate (rgba(15, 23, 42)) 或暗色反色 (rgba(255,255,255,0.05))。禁止彩色投影、暖色投影、或任何带色相的阴影。

## 5. Components

整体性格：软陶质感。元素边缘圆润、无锋利感，像可以被捏动的软泥块。

### Buttons
- **Shape:** 温和圆角 (10px radius)，内边距紧凑 (10px 纵向，16px 横向)。
- **Primary:** 鸢尾靛蓝填充 (#6366f1)，白色文字。默认状态带 Button Press 投影。Hover 时背景色轻微加深 (bg-primary/90)。
- **Outline:** 透明填充，用 Inset Border 模拟细边框。Hover 时背景转为 Selected Parchment。
- **Ghost:** 完全透明，无投影。Hover 时同 Outline。
- **Secondary:** Selected Parchment 底色，带更弱的 inset border。用于非主要操作。
- **Focus:** 全局无 focus ring。Focus 状态通过颜色变化表示（按钮 hover 色即 focus 色）。
- **Disabled:** opacity-50，pointer-events-none。

### Inputs / Fields
- **Style:** 圆角 10px，透明边框，用 Inset Border 创造压痕感。背景同 Shell。
- **Focus:** ring-2 ring-ring (鸢尾靛蓝 focus 指示)，ring-offset-1。这是极少数使用 ring 的场景。
- **Placeholder:** Faded Ink 色。
- **Disabled:** cursor-not-allowed，opacity-50。

### Cards / Containers
- **Corner Style:** 较大圆角 (14px)，让卡片感觉友好、无威胁。
- **Background:** Pure Paper (#ffffff)。
- **Border:** 无。卡片不靠边框定义边界，靠 Ambient 投影和背景色差异。
- **Internal Padding:** 24px 统一内边距。

### Dialogs / Modals
- **Overlay:** 黑色 30% 透明度 + 2px backdrop blur。足够暗以聚焦注意力，但不至于完全隔绝上下文。
- **Container:** 圆角 14px，Lifted 投影，背景 Shell。居中定位，最大宽度 512px。
- **Animation:** 200ms 缩放+淡入 (zoom-in-95, fade-in)，ease-out。

### Navigation / Sidebar
- **Style:** 无 border，无 shadow。背景 Shell。项目之间靠 1px hairline 分隔。
- **Hover:** 背景变为 Selected Parchment，文字保持 Ink。
- **Active/Selected:** 同 Hover 色，无额外指示器（无左侧彩条、无 bold、无 icon 变色）。选中和 hover 的视觉差异极小，靠上下文推断。
- **Divider:** 1px hairline (#dbdbdb / 暗色 #3d3d3d)，opacity 极低。

### Scrollbars
- **全局隐藏**（除编辑器和页面滚动容器外）。
- **编辑器内:** 6px 宽，透明 track，hover 时显示 15% 透明度的 thumb。暗色模式反色。

### BlockNote Editor Blocks
编辑器块级组件是鹅的笔记的视觉核心。所有块样式服务于"内容即界面"的原则——块本身不装饰，只通过微妙的边界和背景暗示其语义角色。

- **Callout:** `rounded-md` (6px)，`border border-border/60`，`bg-muted/40`，左侧 emoji 图标 + 正文行内内容。像一张贴在页面边缘的淡色便利贴，不抢正文风头。
- **Code Block:** `rounded-lg` (8px) 外层 + `rounded-xl` (12px) 代码节点内层，monospace 字体 (DM Mono)。深色背景在暗色模式下更暗。边框使用 `workspace-divider`（比 hairline 更隐晦）。顶部有语言选择和复制工具栏。
- **Table:** 单元格 `border border-border/50`，表头 `bg-muted/40`，内边距 `py-2 px-3`（`8px 12px`）。无斑马纹，无 hover 高亮——表格是数据的容器，不是交互对象。
- **Image / Video:** `rounded-md` (6px)，`max-width: 100%`。视频有原生 controls。图像无圆角阴影或边框装饰。
- **Details / Toggle List:** `rounded-lg border border-border/40`，summary 行可点击，左侧 ▶ arrow，`rotate-90` 动画展开。内容区 `border-t border-border/20 bg-muted/5`。
- **Blockquote:** `border-l-2 border-border/60 pl-3 text-muted-foreground`。左侧 2px 竖线引用标记，无额外背景或斜体——克制到近乎隐形。
- **Divider (HR):** `border-border/40`，1px 水平线。编辑器和 AI markdown 中统一。
- **Inline Code:** `rounded` (4px)，`bg-muted/30 border border-transparent hover:border-border`，monospace 字号 0.85em，padding `1px 4px`。深色模式下反转为 `bg-[hsl(220,6%,18%)] text-[hsl(220,6%,88%)]`。
- **Inline Math (KaTeX):** 同 inline code 基础样式，额外 `inline-flex align-middle vertical-align: middle`。
- **Link:** `text-foreground underline underline-offset-2 opacity-80 hover:opacity-100`。无颜色变化，仅靠下划线和不透明度变化标识可点击性。
- **Heading (H1–H3):** H1 首元素 `margin-top: 0`（紧邻编辑器顶部时）。行高紧凑 (1.3–1.4)，字重 600。无额外装饰线或背景。
- **Bullet / Ordered List:** `list-disc pl-5 space-y-0.5` / `list-decimal pl-5 space-y-0.5`。列表标记是标准浏览器默认，无自定义图标。
- **Editor Side Menu (Drag Handle):** 块左侧，`h-6 w-6 rounded-md text-muted-foreground/70 hover:bg-muted hover:text-foreground`。仅在 hover 块时出现，平时完全隐形。
- **Formatting Toolbar:** `rounded-[10px] border border-border/75 bg-popover p-1`，shadow 同 Card Ambient 但更弱。深色模式 border 变为 `white/15`，背景 `#2f3437`。
- **Slash Command Menu:** `rounded-[18px]` 大圆角菜单，`rounded-[12px]` 菜单项，`rounded-[10px]` 图标容器。这是编辑器中圆角最大的 UI 元素，暗示其"浮层"身份。

### AI Signature Card (LingCai)
- **Background:** 彩色模糊渐变（青绿→蓝→紫→粉→橙）+ 毛玻璃覆盖层 (backdrop-filter: blur(14px))。
- **Icon:** 径向渐变光晕 + 白色/暗色渐变覆盖。
- **Text:** 彩虹渐变文字 (background-clip: text)。
- **Animation:** 28s 循环 pan + 24s orb 浮动。支持 prefers-reduced-motion。

## 6. Do's and Don'ts

### Do:
- **Do** 保持大面积留白。侧边栏、编辑器、对话框之间留出呼吸空间。
- **Do** 使用暖调中性灰（带 60° hue tint）作为一切非内容区域的底色。
- **Do** 让编辑器区域始终是最白的表面，形成自然的阅读焦点。
- **Do** 在需要用户操作的元素上使用 10px 圆角和轻微投影。
- **Do** 用 inset shadow 替代 input 和 outline 按钮的真边框，保持表面的连续性。
- **Do** 为 AI 区域保留彩虹渐变的"特权"——它是系统中唯一允许多彩的地方。
- **Do** 使用 prefers-reduced-motion 为所有 AI 动画提供降级。
- **Do** 确保暗色模式不是"反色"，而是同一空间的傍晚版本：壳色变深、纸色变暗、文字变亮，但空间关系不变。

### Don't:
- **Don't** 使用 border-left 或 border-right 大于 1px 的彩色条纹作为列表项、卡片或提示的 accent。这是被明确禁止的 anti-pattern。
- **Don't** 使用 gradient text 作为 UI 元素的装饰。唯一允许的 gradient text 是 AI 区域的 LingCai 品牌文字。
- **Don't** 使用 glassmorphism 作为默认卡片样式。毛玻璃仅用于 AI 卡片。
- **Don't** 使用 hero-metric 模板（大数字+小标签+支持数据+渐变 accent）。这不是仪表盘。
- **Don't** 创建相同大小的 icon + heading + text 卡片网格并重复。笔记应用的内容区不是功能展示墙。
- **Don't** 将模态框作为第一选择。优先使用 inline、渐进式的交互替代方案。
- **Don't** 在按钮或 UI chrome 上使用 Notion Blue (#2383e2)。它是编辑器选择的专属颜色。
- **Don't** 使用纯黑 (#000000) 或纯白 (#ffffff) 作为任何元素的颜色。即使前景色接近黑，也使用带暖 tint 的 Ink (#1e1e1e)。
- **Don't** 做 Notion 全功能克隆的视觉风格。学习 Notion 的克制和留白，但不复制它的具体色彩值和组件形状。
- **Don't** 做 Web-first SaaS 布局。这是 uTools 插件，界面应感觉像原生桌面应用的一部分。
