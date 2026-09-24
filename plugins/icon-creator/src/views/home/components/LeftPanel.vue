<template>
  <aside class="left-panel" :class="{ 'is-collapsed': collapsed }">
    <div class="left-panel__content" :aria-hidden="collapsed ? 'true' : 'false'" :inert="collapsed">
      <InsertPanelContent
        variant="sidebar"
        :active-tab="activeTab"
        :basic-shapes="basicShapes"
        :shape-preview-paths="shapePreviewPaths"
        :text-presets="textPresets"
        :icon-templates="iconTemplates"
        :user-assets="userAssets"
        :symbols="symbols"
        :iconify-search="iconifySearch"
        :filtered-iconify-results="filteredIconifyResults"
        :iconify-collection-options="iconifyCollectionOptions"
        @update:active-tab="$emit('update:active-tab', $event)"
        @add-shape="$emit('add-shape', $event)"
        @add-text="$emit('add-text', $event)"
        @insert-template="$emit('insert-template', $event)"
        @apply-template-as-document="$emit('apply-template-as-document', $event)"
        @insert-user-asset="$emit('insert-user-asset', $event)"
        @rename-user-asset="$emit('rename-user-asset', $event)"
        @delete-user-asset="$emit('delete-user-asset', $event)"
        @insert-symbol="$emit('insert-symbol', $event)"
        @update-symbol="$emit('update-symbol', $event)"
        @delete-symbol="$emit('delete-symbol', $event)"
        @update:iconify-query="$emit('update:iconify-query', $event)"
        @search-iconify-icons="$emit('search-iconify-icons')"
        @load-more-iconify-browse-results="$emit('load-more-iconify-browse-results')"
        @update:iconify-collection-filter="$emit('update:iconify-collection-filter', $event)"
        @insert-iconify-icon="$emit('insert-iconify-icon', $event)"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import InsertPanelContent from './InsertPanelContent.vue'
import type { IconTemplateItem, ShapeId, ShapeLibraryItem, TextLibraryItem } from '../editorCatalog'
import type { IconifySearchState, LeftPanelTab, UserAssetItem } from '../types'
import type { ProjectSymbol } from '../symbols'

type SelectOption = {
  label: string
  value: string
}

defineProps<{
  collapsed: boolean
  activeTab: LeftPanelTab
  basicShapes: ShapeLibraryItem[]
  shapePreviewPaths: Record<ShapeId, string>
  textPresets: TextLibraryItem[]
  iconTemplates: IconTemplateItem[]
  userAssets: UserAssetItem[]
  symbols: ProjectSymbol[]
  iconifySearch: IconifySearchState
  filteredIconifyResults: string[]
  iconifyCollectionOptions: SelectOption[]
}>()

defineEmits<{
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
</script>

<style lang="scss" scoped>
@use '../styles/tokens' as *;

.left-panel {
  width: $left-w;
  background: $panel-bg;
  border-right: $border;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  transition: width 0.22s ease, border-color 0.22s ease;

  &.is-collapsed {
    width: 0;
    border-right-color: transparent;
  }
}

.left-panel__content {
  width: $left-w;
  min-width: $left-w;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  opacity: 1;
  transform: translateX(0);
  transition: opacity 0.16s ease, transform 0.22s ease;
}

.left-panel.is-collapsed .left-panel__content {
  opacity: 0;
  transform: translateX(-14px);
  pointer-events: none;
}
</style>
