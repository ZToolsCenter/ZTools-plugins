<script setup lang="ts">
import { X } from 'lucide-vue-next'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

interface Shortcut {
  keys: string
  desc: string
}

const shortcuts: { title: string; items: Shortcut[] }[] = [
  {
    title: '空间 - 搜索模式',
    items: [
      { keys: '↑ ↓', desc: '上下选择提示词' },
      { keys: 'Enter', desc: '复制提示词 / 进入变量填写' },
      { keys: 'E', desc: '编辑当前选中提示词' },
      { keys: 'Ctrl + N', desc: '新建提示词' },
    ],
  },
  {
    title: '空间 - 填写模式',
    items: [
      { keys: 'Enter', desc: '复制填写后的内容' },
      { keys: 'Esc', desc: '返回搜索结果' },
    ],
  },
  {
    title: '全局',
    items: [
      { keys: '?', desc: '打开 / 关闭快捷键面板' },
    ],
  },
]
</script>

<template>
  <teleport to="body">
    <div v-if="visible" class="shortcut-overlay" @click.self="emit('close')">
      <div class="shortcut-panel">
        <div class="shortcut-header">
          <span>快捷键</span>
          <button class="shortcut-close" @click="emit('close')"><X :size="16" /></button>
        </div>
        <div class="shortcut-body">
          <div v-for="(group, gi) in shortcuts" :key="gi" class="shortcut-group">
            <div class="shortcut-group-title">{{ group.title }}</div>
            <div v-for="(item, si) in group.items" :key="si" class="shortcut-item">
              <span class="shortcut-keys">
                <kbd v-for="(k, ki) in item.keys.split(' + ')" :key="ki">{{ k }}</kbd>
              </span>
              <span class="shortcut-desc">{{ item.desc }}</span>
            </div>
          </div>
        </div>
        <div class="shortcut-footer">
          按 <kbd>?</kbd> 随时打开此面板
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.shortcut-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.45);
  display: flex; align-items: center; justify-content: center;
  animation: fadeIn 0.12s ease;
}
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
.shortcut-panel {
  width: 380px; max-height: 70vh;
  background: var(--pf-bg-elevated);
  border: 1px solid var(--pf-border);
  border-radius: var(--pf-radius-lg);
  box-shadow: 0 16px 48px rgba(0,0,0,0.25);
  display: flex; flex-direction: column;
  overflow: hidden;
  animation: scaleIn 0.15s ease;
}
@keyframes scaleIn { from { opacity: 0; transform: scale(0.95) } to { opacity: 1; transform: scale(1) } }
.shortcut-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 20px 12px;
  font-size: 16px; font-weight: 700; color: var(--pf-text);
  border-bottom: 1px solid var(--pf-border);
}
.shortcut-close {
  width: 28px; height: 28px; border-radius: 50%;
  border: none; background: none;
  color: var(--pf-text-muted); font-size: 16px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.12s;
}
.shortcut-close:hover { background: var(--pf-surface-hover); color: var(--pf-text); }
.shortcut-body {
  flex: 1; overflow-y: auto; padding: 8px 0;
}
.shortcut-group {
  padding: 0 0 4px;
}
.shortcut-group-title {
  font-size: 10px; font-weight: 700;
  color: var(--pf-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 12px 20px 6px;
}
.shortcut-item {
  display: flex; align-items: center;
  justify-content: space-between;
  padding: 8px 20px;
  transition: background 0.1s;
}
.shortcut-item:hover { background: var(--pf-surface-hover); }
.shortcut-keys {
  display: flex; gap: 4px; flex-shrink: 0;
}
.shortcut-keys kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 22px; height: 22px;
  padding: 0 6px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-border);
  border-radius: 4px;
  font-family: var(--pf-font-mono);
  font-size: 11px; font-weight: 600;
  color: var(--pf-text-secondary);
  box-shadow: 0 1px 0 var(--pf-border);
}
.shortcut-desc {
  font-size: 13px; color: var(--pf-text-secondary);
  text-align: right;
}
.shortcut-footer {
  padding: 10px 20px;
  border-top: 1px solid var(--pf-border);
  font-size: 11px; color: var(--pf-text-faint);
  text-align: center;
}
.shortcut-footer kbd {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 4px;
  background: var(--pf-surface);
  border: 1px solid var(--pf-border);
  border-radius: 3px;
  font-family: var(--pf-font-mono);
  font-size: 10px; font-weight: 600;
  color: var(--pf-text-secondary);
}
</style>
