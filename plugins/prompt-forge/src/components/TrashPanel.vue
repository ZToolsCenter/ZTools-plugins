<script setup lang="ts">
import { usePromptStore } from '../stores/prompt'
import { showNotification } from '../utils/platform'

const prompt = usePromptStore()
</script>

<template>
  <div class="trash-list">
    <div v-if="!prompt.trashItems.value.length" class="empty-hint">回收站为空</div>
    <div v-for="item in prompt.trashItems.value" :key="item.id" class="trash-item">
      <div class="trash-info">
        <div class="trash-title">{{ item.title }}</div>
        <div class="trash-meta">{{ item.type }} · {{ item.tags.slice(0, 3).map(t => '#' + t).join(' ') }}</div>
      </div>
      <div class="trash-actions">
        <button class="btn" @click="prompt.restore(item.id); showNotification('✓ 已恢复')">恢复</button>
        <button class="btn danger" @click="prompt.hardDelete(item.id); showNotification('已永久删除')">永久删除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.trash-list { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.trash-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: var(--pf-radius-md); border: 1px solid var(--pf-border); background: var(--pf-surface); }
.trash-info { flex: 1; min-width: 0; }
.trash-title { font-size: 13px; font-weight: 600; color: var(--pf-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trash-meta { font-size: 11px; color: var(--pf-text-faint); margin-top: 2px; }
.trash-actions { display: flex; gap: 6px; flex-shrink: 0; }
.trash-actions .btn { height: 26px; padding: 0 10px; font-size: 11px; }
.trash-actions .btn.danger { color: var(--pf-danger, #ef4444); }
.trash-actions .btn.danger:hover { background: rgba(239, 68, 68, 0.08); }
.empty-hint { text-align: center; color: var(--pf-text-faint); font-size: 13px; padding: 40px 0; }
</style>
