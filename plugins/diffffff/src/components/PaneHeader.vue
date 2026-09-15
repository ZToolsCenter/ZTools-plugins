<!--
  PaneHeader（本任务自 App.vue 抽取）：双栏 pane 顶部栏，左右两侧复用。

  职责（原 App.vue 的 pane-header 段原样迁移，行为不变）：
  - 左侧统计徽标：本任务起由「N 行」升级为「N 字符 · M 行」（原 InputEditor
    底部统计条的信息口径，底部条随之撤除）；hover 徽标弹出统计悬浮
    （.copy-stats-pop）—— 分「行 / 字符」两节展示 总计 与 变化量（左侧 =
    删除、右侧 = 添加，含占比与计数）；
  - 右侧动作组：「打开编码」选择器（全局单值，两侧绑定同一 encoding prop）
    + 打开文件 / 粘贴 / 全部复制三个图标按钮。

  数据口径（悬浮两节与徽标同源）：
  - 总计 = 该侧当前输入文本的实时字符数 / 行数（行数按 CRLF / CR / LF 切分，
    与 CodeMirror 行口径一致）—— 编辑后即时更新；
  - 变化量 = 最近一次成功对比的引擎统计（result 为 null / ok:false 时为 0，
    此时悬浮只呈现总计）—— 行数取 DiffStats 的 removedLines / addedLines，
    字符数取 core/stats.ts 的 sideChangedChars（同一口径：只计 del / add 行，
    modify 对两侧不计入，避免重复计数）。

  事件全部上抛 App 编排（本组件不持有动作逻辑）：open / paste / copy /
  encoding（原始字符串载荷，字面量收窄与「结果态载入后自动重算」语义归
  App —— 结果态下经本顶部栏换文件 / 粘贴 / 切编码即视为重新编辑后查找差异）。
-->
<script setup lang="ts">
import { computed } from 'vue'
import UiButton from './ui/UiButton.vue'
import UiIcon from './ui/UiIcon.vue'
import UiSelect from './ui/UiSelect.vue'
import { workbenchStore } from '../stores/workbench'
import { diffStore } from '../stores/diff'
import { isDiffOk } from '../core/types'
import { sideChangedChars } from '../core/stats'
import type { FileEncoding, PaneSide } from '../composables/useFileLoad'

/** 组件 props */
interface Props {
  /** 所属侧别：决定统计的数据源与文案（左 = 原始文本、右 = 更改后文本） */
  side: PaneSide
  /** 当前全局「打开编码」（两侧顶部栏选择器绑定同一 App 级 ref，同值同步） */
  encoding: FileEncoding
}

const props = defineProps<Props>()

/**
 * 动作事件：具体载入 / 复制 / 编码收窄逻辑在 App.vue（含结果态自动重算的
 * 编排），本组件只上抛意图。encoding 载荷为选择器原始字符串，由 App 收窄。
 */
const emit = defineEmits<{
  open: []
  paste: []
  copy: []
  encoding: [value: string]
}>()

/** 侧别展示名：aria-label / title / 悬浮 aria 用（与 App 侧文案一致） */
const SIDE_LABELS: Record<PaneSide, string> = {
  left: '原始文本',
  right: '更改后文本',
}

const sideLabel = computed(() => SIDE_LABELS[props.side])

/** 该侧当前输入文本（实时统计的数据源） */
const sideText = computed(() =>
  props.side === 'left' ? workbenchStore.leftText : workbenchStore.rightText,
)

/**
 * 按文本行数计数的统一口径：空串为 0 行；按 CRLF / CR / LF 切分（与
 * CodeMirror 行切分口径一致，"a\r\nb" 计 2 行）。
 */
function countTextLines(text: string): number {
  if (text === '') return 0
  return text.split(/\r\n|\r|\n/).length
}

/**
 * 汇总该侧统计：总计取实时文本，变化量取最近一次成功对比的引擎统计
 * （无结果 / 失败结果时变化量为 0，悬浮照常展示总计）。
 */
const sideStats = computed(() => {
  const result = diffStore.result
  const ok = result !== null && isDiffOk(result)
  const text = sideText.value
  return {
    totalLines: countTextLines(text),
    totalChars: text.length,
    changedLines: ok
      ? props.side === 'left'
        ? result.stats.removedLines
        : result.stats.addedLines
      : 0,
    changedChars: ok ? sideChangedChars(result.rows, props.side) : 0,
  }
})

/** 统计数字文案（千分位） */
function formatStatCount(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * 变化量占比文案（恒带正号 + 1 位小数，如 '+35.9%'）：分母为该侧总量；
 * 总量为 0（空侧）时按 0% 呈现，不产生 NaN。
 */
function formatStatPercent(changed: number, total: number): string {
  const percent = total > 0 ? (changed / total) * 100 : 0
  return `+${percent.toFixed(1)}%`
}

/** 悬浮统计的一节视图模型（「行」/「字符」各一节，模板 v-for 消费） */
interface CopyStatsSectionVm {
  /** 节标题：'行' / '字符' */
  title: string
  /** 总计文案（千分位） */
  total: string
  /** 变化标签：左侧 = '删除'、右侧 = '添加' */
  changeLabel: string
  /** 变化量着色类：左侧 is-del（陶土红）、右侧 is-add（雾绿） */
  changeTone: 'is-del' | 'is-add'
  /** 变化量占比文案（+35.9% 形态） */
  changedPct: string
  /** 变化量计数文案（千分位） */
  changedCount: string
}

/** 组装该侧悬浮统计的两节视图模型（行 / 字符），标签与着色按侧别决策 */
const copySections = computed<CopyStatsSectionVm[]>(() => {
  const stats = sideStats.value
  const changeLabel = props.side === 'left' ? '删除' : '添加'
  const changeTone: 'is-del' | 'is-add' = props.side === 'left' ? 'is-del' : 'is-add'
  return [
    {
      title: '行',
      total: formatStatCount(stats.totalLines),
      changeLabel,
      changeTone,
      changedPct: formatStatPercent(stats.changedLines, stats.totalLines),
      changedCount: formatStatCount(stats.changedLines),
    },
    {
      title: '字符',
      total: formatStatCount(stats.totalChars),
      changeLabel,
      changeTone,
      changedPct: formatStatPercent(stats.changedChars, stats.totalChars),
      changedCount: formatStatCount(stats.changedChars),
    },
  ]
})

/**
 * 「打开编码」选择器候选：UI 仅暴露三项（顺序即展示顺序，UTF-8 默认在前）；
 * 'utf-16be' 是 preload API 级能力不进 UI（BE 文件极少，UI 保持精简）。
 */
const ENCODING_SELECT_OPTIONS: { label: string; value: FileEncoding }[] = [
  { label: 'UTF-8', value: 'utf-8' },
  { label: 'GBK', value: 'gbk' },
  { label: 'UTF-16', value: 'utf-16' },
]

/** 编码选择器回调：UiSelect 载荷恒为 string，原样上抛（收窄归 App） */
function onEncodingSelect(value: string): void {
  emit('encoding', value)
}
</script>

<template>
  <div class="pane-header">
    <!--
      左侧统计徽标：「N 字符 · M 行」（原底部统计条口径，本任务起驻此替代
      「N 行」），hover 弹出统计悬浮（行 / 字符明细跟随徽标展示）。
    -->
    <span class="copy-stats-group">
      <span class="pane-title pane-line-count" :aria-label="`${sideLabel}总字符与行数`">
        {{ formatStatCount(sideStats.totalChars) }} 字符 · {{ formatStatCount(sideStats.totalLines) }} 行
      </span>
      <div class="copy-stats-pop" role="tooltip" :aria-label="`${sideLabel}差异统计`">
        <div
          v-for="section in copySections"
          :key="section.title"
          class="copy-stats-section"
        >
          <p class="copy-stats-title">{{ section.title }}</p>
          <div class="copy-stats-row">
            <span class="copy-stats-label">总计</span>
            <span class="copy-stats-num">{{ section.total }}</span>
          </div>
          <div class="copy-stats-row">
            <span class="copy-stats-label">{{ section.changeLabel }}</span>
            <span class="copy-stats-num">
              <span class="copy-stats-pct" :class="section.changeTone">{{ section.changedPct }}</span>{{ section.changedCount }}
            </span>
          </div>
        </div>
      </div>
    </span>
    <div class="pane-header-actions">
      <!--
        「打开编码」选择器（INT-005 全局单值）：title 为原生 tooltip，GBK 等
        编码对非法字节序列按 TextDecoder 标准以替换符呈现不抛错，乱码时切换
        编码即按新编码重读来源文件（App 侧编排）。外层定宽 span 控制触发器宽度。
      -->
      <span class="pane-encoding">
        <UiSelect
          :model-value="encoding"
          :options="ENCODING_SELECT_OPTIONS"
          title="打开文件与拖入文件的解码编码；若出现乱码请切换编码重新载入"
          aria-label="文件解码编码"
          @update:model-value="onEncodingSelect"
        />
      </span>
      <!-- 打开文件（图标钮）：useFileLoad 降级安全链路（App 编排） -->
      <UiButton
        variant="ghost"
        class="pane-icon-btn"
        title="打开文件"
        aria-label="打开文件"
        @click="emit('open')"
      >
        <UiIcon name="folder-open" :size="18" />
      </UiButton>
      <!-- 粘贴（图标钮）：读剪贴板写入本侧（App 编排，空剪贴板 / 覆盖确认在链路内） -->
      <UiButton
        variant="ghost"
        class="pane-icon-btn"
        :title="`粘贴剪贴板文本到「${sideLabel}」`"
        aria-label="粘贴"
        @click="emit('paste')"
      >
        <UiIcon name="clipboard" :size="18" />
      </UiButton>
      <!-- 全部复制（图标钮）：复制该侧全部文本 -->
      <UiButton
        variant="ghost"
        class="pane-icon-btn"
        :title="`复制全部${sideLabel}`"
        aria-label="全部复制"
        @click="emit('copy')"
      >
        <UiIcon name="copy" :size="18" />
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
/*
 * pane 顶部栏：统计徽标靠左、图标按钮居右（发丝下边线，卡内首行）。
 * 输入态嵌在 .editor-pane 卡内、结果态由 App 的 .result-headers 行宿主
 * （两侧并排 + 中缝分隔线），自身只负责行内排版。position: relative 供
 * 统计悬浮（.copy-stats-pop）锚定顶栏盒自身（贴顶栏底缘，见该规则注释）。
 */
.pane-header {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px 5px 14px;
  font-size: 12px;
  line-height: 20px;
  border-bottom: 1px solid var(--divider-color, #edeae3);
}

/*
 * 左侧统计徽标（原「N 行」位）：沿用弱化口径（opacity 只作用于文案本身），
 * 等宽字体 + tabular-nums（编辑时数字抖动小）。
 */
.pane-title {
  color: var(--text-color, #2e2c28);
  opacity: 0.72;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.pane-line-count {
  font-family: var(--font-mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 右侧动作组：编码选择器 + 三个独立图标按钮 */
.pane-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

/*
 * 图标按钮：正方形小钮（ghost 无边框，说明由 title / aria-label 承担）。
 * 选择器带父级 + .ui-btn 提升特异性：UiButton 自身 scoped 的
 * .ui-btn.size-small（两个类 + scope 属性）与单类覆盖同分时会依赖样式注入
 * 顺序，padding 归零不生效时定宽按钮的内容区只剩个位数 px、图标被挤压
 * 变小 —— 此处恒胜出，不依赖顺序。
 */
.pane-header-actions :deep(.ui-btn.pane-icon-btn) {
  flex: none;
  width: 28px;
  padding: 0;
}

/* 编码选择器外层定宽（88px）：候选最长「UTF-16」+ 箭头足够 */
.pane-encoding {
  flex: none;
  display: inline-flex;
  width: 88px;
  min-width: 0;
}

/*
 * 左侧「统计徽标 + 统计悬浮」组：hover 徽标弹出统计悬浮。本组刻意不带
 * position —— 悬浮锚定顶栏盒（.pane-header，见 .copy-stats-pop 注释），
 * 此处再设 relative 会把悬浮定位上下文抢回徽标，破坏贴底与文字对齐。
 * 悬浮是本组的 DOM 后代：鼠标移入悬浮本体期间本组 :hover 仍成立，配合
 * 收起宽限期（.copy-stats-pop 的 visibility 延迟）浮窗可安全移入、不闪关。
 */
.copy-stats-group {
  flex: none;
  min-width: 0;
  display: inline-flex;
  align-items: center;
}

/* 展开：hover / 键盘聚焦徽标；鼠标移入浮窗本体时经后代链同样命中本组 */
.copy-stats-group:hover .copy-stats-pop,
.copy-stats-group:focus-within .copy-stats-pop {
  visibility: visible;
  opacity: 1;
  transition-delay: 0s;
}

/* 统计悬浮：纸卡（白面 + 发丝边 + 阴影）。
 * 垂直定位：锚定 .pane-header（顶栏盒）—— top: 100% 即顶栏 padding-box
 * 底缘，再下移 1px 跨过发丝下边线，悬浮顶边正好贴住顶部栏可见底边
 * （不留缝、不遮线）；锚定顶栏盒而非徽标，间距不随徽标行高漂移。
 * 水平定位：left 1px + 浮窗左边框 1px + 内边距 12px，浮窗内文字左缘落在
 * 距顶栏 padding-box 左缘 14px 处，与徽标文字（顶栏 padding-left 14px）
 * 左对齐；若顶栏 / 浮窗 padding 调整需同步此值。
 * 展开收起用 visibility + opacity（display 无法过渡）：收起分三段 —— 先保持
 * 完全可见 0.18s（宽限期，鼠标自徽标穿越下方间隙：行居中余量 3px + 顶栏
 * 底部内边距 5px + 边线 1px ≈ 9px，移入浮窗即重新展开）、再 0.12s 淡出、
 * 0.3s 后 visibility 才转 hidden（hidden 后不参与命中测试，不再拦截下方
 * diff 视图的点击）。pointer-events 恒开启使浮窗本体可移入可选中。
 */
.copy-stats-pop {
  position: absolute;
  top: calc(100% + 1px);
  left: 1px;
  z-index: 30;
  min-width: 176px;
  padding: 10px 12px 12px;
  border: 1px solid var(--border-color, #e8e4dc);
  border-radius: var(--radius-m, 8px);
  background-color: var(--surface, #ffffff);
  box-shadow: var(--shadow-1);
  pointer-events: auto;
  visibility: hidden;
  opacity: 0;
  transition:
    opacity 0.12s var(--ease-quiet) 0.18s,
    visibility 0s linear 0.3s;
}

/* 悬浮内「行 / 字符」两节：节间发丝分隔线区隔 */
.copy-stats-section + .copy-stats-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--divider-color, #edeae3);
}

/* 节标题（行 / 字符）：弱灰小字，同侧边栏分组小标题的安静口径 */
.copy-stats-title {
  margin: 0 0 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.6px;
  color: var(--text-secondary, #8a8377);
}

/* 统计行：标签居左、数字居右（等宽 + tabular-nums 对齐） */
.copy-stats-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 12px;
  line-height: 20px;
}

.copy-stats-label {
  color: var(--text-secondary, #8a8377);
}

.copy-stats-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-color, #2e2c28);
  white-space: nowrap;
}

/* 变化量占比：删除陶土红 / 添加雾绿（与底部统计条 +N/−M 徽标同族色） */
.copy-stats-pct {
  margin-right: 6px;
  font-weight: 600;
}

.copy-stats-pct.is-del {
  color: var(--diff-del-text, #96482f);
}

.copy-stats-pct.is-add {
  color: var(--diff-add-text, #3f6d4b);
}
</style>
