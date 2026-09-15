<script setup lang="ts">
import type { Reminder, DaySchedule } from '../../types/reminder'
import { WEEKDAY_LABELS, REMINDER_TYPE_LABELS } from '../../types/reminder'

const props = defineProps<{
  reminder: Reminder
}>()

const emit = defineEmits<{
  toggle: [id: string]
  edit: [reminder: Reminder]
  delete: [id: string]
}>()

function formatWeekdays(days: number[]): string {
  if (days.length === 7) return '每天'
  return days.map(d => WEEKDAY_LABELS[d]).join('、')
}

function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟`
  const h = minutes / 60
  return Number.isInteger(h) ? `${h}小时` : `${minutes}分钟`
}

interface TimeGroup {
  days: string
  time: string
}

function groupByTime(schedules: DaySchedule[]): TimeGroup[] {
  if (schedules.length === 0) return []
  const sorted = [...schedules].sort((a, b) => a.weekday - b.weekday)
  const map = new Map<string, number[]>()
  for (const s of sorted) {
    const key = `${s.startTime}-${s.endTime}`
    if (!map.has(key)) map.set(key, [])
    if (!map.get(key)!.includes(s.weekday)) map.get(key)!.push(s.weekday)
  }
  const groups: TimeGroup[] = []
  for (const [time, weekdays] of map) {
    groups.push({
      days: weekdays.sort((a, b) => a - b).map(w => WEEKDAY_LABELS[w]).join('、'),
      time
    })
  }
  return groups
}

function formatOnceTime(timestamp: number): string {
  const d = new Date(timestamp)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${month}月${day}日 ${h}:${m}`
}

function isOncePast(timestamp: number): boolean {
  return Date.now() >= timestamp
}
</script>

<template>
  <div :class="['reminder-item', { disabled: !reminder.enabled }]">
    <div class="item-main">
      <div class="item-header">
        <span class="item-title">{{ reminder.title }}</span>
        <div class="item-toggle">
          <label class="switch">
            <input
              type="checkbox"
              :checked="reminder.enabled"
              @change="emit('toggle', reminder.id)"
            />
            <span class="slider"></span>
          </label>
        </div>
      </div>
      <div class="item-desc" v-if="reminder.content">{{ reminder.content }}</div>
      <div class="item-meta">
        <span class="tag tag-type">{{ REMINDER_TYPE_LABELS[reminder.type] }}</span>

        <!-- once 类型 -->
        <template v-if="reminder.type === 'once'">
          <span class="tag" :class="{ 'tag-past': isOncePast(reminder.triggerAt || 0) }">
            {{ formatOnceTime(reminder.triggerAt || 0) }}
            <template v-if="isOncePast(reminder.triggerAt || 0)"> · 已过期</template>
          </span>
        </template>

        <!-- daily 类型 -->
        <template v-if="reminder.type === 'daily'">
          <span class="tag">{{ formatWeekdays(reminder.weekdays || []) }}</span>
          <span class="tag">{{ reminder.triggerTime }}</span>
        </template>

        <!-- interval 类型 -->
        <template v-if="reminder.type === 'interval'">
          <span class="tag">{{ formatWeekdays([...new Set(reminder.schedules.map(s => s.weekday))].sort((a, b) => a - b)) }}</span>
          <template v-if="groupByTime(reminder.schedules).length <= 1">
            <span class="tag">{{ groupByTime(reminder.schedules)[0]?.time }}</span>
          </template>
          <template v-else>
            <span v-for="(g, i) in groupByTime(reminder.schedules)" :key="i" class="tag tag-group">
              {{ g.days }} {{ g.time }}
            </span>
          </template>
          <span class="tag">每{{ formatInterval(reminder.interval) }}</span>
        </template>
      </div>
    </div>
    <div class="item-actions">
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

.item-main {
  flex: 1;
  min-width: 0;
}

.item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.item-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.tag-type {
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning);
}

.tag-group {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.tag-past {
  text-decoration: line-through;
  opacity: 0.6;
}

.item-actions {
  display: flex;
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
