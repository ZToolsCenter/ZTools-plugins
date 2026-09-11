<template>
  <div class="card" :class="{ done }" @click.stop="emit('click')">
    <div class="title">{{ task.title }}</div>
    <div class="meta">
      <span v-if="hasDesc" class="mini" title="包含描述">📝</span>
      <span v-if="task.dueDate" class="due" :class="{ overdue: isOverdue }">
        {{ task.dueDate }}
      </span>
      <span v-if="subtasks.length" class="sub-badge" :class="{ all: subDone === subtasks.length }">
        ✓ {{ subDone }}/{{ subtasks.length }}
      </span>
    </div>
    <button v-if="!done" class="del" title="删除任务" @click.stop="emit('remove')">✕</button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import dayjs from 'dayjs'
import { isDone } from '../store'
import type { TaskDoc } from '../types'

const props = defineProps<{ task: TaskDoc }>()
const emit = defineEmits<{ (e: 'click'): void; (e: 'remove'): void }>()

const done = computed(() => isDone(props.task))

const subtasks = computed(() => props.task.subtasks ?? [])
const subDone = computed(() => subtasks.value.filter(s => s.done).length)
const hasDesc = computed(() => !!props.task.desc?.trim())

const isOverdue = computed(() => {
  if (!props.task.dueDate || done.value) return false
  return dayjs(props.task.dueDate).isBefore(dayjs(), 'day')
})
</script>

<style scoped>
.card {
  position: relative;
  background: var(--n-color, #fff);
  border: 1px solid rgba(128, 128, 128, 0.18);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  font-size: 13px;
}
:global(.n-config-provider--dark) .card,
html.dark .card {
  background: rgba(255, 255, 255, 0.06);
}
.card:hover {
  border-color: #18a058;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.title {
  line-height: 1.4;
  word-break: break-all;
  padding-right: 14px;
}
.done {
  background: rgba(128, 128, 128, 0.12);
  border-color: transparent;
}
.done .title {
  text-decoration: line-through;
  opacity: 0.5;
}
.done .meta {
  opacity: 0.6;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}
.due {
  font-size: 11px;
  opacity: 0.7;
}
.due.overdue {
  color: #d03050;
  font-weight: 600;
  opacity: 1;
}
.mini {
  font-size: 10px;
  opacity: 0.55;
}
.sub-badge {
  margin-left: auto;
  font-size: 11px;
  color: #18a058;
  background: rgba(24, 160, 88, 0.12);
  border-radius: 8px;
  padding: 0 6px;
}
.sub-badge.all {
  background: rgba(24, 160, 88, 0.22);
  font-weight: 600;
}
.del {
  position: absolute;
  top: 5px;
  right: 5px;
  border: none;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  padding: 1px 4px;
}
.card:hover .del {
  opacity: 0.65;
}
.del:hover {
  background: rgba(208, 48, 80, 0.12);
  color: #d03050;
  opacity: 1 !important;
}
</style>
