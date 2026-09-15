<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useI18n } from 'vue-i18n';
import type { GitFileStatus, Project } from '../../types';
import { api } from '../../api';
import { useGitStore } from '../../stores/git';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { useWorkspaceEditorStore } from '../../stores/workspaceEditor';
import { useProjectExternalActions } from '../../composables/useProjectExternalActions';
import { fileKind } from '../../utils/fileTypes';
import { clampContextMenuPosition } from '../../utils/contextMenuPosition';
import {
  clampWorkspaceExplorerWidth,
  persistWorkspaceExplorerWidth,
  readWorkspaceExplorerWidth,
  WORKSPACE_EXPLORER_MAX_WIDTH,
  WORKSPACE_EXPLORER_MIN_WIDTH,
} from '../../utils/workspaceExplorerLayout';
import { joinAbsolutePath, joinWorkspacePath, normalizeWorkspaceRelativePath, parentWorkspacePath } from '../../utils/workspacePath';
import { cleanupRemovedExplorerProjects, setExplorerExpanded } from '../../utils/workspaceExplorerState';
import ProjectExplorerNode, { type ExplorerContextPayload, type ExplorerProjectAction } from './ProjectExplorerNode.vue';

const props = defineProps<{
  rootId: string;
  selectedProjectId: string | null;
}>();

const emit = defineEmits<{
  selectProject: [project: Project];
  editProject: [project: Project];
  scanProject: [project: Project];
}>();

const projectStore = useProjectStore();
const settingsStore = useSettingsStore();
const editorStore = useWorkspaceEditorStore();
const gitStore = useGitStore();
const { t } = useI18n();
const rootProject = computed(() => projectStore.projects.find(project => project.id === props.rootId) || null);
const workspaceRootKey = computed(() => rootProject.value?.path || props.rootId);
const showHidden = ref(false);
const showHeavy = ref(false);
const refreshToken = ref(0);
const selectedFileKey = ref<string | null>(null);
const contextMenuRef = ref<HTMLElement | null>(null);
const contextMenu = ref<{ x: number; y: number; payload: ExplorerContextPayload } | null>(null);
const contextMenuStyle = ref({ left: '0px', top: '0px' });
const actionProject = ref<Project | null>(null);
const explorerWidth = ref(readWorkspaceExplorerWidth(settingsStore.settings));
const resizingExplorer = ref(false);
const explorerResizeStartX = ref(0);
const explorerResizeStartWidth = ref(explorerWidth.value);
let previousBodyCursor = '';
let previousBodyUserSelect = '';
const { openEditor, openTerminal, openFolder } = useProjectExternalActions(() => actionProject.value);
const gitStatusMaps = computed<Record<string, ReadonlyMap<string, GitFileStatus>>>(() => {
  const maps: Record<string, ReadonlyMap<string, GitFileStatus>> = {};
  for (const project of projectStore.projects) {
    if (!gitStore.isGitRepo[project.id]) continue;
    const status = gitStore.getStatus(project.id);
    if (!status) continue;
    const map = new Map<string, GitFileStatus>();
    for (const file of [...status.staged, ...status.unstaged, ...status.untracked, ...status.conflicted]) {
      map.set(file.path.replace(/\\/g, '/'), file);
    }
    maps[project.id] = map;
  }
  return maps;
});

function projectById(id: string | null | undefined): Project | null {
  return id ? projectStore.projects.find(project => project.id === id) || null : null;
}

function isGitProject(project: Project): boolean {
  return gitStore.isGitRepo[project.id] === true;
}

function reportExplorerError(operation: string, error: unknown): void {
  console.error(`Explorer ${operation} failed`, error);
  ElMessage.error(`${t('common.error')}: ${String(error)}`);
}

function expandTargetAncestors(projectId: string | null): void {
  const root = rootProject.value;
  if (!root) return;
  setExplorerExpanded(workspaceRootKey.value, `project:${root.id}`, true);
  const seen = new Set<string>();
  let current = projectById(projectId);
  while (current && current.id !== root.id && !seen.has(current.id)) {
    seen.add(current.id);
    setExplorerExpanded(workspaceRootKey.value, `project:${current.id}`, true);
    current = projectById(current.parentId);
  }
}

function clampExplorerWidth(width: number): number {
  return clampWorkspaceExplorerWidth(width);
}

function persistExplorerWidth(): void {
  persistWorkspaceExplorerWidth(settingsStore.settings, explorerWidth.value);
}

function resizeExplorer(event: PointerEvent): void {
  if (!resizingExplorer.value) return;
  explorerWidth.value = clampExplorerWidth(explorerResizeStartWidth.value + event.clientX - explorerResizeStartX.value);
}

function finishExplorerResize(shouldPersist: boolean): void {
  if (!resizingExplorer.value) return;
  document.removeEventListener('pointermove', resizeExplorer, true);
  document.removeEventListener('pointerup', finishExplorerResizeOnPointerUp, true);
  document.removeEventListener('pointercancel', finishExplorerResizeOnPointerCancel, true);
  if (!shouldPersist) explorerWidth.value = explorerResizeStartWidth.value;
  if (shouldPersist) persistExplorerWidth();
  document.body.style.cursor = previousBodyCursor;
  document.body.style.userSelect = previousBodyUserSelect;
  resizingExplorer.value = false;
}

function finishExplorerResizeOnPointerUp(): void {
  finishExplorerResize(true);
}

function finishExplorerResizeOnPointerCancel(): void {
  finishExplorerResize(false);
}

function startExplorerResize(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  explorerResizeStartX.value = event.clientX;
  explorerResizeStartWidth.value = explorerWidth.value;
  previousBodyCursor = document.body.style.cursor;
  previousBodyUserSelect = document.body.style.userSelect;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  resizingExplorer.value = true;
  document.addEventListener('pointermove', resizeExplorer, true);
  document.addEventListener('pointerup', finishExplorerResizeOnPointerUp, true);
  document.addEventListener('pointercancel', finishExplorerResizeOnPointerCancel, true);
}

function handleExplorerResizeKeydown(event: KeyboardEvent): void {
  const step = event.shiftKey ? 40 : 16;
  let nextWidth: number | null = null;
  if (event.key === 'ArrowLeft') {
    nextWidth = explorerWidth.value - step;
  } else if (event.key === 'ArrowRight') {
    nextWidth = explorerWidth.value + step;
  } else if (event.key === 'Home') {
    nextWidth = WORKSPACE_EXPLORER_MIN_WIDTH;
  } else if (event.key === 'End') {
    nextWidth = WORKSPACE_EXPLORER_MAX_WIDTH;
  }
  if (nextWidth !== null) {
    explorerWidth.value = clampExplorerWidth(nextWidth);
    persistExplorerWidth();
    event.preventDefault();
  }
}

watch(() => settingsStore.settings.workspaceExplorerWidth, value => {
  if (!resizingExplorer.value) explorerWidth.value = readWorkspaceExplorerWidth({ workspaceExplorerWidth: value });
});

watch(() => props.selectedProjectId, value => expandTargetAncestors(value), { immediate: true });
watch(() => props.rootId, () => {
  selectedFileKey.value = null;
  contextMenu.value = null;
  refreshToken.value += 1;
  expandTargetAncestors(props.selectedProjectId);
});
watch(
  () => projectStore.projects.map(project => project.id).join('|'),
  () => cleanupRemovedExplorerProjects(workspaceRootKey.value, new Set(projectStore.projects.map(project => project.id))),
  { immediate: true },
);

function selectProject(project: Project): void {
  selectedFileKey.value = null;
  emit('selectProject', project);
}

function selectFile(project: Project, relativePath: string): void {
  selectedFileKey.value = `${project.id}:${relativePath}`;
}

async function openFile(project: Project, relativePath: string): Promise<void> {
  selectProject(project);
  selectFile(project, relativePath);
  try {
    if (fileKind(relativePath) === 'binary') {
      await api.openPath(joinAbsolutePath(project.path, relativePath));
      return;
    }
    const opening = editorStore.openFile(project, relativePath);
    projectStore.requestRightTab('editor', project.id);
    await opening;
  } catch (error) {
    reportExplorerError('open file', error);
  }
}

function updateContextMenuPosition(): void {
  if (!contextMenu.value || !contextMenuRef.value) return;
  const position = clampContextMenuPosition(
    contextMenu.value.x,
    contextMenu.value.y,
    contextMenuRef.value.offsetWidth || 230,
    contextMenuRef.value.offsetHeight || 360,
    { width: window.innerWidth, height: window.innerHeight },
  );
  contextMenuStyle.value = { left: `${position.left}px`, top: `${position.top}px` };
}

function showContextMenu(event: MouseEvent, payload: ExplorerContextPayload): void {
  contextMenu.value = { x: event.clientX, y: event.clientY, payload };
  void nextTick(updateContextMenuPosition);
}

function closeContextMenu(): void {
  contextMenu.value = null;
}

function closeOnViewportChange(): void {
  closeContextMenu();
}

function menuTargetDirectory(payload: ExplorerContextPayload): string {
  return payload.isDirectory ? payload.relativePath : parentWorkspacePath(payload.relativePath);
}

function promptValue(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && 'value' in raw) return String((raw as { value: unknown }).value).trim();
  return '';
}

async function promptName(title: string, value = ''): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt('请输入名称', title, {
      inputValue: value,
      inputPattern: /.+/,
      inputErrorMessage: '名称不能为空',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    });
    const next = promptValue(result);
    return next || null;
  } catch {
    return null;
  }
}

async function createItem(kind: 'file' | 'directory'): Promise<void> {
  const menu = contextMenu.value;
  if (!menu) return;
  const { payload } = menu;
  closeContextMenu();
  const name = await promptName(kind === 'file' ? '新建文件' : '新建文件夹');
  if (!name) return;
  try {
    const relativePath = joinWorkspacePath(menuTargetDirectory(payload), name);
    if (kind === 'file') await api.workspaceCreateFile(payload.project.path, relativePath);
    else await api.workspaceCreateDirectory(payload.project.path, relativePath);
    refreshToken.value += 1;
    ElMessage.success(t('common.created'));
  } catch (error) {
    reportExplorerError(kind === 'file' ? 'create file' : 'create folder', error);
  }
}

async function renameItem(): Promise<void> {
  const menu = contextMenu.value;
  if (!menu) return;
  const { payload } = menu;
  closeContextMenu();
  const name = await promptName('重命名', payload.name);
  if (!name) return;
  try {
    const from = normalizeWorkspaceRelativePath(payload.relativePath, false);
    const to = joinWorkspacePath(parentWorkspacePath(from), name);
    await api.workspaceRename(payload.project.path, from, to);
    await editorStore.renamePath(payload.project.id, from, to, payload.project.path);
    refreshToken.value += 1;
    ElMessage.success(t('common.renamed'));
  } catch (error) {
    reportExplorerError('rename item', error);
  }
}

async function trashItem(): Promise<void> {
  const menu = contextMenu.value;
  if (!menu) return;
  const { payload } = menu;
  closeContextMenu();
  let permanent = false;
  try {
    permanent = (await api.workspaceTrashMode()) === 'permanent';
  } catch (error) {
    reportExplorerError('read delete mode', error);
    return;
  }
  try {
    await ElMessageBox.confirm(
      permanent ? `「${payload.name}」将被永久删除，确定继续吗？` : `确定将「${payload.name}」移到回收站吗？`,
      permanent ? '永久删除' : '移到回收站',
      { type: 'warning', confirmButtonText: permanent ? '永久删除' : '确定', cancelButtonText: '取消' },
    );
  } catch {
    return;
  }
  try {
    await api.workspaceTrash(payload.project.path, payload.relativePath);
    editorStore.markMissing(payload.project.id, payload.relativePath);
    refreshToken.value += 1;
    ElMessage.success(t('common.deleted'));
  } catch (error) {
    reportExplorerError('delete item', error);
  }
}

async function copyPath(full: boolean): Promise<void> {
  const payload = contextMenu.value?.payload;
  if (!payload) return;
  const path = full ? joinAbsolutePath(payload.project.path, payload.relativePath) : payload.relativePath;
  closeContextMenu();
  try {
    await navigator.clipboard.writeText(path);
    ElMessage.success(t('dashboard.pathCopied'));
  } catch (error) {
    reportExplorerError('copy path', error);
  }
}

async function revealItem(): Promise<void> {
  const payload = contextMenu.value?.payload;
  if (!payload) return;
  closeContextMenu();
  try {
    await api.revealInFolder(joinAbsolutePath(payload.project.path, payload.relativePath));
  } catch (error) {
    reportExplorerError('reveal item', error);
  }
}

async function externalOpen(): Promise<void> {
  const payload = contextMenu.value?.payload;
  if (!payload) return;
  closeContextMenu();
  const target = joinAbsolutePath(payload.project.path, payload.relativePath);
  try {
    if (payload.isDirectory) await api.openFolder(target);
    else await api.openPath(target);
  } catch (error) {
    reportExplorerError('open external item', error);
  }
}

async function editorOpen(): Promise<void> {
  const payload = contextMenu.value?.payload;
  if (!payload) return;
  closeContextMenu();
  await openFile(payload.project, payload.relativePath);
}

async function handleProjectAction(project: Project, action: ExplorerProjectAction): Promise<void> {
  actionProject.value = project;
  if (action === 'git') {
    selectProject(project);
    projectStore.requestRightTab('git', project.id);
    return;
  }
  if (action === 'pin') {
    if (project.pinned) projectStore.unpinProject(project.id);
    else projectStore.pinProject(project.id);
    return;
  }
  if (action === 'delete') {
    const hasChildren = projectStore.getChildren(project.id).length > 0;
    const projectIds = [project.id, ...projectStore.collectDescendantIds(project.id)];
    const dirtyWarning = editorStore.hasDirtyDocuments(projectIds)
      ? '\n\n该项目有未保存的编辑器内容，删除后这些文档会关闭。'
      : '';
    try {
      await ElMessageBox.confirm(
        `${hasChildren ? `项目「${project.name}」及其子项目将被删除。` : `确定删除项目「${project.name}」吗？`}${dirtyWarning}`,
        '删除项目',
        { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
      );
      projectStore.removeProject(project.id);
      ElMessage.success('项目已删除');
    } catch {
      // 用户取消确认时不打断 Explorer。
    }
    return;
  }
  if (action === 'edit') {
    emit('editProject', project);
    return;
  }
  if (action === 'scan') {
    emit('scanProject', project);
    return;
  }
  if (action === 'terminal') {
    await openTerminal();
    return;
  }
  if (action === 'editor') {
    await openEditor();
    return;
  }
  await openFolder();
}

async function handleContextProjectAction(action: ExplorerProjectAction): Promise<void> {
  const project = contextMenu.value?.payload.project;
  if (!project) return;
  closeContextMenu();
  await handleProjectAction(project, action);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && contextMenu.value) {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu();
  }
}

function closeOnDocumentMouseDown(event: MouseEvent): void {
  const target = event.target;
  if (target instanceof Node && contextMenuRef.value?.contains(target)) return;
  closeContextMenu();
}

onMounted(() => {
  document.addEventListener('mousedown', closeOnDocumentMouseDown, true);
  document.addEventListener('click', closeContextMenu);
  document.addEventListener('wheel', closeOnViewportChange, true);
  document.addEventListener('scroll', closeOnViewportChange, true);
  document.addEventListener('keydown', handleKeydown, true);
  window.addEventListener('resize', closeOnViewportChange);
});

onUnmounted(() => {
  finishExplorerResize(false);
  document.removeEventListener('mousedown', closeOnDocumentMouseDown, true);
  document.removeEventListener('click', closeContextMenu);
  document.removeEventListener('wheel', closeOnViewportChange, true);
  document.removeEventListener('scroll', closeOnViewportChange, true);
  document.removeEventListener('keydown', handleKeydown, true);
  window.removeEventListener('resize', closeOnViewportChange);
});
</script>

<template>
  <aside
    class="workspace-project-explorer relative flex h-full min-h-0 shrink-0 flex-col border-r"
    :style="{ width: `${explorerWidth}px` }"
  >
    <div class="explorer-header flex shrink-0 items-center gap-2 border-b px-3 py-2">
      <span class="explorer-title">PROJECT EXPLORER</span>
      <button type="button" class="explorer-header-btn" title="显示选项" @click="showHidden = !showHidden">
        <div class="i-mdi-eye-outline" />
      </button>
      <button type="button" class="explorer-header-btn" :class="{ active: showHeavy }" title="显示依赖/构建目录" @click="showHeavy = !showHeavy">
        <div class="i-mdi-package-variant-closed" />
      </button>
    </div>
    <div v-if="!rootProject" class="app-text-body flex min-h-0 flex-1 items-center justify-center text-slate-400">项目不存在</div>
    <div v-else class="explorer-tree min-h-0 flex-1 overflow-y-auto py-1 custom-scrollbar">
      <ProjectExplorerNode
        :key="`${rootProject.id}:${refreshToken}`"
        :project="rootProject"
        :workspace-root-id="workspaceRootKey"
        :depth="0"
        :selected-project-id="selectedProjectId"
        :selected-file-key="selectedFileKey"
        :show-hidden="showHidden"
        :show-heavy="showHeavy"
        :git-status-maps="gitStatusMaps"
        @select-project="selectProject"
        @edit-project="emit('editProject', $event)"
        @scan-project="emit('scanProject', $event)"
        @select-file="selectFile"
        @open-file="openFile"
        @project-action="handleProjectAction"
        @context-menu="showContextMenu"
      />
    </div>
    <div
      class="explorer-resize-handle"
      :class="{ 'is-resizing': resizingExplorer }"
      role="separator"
      aria-label="调整项目浏览器宽度"
      aria-orientation="vertical"
      :aria-valuenow="explorerWidth"
      :aria-valuemin="WORKSPACE_EXPLORER_MIN_WIDTH"
      :aria-valuemax="WORKSPACE_EXPLORER_MAX_WIDTH"
      tabindex="0"
      @pointerdown="startExplorerResize"
      @keydown="handleExplorerResizeKeydown"
    />
  </aside>

  <Teleport to="body">
    <div
      v-if="contextMenu"
      ref="contextMenuRef"
      class="workspace-context-menu fixed py-1"
      :style="contextMenuStyle"
      @mousedown.stop
      @click.stop
    >
      <template v-if="contextMenu.payload.kind === 'project'">
        <button v-if="isGitProject(contextMenu.payload.project)" type="button" class="context-item" @click="handleContextProjectAction('git')">
          <div class="i-mdi-source-branch" />
          <span>Git</span>
        </button>
        <button type="button" class="context-item" @click="handleContextProjectAction('terminal')">
          <div class="i-mdi-console-line" />
          <span>{{ t('dashboard.openInTerminal') }}</span>
        </button>
        <button type="button" class="context-item" @click="handleContextProjectAction('editor')">
          <div class="i-mdi-code-tags" />
          <span>{{ t('dashboard.openInEditor') }}</span>
        </button>
        <button type="button" class="context-item" @click="handleContextProjectAction('folder')">
          <div class="i-mdi-folder-open-outline" />
          <span>{{ t('dashboard.openFolder') }}</span>
        </button>
        <div class="context-separator" />
        <button type="button" class="context-item" @click="createItem('file')">
          <div class="i-mdi-file-plus-outline" />
          <span>{{ t('dashboard.newFile') }}</span>
        </button>
        <button type="button" class="context-item" @click="createItem('directory')">
          <div class="i-mdi-folder-plus-outline" />
          <span>{{ t('dashboard.newFolder') }}</span>
        </button>
        <div class="context-separator" />
        <button type="button" class="context-item" @click="handleContextProjectAction('edit')">
          <div class="i-mdi-pencil-outline" />
          <span>{{ t('dashboard.editProject') }}</span>
        </button>
        <button type="button" class="context-item" @click="handleContextProjectAction('scan')">
          <div class="i-mdi-file-tree-outline" />
          <span>{{ t('dashboard.manageSubProjects') }}</span>
        </button>
        <button type="button" class="context-item" @click="handleContextProjectAction('pin')">
          <div :class="contextMenu.payload.project.pinned ? 'i-mdi-pin-off-outline' : 'i-mdi-pin-outline'" />
          <span>{{ contextMenu.payload.project.pinned ? t('dashboard.unpinProject') : t('dashboard.pinProject') }}</span>
        </button>
        <button type="button" class="context-item danger" @click="handleContextProjectAction('delete')">
          <div class="i-mdi-delete-outline" />
          <span>{{ t('dashboard.deleteProject') }}</span>
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="context-item"
          :title="t('dashboard.open')"
          @click="contextMenu.payload.isDirectory || fileKind(contextMenu.payload.relativePath) === 'binary' ? externalOpen() : editorOpen()"
        >
          <div :class="contextMenu.payload.isDirectory ? 'i-mdi-folder-open-outline' : 'i-mdi-file-open-outline'" />
          <span>{{ t('dashboard.open') }}</span>
        </button>
        <button
          v-if="!contextMenu.payload.isDirectory && fileKind(contextMenu.payload.relativePath) !== 'binary'"
          type="button"
          class="context-item"
          :title="t('dashboard.openInLightweightEditor')"
          @click="editorOpen"
        >
          <div class="i-mdi-file-edit-outline" />
          <span>{{ t('dashboard.openInLightweightEditor') }}</span>
        </button>
        <div class="context-separator" />
        <button type="button" class="context-item" @click="createItem('file')">
          <div class="i-mdi-file-plus-outline" />
          <span>{{ t('dashboard.newFile') }}</span>
        </button>
        <button type="button" class="context-item" @click="createItem('directory')">
          <div class="i-mdi-folder-plus-outline" />
          <span>{{ t('dashboard.newFolder') }}</span>
        </button>
        <div class="context-separator" />
        <button type="button" class="context-item" @click="renameItem">
          <div class="i-mdi-rename-box-outline" />
          <span>{{ t('common.rename') }}</span>
        </button>
        <button type="button" class="context-item danger" @click="trashItem">
          <div class="i-mdi-delete-outline" />
          <span>{{ t('common.delete') }}</span>
        </button>
        <div class="context-separator" />
        <button type="button" class="context-item" @click="copyPath(false)">
          <div class="i-mdi-content-copy" />
          <span>{{ t('dashboard.copyRelativePath') }}</span>
        </button>
        <button type="button" class="context-item" @click="copyPath(true)">
          <div class="i-mdi-content-copy" />
          <span>{{ t('dashboard.copyAbsolutePath') }}</span>
        </button>
        <button type="button" class="context-item" :title="t('dashboard.revealInFolder')" @click="revealItem">
          <div class="i-mdi-folder-search-outline" />
          <span>{{ t('dashboard.revealInFolder') }}</span>
        </button>
        <button type="button" class="context-item" :title="t('dashboard.openWithDefaultApp')" @click="externalOpen">
          <div class="i-mdi-open-in-new" />
          <span>{{ t('dashboard.openWithDefaultApp') }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.workspace-project-explorer {
  container-type: inline-size;
  background: color-mix(in srgb, var(--app-surface-sidebar) 78%, transparent);
  backdrop-filter: blur(14px) saturate(115%);
  -webkit-backdrop-filter: blur(14px) saturate(115%);
  color: var(--app-text-secondary);
  user-select: none;
  -webkit-user-select: none;
}
.explorer-resize-handle {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  z-index: 2;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}
.explorer-resize-handle::after {
  position: absolute;
  top: 0;
  right: 3px;
  bottom: 0;
  width: 2px;
  background: transparent;
  content: '';
  transition: background-color 120ms ease;
}
.explorer-resize-handle:hover::after,
.explorer-resize-handle.is-resizing::after,
.explorer-resize-handle:focus-visible::after {
  background: var(--app-primary);
}
.explorer-resize-handle:focus-visible {
  outline: none;
}
.explorer-header {
  min-height: 38px;
  background: color-mix(in srgb, var(--app-surface-soft) 86%, transparent);
  backdrop-filter: blur(14px) saturate(115%);
  -webkit-backdrop-filter: blur(14px) saturate(115%);
}
.explorer-title {
  flex: 1 1 auto;
  color: var(--app-text-muted);
  font-size: var(--app-font-caption);
  font-weight: 800;
  letter-spacing: 0.08em;
}
.explorer-header-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--app-text-muted);
}
.explorer-header-btn:hover,
.explorer-header-btn.active {
  background: var(--app-primary-soft);
  color: var(--app-primary);
}
.custom-scrollbar::-webkit-scrollbar {
  width: 5px;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--app-text-muted) 50%, transparent);
  border-radius: 3px;
}
.workspace-context-menu {
  z-index: 5000;
  width: max-content;
  min-width: 230px;
  max-width: min(320px, calc(100vw - 16px));
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: 6px;
  background: var(--app-surface-raised, var(--app-surface));
  box-shadow: var(--app-shadow-md, 0 8px 24px rgba(0, 0, 0, 0.2));
  color: var(--app-text-secondary);
}
.context-item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 29px;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  font-size: var(--app-font-control);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.context-item > div {
  flex: 0 0 auto;
}
.context-item > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context-item:hover {
  background: var(--app-primary-soft);
  color: var(--app-primary);
}
.context-item.danger:hover {
  color: var(--app-danger);
}
.context-separator {
  height: 1px;
  margin: 4px 0;
  background: var(--app-border);
}
</style>
