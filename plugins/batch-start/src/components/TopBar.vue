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
    <div class="top-bar__title">批量启动</div>
    <div class="toolbar-row">
      <button class="btn btn-primary" type="button" :disabled="busy" @click="emit('scan')">
        扫描
      </button>
      <button class="btn" type="button" :disabled="busy" @click="emit('addDir')">
        添加目录
      </button>
      <button
        class="btn"
        type="button"
        :disabled="busy || !canTrialRun"
        title="试跑当前选中的启动组"
        @click="emit('trialRun')"
      >
        试跑当前组
      </button>
    </div>
    <div class="top-bar__meta muted">上次扫描：{{ formatScanAt(lastScanAt) }}</div>
  </header>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.top-bar__title {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
}

.top-bar__meta {
  margin-left: auto;
  white-space: nowrap;
}
</style>
