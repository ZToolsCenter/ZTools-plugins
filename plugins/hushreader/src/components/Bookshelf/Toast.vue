<script setup lang="ts">
defineProps<{
  message: string
  type?: 'info' | 'error' | 'success'
}>()
</script>

<template>
  <Transition name="toast">
    <div v-if="message" class="toast" :class="`toast-${type || 'info'}`">
      {{ message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 20px;
  border-radius: var(--radius-full);
  font-size: 13px;
  font-weight: 500;
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: var(--shadow-lg);
}

.toast-info {
  background: var(--c-surface-overlay);
  color: var(--c-ink);
  border: 1px solid var(--c-border);
}
.toast-success {
  background: var(--c-success);
  color: var(--c-ink-inverse);
}
.toast-error {
  background: var(--c-danger);
  color: var(--c-ink-inverse);
}

.toast-enter-active, .toast-leave-active { transition: opacity 0.2s var(--ease-out), transform 0.2s var(--ease-out); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(8px); }
</style>
