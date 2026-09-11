<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import type { UnlistenFn } from '@tauri-apps/api/event';
import ProjectQuickSearch from './components/ProjectQuickSearch.vue';
import { loadData } from './utils/persistence';

const searchSession = ref(0);
let unlistenOpen: UnlistenFn | null = null;
let unlistenFocus: UnlistenFn | null = null;
let unlistenClose: UnlistenFn | null = null;
let windowDragging = false;
let ignoreBlurUntil = 0;

async function refreshSearchData() {
  await loadData();
  searchSession.value += 1;
  await nextTick();
}

async function hideSearchWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().hide();
}

async function selectProject(projectId: string) {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', 'quick-search-selected', { projectId });
  await hideSearchWindow();
}

async function selectScript(projectId: string, scriptName: string) {
  const { emitTo } = await import('@tauri-apps/api/event');
  await emitTo('main', 'quick-search-selected', { projectId, scriptName });
  await hideSearchWindow();
}

function handleDraggingChange(dragging: boolean) {
  windowDragging = dragging;
  if (!dragging) {
    ignoreBlurUntil = Date.now() + 300;
  }
}

onMounted(async () => {
  await refreshSearchData();

  const { listen } = await import('@tauri-apps/api/event');
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const currentWindow = getCurrentWindow();

  unlistenOpen = await listen('quick-search-open', () => {
    void refreshSearchData();
  });
  unlistenFocus = await currentWindow.onFocusChanged(async ({ payload: focused }) => {
    if (!focused && !windowDragging && Date.now() >= ignoreBlurUntil) {
      await currentWindow.hide();
    }
  });
  unlistenClose = await currentWindow.onCloseRequested(async (event) => {
    event.preventDefault();
    await currentWindow.hide();
  });
});

onUnmounted(() => {
  unlistenOpen?.();
  unlistenFocus?.();
  unlistenClose?.();
});
</script>

<template>
  <main class="quick-search-window">
    <ProjectQuickSearch
      :key="searchSession"
      standalone
      @close="hideSearchWindow"
      @dragging-change="handleDraggingChange"
      @select="selectProject"
      @select-script="selectScript"
    />
  </main>
</template>

<style scoped>
.quick-search-window {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--app-border);
  background: var(--app-surface);
  box-sizing: border-box;
}
</style>
