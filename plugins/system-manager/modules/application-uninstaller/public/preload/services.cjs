'use strict'

const { shell } = require('electron')
const { createEngine } = require('./core/engine.cjs')

function hostStorage() {
  const db = typeof window !== 'undefined' && window.ztools && window.ztools.dbStorage
  if (!db || typeof db.getItem !== 'function' || typeof db.setItem !== 'function') return null
  return {
    get: (key) => db.getItem(key),
    set: (key, value) => db.setItem(key, value),
    remove: (key) => typeof db.removeItem === 'function' ? db.removeItem(key) : db.setItem(key, null),
  }
}

const engine = createEngine({
  storage: hostStorage() || undefined,
  trashItem: (target) => shell.trashItem(target),
  revealItem: (target) => shell.showItemInFolder(target),
})

window.applicationUninstaller = Object.freeze({
  scanApps: () => engine.scanApps(),
  inspectApp: (appId) => engine.inspectApp(appId),
  executePlan: (request) => engine.executePlan(request),
  revealPath: (pathId) => engine.revealPath(pathId),
  // Lifecycle is coordinated by the suite root because ZTools exposes one
  // onPluginOut callback per renderer. Keep this internal method on the
  // frozen bridge so the root can drain module writes before teardown.
  shutdown: () => engine.shutdown(),
})
