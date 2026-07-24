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
  <div class="h-8 bg-white dark:bg-[#0f172a] flex items-center select-none z-50 transition-colors duration-200 border-b border-slate-200/80 dark:border-slate-800/50 shrink-0">
    <!-- Expanded drag region -->
    <div data-tauri-drag-region class="flex-1 h-full flex items-center pl-4 cursor-default">
      <span class="text-xs text-slate-500 dark:text-slate-400 pointer-events-none font-medium tracking-wide">{{ t('common.title') }}</span>
    </div>
    
    <!-- Control buttons -->
    <div class="flex h-full">
      <div
        class="w-10 h-full flex justify-center items-center hover:bg-slate-100 dark:hover:bg-white/8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-150"
        @click.stop="togglePin" :class="{ '!text-blue-500 dark:!text-blue-400': isPinned }" title="Pin to top">
        <div class="i-mdi-pin text-sm" :class="{ 'rotate-45': isPinned }" />
      </div>
      <div
        class="w-10 h-full flex justify-center items-center hover:bg-slate-100 dark:hover:bg-white/8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-150"
        @click.stop="minimize" title="Minimize">
        <div class="i-mdi-minus text-sm" />
      </div>
      <div
        class="w-10 h-full flex justify-center items-center hover:bg-slate-100 dark:hover:bg-white/8 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors duration-150"
        @click.stop="toggleMaximize" :title="isMaximized ? 'Restore' : 'Maximize'">
        <div class="text-sm" :class="isMaximized ? 'i-mdi-window-restore' : 'i-mdi-window-maximize'" />
      </div>
      <div
        class="w-10 h-full flex justify-center items-center hover:bg-red-500 text-slate-400 dark:text-slate-500 hover:text-white transition-colors duration-150"
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
