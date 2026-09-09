<script setup lang="ts">
import { ref } from 'vue'
import InlineCreate from './InlineCreate.vue'
import { beginWorkspaceDrag, endWorkspaceDrag, getWorkspaceDragPath } from '../workspaceDrag'

defineProps<{
  entries: WorkspaceTreeEntry[]
  activePath: string | null
  selectedPath: string
  createParentPath: string
  createKind: 'note' | 'directory' | null
  createName: string
  createError: string
  renamePath: string | null
  renameName: string
  renameError: string
  openMenuPath: string | null
  pinnedPaths: string[]
  hiddenGlobalPaths: string[]
  globalNoteSearchEnabled: boolean
}>()

const dropTarget = ref<{ path: string; allowed: boolean } | null>(null)

function canDropInto(sourcePath: string, targetPath: string) {
  const parentPath = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
  return Boolean(sourcePath) && parentPath !== targetPath && sourcePath !== targetPath && !targetPath.startsWith(`${sourcePath}/`)
}

const emit = defineEmits<{
  openNote: [relativePath: string]
  selectEntry: [entry: WorkspaceTreeEntry]
  requestCreate: [kind: 'note' | 'directory', parentPath: string]
  requestRename: [entry: WorkspaceTreeEntry]
  requestDelete: [entry: WorkspaceTreeEntry]
  togglePin: [entry: Extract<WorkspaceTreeEntry, { kind: 'note' }>]
  toggleGlobalSearch: [entry: Extract<WorkspaceTreeEntry, { kind: 'note' }>]
  'update:createName': [name: string]
  submitCreate: []
  cancelCreate: []
  'update:renameName': [name: string]
  submitRename: []
  cancelRename: []
  toggleMenu: [relativePath: string | null]
  requestMove: [sourcePath: string, targetDirectoryPath: string]
  showInFolder: [entry: WorkspaceTreeEntry]
}>()

function startDrag(event: DragEvent, path: string) {
  beginWorkspaceDrag(path)
  event.dataTransfer?.setData('application/x-znotes-entry', path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function dropInto(event: DragEvent, targetDirectoryPath: string) {
  const sourcePath = getWorkspaceDragPath()
  const allowed = sourcePath ? canDropInto(sourcePath, targetDirectoryPath) : false
  dropTarget.value = null
  if (sourcePath && allowed) emit('requestMove', sourcePath, targetDirectoryPath)
}

function showDropTarget(event: DragEvent, targetDirectoryPath: string) {
  const sourcePath = getWorkspaceDragPath()
  dropTarget.value = { path: targetDirectoryPath, allowed: canDropInto(sourcePath, targetDirectoryPath) }
  if (event.dataTransfer) event.dataTransfer.dropEffect = dropTarget.value.allowed ? 'move' : 'none'
}
</script>

<template>
  <ul class="workspace-tree">
    <li v-for="entry in entries" :key="entry.relativePath">
      <InlineCreate
        v-if="renamePath === entry.relativePath"
        :kind="entry.kind === 'note' ? 'note' : 'directory'"
        :name="renameName"
        :error="renameError"
        @update:name="emit('update:renameName', $event)"
        @submit="emit('submitRename')"
        @cancel="emit('cancelRename')"
      />

      <details v-else-if="entry.kind === 'directory'" open class="tree-directory" :data-entry-path="entry.relativePath">
        <summary
          draggable="true"
          class="tree-row"
          :class="{ 'tree-row--selected': entry.relativePath === selectedPath, 'tree-row--drop-target': dropTarget?.path === entry.relativePath && dropTarget.allowed, 'tree-row--drop-invalid': dropTarget?.path === entry.relativePath && !dropTarget.allowed }"
          @click.stop="emit('selectEntry', entry)"
          @dragstart.stop="startDrag($event, entry.relativePath)"
          @dragend="endWorkspaceDrag(); dropTarget = null"
          @dragenter.prevent.stop="showDropTarget($event, entry.relativePath)"
          @dragover.prevent.stop="showDropTarget($event, entry.relativePath)"
          @dragleave.stop="dropTarget = null"
          @drop.prevent.stop="dropInto($event, entry.relativePath)"
        >
          <span class="tree-label">
            <svg class="folder-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4 4.5-4 4.5" /></svg>
            <svg class="entry-icon folder-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h5l2 2h8A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" /></svg>
            {{ entry.name }}
            <small v-if="dropTarget?.path === entry.relativePath" class="tree-drop-hint">{{ dropTarget.allowed ? '移动到这里' : '无法移动' }}</small>
          </span>
          <div class="entry-menu" :class="{ 'entry-menu--open': openMenuPath === entry.relativePath }" @click.stop>
            <button type="button" class="entry-menu-trigger" aria-label="更多操作" @click="emit('toggleMenu', openMenuPath === entry.relativePath ? null : entry.relativePath)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
            </button>
            <div v-if="openMenuPath === entry.relativePath" class="entry-menu-popover">
              <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('requestCreate', 'note', entry.relativePath)">新建笔记</button>
              <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('requestCreate', 'directory', entry.relativePath)">新建文件夹</button>
              <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('requestRename', entry)">重命名</button>
              <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('showInFolder', entry)">在资源管理器中显示</button>
              <button type="button" class="danger-action" @mousedown.prevent @click="emit('toggleMenu', null); emit('requestDelete', entry)">删除</button>
            </div>
          </div>
        </summary>
        <WorkspaceTree
          v-bind="$props"
          :entries="entry.children"
          @open-note="emit('openNote', $event)"
          @select-entry="emit('selectEntry', $event)"
          @request-create="(kind, parentPath) => emit('requestCreate', kind, parentPath)"
          @request-rename="emit('requestRename', $event)"
          @request-delete="emit('requestDelete', $event)"
          @toggle-pin="emit('togglePin', $event)"
          @toggle-global-search="emit('toggleGlobalSearch', $event)"
          @update:create-name="emit('update:createName', $event)"
          @submit-create="emit('submitCreate')"
          @cancel-create="emit('cancelCreate')"
          @update:rename-name="emit('update:renameName', $event)"
          @submit-rename="emit('submitRename')"
          @cancel-rename="emit('cancelRename')"
          @toggle-menu="emit('toggleMenu', $event)"
          @request-move="(sourcePath, targetPath) => emit('requestMove', sourcePath, targetPath)"
          @show-in-folder="emit('showInFolder', $event)"
        />
        <InlineCreate
          v-if="createKind && entry.relativePath === createParentPath"
          :kind="createKind"
          :name="createName"
          :error="createError"
          @update:name="emit('update:createName', $event)"
          @submit="emit('submitCreate')"
          @cancel="emit('cancelCreate')"
        />
      </details>

      <div
        v-else
        class="tree-row"
        :class="{ 'tree-row--active': entry.relativePath === activePath, 'tree-row--selected': entry.relativePath === selectedPath }"
        draggable="true"
        @dragstart.stop="startDrag($event, entry.relativePath)"
        @dragend="endWorkspaceDrag(); dropTarget = null"
      >
        <button type="button" class="tree-note" :title="entry.relativePath" @click="emit('selectEntry', entry); emit('openNote', entry.relativePath)">
          <svg class="entry-icon note-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 16h6"/></svg>
          <span>{{ entry.name }}</span>
        </button>
        <div class="entry-menu" :class="{ 'entry-menu--open': openMenuPath === entry.relativePath }" @click.stop>
          <button type="button" class="entry-menu-trigger" aria-label="更多操作" @click="emit('toggleMenu', openMenuPath === entry.relativePath ? null : entry.relativePath)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
          </button>
          <div v-if="openMenuPath === entry.relativePath" class="entry-menu-popover">
            <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('togglePin', entry)">
              {{ pinnedPaths.includes(entry.relativePath) ? '取消置顶' : '置顶' }}
            </button>
            <button type="button" :disabled="!globalNoteSearchEnabled" @mousedown.prevent @click="emit('toggleMenu', null); emit('toggleGlobalSearch', entry)">
              {{ globalNoteSearchEnabled ? (hiddenGlobalPaths.includes(entry.relativePath) ? '恢复全局搜索' : '从全局搜索隐藏') : '全局搜索已关闭' }}
            </button>
            <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('requestRename', entry)">重命名</button>
            <button type="button" @mousedown.prevent @click="emit('toggleMenu', null); emit('showInFolder', entry)">在资源管理器中显示</button>
            <button type="button" class="danger-action" @mousedown.prevent @click="emit('toggleMenu', null); emit('requestDelete', entry)">删除</button>
          </div>
        </div>
      </div>
    </li>
  </ul>
</template>
