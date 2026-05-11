<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChat, type Conversation } from '../useChat'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'toggle'): void }>()

const { conversations, currentConvId, newConversation, switchConversation, removeConversation } = useChat()

const searchText = ref('')

const filtered = computed(() => {
  if (!searchText.value) return conversations.value
  const kw = searchText.value.toLowerCase()
  return conversations.value.filter(c => c.title.toLowerCase().includes(kw))
})

function onSelect(conv: Conversation) {
  switchConversation(conv.id)
}

function onDelete(e: Event, conv: Conversation) {
  e.stopPropagation()
  removeConversation(conv.id)
}

function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: !visible }">
    <div class="sidebar-header">
      <button class="btn-new" @click="newConversation" title="新对话">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>新对话</span>
      </button>
      <button class="btn-icon" @click="emit('toggle')" title="收起侧边栏">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
      </button>
    </div>
    <input class="search-box" v-model="searchText" placeholder="搜索会话..." />
    <div class="conv-list">
      <div
        v-for="conv in filtered"
        :key="conv.id"
        class="conv-item"
        :class="{ active: conv.id === currentConvId }"
        @click="onSelect(conv)"
      >
        <div class="conv-info">
          <div class="conv-title">{{ conv.title }}</div>
          <div class="conv-time">{{ formatTime(conv.updatedAt) }}</div>
        </div>
        <button class="conv-delete" @click="onDelete($event, conv)" title="删除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div v-if="!filtered.length" style="text-align:center;color:var(--text-secondary);font-size:12px;padding:20px 0;">
        {{ searchText ? '无匹配会话' : '暂无会话' }}
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  min-width: 220px;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--sidebar-bg);
  transition: width 0.2s, min-width 0.2s, opacity 0.2s;
  overflow: hidden;
}
.sidebar.collapsed {
  width: 0;
  min-width: 0;
  border-right: none;
  opacity: 0;
  pointer-events: none;
}
.sidebar-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 10px 8px;
}
.btn-new {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 0;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
  background: var(--hover);
  border: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-new:hover { background: var(--active); }
.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.15s;
}
.btn-icon:hover { background: var(--hover); }
.search-box {
  margin: 0 10px 8px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--input-bg);
  color: var(--text);
  font-size: 12px;
  outline: none;
  transition: border-color 0.15s;
}
.search-box:focus { border-color: var(--primary); }
.conv-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px;
}
.conv-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  margin-bottom: 2px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.conv-item:hover { background: var(--hover); }
.conv-item.active { background: var(--active); }
.conv-info {
  flex: 1;
  min-width: 0;
}
.conv-title {
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conv-time {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.conv-delete {
  display: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}
.conv-item:hover .conv-delete { display: flex; }
.conv-delete:hover { background: var(--hover); color: #e74c3c; }
</style>
