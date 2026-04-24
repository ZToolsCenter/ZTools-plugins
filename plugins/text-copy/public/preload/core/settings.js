const STORAGE_KEY = 'text-copy.settings'
const LEGACY_NOTICE_KEY = 'copyTextNotice'

function getStorageApi() {
  return window.ztools.dbStorage
}

function getLegacyDbApi() {
  return window.ztools.db
}

function normalizeSettings(value) {
  return {
    notificationEnabled: Boolean(
      value &&
        (value.notificationEnabled ?? value.notifyAfterCopy ?? value.noticeEnabled ?? false)
    ),
  }
}

function readStoredSettings() {
  try {
    return getStorageApi().getItem(STORAGE_KEY)
  } catch {
    return undefined
  }
}

function readLegacyNotificationFlag() {
  try {
    const legacyRecord = getLegacyDbApi().get(LEGACY_NOTICE_KEY)
    if (!legacyRecord) {
      return null
    }

    return legacyRecord.data === '开'
  } catch {
    return null
  }
}

function saveSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings)
  getStorageApi().setItem(STORAGE_KEY, normalized)
  return normalized
}

function loadSettings() {
  const stored = readStoredSettings()
  if (stored && typeof stored === 'object') {
    return normalizeSettings(stored)
  }

  const legacyNotificationFlag = readLegacyNotificationFlag()
  if (legacyNotificationFlag !== null) {
    return saveSettings({ notificationEnabled: legacyNotificationFlag })
  }

  return { notificationEnabled: false }
}

function isNotificationEnabled() {
  return loadSettings().notificationEnabled
}

function setNotificationEnabled(enabled) {
  return saveSettings({ notificationEnabled: Boolean(enabled) })
}

function toggleNotificationEnabled() {
  return setNotificationEnabled(!isNotificationEnabled())
}

function toStatusText(enabled) {
  return enabled ? '开' : '关'
}

module.exports = {
  isNotificationEnabled,
  toggleNotificationEnabled,
  toStatusText,
}
