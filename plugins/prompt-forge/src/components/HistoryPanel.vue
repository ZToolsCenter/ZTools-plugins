<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { usePromptStore } from '../stores/prompt'
import { useRouter } from '../stores/router'
import { copyText, showNotification } from '../utils/platform'

const prompt = usePromptStore()
const router = useRouter()

function handleClearHistory() {
  if (confirm('确定清空所有历史记录？')) {
    prompt.clearHistory()
    showNotification('✓ 已清空')
  }
}
</script>

<template>
  <div class="history-view">
    <div class="history-header">
      <span class="history-title">使用历史</span>
      <div class="history-actions">
        <button
          :class="['sort-btn', { active: true }]"
          @click="prompt.historySortDir.value = prompt.historySortDir.value === 'desc' ? 'asc' : 'desc'"
        >{{ prompt.historySortDir.value === 'desc' ? '最新优先' : '最早优先' }}</button>
        <button v-if="prompt.historyItems.value.length" class="btn danger" @click="handleClearHistory">清空</button>
      </div>
    </div>
    <div v-if="!prompt.sortedHistoryItems.value.length" class="empty-hint">暂无使用历史</div>
    <div v-else class="history-list">
      <div v-for="h in prompt.sortedHistoryItems.value" :key="h.id" class="history-item">
        <div class="history-info">
          <div class="history-prompt-title">{{ h.promptTitle }}</div>
          <div class="history-content-preview">{{ h.copiedContent.slice(0, 120) }}{{ h.copiedContent.length > 120 ? '…' : '' }}</div>
          <div class="history-meta">
            <span class="history-time">{{ new Date(h.usedAt).toLocaleString('zh-CN') }}</span>
            <span v-if="h.variableValues" class="history-vars">{{ Object.keys(h.variableValues).length }} 变量</span>
          </div>
        </div>
        <div class="history-item-actions">
          <button class="btn" :disabled="!prompt.liveItems.value.some(i => i.id === h.promptId)" @click="router.navigateToManage(h.promptId)" title="查看原始提示词">查看</button>
          <button class="btn" @click="copyText(h.copiedContent); showNotification('✓ 已复制')">复制</button>
          <button class="btn icon-btn" title="删除" @click="prompt.deleteHistoryEntry(h.id)"><X :size="13" /></button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-view { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.history-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--pf-border); background: var(--pf-bg-elevated); flex-shrink: 0; }
.history-title { font-size: 15px; font-weight: 700; }
.history-actions { display: flex; gap: 6px; align-items: center; }
.history-actions .sort-btn { border: 1px solid var(--pf-border); border-radius: var(--pf-radius-xs); background: var(--pf-surface); font-size: 11px; color: var(--pf-text-muted); padding: 3px 8px; cursor: pointer; transition: all 0.12s; }
.history-actions .sort-btn:hover { border-color: var(--pf-accent); color: var(--pf-accent); }
.history-actions .sort-btn.active { background: var(--pf-accent-soft); color: var(--pf-accent); border-color: var(--pf-accent); font-weight: 600; }
.history-actions .btn.danger { height: 26px; padding: 0 10px; font-size: 11px; color: var(--pf-danger, #ef4444); }
.history-actions .btn.danger:hover { background: rgba(239, 68, 68, 0.08); }
.history-list { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.history-item { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: var(--pf-radius-md); border: 1px solid var(--pf-border); background: var(--pf-surface); transition: all 0.12s; }
.history-item:hover { border-color: var(--pf-border-hover); background: var(--pf-surface-hover); }
.history-info { flex: 1; min-width: 0; }
.history-prompt-title { font-size: 13px; font-weight: 600; color: var(--pf-text); margin-bottom: 4px; }
.history-content-preview { font-size: 12px; color: var(--pf-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; max-width: 500px; }
.history-meta { display: flex; gap: 8px; align-items: center; }
.history-time { font-size: 11px; color: var(--pf-text-faint); font-family: var(--pf-font-mono); }
.history-vars { font-size: 11px; color: var(--pf-accent); font-weight: 500; }
.history-item-actions { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }
.history-item-actions .btn { height: 26px; padding: 0 10px; font-size: 11px; }
.history-item-actions .icon-btn { width: 24px; height: 24px; padding: 0; font-size: 12px; display: flex; align-items: center; justify-content: center; border-radius: var(--pf-radius-sm); color: var(--pf-text-faint); background: none; border: none; cursor: pointer; transition: all 0.12s; }
.history-item-actions .icon-btn:hover { background: var(--pf-surface-raised); color: var(--pf-danger, #ef4444); }
.empty-hint { text-align: center; color: var(--pf-text-faint); font-size: 13px; padding: 40px 0; }
</style>
