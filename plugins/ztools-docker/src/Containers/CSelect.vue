<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  options: Array<{ value: string; label: string }>
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'change'): void
}>()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

const current = computed(() => props.options.find((o) => o.value === props.modelValue))

function toggle() {
  if (!props.disabled) open.value = !open.value
}

function select(v: string) {
  if (v === props.modelValue) {
    open.value = false
    return
  }
  emit('update:modelValue', v)
  emit('change')
  open.value = false
}

function onDocClick(e: MouseEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="rootEl" class="cselect" :class="{ disabled }">
    <div class="cselect-box" @click="toggle">
      <span class="cselect-value" :class="{ placeholder: !current }">
        {{ current ? current.label : placeholder || '请选择' }}
      </span>
      <span class="cselect-arrow" :class="{ up: open }"></span>
    </div>
    <div v-if="open" class="cselect-list">
      <div
        v-for="o in options"
        :key="o.value"
        class="cselect-option"
        :class="{ active: o.value === modelValue }"
        @click="select(o.value)"
      >
        {{ o.label }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.cselect { position: relative; display: inline-block; min-width: 120px; }
.cselect.disabled { opacity: 0.4; cursor: not-allowed; }
.cselect-box {
  display: flex;
  align-items: center;
  gap: 6px;
  height: var(--ctrl-height);
  border: 1px solid var(--border-color);
  background: var(--panel-bg);
  color: inherit;
  border-radius: var(--ctrl-radius);
  padding: 0 10px;
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
}
.cselect.disabled .cselect-box { cursor: not-allowed; }
.cselect-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.cselect-value.placeholder { color: var(--text-secondary); }
.cselect-arrow {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.cselect-arrow.up { transform: rotate(180deg); }
.cselect-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 2px;
  background: #fff;
  border: 1px solid var(--border-color);
  border-radius: var(--ctrl-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  z-index: 30;
  max-height: 220px;
  overflow-y: auto;
  padding: 3px;
}
@media (prefers-color-scheme: dark) {
  .cselect-list { background: #2b2b2b; }
}
.cselect-option {
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cselect-option:hover { background: var(--panel-bg); }
.cselect-option.active { background: rgba(88, 164, 246, 0.15); color: var(--blue); }
</style>
