<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

export interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'info' | 'warning'
  leaving?: boolean
}

const toasts = ref<ToastItem[]>([])
const exitTimers = new Map<string, ReturnType<typeof setTimeout>>()

let idCounter = 0

function showToast(message: string, type: ToastItem['type'] = 'success') {
  const id = `${Date.now()}-${++idCounter}`
  toasts.value.push({ id, message, type })

  const autoTimer = setTimeout(() => {
    exitTimers.delete(id + ':auto')
    const t = toasts.value.find((t) => t.id === id)
    if (t) t.leaving = true
    exitTimers.set(id, setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
      exitTimers.delete(id)
    }, 160))
  }, 3000)
  exitTimers.set(id + ':auto', autoTimer)
}

function closeToast(id: string) {
  const t = toasts.value.find((t) => t.id === id)
  if (t) t.leaving = true
  exitTimers.set(id, setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
    exitTimers.delete(id)
  }, 160))
}

onUnmounted(() => { exitTimers.forEach(clearTimeout) })

defineExpose({ showToast })
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts"
          :key="t.id"
          class="toast-item"
          :class="[`toast-${t.type}`, { 'toast-leaving': t.leaving }]"
        >
          <div class="toast-icon">
            <svg v-if="t.type === 'success'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <svg v-else-if="t.type === 'error'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <svg v-else-if="t.type === 'warning'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          </div>
          <span class="toast-message">{{ t.message }}</span>
          <button class="toast-close" @click="closeToast(t.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 20px;
  border-radius: 16px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--card));
  box-shadow: 0 12px 32px hsl(0 0% 0% / 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  pointer-events: auto;
  min-width: 200px;
  max-width: 520px;
  white-space: nowrap;
}

.toast-icon { flex-shrink: 0; display: flex; align-items: center; }
.toast-success .toast-icon { color: hsl(var(--success)); }
.toast-error .toast-icon { color: hsl(var(--destructive)); }
.toast-warning .toast-icon { color: hsl(var(--warning)); }
.toast-info .toast-icon { color: hsl(var(--primary)); }

.toast-message { font-size: 13px; font-weight: 500; color: hsl(var(--foreground)); flex: 1; }

.toast-close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--duration-quick) var(--ease-standard);
}
.toast-close:hover { background: hsl(var(--accent)); }

/* Transition */
.toast-enter-active { animation: toastIn var(--duration-base) var(--ease-enter); }
.toast-leave-active { animation: toastOut var(--duration-quick) var(--ease-exit); }

@keyframes toastIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes toastOut {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(20px); }
}
</style>
