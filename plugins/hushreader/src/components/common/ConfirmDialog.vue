<script setup lang="ts">
import Modal from '../Bookshelf/Modal.vue'

defineProps<{
  title: string
  message: string
  confirmText?: string
  danger?: boolean
}>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Modal :title="title" @close="emit('cancel')">
    <div class="confirm-modal">
      <p class="confirm-message">{{ message }}</p>
      <div class="confirm-actions">
        <button class="btn-secondary" @click="emit('cancel')">取消</button>
        <button class="btn-danger" @click="emit('confirm')">{{ confirmText || '确认' }}</button>
      </div>
    </div>
  </Modal>
</template>

<style scoped>
.confirm-modal {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.confirm-message {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--c-ink);
  word-break: break-all;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-secondary,
.btn-danger {
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

.btn-danger {
  background: var(--c-danger);
  color: var(--c-ink-inverse);
}

.btn-danger:hover {
  opacity: 0.9;
}
</style>
