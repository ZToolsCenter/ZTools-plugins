<script setup lang="ts">
import { useTodoStore } from '../composables/useTodoStore'
import ConfirmDialog from './ConfirmDialog.vue'
import GlobalContextMenu from './GlobalContextMenu.vue'
import SettingsDrawer from './SettingsDrawer.vue'
import TaskDetailDrawer from './TaskDetailDrawer.vue'
import TaskList from './TaskList.vue'
import TaskSearchPicker from './TaskSearchPicker.vue'
import TodoSidebar from './TodoSidebar.vue'
import WorkspaceHeader from './WorkspaceHeader.vue'

const store = useTodoStore()

function confirmDeleteGroup() {
  const group = store.groupById(store.deleteGroupId.value)
  if (group) store.deleteGroup(group)
}
</script>

<template>
  <main class="app-shell">
    <TodoSidebar />

    <section class="workspace">
      <WorkspaceHeader />
      <TaskList />
    </section>

    <SettingsDrawer />
    <TaskDetailDrawer />
    <GlobalContextMenu />
    <TaskSearchPicker />

    <ConfirmDialog
      :open="Boolean(store.deleteGroupId.value)"
      title="删除分组"
      message="删除分组后，分组内的事项都会被删除。"
      @cancel="store.deleteGroupId.value = ''"
      @confirm="confirmDeleteGroup"
    />

    <ConfirmDialog
      :open="Boolean(store.deletingTask.value)"
      title="删除任务"
      message="删除任务后，将不会出现在任务列表中。"
      @cancel="store.deleteTaskId.value = ''"
      @confirm="store.confirmDeleteTask"
    />
  </main>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 252px minmax(0, 1fr);
  height: 100%;
  background: var(--bg);
}

.workspace {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, rgba(89, 118, 245, 0.08), transparent 34%),
    var(--bg);
}

@media (max-width: 520px) {
  .app-shell {
    grid-template-columns: 210px minmax(320px, 1fr);
  }
}

@media (prefers-color-scheme: dark) {
  .workspace {
    background:
      radial-gradient(circle at top right, rgba(255, 255, 255, 0.09), transparent 32%),
      linear-gradient(135deg, rgba(255, 255, 255, 0.055), transparent 38%),
      var(--bg);
  }
}
</style>
