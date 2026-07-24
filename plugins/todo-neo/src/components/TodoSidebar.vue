<script setup lang="ts">
import listPlusIcon from '../assets/icons/list-plus.svg'
import listTodoIcon from '../assets/icons/list-todo.svg'
import settingsIcon from '../assets/icons/settings.svg'
import { useTodoStore } from '../composables/useTodoStore'
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
  <aside class="sidebar">
    <section class="group-list">
      <article
        v-for="group in store.groups.value"
        :key="group._id"
        class="group-item"
        :class="{
          active: group._id === store.activeGroupId.value,
          'task-drop-target': store.dragOverTaskGroupId.value === group._id,
          'drop-before': store.dragOverGroupId.value === group._id && store.groupInsertPosition.value === 'before',
          'drop-after': store.dragOverGroupId.value === group._id && store.groupInsertPosition.value === 'after'
        }"
        :draggable="store.editingGroupId.value !== group._id"
        @click="store.selectGroup(group._id)"
        @dragstart="store.startGroupDrag(group)"
        @dragend="store.clearGroupDropTarget"
        @dragover.prevent="store.updateGroupDropTarget($event, group)"
        @dragleave="store.clearGroupDropTarget"
        @drop="store.onGroupDragDrop(group)"
        @contextmenu.prevent="store.openGroupContextMenu($event, group)"
      >
        <SvgIcon class="group-icon" :src="listTodoIcon" :size="14" />
        <input
          v-bind="plainTextInputAttrs"
          v-if="store.editingGroupId.value === group._id"
          v-model="store.editingGroupTitle.value"
          class="group-edit"
          @click.stop
          @mousedown.stop
          @dragstart.stop
          @keyup.enter="store.renameGroup(group)"
          @keydown.esc="stopEscape($event, () => store.editingGroupId.value = '')"
          @blur="store.renameGroup(group)"
        />
        <span v-else class="group-title">{{ group.title }}</span>
        <span class="group-count">{{ store.tasksForGroup(group._id, 'pending').length }}</span>
      </article>

      <form v-if="store.groupComposerOpen.value" class="new-group-row inline-group-composer" @submit.prevent="store.createGroup()">
        <input
          v-bind="plainTextInputAttrs"
          v-model="store.newGroupTitle.value"
          class="group-create-input"
          placeholder="请输入分组名"
          @keydown.esc="stopEscape($event, () => { store.groupComposerOpen.value = false; store.newGroupTitle.value = '' })"
          @blur="store.createGroup()"
        />
      </form>
    </section>

    <footer class="sidebar-footer">
      <button class="add-group-button" @click="store.showGroupComposer">
        <SvgIcon :src="listPlusIcon" :size="18" />
        添加分组
      </button>
      <button class="sidebar-settings-button" title="设置" @click="store.settingsOpen.value = true">
        <SvgIcon :src="settingsIcon" />
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid rgba(148, 163, 184, 0.28);
  background: var(--surface);
}

.group-list {
  display: grid;
  align-content: start;
  gap: 3px;
  min-height: 0;
  flex: 1;
  padding: 10px;
  overflow: auto;
}

.group-item {
  position: relative;
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 9px 4px 10px;
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  user-select: none;
}

.group-item:hover,
.group-item.active {
  background: #edf1f8;
}

.group-item.task-drop-target {
  outline: 1px dashed var(--primary);
  outline-offset: -3px;
  background: rgba(124, 140, 255, 0.1);
  box-shadow: inset 0 0 0 1px rgba(124, 140, 255, 0.14);
}

.group-item.drop-before::before,
.group-item.drop-after::after {
  position: absolute;
  left: 6px;
  right: 8px;
  height: 10px;
  background:
    radial-gradient(circle at 4px 50%, var(--primary) 0 4px, transparent 4.5px),
    linear-gradient(var(--primary), var(--primary)) left 4px center / calc(100% - 4px) 2px no-repeat;
  content: "";
}

.group-item.drop-before::before {
  top: -7px;
}

.group-item.drop-after::after {
  bottom: -7px;
}

.group-icon {
  justify-self: center;
  color: var(--muted);
  opacity: 0.86;
}

.group-item.active .group-icon {
  color: var(--primary);
}

.group-item.task-drop-target .group-icon {
  color: var(--primary);
}

.group-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count {
  min-width: 20px;
  color: var(--muted);
  font-size: 12px;
  text-align: right;
}

.group-edit,
.new-group-row input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--text);
  outline: none;
}

.group-edit {
  padding: 4px 6px;
}

.new-group-row {
  display: block;
  padding: 8px;
}

.new-group-row input {
  min-height: 34px;
  padding: 7px 10px;
  border-color: var(--primary);
}

.inline-group-composer {
  margin-top: 6px;
}

.sidebar-footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  padding: 6px 12px;
  border-top: 1px solid rgba(148, 163, 184, 0.22);
  background: var(--surface);
  user-select: none;
}

.add-group-button {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  min-height: 38px;
  padding: 0 2px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  font-weight: 600;
}

.sidebar-settings-button {
  display: inline-grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.38);
  border-radius: 999px;
  background: transparent;
  color: var(--text);
}

.sidebar-settings-button:hover {
  background: var(--primary-weak);
  border-color: var(--primary);
  color: var(--primary);
}

@media (prefers-color-scheme: dark) {
  .sidebar {
    background: rgba(34, 34, 34, 0.62);
    border-right-color: rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(24px) saturate(130%);
  }

  .group-item:hover,
  .group-item.active {
    background: rgba(255, 255, 255, 0.08);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
  }

  .group-item.task-drop-target {
    background: rgba(124, 140, 255, 0.16);
    box-shadow:
      inset 0 0 0 1px rgba(124, 140, 255, 0.26),
      0 10px 24px rgba(0, 0, 0, 0.16);
  }

  .sidebar-footer {
    border-top-color: rgba(255, 255, 255, 0.1);
    background: rgba(34, 34, 34, 0.68);
    backdrop-filter: blur(18px);
  }

  .sidebar-settings-button {
    border-color: rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.04);
  }

}
</style>
