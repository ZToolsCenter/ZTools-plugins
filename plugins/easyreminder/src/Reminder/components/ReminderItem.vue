<script setup lang="ts">
import type { Reminder, TriggerRule } from '../../types/reminder'
import { describeRule } from '../../types/reminder'

defineProps<{
  reminder: Reminder
  selected?: boolean
  draggable?: boolean
}>()

const emit = defineEmits<{
  toggle: [id: string]
  edit: [reminder: Reminder]
  copy: [reminder: Reminder]
  delete: [id: string]
  select: [id: string]
  dragstart: [event: DragEvent, id: string]
  dragend: []
}>()

// 一次性规则的过期/已触发标记（一次性规则消费后不再触发）
function ruleMarker(rule: TriggerRule): string {
  if (rule.type !== 'once') return ''
  if (rule.firedAt) return '已触发'
  return rule.triggerAt < Date.now() ? '已过期' : ''
}
</script>

<template>
  <div :class="['reminder-item', { disabled: !reminder.enabled }]">
    <span
      v-if="draggable"
      class="drag-handle"
      draggable="true"
      title="拖拽排序 / 拖到分组"
      @click.stop
      @dragstart="emit('dragstart', $event, reminder.id)"
      @dragend="emit('dragend')"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
        <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
        <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
      </svg>
    </span>
    <label class="item-check" @click.stop>
      <input
        type="checkbox"
        :checked="selected"
        @change="emit('select', reminder.id)"
      />
    </label>
    <div class="item-main">
      <div class="item-header">
        <div class="item-title-row">
          <span class="item-title">{{ reminder.title }}</span>
          <span class="item-desc" v-if="reminder.content">{{ reminder.content }}</span>
        </div>
      </div>
      <div class="item-meta">
        <!-- 每条规则一个标签：同一任务可配置多条规则 -->
        <span
          v-for="rule in reminder.rules"
          :key="rule.id"
          :class="['tag', 'tag-rule', { 'tag-rule-off': !rule.enabled, 'tag-past': ruleMarker(rule) === '已过期' }]"
          :title="rule.enabled ? '' : '该规则已停用'"
        >
          {{ describeRule(rule) }}<template v-if="ruleMarker(rule)"> · {{ ruleMarker(rule) }}</template>
        </span>
      </div>
    </div>
    <div class="item-actions">
      <label class="switch" title="启用/停用">
        <input
          type="checkbox"
          :checked="reminder.enabled"
          @change="emit('toggle', reminder.id)"
        />
        <span class="slider"></span>
      </label>
      <button class="action-btn" @click="emit('copy', reminder)" title="复制">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>
      <button class="action-btn" @click="emit('edit', reminder)" title="编辑">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="action-btn action-delete" @click="emit('delete', reminder.id)" title="删除">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.reminder-item {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  margin-bottom: 10px;
  transition: all 0.2s;
  background: var(--el-bg-color);
}

.reminder-item:hover {
  border-color: var(--el-color-primary-light-5);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.reminder-item.disabled {
  opacity: 0.5;
}

.item-check {
  display: flex;
  align-items: center;
  margin-right: 10px;
  flex-shrink: 0;
}

.drag-handle {
  display: flex;
  align-items: center;
  margin-right: 6px;
  flex-shrink: 0;
  color: var(--el-text-color-placeholder);
  cursor: grab;
}

.drag-handle:active {
  cursor: grabbing;
}

.item-check input {
  width: 15px;
  height: 15px;
  margin: 0;
  accent-color: var(--el-color-primary);
  cursor: pointer;
}

.item-main {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  margin-bottom: 4px;
}

.item-title-row {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 60%;
}

.item-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.item-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
  line-height: 1.6;
  white-space: nowrap;
}

.tag-rule {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.tag-rule-off {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
}

.tag-past {
  text-decoration: line-through;
  opacity: 0.6;
}

.item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 12px;
  flex-shrink: 0;
}

.action-btn {
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  transition: all 0.2s;
  line-height: 1;
  font-size: 12px;
}

.action-btn:hover {
  background: var(--el-fill-color);
  color: var(--el-color-primary);
}

.action-delete:hover {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  margin-right: 6px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--el-fill-color);
  border-radius: 20px;
  transition: 0.3s;
}

.slider::before {
  content: '';
  position: absolute;
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}

.switch input:checked + .slider {
  background-color: var(--el-color-primary);
}

.switch input:checked + .slider::before {
  transform: translateX(16px);
}
</style>
