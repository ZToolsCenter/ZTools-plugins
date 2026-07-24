<script setup lang="ts">
import { useTodoStore } from '../composables/useTodoStore'
import { featureFlags } from '../featureFlags'
import BaseDrawer from './BaseDrawer.vue'

const store = useTodoStore()

const vimShortcuts = [
  ['上一个任务', 'k / ↑'],
  ['下一个任务', 'j / ↓'],
  ['上一个分组', 'h / ←'],
  ['下一个分组', 'l / →'],
  ['完成/取消完成', 'Space'],
  ['编辑任务', 'Enter / i'],
  ['新建任务', 'Tab / Ctrl + N'],
  ['搜索待办', '/'],
  ['删除任务', 'dd / Delete'],
  ['跳到顶部', 'gg'],
  ['跳到底部', 'G'],
  ['打开设置', '?'],
  ['设置面板滚动', 'j / k'],
  ['关闭设置面板', 'Esc'],
  ['取消编辑', 'Esc']
]
</script>

<template>
  <BaseDrawer
    :open="store.settingsOpen.value"
    title="设置"
    subtitle="调整待办和桌面组件行为"
    ariaLabel="设置面板"
    @close="store.settingsOpen.value = false"
  >
    <div class="settings-content">
      <section class="settings-section">
        <h2>显示</h2>
        <label class="setting-row">
          <span>隐藏已完成任务</span>
          <input v-model="store.settings.hideCompleted" type="checkbox" @change="store.saveSettings" />
        </label>
        <label class="setting-row">
          <span>已完成任务置于底部</span>
          <input v-model="store.settings.bottomCompleted" type="checkbox" @change="store.saveSettings" />
        </label>
        <label class="setting-row">
          <span>渲染 Markdown</span>
          <input v-model="store.settings.renderMarkdown" type="checkbox" @change="store.saveSettings" />
        </label>
      </section>

      <section class="settings-section">
        <h2>Vim 快捷键</h2>
        <dl class="shortcut-list">
          <template v-for="[label, key] in vimShortcuts" :key="label">
            <dt>{{ label }}</dt>
            <dd>{{ key }}</dd>
          </template>
        </dl>
      </section>

      <section class="settings-section">
        <h2>快速入口</h2>
        <div class="shortcut-row">
          <span>添加到待办</span>
          <kbd>选中文本 / 输入内容</kbd>
        </div>
        <div v-if="featureFlags.noteWindow" class="shortcut-row">
          <span>新建便签</span>
          <kbd>新建便签</kbd>
        </div>
      </section>

      <section v-if="featureFlags.noteWindow" class="settings-section">
        <h2>悬浮窗</h2>
        <label class="setting-range">
          <span>失焦透明度</span>
          <small>{{ Math.round(store.settings.noteOpacity * 100) }}%</small>
          <input v-model.number="store.settings.noteOpacity" type="range" min="0.2" max="1" step="0.05" @input="store.saveSettings" />
        </label>
      </section>
    </div>
  </BaseDrawer>
</template>

<style scoped>
.settings-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.settings-section {
  display: grid;
  padding: 14px 0 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.2);
  user-select: none;
}

.settings-section h2 {
  margin: 0;
  padding: 0 18px 8px;
  color: var(--text);
  font-size: 16px;
  font-weight: 700;
}

.setting-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-height: 44px;
  padding: 0 18px;
  color: var(--text);
  font-size: 13px;
}

.setting-row input[type="checkbox"] {
  position: relative;
  width: 34px;
  height: 20px;
  border: 0;
  border-radius: 999px;
  appearance: none;
  background: #cbd5e1;
  cursor: pointer;
  transition: background 0.16s ease;
}

.setting-row input[type="checkbox"]::before {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
  content: "";
  transition: transform 0.16s ease;
}

.setting-row input[type="checkbox"]:checked {
  background: var(--primary);
}

.setting-row input[type="checkbox"]:checked::before {
  transform: translateX(14px);
}

.setting-range {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px 14px;
  padding: 8px 18px 2px;
  color: var(--text);
  font-size: 13px;
}

.setting-range small {
  color: var(--muted);
  font-size: 12px;
}

.setting-range input {
  grid-column: 1 / -1;
  width: 100%;
  accent-color: var(--primary);
}

.shortcut-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 9px 18px;
  margin: 0;
  padding: 8px 18px 2px;
}

.shortcut-list dt,
.shortcut-list dd,
.shortcut-row {
  font-size: 13px;
}

.shortcut-list dt {
  color: var(--text);
}

.shortcut-list dd {
  margin: 0;
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  text-align: right;
}

.shortcut-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  min-height: 38px;
  padding: 0 18px;
}

.shortcut-row kbd {
  padding: 3px 7px;
  border: 1px solid rgba(89, 118, 245, 0.45);
  border-radius: 5px;
  background: rgba(89, 118, 245, 0.08);
  color: var(--primary);
  font-family: inherit;
  font-size: 12px;
}

@media (prefers-color-scheme: dark) {
  .settings-section {
    border-bottom-color: rgba(255, 255, 255, 0.1);
  }

  .setting-row input[type="checkbox"] {
    background: rgba(255, 255, 255, 0.16);
  }

  .setting-row input[type="checkbox"]::before {
    background: #d4d4d8;
  }

  .setting-row input[type="checkbox"]:checked {
    background: var(--primary);
  }

  .shortcut-row kbd {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: #d4d4d8;
  }
}
</style>
