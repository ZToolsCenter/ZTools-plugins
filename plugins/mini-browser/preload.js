const BAR_KEY = 'mini-browser:bar'
const LAST_KEY = 'mini-browser:last'

function normalizeBar(raw) {
  const source = Array.isArray(raw) ? raw : []
  const seen = new Set()
  const items = []
  source.forEach((item) => {
    if (!item || item.builtin || seen.has(item.id)) return
    if (!/^https?:\/\//i.test(item.url || '')) return
    seen.add(item.id)
    items.push({
      id: String(item.id),
      name: String(item.name || item.url).slice(0, 24),
      url: item.url,
      enabled: item.enabled !== false
    })
  })
  return items
}

function loadBar() {
  try {
    const saved = window.ztools.dbStorage.getItem(BAR_KEY)
    if (saved) return normalizeBar(JSON.parse(saved))
  } catch (error) {
    console.warn('[mini-browser] 读取顶栏失败', error)
  }
  return []
}

function saveBar(items) {
  const next = normalizeBar(items)
  window.ztools.dbStorage.setItem(BAR_KEY, JSON.stringify(next))
  return next
}

function loadLast() {
  try {
    return window.ztools.dbStorage.getItem(LAST_KEY) || ''
  } catch (error) {
    return ''
  }
}

function saveLast(id) {
  try {
    window.ztools.dbStorage.setItem(LAST_KEY, id || '')
  } catch (error) {
    console.warn('[mini-browser] 保存上次打开失败', error)
  }
}

window.webAi = {
  loadBar,
  saveBar,
  loadLast,
  saveLast
}

window.ztools.onPluginEnter(() => {
  window.dispatchEvent(new CustomEvent('mini-browser-open'))
})
