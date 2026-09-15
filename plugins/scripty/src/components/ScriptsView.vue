<script setup lang="ts">
import { computed, h, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ZButton } from 'ztools-ui'
import ZTree, { type TreeOption, type RenderFn } from './ZTree.vue'
import { createEditor, type CodeMirrorHandle } from '../composables/useCodeMirror'
import { fileIconUrl, folderIconUrl } from '../composables/fileIcons'
import type { ScriptFolderSummary, ScriptSummary } from '../types/api'
import type { ScriptLanguage } from '../types/domain'

const props = defineProps<{
  requestConfirmation: (options: { title: string; message: string; confirmText?: string; cancelText?: string }) => Promise<boolean>
}>()
const emit = defineEmits<{
  (event: 'feedback', type: 'success' | 'error', message: string): void
}>()

const scripts = ref<ScriptSummary[]>([])
const folders = ref<ScriptFolderSummary[]>([])
const editorVisible = ref(false)
const pathDialogVisible = ref(false)
const pathOperation = ref<'create-folder' | 'move-folder' | 'move-script'>('create-folder')
const pathTargetId = ref<string | null>(null)
const pathValue = ref('')
const editingScriptId = ref<string | null>(null)
const saving = ref(false)
const content = ref('')
/** Editor-only directory prefix (no trailing slash) inferred from where the user created/edited the script. */
const editorDir = ref('')
/** Editor-only full filename (name + extension) the user sees and edits. */
const editorFileName = ref('')

/**
 * Maps a recognized file extension to its Scripty execution language. This only
 * fills the metadata `language` field the backend requires; unrecognized extensions
 * (e.g. .json, .log) default to javascript since such scripts are never runnable as
 * tasks. Syntax highlighting is decoupled from this and driven by the filename inside
 * the editor composable.
 */
const EXTENSION_LANGUAGES: Record<string, ScriptLanguage> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  ps1: 'powershell',
  sh: 'shell'
}

/** Joins the editor directory and filename back into the full relative path the backend expects. */
const editorRelativePath = computed(() =>
  editorDir.value ? `${editorDir.value}/${editorFileName.value}` : editorFileName.value
)

/** The stored language of the script currently being edited; unused while creating. */
const pinnedLanguage = ref<ScriptLanguage>('javascript')

/**
 * Execution language stored in metadata. On edit it stays pinned to the script's
 * original language (the backend forbids changing it); on create it is inferred from
 * the extension, defaulting to javascript for non-runnable extensions.
 */
const editorLanguage = computed<ScriptLanguage>(() => {
  if (editingScriptId.value) return pinnedLanguage.value
  const ext = editorFileName.value.split('.').pop()?.toLocaleLowerCase() ?? ''
  return EXTENSION_LANGUAGES[ext] ?? 'javascript'
})

/** Derives the persisted script name from the filename without its extension. */
const editorName = computed(() => {
  const dotIndex = editorFileName.value.lastIndexOf('.')
  return dotIndex > 0 ? editorFileName.value.slice(0, dotIndex) : editorFileName.value
})

/** Host element the CodeMirror instance mounts into. */
const cmHostRef = ref<HTMLDivElement | null>(null)
/** Active CodeMirror handle; null while the editor drawer is closed. */
let editorHandle: CodeMirrorHandle | null = null

/** Mounts a fresh CodeMirror editor into `cmHostRef` with the current content + language. */
function mountEditor() {
  const host = cmHostRef.value
  if (!host) return
  editorHandle = createEditor(host, {
    doc: content.value,
    fileName: editorFileName.value,
    onChange: (doc) => {
      content.value = doc
    },
    onSave: () => {
      void saveSource(false)
    }
  })
}

/** Tears down the CodeMirror editor and clears the handle. */
function unmountEditor() {
  editorHandle?.destroy()
  editorHandle = null
}

// The drawer uses displayDirective 'if' by default, so its DOM (and thus the CM
// host) is created on open and destroyed on close. Mount/destroy in lockstep,
// and reconfigure highlighting whenever the filename extension changes.
watch(editorVisible, async (visible) => {
  if (visible) {
    await nextTick()
    mountEditor()
  } else {
    unmountEditor()
  }
})

watch(editorFileName, (fileName) => {
  editorHandle?.setFileName(fileName)
})

onBeforeUnmount(unmountEditor)

/** Internal recursive branch used while flattening folder metadata and script paths into ZTree data. */
interface ScriptTreeBranch {
  folder: ScriptFolderSummary
  folders: ScriptTreeBranch[]
  scripts: ScriptSummary[]
}

/**
 * File/folder prefix icons resolved from material-icon-theme and rendered as <img>.
 * The SVGs carry their own brand colors, so they are shown as images rather than
 * inlined + recolored. Folder icons swap to their open variant while expanded, which
 * stays reactive because the closure reads the `expandedKeys` ref during render.
 */
function iconImg(url: string) {
  return h('img', { class: 'ztree-node__icon-img', src: url, 'aria-hidden': 'true', draggable: false })
}
function makeFolderPrefix(folderName: string, optionKey: string) {
  return () => iconImg(folderIconUrl(folderName, expandedKeys.value.includes(optionKey)))
}
function makeFilePrefix(fileName: string) {
  return () => iconImg(fileIconUrl(fileName))
}

/** Builds recursive tree branches from persisted folder metadata and stable script paths. */
const treeBranches = computed<ScriptTreeBranch[]>(() => {
  const branches = new Map<string, ScriptTreeBranch>()
  for (const folder of folders.value) branches.set(folder.relativePath, { folder, folders: [], scripts: [] })
  const roots: ScriptTreeBranch[] = []
  for (const branch of branches.values()) {
    const parentPath = branch.folder.relativePath.split('/').slice(0, -1).join('/')
    const parent = branches.get(parentPath)
    if (parent) parent.folders.push(branch)
    else roots.push(branch)
  }
  for (const script of scripts.value) {
    const parentPath = script.relativePath.split('/').slice(0, -1).join('/')
    branches.get(parentPath)?.scripts.push(script)
  }
  const sortBranch = (branch: ScriptTreeBranch) => {
    branch.folders.sort((left, right) => left.folder.relativePath.localeCompare(right.folder.relativePath, 'zh-CN'))
    branch.scripts.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'zh-CN'))
    branch.folders.forEach(sortBranch)
  }
  roots.forEach(sortBranch)
  return roots.sort((left, right) => left.folder.relativePath.localeCompare(right.folder.relativePath, 'zh-CN'))
})
const rootScripts = computed(() => scripts.value.filter(script => !script.relativePath.includes('/')))

/** Converts one folder branch into a ZTree folder option carrying its payload for menu actions. */
function folderToOption(branch: ScriptTreeBranch): TreeOption {
  const children: TreeOption[] = [
    ...branch.folders.map(folderToOption),
    ...branch.scripts.map(scriptToOption)
  ]
  const optionKey = folderOptionKey(branch.folder.id)
  const folderName = branch.folder.relativePath.split('/').pop() || branch.folder.relativePath
  return {
    key: optionKey,
    label: folderName,
    children,
    prefix: makeFolderPrefix(folderName, optionKey),
    __folder: branch.folder,
    __cut: false
  } as TreeOption
}

/** Converts one script summary into a leaf ZTree option whose label is the full filename with extension. */
function scriptToOption(script: ScriptSummary): TreeOption {
  return {
    key: `script:${script.id}`,
    label: script.relativePath.split('/').pop() || script.name,
    isLeaf: true,
    prefix: makeFilePrefix(script.relativePath.split('/').pop() || script.name),
    __script: script,
    __cut: false
  } as TreeOption
}

/** Marks folders during conversion so cut state and menu logic can read it back from the option. */
function folderOptionKey(folderId: string) {
  return `folder:${folderId}`
}

/** 把目录相对路径解析为 folder 树节点 key；根目录返回 null（根节点本就常驻可见）。 */
function folderKeyForDir(dir: string): string | null {
  if (!dir) return null
  const folder = folders.value.find(f => f.relativePath === dir)
  return folder ? folderOptionKey(folder.id) : null
}

/** 把某目录增量加入展开集合（已存在则跳过），用于新建条目后让用户看到它。 */
function expandFolder(dir: string) {
  const key = folderKeyForDir(dir)
  if (key && !expandedKeys.value.includes(key)) {
    expandedKeys.value = [...expandedKeys.value, key]
  }
}

/**
 * In-memory clipboard for cut/copy. Holding the item here keeps the tree-driven
 * paste logic simple: cut issues a move on paste, copy issues the new copy API.
 */
interface ClipItem {
  kind: 'script' | 'folder'
  id: string
  sourcePath: string
  mode: 'cut' | 'copy'
}
const clipboard = ref<ClipItem | null>(null)

/** Currently selected tree node; drives the directory the header "新建脚本" button targets. */
const selectedOption = ref<TreeOption | null>(null)

/**
 * 受控展开键集合。提升到 ScriptsView 管理后，loadScripts 重建 treeOptions 不会
 * 触发 ZTree 内部 data watcher 的重置（expandedControlled 为真），从而保留用户的展开状态。
 */
const expandedKeys = ref<Array<string | number>>([])

/**
 * Directory a new script should be created in, derived from the selection:
 * a folder is used directly, a script contributes its parent directory, root yields ''.
 */
const selectedTargetDir = computed(() => targetDir(selectedOption.value))

/** Updates the tracked selection from ZTree's selectedKeys emission. */
function onTreeSelected(_keys: Array<string | number>, options: Array<TreeOption | null>) {
  selectedOption.value = options[0] ?? null
}

/** 同步 ZTree 受控展开状态：用户每次展开/折叠都写回 ref。 */
function onExpandedChange(keys: Array<string | number>) {
  expandedKeys.value = keys
}

/** The tree key currently being renamed inline; its label swaps for an input. */
const renamingKey = ref<string | null>(null)
const renamingValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

/** Flattened ZTree data: root folders first, then root-level loose scripts. Cut nodes get __cut=true. */
const treeOptions = computed<TreeOption[]>(() => {
  const base: TreeOption[] = [
    ...treeBranches.value.map(folderToOption),
    ...rootScripts.value.map(scriptToOption)
  ]
  const clip = clipboard.value
  if (clip && clip.mode === 'cut') {
    const cutKey = `${clip.kind}:${clip.id}`
    const mark = (nodes: TreeOption[]) => {
      for (const node of nodes) {
        if (node.key === cutKey) node.__cut = true
        if (node.children?.length) mark(node.children)
      }
    }
    mark(base)
  }
  return base
})

/** Renders the language-agnostic action buttons in each node's suffix slot. */
const renderSuffix: RenderFn = ({ option }) => {
  const script = option.__script as ScriptSummary | undefined
  const folder = option.__folder as ScriptFolderSummary | undefined
  if (script) {
    return h('div', { class: 'script-row__actions' }, [
      h(ZButton, { type: 'text', size: 'small', onClick: () => openEditEditor(script) }, () => '编辑')
    ])
  }
  if (folder) {
    return null
  }
  return null
}

/**
 * Label renderer: when a node is being renamed inline, render an <input> instead
 * of the static text; otherwise return the node's label so the tree shows it.
 */
const renderLabel: RenderFn = ({ option }) => {
  if (renamingKey.value !== String(option.key)) return String(option.label ?? '')
  return h('input', {
    ref: (el) => { renameInputRef.value = el as HTMLInputElement | null },
    class: 'ztree-rename-input',
    value: renamingValue.value,
    placeholder: '名称',
    onClick: (event: MouseEvent) => event.stopPropagation(),
    onContextmenu: (event: MouseEvent) => event.stopPropagation(),
    onInput: (event: Event) => { renamingValue.value = (event.target as HTMLInputElement).value },
    onKeydown: (event: KeyboardEvent) => onRenameKeydown(event, option),
    onBlur: () => commitRename(option)
  })
}

/** Context-menu state for right-clicked nodes and the empty/roof "new folder" entry. */
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuTarget = ref<TreeOption | null>(null)
const contextMenuItems = computed(() => {
  const target = contextMenuTarget.value
  const clip = clipboard.value
  if (target?.__folder) {
    const items: Array<Record<string, unknown>> = [
      { type: 'item', key: 'new-script', label: '新建脚本' },
      { type: 'item', key: 'create-folder', label: '新建子目录' },
      { type: 'separator', key: 'sep1' },
      { type: 'item', key: 'cut', label: '剪切' },
      { type: 'item', key: 'copy', label: '复制' }
    ]
    if (clip) items.push({ type: 'item', key: 'paste', label: '粘贴' })
    items.push(
      { type: 'separator', key: 'sep2' },
      { type: 'item', key: 'rename', label: '重命名' },
      { type: 'item', key: 'remove-folder', label: '删除', danger: true }
    )
    return items
  }
  if (target?.__script) {
    return [
      { type: 'item', key: 'edit-script', label: '编辑源码' },
      { type: 'separator', key: 'sep1' },
      { type: 'item', key: 'cut', label: '剪切' },
      { type: 'item', key: 'copy', label: '复制' },
      { type: 'separator', key: 'sep2' },
      { type: 'item', key: 'rename', label: '重命名' },
      { type: 'item', key: 'remove-script', label: '删除', danger: true }
    ]
  }
  const items: Array<Record<string, unknown>> = [
    { type: 'item', key: 'new-script-root', label: '新建脚本' },
    { type: 'item', key: 'create-root-folder', label: '新建目录' }
  ]
  if (clip) {
    items.push({ type: 'separator', key: 'sep1' }, { type: 'item', key: 'paste', label: '粘贴' })
  }
  return items
})

/** Opens the context menu at the cursor for the right-clicked tree node. */
function onNodeContextmenu({ event, option }: { event: MouseEvent; option: TreeOption }) {
  event.preventDefault()
  event.stopPropagation()
  contextMenuTarget.value = option
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

/** Opens the root-level context menu at the cursor over the tree background. */
function onTreeContextmenu(event: MouseEvent) {
  event.preventDefault()
  contextMenuTarget.value = null
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

/** Returns the relative-path prefix to paste into for a target option (empty string for root). */
function targetDir(option: TreeOption | null): string {
  const folder = option?.__folder as ScriptFolderSummary | undefined
  return folder ? folder.relativePath : ''
}

/** Resolves the path of the currently right-clicked script/folder, if any. */
function targetPathOf(option: TreeOption | null): string | null {
  const folder = option?.__folder as ScriptFolderSummary | undefined
  const script = option?.__script as ScriptSummary | undefined
  return folder?.relativePath ?? script?.relativePath ?? null
}

/** Builds a non-conflicting target path for a paste, appending " 副本"/number suffixes as needed. */
function buildPasteTargetPath(clip: ClipItem, intoDir: string): { path: string; leafName: string; ext: string } {
  const sourceLeaf = clip.sourcePath.split('/').pop() || clip.sourcePath
  const dotIndex = sourceLeaf.lastIndexOf('.')
  const baseName = dotIndex > 0 ? sourceLeaf.slice(0, dotIndex) : sourceLeaf
  const ext = dotIndex > 0 ? sourceLeaf.slice(dotIndex) : ''
  const usedPaths = new Set<string>([...scripts.value.map(s => s.relativePath), ...folders.value.map(f => f.relativePath)])
  const candidate = (suffix: string) => `${intoDir ? `${intoDir}/` : ''}${baseName}${suffix}${ext}`
  if (!usedPaths.has(candidate(''))) return { path: candidate(''), leafName: `${baseName}${ext}`, ext }
  let n = 2
  while (usedPaths.has(candidate(` 副本${n > 2 ? n : ''}`))) n += 1
  const suffix = n === 2 ? ' 副本' : ` 副本${n}`
  return { path: candidate(suffix), leafName: `${baseName}${suffix}${ext}`, ext }
}

/** Performs a paste of the current clipboard item into the right-clicked target (or root). */
async function pasteItem() {
  const clip = clipboard.value
  const intoDir = targetDir(contextMenuTarget.value)
  if (!clip) return
  if (clip.mode === 'cut') {
    if (clip.sourcePath === intoDir) return
    const leaf = clip.sourcePath.split('/').pop() || clip.sourcePath
    const target = `${intoDir ? `${intoDir}/` : ''}${leaf}`
    if (target === clip.sourcePath) { clipboard.value = null; return }
    const result = clip.kind === 'folder'
      ? await window.scripty.scripts.moveFolder(clip.id, { relativePath: target })
      : await window.scripty.scripts.move(clip.id, { relativePath: target })
    if (result.ok === false) return emit('feedback', 'error', result.error.message)
    clipboard.value = null
    await loadScripts()
    emit('feedback', 'success', '已移动')
    return
  }
  const { path } = buildPasteTargetPath(clip, intoDir)
  const result = clip.kind === 'folder'
    ? await window.scripty.scripts.copyFolder(clip.id, { relativePath: path })
    : await window.scripty.scripts.copy(clip.id, { relativePath: path })
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  await loadScripts()
  // 复制会新增条目，展开目标目录让用户看到副本（移动不新建实体，展开状态已由受控模式保留）。
  expandFolder(intoDir)
  emit('feedback', 'success', '已复制')
}

/** Starts inline rename for the right-clicked target, prefilling its current leaf name. */
function startRename(option: TreeOption) {
  const path = targetPathOf(option)
  if (!path) return
  renamingKey.value = String(option.key)
  renamingValue.value = path.split('/').pop() || path
  nextTick(() => renameInputRef.value?.focus())
  nextTick(() => renameInputRef.value?.select())
}

/** Commits or cancels rename based on the key pressed inside the rename input. */
function onRenameKeydown(event: KeyboardEvent, option: TreeOption) {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitRename(option)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelRename()
  }
}

/** Cancels the in-flight rename, leaving the persisted name untouched. */
function cancelRename() {
  renamingKey.value = null
  renamingValue.value = ''
}

/** Persists the new leaf name via move/moveFolder, preserving the parent directory. */
async function commitRename(option: TreeOption) {
  const key = renamingKey.value
  const next = renamingValue.value.trim()
  renamingKey.value = null
  renamingValue.value = ''
  if (!key || !next) return
  const folder = option.__folder as ScriptFolderSummary | undefined
  const script = option.__script as ScriptSummary | undefined
  if (folder) {
    const parentSegs = folder.relativePath.split('/').slice(0, -1)
    const target = [...parentSegs, next].join('/')
    if (target === folder.relativePath) return
    const result = await window.scripty.scripts.moveFolder(folder.id, { relativePath: target })
    if (result.ok === false) return emit('feedback', 'error', result.error.message)
  } else if (script) {
    const parentSegs = script.relativePath.split('/').slice(0, -1)
    const target = [...parentSegs, next].join('/')
    if (target === script.relativePath) return
    const result = await window.scripty.scripts.move(script.id, { relativePath: target })
    if (result.ok === false) return emit('feedback', 'error', result.error.message)
  }
  await loadScripts()
  emit('feedback', 'success', '已重命名')
}

/** Dispatches a context-menu selection to the matching script/folder operation. */
function onContextmenuSelect(key: string) {
  contextMenuVisible.value = false
  const target = contextMenuTarget.value
  const folder = target?.__folder as ScriptFolderSummary | undefined
  const script = target?.__script as ScriptSummary | undefined
  const sourcePath = folder?.relativePath ?? script?.relativePath ?? null
  const id = folder?.id ?? script?.id ?? null
  switch (key) {
    case 'new-script':
    case 'new-script-root':
      openCreateEditor(targetDir(target))
      break
    case 'create-folder':
      openPathDialog('create-folder', folder)
      break
    case 'create-root-folder':
      openPathDialog('create-folder')
      break
    case 'edit-script':
      if (script) openEditEditor(script)
      break
    case 'cut':
      if (id && sourcePath) clipboard.value = { kind: folder ? 'folder' : 'script', id, sourcePath, mode: 'cut' }
      break
    case 'copy':
      if (id && sourcePath) clipboard.value = { kind: folder ? 'folder' : 'script', id, sourcePath, mode: 'copy' }
      break
    case 'paste':
      pasteItem()
      break
    case 'rename':
      if (target) startRename(target)
      break
    case 'remove-folder':
      if (folder) removeFolder(folder)
      break
    case 'remove-script':
      if (script) removeScript(script)
      break
  }
  contextMenuTarget.value = null
}

/** Loads managed script and folder summaries without exposing absolute paths or source hashes. */
async function loadScripts() {
  const [scriptsResult, foldersResult] = await Promise.all([
    window.scripty.scripts.list(), window.scripty.scripts.listFolders()
  ])
  if (scriptsResult.ok === false) emit('feedback', 'error', scriptsResult.error.message)
  else scripts.value = scriptsResult.data
  if (foldersResult.ok === false) emit('feedback', 'error', foldersResult.error.message)
  else folders.value = foldersResult.data
}

/** Opens a blank source editor; intoDir fixes the directory the new file will live in. */
function openCreateEditor(intoDir = '') {
  editingScriptId.value = null
  content.value = ''
  editorDir.value = intoDir
  editorFileName.value = 'new-script.js'
  pinnedLanguage.value = 'javascript'
  editorVisible.value = true
}

/** Loads one managed source into the editor, splitting its path into a locked dir + filename. */
async function openEditEditor(script: ScriptSummary) {
  const result = await window.scripty.scripts.get(script.id)
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  editingScriptId.value = script.id
  content.value = result.data.content
  const segments = result.data.relativePath.split('/')
  editorFileName.value = segments.pop() || result.data.relativePath
  editorDir.value = segments.join('/')
  // 已有脚本语言不可更改；editorLanguage 在编辑态固定读取 pinnedLanguage。
  pinnedLanguage.value = result.data.language
  editorVisible.value = true
}

/** Creates or updates managed source atomically and refreshes tree metadata after persistence. */
async function saveSource(closeAfter = true) {
  if (saving.value) return
  saving.value = true
  const input = {
    name: editorName.value,
    note: '',
    content: content.value,
    relativePath: editorRelativePath.value,
    language: editorLanguage.value
  }
  // 新建脚本才需要展开其所在目录；更新已有脚本不改变树结构。
  const wasCreate = !editingScriptId.value
  const result = editingScriptId.value
    ? await window.scripty.scripts.update(editingScriptId.value, input)
    : await window.scripty.scripts.create(input)
  saving.value = false
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  if (closeAfter) {
    editorVisible.value = false
  } else {
    editingScriptId.value = result.data.id
    const segments = result.data.relativePath.split('/')
    editorFileName.value = segments.pop() || result.data.relativePath
    editorDir.value = segments.join('/')
  }
  await loadScripts()
  if (wasCreate) {
    // 展开新脚本所在目录，让用户立刻看到它。
    const parentDir = result.data.relativePath.split('/').slice(0, -1).join('/')
    expandFolder(parentDir)
  }
  emit('feedback', 'success', editingScriptId.value ? '脚本源码已更新' : '脚本已创建')
}

/** Opens the constrained relative-path dialog for a folder or script operation. */
function openPathDialog(operation: typeof pathOperation.value, target?: ScriptFolderSummary | ScriptSummary) {
  pathOperation.value = operation
  pathTargetId.value = target?.id ?? null
  if (operation === 'create-folder') {
    const parent = target && 'relativePath' in target ? target.relativePath : ''
    pathValue.value = parent ? `${parent}/新目录` : '新目录'
  } else pathValue.value = target?.relativePath ?? ''
  pathDialogVisible.value = true
}

/** Applies one normalized folder/script path operation through preload and refreshes the tree. */
async function applyPathOperation() {
  let result
  // 新建目录才需要展开其父级；移动操作沿用既有展开状态（由受控模式保留）。
  const willCreateFolder = pathOperation.value === 'create-folder'
  const createdParentDir = willCreateFolder ? pathValue.value.split('/').slice(0, -1).join('/') : ''
  if (willCreateFolder) result = await window.scripty.scripts.createFolder({ relativePath: pathValue.value })
  else if (pathOperation.value === 'move-folder' && pathTargetId.value) result = await window.scripty.scripts.moveFolder(pathTargetId.value, { relativePath: pathValue.value })
  else if (pathTargetId.value) result = await window.scripty.scripts.move(pathTargetId.value, { relativePath: pathValue.value })
  else return
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  pathDialogVisible.value = false
  await loadScripts()
  // 展开新建目录的父级，让用户立刻看到新目录。
  if (willCreateFolder) expandFolder(createdParentDir)
  emit('feedback', 'success', willCreateFolder ? '目录已创建' : '路径已更新')
}

/** Deletes one unreferenced script after shared confirmation. */
async function removeScript(script: ScriptSummary) {
  const accepted = await props.requestConfirmation({ title: '删除脚本', message: `确定删除“${script.relativePath}”及其托管源码吗？`, confirmText: '删除', cancelText: '取消' })
  if (!accepted) return
  const result = await window.scripty.scripts.remove(script.id)
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  await loadScripts()
  emit('feedback', 'success', '脚本已删除')
}

/** Recursively deletes one folder only after preload confirms no task references its scripts. */
async function removeFolder(folder: ScriptFolderSummary) {
  const accepted = await props.requestConfirmation({ title: '删除目录', message: `确定递归删除“${folder.relativePath}”及其中所有脚本吗？`, confirmText: '递归删除', cancelText: '取消' })
  if (!accepted) return
  const result = await window.scripty.scripts.removeFolder(folder.id)
  if (result.ok === false) return emit('feedback', 'error', result.error.message)
  await loadScripts()
  emit('feedback', 'success', '目录已删除')
}

onMounted(loadScripts)
</script>

<template>
  <section class="scripts-view" aria-labelledby="scripts-heading">
    <ZDrawer v-model:show="editorVisible" placement="right" width="80%" :close-on-esc="false" :mask-closable="false" trap-focus auto-focus>
      <ZDrawerContent
        :title="editingScriptId ? '编辑脚本源码' : '新建脚本'"
        closable
        :body-content-style="{ height: '100%', display: 'flex', flexDirection: 'column' }"
      >
        <form class="script-editor" @submit.prevent="saveSource(true)">
          <label><span>文件名</span><ZInput v-model="editorFileName" placeholder="例如：daily.py" /></label>
          <div class="source-editor-wrap">
            <div ref="cmHostRef" class="source-editor__cm" aria-label="脚本源码"></div>
          </div>
        </form>
        <template #footer><div class="drawer-actions"><ZButton type="default" @click="editorVisible = false">取消</ZButton><ZButton type="primary" :loading="saving" :disabled="!editorFileName.trim()" @click="saveSource(true)">保存源码</ZButton></div></template>
      </ZDrawerContent>
    </ZDrawer>

    <ZModal v-model:show="pathDialogVisible" :mask-closable="false" trap-focus auto-focus>
      <form class="path-form" @submit.prevent="applyPathOperation">
        <h3>{{ pathOperation === 'create-folder' ? '新建目录' : '移动或重命名' }}</h3>
        <label><span>相对路径</span><ZInput v-model="pathValue" placeholder="例如：reports/daily" /></label>
        <p class="managed-copy-notice">使用 / 分隔；路径必须位于 Scripty 托管脚本根目录内。</p>
        <div class="drawer-actions"><ZButton type="default" @click="pathDialogVisible = false">取消</ZButton><ZButton type="primary" :disabled="!pathValue.trim()" @click="applyPathOperation">保存</ZButton></div>
      </form>
    </ZModal>

    <div class="section-heading">
      <div><h2 id="scripts-heading">托管脚本</h2></div>
      <div class="section-heading__actions">
        <ZButton type="primary" @click="openCreateEditor(selectedTargetDir)">新建脚本</ZButton>
      </div>
    </div>

    <div class="view-body" :class="{ 'view-body--tree': scripts.length + folders.length > 0 }">
      <div v-if="scripts.length === 0 && folders.length === 0" class="empty-state">
        <div class="empty-state__mark" aria-hidden="true">S</div><h3>还没有脚本</h3><p>创建目录和脚本，源码将保存在 Scripty 托管目录中。</p>
      </div>
      <div
        v-else
        class="script-tree"
        @contextmenu="onTreeContextmenu"
      >
        <ZTree
          :data="treeOptions"
          :expanded-keys="expandedKeys"
          :indent="20"
          block-line
          selectable
          :cancelable="true"
          :render-suffix="renderSuffix"
          :render-label="renderLabel"
          @node-contextmenu="onNodeContextmenu"
          @update:expandedKeys="onExpandedChange"
          @update:selectedKeys="onTreeSelected"
        />
      </div>
    </div>

    <ZContextMenu
      :show="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :menu-items="contextMenuItems"
      trigger="manual"
      @update:show="(value) => (contextMenuVisible = value)"
      @select="onContextmenuSelect"
    />
  </section>
</template>

<style scoped lang="scss">
.scripts-view {
  padding-top: 0;
}

.script-editor {
  display: flex;
  flex-direction: column;
  /* Fills the drawer body (stretched via ZDrawerContent's body-content-style)
     so the editor does not force the drawer to scroll. The optional language
     picker sits between the filename and the editor without a fixed row count. */
  height: 100%;
  min-height: 0;
  gap: 16px;
  padding: 4px;
}

.script-editor label {
  display: grid;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

/* Editor frame: a single CodeMirror host fills it; scrolling stays inside CM. */
.source-editor-wrap {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  border: 1px solid var(--input-border);
  border-radius: 10px;
  background: var(--input-bg);
  overflow: hidden;
}

/* CodeMirror host stretches to fill the frame; CM owns its own scroller. */
.source-editor__cm {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
}

.source-editor__cm :deep(.cm-editor) {
  height: 100%;
}

.source-editor__cm :deep(.cm-scroller) {
  overflow: auto;
}

.script-tree {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

/* The <pre> mirror and <textarea> overlay carry these classes but are plain elements
   inside this component, so they get the scope id naturally — no :deep needed. */
.script-tree :deep(.ztree) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Overrides the base 4px padding from .ztree. Top/left/right are bumped so the
     focus ring on node rows (block-line makes rows width:100%, touching the
     content box edges) is not clipped by `overflow-y: auto`. */
  padding: 8px 8px 12px;
}

/* material-icon-theme SVGs rendered as <img>; fixed box keeps rows aligned. */
.script-tree :deep(.ztree-node__icon-img) {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  object-fit: contain;
  user-select: none;
}

/* inline rename input rendered in place of the static label */
.ztree-rename-input {
  width: min(220px, 60%);
  padding: 2px 6px;
  border: 1px solid var(--primary-color);
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--text-color);
  font: inherit;
}
</style>
