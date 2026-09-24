const SLOTS_KEY = 'ideadock.slots'
const PINNED_KEY = 'ideadock.pinned'
const TODO_KEY = 'ideadock.todos'
const TODO_REMINDER_KEY = 'ideadock.todoReminders'
const DEFAULT_COLOR = '#fdf5b8'
const SYNC_POLL_INTERVAL = 500

function getDbStorage() {
  return window.ideadockHost.storage
}

function storeGet(key) {
  const db = getDbStorage()
  if (!db || typeof db.getItem !== 'function') return null
  try {
    const value = db.getItem(key)
    return value !== undefined ? value : null
  } catch {
    return null
  }
}

function storeSet(key, value) {
  const db = getDbStorage()
  if (!db || typeof db.setItem !== 'function') return
  try { db.setItem(key, value) } catch {}
}

function storeRemove(key) {
  const db = getDbStorage()
  if (!db || typeof db.removeItem !== 'function') return
  try { db.removeItem(key) } catch {}
}

const textarea = document.getElementById('note-text')
const btnUnpin = document.getElementById('btn-unpin')
const btnTop = document.getElementById('btn-top')
const colorBtns = document.querySelectorAll('.color-swatch')
const opacitySlider = document.getElementById('note-opacity')
const todoActions = document.getElementById('todo-note-actions')
const btnTodoSnooze = document.getElementById('btn-todo-snooze')
const btnTodoDone = document.getElementById('btn-todo-done')
const todoSnoozeMenu = document.getElementById('todo-snooze-menu')

let noteSlotId = null
let alwaysOnTop = true
let noteColor = DEFAULT_COLOR
let noteOpacity = 1

function getSlots() {
  try {
    const list = JSON.parse(storeGet(SLOTS_KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function getSlot() {
  return getSlots().find(s => s.id === noteSlotId)
}

function isTodoReminderNote() {
  return typeof noteSlotId === 'string' && noteSlotId.startsWith('todo:')
}

function getTodoReminderCards() {
  try {
    const obj = JSON.parse(storeGet(TODO_REMINDER_KEY))
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function getTodoReminderCard() {
  if (!isTodoReminderNote()) return null
  return getTodoReminderCards()[noteSlotId] || null
}

function removeTodoReminderCard() {
  if (!isTodoReminderNote()) return
  const cards = getTodoReminderCards()
  if (!cards[noteSlotId]) return
  delete cards[noteSlotId]
  storeSet(TODO_REMINDER_KEY, JSON.stringify(cards))
}

function getTodos() {
  try {
    const list = JSON.parse(storeGet(TODO_KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function saveTodos(list) {
  storeSet(TODO_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

function removePinnedNote() {
  const obj = getPinned()
  delete obj[noteSlotId]
  storeSet(PINNED_KEY, JSON.stringify(obj))
}

function closeTodoReminder() {
  removePinnedNote()
  removeTodoReminderCard()
  window.close()
}

function snoozeTime(kind) {
  const now = Date.now()
  if (kind === '10m') return now + 10 * 60000
  if (kind === '1h') return now + 60 * 60000
  if (kind === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }
  return now + 10 * 60000
}

function updateReminderTodo(mutator) {
  const card = getTodoReminderCard()
  if (!card || card.todoId == null) return false
  const list = getTodos()
  const todo = list.find(item => String(item.id) === String(card.todoId))
  if (!todo) return false
  mutator(todo)
  todo.updatedAt = Date.now()
  saveTodos(list)
  return true
}

function completeReminderTodo() {
  updateReminderTodo(todo => {
    todo.done = true
    todo.completedAt = Date.now()
  })
  closeTodoReminder()
}

function snoozeReminderTodo(kind) {
  const next = snoozeTime(kind)
  updateReminderTodo(todo => {
    todo.remindAt = next
    todo.reminded = false
  })
  closeTodoReminder()
}

function getNoteText() {
  if (isTodoReminderNote()) {
    const card = getTodoReminderCards()[noteSlotId]
    return card ? card.text || '' : ''
  }
  const slot = getSlot()
  return slot ? slot.text : ''
}

function saveSlotText(text) {
  if (isTodoReminderNote()) return
  const list = getSlots()
  const slot = list.find(s => s.id === noteSlotId)
  if (!slot) return
  slot.text = text
  storeSet(SLOTS_KEY, JSON.stringify(list))
}

function getPinned() {
  try {
    const obj = JSON.parse(storeGet(PINNED_KEY))
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

function updatePinned(patch) {
  const obj = getPinned()
  obj[noteSlotId] = Object.assign({}, obj[noteSlotId], patch)
  storeSet(PINNED_KEY, JSON.stringify(obj))
}

function hexToRgba(hex, alpha) {
  const h = String(hex).replace('#', '')
  if (h.length !== 6) return hex
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// 只调背景色透明度，文字（textarea 前景色）始终不透明
function applyColor(color, opacity) {
  noteColor = color
  noteOpacity = opacity
  document.body.style.background = hexToRgba(color, opacity)
}

function updateTopBtn() {
  btnTop.classList.toggle('active', alwaysOnTop)
  btnTop.title = alwaysOnTop ? '始终置顶（点击取消）' : '普通层级（点击置顶）'
}

// 由主窗口在创建后通过 executeJavaScript 调用，传入要镜像的暂存槽 id
window.initNote = function (slotId) {
  noteSlotId = slotId
  const todoReminder = isTodoReminderNote()
  document.body.classList.toggle('todo-reminder', todoReminder)
  if (todoActions) todoActions.hidden = !todoReminder
  textarea.readOnly = todoReminder
  textarea.value = getNoteText()
  if (!todoReminder) textarea.focus()

  const pinned = getPinned()[slotId] || {}
  const opacity = typeof pinned.opacity === 'number' ? pinned.opacity : 1
  applyColor(pinned.color || DEFAULT_COLOR, opacity)
  opacitySlider.value = opacity
  alwaysOnTop = pinned.alwaysOnTop !== false
  updateTopBtn()

  document.body.classList.toggle('unfocused', !document.hasFocus())
}

// 失焦时隐藏顶部功能条，只显示一张纯色卡片；获得焦点（光标闪烁）时再显示
window.addEventListener('focus', () => document.body.classList.remove('unfocused'))
window.addEventListener('blur', () => document.body.classList.add('unfocused'))

let saveTimer = null
textarea.addEventListener('input', () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveSlotText(textarea.value), 300)
})
textarea.addEventListener('blur', () => {
  clearTimeout(saveTimer)
  saveSlotText(textarea.value)
})
window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer)
  saveSlotText(textarea.value)
})

// 主窗口的 createBrowserWindow 子窗口不会触发对方的 storage 事件，改为轮询读取
// ideadock.slots，把主面板（或其他便签）对该槽位的修改同步过来
setInterval(() => {
  if (noteSlotId == null) return
  if (document.activeElement === textarea) return
  const text = getNoteText()
  if (text !== textarea.value) textarea.value = text
}, SYNC_POLL_INTERVAL)

colorBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const color = btn.dataset.color
    applyColor(color, noteOpacity)
    updatePinned({ color })
  })
})

opacitySlider.addEventListener('input', () => {
  const opacity = parseFloat(opacitySlider.value)
  applyColor(noteColor, opacity)
  updatePinned({ opacity })
})

// 置顶开关：这里只记录意图到 ideadock.pinned，由主窗口轮询后调用 win.setAlwaysOnTop()
// 实际生效（便签自身无法修改自己的窗口属性）
btnTop.addEventListener('click', () => {
  alwaysOnTop = !alwaysOnTop
  updateTopBtn()
  updatePinned({ alwaysOnTop })
})

// 取消固定：从 ideadock.pinned 中移除自身记录后关闭窗口
btnUnpin.addEventListener('click', () => {
  removePinnedNote()
  removeTodoReminderCard()
  window.close()
})

if (btnTodoSnooze && todoSnoozeMenu) {
  btnTodoSnooze.addEventListener('click', e => {
    e.stopPropagation()
    todoSnoozeMenu.hidden = !todoSnoozeMenu.hidden
  })
  todoSnoozeMenu.querySelectorAll('[data-snooze]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      snoozeReminderTodo(btn.dataset.snooze)
    })
  })
}

if (btnTodoDone) {
  btnTodoDone.addEventListener('click', e => {
    e.stopPropagation()
    completeReminderTodo()
  })
}

document.addEventListener('click', e => {
  if (!todoSnoozeMenu || todoSnoozeMenu.hidden) return
  if (e.target === btnTodoSnooze || todoSnoozeMenu.contains(e.target)) return
  todoSnoozeMenu.hidden = true
})

// 窗口大小变化时持久化尺寸，下次重建悬浮窗时沿用
let resizeTimer = null
window.addEventListener('resize', () => {
  if (noteSlotId == null) return
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (!getPinned()[noteSlotId]) return
    updatePinned({ width: window.outerWidth, height: window.outerHeight })
  }, 300)
})
