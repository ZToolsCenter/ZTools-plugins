interface ShortcutActions {
  openShortcuts: () => void
  openSettings: () => void
  replayOnboarding: () => void
  newTab: () => void
  closeCurrentTab: () => void
  duplicateTab: () => void
  nextTab: () => void
  prevTab: () => void
  sendOrToggleConnection: () => void
  saveRequest: () => void
  cancelSend: () => void
  toggleSidebar: () => void
  focusRequestUrl: () => void
  toggleResponsePanel: () => void
}

interface ShortcutContext {
  enabled: () => boolean
  isModalOpen: () => boolean
  isSending: () => boolean
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isMod(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey
}

function isShiftMod(event: KeyboardEvent): boolean {
  return isMod(event) && event.shiftKey
}

export function useShortcuts(actions: ShortcutActions, context: ShortcutContext) {
  const onKeydown = (event: KeyboardEvent) => {
    if (!context.enabled()) {
      return
    }

    const editable = isEditableElement(event.target)

    if (event.key === 'Escape' && context.isSending()) {
      event.preventDefault()
      actions.cancelSend()
      return
    }

    if (event.key === '?' && !editable) {
      event.preventDefault()
      actions.openShortcuts()
      return
    }

    if (context.isModalOpen()) {
      return
    }

    if (isMod(event) && event.key === ',') {
      event.preventDefault()
      actions.openSettings()
      return
    }

    if (isShiftMod(event) && event.key.toLowerCase() === 'h') {
      event.preventDefault()
      actions.replayOnboarding()
      return
    }

    if (isMod(event) && event.altKey && event.key.toLowerCase() === 't') {
      event.preventDefault()
      actions.newTab()
      return
    }

    if (isMod(event) && event.altKey && event.key.toLowerCase() === 'w') {
      event.preventDefault()
      actions.closeCurrentTab()
      return
    }

    if (isMod(event) && event.key.toLowerCase() === 'd') {
      event.preventDefault()
      actions.duplicateTab()
      return
    }

    if (isShiftMod(event) && event.code === 'BracketRight') {
      event.preventDefault()
      actions.nextTab()
      return
    }

    if (isShiftMod(event) && event.code === 'BracketLeft') {
      event.preventDefault()
      actions.prevTab()
      return
    }

    if (isMod(event) && event.key === 'Enter') {
      event.preventDefault()
      actions.sendOrToggleConnection()
      return
    }

    if (isMod(event) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      actions.saveRequest()
      return
    }

    if (isMod(event) && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      actions.toggleSidebar()
      return
    }

    if (isMod(event) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      actions.focusRequestUrl()
      return
    }

    if (isShiftMod(event) && event.key.toLowerCase() === 'r') {
      event.preventDefault()
      actions.toggleResponsePanel()
    }
  }

  function mount() {
    window.addEventListener('keydown', onKeydown, true)
  }

  function unmount() {
    window.removeEventListener('keydown', onKeydown, true)
  }

  return {
    mount,
    unmount
  }
}
