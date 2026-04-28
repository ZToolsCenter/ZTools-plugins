export {}

const storage = new Map<string, string>()
const db = new Map<string, { _id: string; data: any }>()

const mockZtools: Window['ztools'] = {
  db: {
    put(doc: { _id: string; data: any }) {
      db.set(doc._id, doc)
    },
    get(id: string) {
      return db.get(id)
    },
    remove(id: string) {
      db.delete(id)
    },
  },
  dbStorage: {
    getItem(key: string) {
      return storage.get(key)
    },
    setItem(key: string, value: string) {
      storage.set(key, value)
    },
    removeItem(key: string) {
      storage.delete(key)
    },
  },
  copyText(text: string) {
    navigator.clipboard.writeText(text)
    console.log('[mock] copyText:', text)
    return true
  },
  showNotification(title: string, body: string) {
    console.log('[mock] notification:', title, body)
  },
  showToast(message: string) {
    console.log('[mock] toast:', message)
    const toast = document.createElement('div')
    toast.textContent = message
    Object.assign(toast.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      background: getComputedStyle(document.documentElement).getPropertyValue('--bg-card') || '#313145',
      color: getComputedStyle(document.documentElement).getPropertyValue('--text-primary') || '#cdd6f4', padding: '8px 16px',
      borderRadius: '8px', fontSize: '14px', zIndex: '9999',
    })
    document.body.appendChild(toast)
    setTimeout(() => toast.remove(), 2000)
  },
  hideMainWindow() {
    console.log('[mock] hideMainWindow')
  },
  resizeWindow(width: number, height: number) {
    console.log('[mock] resizeWindow:', width, height)
  },
  onPluginEnter(callback: (data: { code: string; type: string; payload: string }) => void) {
    console.log('[mock] onPluginEnter registered')
  },
  onPluginOut(callback: () => void) {
    console.log('[mock] onPluginOut registered')
  },
  setSubInput(callback: (data: { text: string }) => void, placeholder: string) {
    console.log('[mock] setSubInput:', placeholder)
  },
  shell: {
    openExternal(url: string) {
      window.open(url, '_blank')
    },
    openPath(path: string) {
      console.log('[mock] openPath:', path)
    },
  },
  isMacOS() { return false },
  isWindows() { return true },
}

if (!window.ztools) {
  ;(window as any).ztools = mockZtools
  console.log('[mock] ZTools API injected')
}
