<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { GitFileStatus, Project } from '../../types';
import { api } from '../../api';
import { useProjectStore } from '../../stores/project';
import { fileExtension, isImageFile, isTextFile } from '../../utils/fileTypes';
import { joinAbsolutePath, joinWorkspacePath, pathsEqual } from '../../utils/workspacePath';
import { explorerStateVersion, isExplorerExpanded, setExplorerExpanded } from '../../utils/workspaceExplorerState';
import ProjectExplorerNode from './ProjectExplorerNode.vue';
import type { ExplorerContextPayload, ExplorerProjectAction } from './ProjectExplorerNode.vue';

const HIDDEN_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor', '.next', '.nuxt',
  '.cache', '.gradle', '.idea', '__pycache__',
]);
const COMMON_CONFIG = /^(\.env(?:\..*)?|\.gitignore|\.editorconfig|\.npmrc|\.nvmrc|\.prettierrc|\.eslintrc|\.gitattributes|\.gitmodules|\.dockerignore|\.prettierignore|\.eslintignore|\.stylelintignore)$/i;

const props = defineProps<{
  project: Project;
  workspaceRootId: string;
  entry: { name: string; isDirectory: boolean; size?: number };
  relativePath: string;
  depth: number;
  showHidden: boolean;
  showHeavy: boolean;
  selectedProjectId: string | null;
  selectedFileKey?: string | null;
  gitStatusMap?: ReadonlyMap<string, GitFileStatus> | null;
  gitStatusMaps: Readonly<Record<string, ReadonlyMap<string, GitFileStatus>>>;
}>();

const emit = defineEmits<{
  selectFile: [project: Project, relativePath: string];
  openFile: [project: Project, relativePath: string];
  projectAction: [project: Project, action: ExplorerProjectAction];
  contextMenu: [event: MouseEvent, payload: ExplorerContextPayload];
  selectProject: [project: Project];
  editProject: [project: Project];
  scanProject: [project: Project];
}>();

const projectStore = useProjectStore();
const children = ref<{ name: string; isDirectory: boolean; size?: number }[]>([]);
const loading = ref(false);
const loaded = ref(false);
const fullPath = computed(() => props.relativePath);
const selected = computed(() => props.selectedFileKey === `${props.project.id}:${props.relativePath}`);
const nodeKey = computed(() => `dir:${props.project.id}:${props.relativePath}`);
const expanded = computed(() => {
  void explorerStateVersion.value;
  return isExplorerExpanded(props.workspaceRootId, nodeKey.value);
});
const registeredProject = computed(() => {
  const target = joinAbsolutePath(props.project.path, props.relativePath);
  return projectStore.projects.find(project => {
    return project.parentId === props.project.id && pathsEqual(project.path, target);
  }) || null;
});
const visibleChildren = computed(() => children.value.filter(entry => {
  if (entry.name === '.git') return false;
  if (!props.showHeavy && entry.isDirectory && HIDDEN_DIRS.has(entry.name.toLowerCase())) return false;
  if (!props.showHidden && entry.name.startsWith('.') && !COMMON_CONFIG.test(entry.name)) return false;
  return true;
}));
const status = computed(() => {
  const path = props.relativePath.replace(/\\/g, '/');
  return props.gitStatusMap?.get(path);
});

function iconClass(): string {
  if (props.entry.isDirectory) return 'i-mdi-folder-outline text-amber-500';
  if (isImageFile(props.entry.name)) return 'i-mdi-file-image-outline text-pink-500';
  if (/^\.env(?:\..*)?$/i.test(props.entry.name)) return 'i-mdi-key-variant text-amber-500';
  switch (fileExtension(props.entry.name)) {
    case 'vue': return 'i-mdi-vuejs text-green-500';
    case 'ts':
    case 'tsx': return 'i-mdi-language-typescript text-blue-500';
    case 'js':
    case 'jsx': return 'i-mdi-language-javascript text-yellow-500';
    case 'json': return 'i-mdi-code-json text-yellow-600';
    case 'md': return 'i-mdi-language-markdown text-slate-500';
    case 'html': return 'i-mdi-language-html5 text-orange-500';
    case 'css': return 'i-mdi-language-css3 text-blue-400';
    default: return isTextFile(props.entry.name) ? 'i-mdi-file-document-outline text-slate-400' : 'i-mdi-file-outline text-slate-400';
  }
}

async function loadChildren(): Promise<void> {
  if (!props.entry.isDirectory || loaded.value || loading.value) return;
  loading.value = true;
  try {
    children.value = await api.workspaceReadDir(props.project.path, fullPath.value);
    loaded.value = true;
  } catch (error) {
    console.error('Failed to load Explorer directory', error);
    ElMessage.error(String(error));
  } finally {
    loading.value = false;
  }
}

async function toggle(): Promise<void> {
  if (!props.entry.isDirectory) return;
  const next = !expanded.value;
  setExplorerExpanded(props.workspaceRootId, nodeKey.value, next);
  if (next) await loadChildren();
}

function select(): void {
  if (!props.entry.isDirectory) emit('selectFile', props.project, props.relativePath);
}

function open(event?: MouseEvent): void {
  event?.preventDefault();
  event?.stopPropagation();
  if (props.entry.isDirectory) void toggle();
  else emit('openFile', props.project, props.relativePath);
}

function projectAtPath(): Project | null {
  return registeredProject.value;
}

function forwardSelectFile(project: Project, relativePath: string): void {
  emit('selectFile', project, relativePath);
}

function forwardOpenFile(project: Project, relativePath: string): void {
  emit('openFile', project, relativePath);
}

function forwardProjectAction(project: Project, action: ExplorerProjectAction): void {
  emit('projectAction', project, action);
}

function forwardContextMenu(event: MouseEvent, payload: ExplorerContextPayload): void {
  emit('contextMenu', event, payload);
}

onMounted(() => {
  if (expanded.value) void loadChildren();
});
</script>

<template>
  <ProjectExplorerNode
    v-if="entry.isDirectory && projectAtPath()"
    :project="projectAtPath()!"
    :workspace-root-id="workspaceRootId"
    :depth="depth"
    :selected-project-id="selectedProjectId"
    :selected-file-key="selectedFileKey"
    :show-hidden="showHidden"
    :show-heavy="showHeavy"
    :git-status-maps="gitStatusMaps"
    @select-project="emit('selectProject', $event)"
    @edit-project="emit('editProject', $event)"
    @scan-project="emit('scanProject', $event)"
    @select-file="forwardSelectFile"
    @open-file="forwardOpenFile"
    @project-action="forwardProjectAction"
    @context-menu="forwardContextMenu"
  />
  <div v-else class="explorer-file-group">
    <div
      class="explorer-row explorer-file-row"
      :class="{ 'is-selected': selected, 'is-directory': entry.isDirectory }"
      @click="select"
      @dblclick="open"
      @contextmenu.prevent="emit('contextMenu', $event, { kind: 'file', project, relativePath, name: entry.name, isDirectory: entry.isDirectory })"
    >
      <button
        v-if="entry.isDirectory"
        type="button"
        class="explorer-chevron"
        :title="expanded ? '收起' : '展开'"
        :aria-label="expanded ? '收起' : '展开'"
        :aria-expanded="expanded"
        @click.stop="toggle"
      >
        <div :class="expanded ? 'i-mdi-chevron-down' : 'i-mdi-chevron-right'" />
      </button>
      <span v-else class="explorer-chevron-spacer" />
      <div :class="iconClass()" class="explorer-file-icon" />
      <span class="explorer-file-name truncate">{{ entry.name }}</span>
      <span v-if="status" class="explorer-git-status" :class="`status-${status.status}`">{{ status.status === 'modified' ? 'M' : status.status === 'added' ? 'A' : status.status === 'deleted' ? 'D' : status.status === 'untracked' ? 'U' : status.status === 'conflicted' ? 'C' : status.status === 'copied' ? 'C' : 'R' }}</span>
    </div>
    <div v-if="entry.isDirectory && expanded" class="explorer-children">
      <div v-if="loading" class="explorer-loading">加载中…</div>
      <FileTreeNode
        v-for="child in visibleChildren"
        :key="`${project.id}:${joinWorkspacePath(relativePath, child.name)}`"
        :project="project"
        :workspace-root-id="workspaceRootId"
        :entry="child"
        :relative-path="joinWorkspacePath(relativePath, child.name)"
        :depth="depth + 1"
        :show-hidden="showHidden"
        :show-heavy="showHeavy"
        :selected-project-id="selectedProjectId"
        :selected-file-key="selectedFileKey"
        :git-status-map="gitStatusMap"
        :git-status-maps="gitStatusMaps"
        @select-file="forwardSelectFile"
        @open-file="forwardOpenFile"
        @project-action="forwardProjectAction"
        @context-menu="forwardContextMenu"
        @select-project="emit('selectProject', $event)"
        @edit-project="emit('editProject', $event)"
        @scan-project="emit('scanProject', $event)"
      />
    </div>
  </div>
</template>

<style scoped>
.explorer-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: var(--app-control-height-sm);
  padding-left: 4px;
  padding-right: 8px;
  color: var(--app-text-secondary);
  font-size: var(--app-font-control);
  cursor: default;
  user-select: none;
  -webkit-user-select: none;
}
.explorer-row:hover {
  background: var(--app-primary-soft);
  color: var(--app-text);
}
.explorer-file-row.is-selected {
  background: color-mix(in srgb, var(--app-primary) 9%, var(--app-surface));
  color: var(--app-primary);
}
.explorer-chevron,
.explorer-chevron-spacer {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 24px;
  flex: 0 0 22px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--app-text-muted);
  font-size: 16px;
  line-height: 1;
}
.explorer-chevron:hover {
  background: color-mix(in srgb, var(--app-primary) 10%, transparent);
  color: var(--app-primary);
}
.explorer-chevron:focus-visible {
  outline: 2px solid var(--app-primary);
  outline-offset: -1px;
}
.explorer-file-icon {
  flex: 0 0 16px;
  font-size: 14px;
}
.explorer-file-name {
  min-width: 0;
  font-size: 12px;
  font-size: var(--app-font-control);
  line-height: var(--app-line-height-control);
  user-select: none;
  -webkit-user-select: none;
}
.explorer-git-status {
  margin-left: auto;
  flex: 0 0 12px;
  font-size: var(--app-font-meta);
  font-weight: 700;
  text-align: center;
}
.status-modified { color: var(--app-warning); }
.status-added,
.status-untracked { color: var(--app-success); }
.status-deleted,
.status-conflicted { color: var(--app-danger); }
.status-renamed,
.status-copied { color: var(--app-primary); }
.explorer-loading {
  min-height: var(--app-control-height-sm);
  color: var(--app-text-muted);
  font-size: var(--app-font-meta);
}
.explorer-children {
  margin-left: 14px;
  padding-left: 0;
  border-left: 1px solid color-mix(in srgb, var(--app-text-muted) 26%, transparent);
}
</style>
