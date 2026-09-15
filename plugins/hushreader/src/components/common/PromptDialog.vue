<script setup lang="ts">
import { ref } from 'vue'
import Modal from '../Bookshelf/Modal.vue'

const props = defineProps<{
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmText?: string
}>()
const emit = defineEmits<{ confirm: [value: string]; cancel: [] }>()

const value = ref(props.initial ?? '')

function submit() {
  if (!value.value.trim()) return
  emit('confirm', value.value.trim())
}
</script>

<template>
  <Modal :title="title" @close="emit('cancel')">
    <div class="prompt-modal">
      <label v-if="label" class="prompt-label">{{ label }}</label>
      <input
        v-model="value"
        class="prompt-input"
        :placeholder="placeholder || '请输入…'"
        @keydown.enter="submit"
      />
      <div class="prompt-actions">
        <button class="btn-secondary" @click="emit('cancel')">取消</button>
        <button class="btn-primary" :disabled="!value.trim()" @click="submit">{{ confirmText || '确定' }}</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.prompt-modal {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prompt-label {
  font-size: 12px;
  color: var(--c-ink-secondary);
}

.prompt-input {
  background: var(--c-surface);
  border: 1px solid var(--c-border);
  color: var(--c-ink);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  width: 100%;
}

.prompt-input:focus {
  border-color: var(--c-accent);
  box-shadow: 0 0 0 3px var(--c-accent-soft);
  outline: none;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-secondary,
.btn-primary {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s var(--ease-out);
}

.btn-secondary {
  background: var(--c-surface-sunken);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}

.btn-secondary:hover {
  border-color: var(--c-border-strong);
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
</style>
