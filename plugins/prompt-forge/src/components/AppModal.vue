<script setup lang="ts">
import { useModal } from '../composables/useModal'
import { useDialogFocus } from '../composables/useDialogFocus'

const modal = useModal()
const { dialogRef, trapFocus } = useDialogFocus(() => modal.state.value.visible)

function onKeydown(e: KeyboardEvent) {
  trapFocus(e)
  if (e.defaultPrevented) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    modal.handleCancel()
  } else if (e.key === 'Enter' && !e.isComposing && (e.target as HTMLElement)?.tagName !== 'BUTTON') {
    e.preventDefault()
    modal.handleConfirm()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modal.state.value.visible" class="modal-mask" @click.self="modal.handleCancel()">
        <div
          ref="dialogRef"
          class="modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="app-modal-title"
          aria-describedby="app-modal-message"
          tabindex="-1"
          @click.stop
          @keydown="onKeydown"
        >
          <div id="app-modal-title" class="modal-header">{{ modal.state.value.title }}</div>
          <div class="modal-body">
            <p id="app-modal-message" class="modal-message">{{ modal.state.value.message }}</p>
            <input
              v-if="modal.state.value.mode === 'prompt'"
              v-model="modal.state.value.inputValue"
              class="modal-input"
              :placeholder="modal.state.value.inputPlaceholder"
              data-autofocus
            />
          </div>
          <div class="modal-footer">
            <button v-if="modal.state.value.mode !== 'alert'" class="btn" @click="modal.handleCancel()">
              {{ modal.state.value.cancelText }}
            </button>
            <button class="btn primary" :data-autofocus="modal.state.value.mode === 'prompt' ? undefined : ''" @click="modal.handleConfirm()">
              {{ modal.state.value.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed; inset: 0; z-index: 9999;
  background: rgba(0, 0, 0, 0.45);
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(2px);
}
.modal-card {
  width: 380px; max-width: 90vw;
  background: var(--pf-bg-elevated);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius);
  box-shadow: var(--pf-shadow-lg);
  overflow: hidden;
}
.modal-header {
  padding: 16px 20px 0;
  font-size: 15px; font-weight: 700;
  color: var(--pf-text);
}
.modal-body {
  padding: 12px 20px 16px;
}
.modal-message {
  margin: 0;
  font-size: 13.5px;
  color: var(--pf-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.modal-input {
  width: 100%;
  margin-top: 12px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-sm);
  background: var(--pf-surface);
  font-size: 13.5px;
  color: var(--pf-text);
}
.modal-input:focus {
  border-color: var(--pf-accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--pf-accent-soft);
}
.modal-footer {
  padding: 0 20px 16px;
  display: flex; justify-content: flex-end; gap: 8px;
}
.modal-footer .btn { height: 32px; padding: 0 16px; font-size: 13px; }

/* 过渡动画 */
.modal-enter-active, .modal-leave-active { transition: opacity 0.15s ease; }
.modal-enter-active .modal-card, .modal-leave-active .modal-card { transition: transform 0.15s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal-card, .modal-leave-to .modal-card { transform: scale(0.95) translateY(8px); }
</style>
