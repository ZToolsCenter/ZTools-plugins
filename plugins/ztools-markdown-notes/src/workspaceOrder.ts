// One storage key per directory: unrelated directories never share a sync document.
function orderKey(workspaceId: string, directory: string) {
  return `tree-order:${JSON.stringify([workspaceId, directory])}`
}

export function parentDirectory(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')))
}

function isRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/[\\:]/.test(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

export function loadDirectoryOrder(workspaceId: string, directory: string): string[] {
  const value = window.ztools.dbStorage.getItem(orderKey(workspaceId, directory))
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((path): path is string => isRelativePath(path) && parentDirectory(path) === directory))]
}

function saveDirectoryOrder(workspaceId: string, directory: string, paths: string[]) {
  window.ztools.dbStorage.setItem(orderKey(workspaceId, directory), paths)
}

function defaultCompare(left: WorkspaceTreeEntry, right: WorkspaceTreeEntry) {
  if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, 'zh-CN')
}

export function sortWorkspaceEntries(workspaceId: string, entries: WorkspaceTreeEntry[], directory = ''): WorkspaceTreeEntry[] {
  const ranks = new Map(loadDirectoryOrder(workspaceId, directory).map((path, index) => [path, index]))
  return [...entries].sort((a, b) => {
    const left = ranks.get(a.relativePath) ?? Infinity
    const right = ranks.get(b.relativePath) ?? Infinity
    return left === right ? defaultCompare(a, b) : left - right
  }).map((entry) => entry.kind === 'directory'
    ? { ...entry, children: sortWorkspaceEntries(workspaceId, entry.children, entry.relativePath) }
    : entry)
}

function findChildren(entries: WorkspaceTreeEntry[], directory: string): WorkspaceTreeEntry[] | null {
  if (!directory) return entries
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue
    if (entry.relativePath === directory) return entry.children
    const found = findChildren(entry.children, directory)
    if (found) return found
  }
  return null
}

export function reorderWorkspaceEntry(workspaceId: string, entries: WorkspaceTreeEntry[], source: string, target: string, position: 'before' | 'after'): boolean {
  const directory = parentDirectory(source)
  if (!source || source === target || directory !== parentDirectory(target)) return false
  const children = findChildren(entries, directory)
  if (!children?.some((entry) => entry.relativePath === source) || !children.some((entry) => entry.relativePath === target)) return false
  const stored = loadDirectoryOrder(workspaceId, directory)
  // Include unrecorded visible entries, but retain temporarily missing entries.
  const order = [...stored, ...[...children].sort(defaultCompare).map((entry) => entry.relativePath).filter((path) => !stored.includes(path))]
  const next = order.filter((path) => path !== source)
  next.splice(next.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
  if (next.every((path, index) => path === order[index])) return false
  saveDirectoryOrder(workspaceId, directory, next)
  return true
}

export function replaceWorkspaceOrderPath(workspaceId: string, entries: WorkspaceTreeEntry[], oldPath: string, newPath: string) {
  if (oldPath === newPath) return
  const oldParent = parentDirectory(oldPath)
  const newParent = parentDirectory(newPath)
  const replace = (path: string) => path === oldPath || path.startsWith(`${oldPath}/`) ? `${newPath}${path.slice(oldPath.length)}` : path
  const updates: Array<{ directory: string; paths: string[] }> = []
  const oldOrder = loadDirectoryOrder(workspaceId, oldParent)
  if (oldParent === newParent) {
    if (oldOrder.includes(oldPath)) updates.push({ directory: oldParent, paths: oldOrder.filter((path) => path !== newPath).map(replace) })
  } else {
    if (oldOrder.includes(oldPath)) updates.push({ directory: oldParent, paths: oldOrder.filter((path) => path !== oldPath) })
    const targetOrder = loadDirectoryOrder(workspaceId, newParent)
    const targetChildren = findChildren(entries, newParent) ?? []
    const paths = [...targetOrder.filter((path) => path !== newPath)]
    for (const entry of [...targetChildren].sort(defaultCompare)) {
      if (!paths.includes(entry.relativePath)) paths.push(entry.relativePath)
    }
    updates.push({ directory: newParent, paths: [...paths.filter((path) => path !== newPath), newPath] })
  }
  function collect(children: WorkspaceTreeEntry[]) {
    for (const entry of children) {
      if (entry.kind !== 'directory') continue
      if (entry.relativePath === oldPath || entry.relativePath.startsWith(`${oldPath}/`)) {
        const order = loadDirectoryOrder(workspaceId, entry.relativePath)
        updates.push({ directory: replace(entry.relativePath), paths: order.map(replace) })
        if (order.length) updates.push({ directory: entry.relativePath, paths: [] })
      }
      collect(entry.children)
    }
  }
  collect(entries)
  // Read everything before writing; a failed read must not partially migrate records.
  for (const update of updates) saveDirectoryOrder(workspaceId, update.directory, update.paths)
}
