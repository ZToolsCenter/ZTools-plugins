export type EditorPlatform = 'darwin' | 'win32' | 'linux'
export type ShortcutGroupId = 'edit' | 'mode' | 'select' | 'organize' | 'layer' | 'view' | 'file'
export type ShortcutActionId =
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.copyStyle'
  | 'edit.pasteStyle'
  | 'mode.shape'
  | 'mode.point'
  | 'mode.segment'
  | 'mode.pen'
  | 'mode.paintBucket'
  | 'select.all'
  | 'organize.group'
  | 'organize.ungroup'
  | 'layer.up'
  | 'layer.down'
  | 'layer.top'
  | 'layer.bottom'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.fit'
  | 'view.actualSize'
  | 'view.toggleRuler'
  | 'file.saveProject'

export type ShortcutActionDefinition = {
  id: ShortcutActionId
  group: ShortcutGroupId
  name: string
  description: string
  defaultBindings: (platform: EditorPlatform) => string[]
  requiresSelection?: boolean
  shapeOnly?: boolean
}

export type ShortcutGroupDefinition = {
  id: ShortcutGroupId
  label: string
}

export const SHORTCUT_STORAGE_KEY = 'icon-creator:editor-shortcuts:v1'

export const SHORTCUT_DISPLAY_GROUPS: ShortcutGroupDefinition[] = [
  { id: 'edit', label: '编辑' },
  { id: 'mode', label: '模式' },
  { id: 'select', label: '选择' },
  { id: 'organize', label: '组织' },
  { id: 'layer', label: '图层' },
  { id: 'view', label: '视图' },
  { id: 'file', label: '文件' }
]

export const SHORTCUT_ACTIONS: ShortcutActionDefinition[] = [
  { id: 'edit.copy', group: 'edit', name: '复制', description: '复制当前选择的图形对象', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+C' : 'Ctrl+C'], requiresSelection: true },
  { id: 'edit.paste', group: 'edit', name: '粘贴', description: '粘贴内部剪贴板中的对象', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+V' : 'Ctrl+V'] },
  { id: 'edit.duplicate', group: 'edit', name: '复制副本', description: '复制当前选择并立即粘贴，不覆盖剪贴板', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+D' : 'Ctrl+D'], requiresSelection: true },
  { id: 'edit.delete', group: 'edit', name: '删除', description: '删除当前选中的图形对象', defaultBindings: () => ['Delete', 'Backspace'], requiresSelection: true },
  { id: 'edit.undo', group: 'edit', name: '撤销', description: '撤销上一步编辑操作', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+Z' : 'Ctrl+Z'] },
  { id: 'edit.redo', group: 'edit', name: '重做', description: '恢复刚撤销的编辑操作', defaultBindings: (platform) => (platform === 'darwin' ? ['Meta+Shift+Z'] : ['Ctrl+Y', 'Ctrl+Shift+Z']) },
  { id: 'edit.copyStyle', group: 'edit', name: '复制样式', description: '复制当前对象的样式属性', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+Shift+C' : 'Ctrl+Shift+C'], requiresSelection: true },
  { id: 'edit.pasteStyle', group: 'edit', name: '粘贴样式', description: '将复制的样式应用到当前对象', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+Shift+V' : 'Ctrl+Shift+V'], requiresSelection: true },
  { id: 'mode.shape', group: 'mode', name: '图形模式', description: '切换到图形选择模式', defaultBindings: () => ['Alt+1'] },
  { id: 'mode.point', group: 'mode', name: '点位模式', description: '切换到点位编辑模式', defaultBindings: () => ['Alt+2'] },
  { id: 'mode.segment', group: 'mode', name: '线段模式', description: '切换到线段编辑模式', defaultBindings: () => ['Alt+3'] },
  { id: 'mode.pen', group: 'mode', name: '钢笔工具', description: '切换到钢笔描点工具', defaultBindings: () => ['Alt+4'] },
  { id: 'mode.paintBucket', group: 'mode', name: '油漆桶工具', description: '切换到油漆桶工具，点击封闭区域上色', defaultBindings: () => ['Alt+5'] },
  { id: 'select.all', group: 'select', name: '全选', description: '按当前模式选择全部可编辑内容', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+A' : 'Ctrl+A'] },
  { id: 'organize.group', group: 'organize', name: '成组', description: '将多个已选对象组合成组', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+G' : 'Ctrl+G'], requiresSelection: true, shapeOnly: true },
  { id: 'organize.ungroup', group: 'organize', name: '解组', description: '拆分当前组对象', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+Shift+G' : 'Ctrl+Shift+G'], requiresSelection: true, shapeOnly: true },
  { id: 'layer.up', group: 'layer', name: '上移一层', description: '将当前对象上移一层', defaultBindings: () => ['Alt+ArrowUp'], requiresSelection: true, shapeOnly: true },
  { id: 'layer.down', group: 'layer', name: '下移一层', description: '将当前对象下移一层', defaultBindings: () => ['Alt+ArrowDown'], requiresSelection: true, shapeOnly: true },
  { id: 'layer.top', group: 'layer', name: '置顶', description: '将当前对象移动到最上层', defaultBindings: () => ['Alt+Shift+ArrowUp'], requiresSelection: true, shapeOnly: true },
  { id: 'layer.bottom', group: 'layer', name: '置底', description: '将当前对象移动到最下层', defaultBindings: () => ['Alt+Shift+ArrowDown'], requiresSelection: true, shapeOnly: true },
  { id: 'view.zoomIn', group: 'view', name: '放大', description: '放大画布视图', defaultBindings: (platform) => (platform === 'darwin' ? ['Meta+=', 'Meta+Shift+='] : ['Ctrl+=', 'Ctrl+Shift+=']) },
  { id: 'view.zoomOut', group: 'view', name: '缩小', description: '缩小画布视图', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+-' : 'Ctrl+-'] },
  { id: 'view.fit', group: 'view', name: '适应画布', description: '让画布完整适应当前视图', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+0' : 'Ctrl+0'] },
  { id: 'view.actualSize', group: 'view', name: '1:1', description: '将画布缩放恢复到 100%', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+1' : 'Ctrl+1'] },
  { id: 'view.toggleRuler', group: 'view', name: '切换标尺', description: '显示或隐藏画布标尺', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+R' : 'Ctrl+R'] },
  { id: 'file.saveProject', group: 'file', name: '保存工程', description: '保存当前工程；首次保存选择位置与文件名，之后自动覆盖同一文件', defaultBindings: (platform) => [platform === 'darwin' ? 'Meta+S' : 'Ctrl+S'] }
]

export function getEditorPlatform(): EditorPlatform {
  if (typeof navigator === 'undefined') return 'win32'
  const platform = navigator.platform.toLowerCase()
  const userAgent = navigator.userAgent.toLowerCase()
  if (platform.includes('mac') || userAgent.includes('mac os')) return 'darwin'
  if (platform.includes('linux') || userAgent.includes('linux')) return 'linux'
  return 'win32'
}

export function normalizeShortcutKeyName(key: string) {
  if (key === ' ') return 'Space'
  if (key === 'Esc') return 'Escape'
  if (key === 'Del') return 'Delete'
  if (key === 'Up') return 'ArrowUp'
  if (key === 'Down') return 'ArrowDown'
  if (key === 'Left') return 'ArrowLeft'
  if (key === 'Right') return 'ArrowRight'
  if (key === '+') return '='
  if (key.length === 1) return key.toUpperCase()
  return key.slice(0, 1).toUpperCase() + key.slice(1)
}

export function normalizeShortcutString(value: unknown) {
  if (typeof value !== 'string') return ''
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  if (!parts.length) return ''
  const modifiers = new Set<string>()
  let key = ''
  for (const part of parts) {
    const normalized = part.toLowerCase()
    if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta' || normalized === '⌘') {
      modifiers.add('Meta')
    } else if (normalized === 'ctrl' || normalized === 'control' || normalized === '⌃') {
      modifiers.add('Ctrl')
    } else if (normalized === 'alt' || normalized === 'option' || normalized === 'opt' || normalized === '⌥') {
      modifiers.add('Alt')
    } else if (normalized === 'shift' || normalized === '⇧') {
      modifiers.add('Shift')
    } else {
      key = normalizeShortcutKeyName(part)
    }
  }
  if (!key) return ''
  return ['Ctrl', 'Alt', 'Shift', 'Meta']
    .filter((modifier) => modifiers.has(modifier))
    .concat(key)
    .join('+')
}

export function normalizeKeyboardEventShortcut(event: KeyboardEvent) {
  const key = normalizeShortcutKeyName(event.key)
  if (!key || key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return ''
  return [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : '',
    key
  ].filter(Boolean).join('+')
}

export function formatShortcutForDisplay(value: string, platform: EditorPlatform = getEditorPlatform()) {
  const normalized = normalizeShortcutString(value)
  if (!normalized) return ''
  if (platform !== 'darwin') return normalized.replace(/Meta/g, 'Cmd')
  return normalized
    .replace(/Meta/g, 'Cmd')
    .replace(/Alt/g, 'Option')
}

export function createDefaultShortcutBindings(platform: EditorPlatform) {
  const result = {} as Record<ShortcutActionId, string[]>
  SHORTCUT_ACTIONS.forEach((action) => {
    result[action.id] = action.defaultBindings(platform)
      .map(normalizeShortcutString)
      .filter(Boolean)
  })
  return result
}

export function sanitizeShortcutBindings(input: unknown, fallback: Record<ShortcutActionId, string[]>) {
  const raw = typeof input === 'string'
    ? (() => {
        try { return JSON.parse(input) } catch { return null }
      })()
    : input
  const candidate = raw && typeof raw === 'object' && 'bindings' in raw
    ? (raw as { bindings?: unknown }).bindings
    : raw
  const result = {} as Record<ShortcutActionId, string[]>
  const occupied = new Set<string>()
  SHORTCUT_ACTIONS.forEach((action) => {
    const rawBindings = candidate && typeof candidate === 'object'
      ? (candidate as Record<string, unknown>)[action.id]
      : undefined
    const source = Array.isArray(rawBindings) ? rawBindings : fallback[action.id]
    const clean: string[] = []
    source.forEach((item) => {
      const normalized = normalizeShortcutString(item)
      if (!normalized || clean.includes(normalized) || occupied.has(normalized)) return
      clean.push(normalized)
      occupied.add(normalized)
    })
    result[action.id] = clean
  })
  return result
}
