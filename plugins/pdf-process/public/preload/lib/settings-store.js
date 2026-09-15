/**
 * Settings schema + sanitize. Single authority for pdf-settings payload.
 */
const { isSafeExternalUrl } = require('../path-guard')

const SETTINGS_KEY = 'pdf-settings'

/** Only fields we intentionally persist. */
function sanitizeSettings(raw) {
  const out = {}
  if (!raw || typeof raw !== 'object') return out

  if (raw.webConvertLinks && typeof raw.webConvertLinks === 'object') {
    const formats = ['word', 'excel', 'ppt']
    const links = {}
    for (const f of formats) {
      const list = raw.webConvertLinks[f]
      if (!Array.isArray(list)) continue
      links[f] = list
        .filter((item) => item && typeof item.name === 'string' && typeof item.url === 'string')
        .map((item) => ({ name: item.name.trim(), url: item.url.trim() }))
        .filter((item) => item.name && item.url && isSafeExternalUrl(item.url))
    }
    out.webConvertLinks = links
  }
  return out
}

function loadSettings(dbStorage) {
  const raw = dbStorage.getItem(SETTINGS_KEY)
  let parsed = raw
  if (raw && typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  return sanitizeSettings(parsed)
}

function saveSettings(dbStorage, settings) {
  const cleaned = sanitizeSettings(settings)
  dbStorage.setItem(SETTINGS_KEY, JSON.stringify(cleaned))
  return cleaned
}

module.exports = {
  SETTINGS_KEY,
  sanitizeSettings,
  loadSettings,
  saveSettings,
}
