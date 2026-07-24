<script setup lang="ts">
import { nextTick, proxyRefs, watch } from 'vue'
import circlePlusIcon from '../assets/icons/circle-plus.svg'
import type { TaskDoc } from '../types'
import { useTodoStore } from '../composables/useTodoStore'
import { plainTextInputAttrs } from '../utils/inputAttrs'
import { renderMarkdown } from '../utils/markdown'
import SvgIcon from './SvgIcon.vue'

const store = proxyRefs(useTodoStore())

function resizeAllTextareas() {
  nextTick(() => {
    document.querySelectorAll<HTMLTextAreaElement>('.task-edit-input, .task-create-input').forEach((textarea) => {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    })
  })
}

function showComposerBeforeList() {
  return store.composingTaskGroupId === store.activeGroupId && store.composingTaskAfterId === null
}

function showComposerAfter(task: TaskDoc) {
  return store.composingTaskGroupId === store.activeGroupId && store.composingTaskAfterId === task._id
}

function saveOnPlainEnter(event: KeyboardEvent, callback: () => void) {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  callback()
}

function stopEscape(event: KeyboardEvent, callback: () => void) {
  event.preventDefault()
  event.stopPropagation()
  callback()
}

function resizeTextarea(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  textarea.style.height = 'auto'
  textarea.style.height = `${textarea.scrollHeight}px`
}

watch(
  () => [store.editingTaskId, store.composingTaskGroupId, store.composingTaskAfterId, store.editingText, store.composingTaskText],
  resizeAllTextareas,
  { flush: 'post' }
)

</script>

<template>
  <section class="task-panel" @dragover.prevent @drop="store.onTaskDragDrop()">
    <form
      v-if="showComposerBeforeList()"
      class="task-card task-create-card"
      @submit.prevent="store.saveComposedTask(store.activeGroupId)"
    >
      <textarea
        v-bind="plainTextInputAttrs"
        v-model="store.composingTaskText"
        class="task-create-input"
        placeholder="输入任务内容"
        rows="1"
        @keydown="saveOnPlainEnter($event, () => store.saveComposedTask(store.activeGroupId))"
        @keydown.esc="stopEscape($event, store.cancelComposedTask)"
        @focus="resizeTextarea"
        @input="resizeTextarea"
        @blur="store.saveComposedTask(store.activeGroupId)"
      ></textarea>
    </form>

    <template v-for="task in store.visibleTasks" :key="task._id">
      <article
        class="task-card"
        :class="{
          active: task._id === store.activeTaskId,
          done: task.completed,
          editing: store.editingTaskId === task._id,
          'drop-before': store.dragOverTaskId === task._id && store.dragInsertPosition === 'before',
          'drop-after': store.dragOverTaskId === task._id && store.dragInsertPosition === 'after'
        }"
        :draggable="store.editingTaskId !== task._id"
        @click="store.selectTask(task._id)"
        @dblclick="store.startEditTask(task)"
        @dragstart="store.startTaskDrag(task)"
        @dragend="store.finishTaskDrag"
        @dragover.prevent="store.updateTaskDropTarget($event, task)"
        @dragleave="store.clearTaskDropTarget"
        @drop.stop="store.onTaskDragDrop(task)"
        @contextmenu.prevent="store.openTaskContextMenu($event, task)"
      >
        <input v-if="store.editingTaskId !== task._id" type="checkbox" :checked="task.completed" @change="store.toggleTask(task)" />
        <textarea
          v-bind="plainTextInputAttrs"
          v-if="store.editingTaskId === task._id"
          v-model="store.editingText"
          class="task-edit-input"
          rows="1"
          @keydown="saveOnPlainEnter($event, () => store.saveEditTask(task))"
          @keydown.esc="stopEscape($event, () => store.editingTaskId = '')"
          @click.stop
          @mousedown.stop
          @dragstart.stop
          @focus="resizeTextarea"
          @input="resizeTextarea"
          @blur="store.saveEditTask(task)"
        ></textarea>
        <div v-else-if="store.settings.renderMarkdown" class="task-text markdown-rendered" v-html="renderMarkdown(task.text)"></div>
        <span v-else class="task-text">{{ task.text }}</span>
        <time v-if="task.dueAt && store.editingTaskId !== task._id" class="due-chip">{{ store.compactDate(task.dueAt) }}</time>
      </article>

      <form
        v-if="showComposerAfter(task)"
      class="task-card task-create-card"
      @submit.prevent="store.saveComposedTask(store.activeGroupId)"
    >
        <textarea
          v-bind="plainTextInputAttrs"
          v-model="store.composingTaskText"
          class="task-create-input"
          placeholder="输入任务内容"
          rows="1"
          @keydown="saveOnPlainEnter($event, () => store.saveComposedTask(store.activeGroupId))"
          @keydown.esc="stopEscape($event, store.cancelComposedTask)"
          @focus="resizeTextarea"
          @input="resizeTextarea"
          @blur="store.saveComposedTask(store.activeGroupId)"
        ></textarea>
      </form>
    </template>

    <button
      v-if="!store.visibleTasks.length && !showComposerBeforeList()"
      class="empty-state"
      title="新建任务"
      aria-label="新建任务"
      @click="store.beginCreateTask(store.activeGroupId, null)"
    >
      <SvgIcon :src="circlePlusIcon" :size="20" />
    </button>
  </section>
</template>

<style scoped>
.task-panel {
  display: flex;
  flex-direction: column;
  gap: 7px;
  flex: 1;
  min-height: 0;
  max-width: 920px;
  width: 100%;
  padding: 18px;
  overflow: auto;
}

.task-card {
  position: relative;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 48px;
  padding: 9px 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}

.task-card > input[type="checkbox"] {
  align-self: center;
  width: 15px;
  height: 15px;
  margin-top: 0;
  margin-bottom: 0;
}

.task-card.editing,
.task-create-card {
  grid-template-columns: minmax(0, 1fr);
}

.task-card.drop-before::before,
.task-card.drop-after::after {
  position: absolute;
  left: 10px;
  right: 10px;
  height: 10px;
  background:
    radial-gradient(circle at 4px 50%, var(--primary) 0 4px, transparent 4.5px),
    linear-gradient(var(--primary), var(--primary)) left 4px center / calc(100% - 4px) 2px no-repeat;
  content: "";
}

.task-card.drop-before::before {
  top: -9px;
}

.task-card.drop-after::after {
  bottom: -9px;
}

.task-card:hover {
  border-color: var(--line);
}

.task-card.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(89, 118, 245, 0.12), 0 8px 20px rgba(15, 23, 42, 0.08);
}

.task-card.done .task-text {
  color: var(--muted);
  text-decoration: line-through;
}

.task-create-card {
  padding: 7px 10px;
}

.task-text {
  min-width: 0;
  overflow: visible;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}

.markdown-rendered {
  min-width: 0;
  white-space: normal;
}

.markdown-rendered :deep(*) {
  max-width: 100%;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.markdown-rendered :deep(p),
.markdown-rendered :deep(ul),
.markdown-rendered :deep(ol),
.markdown-rendered :deep(pre),
.markdown-rendered :deep(blockquote) {
  margin: 0;
}

.markdown-rendered :deep(p + p),
.markdown-rendered :deep(p + ul),
.markdown-rendered :deep(p + ol),
.markdown-rendered :deep(ul + p),
.markdown-rendered :deep(ol + p),
.markdown-rendered :deep(pre + p),
.markdown-rendered :deep(blockquote + p) {
  margin-top: 6px;
}

.markdown-rendered :deep(ul),
.markdown-rendered :deep(ol) {
  padding-left: 18px;
}

.markdown-rendered :deep(li + li) {
  margin-top: 3px;
}

.markdown-rendered :deep(code) {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(148, 163, 184, 0.16);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  font-size: 0.92em;
}

.markdown-rendered :deep(pre) {
  overflow: auto;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.08);
}

.markdown-rendered :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-rendered :deep(a) {
  color: var(--primary);
}

.markdown-rendered :deep(blockquote) {
  padding-left: 10px;
  border-left: 2px solid var(--line);
  color: var(--muted);
}

.task-edit-input,
.task-create-input {
  width: 100%;
  min-height: 34px;
  padding: 7px 8px;
  color: var(--text);
  border: 0;
  border-radius: 0;
  background: transparent;
  outline: none;
  overflow: hidden;
  resize: none;
  white-space: pre-wrap;
  field-sizing: content;
}

.task-create-input {
  padding: 7px 10px;
}

.task-edit-input:focus,
.task-create-input:focus {
  outline: none;
  box-shadow: none;
}

.due-chip {
  padding: 2px 7px;
  border-radius: 999px;
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
}

.empty-state {
  display: inline-grid;
  place-items: center;
  gap: 8px;
  min-height: 90px;
  border: 1px dashed var(--line);
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
}

@media (prefers-color-scheme: dark) {
  .task-card {
    border-color: rgba(255, 255, 255, 0.1);
    background: rgba(44, 44, 44, 0.58);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.04),
      0 12px 28px rgba(0, 0, 0, 0.16);
    backdrop-filter: blur(18px) saturate(125%);
  }

  .task-card:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(54, 54, 54, 0.66);
  }

  .task-card.active {
    border-color: rgba(124, 140, 255, 0.72);
    box-shadow:
      0 0 0 1px rgba(124, 140, 255, 0.26),
      0 18px 46px rgba(0, 0, 0, 0.24);
  }

  .empty-state {
    background: rgba(255, 255, 255, 0.035);
    border-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(18px);
  }

  .due-chip {
    background: rgba(250, 204, 21, 0.14);
    color: #fde68a;
  }

  .markdown-rendered :deep(pre) {
    background: rgba(0, 0, 0, 0.22);
  }
}

</style>
