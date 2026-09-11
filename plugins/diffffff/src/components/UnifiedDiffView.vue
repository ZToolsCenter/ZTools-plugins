<!--
  UnifiedDiffView（UI-007）：统一（unified）diff 结果视图 —— 单栏 +/−/空格 行模型。

  ┌─ 数据管道（script 区 computed，纯派生：不改 store、不改引擎产物）──────────
  │ diffStore.result.rows（compareFull 产出的行级骨架；ok:true 由 App 层保证）
  │   → （不经 rowsWithPairing / 行内 spans，语义决策见下）
  │   → displayItems             折叠感知的行序列（UI-008，useCollapse 共享
  │                              composable）：showCollapsed 开启时剔除
  │                              result.collapses 覆盖的未更改区段并插入
  │                              折叠条（详见下方「折叠未更改行」一节）
  │   → items（视图模型）        hunk 头条 + 折叠条 + 显示行的交错序列，
  │                              模板直渲染
  │   → visibleItems            虚拟滚动切片（UI-009）：items 的
  │                              [range.start, range.end) 子序列，上下
  │                              spacer 补齐等价高度
  └────────────────────────────────────────────────────────────────────────────

  语义决策（与 roadmap UI-007 范围一致）：
  - 不做相似行配对（rowsWithPairing）、不渲染行内词级 spans：行内词级高亮仅
    并排视图（SplitDiffView）提供；unified 的核心语义是「逐行 +/−/空格」的
    线性补丁视图，红删绿增行底色已承载变化定位，且 result.rows 是 compareFull
    的原始骨架（无 modify 行、无 words），直接消费零派生成本；
  - 语法高亮（INT-001）：生效语言取 viewStore.effectiveLanguage（auto →
    detectLanguagePair 检测结果，plaintext → 不渲染），在可视切片层对显示行
    调用 highlightLineSpans 填充语法 spans（LRU 缓存兜底滚动回看）。与并排
    视图不同，unified 行无词级 spans，语法类直接叠加在红绿底色行上（底色
    管变化语义、tok-* 管文字色，互不冲突）；逐行解析的局限见 highlight.ts。
  - modify 行（ENG-005 配对产物，compareFull 骨架正常不产出）防御性展开为
    「一条 del 显示行 + 一条 add 显示行」（core/types.ts 的 unified 渲染约定）：
    unified 单栏一行只承载一侧内容，modify 的两侧必须拆开显示。

  渲染结构（与 SplitDiffView 同款选型：单一滚动容器 + CSS grid 行模型）：
  - 整表只有一个滚动容器（纵向滚动），4 列网格：旧行号 | 新行号 | 记号 | 内容；
    行分组容器 .diff-row（display:contents，main.css 公共类）保留 DOM 分组
    （v-for key、行级 class 挂载点、虚拟滚动 UI-009 已接入的行切分单元）；
  - 行号 / 记号列 sticky 左固定（与 SplitDiffView 的 gutter 策略一致，防御性
    声明 —— 网格本体无横向滚动，横向滚动发生在内容单元格内部，行号恒定可见）；
  - 长行策略与 SplitDiffView 完全一致（消费同一批 main.css 公共类）：
    非换行模式 white-space:pre + 内容单元格内横向滚动（不撑爆布局，内容完整
    可达；内容格滚动条已隐藏保证行高恒定，见 main.css .diff-content）；
    换行模式 pre-wrap + overflow-wrap:anywhere，长行（longLine）
    max-height（4 行）截断 + 右下角「展开」提示占位（非交互，完整截断 /
    展开交互归 UI-015）；
  - 空文本行：内容单元格 min-height: var(--diff-line-height)（公共类），保留行高。

  虚拟滚动（UI-009，src/composables/virtual.ts 的轻量自研窗口切片）：
  - 渲染单元策略 A（任务给定二选一）：items 管道的全部单元（显示行 / hunk
    头条 / 折叠条）统一按 rowHeight（20px，= --diff-line-height）编号计高 ——
    hunk 头条 line-height = 行高、无竖向 padding，折叠条经 main.css 微调后
    与行高严格一致，统一编号是精确模型而非近似；
  - 渲染结构：滚动容器内 = 顶部 spacer（range.offsetTop 高，.diff-vspacer
    横跨全部列）+ items 的 [range.start, range.end) 切片 + 底部 spacer
    （剩余高度）。三段恒满足 spacer + 切片×行高 + spacer = totalHeight，
    网格总高与滚动位置无关（滚动条 / 锚定不抖动）；
  - 换行模式直通：wrapLongLines=true 时行高不均（1~4 行不等），等行高模型
    失效，enabled=false 让 range 覆盖全量（spacer 恒 0、全量渲染，行为与
    UI-008 时代一致）。决策理由（任务指定记录）：逐行测量 + 前缀和的复杂度
    与收益不成比例；换行是明读场景，大 diff + 换行组合已有 ENG-011 输入上限
    与 longLine 截断兜底；
  - 滚动性能：容器 scroll（passive）由 useVirtualRows 内部监听，rAF 合帧
    （同帧多次滚动合并为一次 range 写入）；展开 / 收起改变 displayItems
    长度 → itemCount watch 同步重算，不做滚动位置锚定（视口上方展开时内容
    下移，简单策略，见 virtual.ts 文件头）；滚动容器声明 overflow-anchor:
    none 禁用浏览器滚动锚定（spacer 高度变化不需要锚定补偿，总高恒定，见
    scoped 样式）。原「全部展开」sticky 工具条的 ~33px 常量高度已随 UI-017
    迁移消除（工具条移至主区右上，滚动内容内不再有置顶条带）。

  hunk 头条（@@ -a,b +c,d @@，ENG-008 产出 hunk.header 原样展示）：
  - 在每个 hunk 的起始显示行之前插入一条头条；hunk 在 rows 中的定位用
    hunkAnchorRows（ENG-009，「尽力定位」：主路径为行对象引用精确匹配，回退
    路径允许近似 —— 头条是视觉锚点，近似可接受）；
  - start 为 -1（无法定位，含空 hunk / 空 rows / hunk 比 rows 还长）→ 跳过该
    hunk 的头条并 console.debug；两个 hunk 定位到同一起始行（回退策略的极端
    情况，正常不会发生）时按 hunk 顺序依次插入，不做去重。

  折叠未更改行（UI-008，useCollapse 共享 composable 的统一视图接入）：
  - result.rows / result.collapses 天然同一下标空间（本视图不经配对合并，
    见上方语义决策），无需翻译直接交给 useCollapse；
  - showCollapsed（工具栏「折叠未变更」）开启时，hunk 之间超出上下文的未
    更改区段被折叠条「⋯ 展开未更改的 N 行」取代（真实 button，点击展开），
    被折叠的行从渲染序列剔除但仍留在 rows 中（契约：折叠只是投影视图）；
  - 折叠条与 hunk 头条的相邻顺序：折叠条在前、下一 hunk 的 @@ 头条在后 ——
    折叠条代表的是上一 hunk 与下一 hunk 之间的未更改行，头条锚定在下一
    hunk 首行（= 折叠条的 beforeRow），两者同一下标但只由行项冲刷头条
    （折叠条项不冲刷，避免同锚点重复插入），最终顺序即「…上 hunk 末行 →
    折叠条 → @@ 头条 → 下 hunk 首行…」，与 GitHub 展开条带位于两 hunk 之间
    的惯例一致；折叠条用 --diff-gutter-bg 灰底 + 虚线边（与 --diff-hunk-bg
    蓝底的头条视觉区分，样式见 main.css 的 .diff-collapse-bar 注释）；
  - 锚点落在被折叠区段内的 hunk 头条（仅 hunkAnchorRows 回退路径的近似定位
    可能命中）随区段折叠暂不渲染，展开后恢复；主路径（引用精确匹配）的锚点
    恒在折叠条之后的行上，不受影响；
  - 展开态为纯 UI 态（useCollapse 内部 ref）：diff 重跑 / 输入变化（rows /
    collapses 引用变化）时整体重置；「全部展开」入口经 defineExpose 暴露给
    主区右上工具条（UI-017，App.vue 接线），视图内不再维护置顶工具条。

  hunk 导航接入（UI-010，与 SplitDiffView 对等的统一视图侧实现）：
  - 导航态真源在 stores/nav.ts（currentIndex 基于 result.hunks 下标，键盘
    F3/Shift+F3 与统计条按钮共用其 goNext/goPrev 出口）；本视图只读
    navStore.currentAnchor —— 即当前 hunk 在 result.rows 原始下标空间的
    {start,end} 闭区间。统一视图行序列不经配对合并，【无需下标翻译】直接
    消费（SplitDiffView 因 rowsWithPairing 合并需先翻译，见其组件头）；
  - 当前 hunk 高亮：锚点区间内的显示行挂 is-current-hunk class，gutter /
    记号列底色切为 --diff-hunk-bg（视觉决策见 main.css 的 .is-current-hunk
    注释）；未定位（anchor 为 null）不高亮；
  - 滚动定位：watch navStore.seq（导航动作序号 —— 单 hunk 回绕时 currentIndex
    同值不变，watch seq 才能感知「重复定位同一 hunk」的跳回诉求），经
    nextTick 后 scrollToRow(anchor.start)。切换视图时本组件重挂载，immediate
    watch 在挂载后立即定位，跨视图共享当前位置由此达成（与 defineExpose +
    App 调用方案相比，省去 App 侧 ref 转发且天然覆盖「切视图回显」场景）；
  - 滚动目标 = 行在渲染序列（items：显示行 / @@ 头条 / 折叠条交错）中的
    单元下标，而非 result.rows 下标 —— scrollIndexByRowIndex computed 建立
    「原始行下标 → items 单元下标」映射，头条紧贴锚点行之前，映射优先取
    头条起始单元（滚动后 @@ 头可见）；
  - 滚动量：首选 DOM 量测（目标行已渲染时按 getBoundingClientRect 真实盒位
    滚动 —— 精确，对换行模式的行高不均天然成立）；目标行未渲染（虚拟窗口外）
    时回退等行高公式
    scrollTop = 单元下标 × DIFF_ROW_HEIGHT（顶部 spacer 已由虚拟模型给出，
    scrollTop 即内容坐标；非换行模式所有单元严格等高，公式精确）。

  样式组织：行号 / 记号 / 内容三列与色调、换行开关、长行截断、「展开」提示
  等公共行样式消费 main.css 的 .diff-* 全局类（UI-007 起从 SplitDiffView
  提取，两视图共用一份避免双份拷贝漂移）；本组件 scoped 样式只保留统一视图
  专属的布局量 —— 4 列网格定义、列宽 token、第二列行号与记号列的 sticky
  偏移、hunk 头条（--diff-hunk-bg 仅本视图消费）。当前 hunk 高亮样式
  （.is-current-hunk）是两视图公共类，定义在 main.css。

  性能注记：非换行模式虚拟化渲染（UI-009）—— DOM 单元数 = 可视窗口单元数 +
  2×overscan（默认 10），与总行数无关；换行模式直通全量渲染（决策见上方
  「虚拟滚动」一节与 virtual.ts 文件头），输入侧已有 ENG-011 大文本防护
  （5MB / 10 万行）兜底。hunk 定位的成本随结果一次性付出（computed 缓存，
  滚动交互不重算）；折叠展开每次点击触发一次 displayItems / items 的 O(n)
  重算（UI-008，见 useCollapse.ts 性能注记）与一次 range 同步重算（UI-009）。

  结果态编辑入口（已撤除）：原 UI-011 的「行内容格点击 emit editSide 进入
  保留编辑态」已随 App.vue 的状态机简化（回编辑统一走主按钮「重新编辑」）
  一并移除 —— 内容格现为纯展示，不挂点击事件；拖拽选中文本复制等阅读行为
  不受影响。

  合并更改控制条（UI-012）：每个 hunk 的首行前渲染一条「合并控制条」（在
  @@ 头条之前：控制条是针对其下方 hunk 的动作条，@@ 头条保持与 hunk 首行
  相邻），提供「⇤ 应用到左侧」（right-to-left）与「应用到右侧 ⇥」（
  left-to-right）两个小按钮，点击 emit applyHunk: [hunkIndex, direction]
  （App.vue 监听后调 core/merge.ts 的 applyHunk 更新两侧文本并重算）：
  - hunk 定位与 @@ 头条共用同一机制（hunkAnchorRows 尽力定位，主路径为行
    对象引用精确匹配）—— 本视图行序列就是原始 rows，无需下标翻译（与
    SplitDiffView 不同，其需先经 translateAnchorToPaired 翻译到配对空间）；
  - 控制条横跨全部 4 列（.diff-merge-bar，公共样式见 main.css），高度与行
    严格等高（--diff-line-height），与 @@ 头条 / 折叠条同为虚拟滚动（UI-009）
    的等高渲染单元，scrollIndexByRowIndex 的映射随 items 自动包含偏移；
  - 定位失败（anchor.start < 0）时跳过该 hunk 的控制条并 console.debug（与
    头条同策略）；result 为 null / ok:false 时 items 为空序列，不渲染。

  不在本组件范围：行内词级高亮（仅并排视图，见上）、
  合并应用本身（UI-012 引擎纯函数在 core/merge.ts，applyHunk 事件接线在
  App.vue）、可见的横向滚动指示打磨（UI-015）。hunk 导航与当前 hunk 高亮
  （UI-010）已接入（见上方专节），统计条与导航按钮 / F3 快捷键在 App.vue
  （导航态真源 stores/nav.ts，两视图只读消费）。
  折叠条 / 合并控制条 / 当前 hunk 高亮的公共样式在 main.css
  （与 SplitDiffView 共用）。
-->
<script setup lang="ts">
/**
 * 组件实例层：数据管道（result.rows → 折叠过滤 → hunk 头条交错 + 显示行展开
 * → 视图模型）与模板。颜色一律消费 main.css 的 --diff-* token 与 ztools-ui
 * 宿主变量，无硬编码色值。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { isDiffOk } from '../core/types'
import type { CollapseRange, DiffRow, DiffRowSide } from '../core/types'
import { hunkAnchorRows } from '../core/stats'
import type { MergeDirection } from '../core/merge'
import { highlightLineSpans } from '../core/highlight'
import type { SyntaxSpan } from '../core/highlight'
import { useCollapse } from '../composables/useCollapse'
import { DIFF_ROW_HEIGHT, useVirtualRows } from '../composables/virtual'
import { diffStore } from '../stores/diff'
import { navStore } from '../stores/nav'
import { viewStore } from '../stores/view'

/* -------------------------------------------------------------------------- */
/* 视图模型                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * unified 单栏一行显示模型（模板直消费）。
 * 与并排视图的 SplitRowVm 不同：一行只承载一侧内容、无行内 spans，
 * 行号分列展示（old / new，缺失侧留空）。
 */
interface UnifiedLineVm {
  /** v-for key：显示行在视图模型生成时的稳定标识（结果序列下标派生） */
  key: string
  /** 旧行号（left.lineNo，1-based）；null = 该侧缺失（add 行），留空 */
  oldLineNo: number | null
  /** 新行号（right.lineNo，1-based）；null = 该侧缺失（del 行），留空 */
  newLineNo: number | null
  /** 记号：删「−」红 / 增「+」绿 / equal 空格（unified 约定，见 core/types.ts） */
  sign: '−' | '+' | ' '
  /** 色调：决定行底色 / 文字 token 组（is-tone-* 公共类） */
  tone: 'equal' | 'del' | 'add'
  /** 行原文（del 取 left.text / add 取 right.text / equal 取 right.text） */
  text: string
  /**
   * 语法高亮 spans（INT-001）；null = 按纯文本渲染。只在可视切片层按
   * 生效语言填充（highlightLineSpans，LRU 缓存兜底），拼接恒等于 text。
   */
  spans: SyntaxSpan[] | null
  /** ENG-012 超长行标记（>1 万字符）；modify 展开的两条显示行同标记 */
  longLine: boolean
  /**
   * 是否位于当前导航 hunk（UI-010）：挂 is-current-hunk 行级 class（gutter /
   * 记号列底色高亮，样式见 main.css）。判定：navStore.currentAnchor（原始
   * rows 下标空间）覆盖本行的原始下标；未定位（null）时恒 false。
   */
  isCurrent: boolean
}

/**
 * 渲染序列条目：hunk 头条、折叠条、合并控制条与显示行的交错列表。
 * 判别字段 kind：'header' 渲染 @@ 头条（横跨全部网格列），'collapse' 渲染
 * 折叠条（横跨全部列的真实按钮，UI-008），'merge' 渲染合并控制条（横跨
 * 全部列的动作条，UI-012），'line' 渲染单栏一行。
 */
type UnifiedItemVm =
  | { kind: 'header'; key: string; header: string }
  | { kind: 'collapse'; key: string; beforeRow: number; count: number }
  | { kind: 'merge'; key: string; hunkIndex: number }
  | { kind: 'line'; key: string; line: UnifiedLineVm; rowIndex: number }

/**
 * 单侧 → 半行显示模型（del 行 / add 行 / modify 展开行共用）：
 * 行号只取本侧存在侧（lineNoOf 指定该半行归属旧列还是新列），对侧留空；
 * side 缺省（契约违约防御，正常不出现）时渲染无行号的空文本行，
 * 但保留记号与行底色（布局高度不塌陷）。
 */
function toHalfLine(
  side: DiffRowSide | undefined,
  lineNoOf: 'old' | 'new',
  sign: UnifiedLineVm['sign'],
  tone: UnifiedLineVm['tone'],
  key: string,
  longLine: boolean,
  isCurrent: boolean,
): UnifiedLineVm {
  return {
    key,
    oldLineNo: lineNoOf === 'old' && side !== undefined ? side.lineNo : null,
    newLineNo: lineNoOf === 'new' && side !== undefined ? side.lineNo : null,
    sign,
    tone,
    text: side !== undefined ? side.text : '',
    // 语法 spans 在可视切片层填充（visibleItems），模型构建时恒为 null。
    spans: null,
    longLine,
    isCurrent,
  }
}

/**
 * DiffRow → unified 显示行（按行类型取侧，语义见 core/types.ts 的 unified 渲染约定）：
 * - equal：双行号（old = left.lineNo / new = right.lineNo）+ 空格记号，
 *   内容取 right（契约注记「内容取任一侧，通常 right」；right 缺失时兜底 left）；
 * - del：旧行号 + 「−」红，取 left；
 * - add：新行号 + 「+」绿，取 right；
 * - modify：防御性展开（compareFull 骨架不产出，见文件头）为一条 del 显示行
 *   + 一条 add 显示行，行号各取本侧。
 *
 * @param isCurrent 是否位于当前导航 hunk（UI-010，调用方按锚点区间判定后
 *                  传入 —— modify 展开的两条半行同标记）
 */
function rowToLines(row: DiffRow, index: number, isCurrent: boolean): UnifiedLineVm[] {
  const longLine = row.longLine === true
  switch (row.type) {
    case 'equal': {
      const side = row.right ?? row.left
      return [
        {
          key: `line-${index}`,
          oldLineNo: row.left !== undefined ? row.left.lineNo : null,
          newLineNo: row.right !== undefined ? row.right.lineNo : null,
          sign: ' ',
          tone: 'equal',
          text: side !== undefined ? side.text : '',
          spans: null,
          longLine,
          isCurrent,
        },
      ]
    }
    case 'del':
      return [toHalfLine(row.left, 'old', '−', 'del', `line-${index}`, longLine, isCurrent)]
    case 'add':
      return [toHalfLine(row.right, 'new', '+', 'add', `line-${index}`, longLine, isCurrent)]
    case 'modify':
      // 防御性展开：unified 单栏一行只承载一侧内容（见文件头语义决策）。
      return [
        toHalfLine(row.left, 'old', '−', 'del', `line-${index}-del`, longLine, isCurrent),
        toHalfLine(row.right, 'new', '+', 'add', `line-${index}-add`, longLine, isCurrent),
      ]
  }
}

/**
 * 引擎完整行序列（ok 结果的 result.rows，错误 / 空态为空数组）：
 * useCollapse 的行源，同时也是头条锚定（hunkAnchorRows）的 rows。
 * computed 缓存保证「result 不变则引用不变」—— useCollapse 的展开态重置
 * watch 以引用变化为准（diff 重跑 / 输入变化才触发，见 useCollapse.ts）。
 */
const resultRows = computed<DiffRow[]>(() => {
  const result = diffStore.result
  return result !== null && isDiffOk(result) ? result.rows : []
})

/**
 * 折叠区段（ok 结果的 result.collapses）：与 resultRows 天然同一下标空间
 * （本视图不经 rowsWithPairing 合并，见文件头语义决策），无需翻译直接交给
 * useCollapse。
 */
const collapseRanges = computed<CollapseRange[]>(() => {
  const result = diffStore.result
  return result !== null && isDiffOk(result) ? result.collapses : []
})

/**
 * 折叠状态接线（UI-008）：开关直连 viewStore.showCollapsed（false = 全量
 * 渲染，折叠条不出现，现有行为）；展开 / 全部展开 / isAnyCollapsed 由
 * useCollapse 提供（展开态重置时机见 useCollapse.ts 文件头）。
 */
const { displayItems, expand, expandAll, collapseAll, hasCollapses, isAnyCollapsed } = useCollapse(
  resultRows,
  collapseRanges,
  () => viewStore.showCollapsed,
)

/**
 * 折叠出口暴露（UI-017）：主区右上工具条的「全部展开 / 全部收起」双态按钮
 * 经本组件 defineExpose 暴露的 expandAll / collapseAll / hasCollapses /
 * isAnyCollapsed 接线（App.vue 按当前视图模式取对应 ref，与 SplitDiffView
 * 同一暴露形状；hasCollapses = 按钮禁用依据，isAnyCollapsed = 双态依据）。
 */
defineExpose({
  expandAll,
  collapseAll,
  hasCollapses: () => hasCollapses.value,
  isAnyCollapsed: () => isAnyCollapsed.value,
})

/**
 * 数据管道：displayItems（折叠感知行序列）→ 合并控制条 + hunk 头条 + 折叠条
 * + 显示行的交错序列。
 *
 * - 头条 / 控制条插入机制：先用 hunkAnchorRows 把每个 hunk 定位到 result.rows
 *   的 0-based 起始下标，建立「起始下标 → 头条文本列表」与「起始下标 →
 *   hunk 下标」（UI-012 合并控制条）两张映射（start === -1 跳过并
 *   console.debug），再在遍历 displayItems 时，于【行项】命中下标的行前
 *   依次插入合并控制条与头条 —— 折叠条项【不冲刷】两者：折叠条的 beforeRow
 *   与下一 hunk 的锚点同下标，若在折叠条处也冲刷会造成同锚点重复插入；该
 *   下标的行本身未被折叠、必然随后作为行项出现，由它冲刷即得「折叠条在前、
 *   合并控制条 → @@ 头条在后」的相邻顺序（控制条是针对其下方 hunk 的动作
 *   条，@@ 头条保持与 hunk 首行相邻，视觉依据见文件头「合并更改控制条」）；
 * - 锚点落在被折叠区段内的头条 / 控制条（仅回退路径的近似定位可能命中）
 *   随区段折叠暂不渲染，展开后恢复（文件头有说明）；
 * - 纯派生：不改 store、不拷贝 rows / hunks（只读引用），新对象仅为视图模型；
 * - 防御性：result 为 null / ok:false 时返回空序列（状态竞态下不渲染任何行，
 *   App 层本就只在 ok:true 时挂载本组件）。
 */
const items = computed<UnifiedItemVm[]>(() => {
  const result = diffStore.result
  if (result === null || !isDiffOk(result)) return []
  const rows = result.rows

  // hunk 定位表：起始下标 → 头条文本（按 hunk 顺序追加，同下标多条依次插入）
  // 与起始下标 → hunk 下标（UI-012 合并控制条；同下标多条时取首个，契约上
  // 不可达，仅防御）。
  const headersAtIndex = new Map<number, string[]>()
  const mergeAtIndex = new Map<number, number>()
  result.hunks.forEach((hunk, hunkIndex) => {
    const anchor = hunkAnchorRows(hunk, rows)
    if (anchor.start < 0) {
      // 尽力定位失败（契约上仅在 rows / hunks 严重不一致时出现）：跳过头条
      // 与控制条不中断渲染，debug 级日志供诊断（不污染用户可见的错误通道，
      // 归 UI-013）。
      console.debug('[UnifiedDiffView] hunk 头条定位失败，跳过该 hunk：', hunk.header)
      return
    }
    const bucket = headersAtIndex.get(anchor.start)
    if (bucket === undefined) {
      headersAtIndex.set(anchor.start, [hunk.header])
    } else {
      bucket.push(hunk.header)
    }
    if (!mergeAtIndex.has(anchor.start)) mergeAtIndex.set(anchor.start, hunkIndex)
  })

  const list: UnifiedItemVm[] = []
  for (const item of displayItems.value) {
    if (item.kind === 'collapsed') {
      // 折叠条：只自身入列，不冲刷头条 / 控制条（理由见上方 JSDoc）。
      list.push({
        kind: 'collapse',
        key: `collapse-${item.beforeRow}`,
        beforeRow: item.beforeRow,
        count: item.count,
      })
      continue
    }
    // 合并控制条（UI-012）：插在该 hunk 首行（及 @@ 头条）之前。
    const mergeHunkIndex = mergeAtIndex.get(item.index)
    if (mergeHunkIndex !== undefined) {
      list.push({ kind: 'merge', key: `merge-${mergeHunkIndex}`, hunkIndex: mergeHunkIndex })
    }
    const headers = headersAtIndex.get(item.index)
    if (headers !== undefined) {
      headers.forEach((header, headerIndex) => {
        list.push({ kind: 'header', key: `hunk-header-${item.index}-${headerIndex}`, header })
      })
    }
    // 当前导航 hunk 高亮判定（UI-010）：navStore.currentAnchor 是 result.rows
    // 原始下标空间闭区间，本视图行序列同空间，直接按下标覆盖判定（null =
    // 未定位，恒不高亮）。
    const anchor = navStore.currentAnchor
    const isCurrent =
      anchor !== null && item.index >= anchor.start && item.index <= anchor.end
    for (const line of rowToLines(item.row, item.index, isCurrent)) {
      // rowIndex = 原始 rows 下标：hunk 导航滚动映射（scrollIndexByRowIndex）
      // 与渲染单元上的 data-nav-row 都以此为键。
      list.push({ kind: 'line', key: line.key, line, rowIndex: item.index })
    }
  }
  return list
})

/* -------------------------------------------------------------------------- */
/* 虚拟滚动（UI-009）                                                           */
/* -------------------------------------------------------------------------- */

/** 滚动容器模板 ref（本组件根节点 = 唯一纵向滚动容器，见文件头「渲染结构」） */
const viewEl = ref<HTMLElement | null>(null)

/**
 * 虚拟滚动接线（策略 A 与换行直通的完整决策见文件头「虚拟滚动」一节与
 * virtual.ts 文件头）：
 * - 渲染单元 = items（显示行 / hunk 头条 / 折叠条 / 合并控制条统一按
 *   DIFF_ROW_HEIGHT 编号，头条、折叠条与控制条的视觉高度均与行高严格一致）；
 * - 换行模式直通（enabled=false）：行高不均不做逐行测量，range 覆盖全量、
 *   spacer 恒 0，行为与未虚拟化时代一致；
 * - 展开 / 收起改变 items 长度 → itemCount watch 同步重算 range；不做滚动
 *   位置锚定（简单策略，见 virtual.ts 文件头）。
 */
const { range } = useVirtualRows(
  viewEl,
  () => items.value.length,
  DIFF_ROW_HEIGHT,
  { enabled: () => !viewStore.wrapLongLines },
)

/**
 * 生效语言的语法渲染开关（INT-001）：'plaintext'（显式选择或检测兜底）→
 * '' 表示不渲染语法 spans。
 */
const syntaxLang = computed<string>(() => {
  const lang = viewStore.effectiveLanguage
  return lang === 'plaintext' ? '' : lang
})

/** 可视切片：items 的 [range.start, range.end) 子序列，并叠加语法高亮（INT-001） */
const visibleItems = computed<UnifiedItemVm[]>(() => {
  const slice = items.value.slice(range.start, range.end)
  const lang = syntaxLang.value
  if (lang === '') return slice
  // 语法解析只对可视切片行做（虚拟滚动天然限制成本，highlightLineSpans 的
  // LRU 缓存兜底滚动回看）；解析结果无任何语法类（纯文本行）时原样透传。
  return slice.map((item) => {
    if (item.kind !== 'line' || item.line.text === '') return item
    const spans = highlightLineSpans(item.line.text, lang)
    if (!spans.some((span) => span.cls !== '')) return item
    return { ...item, line: { ...item.line, spans } }
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
 * 原始行下标 → 渲染序列（items）单元下标映射（滚动定位用）。
 *
 * 渲染序列是「显示行 / @@ 头条 / 折叠条 / 合并控制条」的交错列表，虚拟滚动
 * 按单元编号计高 —— scrollTop ↔ 行位置换算必须走单元下标，不能直接用原始
 * 行下标。头条紧贴其锚点行之前（合并控制条又在头条之前）：映射对锚点行
 * 优先记录【头条起始】单元（从行项向前看紧邻的连续 header 运行段的起点，
 * 控制条项只重置运行段、不参与记录），滚动后 @@ 头与 hunk 首行同屏；
 * 未定位过 / 重复行防御（map 只记首个命中）。
 */
const scrollIndexByRowIndex = computed<Map<number, number>>(() => {
  const map = new Map<number, number>()
  let headerRunStart: number | null = null
  items.value.forEach((item, unitIndex) => {
    if (item.kind === 'header') {
      if (headerRunStart === null) headerRunStart = unitIndex
      return
    }
    if (item.kind === 'line' && !map.has(item.rowIndex)) {
      map.set(item.rowIndex, headerRunStart ?? unitIndex)
    }
    headerRunStart = null
  })
  return map
})

/**
 * 量测某行顶部在滚动内容坐标系中的位置（px）：目标行已渲染时按真实盒位置
 * 计算（视口坐标差 + 当前 scrollTop），对换行模式（行高不均）与「全部展开」
 * 工具条的常量偏移都天然精确。行未渲染（虚拟窗口外 / 被折叠剔除）返回
 * null，由 scrollToRow 回退公式路径。data-nav-row 标在每行首个单元格上
 * （行分组 .diff-row 为 display:contents，无自身盒子可查）。
 */
function measureRowTop(el: HTMLElement, rowIndex: number): number | null {
  const cell = el.querySelector<HTMLElement>(`[data-nav-row="${rowIndex}"]`)
  if (cell === null) return null
  return cell.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
}

/**
 * 滚动到指定行（原始 rows 下标空间）：优先 DOM 量测（已渲染即精确），回退
 * 等行高公式 scrollTop = 单元下标 × DIFF_ROW_HEIGHT（非换行模式所有渲染
 * 单元严格等高、顶部 spacer 由虚拟模型给出，scrollTop 即内容坐标；换行
 * 模式恒全量渲染，DOM 路径必命中，公式路径不会启用）。定位失败（行被折叠
 * 剔除等契约外场景）debug 记录并跳过，不中断导航。
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
    console.debug('[UnifiedDiffView] 导航锚点行无法定位，跳过滚动：', rowIndex)
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
      const anchor = navStore.currentAnchor
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
    唯一滚动容器（纵向）：与 SplitDiffView 同款结构。is-wrap 承载换行开关
    （wrapLongLines，同时是虚拟滚动的直通开关，见文件头「虚拟滚动」），
    换行 / 长行截断的公共行为由 main.css 的 .is-wrap 规则承载。viewEl 供
    useVirtualRows 挂 scroll / ResizeObserver 监听。
  -->
  <div
    ref="viewEl"
    class="unified-view diff-text"
    :class="{ 'is-wrap': viewStore.wrapLongLines }"
    aria-label="统一差异视图"
  >
    <!--
      原「全部展开」sticky 工具条已随 UI-017 迁至主区右上工具条（App.vue 经
      本组件 defineExpose 暴露的 expandAll / isAnyCollapsed 接线），滚动内容
      内不再有置顶条带。
    -->
    <!-- 4 列网格：旧行号 | 新行号 | 记号 | 内容（列定义见 scoped 样式） -->
    <div class="unified-grid">
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
      <template v-for="item in visibleItems" :key="item.key">
        <!--
          合并控制条（UI-012）：横跨全部列的动作条（.diff-merge-bar 公共样式
          见 main.css），插在 @@ 头条之前 —— 控制条针对其下方的 hunk，头条
          保持与 hunk 首行相邻（顺序依据见文件头「合并更改控制条」）。
          轻量原生 button（ztools-ui ZButton 最小档 28px 高，放不进与行严格
          等高的 20px 控制条，见 main.css .diff-merge-btn 注释）。
        -->
        <div
          v-if="item.kind === 'merge'"
          class="diff-merge-bar"
          role="group"
          :aria-label="`合并第 ${item.hunkIndex + 1} 处更改`"
        >
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
        <!--
          hunk 头条：横跨全部列的 @@ 头（hunk.header 原样展示，ENG-008 产出）。
          与折叠条 / 合并控制条的相邻顺序（折叠条在前、控制条与头条在后）
          见文件头「折叠未更改行」与「合并更改控制条」。
        -->
        <div v-else-if="item.kind === 'header'" class="unified-hunk-header">{{ item.header }}</div>
        <!--
          折叠条（UI-008）：横跨全部列的真实按钮，点击展开该区段（expand）。
          公共样式 .diff-collapse-bar 见 main.css（--diff-gutter-bg 底 + 虚线边，
          与 --diff-hunk-bg 的头条视觉区分；文案 N=2 时保持「行」，中文量词
          无单复数变化）。
        -->
        <button
          v-else-if="item.kind === 'collapse'"
          type="button"
          class="diff-collapse-bar"
          :aria-label="`展开未更改的 ${item.count} 行`"
          @click="expand(item.beforeRow)"
        >⋯ 展开未更改的 {{ item.count }} 行</button>
        <!--
          行分组（display:contents，main.css 公共类 .diff-row）：行级 class 只承担
          语义与长行截断的作用域（is-long-line），以及当前导航 hunk 高亮
          （is-current-hunk，UI-010，gutter / 记号列底色高亮，公共样式见
          main.css），自身不产生盒子；4 个单元格按序落入网格列轨道。行号 /
          记号 / 内容三列消费公共类 .diff-gutter / .diff-sign / .diff-content
          （与并排视图共用同一份行样式）。
        -->
        <div
          v-else
          class="diff-row"
          :class="{ 'is-long-line': item.line.longLine, 'is-current-hunk': item.line.isCurrent }"
        >
          <!--
            首个单元格带 data-nav-row（原始 rows 下标）：hunk 导航滚动定位的
            DOM 量测锚点（scrollToRow 的 measureRowTop 按它查行，见 script）。
          -->
          <div
            class="diff-gutter"
            :class="`is-tone-${item.line.tone}`"
            :data-nav-row="item.rowIndex"
          >{{ item.line.oldLineNo ?? '' }}</div>
          <div
            class="diff-gutter unified-gutter-new"
            :class="`is-tone-${item.line.tone}`"
          >{{ item.line.newLineNo ?? '' }}</div>
          <div
            class="diff-sign"
            :class="`is-tone-${item.line.tone}`"
          >{{ item.line.sign }}</div>
          <!--
            内容：INT-001 起支持语法 spans 渲染 —— 生效语言非 plaintext 且该
            行解析出语法类时按 spans 渲染（cls 为 tok-* 类名，样式见 main.css
            的 --syntax-* 段），否则纯文本（语义决策：unified 无词级 spans，
            行底色红绿不变，语法色只作用于文字）。spans 按序拼接恒等于 text；
            mustache 紧贴标签避免引入多余空白（内容列 white-space: pre，
            空白节点会原样显示）。内容格为纯展示（原点击编辑入口已撤除，
            见文件头）。
          -->
          <div
            class="diff-content"
            :class="`is-tone-${item.line.tone}`"
          ><template v-if="item.line.spans !== null"><span
            v-for="(span, spanIndex) in item.line.spans"
            :key="spanIndex"
            :class="span.cls"
          >{{ span.text }}</span></template><template v-else>{{ item.line.text }}</template><span
            v-if="item.line.longLine && viewStore.wrapLongLines"
            class="diff-long-line-hint"
            title="超长行已截断，完整展开交互将在后续版本提供"
          >展开</span>
          </div>
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
 * 样式组织：行号 / 记号 / 内容三列的公共行样式（含色调、换行开关、长行截断、
 * 「展开」提示）消费 main.css 的 .diff-* 全局类（与 SplitDiffView 共用一份，
 * 见文件头「样式组织」）；本组件 scoped 样式只保留统一视图专属布局量。
 */
.unified-view {
  /*
   * 列宽 token（组件局部布局量，非颜色 token）：两列行号各随结果行数位数
   * 自适应（UI-015）—— 来源是 App.vue 注入到 .result-stage 的共享变量
   * --gutter-w（diffGutterWidthPx：≤3 位 40px / 4–5 位 52px / ≥6 位 64px，
   * 见 stores/view.ts），与并排视图同一来源保证两视图行号列宽一致；
   * 记号列容纳单个 −/+ 字符。sticky 偏移（下方 .unified-gutter-new 与
   * .diff-sign）消费同一变量，恒同步。
   */
  --uni-gutter-w: var(--gutter-w, 40px);
  --uni-sign-w: 16px;

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
 * 行模型：4 列网格（旧行号 | 新行号 | 记号 | 内容）。内容列 minmax(0, 1fr)：
 * 列宽恒等于容器剩余宽度、与内容长短无关 —— 任何超长行都不会撑宽列轨道
 * （不撑爆布局的第一道保证），超出部分交给单元格自身横向滚动 / 换行策略。
 * 非 wrap 模式下所有渲染单元（显示行 / hunk 头条 / 折叠条）高度恰为
 * --diff-line-height（保证链见 main.css 的 .diff-content / .diff-collapse-bar
 * 与本文件 .unified-hunk-header 注释），是虚拟滚动（UI-009）等行高计高的
 * 结构前提。
 */
.unified-grid {
  display: grid;
  grid-template-columns:
    var(--uni-gutter-w) var(--uni-gutter-w) var(--uni-sign-w) minmax(0, 1fr);
}

/*
 * 新行号列（第二列 gutter）：sticky left 偏移 = 旧行号列宽（防御性声明，
 * 与 SplitDiffView 的 gutter 策略一致 —— 网格本体无横向滚动，天然恒定可见；
 * 基础 sticky / 对齐 / 配色声明来自公共类 .diff-gutter）。
 */
.unified-gutter-new {
  left: var(--uni-gutter-w);
}

/* 记号列 sticky 偏移 = 两列行号总宽（防御性声明，基础声明来自 .diff-sign） */
.diff-sign {
  left: calc(var(--uni-gutter-w) * 2);
}

/*
 * hunk 头条：横跨全部列的 @@ 头条带（底色 --diff-hunk-bg，等宽字 —— 字族
 * 继承根节点 .diff-text，字号 12px 对齐 roadmap §3.2 的 12–13px 档，
 * UI-015 调整）。white-space: pre 保留 @@ 头原文内的连续空格（hunk.header
 * 原样展示）；文案弱化色从宿主文字 token color-mix 派生，不硬编码色值。
 * line-height = 行高且无竖向 padding：总高恰为 var(--diff-line-height)
 * （虚拟滚动 UI-009 统一计高的渲染单元之一）。
 */
.unified-hunk-header {
  grid-column: 1 / -1;
  padding: 0 12px;
  font-size: 12px;
  line-height: var(--diff-line-height);
  white-space: pre;
  background-color: var(--diff-hunk-bg);
  color: color-mix(in srgb, var(--text-color, #333333) 70%, transparent);
}
</style>
