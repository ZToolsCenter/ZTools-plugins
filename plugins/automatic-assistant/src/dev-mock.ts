// 仅开发预览使用的 ZTools 环境模拟；生产构建时通过 import.meta.env.DEV 摇除
export function installDevMock() {
  const docs: Record<string, Record<string, unknown>> = {}
  const features: Record<string, unknown> = {}
  const noop = () => {}
  const scriptCache: Record<string, string> = {}

  const api = {
    onPluginEnter(cb: (a: unknown) => void) {
      ;(window as unknown as Record<string, unknown>).__enterCb = cb
      setTimeout(() => cb({ code: 'setting', type: 'text', payload: '', option: {}, from: 'main' }), 30)
    },
    onPluginReady: (cb: () => void) => setTimeout(cb, 0),
    onPluginOut: noop,
    isDarkColors: () => false,
    isWindows: () => true,
    isMacOS: () => false,
    isMacOs: () => false,
    isLinux: () => false,
    setExpendHeight: noop,
    removeSubInput: noop,
    setSubInput: noop,
    showNotification: (m: string) => console.log('[notify]', m),
    hideMainWindow: () => {
      ;(window as unknown as Record<string, unknown>).__winLog =
        [...(((window as unknown as Record<string, unknown>).__winLog as string[]) || []), 'hide']
    },
    showMainWindow: () => {
      ;(window as unknown as Record<string, unknown>).__winLog =
        [...(((window as unknown as Record<string, unknown>).__winLog as string[]) || []), 'show']
    },
    outPlugin: () => {
      ;(window as unknown as Record<string, unknown>).__winLog =
        [...(((window as unknown as Record<string, unknown>).__winLog as string[]) || []), 'out']
    },
    redirect: (label: unknown) => {
      console.log('[redirect]', label)
      return true
    },
    getFeatures: () => Object.values(features),
    setFeature: (f: { code: string }) => {
      features[f.code] = JSON.parse(JSON.stringify(f))
      return true
    },
    removeFeature: (code: string) => {
      delete features[code]
      return true
    },
    copyText: () => true,
    db: {
      put(doc: { _id: string; _rev?: string }) {
        const rev = String((parseInt(String(doc._rev || '0')) || 0) + 1) + '-mock'
        docs[doc._id] = { ...JSON.parse(JSON.stringify(doc)), _rev: rev }
        return { id: doc._id, rev, ok: true }
      },
      get: (id: string) => docs[id] || null,
      remove(d: string | { _id: string }) {
        const id = typeof d === 'string' ? d : d._id
        delete docs[id]
        return { id, ok: true }
      },
      allDocs: (prefix: string) =>
        Object.values(docs).filter((x) => !prefix || String(x._id).startsWith(prefix))
    },
    dbStorage: {
      setItem: (k: string, v: unknown) => localStorage.setItem('dbs_' + k, JSON.stringify(v)),
      getItem: (k: string) => {
        const v = localStorage.getItem('dbs_' + k)
        return v === null ? null : JSON.parse(v)
      },
      removeItem: (k: string) => localStorage.removeItem('dbs_' + k)
    }
  }

  ;(window as unknown as Record<string, unknown>).ztools = api
  ;(window as unknown as Record<string, unknown>).platform = 'win32'
  ;(window as unknown as Record<string, unknown>).services = {
    async vmRunScript(_code: string, _enter: unknown, print: (m: unknown) => void) {
      print('模拟输出：脚本已执行')
      await new Promise((r) => setTimeout(r, 500))
      return '模拟返回值'
    },
    getInsetScript(name: string) {
      if (scriptCache[name] !== undefined) return scriptCache[name]
      const xhr = new XMLHttpRequest()
      xhr.open('GET', '/preload/scripts/' + name + '.js_', false)
      try {
        xhr.send()
        scriptCache[name] = xhr.status === 200 ? xhr.responseText : ''
      } catch {
        scriptCache[name] = ''
      }
      return scriptCache[name] || null
    }
  }
}
