<script setup lang="ts">
import type { ScanResult, ConflictStrategy } from '../../types'

defineProps<{
  show: boolean
  scanResult: ScanResult | null
  targetDir: string
  recursive: boolean
  conflictStrategy: ConflictStrategy
  isBreaking: boolean
}>()
const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

function basename(p: string) {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return idx >= 0 ? p.slice(idx + 1) : p
}
</script>

<template>
  <div v-if="show && scanResult" class="modal-overlay" @click.self="emit('cancel')">
    <div class="modal">
      <div class="modal-title">确认解散</div>
      <div class="modal-body">
        <div class="modal-row">
          <span class="modal-label">目录</span>
          <span class="modal-value">{{ basename(targetDir) }}</span>
        </div>
        <div class="modal-row">
          <span class="modal-label">模式</span>
          <span class="modal-value">{{ recursive ? '递归' : '单层' }}</span>
        </div>
        <div class="modal-row">
          <span class="modal-label">冲突</span>
          <span class="modal-value">{{ { rename: '自动重命名', overwrite: '覆盖', skip: '跳过' }[conflictStrategy] }}</span>
        </div>
        <div class="modal-divider"></div>
        <div class="modal-summary">
          <div class="modal-stat">
            <span class="modal-stat-value">{{ scanResult.totalFiles }}</span>
            <span class="modal-stat-label">文件</span>
          </div>
          <div class="modal-stat">
            <span class="modal-stat-value">{{ scanResult.totalDirs }}</span>
            <span class="modal-stat-label">目录</span>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" @click="emit('cancel')">取消</button>
        <button class="btn btn-primary" @click="emit('confirm')" :disabled="isBreaking">
          <span v-if="isBreaking" class="loading-spinner loading-spinner--small"></span>
          <span>确认解散</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--bg); border-radius: var(--radius-lg);
  width: 340px; box-shadow: var(--shadow-lg); overflow: hidden;
}
.modal-title { padding: 16px 20px 0; font-size: 16px; font-weight: 600; color: var(--text); }
.modal-body { padding: 12px 20px; }
.modal-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.modal-label { color: var(--text-secondary); }
.modal-value { color: var(--text); font-weight: 500; }
.modal-divider { height: 1px; background: var(--border); margin: 8px 0; }
.modal-summary { display: flex; gap: 24px; }
.modal-stat {
  display: flex; flex-direction: column; align-items: center;
  flex: 1; padding: 8px 0; background: var(--bg-secondary); border-radius: var(--radius-sm);
}
.modal-stat-value { font-size: 20px; font-weight: 700; color: var(--text); line-height: 1.2; }
.modal-stat-label { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.modal-footer { display: flex; gap: 8px; justify-content: flex-end; padding: 12px 20px 16px; }
</style>
