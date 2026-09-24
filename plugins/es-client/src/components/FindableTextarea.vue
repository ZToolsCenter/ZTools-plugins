<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue?: string
    rows?: number
    readonly?: boolean
    placeholder?: string
    class?: string
  }>(),
  {
    modelValue: '',
    rows: 10,
    readonly: false,
    placeholder: '',
    class: 'form-control mono',
  },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const root = ref<HTMLElement | null>(null)
const ta = ref<HTMLTextAreaElement | null>(null)
const findOpen = ref(false)
const findQuery = ref('')
const findIndex = ref(0)
const findInput = ref<HTMLInputElement | null>(null)

const text = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => emit('update:modelValue', v),
})

const matchOffsets = computed(() => {
  const q = findQuery.value
  const src = text.value
  if (!q) return [] as number[]
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

watch(findQuery, () => {
  findIndex.value = 0
  void jumpToMatch(0)
})

function openFind() {
  findOpen.value = true
  nextTick(() => findInput.value?.focus())
}

function closeFind() {
  findOpen.value = false
}

async function jumpToMatch(idx: number) {
  const offs = matchOffsets.value
  if (!offs.length || !ta.value) return
  const i = ((idx % offs.length) + offs.length) % offs.length
  findIndex.value = i
  const start = offs[i]
  const end = start + findQuery.value.length
  await nextTick()
  ta.value.focus()
  ta.value.setSelectionRange(start, end)
  // approximate scroll
  const linesBefore = ta.value.value.slice(0, start).split('\n').length - 1
  const lineHeight = 16
  ta.value.scrollTop = Math.max(0, linesBefore * lineHeight - 40)
  findInput.value?.focus()
}

function findNext() {
  void jumpToMatch(findIndex.value + 1)
}
function findPrev() {
  void jumpToMatch(findIndex.value - 1)
}

function onRootKey(e: KeyboardEvent) {
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
  if (!findOpen.value) return
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return
  if (!root.value?.contains(document.activeElement)) return
  e.preventDefault()
  openFind()
}

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocKey, true)
})

// capture Ctrl+F when textarea focused (browser default otherwise)
watch(findOpen, (open) => {
  if (open) document.addEventListener('keydown', onDocKey, true)
  else document.removeEventListener('keydown', onDocKey, true)
})
</script>

<template>
  <div ref="root" class="findable-wrap" tabindex="-1" @keydown="onRootKey">
    <div v-if="findOpen" class="find-bar" @mousedown.prevent>
      <input
        ref="findInput"
        v-model="findQuery"
        class="form-control form-control-sm find-input"
        type="search"
        placeholder="查找…"
        @keydown="onFindKey"
      />
      <span class="find-count muted">{{ matchLabel }}</span>
      <button class="btn btn-sm btn-secondary" type="button" :disabled="!matchOffsets.length" @click="findPrev">↑</button>
      <button class="btn btn-sm btn-secondary" type="button" :disabled="!matchOffsets.length" @click="findNext">↓</button>
      <button class="btn btn-sm btn-secondary" type="button" @click="closeFind">×</button>
    </div>
    <textarea
      ref="ta"
      v-model="text"
      :class="props.class"
      :rows="rows"
      :readonly="readonly"
      :placeholder="placeholder"
      spellcheck="false"
      @keydown="onRootKey"
    />
  </div>
</template>

<style scoped>
.findable-wrap {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.find-bar {
  display: flex;
  align-items: center;
  gap: 6px;
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
</style>
