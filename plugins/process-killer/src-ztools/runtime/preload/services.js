const collector = require('./collector')
const actions = require('./actions')

const z = () => window.ztools || window.utools

const iconCache = new Map()

function iconFor(app) {
  if (!app) return null
  if (iconCache.has(app)) return iconCache.get(app)
  const icon = actions.iconOf(app)
  iconCache.set(app, icon)
  return icon
}

function safe(fn, fallback) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      return typeof fallback === 'function' ? fallback(e) : fallback
    }
  }
}

window.services = {
  platform: process.platform,

  snapshot: safe(() => collector.snapshot(), e => ({ processes: [], portWarning: null, error: e.message })),

  detail: safe(async pid => ({ pid, command: await actions.commandLine(pid) }), { command: '' }),

  icon: safe(async app => iconFor(app), null),

  kill: safe(pid => actions.kill(pid), e => ({ ok: false, reason: 'failed', error: e.message })),

  forceKill: safe(pid => actions.forceKill(pid), e => ({ ok: false, reason: 'failed', error: e.message })),

  restart: safe((pid, info) => actions.restart(pid, info), e => ({ ok: false, reason: 'failed', error: e.message })),

  copy: text => { try { z().copyText(String(text)); return true } catch (e) { return false } },

  reveal: fullPath => { try { z().shellShowItemInFolder(fullPath); return true } catch (e) { return false } },

  notify: text => { try { z().showNotification(String(text)) } catch (e) { /* ignore */ } }
}
