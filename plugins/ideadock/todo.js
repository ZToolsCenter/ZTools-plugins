// ==================== Todo / 提醒 ====================
// 依赖 app.js / archive.js 全局：$, storeGet/storeSet, getActiveSlot,
// persistCurrentNow, removeSlotAfterTodo, showToast, saveSlots, renderSlots,
// togglePin, nextSlotId, slots。

const TODO_KEY = 'ideadock.todos'
const TODO_VIEW_KEY = 'ideadock.todoView'
const TODO_REMINDER_KEY = 'ideadock.todoReminders'
const TODO_CHECK_INTERVAL = 30000

const TODO_QUADRANTS = {
  'important-urgent': '重要且紧急',
  'important-not-urgent': '重要不紧急',
  'urgent-not-important': '不重要但紧急',
  'not-important-not-urgent': '不重要不紧急',
  none: '未分类'
}

const TODO_QUADRANT_GRID = [
  'important-urgent',
  'important-not-urgent',
  'urgent-not-important',
  'not-important-not-urgent'
]

let todoList = []
let currentTodoView = storeGet(TODO_VIEW_KEY) || 'all'
let todoSourceSlot = null
let editingTodoId = null

function loadTodos() {
  try {
    const raw = storeGet(TODO_KEY)
    todoList = raw ? JSON.parse(raw) : []
  } catch {
    todoList = []
  }
  if (!Array.isArray(todoList)) todoList = []
}

function saveTodos() {
  storeSet(TODO_KEY, JSON.stringify(todoList))
}

function nextTodoId() {
  return todoList.reduce((max, todo) => Math.max(max, Number(todo.id) || 0), 0) + 1
}

function todoTitleFromText(text) {
  const first = String(text || '').trim().split(/\r?\n/)[0]?.trim() || '新任务'
  return first.length > 36 ? first.slice(0, 36) + '...' : first
}

function todoTimeLabel(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}-${dd} ${hh}:${min}`
}

function datetimeLocalValue(ts) {
  const d = ts ? new Date(ts) : new Date(Date.now() + 10 * 60000)
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function reminderFromPreset(preset) {
  const now = new Date()
  if (preset === '10m') return Date.now() + 10 * 60000
  if (preset === '1h') return Date.now() + 60 * 60000
  if (preset === 'today') {
    const d = new Date(now)
    d.setHours(18, 0, 0, 0)
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  if (preset === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return d.getTime()
  }
  if (preset === 'custom') {
    const value = $('todo-remind-custom').value
    const ts = value ? new Date(value).getTime() : NaN
    return Number.isFinite(ts) ? ts : null
  }
  return null
}

function setTodoRemindPreset(preset) {
  $('todo-remind-preset').value = preset || 'none'
  $('todo-custom-row').style.display = preset === 'custom' ? '' : 'none'
  document.querySelectorAll('#todo-remind-pills .todo-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.remind === $('todo-remind-preset').value)
  })
}

function setTodoQuadrant(value) {
  $('todo-quadrant').value = value || 'none'
  document.querySelectorAll('#todo-quadrant-picker .todo-q-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.quadrant === $('todo-quadrant').value)
  })
}

function addTodo(todo) {
  todoList.unshift({
    id: nextTodoId(),
    title: todo.title || '新任务',
    note: todo.note || '',
    done: false,
    quadrant: todo.quadrant || 'none',
    remindAt: todo.remindAt || null,
    reminded: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null
  })
  saveTodos()
  renderTodo()
}

function todoMeta(todo) {
  const parts = []
  if (todo.quadrant && todo.quadrant !== 'none') parts.push(TODO_QUADRANTS[todo.quadrant] || todo.quadrant)
  if (todo.remindAt) parts.push(todoTimeLabel(todo.remindAt))
  if (todo.done) parts.push('已完成')
  return parts.join(' · ')
}

function todoMatchesView(todo) {
  if (currentTodoView === 'active') return !todo.done
  if (currentTodoView === 'done') return todo.done
  return true
}

function renderTodoItem(todo) {
  const row = document.createElement('div')
  row.className = 'todo-item' + (todo.done ? ' done' : '')

  const check = document.createElement('button')
  check.type = 'button'
  check.className = 'todo-check'
  check.textContent = todo.done ? '✓' : ''
  check.title = todo.done ? '标记为未完成' : '标记为完成'
  check.addEventListener('click', e => {
    e.stopPropagation()
    todo.done = !todo.done
    todo.completedAt = todo.done ? Date.now() : null
    todo.updatedAt = Date.now()
    saveTodos()
    renderTodo()
  })

  const body = document.createElement('div')
  body.className = 'todo-body'

  const title = document.createElement('div')
  title.className = 'todo-title'
  title.textContent = todo.title

  const preview = document.createElement('div')
  preview.className = 'todo-preview'
  preview.textContent = (todo.note || '').replace(/\s+/g, ' ').trim()

  const meta = document.createElement('div')
  meta.className = 'todo-meta'
  meta.textContent = todoMeta(todo) || '普通任务'

  body.append(title)
  if (preview.textContent && preview.textContent !== todo.title) body.append(preview)
  body.append(meta)

  const actions = document.createElement('div')
  actions.className = 'todo-actions'

  const editBtn = document.createElement('button')
  editBtn.type = 'button'
  editBtn.className = 'archive-del'
  editBtn.textContent = '⋯'
  editBtn.title = '编辑'
  editBtn.addEventListener('click', e => {
    e.stopPropagation()
    editTodo(todo.id)
  })

  const delBtn = document.createElement('button')
  delBtn.type = 'button'
  delBtn.className = 'archive-del'
  delBtn.textContent = '×'
  delBtn.title = '删除'
  delBtn.addEventListener('click', e => {
    e.stopPropagation()
    todoList = todoList.filter(item => item.id !== todo.id)
    saveTodos()
    renderTodo()
  })

  actions.append(editBtn, delBtn)
  row.append(check, body, actions)
  row.addEventListener('click', () => editTodo(todo.id))
  return row
}

function renderTodoGroup(container, title, items) {
  const group = document.createElement('div')
  group.className = 'todo-group'
  const head = document.createElement('div')
  head.className = 'todo-group-title'
  head.textContent = `${title} (${items.length})`
  group.append(head)
  if (items.length) {
    items.forEach(todo => group.append(renderTodoItem(todo)))
  } else {
    const empty = document.createElement('div')
    empty.className = 'archive-empty'
    empty.textContent = '暂无任务'
    group.append(empty)
  }
  container.append(group)
}

function renderTodoQuadrant(container) {
  const grid = document.createElement('div')
  grid.className = 'todo-quadrant-grid'
  TODO_QUADRANT_GRID.forEach(key => {
    const cell = document.createElement('div')
    cell.className = `todo-quadrant-cell q-${key}`
    const head = document.createElement('div')
    head.className = 'todo-quadrant-title'
    const items = todoList.filter(todo => !todo.done && (todo.quadrant || 'none') === key)
    head.textContent = `${TODO_QUADRANTS[key]} (${items.length})`
    cell.append(head)
    const body = document.createElement('div')
    body.className = 'todo-quadrant-items'
    if (items.length) {
      items.forEach(todo => body.append(renderTodoItem(todo)))
    } else {
      const empty = document.createElement('div')
      empty.className = 'todo-quadrant-empty'
      empty.textContent = '暂无'
      body.append(empty)
    }
    cell.append(body)
    grid.append(cell)
  })
  container.append(grid)

  const uncategorized = todoList.filter(todo => !todo.done && (!todo.quadrant || todo.quadrant === 'none'))
  if (uncategorized.length) renderTodoGroup(container, TODO_QUADRANTS.none, uncategorized)
}

function renderTodo() {
  const container = $('todo-items')
  if (!container) return
  loadTodos()
  document.querySelectorAll('.todo-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.todoView === currentTodoView)
  })
  container.innerHTML = ''

  if (currentTodoView === 'quadrant') {
    renderTodoQuadrant(container)
    return
  }

  const items = todoList.filter(todoMatchesView)
  if (!items.length) {
    container.innerHTML = '<div class="archive-empty">暂无任务<br>可从文本槽点击“任务”创建</div>'
    return
  }
  items.forEach(todo => container.append(renderTodoItem(todo)))
}

function editTodo(id) {
  const todo = todoList.find(item => item.id === id)
  if (!todo) return
  todoSourceSlot = null
  editingTodoId = id
  $('todo-modal').querySelector('.modal-title').textContent = '编辑任务'
  $('todo-confirm').textContent = '保存'
  $('todo-title').value = todo.title || ''
  $('todo-note').value = todo.note || ''
  $('todo-remind-custom').value = datetimeLocalValue(todo.remindAt)
  setTodoQuadrant(todo.quadrant || 'none')
  setTodoRemindPreset(todo.remindAt ? 'custom' : 'none')
  $('todo-modal').style.display = 'block'
  setTimeout(() => { $('todo-title').focus(); $('todo-title').select() }, 0)
}

function openTodoModalFromSlot() {
  persistCurrentNow()
  const slot = getActiveSlot()
  if (!slot) return
  const text = $('editor').value
  if (!text.trim()) {
    showToast('内容为空，无法创建提醒')
    return
  }
  todoSourceSlot = { id: slot.id, name: slot.name, text, named: !!slot.named }
  editingTodoId = null
  $('todo-modal').querySelector('.modal-title').textContent = '创建提醒'
  $('todo-confirm').textContent = '创建'
  $('todo-title').value = slot.named && slot.name ? slot.name : todoTitleFromText(text)
  $('todo-note').value = text
  $('todo-remind-custom').value = datetimeLocalValue()
  setTodoQuadrant('none')
  setTodoRemindPreset('none')
  $('todo-modal').style.display = 'block'
  setTimeout(() => { $('todo-title').focus(); $('todo-title').select() }, 0)
}

function closeTodoModal() {
  $('todo-modal').style.display = 'none'
  todoSourceSlot = null
  editingTodoId = null
}

function confirmTodoModal() {
  const title = $('todo-title').value.trim()
  if (!title) {
    showToast('请填写提醒标题')
    return
  }
  const remindAt = reminderFromPreset($('todo-remind-preset').value)
  if ($('todo-remind-preset').value === 'custom' && !remindAt) {
    showToast('请选择有效提醒时间')
    return
  }
  if (editingTodoId != null) {
    const todo = todoList.find(item => item.id === editingTodoId)
    if (!todo) return
    const oldRemindAt = todo.remindAt
    todo.title = title
    todo.note = $('todo-note').value
    todo.quadrant = $('todo-quadrant').value || 'none'
    todo.remindAt = remindAt
    todo.reminded = remindAt ? (todo.reminded && remindAt === oldRemindAt) : false
    todo.updatedAt = Date.now()
    saveTodos()
    renderTodo()
    closeTodoModal()
    showToast('已保存任务')
    return
  }
  if (!todoSourceSlot) return
  addTodo({
    title,
    note: $('todo-note').value,
    quadrant: $('todo-quadrant').value || 'none',
    remindAt
  })
  removeSlotAfterTodo(todoSourceSlot.id)
  closeTodoModal()
  showToast('已创建提醒')
  if (typeof openResourceDrawer === 'function') openResourceDrawer('todo')
}

function addQuickTodo() {
  const input = $('todo-quick-input')
  const title = input.value.trim()
  if (!title) return
  addTodo({ title, note: title, quadrant: 'none', remindAt: null })
  input.value = ''
}

function todoReminderText(todo) {
  const title = String(todo.title || '任务').trim()
  const note = String(todo.note || '').trim()
  if (!note || note === title) return `提醒：${title}`
  return `提醒：${title}\n\n${note}`
}

function saveTodoReminderCard(id, todo, text) {
  let cards = {}
  try {
    const raw = storeGet(TODO_REMINDER_KEY)
    cards = raw ? JSON.parse(raw) : {}
  } catch {
    cards = {}
  }
  if (!cards || typeof cards !== 'object') cards = {}
  cards[id] = {
    title: `提醒：${todo.title}`,
    text,
    todoId: todo.id,
    createdAt: Date.now()
  }
  storeSet(TODO_REMINDER_KEY, JSON.stringify(cards))
}

function pinTodoReminder(todo) {
  if (!window.ideadockHost.supports('createBrowserWindow')) {
    showToast('任务已到期：' + todo.title)
    return
  }
  const id = `todo:${todo.id}:${todo.remindAt || Date.now()}`
  const text = todoReminderText(todo)
  saveTodoReminderCard(id, todo, text)
  const bounds = defaultBounds()
  bounds.color = NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]
  pinnedRecords.set(id, bounds)
  savePinned()
  createNoteWindow({ id }, bounds)
}

function checkDueTodos() {
  loadTodos()
  let changed = false
  todoList.forEach(todo => {
    if (todo.done || !todo.remindAt || todo.reminded || todo.remindAt > Date.now()) return
    todo.reminded = true
    todo.updatedAt = Date.now()
    changed = true
    pinTodoReminder(todo)
  })
  if (changed) {
    saveTodos()
    renderTodo()
  }
}

function initTodo() {
  loadTodos()
  if ($('btn-create-todo')) $('btn-create-todo').addEventListener('click', openTodoModalFromSlot)
  if ($('todo-confirm')) $('todo-confirm').addEventListener('click', confirmTodoModal)
  if ($('todo-cancel')) $('todo-cancel').addEventListener('click', closeTodoModal)
  if ($('todo-overlay')) $('todo-overlay').addEventListener('click', closeTodoModal)
  if ($('todo-remind-preset')) {
    document.querySelectorAll('#todo-remind-pills .todo-pill').forEach(btn => {
      btn.addEventListener('click', () => setTodoRemindPreset(btn.dataset.remind))
    })
  }
  if ($('todo-quadrant-picker')) {
    document.querySelectorAll('#todo-quadrant-picker .todo-q-btn').forEach(btn => {
      btn.addEventListener('click', () => setTodoQuadrant(btn.dataset.quadrant))
    })
  }
  if ($('todo-quick-add')) $('todo-quick-add').addEventListener('click', addQuickTodo)
  if ($('todo-quick-input')) {
    $('todo-quick-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault()
        addQuickTodo()
      }
    })
  }
  document.querySelectorAll('.todo-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTodoView = btn.dataset.todoView || 'all'
      storeSet(TODO_VIEW_KEY, currentTodoView)
      renderTodo()
    })
  })
  renderTodo()
  checkDueTodos()
  setInterval(checkDueTodos, TODO_CHECK_INTERVAL)
}

window.renderTodo = renderTodo
window.checkDueTodos = checkDueTodos

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTodo)
} else {
  initTodo()
}
