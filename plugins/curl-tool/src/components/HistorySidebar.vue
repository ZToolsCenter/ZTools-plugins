<script setup lang="ts">
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Plus, Trash2 } from 'lucide-vue-next'
import type { HistoryItem } from '../utils/curl/types'

defineProps<{
  history: HistoryItem[]
  activeId: string
  collapsed: boolean
}>()

const emit = defineEmits<{
  new: []
  import: []
  toggle: []
  select: [item: HistoryItem]
  delete: [item: HistoryItem]
}>()
</script>

<template>
  <aside class="history-panel" :class="{ collapsed }">
    <div class="history-tools">
      <button class="tool-button" title="新增请求" @click="emit('new')">
        <Plus :size="16" :stroke-width="1.8" />
      </button>
      <button class="tool-button" title="剪贴板导入" @click="emit('import')">
        <ChevronDown :size="17" :stroke-width="1.55" />
      </button>
      <button class="tool-button" title="收起/展开历史" @click="emit('toggle')">
        <PanelLeftOpen v-if="collapsed" :size="16" :stroke-width="1.8" />
        <PanelLeftClose v-else :size="16" :stroke-width="1.8" />
      </button>
    </div>

    <section v-if="!collapsed" class="history-list">
      <div class="section-title">历史</div>
      <div class="history-scroll">
        <button
          v-for="item in history"
          :key="item.id"
          class="history-item"
          :class="{ active: item.id === activeId }"
          :title="item.url || item.title"
          @click="emit('select', item)"
        >
          <span class="history-main">
            <strong>
              <span class="history-method" :class="`method-${item.method.toLowerCase()}`">{{ item.method }}</span>
              <span class="history-time">{{ item.subtitle }}</span>
            </strong>
            <span class="history-url">{{ item.url || item.title }}</span>
          </span>
          <span class="history-delete" title="删除历史" @click.stop="emit('delete', item)">
            <Trash2 :size="14" :stroke-width="1.8" />
          </span>
        </button>
        <div v-if="!history.length" class="empty-history">暂无历史，发送请求后会自动保存。</div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  width: 184px;
  height: 100vh;
  min-height: 0;
  gap: 10px;
  box-sizing: border-box;
  padding: 10px;
  border-right: 1px solid #e5e7eb;
  background: #fff;
  transition: width 0.18s ease;
}

.history-panel.collapsed {
  width: 48px;
}

.history-tools {
  display: grid;
  grid-template-columns: repeat(3, 28px);
  gap: 6px;
}

.history-panel.collapsed .history-tools {
  grid-template-columns: 28px;
}

.tool-button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #4b5563;
  background: transparent;
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease;
}

.tool-button:hover {
  color: #4f46e5;
  background: #f5f3ff;
}

.history-list {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  gap: 7px;
  overflow: hidden;
}

.section-title {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
}

.history-scroll {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.history-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 8px;
  border: 1px solid #edf0f5;
  border-radius: 7px;
  color: #0f172a;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition:
    border 0.16s ease,
    background 0.16s ease;
}

.history-item:hover {
  border-color: #cfd7e3;
  background: #f8fafc;
}

.history-item.active {
  border-color: #8b7cf6;
  background: #f4f1ff;
}

.history-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.history-main strong {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 6px;
}

.history-method {
  min-width: 34px;
  padding: 2px 5px;
  border-radius: 5px;
  background: #f1f3f5;
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
  text-align: center;
}

.history-time {
  min-width: 0;
  overflow: hidden;
  color: #94a3b8;
  font-size: 11px;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-url {
  min-width: 0;
  overflow: hidden;
  color: #0f172a;
  font-size: 12px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-delete {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: #94a3b8;
  opacity: 0.3;
  transition:
    opacity 0.16s ease,
    color 0.16s ease,
    background 0.16s ease;
}

.history-delete:hover {
  color: #ef4444;
  background: #fef2f2;
}

.history-item:hover .history-delete,
.history-item.active .history-delete {
  opacity: 1;
}

.empty-history {
  display: grid;
  place-items: center;
  min-height: 90px;
  padding: 12px;
  border: 1px dashed #dbe2ea;
  border-radius: 8px;
  color: #94a3b8;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1.5;
  text-align: center;
}

.method-get {
  color: #00a870;
}

.method-post {
  color: #ff6a00;
}

.method-put,
.method-options,
.method-head {
  color: #1683ff;
}

.method-delete {
  color: #ff3b30;
}

.method-patch {
  color: #e44bc4;
}
</style>
