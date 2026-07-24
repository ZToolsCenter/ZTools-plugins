<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import infoIcon from '../assets/icons/info.svg'
import pencilIcon from '../assets/icons/pencil.svg'
import pinIcon from '../assets/icons/pin.svg'
import timerIcon from '../assets/icons/timer.svg'
import trashIcon from '../assets/icons/trash-2.svg'
import { useTodoStore } from '../composables/useTodoStore'
import { featureFlags } from '../featureFlags'
import SvgIcon from './SvgIcon.vue'

const store = useTodoStore()

function showTaskDetails() {
  if (store.contextTask.value) store.detailTaskId.value = store.contextTask.value._id
  store.closeContextMenu()
}

function openTaskTomato() {
  if (store.contextTask.value) store.openTomato(store.contextTask.value)
  store.closeContextMenu()
}

function requestTaskDelete() {
  if (store.contextTask.value) store.requestDeleteTask(store.contextTask.value)
  store.closeContextMenu()
}

function pinGroup() {
  if (store.contextGroup.value) store.openNote(store.contextGroup.value)
  store.closeContextMenu()
}

function editGroup() {
  if (store.contextGroup.value) store.startGroupEdit(store.contextGroup.value)
  store.closeContextMenu()
}

function requestGroupDelete() {
  if (store.contextGroup.value) store.deleteGroupId.value = store.contextGroup.value._id
  store.closeContextMenu()
}

onMounted(() => {
  window.addEventListener('click', store.closeContextMenu)
  window.addEventListener('keydown', store.closeContextMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', store.closeContextMenu)
  window.removeEventListener('keydown', store.closeContextMenu)
})
</script>

<template>
  <div
    v-if="store.contextMenu.value.open"
    class="context-menu"
    :style="{ left: `${store.contextMenu.value.x}px`, top: `${store.contextMenu.value.y}px` }"
    @click.stop
  >
    <template v-if="store.contextMenu.value.kind === 'task'">
      <button @click="showTaskDetails"><SvgIcon :src="infoIcon" />详情</button>
      <button v-if="featureFlags.tomatoWindow" @click="openTaskTomato"><SvgIcon :src="timerIcon" />番茄</button>
      <button class="danger" @click="requestTaskDelete"><SvgIcon :src="trashIcon" />删除</button>
    </template>

    <template v-else-if="store.contextMenu.value.kind === 'group'">
      <button v-if="featureFlags.noteWindow" @click="pinGroup"><SvgIcon :src="pinIcon" />固定</button>
      <button @click="editGroup"><SvgIcon :src="pencilIcon" />编辑</button>
      <button class="danger" @click="requestGroupDelete"><SvgIcon :src="trashIcon" />删除</button>
    </template>
  </div>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 20;
  display: grid;
  min-width: 96px;
  padding: 5px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
  user-select: none;
}

.context-menu button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
}

.context-menu button:hover {
  background: var(--primary-weak);
  color: var(--primary);
}

.context-menu button.danger {
  color: var(--danger);
}

@media (prefers-color-scheme: dark) {
  .context-menu {
    border-color: rgba(255, 255, 255, 0.13);
    background: rgba(30, 30, 30, 0.76);
    box-shadow: 0 20px 54px rgba(0, 0, 0, 0.42);
    backdrop-filter: blur(22px) saturate(135%);
  }

  .context-menu button:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}
</style>
