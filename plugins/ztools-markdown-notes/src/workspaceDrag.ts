let draggedEntryPath = ''

export function beginWorkspaceDrag(path: string) {
  draggedEntryPath = path
}

export function getWorkspaceDragPath() {
  return draggedEntryPath
}

export function endWorkspaceDrag() {
  draggedEntryPath = ''
}
