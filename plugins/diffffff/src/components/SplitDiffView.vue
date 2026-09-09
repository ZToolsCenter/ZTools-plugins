<!--
  SplitDiffView（UI-006）：并排（split）diff 结果视图。

  ┌─ 数据管道（script 区 computed，纯派生：不改 store、不改引擎产物）──────────
  │ diffStore.result.rows（compareFull 产出的行级骨架；ok:true 由 App 层保证）
  │   → rowsWithPairing(rows)     相似行配对（ENG-005）：替换区域内相似度达标
  │                               的 del/add 合并为自带词级 spans 的 modify 行
  │   → renderRows                精度覆盖：line → spans 全部视为无；
  │                               smart/word → 配对自带词级 spans 原样消费；
  │                               char → 逐 modify 行 computeSpans('char') 重投影
  │   → rows（视图模型）          模板直渲染的 SplitRowVm[]（与 renderRows
  │                               同序同长，displayVms 按下标 zip）
  │   → displayVms                折叠感知的渲染序列（UI-008）：useCollapse
  │                               剔除未更改区段并插入折叠条（见下方
  │                               「折叠未更改行」一节与 useCollapse.ts）
  │   → visibleVms                虚拟滚动切片（UI-009）：displayVms 的
  │                               [range.start, range.end) 子序列，模板
  │                               直渲染（上下 spacer 补齐等价高度）
  └────────────────────────────────────────────────────────────────────────────

  折叠未更改行（UI-008，useCollapse 共享 composable 的并排视图接入）：
  - 开关 viewStore.showCollapsed（工具栏「折叠未变更」）开启时，result.collapses
    （ENG-008 只折叠 hunk 之间的未更改行）驱动视图渲染折叠条「⋯ 展开未更改的
    N 行」（真实 button，点击展开该区段），被折叠的行从渲染序列剔除但仍留在
    rows 中（契约：折叠只是投影视图）；
  - 下标空间翻译（本组件特有）：result.collapses 的 beforeRow 基于 result.rows，
    而本组件渲染序列经 rowsWithPairing 合并（del+add → modify，序列变短），
    两者下标不一致 —— pairedCollapses computed 把每个折叠区段翻译到配对序列
    的下标空间（依据：折叠区段恒为连续 equal 行、配对 1:1 保留 count 不变；
    beforeRow 处原行按其存在侧 lineNo 在配对序列中唯一定位，详见其 JSDoc）；
  - 展开态为纯 UI 态（useCollapse 内部 ref）：diff 重跑 / 输入变化（rows /
    collapses 引用变化）时整体重置；精度切换不改序列下标，不重置。「全部展开」
    入口经 defineExpose 暴露给主区右上工具条（UI-017，App.vue 接线；视图内
    不再维护 sticky 条带）。

  渲染结构选型（单一滚动容器 + CSS grid 行模型，对比「双 pane + JS scroll-sync」）：
  - 双 pane 方案需要监听两侧 scroll 事件互写 scrollTop，行高稍有出入就累积错位
    （还要 rAF 节流 / 回弹补偿）；本组件整表只有一个滚动容器，左右同步滚动由
    共享滚动容器天然达成（同一 scrollTop），「按行高对齐」由 grid 行轨道模型
    结构化保证 —— 每行 6 个单元格（左行号 / 左记号 / 左内容 / 右行号 / 右记号 /
    右内容）共享同一条隐式行轨道，行高 = 该行最高单元格，左右严格等高，
    零滚动同步代码、零错位风险；
  - 行分组容器 .diff-row 使用 display: contents（UI-007 起为两视图公共类，
    定义见 main.css）：行盒子自身不参与布局（6 个
    单元格直接落入外层 .split-grid 的列轨道），但保留 DOM 分组 —— v-for key、
    行级 class（is-* / is-long-line）挂载点，以及虚拟滚动（UI-009，已接入）
    的天然行切分单元；
  - 横向滚动选型（任务给定两选项二选一）：每侧内容单元格各自 overflow-x:auto，
    内容列恒为 minmax(0, 1fr)（网格宽度恒等于容器宽度）。理由：若选「整行 grid
    横向滚动」，内容列必须按 max-content 计宽，任一侧一行超长都会把整个网格
    撑宽数万 px、把另一侧内容推出视野；逐单元格滚动下超长行只在自己格里横向
    滚动，两侧起点与行号恒可见。行高恒定修正（UI-009 虚拟滚动前置保证）：
    内容格的经典滚动条会把该行撑到 20+8=28px，已隐藏内容格自身滚动条
    （scrollbar-width: none + webkit 兜底，见 main.css .diff-content）——
    滚动能力保留、行高恒为 --diff-line-height，可见的横向滚动指示归 UI-015；
  - 行号列 sticky（任务要求）：本模型下网格本体不产生横向滚动（横向滚动发生在
    内容单元格内部），行号 / 记号列天然恒定可见；仍声明 position:sticky + left
    偏移作为防御 —— 未来若引入网格级横向滚动，左组（行号+记号）仍钉在 0、
    右组钉在左组宽度之后。

  虚拟滚动（UI-009，src/composables/virtual.ts 的轻量自研窗口切片）：
  - 渲染单元策略 A（任务给定二选一）：row 项与折叠条统一按 rowHeight（20px，
    = --diff-line-height）编号计高 —— 折叠条视觉高度经 main.css 微调后与行高
    严格一致（line-height = 行高 − 上下虚线边 2px），统一编号是精确模型；
  - 渲染结构：滚动容器内 = 顶部 spacer（range.offsetTop 高，.diff-vspacer
    横跨全部列）+ displayVms 的 [range.start, range.end) 切片 + 底部 spacer
    （剩余高度）。三段恒满足 spacer + 切片×行高 + spacer = totalHeight，
    网格总高与滚动位置无关（滚动条 / 锚定不抖动）；
  - 换行模式直通：wrapLongLines=true 时行高不均（1~4 行不等），等行高模型
    失效，enabled=false 让 range 覆盖全量（spacer 恒 0、全量渲染，行为与
    UI-008 时代一致）。决策理由（任务指定记录）：逐行测量 + 前缀和的复杂度
    与收益不成比例；换行是明读场景，大 diff + 换行组合已有 ENG-011 输入上限
    与 longLine 截断兜底；
- 滚动性能：容器 scroll（passive）由 useVirtualRows 内部监听，rAF 合帧
    （同帧多次滚动合并为一次 range 写入）；展开 / 收起改变 displayVms 长度
    → itemCount watch 同步重算，不做滚动位置锚定（视口上方展开时内容下移，
    简单策略，见 virtual.ts 文件头）；
  - 已知近似（可接受）：「全部展开」工具条已随 UI-017 迁至主区右上工具栏
    （App.vue 经本组件 defineExpose 暴露的 expandAll / isAnyCollapsed 接线），
    滚动内容内不再有 sticky 条带 —— 原「~33px 常量偏移」的已知近似随之消除
    （overscan=10 仍兜底虚拟窗口边界）。滚动容器声明 overflow-anchor: none
    禁用浏览器滚动锚定（spacer 高度变化不需要锚定补偿，总高恒定，见 scoped
    样式）。

  行类型渲染（type 语义见 core/types.ts 的 DiffRow；并排约定：left / right
  至少一侧存在，modify = 相似行配对行）：
  - equal：左右行号 + 文本，无底色无记号；
  - del（未配对）：左侧行号 + 「−」记号 + 红底（--diff-del-bg / --diff-del-text），
    右侧空占位（保持 grid 对齐）；
  - add（未配对）：右侧行号 + 「+」记号 + 绿底（--diff-add-bg / --diff-add-text），
    左侧空占位；
  - modify：左右都有内容，各自取 del / add 底色与记号，行号各取 left.lineNo /
    right.lineNo（配对约定：左行号来自原 del 行、右行号来自原 add 行）。

  行内词级高亮：spans 按序渲染，拼接恒等于该侧 text（WordDiffSpan 契约）；
  changed 片段加词级底色（左 --diff-del-word-bg / 右 --diff-add-word-bg），
  未变更片段透明（透出行底色）。精度 → spans 的映射细节见 renderRows 注释。

  语法高亮（INT-001）：生效语言取 viewStore.effectiveLanguage（auto →
  detectLanguagePair 检测结果，plaintext → 不渲染）。解析只对可视切片行做
  （visibleVms 处调用 highlightLineSpans，LRU 缓存兜底滚动回看）；与词级
  diff 高亮的共存规则 —— 词级优先：行内有词级 spans 时按两者边界切分叠加
  （mergeWordSyntax），changed 片段类名并列挂 'word-changed'（背景）与
  tok-*（文字色），无词级 spans 的行直接语法 spans；拼接恒等式在两种形态
  下都保持。逐行解析的局限（跨行注释 / 模板串漏色）见 highlight.ts 文件头。

  长行（row.longLine，ENG-012 标记 >1 万字符）策略 —— 本任务先保证不撑爆布局：
  - 非换行（white-space: pre）：行高恒为单行，超长只在内容单元格内横向滚动
    （10k 字符 ≈ 数万 px 的滚动宽度在浏览器能力内），内容完整可达，不截断；
  - 换行（pre-wrap）：内容格统一 overflow-wrap: anywhere（按需逐字符断行，
    压缩行 / 长 URL 这类无空格巨型 token 也撑不破 minmax(0,1fr) 列宽）；长行
    单元格再叠加 max-height（4 行）+ overflow hidden 截断，右下角放「展开」
    提示样式占位（非交互，完整截断 / 展开交互归 UI-015/009）。

  空行渲染：内容单元格 min-height: var(--diff-line-height) —— 文本为空的
  del / add / equal 行保留一行底色高度，不可塌陷。

  性能注记：非换行模式虚拟化渲染（UI-009）—— DOM 行数 = 可视窗口行数 +
  2×overscan（默认 10），与总行数无关；换行模式直通全量渲染（决策见上方
  「虚拟滚动」一节与 virtual.ts 文件头），输入侧已有 ENG-011 大文本防护
  （5MB / 10 万行）兜底。配对与行内 spans 的成本随结果一次性付出（computed
  缓存，滚动交互不重算）；折叠展开每次点击触发一次 displayItems 的 O(n) 重算
  （UI-008，见 useCollapse.ts 性能注记）与一次 range 同步重算（UI-009）。

  hunk 导航接入（UI-010，与 UnifiedDiffView 对等的并排视图侧实现）：
  - 导航态真源在 stores/nav.ts（currentIndex 基于 result.hunks 下标，键盘
    F3/Shift+F3 与统计条按钮共用其 goNext/goPrev 出口）；navStore.currentAnchor
    是当前 hunk 在【result.rows 原始下标空间】的 {start,end} 闭区间，而本
    视图渲染序列经 rowsWithPairing 合并（del+add → modify，序列变短），
    两端点必须先经 nav.ts 的 translateAnchorToPaired 翻译到配对序列的下标
    空间（currentPairedAnchor computed；翻译依据的不变量与防御策略见该函数
    JSDoc 与 tests/ui/nav.test.ts，与 UI-008 的 pairedCollapses 同族翻译）；
    统一视图行序列同原始空间、无需翻译（见其组件头）；
  - 当前 hunk 高亮：配对下标落在翻译后区间内的行挂 is-current-hunk class，
    gutter / 记号列底色切为 --diff-hunk-bg（视觉决策见 main.css 的
    .is-current-hunk 注释）；未定位（锚点为 null 或翻译失败 -1）不高亮；
  - 滚动定位：watch navStore.seq（导航动作序号 —— 单 hunk 回绕时 currentIndex
    同值不变，watch seq 才能感知「重复定位同一 hunk」的跳回诉求），经
    nextTick 后 scrollToRow(翻译后 start)。切换视图时本组件重挂载，immediate
    watch 在挂载后立即定位，跨视图共享当前位置由此达成（与 defineExpose +
    App 调用方案相比，省去 App 侧 ref 转发且天然覆盖「切视图回显」场景）；
  - 滚动目标 = 行在渲染序列（displayVms：显示行 / 折叠条 / 合并控制条交错）
    中的单元下标 —— scrollIndexByRowIndex computed 从合并感知的 displayVms
    建立「配对行下标 → 单元下标」映射（row 项 vm.index 即配对下标，控制条
    的插入偏移天然计入）；
  - 滚动量：首选 DOM 量测（目标行已渲染时按 getBoundingClientRect 真实盒位
    滚动 —— 精确，且天然规避「全部展开」工具条的 ~33px 常量偏移与换行模式
    行高不均）；目标行未渲染（虚拟窗口外）时回退等行高公式
    scrollTop = 单元下标 × DIFF_ROW_HEIGHT（顶部 spacer 已由虚拟模型给出，
    scrollTop 即内容坐标；非换行模式所有单元严格等高，公式精确）。

  结果态编辑入口（已撤除）：原 UI-011 的「行内容格点击 emit editSide 进入
  保留编辑态」已随 App.vue 的状态机简化（回编辑统一走主按钮「重新编辑」）
  一并移除 —— 内容格（含空占位格）现为纯展示，不挂点击事件；拖拽选中文本
  复制等阅读行为不受影响。

  合并更改控制条（UI-012）：每个 hunk 的首行前渲染一条「合并控制条」，提供
  「⇤ 应用到左侧」（right-to-left）与「应用到右侧 ⇥」（left-to-right）两个
  小按钮，点击 emit applyHunk: [hunkIndex, direction]（App.vue 监听后调
  core/merge.ts 的 applyHunk 更新两侧文本并重算）：
  - hunk 定位复用 UI-010 的机制：先经 hunkAnchorRows（ENG-009）把每个 hunk
    定位到 result.rows 原始下标空间的起始行，再经 nav.ts 的
    translateAnchorToPaired 翻译到本视图的配对序列下标空间（复用而非重写，
    翻译依据的不变量见该函数 JSDoc，与 pairedCollapses 同族翻译）；
  - 控制条横跨全部 6 列（.diff-merge-bar，公共样式见 main.css），高度与行
    严格等高（--diff-line-height），作为虚拟滚动（UI-009）的等高渲染单元
    计入 displayVms —— scrollIndexByRowIndex 因此改从合并感知的 displayVms
    建立映射（单元下标含控制条偏移）；
  - 定位失败（hunkAnchorRows 尽力定位 / 配对翻译返回 -1）时跳过该 hunk 的
    控制条并 console.debug，不中断渲染（与折叠条 / 头条的防御策略一致）；
    result 为 null / ok:false 时 computed 返回空映射，控制条不渲染。

  不在本组件范围：合并应用本身
  （UI-012 引擎纯函数在 core/merge.ts，applyHunk 事件接线在 App.vue）、
  可见的横向滚动指示打磨（UI-015）。hunk 导航与当前 hunk 高亮（UI-010）已
  接入（见上方专节），统计条与导航按钮 / F3 快捷键在 App.vue（导航态真源
  stores/nav.ts，两视图只读消费）。折叠未更改行（UI-008）已接入（见上方
  专节），折叠条 / 合并控制条 / 全部展开工具条 / 当前 hunk 高亮的公共样式
  在 main.css（与 UnifiedDiffView 共用）。统一视图（UI-007，UnifiedDiffView）
  与本组件共用 main.css 的 .diff-* 行模型公共类（行号 / 记号 / 内容列、
  色调、换行与长行截断策略），组件内只保留并排专属的 6 列网格布局与行内
  词级高亮。
-->
<script setup lang="ts">
/**
 * 组件实例层：数据管道（result.rows → 配对 → 精度覆盖 → 视图模型）与模板。
 * 颜色一律消费 main.css 的 --diff-* token 与 ztools-ui 宿主变量，无硬编码色值。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { isDiffOk } from '../core/types'
import type { CollapseRange, DiffRow, DiffRowSide, DiffRowType } from '../core/types'
import { computeSpans } from '../core/inline'
import { alignRowsByLineNo, zipUnpairedRows } from '../core/align'
import { rowsWithPairing } from '../core/pairing'
import { highlightLineSpans, mergeWordSyntax } from '../core/highlight'
import type { SyntaxSpan } from '../core/highlight'
import { useCollapse } from '../composables/useCollapse'
import { DIFF_ROW_HEIGHT, useVirtualRows } from '../composables/virtual'
import { diffStore } from '../stores/diff'
import { hunkAnchorRows } from '../core/stats'
import type { MergeDirection } from '../core/merge'
import { navStore, translateAnchorToPaired } from '../stores/nav'
import type { RowAnchor } from '../stores/nav'
import { viewStore } from '../stores/view'

/* -------------------------------------------------------------------------- */
/* 数据管道                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 管道第一步：相似行配对（ENG-005 数据层，与精度无关）。
 *
 * result.rows 是行级骨架（compareFull 产出，只有 equal / del / add，无 modify、
 * 无 words）—— 经 rowsWithPairing 把替换区域中相似度达标（默认阈值 0.5）的
 * del / add 行合并为自带词级 spans 的 modify 行，得到「并排语义」的行序列。
 * 本组件只在 result 存在且 ok:true 时被 App 渲染，此处兜底返回空数组
 * （防御性：状态竞态下不渲染任何行）。
 */
const alignedRows = computed<DiffRow[]>(() => {
  const result = diffStore.result
  if (result === null) return []
  if (!isDiffOk(result)) return []
  return alignRowsByLineNo(result.rows)
})

const pairedRows = computed<DiffRow[]>(() => {
  return rowsWithPairing(alignedRows.value)
})

const zippedRows = computed<DiffRow[]>(() => {
  return zipUnpairedRows(pairedRows.value)
})

/**
 * 管道第二步：精度 → 行内 spans 的映射（UI-006 定稿口径）：
 *
 * - `'line'`：行级精度不显示任何行内高亮 —— 配对出的 modify 行保留（左右
 *   对齐属于结构层），但所有 spans 在渲染层整体视为无；
 * - `'smart'` / `'word'`：直接消费 rowsWithPairing 为 modify 行计算的词级
 *   spans（引擎产物原样只读，不拷贝不修改）；
 * - `'char'`：配对层只会算词级 spans，字符级需对每个 modify 行重新
 *   `computeSpans(left.text, right.text, 'char', options)` 覆盖 words 字段。
 *   options 取 diffStore.lastOptions —— run() 落下的「本次结果实际生效选项」
 *   快照。行内 spans 必须与产生 result 的比较口径一致：选项改了但尚未重跑时
 *   viewStore.diffOptions 与 lastOptions 可能不同，取后者才不会出现
 *   「骨架按旧选项、高亮按新选项」的口径撕裂。
 *
 * 不可变性：rowsWithPairing 已是不可变产出，这里仍逐行新建行对象与 side
 * 对象、spans 为全新数组 —— 与引擎产物零共享（引擎结果只读约定的延续），
 * 重投影不会污染上游数据（hunk.rows 与 result.rows 共享行对象引用）。
 */
const renderRows = computed<DiffRow[]>(() => {
  const precision = viewStore.precision
  if (precision === 'char') {
    const options = diffStore.lastOptions
    return zippedRows.value.map((row) => {
      if (row.type !== 'modify' || row.alignOnly === true || row.left === undefined || row.right === undefined) {
        return row
      }
      const spans = computeSpans(row.left.text, row.right.text, 'char', options)
      return {
        ...row,
        left: { ...row.left, words: spans.left },
        right: { ...row.right, words: spans.right },
      }
    })
  }
  // 'line'（渲染层统一短路 spans，见 rows 的 showSpans）/ 'smart' / 'word'
  // （用配对自带的词级 spans）：三者行序列相同，差异只在渲染侧。
  return zippedRows.value
})

/**
 * 折叠区段的下标空间翻译（UI-008）：result.collapses 的 beforeRow 基于
 * result.rows（引擎完整序列），而本组件的渲染序列经 rowsWithPairing 合并
 * （配对的 del+add 合并为一条 modify 行，序列变短），两者下标不一致，必须
 * 先翻译到配对序列的下标空间再交给 useCollapse（composable 的前置条件：
 * rows 与 collapses 同一下标空间，见 useCollapse.ts 文件头）。
 *
 * 翻译依据的两个不变量（ENG-005 / ENG-008 的结构保证）：
 * 1. 折叠区段 [beforeRow - count, beforeRow) 恒为连续 equal 行（buildHunks
 *    只折叠 hunk 之间的未更改行），equal 行在配对中原位 1:1 保留 → count
 *    在配对序列中不变，只需平移 beforeRow；
 * 2. 任一侧的 lineNo 在整个序列中唯一 —— 旧文件的每一行恰好成为某一行
 *    （equal / del / modify）的 left 一次，新文件同理于 right（rowsWithPairing
 *    1:1 保留全部 side，modify 的 left/right 分别取自原 del / add 行）。
 *    故 beforeRow 处的原行可按其存在侧 lineNo 在配对序列中唯一定位
 *    （定位到的可能是 modify 行：del 被配对时其镜像就是该 modify）。
 *
 * 快路径：配对未合并任何行（paired.length === original.length，纯增删 diff
 * 的常见形态）时两个下标空间相同，直接原样返回。
 * 防御：lineNo 定位失败（契约上不可达）时丢弃该折叠条并 console.debug，
 * 不中断渲染；beforeRow 越界时钳制到序列尾。
 */
const pairedCollapses = computed<CollapseRange[]>(() => {
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return []
  const original = result.rows
  const paired = zippedRows.value
  if (paired.length === original.length) return result.collapses

  // lineNo → 配对序列下标（左右各一张；唯一性不变量见上，重复时后写覆盖
  // 仅作防御，不影响正确性）。
  const leftIndexByLineNo = new Map<number, number>()
  const rightIndexByLineNo = new Map<number, number>()
  paired.forEach((row, index) => {
    if (row.left !== undefined) leftIndexByLineNo.set(row.left.lineNo, index)
    if (row.right !== undefined) rightIndexByLineNo.set(row.right.lineNo, index)
  })

  const translated: CollapseRange[] = []
  for (const range of result.collapses) {
    let beforeRow: number | undefined
    if (range.beforeRow >= original.length) {
      beforeRow = paired.length
    } else {
      const anchor = original[range.beforeRow]
      if (anchor.left !== undefined) {
        beforeRow = leftIndexByLineNo.get(anchor.left.lineNo)
      } else if (anchor.right !== undefined) {
        beforeRow = rightIndexByLineNo.get(anchor.right.lineNo)
      }
    }
    if (beforeRow === undefined) {
      console.debug('[SplitDiffView] 折叠区段在配对序列中定位失败，丢弃该折叠条：', range)
      continue
    }
    translated.push({ beforeRow, count: range.count })
  }
  return translated
})

/**
 * 当前导航 hunk 的锚点（UI-010）：navStore.currentAnchor 基于 result.rows
 * 原始下标空间（hunkAnchorRows 契约），本视图渲染序列经 rowsWithPairing
 * 合并（序列变短），须先经 translateAnchorToPaired 翻译到配对序列下标空间
 * （高亮区间与滚动定位都在本视图自己的下标体系上做）。null（未定位）或
 * 翻译失败（-1）时返回 null —— 恒不高亮、不滚动（与统一视图对 null 的
 * 处理一致）。
 */
const currentPairedAnchor = computed<RowAnchor | null>(() => {
  const anchor = navStore.currentAnchor
  if (anchor === null) return null
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return null
  const translated = translateAnchorToPaired(anchor, result.rows, zippedRows.value)
  return translated.start < 0 ? null : translated
})

/**
 * 合并控制条的插入位置（UI-012）：配对序列下标 → hunk 下标（result.hunks
 * 的 0-based 下标，随 applyHunk 事件原样上抛）。定位链复用 UI-010 机制 ——
 * hunkAnchorRows 把 hunk 定位到 result.rows 原始空间（主路径为行对象引用
 * 精确匹配，ENG-008 保证 hunk.rows 是 rows 的连续切片），再经
 * translateAnchorToPaired 翻译到配对序列空间（{start,end} 折叠为同一端点，
 * 翻译依据与防御策略见该函数 JSDoc）；同端点多 hunk（契约上不可达）时取
 * 首个。result 为 null / ok:false 时返回空映射 → 控制条不渲染。
 */
const mergeBarByRowIndex = computed<Map<number, number>>(() => {
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return new Map()
  const original = result.rows
  const paired = zippedRows.value
  const map = new Map<number, number>()
  result.hunks.forEach((hunk, hunkIndex) => {
    const anchor = hunkAnchorRows(hunk, original)
    if (anchor.start < 0) {
      console.debug('[SplitDiffView] 合并控制条定位失败，跳过该 hunk：', hunk.header)
      return
    }
    const translated = translateAnchorToPaired(
      { start: anchor.start, end: anchor.start },
      original,
      paired,
    )
    if (translated.start < 0) {
      console.debug('[SplitDiffView] 合并控制条配对翻译失败，跳过该 hunk：', hunk.header)
      return
    }
    if (!map.has(translated.start)) map.set(translated.start, hunkIndex)
  })
  return map
})

/* -------------------------------------------------------------------------- */
/* 视图模型                                                                    */
/* -------------------------------------------------------------------------- */

/** 单侧渲染模型（模板直消费）；null = 该侧空占位（del 的右侧 / add 的左侧） */
interface SplitSideVm {
  /** 行号（1-based，引擎产出；并排视图左右两列各自独立计数） */
  lineNo: number
  /** 记号：左删「−」/ 右增「+」/ equal 无记号 */
  sign: '−' | '+' | ''
  /** 色调：决定该侧单元格的底色 / 文字 token 组（is-tone-* class） */
  tone: 'equal' | 'del' | 'add'
  /**
   * 行内渲染 spans（INT-001 起为最终形态）；null = 按纯文本渲染 text
   * （'line' 精度整体短路 / 引擎未填 / 无语法且无词级高亮）。非空时按序
   * 渲染，拼接恒等于 text；cls 形如 '' / 'tok-*' / 'word-changed' /
   * 'word-changed tok-*'（词级 diff 高亮与语法高亮的共存合并，见
   * visibleVms 与 highlight.ts 的 mergeWordSyntax）。
   */
  spans: SyntaxSpan[] | null
  /** 行原文（spans 为 null 时渲染；spans 非空时二者内容一致） */
  text: string
}

/** 行渲染模型（一行 = 左右两个 SideVm + 行级元数据） */
interface SplitRowVm {
  /**
   * 本行在配对序列（pairedRows / renderRows）中的下标：hunk 导航（UI-010）
   * 的滚动映射键（scrollIndexByRowIndex 与 data-nav-row 都以此为键）。
   */
  index: number
  /** v-for key：结果序列下标（行对象无稳定 id；全量重渲场景无复用诉求） */
  key: string
  /** 行类型（挂 is-* 行级 class） */
  type: DiffRowType
  /** ENG-012 超长行标记（任一侧 >1 万字符） */
  longLine: boolean
  /**
   * 是否位于当前导航 hunk（UI-010）：挂 is-current-hunk 行级 class（gutter /
   * 记号列底色高亮，样式见 main.css）。判定：currentPairedAnchor（配对序列
   * 下标空间）覆盖本行配对下标；未定位（null）时恒 false。
   */
  isCurrent: boolean
  /** 左侧（旧文本）；null = 空占位 */
  left: SplitSideVm | null
  /** 右侧（新文本）；null = 空占位 */
  right: SplitSideVm | null
}

/**
 * 单侧 → 视图模型：side 缺省（undefined）返回 null（空占位）。
 *
 * spans 取舍：仅当精度非 'line'（showSpans）且引擎确实填了非空 words 时按
 * spans 渲染，否则纯文本 —— 拼接契约保证两种渲染内容一致，纯文本路径还
 * 兜住了「空 spans 数组」的退化形态（少一层无意义的空 v-for）。
 * 词级 spans 在此转成最终渲染形态（changed → word-changed 背景类）；
 * 语法类的叠加在可视切片层完成（visibleVms，避免全量行都付出解析成本）。
 */
function toSideVm(
  side: DiffRowSide | undefined,
  sign: SplitSideVm['sign'],
  tone: SplitSideVm['tone'],
  showSpans: boolean,
): SplitSideVm | null {
  if (side === undefined) return null
  const words = side.words
  return {
    lineNo: side.lineNo,
    sign,
    tone,
    spans:
      showSpans && words !== undefined && words.length > 0
        ? words.map((word) => ({
            text: word.text,
            cls: word.changed ? 'word-changed' : '',
          }))
        : null,
    text: side.text,
  }
}

/**
 * 管道第三步：模板视图模型。记号与色调按行类型分配：
 * del → 左「−」红 + 右空占位；add → 右「+」绿 + 左空占位；
 * modify → 左「−」红 + 右「+」绿；equal → 无记号无底色。
 * 行级元数据：index = 配对序列下标（导航键）、isCurrent = 当前导航 hunk
 * 高亮判定（currentPairedAnchor 区间覆盖，未定位恒 false）。
 */
const rows = computed<SplitRowVm[]>(() => {
  // 'line' 精度：全部 spans 视为无（精度→spans 映射，见 renderRows 注释）。
  const showSpans = viewStore.precision !== 'line'
  const anchor = currentPairedAnchor.value
  return renderRows.value.map((row, index) => {
    let left: SplitSideVm | null = null
    let right: SplitSideVm | null = null
    switch (row.type) {
      case 'equal':
        left = toSideVm(row.left, '', 'equal', showSpans)
        right = toSideVm(row.right, '', 'equal', showSpans)
        break
      case 'del':
        left = toSideVm(row.left, '−', 'del', showSpans)
        break
      case 'add':
        right = toSideVm(row.right, '+', 'add', showSpans)
        break
      case 'modify':
        left = toSideVm(row.left, '−', 'del', showSpans)
        right = toSideVm(row.right, '+', 'add', showSpans)
        break
    }
    return {
      index,
      key: `row-${index}`,
      type: row.type,
      longLine: row.longLine === true,
      isCurrent:
        anchor !== null && index >= anchor.start && index <= anchor.end,
      left,
      right,
    }
  })
})

/* -------------------------------------------------------------------------- */
/* 折叠未更改行（UI-008）                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 渲染序列条目（模板直消费）：显示行携带其视图模型，折叠条携带区段数据，
 * 合并控制条携带其 hunk 下标（UI-012）。
 */
type SplitDisplayItem =
  | { kind: 'row'; vm: SplitRowVm }
  | { kind: 'collapsed'; beforeRow: number; count: number }
  | { kind: 'merge'; hunkIndex: number }

/**
 * 折叠状态接线：行源取 pairedRows（而非 renderRows）—— 两者序列同构（下标
 * 空间一致），但 pairedRows 只在 result 变化时重算，使「展开态重置」精确
 * 对齐 diff 重跑 / 输入变化（字符级精度重投影不产生新序列、不重置，见
 * useCollapse.ts 文件头的重置时机说明）；collapses 用翻译后的 pairedCollapses；
 * 开关直连 viewStore.showCollapsed（false = 全量渲染，现有行为）。
 */
const {
  displayItems,
  expand,
  expandAll,
  collapseAll,
  hasCollapses,
  isAnyCollapsed,
} = useCollapse(zippedRows, pairedCollapses, () => viewStore.showCollapsed)

/**
 * 折叠出口暴露（UI-017）：主区右上工具条的「全部展开 / 全部收起」双态按钮
 * 经本组件 defineExpose 暴露的 expandAll / collapseAll / hasCollapses /
 * isAnyCollapsed 接线（App.vue 按当前视图模式取对应 ref，与 UnifiedDiffView
 * 同一暴露形状；hasCollapses = 按钮禁用依据，isAnyCollapsed = 双态依据）。
 */
defineExpose({
  expandAll,
  collapseAll,
  hasCollapses: () => hasCollapses.value,
  isAnyCollapsed: () => isAnyCollapsed.value,
})

/**
 * 折叠感知的渲染序列：useCollapse 产出的 row 项携带 DiffRow 与原始下标，
 * 此处按「rows computed 与 renderRows 同序同长」的约定按下标 zip 成视图
 * 模型；collapsed 项原样透传（折叠条渲染见模板）；
 * 合并控制条（UI-012）插在每个 hunk 首行（mergeBarByRowIndex 命中的配对
 * 下标）的行项之前 —— hunk 行永不落入折叠区段（ENG-008 只折叠 hunk 之间
 * 的 equal 区段，配对 1:1 保留该不变量），锚点行必然随后作为行项出现；
 * 控制条与行单元同样按行高等高编号，计入虚拟滚动的单元序列（UI-009）。
 */
const displayVms = computed<SplitDisplayItem[]>(() => {
  const vms = rows.value
  const mergeBars = mergeBarByRowIndex.value
  const out: SplitDisplayItem[] = []
  displayItems.value.forEach((item) => {
    if (item.kind !== 'row') {
      out.push({ kind: 'collapsed', beforeRow: item.beforeRow, count: item.count })
      return
    }
    const hunkIndex = mergeBars.get(item.index)
    if (hunkIndex !== undefined) out.push({ kind: 'merge', hunkIndex })
    out.push({ kind: 'row', vm: vms[item.index] })
  })
  return out
})

/* -------------------------------------------------------------------------- */
/* 虚拟滚动（UI-009）                                                           */
/* -------------------------------------------------------------------------- */

/** 滚动容器模板 ref（本组件根节点 = 唯一纵向滚动容器，见文件头「渲染结构选型」） */
const viewEl = ref<HTMLElement | null>(null)

/**
 * 虚拟滚动接线（策略 A 与换行直通的完整决策见文件头「虚拟滚动」一节与
 * virtual.ts 文件头）：
 * - 渲染单元 = displayVms（row 项 / 折叠条 / 合并控制条统一按
 *   DIFF_ROW_HEIGHT 编号，折叠条与控制条视觉高度均与行高严格一致）；
 * - 换行模式直通（enabled=false）：行高不均不做逐行测量，range 覆盖全量、
 *   spacer 恒 0，行为与未虚拟化时代一致；
 * - 展开 / 收起 / 控制条插入改变 displayVms 长度 → itemCount watch 同步
 *   重算 range；不做滚动位置锚定（简单策略，见 virtual.ts 文件头）。
 */
const { range } = useVirtualRows(
  viewEl,
  () => displayVms.value.length,
  DIFF_ROW_HEIGHT,
  { enabled: () => !viewStore.wrapLongLines },
)

/**
 * 生效语言的语法渲染开关（INT-001）：viewStore.effectiveLanguage 在 auto 时
 * 已含检测结果；'plaintext'（显式选择或检测兜底）→ '' 表示整视图不渲染
 * 语法 spans（纯文本 / 词级高亮按既有行为）。
 */
const syntaxLang = computed<string>(() => {
  const lang = viewStore.effectiveLanguage
  return lang === 'plaintext' ? '' : lang
})

/**
 * 单侧行叠加语法高亮（INT-001）：
 * - 解析只发生在【可视切片】行上（虚拟滚动天然限制成本；highlightLineSpans
 *   的 LRU 缓存兜底滚动回看），全量行不付出解析成本；
 * - 词级 diff 高亮优先的共存规则：行内已有词级 spans 时，语法 spans 作为
 *   另一切分维度叠加（mergeWordSyntax：changed 片段保留 word-changed 背景
 *   类，语法类提供文字色，class 并列挂载）；无词级 spans 的行直接语法 spans；
 * - 无 parser 语言（plaintext）在上游 syntaxLang 已短路；整行解析结果无
 *   任何语法类（如注释分隔线等）时原样返回，避免无谓的模型替换与重渲染。
 */
function applySyntaxToSide(side: SplitSideVm | null, lang: string): SplitSideVm | null {
  if (side === null || side.text === '') return side
  const syntax = highlightLineSpans(side.text, lang)
  if (!syntax.some((span) => span.cls !== '')) return side
  if (side.spans !== null) {
    return { ...side, spans: mergeWordSyntax(side.spans, syntax) }
  }
  return { ...side, spans: syntax }
}

/** 可视切片：displayVms 的 [range.start, range.end) 子序列，并叠加语法高亮（见 applySyntaxToSide） */
const visibleVms = computed<SplitDisplayItem[]>(() => {
  const slice = displayVms.value.slice(range.start, range.end)
  const lang = syntaxLang.value
  if (lang === '') return slice
  return slice.map((item): SplitDisplayItem => {
    if (item.kind !== 'row') return item
    const vm = item.vm
    const left = applySyntaxToSide(vm.left, lang)
    const right = applySyntaxToSide(vm.right, lang)
    if (left === vm.left && right === vm.right) return item
    return { kind: 'row', vm: { ...vm, left, right } }
  })
})

/**
 * 底部 spacer 高度 = 全量高度 − 顶部 spacer − 已渲染行高。三段恒满足
 * top + 切片数×行高 + bottom = totalHeight（网格总高与滚动位置无关，滚动条
 * 长度 / 滚动锚定不因切片抖动）；换行直通模式下恰好为 0。
 */
const bottomSpacerHeight = computed(() =>
  Math.max(
    0,
    range.totalHeight - range.offsetTop - (range.end - range.start) * DIFF_ROW_HEIGHT,
  ),
)

/* -------------------------------------------------------------------------- */
/* hunk 导航：当前 hunk 高亮 + 滚动定位（UI-010）                                */
/* -------------------------------------------------------------------------- */

/**
 * 配对行下标 → 渲染序列（displayVms）单元下标映射（滚动定位用）。
 *
 * 渲染序列是「显示行 / 折叠条 / 合并控制条」的交错列表（displayVms 与
 * displayItems 同序但控制条有额外插入），虚拟滚动按单元编号计高 ——
 * scrollTop ↔ 行位置换算必须走单元下标，不能直接用配对行下标。displayVms
 * 的 row 项 vm.index 即配对行下标，直接建映射（含控制条造成的单元下标
 * 偏移；重复行防御只记首个命中）。
 */
const scrollIndexByRowIndex = computed<Map<number, number>>(() => {
  const map = new Map<number, number>()
  displayVms.value.forEach((item, unitIndex) => {
    if (item.kind === 'row' && !map.has(item.vm.index)) {
      map.set(item.vm.index, unitIndex)
    }
  })
  return map
})

/**
 * 量测某行顶部在滚动内容坐标系中的位置（px）：目标行已渲染时按真实盒位置
 * 计算（视口坐标差 + 当前 scrollTop），对换行模式（行高不均）与「全部展开」
 * 工具条的常量偏移都天然精确。行未渲染（虚拟窗口外 / 被折叠剔除）返回
 * null，由 scrollToRow 回退公式路径。data-nav-row 标在每行左侧首个单元格上
 * （行分组 .diff-row 为 display:contents，无自身盒子可查）。
 */
function measureRowTop(el: HTMLElement, rowIndex: number): number | null {
  const cell = el.querySelector<HTMLElement>(`[data-nav-row="${rowIndex}"]`)
  if (cell === null) return null
  return cell.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
}

/**
 * 滚动到指定行（配对序列下标空间，调用方传 currentPairedAnchor.start）：
 * 优先 DOM 量测（已渲染即精确），回退等行高公式 scrollTop = 单元下标 ×
 * DIFF_ROW_HEIGHT（非换行模式所有渲染单元严格等高、顶部 spacer 由虚拟模型
 * 给出，scrollTop 即内容坐标；换行模式恒全量渲染，DOM 路径必命中，公式
 * 路径不会启用）。定位失败（行被折叠剔除等契约外场景）debug 记录并跳过，
 * 不中断导航。
 */
function scrollToRow(rowIndex: number): void {
  const el = viewEl.value
  if (el === null) return
  const measured = measureRowTop(el, rowIndex)
  if (measured !== null) {
    el.scrollTop = measured
    return
  }
  const unit = scrollIndexByRowIndex.value.get(rowIndex)
  if (unit === undefined) {
    console.debug('[SplitDiffView] 导航锚点行无法定位，跳过滚动：', rowIndex)
    return
  }
  el.scrollTop = unit * DIFF_ROW_HEIGHT
}

/*
 * 导航动作 → 滚动定位：watch navStore.seq（而非 currentIndex —— 单 hunk
 * 循环回绕时 currentIndex 同值不变，seq 保证「重复定位同一 hunk」也触发
 * 跳回，见 stores/nav.ts 的 seq 注释）。nextTick 等锚点行进入渲染序列后
 * 再滚动；immediate 覆盖「切换视图重挂载时回显当前位置」（此时 seq 未变，
 * 但挂载后的首次执行即完成定位）。reset（seq 亦自增）后锚点为 null，自然
 * 跳过滚动，无副作用。
 */
watch(
  () => navStore.seq,
  () => {
    void nextTick(() => {
      const anchor = currentPairedAnchor.value
      if (anchor !== null) scrollToRow(anchor.start)
    })
  },
  { immediate: true },
)

/* -------------------------------------------------------------------------- */
/* 合并控制条事件出口（UI-012）                                                  */
/* -------------------------------------------------------------------------- */

/**
 * 合并控制条（UI-012）：hunkIndex = result.hunks 下标、direction = 应用
 * 方向，App.vue 监听后调 core/merge.ts 更新两侧文本并重算（本组件不感知
 * 应用逻辑，只做「换算 + 上抛」）。原 editSide（行点击编辑）出口已随
 * App.vue 的保留编辑态撤除而移除。
 */
const emit = defineEmits<{
  applyHunk: [hunkIndex: number, direction: MergeDirection]
}>()

/** 合并控制条按钮统一出口：按（hunk 下标，方向）转发 applyHunk */
function emitApplyHunk(hunkIndex: number, direction: MergeDirection): void {
  emit('applyHunk', hunkIndex, direction)
}

</script>

<template>
  <!--
    唯一滚动容器（纵向）：左右同步滚动由共享滚动容器天然达成（按行高对齐），
    说明见文件头「渲染结构选型」。is-wrap 承载换行开关（wrapLongLines，
    同时是虚拟滚动的直通开关，见文件头「虚拟滚动」）。viewEl 供
    useVirtualRows 挂 scroll / ResizeObserver 监听。原视图内 sticky「全部
    展开」工具条已随 UI-017 迁至主区右上工具条（App.vue 经 defineExpose
    接线），滚动内容内不再有置顶条带。
  -->
  <div
    ref="viewEl"
    class="split-view diff-text"
    :class="{ 'is-wrap': viewStore.wrapLongLines }"
    aria-label="并排差异视图"
  >
    <div class="split-grid">
      <!--
        虚拟滚动（UI-009）渲染结构：顶部 spacer（range.offsetTop 高）+ 可视
        切片 + 底部 spacer（剩余高度），spacer 横跨全部列（.diff-vspacer，
        公共样式见 main.css）—— 网格总高恒等于 totalHeight，与滚动位置无关。
        换行直通模式下两个 spacer 恒为 0（height: 0px 的网格行不占高）。
      -->
      <div
        class="diff-vspacer"
        :style="{ height: `${range.offsetTop}px` }"
        aria-hidden="true"
      ></div>
      <!--
        可视切片（visibleVms，见 script 注释）：
        - collapsed 项：折叠条（真实 button，点击展开该区段），横跨全部列的
          条带（.diff-collapse-bar 公共样式见 main.css：--diff-gutter-bg 底 +
          虚线边 + 次级文字色，总高与行高严格一致）；文案 N=2 时保持「行」
          （中文量词无单复数）；
        - merge 项：合并控制条（UI-012），横跨全部列的条带（.diff-merge-bar
          公共样式见 main.css：--diff-hunk-bg 底 + 两个小按钮，总高与行高
          严格一致），点击 emit applyHunk（hunk 下标 + 方向，App 接线）；
        - row 项：行分组（display:contents，见文件头）：行级 class 只承担
          语义与长行截断的作用域，自身不产生盒子；6 个单元格按序落入网格列
          轨道。被折叠剔除的行不渲染，保留行的 vm.key（结果序列下标派生）
          不受邻行折叠影响。
      -->
      <template
        v-for="item in visibleVms"
        :key="item.kind === 'row'
          ? item.vm.key
          : item.kind === 'merge' ? `merge-${item.hunkIndex}` : `collapse-${item.beforeRow}`"
      >
        <button
          v-if="item.kind === 'collapsed'"
          type="button"
          class="diff-collapse-bar"
          :aria-label="`展开未更改的 ${item.count} 行`"
          @click="expand(item.beforeRow)"
        >⋯ 展开未更改的 {{ item.count }} 行</button>
        <!--
          合并控制条（UI-012）：「⇤ 应用到左侧」= right-to-left（让左侧长得
          像右侧），「应用到右侧 ⇥」= left-to-right（让右侧长得像左侧）。
          轻量原生 button（ztools-ui ZButton 最小档 28px 高，放不进与行严格
          等高的 20px 控制条，见 main.css .diff-merge-btn 注释）。
        -->
        <div v-else-if="item.kind === 'merge'" class="diff-merge-bar" role="group" :aria-label="`合并第 ${item.hunkIndex + 1} 处更改`">
          <button
            type="button"
            class="diff-merge-btn"
            title="把该处更改的右侧内容应用到左侧"
            @click="emitApplyHunk(item.hunkIndex, 'right-to-left')"
          >⇤ 应用到左侧</button>
          <button
            type="button"
            class="diff-merge-btn"
            title="把该处更改的左侧内容应用到右侧"
            @click="emitApplyHunk(item.hunkIndex, 'left-to-right')"
          >应用到右侧 ⇥</button>
        </div>
        <div
          v-else
          class="diff-row"
          :class="[
            `is-${item.vm.type}`,
            { 'is-long-line': item.vm.longLine, 'is-current-hunk': item.vm.isCurrent },
          ]"
        >
        <!--
          左侧（旧文本）：行号 / 记号 / 内容；缺失侧渲染空占位保持对齐
             （行号 / 记号 / 内容三列的公共样式为 main.css 的 .diff-gutter /
             .diff-sign / .diff-content，UI-007 起与统一视图共用）。
             首个单元格带 data-nav-row（配对序列下标）：hunk 导航滚动定位的
             DOM 量测锚点（scrollToRow 的 measureRowTop 按它查行，见 script）。
             内容格为纯展示（原点击编辑入口已撤除，见文件头）。
        -->
        <div
          class="diff-gutter"
          :class="item.vm.left === null ? '' : `is-tone-${item.vm.left.tone}`"
          :data-nav-row="item.vm.index"
        >{{ item.vm.left === null ? '' : item.vm.left.lineNo }}</div>
        <div
          class="diff-sign"
          :class="item.vm.left === null ? '' : `is-tone-${item.vm.left.tone}`"
        >{{ item.vm.left === null ? '' : item.vm.left.sign }}</div>
        <div
          v-if="item.vm.left !== null"
          class="diff-content"
          :class="`is-tone-${item.vm.left.tone}`"
        >
          <template v-if="item.vm.left.spans !== null">
            <!--
              行内渲染 spans（INT-001 起为词级 diff + 语法的合并形态）：cls
              预拼接为类名串（'word-changed' 背景 / 'tok-*' 语法色 / 两者并列 /
              ''），word-changed 的底色样式见本组件 scoped 样式，tok-* 见 main.css。
            -->
            <span
              v-for="(span, spanIndex) in item.vm.left.spans"
              :key="spanIndex"
              :class="span.cls"
            >{{ span.text }}</span>
          </template>
          <template v-else>{{ item.vm.left.text }}</template>
          <!-- 「展开」提示样式占位（非交互）：完整截断/展开交互归 UI-015/009 -->
          <span
            v-if="item.vm.longLine && viewStore.wrapLongLines"
            class="diff-long-line-hint"
            title="超长行已截断，完整展开交互将在后续版本提供"
          >展开</span>
        </div>
        <!-- 空占位格（add 行的左侧）：纯布局占位，保持网格对齐 -->
        <div v-else class="diff-content is-blank" aria-hidden="true"></div>

        <!-- 右侧（新文本）：结构对称，记号「+」、色调 add；内容格同为纯展示 -->
        <div
          class="diff-gutter split-gutter-r"
          :class="item.vm.right === null ? '' : `is-tone-${item.vm.right.tone}`"
        >{{ item.vm.right === null ? '' : item.vm.right.lineNo }}</div>
        <div
          class="diff-sign"
          :class="item.vm.right === null ? '' : `is-tone-${item.vm.right.tone}`"
        >{{ item.vm.right === null ? '' : item.vm.right.sign }}</div>
        <div
          v-if="item.vm.right !== null"
          class="diff-content"
          :class="`is-tone-${item.vm.right.tone}`"
        >
          <template v-if="item.vm.right.spans !== null">
            <!-- 行内渲染 spans（与左侧同构，见左列注释） -->
            <span
              v-for="(span, spanIndex) in item.vm.right.spans"
              :key="spanIndex"
              :class="span.cls"
            >{{ span.text }}</span>
          </template>
          <template v-else>{{ item.vm.right.text }}</template>
          <span
            v-if="item.vm.longLine && viewStore.wrapLongLines"
            class="diff-long-line-hint"
            title="超长行已截断，完整展开交互将在后续版本提供"
          >展开</span>
        </div>
        <div v-else class="diff-content is-blank" aria-hidden="true"></div>
        </div>
      </template>
      <!-- 底部 spacer：补齐未渲染区间的等价高度（见顶部 spacer 注释） -->
      <div
        class="diff-vspacer"
        :style="{ height: `${bottomSpacerHeight}px` }"
        aria-hidden="true"
      ></div>
    </div>
  </div>
</template>

<style scoped>
/*
 * 样式组织（UI-007 起）：行号列 / 记号列 / 内容列的公共行样式（含色调、
 * 换行开关、长行截断、「展开」提示）已提取为 main.css 的 .diff-* 全局类，
 * 与 UnifiedDiffView 共用同一份，避免双份拷贝漂移；本组件 scoped 样式只保留
 * 并排视图专属的布局量 —— 6 列网格定义、列宽 token、右侧行号列分界线、
 * 记号列 sticky 偏移，以及仅并排视图使用的行内词级高亮（unified 不渲染 spans）。
 */
.split-view {
  /*
   * 列宽 token（组件局部布局量，非颜色 token）：行号列宽随结果行数位数
   * 自适应（UI-015）—— 来源是 App.vue 注入到 .result-stage 的共享变量
   * --gutter-w（diffGutterWidthPx：≤3 位 40px / 4–5 位 52px / ≥6 位 64px，
   * 见 stores/view.ts），此处仅声明回退缺省；记号列容纳单个 −/+ 字符。
   * sticky 偏移（下方 .split-view .diff-sign）消费同一变量，两处恒同步。
   */
  --split-gutter-w: var(--gutter-w, 40px);
  --split-sign-w: 16px;

  /* 唯一滚动容器：纵向滚动（横向滚动发生在各内容单元格内部，见文件头）。
     overflow-anchor: none（UI-009）：禁用浏览器滚动锚定 —— 虚拟切片的
     spacer 高度随 range 变化，锚定介入会反向调整 scrollTop 造成抖动；
     三段高度恒满足 top + 切片 + bottom = totalHeight，本就无需锚定补偿。 */
  height: 100%;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  background-color: var(--bg-color, #f4f4f4);
}

/*
 * 行模型：6 列网格（左行号 | 左记号 | 左内容 | 右行号 | 右记号 | 右内容）。
 * 内容列 minmax(0, 1fr)：列宽 = 容器对半分配、与内容长短无关 —— 任何超长行
 * 都不会撑宽共享列轨道（不撑爆布局的第一道保证），超出部分交给单元格自身
 * 横向滚动 / 换行策略。行高由隐式行轨道承载：每行 6 格共享一条轨道，
 * 行高 = 该行最高单元格，左右严格等高（同步滚动「按行高对齐」的结构化保证）。
 * 非 wrap 模式下所有渲染单元（行 / 折叠条）高度恰为 --diff-line-height
 * （保证链见 main.css 的 .diff-content 与 .diff-collapse-bar 注释），是
 * 虚拟滚动（UI-009）等行高计高的结构前提。
 */
.split-grid {
  display: grid;
  grid-template-columns:
    var(--split-gutter-w) var(--split-sign-w) minmax(0, 1fr)
    var(--split-gutter-w) var(--split-sign-w) minmax(0, 1fr);
}

/* 左右分界：右侧行号列左缘一条分隔线（token 着色，随主题切换） */
.split-gutter-r {
  border-left: 1px solid var(--border-color, #e5e7eb);
}

/*
 * 记号列 sticky 偏移 = 左行号列宽（防御性声明：本模型网格本体无横向滚动，
 * 天然恒定可见；若未来引入网格级横向滚动则记号列钉在左行号列之后）。
 * sticky / 对齐等基础声明来自公共类 .diff-sign。
 */
.split-view .diff-sign {
  left: var(--split-gutter-w);
}

/*
 * 行内词级高亮（仅并排视图渲染 spans；unified 不消费，见 UnifiedDiffView 文件头）：
 * changed 片段词级底色（左 del / 右 add 的 word-bg token），未变更片段无背景
 * （透出行底色）。作用域限定在对应色调的内容列内。
 */
.diff-content.is-tone-del .word-changed {
  background-color: var(--diff-del-word-bg);
}

.diff-content.is-tone-add .word-changed {
  background-color: var(--diff-add-word-bg);
}
</style>
