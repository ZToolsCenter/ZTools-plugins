'use strict'

const { createLanScanner } = require('./network/scanner.cjs')

const scanner = createLanScanner()

function hostApi() {
  return typeof window !== 'undefined' && window.ztools ? window.ztools : null
}

async function copyText(text) {
  if (typeof text !== 'string' || text.length > 4096) return false
  const api = hostApi()
  if (!api || typeof api.copyText !== 'function') return false
  try {
    return api.copyText(text) !== false
  } catch {
    return false
  }
}

window.lanDiscovery = Object.freeze({
  listInterfaces: scanner.listInterfaces,
  scan: scanner.scan,
  cancelScan: scanner.cancelScan,
  copyText,
})
