<script setup lang="ts">
import { ref } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: string[]
  placeholder?: string
}>(), {
  placeholder: '输入标签，回车添加…',
})

const emit = defineEmits<{
  (e: 'update:modelValue', tags: string[]): void
}>()

const inputValue = ref('')

function addTag() {
  const t = inputValue.value.trim()
  if (!t || props.modelValue.includes(t)) { inputValue.value = ''; return }
  emit('update:modelValue', [...props.modelValue, t])
  inputValue.value = ''
}

function removeTag(tag: string) {
  emit('update:modelValue', props.modelValue.filter(t => t !== tag))
}
</script>

<template>
  <div class="tags-input">
    <span v-for="t in modelValue" :key="t" class="chip">
      {{ t }}
      <button class="chip-x" @click="removeTag(t)"><X :size="10" /></button>
    </span>
    <input
      v-model="inputValue"
      class="tags-field"
      :placeholder="modelValue.length ? '继续添加…' : placeholder"
      @keydown.enter.prevent="addTag"
    />
  </div>
</template>

<style scoped>
.tags-input {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  min-height: 34px;
  padding: 4px 8px;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-surface);
  cursor: text;
  transition: border-color 0.15s;
}
.tags-input:focus-within {
  border-color: var(--pf-accent);
  box-shadow: 0 0 0 3px var(--pf-accent-soft);
}
.chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px;
  background: var(--pf-accent-soft);
  color: var(--pf-accent);
  border-radius: var(--pf-radius-pill);
  font-size: 12px; font-weight: 500;
  line-height: 1.4;
}
.chip-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 14px; height: 14px;
  border-radius: 50%;
  color: var(--pf-accent);
  opacity: 0.6;
  transition: all 0.12s;
}
.chip-x:hover { opacity: 1; background: var(--pf-accent); color: #fff; }
.tags-field {
  flex: 1; min-width: 80px;
  height: 24px;
  border: none; outline: none;
  background: none;
  font-size: 13px;
  color: var(--pf-text);
}
.tags-field::placeholder { color: var(--pf-text-faint); }
</style>
