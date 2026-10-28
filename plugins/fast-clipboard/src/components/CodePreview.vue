<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ClipboardRecord } from '../types'
import { relTime } from '../utils/format'
import {
  codeLangOf, codeLines, highlightLines, CODE_PREVIEW_MAX_LINES
} from '../utils/code'

/**
 * 全屏代码查看层。
 *
 * 列表卡片为了能"扫"，只给 5 行、宽度也受限 —— 长代码在卡片里怎么都看不全。
 * 这里给完整内容：不折叠行数、不截断单行，默认自动换行保证一眼看全，
 * 也可关掉换行用横向滚动看原始排版。
 *
 * 键盘：Esc 关闭 / ←→ 切换 / Enter 复制（键盘由 App 统一处理）。
 */
const props = defineProps<{
  /** 当前记录（保证是 code 类型） */
  record: ClipboardRecord
  /** 当前是过滤结果中第几条可预览记录 */
  index: number
  /** 过滤结果中可预览记录总数 */
  total: number
}>()

const emit = defineEmits<{
  close: []
  prev: []
  next: []
  copy: [record: ClipboardRecord]
}>()

/** 自动换行：默认开，长行不必横滚就能看全 */
const wrap = ref(true)

/** 完整代码行（不截断字符；超过上限只渲染前面部分，复制仍带走全部） */
const allLines = computed(() => codeLines(props.record.content, 0))

const shownLines = computed(() => allLines.value.slice(0, CODE_PREVIEW_MAX_LINES))

/** 因上限被截掉的行数 */
const truncated = computed(() => Math.max(0, allLines.value.length - shownLines.value.length))

const lang = computed(() => codeLangOf(props.record.content))

const htmlLines = computed(() => highlightLines(shownLines.value, lang.value))

const metaLine = computed(() => {
  const parts: string[] = []
  if (lang.value) parts.push(lang.value)
  parts.push(`${allLines.value.length} 行`)
  if (props.record.appName) parts.push('来自 ' + props.record.appName)
  const t = relTime(props.record.createdAt)
  if (t) parts.push(t)
  return parts.join(' · ')
})

/**
 * 行号列宽度按总行数决定（等宽字体下 1ch 即一个数字宽），
 * 避免 3 位与 5 位行数撑出不同的宽度、让代码起点忽左忽右。
 */
const gutter = computed(() => `${String(shownLines.value.length).length}ch`)

// 换记录时保留用户的换行偏好，但滚动位置回到顶部（否则会停在上一条的偏移上）
const scroller = ref<HTMLElement | null>(null)
watch(
  () => props.record.id,
  () => {
    if (scroller.value) scroller.value.scrollTop = 0
  }
)

/**
 * 关掉自动换行后，长行要靠横向滚动看。
 * 但鼠标只有一个纵向滚轮，纵向又没得滚（代码只有几行）—— 滚轮会毫无反应，
 * 看起来像"卡住了"。这里在纵向滚不动时把滚轮转成横向滚动。
 */
function onWheel(e: WheelEvent): void {
  if (wrap.value) return
  const el = scroller.value
  if (!el) return
  // 纵向有得滚（长文件）就保持纵向；横向滚动本身（触控板/Shift）也不拦
  if (el.scrollHeight - el.clientHeight > 1) return
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
  const max = el.scrollWidth - el.clientWidth
  if (max <= 1) return
  const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY))
  if (next === el.scrollLeft) return
  el.scrollLeft = next
  e.preventDefault()
}
</script>

<template>
  <teleport to="body">
    <div class="preview-mask" @click.self="emit('close')">
      <!-- 顶栏：语言 / 行数 + 操作 -->
      <div class="preview-top">
        <span class="counter">{{ index + 1 }} / {{ total }}</span>
        <button
          class="btn"
          :class="{ on: wrap }"
          :title="wrap ? '当前：自动换行（点击改为横向滚动）' : '当前：横向滚动（点击改为自动换行）'"
          @click="wrap = !wrap"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M4 6h16M4 12h10a3 3 0 0 1 0 6h-3M4 12v6" stroke="currentColor" />
            <path d="M18 15l3 3-3 3" stroke="currentColor" />
          </svg>
          <span>自动换行</span>
        </button>
        <button class="btn" title="复制这段完整代码 (Enter)" @click="emit('copy', record)">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round"
            stroke-linejoin="round">
            <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" />
          </svg>
          <span>复制</span>
        </button>
        <button class="btn" title="关闭 (Esc)" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" />
          </svg>
        </button>
      </div>

      <!-- 主体：完整代码 -->
      <div class="preview-stage" @click.self="emit('close')">
        <div ref="scroller" class="code-scroll" :class="{ wrap }" @wheel="onWheel">
          <div class="code-block" :style="{ '--gutter': gutter }">
            <div v-for="(l, i) in htmlLines" :key="i" class="prow">
              <span class="ln">{{ i + 1 }}</span>
              <span class="lcode" v-html="l" />
            </div>
          </div>
        </div>

        <button v-if="total > 1" class="nav nav-prev" title="上一条 (←)" @click.stop="emit('prev')">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M15 5l-7 7 7 7" stroke="currentColor" />
          </svg>
        </button>
        <button v-if="total > 1" class="nav nav-next" title="下一条 (→)" @click.stop="emit('next')">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round">
            <path d="M9 5l7 7-7 7" stroke="currentColor" />
          </svg>
        </button>
      </div>

      <!-- 底栏：元信息 + 快捷键提示 -->
      <div class="preview-bottom">
        <span class="meta">
          {{ metaLine }}
          <template v-if="truncated > 0"> · 仅显示前 {{ CODE_PREVIEW_MAX_LINES }} 行（复制带走全部）</template>
        </span>
        <span class="hint">
          {{ wrap ? 'Esc 关闭 · ← → 切换 · Enter 复制' : '滚轮横向滚动 · Esc 关闭 · ← → 切换' }}
        </span>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.preview-mask {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: rgba(10, 12, 16, 0.82);
  backdrop-filter: blur(6px);
  animation: fade-in 0.15s ease-out;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

.preview-top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.85);
}

.counter {
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  margin-right: auto;
  opacity: 0.75;
}

.btn {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: none;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.12s;
}

.btn:hover { background: rgba(255, 255, 255, 0.2); }
.btn.on { background: rgba(120, 168, 255, 0.28); }
.btn svg { width: 15px; height: 15px; }

.preview-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  padding: 0 56px 8px;
}

/* 全屏里滚动条可以占位置：这里的高度不受虚拟列表预算约束 */
.code-scroll {
  flex: 1;
  min-width: 0;
  overflow: auto;
  border-radius: 8px;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  /* 滚动条常驻：横向能滚的时候要看得出来，别让人以为内容就到这儿了 */
  scrollbar-color: rgba(235, 240, 250, 0.22) transparent;
}

.code-scroll::-webkit-scrollbar { width: 9px; height: 9px; }
.code-scroll::-webkit-scrollbar-thumb {
  background: rgba(235, 240, 250, 0.22);
  border-radius: 5px;
}
.code-scroll::-webkit-scrollbar-track { background: transparent; }

.code-block {
  display: inline-block;
  min-width: 100%;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 19px;
  color: var(--code-fg);
}

.prow {
  display: flex;
  align-items: flex-start;
  /* 换行模式下行号与首行对齐，后续折行顶到行号右侧 */
}

.ln {
  flex: none;
  width: var(--gutter);
  /* 用 margin 而不是 padding 留间隔：全局 border-box 下 padding 会被
     width 吃掉，行号会贴着代码、数字还可能被压变形 */
  margin-right: 10px;
  text-align: right;
  color: var(--tk-com);
  opacity: 0.55;
  user-select: none;
  font-variant-numeric: tabular-nums;
  /* 关掉自动换行横向滚动时，行号固定在左侧不跟着滚走（否则滚两下就不知道在第几行了） */
  position: sticky;
  left: 0;
  background: var(--code-bg);
}

.lcode {
  flex: 1;
  min-width: 0;
  white-space: pre;
  tab-size: 2;
}

/* 自动换行：行内软折，长行不必横滚就能看全 */
.code-scroll.wrap .lcode {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.code-block :deep(.tk-kw) { color: var(--tk-kw); }
.code-block :deep(.tk-str) { color: var(--tk-str); }
.code-block :deep(.tk-com) { color: var(--tk-com); font-style: italic; }
.code-block :deep(.tk-num) { color: var(--tk-num); }
.code-block :deep(.tk-fn) { color: var(--tk-fn); }
.code-block :deep(.tk-type) { color: var(--tk-type); }

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
  cursor: pointer;
  transition: background 0.12s;
}

.nav:hover { background: rgba(255, 255, 255, 0.22); }
.nav svg { width: 20px; height: 20px; }
.nav-prev { left: 8px; }
.nav-next { right: 8px; }

.preview-bottom {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
}

.meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hint { flex: none; opacity: 0.6; }
</style>
