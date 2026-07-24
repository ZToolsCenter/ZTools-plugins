<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import trashIcon from '../assets/icons/trash-2.svg'
import xIcon from '../assets/icons/x.svg'
import SvgIcon from './SvgIcon.vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel?: string
}>()

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

function handleKeydown(event: KeyboardEvent) {
  if (!props.open || (event.key !== 'Escape' && event.key !== 'Enter')) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Enter') emit('confirm')
  else emit('cancel')
}

onMounted(() => window.addEventListener('keydown', handleKeydown, { capture: true }))
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown, { capture: true }))
</script>

<template>
  <dialog :open="open" class="modal">
    <header><strong>{{ title }}</strong></header>
    <p>{{ message }}</p>
    <footer>
      <button class="text-button" @click="emit('cancel')">
        <SvgIcon :src="xIcon" />
        取消
      </button>
      <button class="danger-button" @click="emit('confirm')">
        <SvgIcon :src="trashIcon" />
        {{ confirmLabel || '删除' }}
      </button>
    </footer>
  </dialog>
</template>

<style scoped>
.modal {
  position: fixed;
  inset: 50% auto auto 50%;
  width: min(420px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  transform: translate(-50%, -50%);
  border: 0;
  border-radius: 8px;
  padding: 0;
  background: var(--surface);
  color: var(--text);
  box-shadow: var(--shadow);
}

.modal:not([open]) {
  display: none;
}

.modal header,
.modal footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  user-select: none;
}

.modal footer {
  justify-content: flex-end;
  min-height: 56px;
  padding: 8px 16px 12px;
  border-top: 1px solid var(--line);
  border-bottom: 0;
}

.modal > p {
  display: flex;
  min-height: 64px;
  align-items: center;
  margin: 0;
  padding: 14px 16px;
}

.danger-button,
.text-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  border-radius: 7px;
  background: var(--danger);
  color: #fff;
}

.text-button {
  background: #e5e7eb;
  color: var(--text);
}

@media (prefers-color-scheme: dark) {
  .modal {
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(30, 30, 30, 0.82);
    box-shadow: 0 26px 74px rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(26px) saturate(135%);
  }

  .modal header,
  .modal footer {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .text-button {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
  }
}
</style>
