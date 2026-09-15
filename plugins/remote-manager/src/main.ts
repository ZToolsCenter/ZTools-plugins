import { createApp } from 'vue'
import './main.css'
import App from './App.vue'

if (import.meta.env.DEV) {
  const hostsFile: any[] = []
  window.ztools = {
    onPluginEnter: (cb: any) => cb({ code: 'remote-manager' }),
    onPluginOut: () => {},
    hideMainWindow: () => {},
    showTip: () => {},
    getClipboardContent: () => '',
    getPath: (type: string) => type === 'userData' ? '.' : '.',
    isDarkColors: () => false,
    db: {
      allDocs: () => hostsFile,
      get: (id: string) => hostsFile.find((h: any) => h._id === id) || null,
      put: (doc: any) => {
        const idx = hostsFile.findIndex((h: any) => h._id === doc._id)
        if (idx !== -1) {
          hostsFile[idx] = { ...doc, _rev: doc._rev || '1' }
        } else {
          hostsFile.push({ ...doc, _rev: '1' })
        }
        return { ...doc, _rev: '1' }
      },
      remove: (id: string) => {
        const idx = hostsFile.findIndex((h: any) => h._id === id)
        if (idx !== -1) hostsFile.splice(idx, 1)
        return { ok: true }
      }
    }
  } as any
  window.services = {
    getHosts: () => window.ztools.db.allDocs().map((doc: any) => ({
      id: doc._id,
      address: doc.address,
      username: doc.username,
      password: doc.password,
      order: doc.order
    })).sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0)),
    addHost: (host: any) => {
      if (window.ztools.db.get(host.id)) {
        return { success: false, error: '编号已存在' }
      }
      const docs = window.ztools.db.allDocs()
      const maxOrder = docs.length > 0 ? Math.max(...docs.map((d: any) => d.order ?? 0)) : 0
      window.ztools.db.put({
        _id: host.id,
        address: host.address,
        username: host.username,
        password: btoa(host.password),
        order: maxOrder + 1
      })
      return { success: true }
    },
    updateHost: (id: string, host: any) => {
      const oldDoc = window.ztools.db.get(id)
      if (!oldDoc) {
        return { success: false, error: '主机不存在' }
      }
      if (host.id !== id && window.ztools.db.get(host.id)) {
        return { success: false, error: '编号已存在' }
      }
      if (host.id !== id) {
        window.ztools.db.remove(id)
      }
      window.ztools.db.put({
        _id: host.id,
        address: host.address,
        username: host.username,
        password: host.password === oldDoc.password ? host.password : btoa(host.password),
        order: host.order ?? oldDoc.order ?? 0
      })
      return { success: true }
    },
    deleteHost: (id: string) => {
      window.ztools.db.remove(id)
      return { success: true }
    },
    decryptPassword: (encrypted: string) => {
      try {
        return atob(encrypted)
      } catch {
        return ''
      }
    },
    updateOrder: (hosts: any[]) => {
      hosts.forEach((host: any, index: number) => {
        const doc = window.ztools.db.get(host.id)
        if (doc) {
          window.ztools.db.put({ ...doc, order: index + 1 })
        }
      })
      return { success: true }
    },
    connectRdp: () => ({ success: true }),
    readFile: () => '',
    writeTextFile: () => '',
    writeImageFile: () => ''
  } as any
}

createApp(App).mount('#app')
