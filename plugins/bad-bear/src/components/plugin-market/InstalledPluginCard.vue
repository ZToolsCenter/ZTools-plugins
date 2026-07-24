<script setup lang="ts">
import type { InstalledViewPlugin } from '../../types/pluginMarket'
import type { InstalledBusyAction } from './page/shared'

const props = defineProps<{
  plugin: InstalledViewPlugin
  busyAction?: InstalledBusyAction
  isInternal?: boolean
  canStop?: boolean
}>()

const emit = defineEmits<{
  (e: 'click'): void
  (e: 'open'): void
  (e: 'open-folder'): void
  (e: 'upgrade'): void
  (e: 'stop'): void
  (e: 'uninstall'): void
}>()

/**
 * 判断当前卡片是否正在执行指定已安装插件动作，用于同步按钮禁用和加载态。
 */
function isBusyAction(action: Exclude<InstalledBusyAction, null>): boolean {
  return props.busyAction === action
}
</script>

<template>
  <div class="card installed-plugin-card" :title="plugin.description" @click="emit('click')">
    <img
      v-if="plugin.logo"
      :src="plugin.logo"
      class="plugin-icon"
      alt="插件图标"
      draggable="false"
    />
    <div v-else class="plugin-icon placeholder">🧩</div>

    <div class="plugin-info">
      <div class="plugin-title-row">
        <span class="plugin-name">{{ plugin.title || plugin.name }}</span>
        <span class="plugin-version">v{{ plugin.localVersion || plugin.version }}</span>
        <span v-if="plugin.isDevelopment" class="dev-badge">开发中</span>
        <span v-if="plugin.isRunning" class="running-badge">
          <span class="status-dot"></span>
          运行中
        </span>
        <span v-if="plugin.hasUpdate" class="update-badge">可更新</span>
        <span v-if="isInternal" class="internal-badge">内置</span>
      </div>
      <div class="plugin-desc">{{ plugin.description || '暂无描述' }}</div>
      <div class="plugin-path">{{ plugin.path }}</div>
    </div>

    <div class="plugin-actions">
      <button class="icon-btn open-btn" title="打开插件" @click.stop="emit('open')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </button>
      <button class="icon-btn folder-btn" title="打开插件目录" @click.stop="emit('open-folder')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      </button>
      <button
        v-if="plugin.hasUpdate"
        class="icon-btn upgrade-btn"
        :disabled="!!busyAction || isInternal"
        :title="isInternal ? '内置插件，不可更新' : '更新插件'"
        @click.stop="emit('upgrade')"
      >
        <div v-if="isBusyAction('upgrade')" class="spinner"></div>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
          <path d="M3 21v-5h5"></path>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
          <path d="M16 8h5V3"></path>
        </svg>
      </button>
      <button v-if="plugin.isRunning && canStop" class="icon-btn stop-btn" :disabled="!!busyAction" title="停止运行" @click.stop="emit('stop')">
        <div v-if="isBusyAction('stop')" class="spinner"></div>
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="4" y="4" width="16" height="16" rx="2"></rect>
        </svg>
      </button>
      <button class="icon-btn delete-btn" :disabled="!!busyAction || isInternal" :title="isInternal ? '内置插件，不可卸载' : '卸载插件'" @click.stop="emit('uninstall')">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6"></path>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.installed-plugin-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 0;
}

.installed-plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}

.plugin-icon.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  font-size: 24px;
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.plugin-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-color);
}

.plugin-version,
.dev-badge,
.running-badge,
.update-badge,
.internal-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
}

.plugin-version {
  color: var(--text-secondary);
  background: var(--active-bg);
}

.dev-badge {
  color: var(--purple-color);
  background: var(--purple-light-bg);
}

.running-badge {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}

.update-badge {
  color: var(--warning-color);
  background: var(--warning-light-bg);
}

.internal-badge {
  color: var(--text-secondary);
  background: var(--active-bg);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.plugin-desc,
.plugin-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.plugin-path {
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.75;
}

.plugin-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.open-btn,
.folder-btn {
  color: var(--primary-color);
}

.open-btn:hover:not(:disabled),
.folder-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.upgrade-btn,
.stop-btn {
  color: var(--warning-color);
}

.upgrade-btn:hover:not(:disabled),
.stop-btn:hover:not(:disabled) {
  background: var(--warning-light-bg);
}

.delete-btn {
  color: var(--danger-color);
}

.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-right-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
