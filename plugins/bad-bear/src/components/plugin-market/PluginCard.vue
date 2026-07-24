<script setup lang="ts">
import type { PluginMarketUiPlugin } from '../../types/pluginMarket'

defineProps<{
  plugin: PluginMarketUiPlugin
  installingPlugin: string | null
  canInstallFromMarket?: boolean
}>()

defineEmits<{
  (e: 'click'): void
  (e: 'open'): void
  (e: 'download'): void
}>()
</script>
<template>
  <div class="card plugin-card" :title="plugin.description" @click="$emit('click')">
    <div class="plugin-icon">
      <img v-if="plugin.logo" :src="plugin.logo" class="plugin-logo-img" alt="icon" draggable="false" />
      <div v-else class="plugin-logo-img placeholder">
        {{ (plugin.title || plugin.name).slice(0, 1).toUpperCase() }}
      </div>
    </div>
    <div class="plugin-info">
      <div class="plugin-name">{{ plugin.title || plugin.name }}</div>
      <div class="plugin-description" :title="plugin.description">
        {{ plugin.description }}
      </div>
    </div>
    <div class="plugin-action">
      <template v-if="plugin.installed">
        <button class="icon-btn open-btn" title="打开" @click.stop="$emit('open')">
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
      </template>
      <button
        v-else
        class="icon-btn download-btn"
        :title="canInstallFromMarket === false ? '下载插件文件' : '安装插件'"
        :disabled="installingPlugin === plugin.name"
        @click.stop="$emit('download')"
      >
        <div v-if="installingPlugin === plugin.name" class="spinner"></div>
        <svg
          v-else
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M7 10L12 15L17 10"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <path
            d="M12 15V3"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.plugin-card {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 0;
}

.plugin-card:hover {
  background: var(--hover-bg);
  transform: translateX(2px);
}

.plugin-icon {
  flex-shrink: 0;
  margin-right: 12px;
}

.plugin-logo-img {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  object-fit: cover;
}

.plugin-logo-img.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-elevated);
  color: var(--primary-color);
  font-weight: 700;
  font-size: 18px;
  border: 1px dashed var(--divider-color);
}

.plugin-info {
  flex: 1;
  min-width: 0;
}

.plugin-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-description {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-action {
  flex-shrink: 0;
  margin-left: 10px;
}

.open-btn {
  color: var(--primary-color);
}

.open-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.download-btn {
  color: var(--primary-color);
}

.download-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.btn-loading {
  display: flex;
  align-items: center;
  justify-content: center;
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

.btn-warning .spinner {
  border-top-color: var(--text-on-primary);
  border-right-color: var(--text-on-primary);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
