<template>
  <aside class="right-panel">
    <ZTabs
      :value="activeTab"
      class="side-tabs right-tabs"
      type="line"
      size="small"
      placement="top"
      :animated="false"
      justify-content="space-between"
      :tabs-padding="0"
      tab-class="side-tabs-tab"
      pane-wrapper-class="right-tabs-pane-wrapper"
      pane-class="right-tabs-pane"
      @update:value="$emit('update:active-tab', $event as RightPanelTab)"
    >
      <ZTabPane name="properties" tab="属性" display-directive="show">
        <slot name="properties"></slot>
      </ZTabPane>
      <ZTabPane name="layers" tab="图层" display-directive="show">
        <slot name="layers"></slot>
      </ZTabPane>
      <ZTabPane name="history" tab="历史" display-directive="show">
        <slot name="history"></slot>
      </ZTabPane>
    </ZTabs>
  </aside>
</template>

<script setup lang="ts">
import { ZTabPane, ZTabs } from 'ztools-ui'
import type { RightPanelTab } from '../../types'

defineProps<{
  activeTab: RightPanelTab
}>()

defineEmits<{
  (event: 'update:active-tab', tab: RightPanelTab): void
}>()
</script>

<style lang="scss" scoped>
@use '../../styles/tokens' as *;

.right-panel {
  width: $right-w;
  background: $panel-bg;
  border-left: $border;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
}
.side-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.right-tabs {
  border-bottom: none;
}
:deep(.right-tabs-pane-wrapper),
:deep(.right-tabs-pane) {
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
</style>
