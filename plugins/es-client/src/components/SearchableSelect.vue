<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

export type SelectOption = { value: string; label: string }

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: Array<string | SelectOption>
    placeholder?: string
    width?: string
    disabled?: boolean
    allowClear?: boolean
  }>(),
  {
    placeholder: '搜索并选择…',
    width: '100%',
    disabled: false,
    allowClear: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const open = ref(false)
const filter = ref('')
const rootEl = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})

const normalized = computed<SelectOption[]>(() =>
  props.options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
)

const selectedLabel = computed(() => {
  const hit = normalized.value.find((o) => o.value === props.modelValue)
  return hit?.label ?? (props.modelValue || '')
})

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return normalized.value
  return normalized.value.filter(
    (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
  )
})

function syncClosedLabel() {
  if (!open.value) filter.value = selectedLabel.value
}

watch(
  () => [props.modelValue, selectedLabel.value, normalized.value.length] as const,
  () => syncClosedLabel(),
  { immediate: true },
)

function placeMenu() {
  const el = rootEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  menuStyle.value = {
    position: 'fixed',
    left: `${Math.round(r.left)}px`,
    top: `${Math.round(r.bottom + 2)}px`,
    width: `${Math.round(r.width)}px`,
    zIndex: '2000',
  }
}

function select(opt: SelectOption) {
  emit('update:modelValue', opt.value)
  filter.value = opt.label
  open.value = false
}

async function onFocus() {
  if (props.disabled) return
  open.value = true
  filter.value = ''
  await nextTick()
  placeMenu()
}

function onInput() {
  if (props.disabled) return
  open.value = true
  placeMenu()
}

async function toggleOpen() {
  if (props.disabled) return
  if (open.value) {
    open.value = false
    filter.value = selectedLabel.value
  } else {
    open.value = true
    filter.value = ''
    await nextTick()
    placeMenu()
  }
}

function onDocClick(e: MouseEvent) {
  const t = e.target as Node
  if (rootEl.value?.contains(t)) return
  const menus = document.querySelectorAll('.combo-list-portal')
  for (const m of menus) {
    if (m.contains(t)) return
  }
  open.value = false
  filter.value = selectedLabel.value
}

function onEscape() {
  open.value = false
  filter.value = selectedLabel.value
}

function onScrollOrResize() {
  if (open.value) placeMenu()
}

onMounted(() => {
  document.addEventListener('mousedown', onDocClick)
  window.addEventListener('scroll', onScrollOrResize, true)
  window.addEventListener('resize', onScrollOrResize)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocClick)
  window.removeEventListener('scroll', onScrollOrResize, true)
  window.removeEventListener('resize', onScrollOrResize)
})
</script>

<template>
  <div ref="rootEl" class="combo dropdown" :style="{ width: width || '100%' }">
    <div class="combo-input-wrap">
      <input
        v-model="filter"
        class="form-control form-control-sm combo-input"
        type="text"
        :placeholder="placeholder"
        :disabled="disabled"
        autocomplete="off"
        role="combobox"
        :aria-expanded="open"
        @focus="onFocus"
        @input="onInput"
        @keydown.enter.prevent="filtered[0] && select(filtered[0])"
        @keydown.escape="onEscape"
      />
      <button
        class="combo-caret"
        type="button"
        tabindex="-1"
        :disabled="disabled"
        aria-label="toggle"
        @mousedown.prevent="toggleOpen"
      />
    </div>
    <Teleport to="body">
      <ul
        v-show="open && !disabled"
        class="dropdown-menu show combo-list combo-list-portal"
        :style="menuStyle"
      >
        <li v-if="!filtered.length">
          <span class="dropdown-item-text text-muted">无匹配</span>
        </li>
        <li v-for="opt in filtered" :key="opt.value">
          <button
            type="button"
            class="dropdown-item"
            :class="{ active: opt.value === modelValue }"
            @mousedown.prevent="select(opt)"
          >
            {{ opt.label }}
          </button>
        </li>
      </ul>
    </Teleport>
  </div>
</template>

<style scoped>
.combo {
  position: relative;
  display: inline-block;
  min-width: 120px;
  vertical-align: middle;
}
.combo-input-wrap {
  position: relative;
}
.combo-input {
  padding-right: 1.6rem;
}
.combo-caret {
  position: absolute;
  right: 0.35rem;
  top: 50%;
  width: 0.55rem;
  height: 0.55rem;
  padding: 0;
  border: 0;
  background: transparent;
  transform: translateY(-65%) rotate(45deg);
  border-right: 1.5px solid var(--muted, #8b939e);
  border-bottom: 1.5px solid var(--muted, #8b939e);
  cursor: pointer;
}
.combo-caret:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>

<style>
.combo-list-portal {
  max-height: 240px;
  overflow: auto;
  margin: 0;
  padding: 0.25rem 0;
  display: block;
}
.combo-list-portal .dropdown-item {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
