<script setup lang="ts">
defineProps<{
  dirName: string
  fileCount: number
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <div class="confirm-overlay" @click.self="emit('cancel')">
    <div class="confirm-dialog">
      <div class="confirm-icon">
        <svg viewBox="0 0 24 24" width="32" height="32" stroke="currentColor" fill="none" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h3 class="confirm-title">文件夹包含大量文件</h3>
      <p class="confirm-msg">
        文件夹 <strong>{{ dirName }}</strong> 包含 <strong>{{ fileCount }}</strong> 个文件（超过 20 个）。
        共享大量文件可能影响性能，是否确认共享？
      </p>
      <div class="confirm-actions">
        <button class="btn btn-cancel" @click="emit('cancel')">取消</button>
        <button class="btn btn-confirm" @click="emit('confirm')">确认共享</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.confirm-dialog {
  background: var(--bg);
  border-radius: 10px;
  padding: 28px;
  max-width: 400px;
  width: 90%;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
}

.confirm-icon {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
  color: #f59e0b;
}

.confirm-title {
  font-size: 16px;
  font-weight: 600;
  text-align: center;
  margin: 0 0 12px;
  color: var(--text);
}

.confirm-msg {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  line-height: 1.6;
  margin: 0 0 24px;
}

.confirm-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.btn {
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid transparent;
}

.btn-cancel {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border-color: var(--border);
}
.btn-cancel:hover { background: var(--bg-tertiary); }

.btn-confirm {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}
.btn-confirm:hover { background: var(--primary-hover); }
</style>
