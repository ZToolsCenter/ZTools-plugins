<script setup lang="ts">
/**
 * 保存视图 chips 组件：显示在左侧项目列表顶部，
 * 点击 chip 可一键恢复筛选条件，支持删除。
 */
import { ref } from 'vue';
import type { ProjectViewPreset } from '../../types';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
  presets: ProjectViewPreset[];
  activePresetId: string | null;
}>();

const emit = defineEmits<{
  apply: [preset: ProjectViewPreset];
  delete: [id: string];
  save: [name: string];
}>();

/** 是否显示保存对话框 */
const showSaveDialog = ref(false);
const newViewName = ref('');

/** 保存视图 */
function handleSave() {
  const name = newViewName.value.trim();
  if (!name) return;
  emit('save', name);
  newViewName.value = '';
  showSaveDialog.value = false;
}
</script>

<template>
  <div class="view-preset-chips">
    <div class="flex items-center gap-1.5 flex-wrap">
      <!-- 已保存的视图 chips -->
      <button
        v-for="preset in presets"
        :key="preset.id"
        class="app-text-control inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
        :class="activePresetId === preset.id
          ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-transparent hover:bg-slate-200 dark:hover:bg-slate-700'"
        @click="emit('apply', preset)"
      >
        <div class="i-mdi-eye-outline text-xs" />
        <span class="max-w-20 truncate">{{ preset.name }}</span>
        <div
          class="i-mdi-close-circle text-xs opacity-40 hover:opacity-100 ml-0.5"
          @click.stop="emit('delete', preset.id)"
        />
      </button>

      <!-- 保存当前视图按钮（精简版） -->
      <button
        v-if="!showSaveDialog"
        class="dashboard-secondary-action"
        @click="showSaveDialog = true"
      >
        <div class="i-mdi-content-save-outline text-sm" />
        <span>{{ t('dashboard.saveView') }}</span>
      </button>

      <!-- 行内保存输入 -->
      <div v-if="showSaveDialog" class="inline-flex items-center gap-1">
        <input
          v-model="newViewName"
          :placeholder="t('dashboard.viewNamePlaceholder')"
          class="app-text-control w-24 px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-transparent outline-none focus:border-blue-500"
          @keydown.enter="handleSave"
          @keydown.escape="showSaveDialog = false"
          autofocus
        />
        <button
          class="app-text-control text-blue-500 hover:text-blue-600"
          @click="handleSave"
        >{{ t('common.confirm') }}</button>
        <button
          class="app-text-control text-slate-400 hover:text-slate-600"
          @click="showSaveDialog = false"
        >{{ t('common.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view-preset-chips {
  display: flex;
  min-width: 0;
  align-items: center;
}
</style>
