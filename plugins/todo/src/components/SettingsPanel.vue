<script setup lang="ts">
import type { TodoSettings } from '../todo/types'

const props = defineProps<{
  settings: TodoSettings
  doneCount: number
  clearArmed: boolean
}>()

const emit = defineEmits<{
  close: []
  updateSetting: [key: keyof TodoSettings, value: boolean]
  clearCompleted: []
}>()

const shortcuts: { label: string; keys: string }[] = [
  { label: '上一个任务', keys: 'k / ↑' },
  { label: '下一个任务', keys: 'j / ↓' },
  { label: '上一个分组', keys: 'h / ←' },
  { label: '下一个分组', keys: 'l / →' },
  { label: '完成/取消完成', keys: 'Space' },
  { label: '编辑任务', keys: 'Enter / i' },
  { label: '新建任务', keys: 'Tab / Ctrl + N' },
  { label: '搜索待办', keys: '/' },
  { label: '删除任务', keys: 'dd / Delete' },
  { label: '跳到顶部', keys: 'gg' },
  { label: '跳到底部', keys: 'G' },
  { label: '打开设置', keys: '?' },
  { label: '关闭设置面板', keys: 'Esc' },
  { label: '取消编辑', keys: 'Esc' },
]

/**
 * 切换指定的布尔设置。
 * @param key 设置字段名。
 * @returns 无返回值。
 */
function toggle(key: keyof TodoSettings): void {
  emit('updateSetting', key, !props.settings[key])
}
</script>

<template>
  <div class="settings-layer" @click="emit('close')">
    <section class="settings-panel" aria-label="设置" @click.stop>
      <header class="settings-header">
        <div>
          <h2>设置</h2>
          <p>调整待办和快捷键行为</p>
        </div>
        <button
          type="button"
          class="icon-button"
          title="关闭 (Esc)"
          aria-label="关闭设置"
          @click="emit('close')"
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </header>

      <section class="settings-section">
        <h3>显示</h3>
        <div class="setting-row">
          <div class="setting-copy">
            <span class="setting-title">渲染 Markdown</span>
            <span class="setting-hint">支持 **粗体**、`代码`、~~删除线~~ 和链接</span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="settings.renderMarkdown"
            aria-label="渲染 Markdown"
            @click="toggle('renderMarkdown')"
          >
            <span class="switch-thumb" />
          </button>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <span class="setting-title">显示创建时间</span>
            <span class="setting-hint">在任务文本下方展示添加时间</span>
          </div>
          <button
            type="button"
            class="switch"
            role="switch"
            :aria-checked="settings.showCreatedAt"
            aria-label="显示创建时间"
            @click="toggle('showCreatedAt')"
          >
            <span class="switch-thumb" />
          </button>
        </div>
      </section>

      <section class="settings-section">
        <h3>操作</h3>
        <button
          type="button"
          class="danger-button"
          :class="{ armed: clearArmed }"
          :disabled="doneCount === 0"
          @click="emit('clearCompleted')"
        >
          {{ clearArmed ? `再次点击确认清空 ${doneCount} 条` : '清空已完成任务' }}
        </button>
        <span v-if="doneCount === 0" class="setting-hint block">暂无已完成任务</span>
      </section>

      <section class="settings-section">
        <h3>Vim 快捷键</h3>
        <dl class="shortcut-list">
          <div v-for="shortcut in shortcuts" :key="shortcut.label" class="shortcut-row">
            <dt>{{ shortcut.label }}</dt>
            <dd>{{ shortcut.keys }}</dd>
          </div>
        </dl>
      </section>
    </section>
  </div>
</template>

<style scoped>
.settings-layer {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: flex-end;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(3px);
  animation: layer-fade 0.15s ease;
}

.settings-panel {
  width: min(340px, 92vw);
  height: 100%;
  overflow-y: auto;
  padding: 18px 20px 28px;
  background: var(--plugin-surface, #fff);
  border-left: 1px solid var(--plugin-border, #e6e8eb);
  box-shadow: var(--plugin-shadow, 0 8px 24px rgba(15, 23, 42, 0.16));
  animation: panel-slide 0.18s ease;
}

@keyframes layer-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes panel-slide {
  from {
    transform: translateX(18px);
    opacity: 0.4;
  }
  to {
    transform: none;
    opacity: 1;
  }
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.settings-header p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--plugin-text-muted, #8a919f);
}

.icon-button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--plugin-text-muted, #8a919f);
  transition: background 0.15s ease, color 0.15s ease;
}

.icon-button:hover {
  background: var(--plugin-surface-alt, #f2f4f7);
  color: var(--plugin-text, #1f2329);
}

.icon-button svg {
  width: 16px;
  height: 16px;
}

.settings-section {
  margin-top: 22px;
}

.settings-section h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 650;
  letter-spacing: 0.02em;
  color: var(--plugin-text, #1f2329);
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.setting-copy {
  min-width: 0;
}

.setting-title {
  display: block;
  font-size: 14px;
}

.setting-hint {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--plugin-text-muted, #8a919f);
}

.setting-hint.block {
  margin-top: 8px;
}

.switch {
  position: relative;
  flex: none;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--plugin-border, #e6e8eb);
  transition: background 0.15s ease;
}

.switch[aria-checked='true'] {
  background: var(--plugin-accent, #2f6bff);
}

.switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.15s ease;
}

.switch[aria-checked='true'] .switch-thumb {
  transform: translateX(18px);
}

.danger-button {
  width: 100%;
  margin-top: 4px;
  padding: 8px 12px;
  border: 1px solid var(--plugin-border, #e6e8eb);
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  color: var(--plugin-danger, #e5484d);
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.danger-button:hover:not(:disabled) {
  background: var(--plugin-danger-soft, rgba(229, 72, 77, 0.12));
  border-color: var(--plugin-danger, #e5484d);
}

.danger-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger-button.armed {
  background: var(--plugin-danger, #e5484d);
  border-color: var(--plugin-danger, #e5484d);
  color: #fff;
}

.shortcut-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}

.shortcut-row dt {
  color: var(--plugin-text, #1f2329);
}

.shortcut-row dd {
  margin: 0;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  white-space: nowrap;
  color: var(--plugin-text-muted, #8a919f);
}

@media (prefers-color-scheme: dark) {
  .settings-layer {
    background: rgba(0, 0, 0, 0.45);
  }
}
</style>
