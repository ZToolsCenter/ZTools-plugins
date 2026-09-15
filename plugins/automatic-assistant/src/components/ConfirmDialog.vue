<script setup lang="ts">
defineProps<{ title: string; confirmText: string; danger?: boolean }>()
const emit = defineEmits<{ (e: 'cancel'): void; (e: 'confirm'): void }>()
</script>

<template>
  <div class="dialog-mask" @click.self="emit('cancel')">
    <div class="dialog-paper">
      <div class="dialog-title">{{ title }}</div>
      <div class="dialog-actions">
        <button class="btn-text" @click="emit('cancel')">取消</button>
        <button class="btn-text" :class="{ danger }" @click="emit('confirm')">{{ confirmText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1300;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog-paper {
  min-width: 300px;
  max-width: 440px;
  background: var(--paper);
  border-radius: 4px;
  box-shadow: 0 11px 15px -7px rgba(0, 0, 0, 0.2), 0 24px 38px 3px rgba(0, 0, 0, 0.14),
    0 9px 46px 8px rgba(0, 0, 0, 0.12);
}

.dialog-title {
  font-size: 20px;
  font-weight: 500;
  line-height: 32px;
  letter-spacing: 0.15px;
  padding: 16px 24px;
  color: var(--text);
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px;
}

.btn-text.danger {
  color: rgb(245, 0, 87);
}

.btn-text.danger:hover {
  background: rgba(245, 0, 87, 0.08);
}
</style>
