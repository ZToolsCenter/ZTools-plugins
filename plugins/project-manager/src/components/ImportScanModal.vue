<script setup lang="ts">
/** *********************两段式批量导入：多选目录 → 预扫描 → 勾选 → 导入*********************/
/** 支持两种模式：
 *  - 'children'：所选目录被当作扫描根，后端扫描其下的子项目作为候选（遇容器下沉到孙级）。
 *  - 'direct'：所选目录本身就是待导入项目，直接作为候选显示。
 */
import { ref, computed } from 'vue';
import { useProjectStore } from '../stores/project';
import { api } from '../api';
import type { ImportNode } from '../api/types';
import { useI18n } from 'vue-i18n';
import { ElMessage } from 'element-plus';
import ScanCandidateTree from './ScanCandidateTree.vue';
import { buildImportRootProject } from '../utils/importProjectTree';
import { MAX_PROJECT_DEPTH, normalizeProjectPath, projectFolderName } from '../utils/projectTree';
import {
  buildDefaultSelection,
  collectForestPaths,
  pruneSelectedTree,
  toggleCandidateSelection,
} from '../utils/scanCandidateTree';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const { t } = useI18n();
const projectStore = useProjectStore();

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

/** 导入模式：'children' 扫描所选目录的子项目；'direct' 直接将所选目录作为候选 */
type ImportMode = 'children' | 'direct';
const importMode = ref<ImportMode>('children');

/** *********************扫描状态*********************/
const scanning = ref(false);
const importing = ref(false);
/** 已选中的目录（children 模式下为扫描根，direct 模式下为候选项目本身） */
const rootPaths = ref<string[]>([]);
/** 扫描出的嵌套候选树（direct 模式下为无子节点的单层节点） */
const nodes = ref<ImportNode[]>([]);
/** 已勾选的归一化路径 */
const selected = ref<Set<string>>(new Set());

/** 已存在于项目库中的归一化路径 */
const existingPaths = computed(
  () => new Set(projectStore.projects.map((p) => normalizeProjectPath(p.path))),
);

/** 选择目录（支持多选）并触发扫描 */
async function pickAndScan() {
  try {
    const selectedDirs = await api.openDialog({ directory: true, multiple: true });
    if (selectedDirs == null) return;

    // multiple: true 时返回 string[]；旧逻辑下 multiple: false 返回 string。
    // 这里统一收集为数组。
    const paths: string[] = Array.isArray(selectedDirs)
      ? selectedDirs.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : typeof selectedDirs === 'string'
        ? [selectedDirs]
        : [];

    if (paths.length === 0) return;

    rootPaths.value = paths;
    await runScan();
  } catch (e) {
    console.error('Failed to pick directories for import scan', e);
    ElMessage.error(t('common.error'));
  }
}

/** 继续追加选择目录（保留已选并在其上叠加，去重） */
async function addFoldersAndScan() {
  try {
    const selectedDirs = await api.openDialog({ directory: true, multiple: true });
    if (selectedDirs == null) return;

    const paths: string[] = Array.isArray(selectedDirs)
      ? selectedDirs.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : typeof selectedDirs === 'string'
        ? [selectedDirs]
        : [];

    if (paths.length === 0) return;

    const existing = new Set(rootPaths.value.map(normalizeProjectPath));
    const merged = [...rootPaths.value];
    for (const p of paths) {
      if (!existing.has(normalizeProjectPath(p))) merged.push(p);
    }
    rootPaths.value = merged;
    await runScan();
  } catch (e) {
    console.error('Failed to add directories for import scan', e);
    ElMessage.error(t('common.error'));
  }
}

/** 移除一个已选目录，并重新扫描剩余目录 */
async function removeRootPath(p: string) {
  rootPaths.value = rootPaths.value.filter((x) => x !== p);
  if (rootPaths.value.length === 0) {
    nodes.value = [];
    selected.value = new Set();
    return;
  }
  await runScan();
}

/** 切换导入模式后，若已有已选目录则按新模式重新扫描一次。 */
async function onModeChange() {
  if (rootPaths.value.length > 0) {
    await runScan();
  }
}

/** 执行扫描：children 模式调用 scanImportTree 返回嵌套树，direct 模式将所选目录构造成单层候选 */
async function runScan() {
  if (rootPaths.value.length === 0) return;
  scanning.value = true;
  try {
    let merged: ImportNode[] = [];

    if (importMode.value === 'children') {
      // 并发扫描每个根目录，获取保留层级的嵌套树
      const lists = await Promise.all(
        rootPaths.value.map((p) =>
          api.scanImportTree(p).catch((e) => {
            console.error(`Failed to scan import tree at ${p}`, e);
            return [] as ImportNode[];
          }),
        ),
      );

      const seen = new Set<string>();
      for (const tree of lists) {
        for (const node of tree) {
          const key = normalizeProjectPath(node.path);
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(node);
        }
      }
    } else {
      // direct：所选目录本身即候选，不向内扫描。并发检查每个目录是否 Git 仓库。
      const gitChecks = await Promise.all(
        rootPaths.value.map((p) => api.gitCheck(p).catch(() => false)),
      );
      const seen = new Set<string>();
      rootPaths.value.forEach((p, i) => {
        const key = normalizeProjectPath(p);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push({
          name: projectFolderName(p),
          path: p,
          kind: 'unknown',
          hasGit: gitChecks[i] === true,
          hasPackageJson: false,
          scripts: [],
          children: [],
        });
      });
    }

    nodes.value = merged;
    // 默认全选，再去掉已导入的——批量导入不处理删除，已存在的项目无需勾选
    const defaults = buildDefaultSelection(merged);
    for (const existing of existingPaths.value) defaults.delete(existing);
    selected.value = defaults;
  } catch (e) {
    console.error('Failed to scan import tree', e);
    ElMessage.error(t('common.error'));
    nodes.value = [];
    selected.value = new Set();
  } finally {
    scanning.value = false;
  }
}

/** 全部可选（未导入）路径 */
const selectablePaths = computed(() =>
  collectForestPaths(nodes.value).filter((path) => !existingPaths.value.has(path)),
);
const selectedCount = computed(() => selected.value.size);
const allSelected = computed(
  () => selectablePaths.value.length > 0 && selectablePaths.value.every((p) => selected.value.has(p)),
);

function toggleSelectAll() {
  selected.value = allSelected.value ? new Set() : new Set(selectablePaths.value);
}

function onToggle(path: string, checked: boolean) {
  const next = toggleCandidateSelection(nodes.value, path, checked, selected.value);
  // 批量导入是纯新增语义：这里不做删除，故已导入的项目始终保持未勾选，
  // 免得它们混进 addProjectTree 的入参里（虽然会被跳过，但计数会失真）。
  for (const existing of existingPaths.value) next.delete(existing);
  selected.value = next;
}

/** *********************导入*********************/
async function doImport() {
  if (selected.value.size === 0) return;

  // 裁剪出勾选的子树；已存在的节点仍会保留为层级容器（入库时复用其既有 id）
  const tree = pruneSelectedTree(nodes.value, selected.value);
  if (tree.length === 0) return;

  importing.value = true;
  let added = 0;
  let failed = 0;

  try {
    if (importMode.value === 'children') {
      // children 模式：后端已返回嵌套树，按真实层级整棵挂载为一级项目及其子孙
      added = projectStore.addProjectTree(undefined, tree).length;
    } else {
      // direct 模式：所选目录作为一级项目，再单独扫描其下子模块按层级挂为子项目
      for (const node of tree) {
        try {
          const [info, subTree] = await Promise.all([
            api.scanProject(node.path).catch((error) => {
              console.error(`Failed to scan project metadata at ${node.path}`, error);
              return null;
            }),
            // 所选目录将成为一级项目，其子项目从第 2 层起算，故只剩 MAX-1 层可用
            api.scanSubProjects(node.path, MAX_PROJECT_DEPTH - 1).catch((error) => {
              console.error(`Failed to scan sub projects at ${node.path}`, error);
              return [] as ImportNode[];
            }),
          ]);

          const root = buildImportRootProject(
            { name: node.name, path: node.path, hasGit: node.hasGit, subModuleCount: 0 },
            info,
          );
          projectStore.addProject(root);
          if (subTree.length > 0) {
            projectStore.addProjectTree(root.id, subTree);
          }
          added++;
        } catch (e) {
          console.error(`Failed to import project at ${node.path}`, e);
          failed++;
        }
      }
    }
  } finally {
    importing.value = false;
  }

  if (added > 0) ElMessage.success(t('dashboard.batchAddSuccess', { count: added }));
  if (failed > 0 && added === 0) ElMessage.warning(t('dashboard.batchAddFail', { count: failed }));

  // 关闭并重置
  visible.value = false;
  resetState();
}

function resetState() {
  rootPaths.value = [];
  nodes.value = [];
  selected.value = new Set();
}

function handleClosed() {
  resetState();
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="t('import.title')"
    width="640px"
    align-center
    class="app-centered-dialog"
    @closed="handleClosed"
  >
    <div class="space-y-3">
      <!-- 模式切换 -->
      <div class="import-mode-row">
        <el-segmented
          v-model="importMode"
          :options="[
            { label: t('import.modeChildren'), value: 'children' },
            { label: t('import.modeDirect'), value: 'direct' },
          ]"
          @change="onModeChange"
        />
        <span class="app-text-meta text-slate-500 dark:text-slate-400 leading-tight max-w-[260px] truncate" :title="importMode === 'children' ? t('import.modeChildrenHint') : t('import.modeDirectHint')">
          {{ importMode === 'children' ? t('import.modeChildrenHint') : t('import.modeDirectHint') }}
        </span>
      </div>

      <!-- 目录选择 -->
      <div class="flex items-center gap-2">
        <el-button :loading="scanning" @click="pickAndScan">
          <div class="i-mdi-folder-open-outline mr-1" />
          {{ rootPaths.length > 0 ? t('import.replaceSelected') : t('import.pickDir') }}
        </el-button>
        <el-button v-if="rootPaths.length > 0" :loading="scanning" @click="addFoldersAndScan">
          <div class="i-mdi-folder-plus-outline mr-1" />
          {{ t('import.addMore') }}
        </el-button>
        <el-button v-if="rootPaths.length > 0" :loading="scanning" @click="runScan" :title="t('import.rescan')">
          <div class="i-mdi-refresh" />
        </el-button>
      </div>

      <!-- 已选目录（可移除） -->
      <div v-if="rootPaths.length > 0" class="flex flex-wrap gap-1.5">
        <el-tag
          v-for="p in rootPaths"
          :key="p"
          closable
          size="small"
          type="info"
          class="root-folder-tag"
          @close="removeRootPath(p)"
        >
          <div class="inline-flex items-center gap-1 max-w-full">
            <div class="i-mdi-folder text-xs" />
            <span class="font-medium truncate" :title="p">{{ projectFolderName(p) }}</span>
            <span class="font-mono app-text-meta text-slate-500 dark:text-slate-400 truncate" :title="p">— {{ p }}</span>
          </div>
        </el-tag>
      </div>

      <!-- 候选列表（按真实层级缩进） -->
      <div v-if="nodes.length > 0" class="border rounded-lg overflow-hidden app-section-divider">
        <div class="flex items-center justify-between px-3 py-2 border-b bg-slate-50 dark:bg-slate-800/40">
          <el-checkbox
            :model-value="allSelected"
            :indeterminate="selectedCount > 0 && !allSelected"
            :disabled="selectablePaths.length === 0"
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
            @toggle="onToggle"
          />
        </div>
      </div>

      <div v-else-if="rootPaths.length > 0 && !scanning" class="text-center py-8 text-slate-400">
        <div class="i-mdi-folder-search-outline text-4xl mb-2 opacity-30 mx-auto" />
        <p class="text-sm">{{ t('import.empty') }}</p>
      </div>

      <div v-else-if="rootPaths.length === 0 && !scanning" class="text-center py-8 text-slate-400">
        <div class="i-mdi-folder-search-outline text-4xl mb-2 opacity-30 mx-auto" />
        <p class="text-sm">{{ t('import.pickHint') }}</p>
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="visible = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="importing" :disabled="selectedCount === 0" @click="doImport">
          {{ t('import.importSelected', { count: selectedCount }) }}
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.import-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 6px;
  border-radius: var(--app-radius-xs);
  font-size: var(--app-font-caption);
  font-weight: 600;
}
.import-tag-muted {
  background: var(--app-surface-soft);
  border: 1px solid var(--app-border);
  color: var(--app-text-muted);
}
.import-tag-git {
  background: color-mix(in srgb, var(--app-warning) 12%, transparent);
  color: var(--app-warning);
}
.import-tag-module {
  background: color-mix(in srgb, var(--app-primary) 12%, transparent);
  color: var(--app-primary);
}
.import-mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.root-folder-tag {
  max-width: 100%;
}
.root-folder-tag :deep(.el-tag__close) {
  flex-shrink: 0;
}
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-text-muted) 56%, transparent);
  border-radius: 2px;
}
</style>
