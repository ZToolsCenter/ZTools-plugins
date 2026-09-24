<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useModal } from '../composables/useModal'

const modal = useModal()
const inputRef = ref<HTMLInputElement | null>(null)

watch(() => modal.state.value.visible, (v) => {
  if (v && modal.state.value.mode === 'prompt') {
    nextTick(() => inputRef.value?.focus())
  }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); modal.handleConfirm() }
  if (e.key === 'Escape') { e.preventDefault(); modal.handleCancel() }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modal.state.value.visible" class="modal-mask" @click.self="modal.handleCancel()" @keydown="onKeydown">
        <div class="modal-card" @click.stop>
          <div class="modal-header">{{ modal.state.value.title }}</div>
          <div class="modal-body">
            <p class="modal-message">{{ modal.state.value.message }}</p>
            <input
              v-if="modal.state.value.mode === 'prompt'"
              ref="inputRef"
              v-model="modal.state.value.inputValue"
              class="modal-input"
              :placeholder="modal.state.value.inputPlaceholder"
            />
          </div>
          <div class="modal-footer">
            <button v-if="modal.state.value.mode !== 'alert'" class="btn" @click="modal.handleCancel()">
              {{ modal.state.value.cancelText }}
            </button>
            <button class="btn primary" @click="modal.handleConfirm()">
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
