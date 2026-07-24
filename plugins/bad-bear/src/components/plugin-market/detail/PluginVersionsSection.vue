<script setup lang="ts">
import { computed } from 'vue'
import type { PluginDetailVersion, PluginReleaseSource } from '../../../types/pluginMarket'
import { compareVersions, formatDateTime } from '../utils'
import { formatDownloads, formatSize } from './formatters'

const props = defineProps<{
  versions?: PluginDetailVersion[]
  selectedVersion?: string | null
  selectedHash?: string | null
  installed?: boolean
  localVersion?: string | null
  localHash?: string | null
  busyAction?: 'download' | 'upgrade' | 'reload' | 'stop' | 'uninstall' | null
  canInstallFromMarket?: boolean
}>()

const emit = defineEmits<{
  (e: 'select-version', version: PluginDetailVersion): void
  (e: 'install-version', version: PluginDetailVersion): void
}>()

const versionList = computed(() => props.versions || [])

function formatHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash
}

function formatSource(source?: PluginReleaseSource): string {
  if (!source) {
    return '未知来源'
  }

  if (typeof source === 'string') {
    const normalized = source.trim().toLowerCase()
    if (normalized.includes('provider')) {
      return '来源同步'
    }
    if (normalized.includes('upload') || normalized.includes('manual') || normalized.includes('user')) {
      return '用户上传'
    }
    return source || '未知来源'
  }

  const provider = source.provider
  const providerName =
    provider &&
    typeof provider === 'object' &&
    !Array.isArray(provider) &&
    typeof (provider as Record<string, unknown>).name === 'string'
      ? ((provider as Record<string, unknown>).name as string).trim()
      : null
  const type = String(source.type || source.kind || source.sourceType || '').toLowerCase()
  if (type === 'local') {
    return '用户上传'
  }
  if (providerName) {
    return providerName
  }
  if (type.includes('provider')) {
    return '来源同步'
  }
  if (type.includes('upload') || type.includes('manual') || type.includes('user')) {
    return '用户上传'
  }

  return '未知来源'
}

function formatUploader(version: PluginDetailVersion): string {
  return version.uploaderUsername || version.uploaderAccount || version.uploaderUserId || '未知上传者'
}

function isSelected(version: PluginDetailVersion): boolean {
  return props.selectedVersion === version.version && props.selectedHash === version.hash
}

/**
 * 只有本地安装 hash 命中当前构建时才隐藏安装按钮，同版本不同构建仍允许重装或切换。
 */
function canInstallVersion(version: PluginDetailVersion): boolean {
  if (!props.installed) {
    return true
  }

  if (props.localHash) {
    return props.localHash !== version.hash
  }

  if (!props.localVersion) {
    return true
  }

  return compareVersions(props.localVersion, version.version) !== 0
}

/**
 * 根据本地安装版本和 hash 给每个构建生成动作文案，同版本不同 hash 视为可重装构建。
 */
function getActionLabel(version: PluginDetailVersion): string {
  if (!props.installed) {
    return props.canInstallFromMarket === false ? '下载此版本' : '安装此版本'
  }

  if (props.localHash && props.localHash === version.hash) {
    return '当前已安装'
  }

  if (!props.localVersion) {
    return '安装此版本'
  }

  const comparison = compareVersions(props.localVersion, version.version)
  if (comparison < 0) {
    return '升级到此版本'
  }
  if (comparison > 0) {
    return '安装历史版本'
  }

  return '重装此版本'
}

/**
 * 通过显式按钮切换当前查看的版本，避免整张版本卡片抢占安装点击。
 */
function handleSelect(version: PluginDetailVersion): void {
  emit('select-version', version)
}

/**
 * 触发指定版本的安装动作，实际安装或升级由父组件根据当前插件状态处理。
 */
function handleInstall(version: PluginDetailVersion): void {
  emit('install-version', version)
}
</script>

<template>
  <div class="versions-section">
    <div v-if="versionList.length === 0" class="empty-message">暂无历史版本</div>

    <div v-else class="version-list">
      <div
        v-for="version in versionList"
        :key="version.id || `${version.version}-${version.hash}`"
        class="version-card card"
        :class="{ selected: isSelected(version) }"
      >
        <div class="version-card-header">
          <div class="version-title">
            <span class="version-number">v{{ version.version }}</span>
            <span class="version-hash" :title="version.hash">{{ formatHash(version.hash) }}</span>
          </div>
          <span class="version-source">{{ formatSource(version.source) }}</span>
        </div>

        <div class="version-meta-grid">
          <div class="version-meta-item">
            <span class="version-meta-label">文件大小</span>
            <span class="version-meta-value">{{ formatSize(version.fileSize) }}</span>
          </div>
          <div class="version-meta-item">
            <span class="version-meta-label">下载次数</span>
            <span class="version-meta-value">{{ formatDownloads(version.downloads) }}</span>
          </div>
          <div class="version-meta-item">
            <span class="version-meta-label">上传时间</span>
            <span class="version-meta-value">{{ formatDateTime(version.createdAt) }}</span>
          </div>
          <div class="version-meta-item">
            <span class="version-meta-label">上传者</span>
            <span class="version-meta-value">{{ formatUploader(version) }}</span>
          </div>
        </div>

        <div class="version-card-footer">
          <span v-if="isSelected(version)" class="version-selected-badge">当前查看</span>
          <button
            v-if="!isSelected(version)"
            type="button"
            class="version-view-btn"
            :disabled="!!busyAction"
            @click="handleSelect(version)"
          >
            查看
          </button>
          <button
            v-if="canInstallVersion(version)"
            type="button"
            class="version-install-btn"
            :disabled="!!busyAction"
            @click="handleInstall(version)"
          >
            {{ getActionLabel(version) }}
          </button>
          <span v-else class="version-installed-text">{{ getActionLabel(version) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.versions-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.version-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.version-card {
  width: 100%;
  padding: 14px;
  border: 1px solid var(--divider-color);
  background: var(--bg-color);
  text-align: left;
  cursor: default;
  transition: border-color 0.2s, background 0.2s, transform 0.2s;
}

.version-card:hover {
  border-color: var(--primary-color);
  background: var(--hover-bg);
}

.version-card.selected {
  border-color: var(--primary-color);
  background: var(--active-bg);
}

.version-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.version-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.version-number {
  color: var(--text-color);
  font-size: 14px;
  font-weight: 700;
}

.version-hash {
  max-width: 180px;
  color: var(--text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-source {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--active-bg);
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 600;
}

.version-meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.version-meta-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.version-meta-label {
  color: var(--text-secondary);
  font-size: 12px;
}

.version-meta-value {
  color: var(--text-color);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
}

.version-selected-badge {
  color: var(--primary-color);
  font-size: 12px;
  font-weight: 600;
}

.version-view-btn {
  padding: 6px 12px;
  border: 1px solid var(--divider-color);
  border-radius: 8px;
  background: var(--bg-color);
  color: var(--text-color);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, border-color 0.2s, color 0.2s;
}

.version-card:hover .version-view-btn,
.version-view-btn.visible,
.version-view-btn:focus-visible {
  opacity: 1;
  pointer-events: auto;
}

.version-view-btn:hover:not(:disabled) {
  border-color: var(--primary-color);
  color: var(--primary-color);
}

.version-view-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.version-install-btn {
  padding: 6px 12px;
  border: 1px solid var(--primary-color);
  border-radius: 8px;
  background: var(--primary-color);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.2s;
}

.version-install-btn:hover:not(:disabled) {
  opacity: 0.9;
}

.version-install-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.version-installed-text {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 12px;
}

.empty-message {
  text-align: center;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>

