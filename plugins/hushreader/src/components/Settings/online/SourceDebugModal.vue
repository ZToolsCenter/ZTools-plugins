<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue'
import type { BookSource } from '../../../utils/onlineBook'
import { sourceDisplayName, debugSearchSource, debugTocSource, debugContentSource, type DebugLog } from '../../../utils/onlineBook'
import { useOnlineStore } from '../../../stores/online'

const props = defineProps<{
  source: BookSource
  groupId: string
  index: number
}>()

const emit = defineEmits<{ close: [] }>()

const onlineStore = useOnlineStore()

type DebugMode = 'search' | 'toc' | 'content'
const mode = ref<DebugMode>('search')
const keyword = ref('')
const running = ref(false)
const logs = ref<DebugLog[]>([])
const logBoxRef = ref<HTMLDivElement | null>(null)

onMounted(() => {
  keyword.value = '我的'
})

function cookieCtx() {
  return {
    getCookie: (url: string) => onlineStore.jarCookie(url),
    saveCookies: (url: string, cookies: string[]) => onlineStore.saveJarCookies(url, cookies)
  }
}

async function run() {
  const input = keyword.value.trim()
  if (!input) return
  running.value = true
  logs.value = []
  await nextTick()
  try {
    if (mode.value === 'search') {
      await debugSearchSource(input, props.source, cookieCtx(), logs.value)
    } else if (mode.value === 'toc') {
      await debugTocSource(input, props.source, cookieCtx(), logs.value)
    } else {
      await debugContentSource(input, props.source, cookieCtx(), logs.value)
    }
  } catch (e: any) {
    logs.value.push({
      time: '',
      level: 'error',
      msg: `调试过程异常：${e?.message || e}`
    })
    console.warn('[hushreader:debug] 调试过程异常', e)
  } finally {
    running.value = false
    scrollToBottom()
  }
}

function scrollToBottom() {
  nextTick(() => {
    const el = logBoxRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function clearLogs() {
  logs.value = []
}
</script>

<template>
  <div class="debug-overlay" @click.self="emit('close')">
    <div class="debug-box">
      <div class="debug-header">
        <div>
          <h3 class="debug-title">书源调试</h3>
          <p class="debug-sub">{{ sourceDisplayName(source) }}</p>
        </div>
        <button class="debug-close" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="debug-body">
        <!-- 模式与输入 -->
        <div class="mode-tabs">
          <button class="mode-tab" :class="{ active: mode === 'search' }" @click="mode = 'search'; clearLogs()">搜索</button>
          <button class="mode-tab" :class="{ active: mode === 'toc' }" @click="mode = 'toc'; clearLogs()">目录</button>
          <button class="mode-tab" :class="{ active: mode === 'content' }" @click="mode = 'content'; clearLogs()">正文</button>
        </div>
        <div class="input-row">
          <input
            v-model="keyword"
            class="debug-input"
            :placeholder="mode === 'search' ? '输入关键词，例如：凡人修仙传' : (mode === 'toc' ? '输入目录页地址（可在搜索结果里复制书籍地址）' : '输入章节正文页地址')"
            @keydown.enter="run"
          />
          <button class="btn-primary" :disabled="running || !keyword.trim()" @click="run">
            <span v-if="running" class="spinner" style="width:13px;height:13px;border-width:1.5px;margin-right:4px"></span>
            {{ running ? '调试中…' : '开始调试' }}
          </button>
          <button v-if="logs.length" class="btn-secondary" @click="clearLogs">清空</button>
        </div>

        <!-- 日志区 -->
        <div ref="logBoxRef" class="log-box mono">
          <div v-if="logs.length === 0" class="log-empty">
            {{ running ? '调试中…' : '点击「开始调试」查看请求与规则解析的完整过程。' }}
          </div>
          <div v-for="(l, i) in logs" :key="i" class="log-line" :class="l.level">
            <span v-if="l.time" class="log-time">{{ l.time }}</span>
            <span class="log-msg">{{ l.msg }}</span>
          </div>
        </div>

        <p class="debug-hint">调试过程同时输出到控制台（console）。搜索无结果时重点看：请求是否成功、响应是否为搜索页内容、bookList 是否命中、示例结果字段是否为空。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-overlay {
  position: fixed;
  inset: 0;
  background: var(--c-overlay-bg);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 8000;
  animation: fade-in 0.15s var(--ease-out);
}

.debug-box {
  background: var(--c-surface-overlay);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-xl);
  width: min(640px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  animation: slide-up 0.2s var(--ease-out);
}

.debug-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--c-border);
  flex-shrink: 0;
}

.debug-title {
  font-size: 15px;
  font-weight: 700;
}

.debug-sub {
  font-size: 12px;
  color: var(--c-ink-tertiary);
  margin-top: 2px;
}

.debug-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  color: var(--c-ink-tertiary);
  transition: background 0.12s var(--ease-out), color 0.12s var(--ease-out);
}

.debug-close:hover {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
}

.debug-body {
  padding: 14px 20px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mode-tabs {
  display: flex;
  gap: 6px;
}

.mode-tab {
  padding: 5px 14px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;
  color: var(--c-ink-secondary);
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  transition: all 0.15s var(--ease-out);
}

.mode-tab:hover {
  border-color: var(--c-border-strong);
  color: var(--c-ink);
}

.mode-tab.active {
  background: var(--c-accent);
  border-color: var(--c-accent);
  color: var(--c-ink-inverse);
}

.input-row {
  display: flex;
  gap: 8px;
}

.debug-input {
  flex: 1;
  min-width: 0;
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 12px;
}

.debug-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
  outline: none;
}

.btn-primary,
.btn-secondary {
  padding: 7px 16px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  flex-shrink: 0;
  transition: all 0.15s var(--ease-out);
}

.btn-primary {
  background: var(--c-accent);
  color: var(--c-ink-inverse);
}

.btn-primary:hover {
  background: var(--c-accent-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--c-border-strong);
}

.log-box {
  height: 300px;
  overflow-y: auto;
  background: var(--c-surface-sunken);
  border: 1px solid var(--c-border);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.log-empty {
  color: var(--c-ink-tertiary);
  font-size: 12px;
  text-align: center;
  padding: 40px 0;
}

.log-line {
  display: flex;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.6;
  word-break: break-all;
}

.log-time {
  color: var(--c-ink-tertiary);
  flex-shrink: 0;
}

.log-line.ok .log-msg { color: var(--c-success); }
.log-line.warn .log-msg { color: var(--c-warning); }
.log-line.error .log-msg { color: var(--c-danger); }
.log-line.info .log-msg { color: var(--c-ink); }

.debug-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--c-ink-tertiary);
}
</style>
