type EnterAction = {
  code: string
  type: string
  payload: unknown
  option: unknown
}

const enterCallbacks: Array<(action: EnterAction) => void> = []
const outCallbacks: Array<(processExit: boolean) => void> = []

export let isZtoolsMocked = false

export function setupZtoolsFallback() {
  if (window.ztools) return

  isZtoolsMocked = true

  window.ztools = {
    onPluginEnter(callback) {
      enterCallbacks.push(callback)
    },
    onPluginOut(callback) {
      outCallbacks.push(callback)
    },
    copyText(text) {
      void navigator.clipboard.writeText(text)
      return true
    },
    showNotification(body) {
      console.log('[ztools mock]', body)
    },
    showOpenDialog() {
      console.warn('[ztools mock] showOpenDialog 仅在 ZTools 中可用')
      return null
    }
  } as unknown as typeof window.ztools

  window.services = {
    readFile() {
      throw new Error('readFile 仅在 ZTools 中可用')
    },
    writeTextFile() {
      throw new Error('writeTextFile 仅在 ZTools 中可用')
    },
    writeImageFile() {
      throw new Error('writeImageFile 仅在 ZTools 中可用')
    }
  }
}

export function enterFeature(code: string) {
  const action = { code, type: 'text', payload: null, option: null }
  enterCallbacks.forEach((callback) => callback(action))
}

export function exitFeature() {
  outCallbacks.forEach((callback) => callback(false))
}

export function getDevRouteFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('code')
}

// 兼容旧命名
export const devEnterFeature = enterFeature
export const devExitFeature = exitFeature
export const setupDevZtoolsMock = setupZtoolsFallback
