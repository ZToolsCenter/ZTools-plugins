const svc = window.services || {}

const state = {
  all: [],
  rows: [],
  keyword: '',
  sort: 'mem',
  selected: 0,
  loading: false,
  portWarning: null,
  autoRefresh: true,
  selectedPid: null
}

const $ = sel => document.querySelector(sel)
const listEl = $('#list')
const searchEl = $('#search')
const bannerEl = $('#banner')
const emptyEl = $('#empty')
const summaryEl = $('#summary')
const menuEl = $('#menu')
const toastEl = $('#toast')

const RENDER_LIMIT = 400

function fmtMem(rss) {
  const mb = rss / 1024
  return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'
}

function sortRows(rows, by) {
  const copy = rows.slice()
  if (by === 'name') copy.sort((a, b) => a.name.localeCompare(b.name))
  else if (by === 'cpu') copy.sort((a, b) => b.cpu - a.cpu)
  else if (by === 'ports') copy.sort((a, b) => b.portCount - a.portCount || b.mem - a.mem)
  else copy.sort((a, b) => b.mem - a.mem)
  return copy
}

function matches(p, keyword) {
  if (!keyword) return true
  const kw = keyword.toLowerCase()
  if (/^\d+$/.test(kw)) {
    if (String(p.pid).includes(kw)) return true
    if (p.listen.some(x => String(x).includes(kw))) return true
    if (p.conn.some(x => String(x).includes(kw))) return true
  }
  return p.name.toLowerCase().includes(kw) || p.path.toLowerCase().includes(kw)
}

function applyFilter() {
  const filtered = state.all.filter(p => matches(p, state.keyword))
  state.rows = sortRows(filtered, state.sort)
  if (state.selectedPid != null) {
    const idx = state.rows.findIndex(p => p.pid === state.selectedPid)
    if (idx >= 0) state.selected = idx
  }
  if (state.selected >= state.rows.length) state.selected = Math.max(0, state.rows.length - 1)
  render()
}

async function loadIcons() {
  const seen = new Set()
  for (const row of state.rows.slice(0, RENDER_LIMIT)) {
    if (!row.app || seen.has(row.app)) continue
    seen.add(row.app)
    svc.icon(row.app).then(icon => {
      if (!icon) return
      document.querySelectorAll('[data-app="' + CSS.escape(row.app) + '"]').forEach(img => {
        img.src = icon
        img.classList.remove('placeholder')
      })
    })
  }
}

function rowHtml(p, index) {
  const ports = p.listen.length ? p.listen.join(', ') : (p.conn.length ? p.conn.length + ' 连接' : '')
  return '<div class="row' + (index === state.selected ? ' selected' : '') + '" data-index="' + index + '" data-pid="' + p.pid + '">' +
    '<span class="col-name">' +
      '<img class="icon placeholder" data-app="' + (p.app || '') + '" alt="" />' +
      '<span class="name-wrap"><span class="name">' + escapeHtml(p.name) + '</span>' +
      '<span class="path" title="' + escapeHtml(p.path) + '">' + escapeHtml(p.path) + '</span></span>' +
    '</span>' +
    '<span class="col-pid">' + p.pid + '</span>' +
    '<span class="col-port' + (p.listen.length ? ' has-port' : '') + '" title="' + escapeHtml(ports) + '">' + escapeHtml(ports) + '</span>' +
    '<span class="col-cpu">' + (p.cpu ? p.cpu.toFixed(1) + '%' : '-') + '</span>' +
    '<span class="col-mem">' + fmtMem(p.rss) + '</span>' +
  '</div>'
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function render() {
  const shown = state.rows.slice(0, RENDER_LIMIT)
  listEl.innerHTML = shown.map(rowHtml).join('')
  emptyEl.hidden = shown.length > 0
  summaryEl.textContent = state.loading
    ? '正在读取进程…'
    : state.rows.length + ' 个进程' + (state.rows.length > RENDER_LIMIT ? '（显示前 ' + RENDER_LIMIT + ' 个）' : '')
  bannerEl.hidden = !state.portWarning
  if (state.portWarning) bannerEl.textContent = state.portWarning
  loadIcons()
  const sel = listEl.querySelector('.row.selected')
  if (sel) sel.scrollIntoView({ block: 'nearest' })
}

function select(index) {
  if (!state.rows.length) return
  state.selected = Math.max(0, Math.min(index, state.rows.length - 1))
  state.selectedPid = state.rows[state.selected] ? state.rows[state.selected].pid : null
  render()
}

async function refresh() {
  if (state.loading) return
  state.loading = true
  summaryEl.textContent = '正在读取进程…'
  try {
    const data = await svc.snapshot()
    state.all = data.processes || []
    state.portWarning = data.portWarning || (data.error ? '读取失败：' + data.error : null)
  } catch (e) {
    // loading 不复位的话，之后每次刷新都会被上面的判断挡掉
    state.portWarning = '读取失败：' + (e && e.message ? e.message : e)
  } finally {
    state.loading = false
  }
  applyFilter()
}

let toastTimer = null
function toast(msg) {
  toastEl.textContent = msg
  toastEl.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.hidden = true }, 2200)
}

const REASON = {
  permission: '权限不足，无法关闭该进程',
  gone: '进程已退出',
  self: '不能关闭插件自身',
  still_alive: '进程未响应关闭请求，可再试强制结束',
  invalid_pid: '无效的进程号',
  failed: '操作失败',
  not_an_app: '该进程不是 .app / .exe，不支持重启',
  spawn_failed: '启动失败'
}

// 杀进程前必须人工确认，避免回车误杀
function confirmKill(proc, force) {
  return new Promise(resolve => {
    const box = $('#confirm')
    $('#confirm-title').textContent = force ? '确认强制结束进程' : '确认关闭进程'
    // 两种机制的说明都写上：Windows 上是 WM_CLOSE / TerminateProcess
    $('#confirm-body').textContent = proc.name + '  ·  PID ' + proc.pid + '\n' + (proc.path || '（读取不到完整路径）') +
      (force ? '\n\n强制结束会立即终止进程，不会给进程保存的机会。' : '\n\n只发送关闭请求，进程可以拒绝；3 秒未退出可再尝试强制结束。')
    $('#confirm-ok').textContent = force ? '确认强制结束' : '确认关闭'
    box.hidden = false

    const done = ok => {
      box.hidden = true
      $('#confirm-ok').onclick = null
      $('#confirm-cancel').onclick = null
      box.onclick = null
      document.removeEventListener('keydown', onKey, true)
      resolve(ok)
    }
    const onKey = e => {
      if (box.hidden) return
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) }
    }
    $('#confirm-ok').onclick = () => done(true)
    $('#confirm-cancel').onclick = () => done(false)
    box.onclick = e => { if (e.target === box) done(false) }
    // 捕获阶段拦截，避免回车穿透到列表的关闭逻辑
    document.addEventListener('keydown', onKey, true)
    $('#confirm-cancel').focus()
  })
}

async function doKill(proc, force) {
  if (!(await confirmKill(proc, force))) return
  const rowEl = listEl.querySelector('.row[data-pid="' + proc.pid + '"]')
  if (rowEl) rowEl.classList.add('removing')
  const result = force ? await svc.forceKill(proc.pid) : await svc.kill(proc.pid)
  if (result && result.ok) {
    // WM_CLOSE 是请对方自己退，对方可能选择不退，提示里说清楚
    const how = result.signal === 'WM_CLOSE' ? '已请求关闭' : '已关闭'
    toast(how + ' ' + proc.name + '（' + (result.signal || 'SIGKILL') + '）')
    await refresh()
  } else {
    if (rowEl) rowEl.classList.remove('removing')
    toast(REASON[result && result.reason] || '关闭失败')
  }
}

async function doRestart(proc) {
  const box = $('#confirm')
  $('#confirm-title').textContent = '确认重启进程'
  $('#confirm-body').textContent = proc.name + '  ·  PID ' + proc.pid + '\n' + (proc.path || '（读取不到完整路径）') + '\n\n将先关闭再重新启动。'
  $('#confirm-ok').textContent = '确认重启'
  if (!(await new Promise(resolve => {
    box.hidden = false
    const done = ok => {
      box.hidden = true
      $('#confirm-ok').onclick = null
      $('#confirm-cancel').onclick = null
      box.onclick = null
      document.removeEventListener('keydown', onKey, true)
      resolve(ok)
    }
    const onKey = e => {
      if (box.hidden) return
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false) }
    }
    $('#confirm-ok').onclick = () => done(true)
    $('#confirm-cancel').onclick = () => done(false)
    box.onclick = e => { if (e.target === box) done(false) }
    document.addEventListener('keydown', onKey, true)
    $('#confirm-cancel').focus()
  }))) return
  const stopped = await svc.kill(proc.pid)
  if (stopped && stopped.ok) {
    const result = await svc.restart(proc.pid, { app: proc.app })
    toast(result && result.ok ? '已重启 ' + proc.name : '已关闭，但重启失败：' + (REASON[result && result.reason] || ''))
  } else if (stopped && stopped.reason === 'gone') {
    const result = await svc.restart(proc.pid, { app: proc.app })
    toast(result && result.ok ? '已重启 ' + proc.name : '重启失败：' + (REASON[result && result.reason] || ''))
  } else {
    toast(REASON[stopped && stopped.reason] || '关闭失败')
  }
  await refresh()
}

async function showDetail(proc) {
  $('#dialog-title').textContent = proc.name + '  ·  PID ' + proc.pid
  const detail = await svc.detail(proc.pid)
  const lines = [
    '路径: ' + proc.path,
    '启动命令: ' + (detail.command || '（无）'),
    '用户: ' + proc.user,
    '父进程: ' + proc.ppid,
    '内存: ' + fmtMem(proc.rss) + '（' + proc.mem.toFixed(1) + '%）',
    // Windows 的 CPU 是采样差值，别标“累计值”
    'CPU: ' + (proc.cpu ? proc.cpu.toFixed(1) + '%' + (svc.platform === 'win32' ? '' : '（累计值）') : '-'),
    '监听端口: ' + (proc.listen.join(', ') || '无'),
    '已建立连接端口: ' + (proc.conn.join(', ') || '无'),
    '应用包: ' + (proc.app || (svc.platform === 'win32' ? '无（按启动命令重启）' : '非 .app'))
  ]
  $('#dialog-body').textContent = lines.join('\n')
  $('#dialog').hidden = false
}

function hideDialog() { $('#dialog').hidden = true }

function copyPath(proc) {
  const ok = svc.copy(proc.path)
  toast(ok ? '已复制路径' : '复制失败')
}

function reveal(proc) {
  svc.reveal(proc.app || proc.path)
}

function openMenu(x, y, proc) {
  menuEl.innerHTML = [
    '<button data-act="kill" class="danger">关闭进程</button>',
    '<button data-act="force" class="danger">强制结束</button>',
    '<button data-act="restart">重启进程</button>',
    '<div class="sep"></div>',
    '<button data-act="detail">查看详情</button>',
    '<button data-act="copy">复制路径</button>',
    '<button data-act="reveal">在文件夹中显示</button>'
  ].join('')
  menuEl.hidden = false
  const rect = menuEl.getBoundingClientRect()
  menuEl.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px'
  menuEl.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px'
  menuEl._proc = proc
}

function closeMenu() { menuEl.hidden = true }

function selectedProc() { return state.rows[state.selected] }

function currentProcFromMenu() { return menuEl._proc }

document.addEventListener('click', e => {
  if (!menuEl.hidden && !menuEl.contains(e.target)) closeMenu()
})

menuEl.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]')
  if (!btn) return
  const proc = currentProcFromMenu()
  if (!proc) return
  closeMenu()
  const act = btn.dataset.act
  if (act === 'kill') await doKill(proc, false)
  else if (act === 'force') await doKill(proc, true)
  else if (act === 'restart') await doRestart(proc)
  else if (act === 'detail') await showDetail(proc)
  else if (act === 'copy') copyPath(proc)
  else if (act === 'reveal') reveal(proc)
})

listEl.addEventListener('click', e => {
  const row = e.target.closest('.row')
  if (!row) return
  state.selected = Number(row.dataset.index)
  state.selectedPid = state.rows[state.selected] ? state.rows[state.selected].pid : null
  render()
})

listEl.addEventListener('contextmenu', e => {
  const row = e.target.closest('.row')
  if (!row) return
  e.preventDefault()
  const index = Number(row.dataset.index)
  state.selected = index
  state.selectedPid = state.rows[index] ? state.rows[index].pid : null
  render()
  openMenu(e.clientX, e.clientY, state.rows[index])
})

listEl.addEventListener('dblclick', e => {
  const row = e.target.closest('.row')
  if (!row) return
  showDetail(state.rows[Number(row.dataset.index)])
})

searchEl.addEventListener('input', () => {
  state.keyword = searchEl.value.trim()
  state.selected = 0
  state.selectedPid = null
  applyFilter()
})

document.querySelectorAll('#sorts button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#sorts button').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    state.sort = btn.dataset.sort
    state.rows = sortRows(state.rows, state.sort)
    state.selected = 0
    render()
  })
})

// 自动刷新：搜索中或选择中不动列表，避免打断操作
const AUTO_MS = 3000
let autoTimer = null

function applyAutoRefresh(on) {
  state.autoRefresh = on
  const btn = $('#refresh')
  btn.classList.toggle('auto', on)
  btn.title = on ? '自动刷新中，点击改为手动（Ctrl/⌘+R 随时刷新）' : '手动刷新，点击开启自动刷新（Ctrl/⌘+R 随时刷新）'
  clearInterval(autoTimer)
  autoTimer = on ? setInterval(refresh, AUTO_MS) : null
}

$('#refresh').addEventListener('click', () => applyAutoRefresh(!state.autoRefresh))
$('#dialog-close').addEventListener('click', hideDialog)
$('#dialog').addEventListener('click', e => { if (e.target.id === 'dialog') hideDialog() })

document.addEventListener('keydown', async e => {
  if (!$('#confirm').hidden) return
  if (!$('#dialog').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); hideDialog() }
    return
  }
  if (e.key === 'ArrowDown') { e.preventDefault(); select(state.selected + 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); select(state.selected - 1) }
  else if (e.key === 'Enter') {
    const proc = selectedProc()
    if (!proc) return
    e.preventDefault()
    if (e.metaKey || e.ctrlKey) await doRestart(proc)
    else if (e.shiftKey) await showDetail(proc)
    else await doKill(proc, false)
  } else if (e.key === 'Escape') {
    closeMenu()
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
    e.preventDefault(); refresh()
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && selectedProc()) {
    const active = document.activeElement
    if (active === searchEl) return
    copyPath(selectedProc())
  }
})

const ztools = window.ztools || window.utools
if (ztools && typeof ztools.onPluginEnter === 'function') {
  ztools.onPluginEnter(() => {
    searchEl.focus()
    refresh()
  })
}

// Windows 键位：Ctrl+Enter 重启、Ctrl+R 刷新、Ctrl+C 复制；提示栏跟着换
if (svc.platform === 'win32') $('.hint').textContent = '↑↓ 选择 · ⏎ 关闭 · Ctrl+⏎ 重启 · Shift+⏎ 详情 · Ctrl+C 复制路径'

applyAutoRefresh(state.autoRefresh)
refresh()
