<script setup lang="ts">
import circlePlusIcon from '../assets/icons/circle-plus.svg'
import plusIcon from '../assets/icons/plus.svg'
import timerIcon from '../assets/icons/timer.svg'
import xIcon from '../assets/icons/x.svg'
import { noteColors } from '../composables/todoConstants'
import { useTodoStore } from '../composables/useTodoStore'
import { featureFlags } from '../featureFlags'
import { plainTextInputAttrs } from '../utils/inputAttrs'
import SvgIcon from './SvgIcon.vue'

const store = useTodoStore()

function stopEscape(event: KeyboardEvent, callback: () => void) {
  event.preventDefault()
  event.stopPropagation()
  callback()
}
</script>

<template>
  <main
    class="note-window"
    :style="{ backgroundColor: store.settings.noteBackground, opacity: store.noteFocused.value || !store.settings.noteBlurTransparent ? 1 : store.settings.noteOpacity }"
    @mouseenter="store.noteFocused.value = true"
    @mouseleave="store.noteFocused.value = false"
  >
    <header class="note-toolbar">
      <div class="swatches">
        <button
          v-for="color in noteColors"
          :key="color.background"
          :title="color.name"
          :style="{ backgroundColor: color.background }"
          @click="store.settings.noteBackground = color.background; store.saveSettings()"
        ></button>
      </div>
      <button title="新增任务" @click="store.noteEditingTaskId.value = 'new'">
        <SvgIcon :src="plusIcon" />
      </button>
      <button title="关闭" @click="store.closeCurrentWindow">
        <SvgIcon :src="xIcon" />
      </button>
    </header>
    <section class="note-content">
      <h1>{{ store.noteGroupName.value }}</h1>
      <form v-if="store.noteEditingTaskId.value === 'new'" class="note-new" @submit.prevent="store.createNoteTask(); store.noteEditingTaskId.value = ''">
        <input v-bind="plainTextInputAttrs" v-model="store.noteDraft.value" autofocus placeholder="新任务" />
      </form>
      <article v-for="task in store.noteTasks.value" :key="task._id" class="note-task" :class="{ done: task.completed }">
        <input type="checkbox" :checked="task.completed" @change="store.toggleTask(task)" />
        <input
          v-bind="plainTextInputAttrs"
          v-if="store.noteEditingTaskId.value === task._id"
          v-model="store.editingText.value"
          @keyup.enter="store.saveEditTask(task); store.noteEditingTaskId.value = ''"
          @keydown.esc="stopEscape($event, () => store.noteEditingTaskId.value = '')"
          @blur="store.saveEditTask(task); store.noteEditingTaskId.value = ''"
        />
        <span v-else @click="store.noteEditingTaskId.value = task._id; store.editingText.value = task.text">{{ task.text }}</span>
        <button v-if="featureFlags.tomatoWindow" title="番茄钟" @click="store.openTomato(task)">
          <SvgIcon :src="timerIcon" />
        </button>
      </article>
      <button v-if="!store.noteTasks.value.length" class="note-empty" @click="store.noteEditingTaskId.value = 'new'">
        <SvgIcon :src="circlePlusIcon" :size="20" />
        暂无任务 点击新建
      </button>
    </section>
  </main>
</template>

<style scoped>
.note-window {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border-radius: 10px;
  color: #111827;
  transition: opacity 0.18s;
}

.note-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 4px 7px;
  background: rgba(255, 255, 255, 0.42);
  opacity: 0;
  transition: opacity 0.15s;
  -webkit-app-region: drag;
}

.note-window:hover .note-toolbar {
  opacity: 1;
}

.note-toolbar button {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 7px;
  background: transparent;
  color: #111827;
  -webkit-app-region: no-drag;
}

.swatches {
  display: flex;
  gap: 5px;
}

.swatches button {
  width: 18px;
  height: 18px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 50%;
}

.note-content {
  display: grid;
  align-content: start;
  gap: 6px;
  height: calc(100% - 32px);
  padding: 12px 10px 18px 22px;
  overflow: auto;
}

.note-content h1 {
  margin: 0 0 6px;
  font-size: 16px;
}

.note-task {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.note-task.done span {
  color: #6b7280;
  text-decoration: line-through;
}

.note-task span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-task button {
  opacity: 0;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.48);
  color: #111827;
}

.note-task:hover button {
  opacity: 1;
}

.note-task input[type="text"],
.note-new input {
  width: 100%;
  height: 30px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 6px;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.58);
}

.note-empty {
  display: inline-grid;
  place-items: center;
  gap: 8px;
  min-height: 90px;
  border: 1px dashed #d1d5db;
  border-radius: 7px;
  background: transparent;
  color: #6b7280;
}
</style>

