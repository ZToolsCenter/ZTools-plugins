<template>
  <div class="insert-panel" :class="`is-${variant}`">
    <ZTabs
      :value="activeTab"
      class="side-tabs insert-tabs"
      type="line"
      size="small"
      placement="top"
      :animated="false"
      justify-content="space-between"
      :tabs-padding="0"
      tab-class="side-tabs-tab"
      pane-wrapper-class="insert-tabs-pane-wrapper"
      pane-class="insert-tabs-pane"
      @update:value="$emit('update:active-tab', $event as LeftPanelTab)"
    >
      <ZTabPane name="shape" tab="形状" display-directive="show">
        <div class="left-content">
          <div class="section-title">基础形状</div>
          <div class="asset-grid">
            <div
              v-for="s in basicShapes"
              :key="s.id"
              class="asset-item"
              :title="s.label"
              draggable="true"
              @click="$emit('add-shape', s)"
              @dragstart="handleInsertDragStart($event, { kind: 'shape', itemId: s.id })"
            >
              <svg class="shape-preview-svg" viewBox="0 0 64 64" aria-hidden="true">
                <path :d="shapePreviewPaths[s.id]" fill="#fff" stroke="#333" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </ZTabPane>
      <ZTabPane name="text" tab="文字" display-directive="show">
        <div class="left-content">
          <div class="section-title">文字预设</div>
          <div class="text-list">
            <button
              v-for="t in textPresets" :key="t.id" class="text-preset-btn"
              draggable="true"
              @click="$emit('add-text', t)"
              @dragstart="handleInsertDragStart($event, { kind: 'text', itemId: t.id })"
            >
              <span :style="{ fontSize: t.fontSize > 30 ? 20 : t.fontSize + 'px', fontWeight: t.fontWeight }">{{ t.label }}</span>
            </button>
          </div>
        </div>
      </ZTabPane>
      <ZTabPane name="assets" tab="素材" display-directive="show">
        <div class="left-content">
          <div class="section-title">我的素材</div>
          <div v-if="userAssets.length" class="user-asset-list">
            <article
              v-for="asset in userAssets"
              :key="asset.id"
              class="user-asset-card"
              :title="asset.name"
            >
              <button
                type="button"
                class="user-asset-preview"
                draggable="true"
                @click="$emit('insert-user-asset', asset)"
                @dragstart="handleInsertDragStart($event, { kind: 'user-asset', itemId: asset.id })"
              >
                <img v-if="asset.thumbnail" :src="asset.thumbnail" :alt="`${asset.name} 预览`" />
                <span v-else class="user-asset-preview-placeholder">素材</span>
              </button>
              <div class="user-asset-info">
                <div class="user-asset-name">{{ asset.name }}</div>
                <div class="user-asset-meta">{{ getUserAssetObjectCountLabel(asset) }} · {{ formatUserAssetDate(asset.updatedAt) }}</div>
                <div class="user-asset-actions">
                  <ZButton size="small" @click="$emit('insert-user-asset', asset)">插入</ZButton>
                  <ZButton size="small" @click="$emit('rename-user-asset', asset)">重命名</ZButton>
                  <ZButton size="small" @click="$emit('delete-user-asset', asset)">删除</ZButton>
                </div>
              </div>
            </article>
          </div>
          <div v-if="!userAssets.length" class="user-asset-empty">
            <div class="user-asset-empty-icon" aria-hidden="true">📦</div>
            <div class="user-asset-empty-title">素材库还是空的</div>
            <div class="user-asset-empty-desc">选中画布对象后，可通过右键菜单将常用对象或组合保存到本地素材库。</div>
          </div>
        </div>
      </ZTabPane>
      <ZTabPane name="iconify" tab="图标库" display-directive="show">
        <div class="left-content" @scroll.passive="handleIconifyBrowseScroll">
          <div class="section-title">Iconify 图标库</div>
          <IconifyCollectionSelect
            class="iconify-collection-filter"
            :model-value="iconifySearch.collectionFilter"
            :options="iconifyCollectionOptions"
            :loading="iconifySearch.collectionsLoading"
            @update:model-value="$emit('update:iconify-collection-filter', $event)"
          />
          <div class="iconify-search-row">
            <ZInput
              :model-value="iconifySearch.query"
              size="small"
              type="text"
              placeholder="搜索 home、user、arrow"
              @update:model-value="$emit('update:iconify-query', String($event))"
              @keydown.enter="$emit('search-iconify-icons')"
            />
            <ZButton size="small" :disabled="iconifySearch.loading" @click="$emit('search-iconify-icons')">
              {{ iconifySearch.loading ? '搜索中' : '搜索' }}
            </ZButton>
          </div>
          <div v-if="iconifySearch.error" class="iconify-error">{{ iconifySearch.error }}</div>
          <template v-else-if="iconifySearch.mode === 'search' && iconifySearch.lastQuery && !iconifySearch.loading">
            <div class="iconify-summary">
              找到 {{ iconifySearch.total }} 个结果，显示 {{ filteredIconifyResults.length }} 个
            </div>
          </template>
          <template v-else-if="iconifySearch.mode === 'browse'">
            <div class="iconify-summary">
              <template v-if="iconifySearch.collectionFilter">图标集 {{ iconifySearch.collectionFilter }}：显示 {{ filteredIconifyResults.length }} / {{ iconifySearch.total }} 个</template>
              <template v-else>默认展示常用图标 {{ filteredIconifyResults.length }} / {{ iconifySearch.total }}</template>
            </div>
          </template>
          <div v-if="filteredIconifyResults.length" class="iconify-grid">
            <button
              v-for="name in filteredIconifyResults"
              :key="name"
              type="button"
              class="iconify-item"
              :title="`插入 ${name}`"
              :disabled="iconifySearch.inserting === name"
              draggable="true"
              @click="$emit('insert-iconify-icon', name)"
              @dragstart="handleInsertDragStart($event, { kind: 'iconify', iconName: name })"
            >
              <Icon class="iconify-preview-icon" :icon="name" />
              <span class="iconify-name">{{ name }}</span>
            </button>
          </div>
          <div v-if="iconifySearch.mode === 'browse' && iconifySearch.hasMore" class="iconify-load-more-row">
            <ZButton size="small" :disabled="iconifySearch.loadingMore" @click="$emit('load-more-iconify-browse-results')">
              {{ iconifySearch.loadingMore ? '加载中' : '加载更多' }}
            </ZButton>
          </div>
          <div v-else-if="iconifySearch.mode === 'search' && iconifySearch.lastQuery && !iconifySearch.loading && !iconifySearch.error" class="iconify-empty">未找到匹配图标</div>
          <div v-else class="iconify-hint">默认按顺序展示常用 Iconify 图标；输入关键词可进一步搜索并筛选结果，空条件搜索会重置回默认列表。</div>
        </div>
      </ZTabPane>
      <ZTabPane name="templates" tab="模板" display-directive="show">
        <div class="left-content">
          <div class="section-title">内置模板库</div>
          <div class="template-list">
            <article
              v-for="template in iconTemplates"
              :key="template.id"
              class="template-card"
              :title="template.description"
            >
              <button
                type="button"
                class="template-preview"
                draggable="true"
                @click="$emit('insert-template', template)"
                @dragstart="handleInsertDragStart($event, { kind: 'template', itemId: template.id })"
              >
                <svg class="template-preview-svg" :viewBox="`0 0 ${template.width} ${template.height}`" aria-hidden="true" v-html="getTemplatePreviewMarkup(template)"></svg>
              </button>
              <div class="template-info">
                <div class="template-name">{{ template.name }}</div>
                <div class="template-meta">{{ template.category }} · {{ template.width }}×{{ template.height }}</div>
                <p class="template-desc">{{ template.description }}</p>
                <div class="template-actions">
                  <ZButton size="small" @click="$emit('insert-template', template)">插入</ZButton>
                  <ZButton size="small" @click="$emit('apply-template-as-document', template)">新建</ZButton>
                </div>
              </div>
            </article>
          </div>
        </div>
      </ZTabPane>
      <ZTabPane name="symbols" tab="符号" display-directive="show">
        <div class="left-content">
          <div class="section-title">文档符号</div>
          <div v-if="symbols.length" class="symbol-list">
            <article
              v-for="symbol in symbols"
              :key="symbol.id"
              class="symbol-card"
              :title="`${symbol.name}（点击插入实例）`"
            >
              <button
                type="button"
                class="symbol-preview"
                draggable="true"
                @click="$emit('insert-symbol', symbol)"
                @dragstart="handleInsertDragStart($event, { kind: 'symbol', itemId: symbol.id })"
              >
                <Icon icon="mdi:vector-square" class="symbol-preview-icon" />
              </button>
              <div class="symbol-info">
                <div class="symbol-name">{{ symbol.name }}</div>
                <div class="symbol-meta">{{ getSymbolObjectCountLabel(symbol) }}</div>
                <div class="symbol-actions">
                  <ZButton size="small" @click="$emit('insert-symbol', symbol)">插入</ZButton>
                  <ZButton size="small" title="用当前画布选中对象重写此定义，并同步全部实例" @click="$emit('update-symbol', symbol)">更新</ZButton>
                  <ZButton size="small" @click="$emit('delete-symbol', symbol)">删除</ZButton>
                </div>
              </div>
            </article>
          </div>
          <div v-if="!symbols.length" class="symbol-empty">
            <div class="symbol-empty-icon" aria-hidden="true">⧉</div>
            <div class="symbol-empty-title">还没有符号</div>
            <div class="symbol-empty-desc">选中画布对象后，通过图层右键菜单「创建为符号」把常用组合保存为可复用定义。</div>
          </div>
        </div>
      </ZTabPane>
    </ZTabs>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { ZButton, ZInput, ZTabPane, ZTabs } from 'ztools-ui'
import IconifyCollectionSelect from './IconifyCollectionSelect.vue'
import type { IconTemplateItem, ShapeId, ShapeLibraryItem, TextLibraryItem } from '../editorCatalog'
import { getTemplatePreviewMarkup } from '../templatePreview'
import { formatUserAssetDate, getUserAssetObjectCountLabel } from '../userAssets'
import type { IconifySearchState, LeftPanelTab, UserAssetItem } from '../types'
import type { ProjectSymbol } from '../symbols'
import { writeInsertDragPayload } from '../editor/modules/assets-import/insertDragPayload'

type SelectOption = {
  label: string
  value: string
  /** 可选的引用式标签文案（如图标集前缀），随名称渲染成小标签。 */
  tag?: string
}

const props = withDefaults(defineProps<{
  activeTab: LeftPanelTab
  basicShapes: ShapeLibraryItem[]
  shapePreviewPaths: Record<ShapeId, string>
  textPresets: TextLibraryItem[]
  iconTemplates: IconTemplateItem[]
  userAssets: UserAssetItem[]
  /** 文档级符号定义列表（见 symbols.ts 说明）。 */
  symbols: ProjectSymbol[]
  iconifySearch: IconifySearchState
  filteredIconifyResults: string[]
  iconifyCollectionOptions: SelectOption[]
  variant?: 'sidebar' | 'popover'
}>(), {
  variant: 'sidebar'
})

const emit = defineEmits<{
  (event: 'update:active-tab', tab: LeftPanelTab): void
  (event: 'add-shape', item: ShapeLibraryItem): void
  (event: 'add-text', item: TextLibraryItem): void
  (event: 'insert-template', template: IconTemplateItem): void
  (event: 'apply-template-as-document', template: IconTemplateItem): void
  (event: 'insert-user-asset', asset: UserAssetItem): void
  (event: 'rename-user-asset', asset: UserAssetItem): void
  (event: 'delete-user-asset', asset: UserAssetItem): void
  (event: 'insert-symbol', symbol: ProjectSymbol): void
  (event: 'update-symbol', symbol: ProjectSymbol): void
  (event: 'delete-symbol', symbol: ProjectSymbol): void
  (event: 'update:iconify-query', value: string): void
  (event: 'search-iconify-icons'): void
  (event: 'load-more-iconify-browse-results'): void
  (event: 'update:iconify-collection-filter', value: string): void
  (event: 'insert-iconify-icon', name: string): void
}>()

/** 生成符号卡片展示的对象数量文案，帮助区分单图形与多对象组合。 */
function getSymbolObjectCountLabel(symbol: ProjectSymbol) {
  return symbol.objects.length > 1 ? `${symbol.objects.length} 个对象` : '1 个对象'
}

/**
 * 将左侧资源卡片写入拖拽负载，供画布 drop 时按类型恢复对应插入命令与落点位置。
 */
function handleInsertDragStart(event: DragEvent, payload: Parameters<typeof writeInsertDragPayload>[1]) {
  writeInsertDragPayload(event.dataTransfer, payload)
}

/**
 * 在默认浏览模式下监听滚动触底，接近底部时自动请求下一批 Iconify 结果，同时保留“加载更多”按钮作为兜底。
 */
function handleIconifyBrowseScroll(event: Event) {
  if (props.iconifySearch.mode !== 'browse' || !props.iconifySearch.hasMore || props.iconifySearch.loadingMore) return
  const target = event.target as HTMLElement | null
  if (!target) return
  const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
  if (distanceToBottom <= 24) {
    emit('load-more-iconify-browse-results')
  }
}
</script>

<style lang="scss" scoped>
@use '../styles/tokens' as *;

.insert-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.insert-panel.is-popover {
  height: 100%;
  overflow: auto;
}

.side-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

:deep(.insert-tabs-pane-wrapper),
:deep(.insert-tabs-pane) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

:deep(.side-tabs > .zt-tabs__nav) {
  width: 100%;
}

:deep(.side-tabs > .zt-tabs__nav .zt-tabs__nav-list) {
  width: 100%;
}

:deep(.side-tabs-tab) {
  flex: 1 1 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  text-align: center;
}

.insert-tabs {
  border-bottom: $border;
}

.left-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.section-title {
  font-weight: 700;
  font-size: 12px;
  padding: 6px 4px;
  color: #555;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 8px;
}

.asset-item {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border: 1px solid rgba(128, 128, 128, 0.15);
  border-radius: 6px;
  cursor: pointer;
  padding: 6px;
  background: #fafafa;
  transition: border-color 0.15s;

  &:hover {
    border-color: #1e6fff;
  }
}

.shape-preview-svg {
  width: 70%;
  height: 70%;
  overflow: visible;
}

.text-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.text-preset-btn {
  padding: 12px;
  border: 1px solid rgba(128, 128, 128, 0.15);
  border-radius: 6px;
  background: #fafafa;
  cursor: pointer;
  text-align: left;

  &:hover {
    border-color: #1e6fff;
  }
}

.template-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-card {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(128, 128, 128, 0.15);
  border-radius: 8px;
  background: #fafafa;
}

.template-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  border: 1px solid rgba(128, 128, 128, 0.12);
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%);
  background-color: #fff;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  &:hover {
    border-color: #1e6fff;
    transform: translateY(-1px);
  }
}

.template-preview-svg {
  width: 62px;
  height: 62px;
  overflow: visible;
}

.template-info {
  min-width: 0;
}

.template-name {
  overflow: hidden;
  color: #333;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-meta {
  margin-top: 2px;
  color: #777;
  font-size: 11px;
}

.template-desc {
  display: -webkit-box;
  overflow: hidden;
  margin: 4px 0 7px;
  color: #666;
  font-size: 11px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.template-actions {
  display: flex;
  gap: 6px;
}

.user-asset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.user-asset-card {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(128, 128, 128, 0.15);
  border-radius: 8px;
  background: #fafafa;
}

.user-asset-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  border: 1px solid rgba(128, 128, 128, 0.12);
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%);
  background-color: #fff;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  &:hover {
    border-color: #1e6fff;
    transform: translateY(-1px);
  }

  img {
    display: block;
    max-width: 62px;
    max-height: 62px;
  }
}

.user-asset-preview-placeholder {
  color: #888;
  font-size: 12px;
}

.user-asset-info {
  min-width: 0;
}

.user-asset-name {
  overflow: hidden;
  color: #333;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-asset-meta {
  margin-top: 2px;
  color: #777;
  font-size: 11px;
}

.user-asset-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.user-asset-empty {
  padding: 24px 8px;
  color: #777;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.user-asset-empty-icon {
  font-size: 28px;
  line-height: 1;
}

.user-asset-empty-title {
  margin-top: 10px;
  color: #555;
  font-size: 13px;
  font-weight: 700;
}

.user-asset-empty-desc {
  margin-top: 6px;
}

.symbol-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.symbol-card {
  display: grid;
  grid-template-columns: 76px minmax(0, 1fr);
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(128, 128, 128, 0.15);
  border-radius: 8px;
  background: #fafafa;
}

.symbol-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 76px;
  border: 1px solid rgba(128, 128, 128, 0.12);
  border-radius: 7px;
  background:
    linear-gradient(45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.08) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.08) 75%);
  background-color: #fff;
  background-position: 0 0, 0 6px, 6px -6px, -6px 0;
  background-size: 12px 12px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.15s;

  &:hover {
    border-color: #1e6fff;
    transform: translateY(-1px);
  }
}

.symbol-preview-icon {
  width: 30px;
  height: 30px;
  color: #666;
}

.symbol-info {
  min-width: 0;
}

.symbol-name {
  overflow: hidden;
  color: #333;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.symbol-meta {
  margin-top: 2px;
  color: #777;
  font-size: 11px;
}

.symbol-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.symbol-empty {
  padding: 24px 8px;
  color: #777;
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}

.symbol-empty-icon {
  font-size: 28px;
  line-height: 1;
}

.symbol-empty-title {
  margin-top: 10px;
  color: #555;
  font-size: 13px;
  font-weight: 700;
}

.symbol-empty-desc {
  margin-top: 6px;
}

.iconify-search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  margin-bottom: 8px;
}

.iconify-summary,
.iconify-hint,
.iconify-empty,
.iconify-error {
  padding: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: #666;
}

.iconify-error {
  color: #c00;
}

.iconify-collection-filter {
  width: 100%;
  margin: 4px 0 8px;
}

.iconify-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.iconify-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 72px;
  padding: 7px 5px;
  border: 1px solid rgba(128, 128, 128, 0.15);
  border-radius: 6px;
  background: #fafafa;
  color: #333;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;

  &:hover:not(:disabled) {
    border-color: #1e6fff;
    color: #1e6fff;
  }

  &:disabled {
    cursor: wait;
    opacity: 0.55;
  }
}

.iconify-preview-icon {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}

.iconify-name {
  width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.insert-panel.is-popover {
  .left-content {
    padding: 10px;
  }

  .asset-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 6px;
  }

  .asset-item {
    // 弹层宽度下六列格子会被撑得过大，限制形状预览格上限并在单元格内居中。
    width: min(100%, 64px);
    justify-self: center;
  }

  .text-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .template-list,
  .user-asset-list,
  .symbol-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }

  .iconify-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

.iconify-load-more-row {
  display: flex;
  justify-content: center;
  padding: 10px 0 4px;
}
</style>
