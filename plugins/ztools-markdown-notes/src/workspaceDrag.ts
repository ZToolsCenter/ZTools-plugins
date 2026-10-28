import { ref } from 'vue'

export const workspaceDragPath = ref('')

export function beginWorkspaceDrag(path: string) {
  workspaceDragPath.value = path
}

export function getWorkspaceDragPath() {
  return workspaceDragPath.value
}

export function endWorkspaceDrag() {
  workspaceDragPath.value = ''
}

export function getTreeDropPosition(kind: 'note' | 'directory', ratio: number): 'before' | 'after' | 'inside' {
  if (kind === 'directory' && ratio >= 0.25 && ratio <= 0.75) return 'inside'
  return ratio < 0.5 ? 'before' : 'after'
}
