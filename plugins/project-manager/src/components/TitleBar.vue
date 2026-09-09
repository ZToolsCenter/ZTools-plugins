<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '../api';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const isPinned = ref(false);
const isMaximized = ref(false);
let unlistenResize: (() => void) | null = null;

async function checkMaximized() {
  try {
    isMaximized.value = await api.windowIsMaximized();
  } catch (error) {
    console.error('Failed to check maximized state:', error);
  }
}

async function togglePin() {
  try {
    isPinned.value = !isPinned.value;
    await api.windowSetAlwaysOnTop(isPinned.value);
  } catch (error) {
    console.error('Failed to toggle pin:', error);
    isPinned.value = !isPinned.value; // Revert state on error
  }
}

async function minimize() {
  try {
    await api.windowMinimize();
  } catch (error) {
    console.error('Failed to minimize:', error);
  }
}

async function toggleMaximize() {
  try {
    // Manually check and toggle to ensure reliability
    const current = await api.windowIsMaximized();
    if (current) {
      await api.windowUnmaximize();
    } else {
      await api.windowMaximize();
    }
    // Update state immediately
    isMaximized.value = !current;
  } catch (error) {
    console.error('Failed to maximize:', error);
  }
}

async function close() {
  try {
    await api.windowClose();
  } catch (error) {
    console.error('Failed to close:', error);
  }
}

onMounted(async () => {
  await checkMaximized();
  // Listen for resize events to update the maximize state icon
  try {
    unlistenResize = await api.onWindowResize(() => {
      checkMaximized();
    });
  } catch (e) {
    console.error('Failed to setup resize listener:', e);
  }
});

onUnmounted(() => {
  if (unlistenResize) {
    unlistenResize();
  }
});
</script>

<template>
  <div class="app-titlebar">
    <!-- Expanded drag region -->
    <div data-tauri-drag-region class="flex-1 h-full flex items-center pl-4 cursor-default">
      <span class="app-text-caption pointer-events-none font-medium tracking-wide">{{ t('common.title') }}</span>
    </div>
    
    <!-- Control buttons -->
    <div class="flex h-full">
      <div
        class="app-titlebar-control"
        @click.stop="togglePin" :class="{ '!text-blue-500 dark:!text-blue-400': isPinned }" title="Pin to top">
        <div class="i-mdi-pin text-sm" :class="{ 'rotate-45': isPinned }" />
      </div>
      <div
        class="app-titlebar-control"
        @click.stop="minimize" title="Minimize">
        <div class="i-mdi-minus text-sm" />
      </div>
      <div
        class="app-titlebar-control"
        @click.stop="toggleMaximize" :title="isMaximized ? 'Restore' : 'Maximize'">
        <div class="text-sm" :class="isMaximized ? 'i-mdi-window-restore' : 'i-mdi-window-maximize'" />
      </div>
      <div
        class="app-titlebar-control app-titlebar-control-danger"
        @click.stop="close" title="Close">
        <div class="i-mdi-close text-sm" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.i-mdi-pin {
  transition: transform 0.2s;
}
</style>
