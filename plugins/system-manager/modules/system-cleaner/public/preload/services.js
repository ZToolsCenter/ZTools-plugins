'use strict'

const os = require('node:os')
const { shell } = require('electron')
const { createCleaner } = require('./core.cjs')
const { platformRoots } = require('./roots.cjs')

function trustedHome() {
  try {
    const value = os.userInfo().homedir
    if (value) return value
  } catch {}
  return os.homedir()
}

const home = trustedHome()
const roots = platformRoots(process.platform, { home, temp: os.tmpdir() })
const tempRoot = roots.find((item) => item.id === 'user-temp')?.path || null
const cleaner = createCleaner({
  home,
  tempRoot,
  roots,
  uid: typeof process.getuid === 'function' ? process.getuid() : null,
  trashItem: (targetPath) => shell.trashItem(targetPath)
})

function ztoolsApi() {
  return typeof window !== 'undefined' && window.ztools ? window.ztools : null
}

async function reveal(request = {}) {
  const targetPath = cleaner.resolveCandidate(request.snapshotId, request.candidateId)
  shell.showItemInFolder(targetPath)
  return true
}

async function copyText(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) return false
  const api = ztoolsApi()
  if (!api || typeof api.copyText !== 'function') return false
  try {
    return api.copyText(text) !== false
  } catch {
    return false
  }
}

window.systemCleaner = Object.freeze({
  scan: cleaner.scan,
  cancelScan: cleaner.cancelScan,
  clean: cleaner.clean,
  reveal,
  copyText
})
