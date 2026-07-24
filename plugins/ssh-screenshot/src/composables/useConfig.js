import { reactive, toRefs } from 'vue'

const STORAGE_KEY = 'ssh-screenshot.config.v1'

const DEFAULTS = {
  host: '',
  port: 22,
  username: '',
  password: '',
  remoteDir: ''
}

function readStored() {
  try {
    const raw = window.ztools?.dbStorage?.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return { ...DEFAULTS, ...parsed }
  } catch (e) {
    console.warn('[ssh-screenshot] read config failed', e)
    return { ...DEFAULTS }
  }
}

const state = reactive(readStored())

export function useConfig() {
  function save(next) {
    Object.assign(state, next)
    window.ztools?.dbStorage?.setItem(STORAGE_KEY, JSON.stringify({ ...state }))
  }

  function reset() {
    Object.assign(state, DEFAULTS)
    window.ztools?.dbStorage?.removeItem(STORAGE_KEY)
  }

  function isComplete() {
    return Boolean(state.host && state.username && state.remoteDir)
  }

  function snapshot() {
    return { ...state }
  }

  return {
    ...toRefs(state),
    save,
    reset,
    isComplete,
    snapshot
  }
}
