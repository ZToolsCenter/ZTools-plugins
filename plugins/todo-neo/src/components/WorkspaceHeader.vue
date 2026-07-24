<script setup lang="ts">
import plusIcon from '../assets/icons/plus.svg'
import pinIcon from '../assets/icons/pin.svg'
import timerIcon from '../assets/icons/timer.svg'
import { useTodoStore } from '../composables/useTodoStore'
import { featureFlags } from '../featureFlags'
import SvgIcon from './SvgIcon.vue'

const store = useTodoStore()
</script>

<template>
  <header class="workspace-header">
    <div>
      <h1>{{ store.activeGroup.value?.title || '待办' }}</h1>
      <span>{{ store.visibleTasks.value.length }} 项</span>
    </div>
    <div class="toolbar">
      <button class="tool-button" title="新建任务" @click="store.beginCreateTask(store.activeGroupId.value, store.activeTaskId.value || null)">
        <SvgIcon :src="plusIcon" />
      </button>
      <button v-if="featureFlags.noteWindow" class="tool-button" title="固定便签" @click="store.openNote()">
        <SvgIcon :src="pinIcon" />
      </button>
      <button v-if="featureFlags.tomatoWindow" class="tool-button" title="番茄钟" :disabled="!store.activeTaskId.value" @click="store.openTomato()">
        <SvgIcon :src="timerIcon" />
      </button>
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 56px;
  padding: 8px 10px 8px 18px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.22);
}

.workspace-header div:first-child {
  display: grid;
  gap: 3px;
  user-select: none;
}

.workspace-header span {
  color: var(--muted);
  font-size: 12px;
}

.workspace-header h1 {
  margin: 0;
  font-size: 20px;
  line-height: 1.15;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
  user-select: none;
}

.tool-button {
  display: inline-grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
}

.tool-button:hover {
  background: var(--primary-weak);
  color: var(--primary);
}

@media (max-width: 520px) {
  .toolbar {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

@media (prefers-color-scheme: dark) {
  .workspace-header {
    border-bottom-color: rgba(255, 255, 255, 0.1);
    background: rgba(10, 10, 10, 0.24);
    backdrop-filter: blur(18px);
  }

  .tool-button:hover {
    background: rgba(255, 255, 255, 0.09);
  }
}
</style>
