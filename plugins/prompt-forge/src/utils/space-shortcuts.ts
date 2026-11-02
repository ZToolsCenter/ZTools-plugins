export type SpaceShortcutAction = 'edit-active' | 'submit-fill'

interface SpaceShortcutInput {
  key: string
  phase: 'search' | 'fill'
  targetTag?: string
  ctrlKey?: boolean
  metaKey?: boolean
}

export function getSpaceShortcutAction(input: SpaceShortcutInput): SpaceShortcutAction | null {
  const targetTag = input.targetTag?.toUpperCase() || ''

  if (input.phase === 'search' && input.key.toLowerCase() === 'e') {
    return targetTag === 'INPUT' || targetTag === 'TEXTAREA' ? null : 'edit-active'
  }

  if (input.phase === 'fill' && input.key === 'Enter') {
    if (targetTag === 'TEXTAREA' && !(input.ctrlKey || input.metaKey)) return null
    return 'submit-fill'
  }

  return null
}
