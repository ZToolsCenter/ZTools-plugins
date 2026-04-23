function getApi() {
  if (typeof window === 'undefined' || !window.ztools) {
    throw new Error('ZTools API 不可用')
  }

  return window.ztools
}

function completeCopy(text, noticeMessage) {
  const api = getApi()
  api.copyText(text)
  api.outPlugin()
  api.hideMainWindow()

  if (noticeMessage) {
    api.showNotification(noticeMessage)
  }
}

function createListEntry(title, description, icon = 'logo.png') {
  return {
    title,
    description,
    icon,
  }
}

function renderList(setList, entries) {
  if (typeof setList === 'function') {
    setList(entries)
  }
}

function leaveLater(delay = 500) {
  setTimeout(() => {
    getApi().outPlugin()
  }, delay)
}

module.exports = {
  completeCopy,
  createListEntry,
  renderList,
  leaveLater,
}
