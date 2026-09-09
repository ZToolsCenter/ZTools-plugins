<script setup lang="ts">
/** *********************子项目扫描/层级选择弹窗*********************
 *
 * 三个入口共用这一套树形选择 UI，父项目在三者中都已入库：
 * 1. 单个添加项目后的层级选择——Dashboard 先创建父项目，再把已扫描的候选树
 *    通过 presetNodes 传进来，由用户决定挂载哪几级；
 * 2. 编辑项目时再次调整层级——AddProjectModal 打开本弹窗重新扫描；
 * 3. 已有项目工作区的"管理子项目"——ProjectWorkspace 直接扫描其路径。
 */
import { ref, computed, watch } from 'vue';
import { useProjectStore } from '../stores/project';
import { api } from '../api';
import type { ImportNode } from '../api/types';
import type { Project } from '../types';
import { useI18n } from 'vue-i18n';
import { ElMessage, ElMessageBox } from 'element-plus';
import ScanCandidateTree from './ScanCandidateTree.vue';
import { MAX_PROJECT_DEPTH, normalizeProjectPath } from '../utils/projectTree';
import {
  buildDefaultSelection,
  collectDeselectedExistingPaths,
  collectForestPaths,
  mergeExistingSubtree,
  pruneSelectedTree,
  toggleCandidateSelection,
} from '../utils/scanCandidateTree';

const props = defineProps<{
  modelValue: boolean;
  parentProject: Project;
  /**
   * 预先扫描好的候选树。调用方已经扫过一次时传入，避免重复请求后端，
   * 也保证弹窗展示的候选与调用方之前提示的数量一致。
   */
  presetNodes?: ImportNode[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  /**
   * 弹窗已彻底关闭（关闭动画结束后触发，无论是否添加了子项目）。
   *
   * 调用方用 v-if 控制本弹窗时必须等这个事件再清理数据，
   * 若在点确认的瞬间就卸载组件，关闭动画会被硬生生截断。
   */
  (e: 'closed'): void;
}>();

const { t } = useI18n();
const projectStore = useProjectStore();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const scanning = ref(false);
/** 候选嵌套树 */
const nodes = ref<ImportNode[]>([]);
/** 已勾选的归一化路径 */
const selected = ref<Set<string>>(new Set());

/** 父项目当前深度：其子项目深度 = parentDepth + 1，须 ≤ MAX_PROJECT_DEPTH */
const parentDepth = computed(() => projectStore.getProjectDepth(props.parentProject.id));
/** 是否允许再加一层子项目 */
const canAddChildren = computed(() => parentDepth.value < MAX_PROJECT_DEPTH);

/**
 * 本次编辑的作用域：**仅当前父项目的后代**。
 *
 * 绝不能用全库项目 —— 被扫描到的目录可能已作为别的父级下的项目、或作为一级项目
 * 存在于库中，那样它会显示「已存在」并默认勾选；用户一取消，就会把
 * 不属于本次编辑范围的项目连同其后代一起删掉。
 */
const scopedProjects = computed(() => {
  const ids = projectStore.collectDescendantIds(props.parentProject.id);
  return projectStore.projects.filter((p) => ids.has(p.id));
});

/** 当前父项目下已存在的归一化路径 */
const existingPaths = computed(
  () => new Set(scopedProjects.value.map((p) => normalizeProjectPath(p.path))),
);

/** 归一化路径 → 项目 id，用于把取消勾选的候选节点对应回真实项目 */
const pathToProjectId = computed(
  () => new Map(scopedProjects.value.map((p) => [normalizeProjectPath(p.path), p.id])),
);

/**
 * 把父项目下**已入库的子树**转成候选节点形状。
 *
 * 扫描结果覆盖不到全部已有子项目（深度预算用尽、或父目录带清单不再向内递归），
 * 而候选里没有的节点无法被取消勾选。把已有子树一并喂进去，用户才删得掉。
 */
function buildExistingSubtree(parentId: string): ImportNode[] {
  return projectStore.getChildren(parentId).map((child) => ({
    name: child.name,
    path: child.path,
    kind: child.moduleKind ?? 'unknown',
    hasGit: !!child.gitConfigured,
    hasPackageJson: child.type === 'node',
    scripts: child.scripts ?? [],
    children: buildExistingSubtree(child.id),
  }));
}

/** 应用候选树并重置默认勾选：已有项目保留，新候选等待用户明确选择。 */
function applyNodes(tree: ImportNode[]) {
  // 并入已入库的子树，保证已有子项目一定出现在列表里、可被取消
  const merged = mergeExistingSubtree(tree, buildExistingSubtree(props.parentProject.id));
  nodes.value = merged;
  selected.value = buildDefaultSelection(merged, existingPaths.value);
}

async function runScan() {
  // 已达最大层级：不再扫描新候选，但仍要列出已入库的子项目——
  // 否则那些子项目在这个弹窗里永远看不到，也就永远删不掉。
  if (!canAddChildren.value) {
    applyNodes([]);
    return;
  }
  scanning.value = true;
  try {
    // 后端不知道该项目位于第几层，需由前端给出还能向下延伸的层级数
    const remainingDepth = MAX_PROJECT_DEPTH - parentDepth.value;
    const tree = await api.scanSubProjects(props.parentProject.path, remainingDepth);
    applyNodes(tree);
  } catch (e) {
    console.error('Failed to scan sub projects', e);
    ElMessage.error(t('common.error'));
    // 扫描失败也保留已入库的子树，至少让用户能做移除操作
    applyNodes([]);
  } finally {
    scanning.value = false;
  }
}

// 打开时加载候选树。immediate 覆盖"挂载时 modelValue 已为 true"的调用方，
// 那种情况下 watch 不会因变化而触发，候选树会一直是空的。
watch(visible, (v) => {
  if (!v) return;
  if (props.presetNodes && props.presetNodes.length > 0) {
    applyNodes(props.presetNodes);
    return;
  }
  runScan();
}, { immediate: true });

/** 候选树中的全部路径 */
const allPaths = computed(() => collectForestPaths(nodes.value));
const selectedCount = computed(() => selected.value.size);
const allSelected = computed(
  () => allPaths.value.length > 0 && allPaths.value.every((p) => selected.value.has(p)),
);

/** 本次会被移除的已导入项目路径（候选树内、被取消勾选的） */
const removingPaths = computed(() =>
  collectDeselectedExistingPaths(nodes.value, existingPaths.value, selected.value),
);

/** 本次会被新增的项目数（候选树内、被勾选且尚未导入的） */
const addingCount = computed(
  () => allPaths.value.filter((p) => selected.value.has(p) && !existingPaths.value.has(p)).length,
);

/** 是否存在实际的增删。用于决定按钮文案与是否需要真的干活 */
const hasChanges = computed(() => addingCount.value > 0 || removingPaths.value.length > 0);

function toggleSelectAll() {
  selected.value = allSelected.value ? new Set() : new Set(allPaths.value);
}

function onToggle(path: string, checked: boolean) {
  selected.value = toggleCandidateSelection(nodes.value, path, checked, selected.value);
}

async function confirmAdd() {
  // 无任何增删：当前层级已经是用户想要的样子，直接关闭并明确告知。
  // 绝不能在这里"什么都不做地卡住"——用户点确认就是想结束这次编辑，
  // 一个点不动的按钮会被理解成"这个应用不让我保存"。
  if (!hasChanges.value) {
    ElMessage.info(t('dashboard.subProjectNoChanges'));
    visible.value = false;
    return;
  }

  // 先处理移除：removeProject 会级联删除后代，可能牵连候选树之外的孙级，
  // 所以必须把真实影响数量摆到用户面前，而不是只报"移除 N 个"。
  const removingIds = removingPaths.value
    .map((path) => pathToProjectId.value.get(path))
    .filter((id): id is string => !!id);

  if (removingIds.length > 0) {
    const affected = new Set(removingIds);
    for (const id of removingIds) {
      for (const descendantId of projectStore.collectDescendantIds(id)) affected.add(descendantId);
    }

    try {
      await ElMessageBox.confirm(
        t('dashboard.removeSubProjectsConfirm', {
          count: removingIds.length,
          total: affected.size,
        }),
        t('common.warning'),
        { type: 'warning' },
      );
    } catch {
      return; // 用户放弃，本次什么都不做
    }

    for (const id of removingIds) projectStore.removeProject(id);
  }

  // 再处理新增：裁剪出勾选的子树后按层级挂载，孙级仍挂在其真实父节点下
  const tree = pruneSelectedTree(nodes.value, selected.value);
  const created = tree.length > 0 ? projectStore.addProjectTree(props.parentProject.id, tree) : [];

  if (created.length > 0 && removingIds.length > 0) {
    ElMessage.success(
      t('dashboard.subProjectsUpdated', { added: created.length, removed: removingIds.length }),
    );
  } else if (created.length > 0) {
    ElMessage.success(t('dashboard.subProjectAdded', { count: created.length }));
  } else if (removingIds.length > 0) {
    ElMessage.success(t('dashboard.subProjectRemoved', { count: removingIds.length }));
  }

  visible.value = false;
}

/** 暂不添加任何子项目。父项目本身不受影响，之后仍可在编辑页再次调整层级。 */
function skipAdd() {
  visible.value = false;
}

/** 关闭动画结束：清理状态避免下次打开时看到上次的残留，并通知调用方可以卸载了 */
function handleClosed() {
  nodes.value = [];
  selected.value = new Set();
  emit('closed');
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('dashboard.manageSubProjects')"
    width="600px"
    align-center
    class="app-centered-dialog"
    @closed="handleClosed"
  >
    <!-- 深度超限提示：不能再加，但下面仍会列出已有子项目供移除 -->
    <div
      v-if="!canAddChildren"
      class="flex items-start gap-2 mb-2 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20"
    >
      <div class="i-mdi-alert-circle-outline text-amber-500 shrink-0 mt-0.5" />
      <p class="app-text-control text-amber-700 dark:text-amber-400">{{ t('dashboard.maxDepthReached') }}</p>
    </div>

    <template v-if="canAddChildren || nodes.length > 0">
      <div class="mb-2">
        <div class="flex items-center justify-between gap-2">
          <span class="app-text-meta truncate font-mono text-slate-400">{{ parentProject.path }}</span>
          <el-button v-if="canAddChildren" size="small" :loading="scanning" @click="runScan">
            <div class="i-mdi-refresh mr-1" /> {{ t('import.rescan') }}
          </el-button>
        </div>
        <p class="app-text-meta mt-1 text-slate-500 dark:text-slate-400">
          {{ t('dashboard.subProjectManagementHint') }}
        </p>
      </div>

      <div v-if="nodes.length > 0" class="border rounded-lg overflow-hidden app-section-divider">
        <div class="flex items-center justify-between px-3 py-2 border-b bg-slate-50 dark:bg-slate-800/40">
          <el-checkbox
            :model-value="allSelected"
            :indeterminate="selectedCount > 0 && !allSelected"
            :disabled="allPaths.length === 0"
            @change="toggleSelectAll"
          >
            {{ t('import.selectAll') }}
          </el-checkbox>
          <span class="app-text-meta text-slate-400">{{ t('import.selectedCount', { count: selectedCount }) }}</span>
        </div>
        <div class="max-h-80 overflow-y-auto custom-scrollbar">
          <ScanCandidateTree
            :nodes="nodes"
            :existing-paths="existingPaths"
            :selected="selected"
            allow-remove-existing
            @toggle="onToggle"
          />
        </div>
        <!-- 层级说明 + 本次增删预览 -->
        <div class="px-3 py-2 border-t bg-slate-50 dark:bg-slate-800/40">
          <div class="app-text-meta text-slate-400">{{ t('dashboard.subProjectLevelHint') }}</div>
          <div v-if="removingPaths.length > 0" class="mt-1 app-text-meta text-red-500">
            {{ t('dashboard.subProjectRemoveHint', { count: removingPaths.length }) }}
          </div>
        </div>
      </div>

      <div v-else-if="!scanning" class="text-center py-8 text-slate-400">
        <div class="i-mdi-folder-search-outline text-4xl mb-2 opacity-30 mx-auto" />
        <p class="text-sm">{{ t('dashboard.noSubProjectsFound') }}</p>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="skipAdd">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" @click="confirmAdd">
          {{ hasChanges
            ? t('dashboard.applySubProjectChanges', { added: addingCount, removed: removingPaths.length })
            : t('common.confirm') }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-text-muted) 56%, transparent);
  border-radius: 2px;
}
</style>
