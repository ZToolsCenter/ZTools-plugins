<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    value?: unknown
    text?: string
    title?: string
    empty?: string
    maxHeight?: string
  }>(),
  {
    empty: '—',
    maxHeight: '',
  },
)

const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

const panel = ref<HTMLElement | null>(null)
const findOpen = ref(false)
const findQuery = ref('')
const findIndex = ref(0)
const findInput = ref<HTMLInputElement | null>(null)
const preRef = ref<HTMLElement | null>(null)

const display = computed(() => {
  if (props.text != null && props.text !== '') return props.text
  if (props.value === undefined || props.value === null || props.value === '') return ''
  if (typeof props.value === 'string') return props.value
  try {
    return JSON.stringify(props.value, null, 2)
  } catch {
    return String(props.value)
  }
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const matchOffsets = computed(() => {
  const q = findQuery.value
  const src = display.value
  if (!q || !src) return [] as number[]
  const out: number[] = []
  const lower = src.toLowerCase()
  const needle = q.toLowerCase()
  let from = 0
  while (from < lower.length) {
    const i = lower.indexOf(needle, from)
    if (i < 0) break
    out.push(i)
    from = i + Math.max(1, needle.length)
  }
  return out
})

const matchLabel = computed(() => {
  const n = matchOffsets.value.length
  if (!findQuery.value) return ''
  if (!n) return '0/0'
  return `${Math.min(findIndex.value, n - 1) + 1}/${n}`
})

const highlightedHtml = computed(() => {
  const src = display.value
  if (!src) return escapeHtml(props.empty)
  const q = findQuery.value
  if (!findOpen.value || !q) return escapeHtml(src)

  const offs = matchOffsets.value
  if (!offs.length) return escapeHtml(src)

  const active = ((findIndex.value % offs.length) + offs.length) % offs.length
  let html = ''
  let cursor = 0
  const qLen = q.length
  offs.forEach((start, i) => {
    html += escapeHtml(src.slice(cursor, start))
    const chunk = escapeHtml(src.slice(start, start + qLen))
    const cls = i === active ? 'json-find-hit json-find-active' : 'json-find-hit'
    html += `<mark class="${cls}" data-find-i="${i}">${chunk}</mark>`
    cursor = start + qLen
  })
  html += escapeHtml(src.slice(cursor))
  return html
})

watch(findQuery, () => {
  findIndex.value = 0
  nextTick(() => scrollActiveIntoView())
})

watch(findIndex, () => nextTick(() => scrollActiveIntoView()))

function scrollActiveIntoView() {
  const el = preRef.value?.querySelector('.json-find-active') as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function openFind() {
  findOpen.value = true
  nextTick(() => findInput.value?.focus())
}

function closeFind() {
  findOpen.value = false
  findQuery.value = ''
}

function findNext() {
  if (!matchOffsets.value.length) return
  findIndex.value = (findIndex.value + 1) % matchOffsets.value.length
}
function findPrev() {
  if (!matchOffsets.value.length) return
  findIndex.value =
    (findIndex.value - 1 + matchOffsets.value.length) % matchOffsets.value.length
}

function onPanelKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault()
    e.stopPropagation()
    openFind()
  }
  if (e.key === 'Escape' && findOpen.value) {
    e.preventDefault()
    closeFind()
  }
}

function onFindKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    if (e.shiftKey) findPrev()
    else findNext()
  }
}

function onDocKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return
  if (!panel.value?.contains(e.target as Node) && document.activeElement !== panel.value) {
    // allow when focus inside panel
    if (!panel.value?.contains(document.activeElement)) return
  }
  e.preventDefault()
  e.stopPropagation()
  openFind()
}

watch(findOpen, (open) => {
  if (open) document.addEventListener('keydown', onDocKey, true)
  else document.removeEventListener('keydown', onDocKey, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKey, true)
  if (timer) clearTimeout(timer)
})

async function copyJson() {
  const content = display.value
  if (!content) return
  try {
    await navigator.clipboard.writeText(content)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = content
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  try {
    window.services?.toast('已复制', 'success')
  } catch {
    // optional
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<template>
  <div
    ref="panel"
    class="json-panel"
    tabindex="0"
    @keydown="onPanelKey"
  >
    <div class="hrow json-head">
      <strong v-if="title">{{ title }}</strong>
      <slot name="title" />
      <div class="json-actions">
        <button
          class="btn btn-sm btn-secondary"
          type="button"
          :disabled="!display"
          title="Ctrl+F"
          @click="openFind"
        >
          查找
        </button>
        <button
          class="btn btn-sm btn-secondary"
          type="button"
          :disabled="!display"
          @click="copyJson"
        >
          {{ copied ? '已复制' : '复制' }}
        </button>
      </div>
    </div>
    <div v-if="findOpen" class="find-bar" @mousedown.prevent>
      <input
        ref="findInput"
        v-model="findQuery"
        class="form-control form-control-sm find-input"
        type="search"
        placeholder="在 JSON 中查找…"
        @keydown="onFindKey"
      />
      <span class="find-count muted">{{ matchLabel }}</span>
      <button class="btn btn-sm btn-secondary" type="button" :disabled="!matchOffsets.length" @click="findPrev">↑</button>
      <button class="btn btn-sm btn-secondary" type="button" :disabled="!matchOffsets.length" @click="findNext">↓</button>
      <button class="btn btn-sm btn-secondary" type="button" @click="closeFind">×</button>
    </div>
    <pre
      ref="preRef"
      class="json-view"
      tabindex="0"
      :style="maxHeight ? { maxHeight, overflow: 'auto' } : undefined"
      v-html="highlightedHtml"
      @keydown="onPanelKey"
    />
  </div>
</template>

<style scoped>
.json-panel {
  min-width: 0;
  outline: none;
}
.json-head {
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.json-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}
.find-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: var(--radius, 4px);
  background: var(--surface-2, var(--surface));
}
.find-input {
  flex: 1;
  min-width: 0;
}
.find-count {
  font-size: 12px;
  white-space: nowrap;
  min-width: 2.5em;
}
.json-view {
  outline: none;
}
</style>

<style>
.json-view .json-find-hit {
  background: rgba(255, 200, 0, 0.35);
  color: inherit;
  padding: 0;
}
.json-view .json-find-active {
  background: rgba(255, 140, 0, 0.65);
  outline: 1px solid rgba(255, 120, 0, 0.9);
}
</style>
