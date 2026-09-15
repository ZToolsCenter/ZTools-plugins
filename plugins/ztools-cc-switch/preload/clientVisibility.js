'use strict'

const STORAGE_KEY = 'cc-switch:visible-clients-v1'
const CLIENT_IDS = Object.freeze([
  'claude',
  'codex',
  'gemini',
  'opencode',
  'openclaw',
  'hermes',
  'grokbuild',
  'claude-desktop'
])

function createClientVisibilityManager({ storage }) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    throw new Error('客户端菜单显隐需要可用的 ZTools 存储')
  }

  function normalize(value, { strict = false } = {}) {
    if (!Array.isArray(value)) return [...CLIENT_IDS]
    const requested = [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
    const unknown = requested.filter((id) => !CLIENT_IDS.includes(id))
    if (strict && unknown.length) throw new Error(`未知客户端菜单：${unknown.join(', ')}`)
    const visible = CLIENT_IDS.filter((id) => requested.includes(id))
    if (!visible.length) {
      if (strict) throw new Error('请至少保留一个 AI 客户端菜单')
      return [...CLIENT_IDS]
    }
    return visible
  }

  function getVisibleClients() {
    return normalize(storage.getItem(STORAGE_KEY))
  }

  function setVisibleClients(ids) {
    const visible = normalize(ids, { strict: true })
    storage.setItem(STORAGE_KEY, visible)
    return visible
  }

  return { getVisibleClients, setVisibleClients }
}

module.exports = { CLIENT_IDS, STORAGE_KEY, createClientVisibilityManager }
