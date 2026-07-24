<template>
  <Teleport to="body">
    <div class="ui-toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="ui-toast"
          :class="[`ui-toast--${toast.type}`]"
          @click="remove(toast.id)"
        >
          <svg v-if="toast.type === 'success'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11"/>
          </svg>
          <svg v-else-if="toast.type === 'error'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <svg v-else-if="toast.type === 'warning'" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span class="ui-toast__message">{{ toast.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref } from 'vue'

interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'error' | 'warning'
}

const toasts = ref<Toast[]>([])
let counter = 0

function add(message: string, type: Toast['type'] = 'info', duration = 2500) {
  const id = `toast-${++counter}`
  toasts.value.push({ id, message, type })
  setTimeout(() => remove(id), duration)
}

function remove(id: string) {
  const index = toasts.value.findIndex((t) => t.id === id)
  if (index !== -1) toasts.value.splice(index, 1)
}

function success(message: string, duration?: number) { add(message, 'success', duration) }
function error(message: string, duration?: number) { add(message, 'error', duration) }
function warning(message: string, duration?: number) { add(message, 'warning', duration) }
function info(message: string, duration?: number) { add(message, 'info', duration) }

defineExpose({ add, success, error, warning, info })

;(window as any).__toast = { add, success, error, warning, info }
</script>

<style scoped>
.ui-toast-container {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.ui-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  pointer-events: auto;
  cursor: pointer;
  max-width: 340px;
}

.ui-toast--success {
  border-color: rgba(0, 255, 136, 0.3);
}

.ui-toast--success svg {
  color: var(--success-color);
}

.ui-toast--error {
  border-color: rgba(255, 68, 102, 0.3);
}

.ui-toast--error svg {
  color: var(--error-color);
}

.ui-toast--warning {
  border-color: rgba(255, 184, 0, 0.3);
}

.ui-toast--warning svg {
  color: var(--warning-color);
}

.ui-toast--info {
  border-color: rgba(0, 229, 255, 0.3);
}

.ui-toast--info svg {
  color: var(--accent-primary);
}

.ui-toast__message {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-enter-active {
  animation: toastIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.toast-leave-active {
  animation: toastOut 0.2s ease forwards;
}

@keyframes toastIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes toastOut {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(20px); }
}
</style>
