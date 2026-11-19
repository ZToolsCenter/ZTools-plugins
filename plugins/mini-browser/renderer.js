const CHROME_HEIGHT = 76
const tabs = document.getElementById('tabs')
const pages = document.getElementById('pages')
const status = document.getElementById('status')
const settings = document.getElementById('settings')
const settingList = document.getElementById('setting-list')
const empty = document.getElementById('empty')
const address = document.getElementById('address')
const views = new Map()
let bar = window.webAi.loadBar()
let current = window.webAi.loadLast()

function activeView() {
  return views.get(current) || null
}

function visibleItems() {
  return bar.filter((item) => item.enabled)
}

function findItem(id) {
  return bar.find((item) => item.id === id)
}

function showStatus(text) {
  status.textContent = text
  status.style.display = text ? 'block' : 'none'
}

function resizeView() {
  const height = Math.max(window.innerHeight - CHROME_HEIGHT, 240)
  views.forEach((view) => {
    view.style.width = window.innerWidth + 'px'
    view.style.height = height + 'px'
  })
}

function normalizeUrl(value) {
  const text = value.trim()
  if (!text) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text
  const host = text.split(/[/?#]/)[0]
  const isDomain = /^([\w-]+\.)+[a-z]{2,}(:\d+)?$/i.test(host)
  const isIpv4 = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(host)
  const isLocal = /^(localhost|\[?[0-9a-f:]*:[0-9a-f:]+\]?)(:\d+)?$/i.test(host)
  if (isDomain || isIpv4 || isLocal) return 'http://' + text
  return 'https://www.bing.com/search?q=' + encodeURIComponent(text)
}

function showAddress(url) {
  if (document.activeElement === address) return
  address.value = !url || url === 'about:blank' ? '' : url
}

function currentUrl() {
  const view = activeView()
  if (!view) return ''
  try {
    return view.getURL()
  } catch (error) {
    return view.getAttribute('src') || ''
  }
}

function ensureView(item) {
  let view = views.get(item.id)
  if (view) return view
  view = document.createElement('webview')
  view.dataset.id = item.id
  view.setAttribute('partition', 'persist:mini-browser')
  view.setAttribute('webpreferences', 'contextIsolation=no, javascript=yes')
  view.src = item.url
  view.addEventListener('dom-ready', () => {
    resizeView()
    view.executeJavaScript(`
      window.open = function (url) {
        if (url) location.href = url
        return null
      }
      document.addEventListener('click', function (event) {
        var link = event.target && event.target.closest && event.target.closest('a[target="_blank"]')
        if (!link || !link.href) return
        event.preventDefault()
        location.href = link.href
      }, true)
    `).catch(() => {})
  })
  view.addEventListener('did-start-loading', () => {
    if (view.dataset.id === current) showStatus('正在打开…')
  })
  view.addEventListener('did-navigate', (event) => {
    if (view.dataset.id === current) showAddress(event.url)
  })
  view.addEventListener('did-navigate-in-page', (event) => {
    if (view.dataset.id === current) showAddress(event.url)
  })
  view.addEventListener('did-stop-loading', () => {
    resizeView()
    if (view.dataset.id === current) {
      showAddress(currentUrl())
      showStatus('')
    }
  })
  view.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3 || view.dataset.id !== current) return
    showStatus('页面没有打开：' + (event.errorDescription || event.errorCode) + '。可点右上角 ↗ 用系统浏览器打开。')
  })
  pages.appendChild(view)
  views.set(item.id, view)
  resizeView()
  return view
}

function showOnly(id) {
  views.forEach((view, viewId) => {
    view.classList.toggle('active', viewId === id)
  })
}

function showEmpty(visible) {
  empty.hidden = !visible
}

function open(id, url) {
  const item = findItem(id) || visibleItems()[0]
  if (!item || !item.enabled) {
    current = ''
    showOnly('')
    showEmpty(true)
    showAddress('')
    return
  }
  current = item.id
  window.webAi.saveLast(item.id)
  showEmpty(false)
  const view = ensureView(item)
  document.querySelectorAll('#tabs button').forEach((button) => {
    button.classList.toggle('active', button.dataset.id === item.id)
  })
  showOnly(item.id)
  const target = url || ''
  if (target && currentUrl() !== target) {
    showAddress(target)
    view.loadURL(target)
  } else {
    showAddress(currentUrl() || item.url)
  }
  resizeView()
}

function renderTabs() {
  const items = visibleItems()
  tabs.textContent = ''
  items.forEach((item) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.id = item.id
    button.textContent = item.name
    button.addEventListener('click', () => open(item.id))
    tabs.appendChild(button)
  })
  if (!findItem(current) || !findItem(current).enabled) {
    current = items[0] ? items[0].id : ''
  }
}

function persist(next) {
  const previous = new Set(bar.map((item) => item.id))
  bar = window.webAi.saveBar(next)
  const alive = new Set(bar.map((item) => item.id))
  previous.forEach((id) => {
    if (alive.has(id)) return
    const view = views.get(id)
    if (view) view.remove()
    views.delete(id)
  })
  renderTabs()
  renderSettings()
  if (!findItem(current) || !findItem(current).enabled) open(current)
}

function move(index, offset) {
  const target = index + offset
  if (target < 0 || target >= bar.length) return
  const next = bar.slice()
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  persist(next)
}

function renderSettings() {
  settingList.textContent = ''
  if (!bar.length) {
    const hint = document.createElement('p')
    hint.textContent = '还没有标签页。在下面添加后会出现在顶栏。'
    settingList.append(hint)
    return
  }
  bar.forEach((item, index) => {
    const row = document.createElement('div')
    row.className = 'row'

    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = item.enabled
    check.addEventListener('change', () => {
      const next = bar.slice()
      next[index] = Object.assign({}, item, { enabled: check.checked })
      persist(next)
    })

    const label = document.createElement('label')
    const title = document.createElement('span')
    title.textContent = item.name
    const url = document.createElement('small')
    url.textContent = item.url
    label.append(title, url)

    const up = document.createElement('button')
    up.type = 'button'
    up.className = 'move'
    up.textContent = '↑'
    up.disabled = index === 0
    up.addEventListener('click', () => move(index, -1))

    const down = document.createElement('button')
    down.type = 'button'
    down.className = 'move'
    down.textContent = '↓'
    down.disabled = index === bar.length - 1
    down.addEventListener('click', () => move(index, 1))

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'move'
    remove.textContent = '×'
    remove.addEventListener('click', () => {
      persist(bar.filter((entry) => entry.id !== item.id))
    })

    row.append(check, label, up, down, remove)
    settingList.append(row)
  })
}

function goAddress() {
  const target = normalizeUrl(address.value)
  if (!target) return
  const item = findItem(current)
  if (!item) {
    document.getElementById('add-url').value = target
    settings.classList.add('open')
    document.getElementById('add-name').focus()
    return
  }
  showEmpty(false)
  showAddress(target)
  const view = ensureView(item)
  if (currentUrl() !== target) view.loadURL(target)
}

document.getElementById('address-form').addEventListener('submit', (event) => {
  event.preventDefault()
  goAddress()
})

address.addEventListener('focus', () => address.select())

document.getElementById('back').addEventListener('click', () => {
  const view = activeView()
  if (view && view.canGoBack()) view.goBack()
})

document.getElementById('reload').addEventListener('click', () => {
  const view = activeView()
  if (view && currentUrl() && currentUrl() !== 'about:blank') view.reload()
})

document.getElementById('external').addEventListener('click', () => {
  const url = currentUrl()
  if (url && url !== 'about:blank') window.ztools.shellOpenExternal(url)
})

function closeSettings() {
  settings.classList.remove('open')
  open(current)
}

document.getElementById('settings-open').addEventListener('click', () => {
  if (settings.classList.contains('open')) {
    closeSettings()
    return
  }
  settings.classList.add('open')
  renderSettings()
})

document.getElementById('settings-close').addEventListener('click', closeSettings)

document.getElementById('empty-add').addEventListener('click', () => {
  settings.classList.add('open')
  renderSettings()
  document.getElementById('add-name').focus()
})

document.getElementById('add-site').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.getElementById('add-url').value.trim()
  const url = normalizeUrl(input)
  if (!url || url.includes('bing.com/search')) return
  let name = document.getElementById('add-name').value.trim()
  if (!name) {
    try {
      name = new URL(url).hostname.replace(/^www\./, '')
    } catch (error) {
      name = input
    }
  }
  name = name.slice(0, 24)
  const id = 'custom-' + Date.now()
  persist(bar.concat({ id, name, url, enabled: true }))
  current = id
  event.target.reset()
  settings.classList.remove('open')
  open(id, url)
})

window.addEventListener('resize', resizeView)

window.addEventListener('mini-browser-open', () => open(current))

renderTabs()
renderSettings()
open(current)

if (window.ztools && window.ztools.setExpendHeight) {
  window.ztools.setExpendHeight(640)
}
