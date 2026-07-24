import { ref } from 'vue'
import { useStorage } from '../../composables/useStorage'
import { DEFAULT_BINDINGS, type KeyBindings, type ControlMode } from '../../constants/game'
import * as engine from '../engine'

const { getItem, setItem } = useStorage()

const STORAGE_KEYS = {
  controlMode: 'tetrisControlMode',
  keyBindings: 'tetrisKeyBindings',
}

export function useControls() {
  const controlMode = ref<ControlMode>('arrows')
  const keyBindings = ref<KeyBindings>({ ...DEFAULT_BINDINGS.arrows })
  const isListening = ref(false)
  const listeningAction = ref<string | null>(null)

  // ============================================================
  //  CONTROL MODE
  // ============================================================
  function setControlMode(mode: ControlMode) {
    engine.stopGameLoop()
    controlMode.value = mode

    if (mode === 'custom') {
      if (!keyBindings.value._isCustom) {
        keyBindings.value = { ...DEFAULT_BINDINGS.arrows, _isCustom: true }
      }
    } else {
      keyBindings.value = { ...DEFAULT_BINDINGS[mode] }
    }

    saveSettings()
  }

  // ============================================================
  //  KEY BINDING REBIND
  // ============================================================
  function startRebinding(action: string) {
    if (isListening.value) return
    isListening.value = true
    listeningAction.value = action
  }

  function finishRebinding(key: string) {
    if (!isListening.value || !listeningAction.value) return

    // Don't allow rebinding to certain reserved keys
    if (['Escape', 'Tab'].includes(key)) {
      isListening.value = false
      listeningAction.value = null
      return
    }

    keyBindings.value = {
      ...keyBindings.value,
      [listeningAction.value]: key,
      _isCustom: true,
    }

    isListening.value = false
    listeningAction.value = null
    saveSettings()
  }

  // ============================================================
  //  PERSISTENCE
  // ============================================================
  function saveSettings() {
    setItem(STORAGE_KEYS.controlMode, controlMode.value)
    setItem(STORAGE_KEYS.keyBindings, keyBindings.value)
  }

  function loadSettings() {
    const savedMode = getItem(STORAGE_KEYS.controlMode) as ControlMode | null
    const savedBindings = getItem(STORAGE_KEYS.keyBindings) as KeyBindings | null

    // Restore saved custom bindings BEFORE setControlMode, so that
    // setControlMode('custom') finds _isCustom: true and doesn't
    // overwrite with defaults + persist them via saveSettings().
    if (savedBindings && savedBindings._isCustom) {
      keyBindings.value = savedBindings
    }

    if (savedMode && ['arrows', 'wasd', 'custom'].includes(savedMode)) {
      setControlMode(savedMode)
    }
  }

  // ============================================================
  //  RESET
  // ============================================================
  function resetToDefaults() {
    controlMode.value = 'arrows'
    keyBindings.value = { ...DEFAULT_BINDINGS.arrows }
    saveSettings()
  }

  // Load saved settings
  loadSettings()

  return {
    controlMode,
    keyBindings,
    isListening,
    listeningAction,
    setControlMode,
    startRebinding,
    finishRebinding,
    resetToDefaults,
  }
}
