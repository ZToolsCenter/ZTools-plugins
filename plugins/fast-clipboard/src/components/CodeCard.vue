<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ClipboardRecord } from '../types'
import { KIND_META, relTime } from '../utils/format'
import { codeLangOf, codeLines, codeIsClipped, highlightLines, CODE_MAX_LINES } from '../utils/code'

/**
 * 代码记录卡片。
 *
 * 代码压成一行纯文本后换行与缩进全丢，等于不可读；
 * 这里还原成真正的代码块：等宽字体、保留缩进、标注语言与行数、
 * 并做轻量语法着色（只着色，不做完整解析，成本极低）。
 *
 * 行高由 layout.codeRowHeight 决定，这里只负责在给定高度内排版。
 *
 * 横向：代码块可横向滚动（滚轮 / 触控板横滑），溢出行不再被硬截断；
 * 但卡片宽度终究有限，要看全文点「展开」进全屏查看。
 */
const props = defineProps<{
  record: ClipboardRecord
  selected: boolean
  starred: boolean
}>()

const emit = defineEmits<{
  copy: []
  star: []
  remove: []
  /** 打开全屏查看（看完整代码，不被行数与宽度限制） */
  preview: []
}>()

const time = computed(() => relTime(props.record.createdAt))

/** 切分后的完整代码行（首尾空行已去掉） */
const allLines = computed(() => codeLines(props.record.content))

/** 折叠后实际渲染的行 */
const shownLines = computed(() => allLines.value.slice(0, CODE_MAX_LINES))

/** 被折叠掉的行数 */
const hidden = computed(() => Math.max(0, allLines.value.length - shownLines.value.length))

/**
 * 语言标签。识别不出就不显示 —— 宁可留白也不瞎标。
 * 着色用的也是同一个识别结果，两者始终一致。
 */
const lang = computed(() => codeLangOf(props.record.content))

/** 着色后的行（先转义再 token 化，可安全用于 v-html） */
const htmlLines = computed(() => highlightLines(shownLines.value, lang.value))

const lineText = computed(() => (allLines.value.length > 1 ? `${allLines.value.length} 行` : '单行'))

/** 有行被字符上限截断（提示文案要区分"本来就这么长"和"被截了"） */
const clipped = computed(() => codeIsClipped(props.record.content))

/* ------------------------------------------------------------------ */
/* 横向滚动：溢出检测 + 渐变提示                                        */
/* ------------------------------------------------------------------ */

const codeEl = ref<HTMLElement | null>(null)
/** 内容是否横向溢出（溢出才显示"还能往右滑"的渐变） */
const overflowX = ref(false)
/** 是否已经滑到最右（到了就收掉渐变，别挡着内容） */
const atEnd = ref(false)

function measure(): void {
  const el = codeEl.value
  if (!el) return
  overflowX.value = el.scrollWidth - el.clientWidth > 2
}

function onCodeScroll(): void {
  const el = codeEl.value
  if (!el) return
  atEnd.value = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2
}

let ro: ResizeObserver | null = null

onMounted(() => {
  const el = codeEl.value
  if (!el) return
  measure()
  ro = new ResizeObserver(measure)
  ro.observe(el)
})

onBeforeUnmount(() => ro?.disconnect())

/**
 * 换记录时把横向位置归零。
 * 虚拟列表按 id 复用组件实例，不归零的话上一条记录的滑动位置会带到下一条上，
 * 看起来就是"新卡片莫名其妙从中间开始显示"。
 */
watch(
  () => props.record.id,
  () => {
    const el = codeEl.value
    if (el && el.scrollLeft !== 0) el.scrollLeft = 0
    atEnd.value = false
    requestAnimationFrame(measure)
  }
)
</script>

<template>
  <div class="ccard" :class="{ sel: selected }" @click="emit('copy')">
    <div class="lead">
      <img class="type-icon" :src="KIND_META.code.icon" alt="代码" draggable="false" />
    </div>

    <div class="body">
      <div class="meta">
        <span v-if="lang" class="lang">{{ lang }}</span>
        <span class="lines">{{ lineText }}</span>
        <button
          v-if="clipped"
          class="scroll-hint clipped-hint"
          title="单行太长，卡片里放不下；点这里看完整内容"
          @click.stop="emit('preview')"
        >超长行已截断 · 展开看全部</button>
        <span v-else-if="overflowX" class="scroll-hint">可横滑</span>
      </div>

      <div class="code-wrap">
        <!-- 每行独立元素：行高可控，虚拟列表的预算高度才对得上 -->
        <div ref="codeEl" class="code" @scroll.passive="onCodeScroll">
          <div class="code-inner">
            <div v-for="(l, i) in htmlLines" :key="i" class="cline" v-html="l" />
          </div>
        </div>
        <div v-if="overflowX && !atEnd" class="fade" aria-hidden="true" />
      </div>

      <div v-if="hidden > 0" class="more">还有 {{ hidden }} 行（展开看全部）</div>
    </div>

    <div class="tail">
      <span class="time">{{ time }}</span>
      <span class="ops">
        <button class="op" title="展开看全部代码" @click.stop="emit('preview')">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" stroke="currentColor" />
          </svg>
        </button>
        <button class="op" :class="{ starred }" title="收藏" @click.stop="emit('star')">
          <svg class="icon-svg" viewBox="0 0 24 24" :fill="starred ? 'currentColor' : 'none'"
            stroke-width="1.6" stroke-linejoin="round">
            <path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17l-5.4 2.8 1.1-6.1L3.2 9.4l6.1-.8z"
              stroke="currentColor" />
          </svg>
        </button>
        <button class="op op-del" title="删除" @click.stop="emit('remove')">
          <svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke-width="1.7"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" />
          </svg>
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
.ccard {
  display: flex;
  align-items: stretch;
  gap: 12px;
  height: 100%;
  padding: 6px 14px 6px 12px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.1s;
  outline: none;
}

.ccard:hover { background: var(--hover); }
.ccard.sel { background: var(--accent-weak); }

.lead {
  width: 24px;
  flex: none;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 1px;
}

.type-icon {
  width: 20px;
  height: 20px;
  display: block;
  object-fit: contain;
}

.body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* 高度与下间距必须与 layout.CODE_META_H / CODE_META_GAP 一致 */
.meta {
  height: 16px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-3);
  margin-bottom: 4px;
}

.lang {
  padding: 0 5px;
  height: 15px;
  line-height: 15px;
  border-radius: 4px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--c-code);
  background: color-mix(in srgb, var(--c-code) 14%, transparent);
}

.lines { font-variant-numeric: tabular-nums; }

.scroll-hint {
  margin-left: auto;
  flex: none;
  font-size: 10.5px;
  opacity: 0.75;
}

/* 被我们截断过就得说出来（用户点它直接进全屏，所以做成可点的） */
.clipped-hint {
  color: var(--c-code);
  opacity: 0.95;
}

.clipped-hint:hover { text-decoration: underline; }

.code-wrap {
  position: relative;
  min-width: 0;
}

/* 恒定暗色底：不跟随主题，边框也要用暗底上才看得见的浅色描边 */
.code {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  overflow-x: auto;
  overflow-y: hidden;
  transition: background 0.1s;
  /* 横向滚动条一旦占位就会改变块高，而虚拟列表的行高是预算好的 —— 直接隐藏 */
  scrollbar-width: none;
}

.code::-webkit-scrollbar { display: none; }

/* 内容按最长行撑开：所有行共享同一个横向滚动位置，滚动时不会错位 */
.code-inner {
  width: max-content;
  min-width: 100%;
}

/* 行高必须与 layout.CODE_LINE_H 一致 */
.cline {
  height: 19px;
  line-height: 19px;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--code-fg);
  white-space: pre;
  tab-size: 2;
}

/* v-html 生成的 token 没有 scoped 标记，必须用 :deep 命中 */
.code :deep(.tk-kw) { color: var(--tk-kw); }
.code :deep(.tk-str) { color: var(--tk-str); }
.code :deep(.tk-com) { color: var(--tk-com); font-style: italic; }
.code :deep(.tk-num) { color: var(--tk-num); }
.code :deep(.tk-fn) { color: var(--tk-fn); }
.code :deep(.tk-type) { color: var(--tk-type); }

/* 右侧渐变：提示"右边还有内容" */
.fade {
  position: absolute;
  top: 1px;
  right: 1px;
  bottom: 1px;
  width: 30px;
  border-radius: 0 5px 5px 0;
  background: linear-gradient(90deg, transparent, var(--code-bg));
  pointer-events: none;
}

/* 暗块本身不随卡片 hover 变化，交互反馈会变弱 —— 让块底也跟着提亮一档 */
.ccard:hover .code,
.ccard.sel .code { background: var(--code-bg-hover); }

.ccard:hover .fade,
.ccard.sel .fade { background: linear-gradient(90deg, transparent, var(--code-bg-hover)); }

/* 行高必须与 layout.CODE_MORE_H 一致 */
.more {
  height: 18px;
  line-height: 18px;
  font-size: 11px;
  color: var(--text-3);
  opacity: 0.8;
}

.tail {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding-top: 3px;
}

.time {
  font-size: 11.5px;
  line-height: 18px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.ops {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s;
}

.ccard:hover .ops,
.ccard.sel .ops { opacity: 1; }

.op {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--text-3);
  transition: background 0.1s, color 0.1s;
}

.op:hover { background: var(--active); color: var(--text); }
.op.starred { color: var(--star); }
.op.op-del:hover { background: var(--danger-weak); color: var(--danger); }
</style>
