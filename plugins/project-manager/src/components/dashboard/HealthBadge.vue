<script setup lang="ts">
/**
 * 健康状态徽标：在项目卡片右上角显示小圆点，
 * 颜色编码：绿=健康、黄=有警告、红=有错误、灰=未知。
 * 悬浮时弹出 issues 列表。
 */
import { computed } from 'vue';
import type { ProjectHealthSnapshot, ProjectHealthIssue } from '../../types';

const props = defineProps<{
  snapshot?: ProjectHealthSnapshot;
  level: 'healthy' | 'warn' | 'error' | 'unknown';
}>();

/** 圆点颜色 class */
const dotClass = computed(() => {
  switch (props.level) {
    case 'healthy': return 'bg-emerald-400';
    case 'warn': return 'bg-amber-400';
    case 'error': return 'bg-red-400';
    default: return 'bg-slate-300 dark:bg-slate-600';
  }
});

/** 问题列表（排除 not_git） */
const visibleIssues = computed(() => {
  if (!props.snapshot) return [];
  return props.snapshot.issues.filter((i: ProjectHealthIssue) => i.code !== 'not_git');
});

/** 是否显示 tooltip */
const showTooltip = computed(() => visibleIssues.value.length > 0);
</script>

<template>
  <el-tooltip v-if="showTooltip" placement="top" :show-after="200">
    <template #content>
      <div class="app-text-meta space-y-0.5 max-w-48">
        <div
          v-for="(issue, idx) in visibleIssues"
          :key="idx"
          class="flex items-center gap-1"
        >
          <div
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="issue.level === 'error' ? 'bg-red-400' : 'bg-amber-400'"
          />
          <span>{{ issue.message }}</span>
        </div>
      </div>
    </template>
    <div class="health-badge-dot" :class="dotClass" />
  </el-tooltip>
  <div v-else class="health-badge-dot" :class="dotClass" />
</template>

<style scoped>
.health-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
