<script setup lang="ts">
/** *********************嵌套扫描候选列表（按层级缩进渲染）*********************/
import type { ImportNode } from '../api/types';
import type { ProjectModuleKind } from '../types';
import { useI18n } from 'vue-i18n';
import { getCandidateCheckState, countModulesInNode } from '../utils/scanCandidateTree';
import { normalizeProjectPath } from '../utils/projectTree';

const props = defineProps<{
  nodes: ImportNode[];
  /** 已存在于项目库中的归一化路径集合 */
  existingPaths: ReadonlySet<string>;
  /** 已勾选的归一化路径集合 */
  selected: ReadonlySet<string>;
  /** 当前缩进层级，顶层为 0 */
  depth?: number;
  /**
   * 已导入的项目是否可取消勾选（取消即表示移除）。
   *
   * 层级管理场景为 true——用户要能增也要能减。
   * 批量导入场景为 false：它是纯新增语义，已导入的项目只做禁用展示，
   * 避免在一个叫"导入"的弹窗里误删项目。
   */
  allowRemoveExisting?: boolean;
}>();

const emit = defineEmits<{ (e: 'toggle', path: string, checked: boolean): void }>();

const { t } = useI18n();

const validKinds: ProjectModuleKind[] = [
  'frontend', 'backend', 'node', 'go', 'rust', 'python', 'dotnet', 'static', 'unknown',
];

function kindLabel(kind: string): string {
  const normalized = (validKinds as string[]).includes(kind) ? kind : 'unknown';
  return t(`project.moduleKind.${normalized}`);
}

function isExists(node: ImportNode): boolean {
  return props.existingPaths.has(normalizeProjectPath(node.path));
}

function checkState(node: ImportNode) {
  // 纯新增场景下已导入的项目永不进入勾选集合，需排除在统计外，
  // 否则一个子级全勾选的已导入容器会被错误地显示成半选
  return getCandidateCheckState(
    node,
    props.selected,
    props.allowRemoveExisting ? undefined : props.existingPaths,
  );
}

/** 该行是否禁止操作：纯新增场景下已导入的项目不可点 */
function isLocked(node: ImportNode): boolean {
  return isExists(node) && !props.allowRemoveExisting;
}

/** 该行是否已勾选（用于淡化未选中项与显示"将移除"标记） */
function isChecked(node: ImportNode): boolean {
  return props.selected.has(normalizeProjectPath(node.path));
}

/**
 * 切换勾选。允许移除时已导入的项目同样可切换——取消勾选表示把它从项目树中移除。
 */
function onToggle(node: ImportNode, checked: boolean) {
  if (isLocked(node)) return;
  emit('toggle', node.path, checked);
}

/** 转发子层级的 toggle 事件 */
function onChildToggle(path: string, checked: boolean) {
  emit('toggle', path, checked);
}
</script>

<template>
  <div
    v-for="node in nodes"
    :key="node.path"
    class="candidate-node"
  >
    <div
      class="flex items-center gap-2 px-3 py-2 border-b transition-colors"
      :class="[
        isLocked(node) ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/30',
        !isLocked(node) && !isChecked(node) ? 'opacity-60' : '',
      ]"
      :style="{ paddingLeft: `${12 + (depth || 0) * 18}px` }"
      @click="onToggle(node, checkState(node) !== 'checked')"
    >
      <el-checkbox
        :model-value="checkState(node) === 'checked'"
        :indeterminate="checkState(node) === 'indeterminate'"
        :disabled="isLocked(node)"
        @click.stop
        @change="onToggle(node, $event as boolean)"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <div v-if="node.children.length > 0" class="i-mdi-folder-outline text-xs text-slate-400 shrink-0" />
          <span class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{{ node.name }}</span>
          <span class="candidate-chip">{{ kindLabel(node.kind) }}</span>
          <span v-if="node.framework" class="app-text-meta text-slate-400">{{ node.framework }}</span>
          <span v-if="node.hasGit" class="candidate-chip candidate-chip-git"><div class="i-mdi-git text-xs" /> Git</span>
          <span v-if="node.children.length > 0" class="candidate-chip candidate-chip-muted">
            {{ t('import.moduleCount', { count: countModulesInNode(node) }) }}
          </span>
          <span v-if="isExists(node)" class="candidate-chip candidate-chip-muted">{{ t('import.exists') }}</span>
          <!-- 已导入却被取消勾选：确认后会被移除，明确标出来避免误操作 -->
          <span
            v-if="isExists(node) && allowRemoveExisting && !isChecked(node)"
            class="candidate-chip candidate-chip-danger"
          >
            {{ t('import.willRemove') }}
          </span>
        </div>
        <div class="app-text-meta text-slate-400 font-mono truncate">{{ node.path }}</div>
      </div>
    </div>

    <!-- 递归渲染子层级 -->
    <ScanCandidateTree
      v-if="node.children.length > 0"
      :nodes="node.children"
      :existing-paths="existingPaths"
      :selected="selected"
      :depth="(depth || 0) + 1"
      :allow-remove-existing="allowRemoveExisting"
      @toggle="onChildToggle"
    />
  </div>
</template>

<style scoped>
.candidate-node:last-child > div:first-child {
  border-bottom: none;
}
.candidate-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-radius: var(--app-radius-xs);
  font-size: var(--app-font-caption);
  font-weight: 600;
  background: color-mix(in srgb, var(--app-primary) 12%, transparent);
  color: var(--app-primary);
  white-space: nowrap;
}
.candidate-chip-muted {
  background: var(--app-surface-soft);
  color: var(--app-text-muted);
}
.candidate-chip-git {
  background: color-mix(in srgb, #f05033 14%, transparent);
  color: #f05033;
}
.candidate-chip-danger {
  background: color-mix(in srgb, var(--el-color-danger) 14%, transparent);
  color: var(--el-color-danger);
}
</style>
