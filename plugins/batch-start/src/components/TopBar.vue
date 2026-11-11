<script setup lang="ts">
defineProps<{
  lastScanAt: number | null
  canTrialRun: boolean
  busy?: boolean
}>()

const emit = defineEmits<{
  scan: []
  addDir: []
  trialRun: []
}>()

function formatScanAt(ts: number | null): string {
  if (ts == null) return '尚未扫描'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return '尚未扫描'
  }
}
</script>

<template>
  <header class="top-bar">
    <div class="top-bar__brand">
      <div class="top-bar__title">批量启动</div>
      <div class="top-bar__meta muted">上次扫描：{{ formatScanAt(lastScanAt) }}</div>
    </div>
    <div class="toolbar-row">
      <button class="btn btn-ghost" type="button" :disabled="busy" @click="emit('addDir')">
        添加目录
      </button>
      <button
        class="btn btn-ghost"
        type="button"
        :disabled="busy || !canTrialRun"
        title="试跑当前选中的启动组"
        @click="emit('trialRun')"
      >
        试跑当前组
      </button>
      <button class="btn btn-primary" type="button" :disabled="busy" @click="emit('scan')">
        扫描
      </button>
    </div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  background: transparent;
  border-bottom: 1px solid var(--border);
}

.top-bar__brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.top-bar__title {
  font-weight: 650;
  font-size: 15px;
  letter-spacing: 0.01em;
  white-space: nowrap;
}

.top-bar__meta {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
