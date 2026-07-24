<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PluginCommentsSection from './detail/PluginCommentsSection.vue'
import PluginReadmePanel from './detail/PluginReadmePanel.vue'
import PluginVersionsSection from './detail/PluginVersionsSection.vue'
import { formatDownloads, formatSize } from './detail/formatters'
import type {
  PluginCommentTreeNode,
  PluginDetailReadme,
  PluginDetailVersion,
  PluginMarketUiPlugin,
  PluginRiskInfo,
} from '../../types/pluginMarket'

type PluginDetailBusyAction = 'download' | 'upgrade' | 'stop' | 'uninstall' | null

type TabId = 'detail' | 'commands' | 'comments' | 'versions'

const props = defineProps<{
  plugin: PluginMarketUiPlugin
  busyAction?: PluginDetailBusyAction
  isRunning?: boolean
  canStop?: boolean
  isLoggedIn?: boolean
  isInternal?: boolean
  canInstallFromMarket?: boolean
  avgRating?: number
  ratingCount?: number
  currentUserRating?: number
  comments?: PluginCommentTreeNode[]
  commentsLoading?: boolean
  commentsLoadingMore?: boolean
  commentsError?: string
  hasMoreComments?: boolean
  ratingSubmitting?: boolean
  commentSubmitting?: boolean
  currentUserAvatarUrl?: string
  commentSubmitSuccessKey?: number
  versions?: PluginDetailVersion[]
  selectedVersion?: string | null
  selectedHash?: string | null
  remoteReadme?: PluginDetailReadme | null
  sourceLabel?: string
  risk?: PluginRiskInfo | null
  riskLoading?: boolean
  riskError?: string
}>()

const emit = defineEmits<{
  (e: 'back'): void
  (e: 'open'): void
  (e: 'download'): void
  (e: 'install-latest'): void
  (e: 'upgrade'): void
  (e: 'uninstall'): void
  (e: 'open-folder'): void
  (e: 'stop'): void
  (e: 'select-version', version: PluginDetailVersion): void
  (e: 'install-version', version: PluginDetailVersion): void
  (e: 'submit-rating', score: number): void
  (e: 'submit-comment', payload: { content: string; parentId?: string }): void
  (e: 'load-more-comments'): void
}>()

const activeTab = ref<TabId>('detail')

const isInstalledPlugin = computed(() => props.plugin.installed && !!props.plugin.path)
const isFromMarket = computed(() => !!props.plugin.marketPlugin)
const showStopAction = computed(() => !!props.isRunning && props.canStop !== false)
const currentVersion = computed(() => props.plugin.version || '-')
const displayAverageRating = computed(() => props.avgRating ?? props.plugin.avgRating ?? 0)
const displayRatingCount = computed(() => props.ratingCount ?? props.plugin.ratingCount ?? 0)

const detailSourceText = computed(() => props.sourceLabel || '')
const hasVisibleRisk = computed(() => {
  if (!props.risk || props.riskError || props.riskLoading) {
    return false
  }

  const normalized = String(props.risk.riskLevel || '').trim().toUpperCase()
  return !!normalized && normalized !== 'SAFE' && normalized !== 'NONE' && normalized !== 'LOW'
})

function isBusyAction(action: Exclude<PluginDetailBusyAction, null>): boolean {
  return props.busyAction === action
}

function openHomepage(): void {
  const homepage = props.plugin.homepage as string | undefined
  if (homepage && typeof window.ztools?.shellOpenExternal === 'function') {
    window.ztools.shellOpenExternal(homepage)
  }
}

watch(
  () => [props.plugin.name, props.plugin.path],
  () => {
    activeTab.value = 'detail'
  },
)
</script>

<template>
  <div class="plugin-detail">
    <div class="detail-panel-header">
      <button class="back-btn" @click="emit('back')">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        <span>插件详情</span>
      </button>
      <div class="header-actions">
        <template v-if="isInstalledPlugin">
          <button class="icon-btn topbar-action-btn open-btn" title="打开" :disabled="!!busyAction" @click="emit('open')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
          <button class="icon-btn topbar-action-btn folder-btn" title="打开目录" :disabled="!!busyAction" @click="emit('open-folder')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </button>
          <button v-if="showStopAction" class="icon-btn topbar-action-btn stop-btn" title="停止运行" :disabled="!!busyAction" @click="emit('stop')">
            <div v-if="isBusyAction('stop')" class="spinner"></div>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2"></rect>
            </svg>
          </button>
          <button
            v-if="plugin.hasUpdate"
            class="icon-btn topbar-action-btn upgrade-btn"
            :title="isInternal ? '内置插件，不可更新' : '更新'"
            :disabled="!!busyAction || isInternal"
            @click="emit('upgrade')"
          >
            <div v-if="isBusyAction('upgrade')" class="spinner"></div>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
              <path d="M3 21v-5h5"></path>
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
              <path d="M16 8h5V3"></path>
            </svg>
          </button>
          <button class="icon-btn topbar-action-btn delete-btn" :title="isInternal ? '内置插件，不可卸载' : '卸载'" :disabled="!!busyAction || isInternal" @click="emit('uninstall')">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6"></path>
            </svg>
          </button>
        </template>
        <button v-else class="icon-btn topbar-action-btn install-btn" :title="canInstallFromMarket === false ? '下载插件文件' : '安装最新版'" :disabled="!!busyAction" @click="emit('install-latest')">
          <div v-if="isBusyAction('download')" class="spinner"></div>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.7893 3 19.5304 3 19V15"></path>
            <path d="M7 10L12 15L17 10"></path>
            <path d="M12 15V3"></path>
          </svg>
        </button>
      </div>
    </div>

    <div class="detail-panel-body">
      <div class="detail-content">
        <div class="detail-header">
          <div class="detail-left">
            <img
              v-if="plugin.logo"
              :src="plugin.logo"
              class="detail-icon"
              alt="插件图标"
              draggable="false"
            />
            <div v-else class="detail-icon placeholder">🧩</div>
            <div class="detail-info">
              <div class="detail-title">
                <span class="detail-name">{{ plugin.title || plugin.name }}</span>
                <span class="detail-version">v{{ currentVersion }}</span>
                <span v-if="detailSourceText" class="detail-badge detail-badge-source">{{ detailSourceText }}</span>
                <div class="detail-badges">
                  <span v-if="plugin.installed" class="detail-badge">已安装</span>
                  <span v-if="plugin.isDevelopment" class="detail-badge detail-badge-dev">开发中</span>
                  <span v-if="isRunning" class="detail-badge detail-badge-running">运行中</span>
                  <span v-if="plugin.hasUpdate" class="detail-badge detail-badge-update">可更新</span>
                </div>
              </div>
              <div class="detail-summary">
                <div class="detail-summary-item">
                  <span class="detail-summary-label">开发者</span>
                  <span
                    v-if="plugin.author"
                    class="detail-summary-value"
                    :class="{ clickable: plugin.homepage }"
                    @click="openHomepage"
                  >
                    {{ plugin.author }}
                  </span>
                  <span v-else class="detail-summary-value">未知</span>
                </div>
                <div class="detail-summary-divider"></div>
                <div class="detail-summary-item">
                  <span class="detail-summary-label">大小</span>
                  <span class="detail-summary-value">{{ formatSize(plugin.size) }}</span>
                </div>
                <div class="detail-summary-divider"></div>
                <div class="detail-summary-item">
                  <span class="detail-summary-label">下载量</span>
                  <span class="detail-summary-value">{{ formatDownloads(plugin.totalDownloads) }}</span>
                </div>
                <template v-if="displayRatingCount > 0">
                  <div class="detail-summary-divider"></div>
                  <div class="detail-summary-item">
                    <span class="detail-summary-label">评分</span>
                    <span class="detail-summary-value">{{ displayAverageRating.toFixed(1) }} / {{ displayRatingCount }}</span>
                  </div>
                </template>
              </div>
              <div class="detail-desc">{{ plugin.description || '暂无描述' }}</div>
            </div>
          </div>
        </div>

        <div v-if="hasVisibleRisk" class="detail-risk-card card">
          <div class="detail-risk-header">
            <span class="detail-risk-title">风险提示</span>
          </div>
          <div v-if="risk" class="detail-risk-body">
            <div>{{ risk.riskSummary?.summary || '暂无风险摘要' }}</div>
          </div>
        </div>
      </div>

      <div class="tab-container">
        <div class="tab-header">
          <button class="tab-button" :class="{ active: activeTab === 'detail' }" @click="activeTab = 'detail'">
            详情
          </button>
          <button class="tab-button" :class="{ active: activeTab === 'commands' }" @click="activeTab = 'commands'">
            指令列表
          </button>
          <button v-if="isFromMarket" class="tab-button" :class="{ active: activeTab === 'comments' }" @click="activeTab = 'comments'">
            评论
          </button>
          <button v-if="isFromMarket" class="tab-button" :class="{ active: activeTab === 'versions' }" @click="activeTab = 'versions'">
            历史版本
          </button>
        </div>

        <div class="tab-content">
          <div v-if="activeTab === 'detail'" class="tab-panel">
            <PluginReadmePanel :plugin="plugin" :remote-readme="remoteReadme" />
          </div>

          <div v-if="activeTab === 'commands'" class="tab-panel">
            <div v-if="plugin.features && plugin.features.length > 0" class="feature-list">
              <div v-for="feature in plugin.features" :key="feature.code" class="card feature-card">
                <div class="feature-title">{{ feature.name || feature.code }}</div>
                <div v-if="feature.explain" class="feature-description">{{ feature.explain }}</div>
              </div>
            </div>
            <div v-else class="empty-message">暂无指令</div>
          </div>

          <div v-if="activeTab === 'comments'" class="tab-panel comments-panel">
            <PluginCommentsSection
              :is-logged-in="isLoggedIn"
              :avg-rating="displayAverageRating"
              :rating-count="displayRatingCount"
              :current-user-rating="currentUserRating"
              :comments="comments"
              :comments-loading="commentsLoading"
              :comments-loading-more="commentsLoadingMore"
              :comments-error="commentsError"
              :has-more-comments="hasMoreComments"
              :rating-submitting="ratingSubmitting"
              :comment-submitting="commentSubmitting"
              :current-user-avatar-url="currentUserAvatarUrl"
              :comment-submit-success-key="commentSubmitSuccessKey"
              @submit-rating="emit('submit-rating', $event)"
              @submit-comment="emit('submit-comment', $event)"
              @load-more-comments="emit('load-more-comments')"
            />
          </div>

          <div v-if="activeTab === 'versions'" class="tab-panel versions-panel">
            <PluginVersionsSection
              :versions="versions"
              :selected-version="selectedVersion"
              :selected-hash="selectedHash"
              :installed="isInstalledPlugin"
              :local-version="plugin.localVersion"
              :local-hash="plugin.localHash"
              :busy-action="busyAction"
              :can-install-from-market="canInstallFromMarket"
              @select-version="emit('select-version', $event)"
              @install-version="emit('install-version', $event)"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-detail {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  background: var(--bg-color);
}

.detail-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--divider-color);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.back-btn:hover {
  background: var(--primary-light-bg);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.topbar-action-btn {
  color: var(--text-secondary);
}

.topbar-action-btn:hover:not(:disabled) {
  background: var(--hover-bg);
}

.topbar-action-btn.open-btn,
.topbar-action-btn.folder-btn,
.topbar-action-btn.install-btn {
  color: var(--primary-color);
}

.topbar-action-btn.open-btn:hover:not(:disabled),
.topbar-action-btn.folder-btn:hover:not(:disabled),
.topbar-action-btn.install-btn:hover:not(:disabled) {
  background: var(--primary-light-bg);
}

.topbar-action-btn.stop-btn,
.topbar-action-btn.upgrade-btn {
  color: var(--warning-color);
}

.topbar-action-btn.stop-btn:hover:not(:disabled),
.topbar-action-btn.upgrade-btn:hover:not(:disabled) {
  background: var(--warning-light-bg);
}

.topbar-action-btn.delete-btn {
  color: var(--danger-color);
}

.topbar-action-btn.delete-btn:hover:not(:disabled) {
  background: var(--danger-light-bg);
}

.spinner {
  width: 16px;
  height: 16px;
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

.detail-panel-body {
  flex: 1;
  overflow-y: auto;
}

.detail-content {
  padding: 0 16px;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
}

.detail-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex: 1;
  min-width: 0;
}

.detail-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.detail-icon {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
}

.detail-icon.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--active-bg);
  font-size: 28px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-name {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-color);
}

.detail-version {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
}

.detail-badges {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--active-bg);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
}

.detail-badge-dev {
  color: var(--purple-color);
  background: var(--purple-light-bg);
}

.detail-badge-source {
  color: var(--primary-color);
  background: var(--active-bg);
}

.detail-badge-running {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.12);
}

.detail-badge-update {
  color: var(--warning-color);
  background: var(--warning-light-bg);
}

.detail-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  word-break: break-word;
}

.detail-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  color: var(--text-secondary);
  font-size: 12px;
}

.detail-summary-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.detail-summary-label {
  color: var(--text-secondary);
}

.detail-summary-value {
  color: var(--text-color);
  min-width: 0;
}

.detail-summary-value.clickable {
  color: var(--primary-color);
  cursor: pointer;
  transition: opacity 0.2s;
}

.detail-summary-value.clickable:hover {
  opacity: 0.7;
}

.detail-summary-divider {
  width: 1px;
  height: 12px;
  background: var(--divider-color);
}

.detail-risk-card {
  margin-bottom: 12px;
  background: color-mix(in srgb, var(--danger-color, #ef4444) 6%, var(--surface-color, var(--card-bg)));
}

.tab-container {
  margin-left: 10px;
  margin-right: 10px;
}

.tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--divider-color);
}

.tab-button {
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  bottom: -1px;
}

.tab-button:hover {
  color: var(--text-color);
  background: var(--hover-bg);
}

.tab-button.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
}

.tab-content {
  min-height: 200px;
  padding: 16px 0;
}

.tab-panel {
  animation: fadeIn 0.2s;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.empty-message {
  text-align: center;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.feature-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feature-card {
  padding: 14px;
  cursor: default;
}

.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-color);
  margin-bottom: 4px;
}

.feature-description {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.comments-panel,
.versions-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
