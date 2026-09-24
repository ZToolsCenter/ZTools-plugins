<script setup lang="ts">
import { ref, computed } from 'vue'
import { X } from 'lucide-vue-next'
import type { PromptItem, Snapshot } from '../types'

const props = defineProps<{
  unit: PromptItem
}>()

const emit = defineEmits<{
  (e: 'restore', snap: Snapshot): void
}>()

const viewingSnapshot = ref<number | null>(null)
const diffMode = ref(false)
const diffSnapIndex = ref(-1)

const reversedSnapshots = computed(() =>
  props.unit.snapshots ? [...props.unit.snapshots].reverse() : []
)

interface DiffLine { type: 'same' | 'add' | 'del'; text: string }
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const m = oldLines.length; const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  const result: DiffLine[] = []
  let i = m; let j = n
  while (i > 0 && j > 0) {
    if (oldLines[i - 1] === newLines[j - 1]) { result.unshift({ type: 'same', text: oldLines[i - 1] }); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) { result.unshift({ type: 'del', text: oldLines[i - 1] }); i-- }
    else { result.unshift({ type: 'add', text: newLines[j - 1] }); j-- }
  }
  while (i > 0) { result.unshift({ type: 'del', text: oldLines[i - 1] }); i-- }
  while (j > 0) { result.unshift({ type: 'add', text: newLines[j - 1] }); j-- }
  const merged: DiffLine[] = []
  for (const line of result) {
    const last = merged[merged.length - 1]
    if (last && last.type === line.type) last.text += '\n' + line.text
    else merged.push({ ...line })
  }
  return merged
}

function enterDiff(snapIdx: number) { diffMode.value = true; diffSnapIndex.value = snapIdx }
function exitDiff() { diffMode.value = false; diffSnapIndex.value = -1 }

function formatTime(ts: number) { return new Date(ts).toLocaleString('zh-CN') }
</script>

<template>
  <!-- 当前版本 -->
  <div class="version-item current">
    <div class="vi-head">
      <span class="vi-ver">v{{ unit.version || 1 }}</span>
      <span class="vi-note">当前版本</span>
    </div>
    <div class="vi-body">{{ (unit.content || '').slice(0, 200) }}{{ (unit.content || '').length > 200 ? '…' : '' }}</div>
  </div>

  <!-- 历史快照 -->
  <div v-if="reversedSnapshots.length" class="version-list">
    <div class="version-divider">历史版本（{{ reversedSnapshots.length }}）</div>
    <div v-for="(snap, i) in reversedSnapshots" :key="i" class="version-item">
      <div class="vi-head">
        <span class="vi-ver">v{{ snap.version }}</span>
        <span class="vi-note">{{ snap.note }}</span>
        <span class="vi-time">{{ formatTime(snap.createdAt) }}</span>
      </div>
      <div class="vi-body">{{ snap.body.slice(0, 200) }}{{ snap.body.length > 200 ? '…' : '' }}</div>
      <div class="vi-actions">
        <button class="btn btn-xs" @click="viewingSnapshot = viewingSnapshot === i ? null : i">
          {{ viewingSnapshot === i ? '收起' : '查看' }}
        </button>
        <button class="btn btn-xs" @click="enterDiff(i)">对比</button>
        <button class="btn btn-xs" @click="emit('restore', snap)">恢复此版本</button>
      </div>
      <div v-if="viewingSnapshot === i" class="vi-full">{{ snap.body }}</div>
    </div>
  </div>
  <div v-else class="empty">暂无历史版本。编辑正文并保存后会自动记录。</div>

  <!-- 差异对比 -->
  <div v-if="diffMode" class="diff-overlay">
    <div class="diff-header">
      <div class="diff-header-item">
        <span class="diff-label">快照版本</span>
        <span class="diff-ver">v{{ reversedSnapshots[diffSnapIndex]?.version }}</span>
      </div>
      <div class="diff-arrow">→</div>
      <div class="diff-header-item">
        <span class="diff-label">当前版本</span>
        <span class="diff-ver">v{{ unit.version || 1 }}</span>
      </div>
      <button class="btn btn-xs diff-close" @click="exitDiff"><X :size="13" />关闭</button>
    </div>
    <div class="diff-body">
      <div
        v-for="(line, idx) in computeDiff(reversedSnapshots[diffSnapIndex]?.body || '', unit.content || '')"
        :key="idx"
        :class="['diff-line', `diff-${line.type}`]"
      >
        <span class="diff-marker">{{ line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ' }}</span>
        <pre class="diff-text">{{ line.text }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.version-list { display: flex; flex-direction: column; gap: 10px; }
.version-item { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-sm); padding: 12px; background: var(--pf-bg-elevated); }
.version-item.current { border-color: var(--pf-accent); background: var(--pf-accent-soft); }
.version-divider { font-size: 11px; font-weight: 700; color: var(--pf-text-faint); text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 0 2px; }
.vi-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.vi-ver { font-family: var(--pf-font-mono); font-size: 12px; font-weight: 700; color: var(--pf-accent); background: var(--pf-accent-soft); padding: 2px 8px; border-radius: var(--pf-radius-xs); }
.vi-note { font-size: 12px; color: var(--pf-text-secondary); flex: 1; }
.vi-time { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.vi-body { font-size: 12px; color: var(--pf-text-muted); font-family: var(--pf-font-mono); line-height: 1.5; white-space: pre-wrap; word-break: break-all; background: var(--pf-surface); padding: 8px; border-radius: var(--pf-radius-xs); margin-bottom: 8px; max-height: 80px; overflow: hidden; }
.vi-full { font-size: 12px; color: var(--pf-text); font-family: var(--pf-font-mono); line-height: 1.6; white-space: pre-wrap; word-break: break-all; background: var(--pf-surface); padding: 12px; border-radius: var(--pf-radius-xs); border: 1px solid var(--pf-border); margin-top: 8px; }
.vi-actions { display: flex; gap: 6px; }
.empty { padding: 24px; text-align: center; color: var(--pf-text-muted); }
.btn-xs { height: 24px; padding: 0 8px; font-size: 11px; }

/* 差异对比 */
.diff-overlay {
  position: absolute; top: 37px; left: 0; right: 0; bottom: 49px;
  background: var(--pf-bg); display: flex; flex-direction: column; z-index: 10;
}
.diff-header { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--pf-border); background: var(--pf-bg-elevated); flex-shrink: 0; }
.diff-header-item { display: flex; align-items: center; gap: 6px; }
.diff-label { font-size: 11px; color: var(--pf-text-faint); font-weight: 600; }
.diff-ver { font-family: var(--pf-font-mono); font-size: 12px; font-weight: 700; color: var(--pf-accent); background: var(--pf-accent-soft); padding: 2px 8px; border-radius: var(--pf-radius-xs); }
.diff-arrow { font-size: 16px; color: var(--pf-text-faint); }
.diff-close { margin-left: auto; }
.diff-body { flex: 1; overflow-y: auto; padding: 8px 0; }
.diff-line { display: flex; gap: 0; font-family: var(--pf-font-mono); font-size: 12px; line-height: 1.6; min-height: 20px; }
.diff-marker { width: 24px; flex-shrink: 0; text-align: center; font-size: 12px; font-weight: 700; color: var(--pf-text-faint); user-select: none; }
.diff-text { flex: 1; margin: 0; padding: 0 8px 0 0; white-space: pre-wrap; word-break: break-all; overflow: hidden; }
.diff-same { background: transparent; }
.diff-same .diff-marker { color: var(--pf-text-faint); }
.diff-add { background: rgba(34, 197, 94, 0.1); }
.diff-add .diff-marker { color: #16a34a; }
.diff-del { background: rgba(239, 68, 68, 0.1); }
.diff-del .diff-marker { color: #dc2626; }
</style>
