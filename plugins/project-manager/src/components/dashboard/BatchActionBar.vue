<script setup lang="ts">
/**
 * 批量操作工具条：当进入批量模式时，
 * 在项目列表底部显示 sticky 工具条，
 * 提供全选/反选、加标签、改分组、置顶/取消置顶、刷新、删除等操作。
 */
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

defineProps<{
  selectedCount: number;
  isAllSelected: boolean;
  totalVisible: number;
  allTags: string[];
  groups: { id: string; name: string }[];
}>();

const emit = defineEmits<{
  exit: [];
  toggleSelectAll: [];
  batchSetGroup: [groupId: string];
  batchAddTag: [tag: string];
  batchRemoveTag: [tag: string];
  batchPin: [];
  batchUnpin: [];
  batchRefresh: [];
  batchOpenFolder: [];
  batchRemove: [];
}>();

/** 标签操作模式 */
const tagMode = ref<'add' | 'remove'>('add');

/** 标签选择变化的处理 */
function handleTagChange(v: string) {
  if (!v) return;
  if (tagMode.value === 'add') {
    emit('batchAddTag', v);
  } else {
    emit('batchRemoveTag', v);
  }
}
</script>

<template>
  <div class="batch-action-bar fixed bottom-0 left-0 right-0 z-40 px-3 py-2 flex items-center gap-2">
    <!-- 退出 -->
    <button
      class="app-icon-btn !h-7 !min-w-7 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1 shrink-0"
      @click="emit('exit')"
    >
      <div class="i-mdi-close text-sm" />
    </button>

    <!-- 选中数量 -->
    <span class="app-text-meta text-slate-500 dark:text-slate-400 shrink-0">
      {{ t('dashboard.batchSelected', { count: selectedCount }) }}
    </span>

    <!-- 全选 -->
    <button
      class="app-outline-action app-text-control px-1.5 py-0.5 shrink-0"
      @click="emit('toggleSelectAll')"
    >
      {{ isAllSelected ? t('dashboard.batchDeselectAll') : t('dashboard.batchSelectAll') }}
    </button>

    <div class="h-4 w-px bg-[var(--app-border)] shrink-0" />

    <!-- 分组 -->
    <el-select
      size="small"
      :placeholder="t('dashboard.batchSetGroup')"
      clearable
      class="!w-28 shrink-0"
      @change="(v: string) => emit('batchSetGroup', v || '')"
    >
      <el-option :label="t('dashboard.ungrouped')" value="" />
      <el-option
        v-for="g in groups"
        :key="g.id"
        :label="g.name"
        :value="g.id"
      />
    </el-select>

    <!-- 标签 -->
    <div class="flex items-center gap-1 shrink-0">
      <el-select
        size="small"
        :placeholder="t('dashboard.batchTag')"
        clearable
        filterable
        allow-create
        class="!w-24"
        @change="handleTagChange"
      >
        <el-option
          v-for="tag in allTags"
          :key="tag"
          :label="tag"
          :value="tag"
        />
      </el-select>
      <el-segmented
        v-model="tagMode"
        :options="[
          { label: '+', value: 'add' },
          { label: '−', value: 'remove' },
        ]"
        size="small"
      />
    </div>

    <div class="h-4 w-px bg-[var(--app-border)] shrink-0" />

    <!-- 置顶/取消置顶 -->
    <button
      class="app-outline-action app-text-control px-1.5 py-0.5 shrink-0"
      @click="emit('batchPin')"
    >
      <div class="i-mdi-pin text-xs inline mr-0.5" />
      {{ t('dashboard.batchPin') }}
    </button>
    <button
      class="app-outline-action app-text-control px-1.5 py-0.5 shrink-0"
      @click="emit('batchUnpin')"
    >
      <div class="i-mdi-pin-off text-xs inline mr-0.5" />
      {{ t('dashboard.batchUnpin') }}
    </button>

    <div class="flex-1" />

    <!-- 右侧危险/辅助操作 -->
    <button
      class="app-outline-action app-text-control px-1.5 py-0.5 shrink-0"
      @click="emit('batchRefresh')"
    >
      <div class="i-mdi-refresh text-xs inline mr-0.5" />
      {{ t('common.refresh') }}
    </button>
    <button
      class="app-outline-action app-text-control px-1.5 py-0.5 shrink-0"
      @click="emit('batchOpenFolder')"
    >
      <div class="i-mdi-folder-open-outline text-xs inline mr-0.5" />
      {{ t('dashboard.batchOpenFolder') }}
    </button>
    <button
      class="app-danger-action app-text-control px-1.5 py-0.5 shrink-0"
      @click="emit('batchRemove')"
    >
      <div class="i-mdi-delete-outline text-xs inline mr-0.5" />
      {{ t('dashboard.batchRemove') }}
    </button>
  </div>
</template>

<style scoped>
.batch-action-bar {
  background: var(--app-surface-raised);
  border-top: 1px solid var(--app-border);
  box-shadow: 0 -8px 24px color-mix(in srgb, var(--app-text) 8%, transparent);
  backdrop-filter: blur(12px);
}
</style>
