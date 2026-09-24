<template>
  <div class="right-panel-scroll">
    <div class="section-title-row">
      <div class="section-title">图标规范检查</div>
      <span class="icon-check-count">{{ issues.length }}</span>
    </div>
    <div v-if="issues.length" class="icon-check-list">
      <button
        v-for="issue in issues"
        :key="issue.id"
        type="button"
        class="icon-check-item"
        :class="`severity-${issue.severity}`"
        @click="$emit('select-issue', issue)"
      >
        <div class="icon-check-item-title">{{ issue.title }}</div>
        <div class="icon-check-item-detail">{{ issue.detail }}</div>
        <div v-if="issue.targetName" class="icon-check-item-target">{{ issue.targetName }}</div>
      </button>
    </div>
    <div v-else class="icon-check-empty">未发现明显规范问题。</div>
  </div>
</template>

<script setup lang="ts">
import type { IconCheckIssue } from '../../types'

defineProps<{
  issues: IconCheckIssue[]
}>()

defineEmits<{
  (event: 'select-issue', issue: IconCheckIssue): void
}>()
</script>

<style lang="scss" scoped>
.right-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  min-width: 300px;
  padding: 5px 10px 20px;
}
.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 8px;
}
.section-title {
  font-weight: 700;
  font-size: 12px;
  padding: 6px 4px;
  color: #555;
}
.icon-check-count {
  min-width: 22px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--primary-light-bg);
  color: var(--primary-color);
  font-size: 11px;
  font-weight: 700;
  text-align: center;
}
.icon-check-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 10px;
}
.icon-check-item {
  display: block;
  width: 100%;
  padding: 8px;
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-left-width: 3px;
  border-radius: 6px;
  background: var(--control-bg);
  color: var(--text-color);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
  &.severity-warning {
    border-left-color: #f59e0b;
  }
  &.severity-info {
    border-left-color: var(--primary-color);
  }
  &:hover {
    border-color: var(--primary-color);
    background: color-mix(in srgb, var(--primary-color) 8%, var(--control-bg));
  }
}
.icon-check-item-title {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}
.icon-check-item-detail,
.icon-check-item-target,
.icon-check-empty,
.preview-hint {
  font-size: 11px;
  color: #777;
  line-height: 1.35;
}
.icon-check-item-target {
  margin-top: 5px;
  color: var(--primary-color);
}
.icon-check-empty {
  margin: 0 8px;
  padding: 14px 8px;
  border: 1px dashed rgba(128, 128, 128, 0.24);
  border-radius: 6px;
  text-align: center;
}
.preview-hint {
  margin: 10px 8px 0;
}
</style>
