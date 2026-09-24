<template>
  <div class="column" :class="{ 'end-col': isLast }">
    <div class="col-head">
      <template v-if="renaming">
        <n-input
          v-model:value="renameName"
          size="tiny"
          maxlength="12"
          @keyup.enter="doRename"
          @blur="doRename"
        />
      </template>
      <template v-else>
        <span class="col-title" :title="`${localTasks.length} 个任务`" @dblclick="startRename">
          {{ column.name }}
          <span class="count">{{ localTasks.length }}</span>
        </span>
        <button v-if="!isFirst && !isLast" class="op danger" title="删除列" @click="removeColumn">✕</button>
      </template>
    </div>

    <draggable
      class="cards"
      :list="localTasks"
      item-key="_id"
      group="tasks"
      :animation="180"
      ghost-class="ghost"
      :disabled="filterActive"
      @change="onChange"
    >
      <template #item="{ element }">
        <TaskCard :task="element" @click="emit('edit-task', element)" @remove="onRemove(element)" />
      </template>
    </draggable>

    <button v-if="isFirst" class="add-task" @click="openCreate">＋ 添加任务</button>
    <div v-else class="add-task placeholder"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NInput, useMessage } from 'naive-ui'
import draggable from 'vuedraggable'
import TaskCard from './TaskCard.vue'
import {
  columnTasks,
  deleteColumn,
  moveTask,
  removeTask,
  renameColumn,
  currentProject
} from '../store'
import { filterText } from '../store'
import type { Column, TaskDoc } from '../types'

const props = defineProps<{ column: Column; isFirst: boolean; isLast: boolean }>()
const emit = defineEmits<{ (e: 'edit-task', task: TaskDoc): void }>()

const message = useMessage()

const remoteTasks = computed(() => columnTasks(props.column.id))
const localTasks = ref<TaskDoc[]>([])
const filterActive = computed(() => !!filterText.value.trim())

watch(
  remoteTasks,
  val => {
    localTasks.value = [...val]
  },
  { immediate: true, deep: false }
)

function onChange(evt: any) {
  if (!evt.added && !evt.moved) return
  const taskId = (evt.added?.element ?? evt.moved.element)._id as string
  const index = evt.moved ? evt.moved.newIndex : evt.added.newIndex
  void moveTask(taskId, props.column.id, index)
    .then(() => {
      if (props.isLast) message.success('任务已完成 🎉')
    })
    .catch((e: unknown) => {
      console.error('[task-plugin] move failed', e)
      message.error('任务移动保存失败')
      // 回弹：以 store 为准重建本地列表
      localTasks.value = [...remoteTasks.value]
    })
}

async function onRemove(task: TaskDoc) {
  await removeTask(task)
}

const renaming = ref(false)
const renameName = ref('')

function startRename() {
  renameName.value = props.column.name
  renaming.value = true
}

async function doRename() {
  if (renaming.value) {
    await renameColumn(props.column, renameName.value)
    renaming.value = false
  }
}

async function removeColumn() {
  if (window.confirm(`删除列「${props.column.name}」？其中任务将移回第一列。`)) {
    await deleteColumn(props.column.id)
  }
}

const showCreate = ref(false)

function openCreate() {
  const project = currentProject.value
  if (!project) return
  emit('edit-task', {
    _id: '',
    projectId: project._id,
    title: '',
    desc: '',
    columnId: props.column.id,
    priority: 'mid',
    dueDate: null,
    order: 0,
    createdAt: Date.now(),
    subtasks: []
  })
}
</script>

<style scoped>
.column {
  flex-shrink: 0;
  width: 264px;
  display: flex;
  flex-direction: column;
  background: rgba(128, 128, 128, 0.07);
  border-radius: 8px;
  padding: 8px;
  min-height: 0;
}
.end-col .col-title {
  color: #18a058;
}
.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 4px 8px;
}
.col-title {
  font-size: 13px;
  font-weight: 600;
  cursor: default;
}
.count {
  font-weight: 400;
  font-size: 11px;
  opacity: 0.6;
  margin-left: 2px;
}
.op {
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
  opacity: 0.6;
  padding: 1px 5px;
}
.op:hover {
  background: rgba(128, 128, 128, 0.18);
  opacity: 1;
}
.op.danger:hover {
  color: #d03050;
}
.cards {
  flex: 1;
  min-height: 40px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ghost {
  opacity: 0.4;
}
.add-task {
  margin-top: 6px;
  border: none;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12.5px;
  color: rgba(128, 128, 128, 0.9);
  cursor: pointer;
}
.add-task:hover {
  background: rgba(128, 128, 128, 0.14);
  color: #18a058;
}
.add-task.placeholder {
  cursor: default;
}
</style>
