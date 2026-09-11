<script setup lang="ts">
import type { PromptItem } from '../types'

defineProps<{
  unit: PromptItem
}>()

function formatTime(ts: number) { return new Date(ts).toLocaleString('zh-CN') }
</script>

<template>
  <div class="stats-grid">
    <div class="sc"><div class="sv">{{ unit.usageCount }}</div><div class="sl">复制次数</div></div>
    <div class="sc"><div class="sv">v{{ unit.version || 1 }}</div><div class="sl">版本</div></div>
    <div class="sc"><div class="sv">{{ unit.variables?.length || 0 }}</div><div class="sl">变量</div></div>
  </div>
  <div class="stats-meta">
    <div class="sm-row"><span class="sm-label">创建时间</span><span>{{ formatTime(unit.createdAt) }}</span></div>
    <div class="sm-row"><span class="sm-label">更新时间</span><span>{{ formatTime(unit.updatedAt) }}</span></div>
    <div v-if="unit.lastUsedAt" class="sm-row"><span class="sm-label">最后使用</span><span>{{ formatTime(unit.lastUsedAt) }}</span></div>
  </div>
</template>

<style scoped>
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.sc { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); padding: 14px; text-align: center; background: var(--pf-bg-elevated); }
.sv { font-size: 20px; font-weight: 700; color: var(--pf-accent); }
.sl { font-size: 11px; color: var(--pf-text-faint); margin-top: 4px; }
.stats-meta { display: flex; flex-direction: column; gap: 0; }
.sm-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--pf-text-secondary); padding: 8px 0; border-bottom: 1px solid var(--pf-border); }
.sm-label { font-weight: 600; color: var(--pf-text-muted); }
</style>
