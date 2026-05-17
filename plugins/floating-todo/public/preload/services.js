const fs = require('node:fs')
const path = require('node:path')

const dataDir = path.join(window.ztools.getPath('userData'), 'floating-todo')
const dataFile = path.join(dataDir, 'todos.json')
const trashFile = path.join(dataDir, 'trash.json')
const settingsFile = path.join(dataDir, 'settings.json')

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
}

function loadTodos() {
  ensureDataDir()
  if (fs.existsSync(dataFile)) {
    try {
      return JSON.parse(fs.readFileSync(dataFile, { encoding: 'utf-8' }))
    } catch (e) {
      return []
    }
  }
  return []
}

function saveTodos(todos) {
  ensureDataDir()
  fs.writeFileSync(dataFile, JSON.stringify(todos, null, 2), { encoding: 'utf-8' })
}

function loadTrash() {
  ensureDataDir()
  if (fs.existsSync(trashFile)) {
    try {
      return JSON.parse(fs.readFileSync(trashFile, { encoding: 'utf-8' }))
    } catch (e) {
      return []
    }
  }
  return []
}

function saveTrash(trash) {
  ensureDataDir()
  fs.writeFileSync(trashFile, JSON.stringify(trash, null, 2), { encoding: 'utf-8' })
}

function loadSettings() {
  ensureDataDir()
  if (fs.existsSync(settingsFile)) {
    try {
      return JSON.parse(fs.readFileSync(settingsFile, { encoding: 'utf-8' }))
    } catch (e) {
      return getDefaultSettings()
    }
  }
  return getDefaultSettings()
}

function saveSettings(settings) {
  ensureDataDir()
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), { encoding: 'utf-8' })
}

function getDefaultSettings() {
  return {
    categories: [
      { id: 'personal', name: '个人', color: '#4a90d9' },
      { id: 'work', name: '工作', color: '#e74c3c' }
    ],
    bgColor: '#f9f9f9'
  }
}

window.services = {
  getTodos() {
    return loadTodos()
  },
  addTodo(text, category) {
    const todos = loadTodos()
    const todo = {
      id: Date.now().toString(),
      text,
      category: category || 'personal',
      completed: false,
      createdAt: new Date().toISOString(),
      completedAt: null
    }
    todos.push(todo)
    saveTodos(todos)
    return todo
  },
  toggleTodo(id) {
    const todos = loadTodos()
    const todo = todos.find(t => t.id === id)
    if (todo) {
      todo.completed = !todo.completed
      todo.completedAt = todo.completed ? new Date().toISOString() : null
      saveTodos(todos)
    }
    return todos
  },
  deleteTodo(id) {
    const todos = loadTodos()
    const index = todos.findIndex(t => t.id === id)
    if (index > -1) {
      const [deleted] = todos.splice(index, 1)
      const trash = loadTrash()
      deleted.deletedAt = new Date().toISOString()
      trash.push(deleted)
      saveTrash(trash)
      saveTodos(todos)
    }
    return todos
  },
  updateTodo(id, updates) {
    const todos = loadTodos()
    const todo = todos.find(t => t.id === id)
    if (todo) {
      Object.assign(todo, updates)
      saveTodos(todos)
    }
    return todos
  },
  clearCompleted() {
    const todos = loadTodos()
    const completed = todos.filter(t => t.completed)
    const trash = loadTrash()
    completed.forEach(t => {
      t.deletedAt = new Date().toISOString()
      trash.push(t)
    })
    saveTrash(trash)
    const filtered = todos.filter(t => !t.completed)
    saveTodos(filtered)
    return filtered
  },
  getTrash() {
    return loadTrash()
  },
  restoreTodo(id) {
    const trash = loadTrash()
    const index = trash.findIndex(t => t.id === id)
    if (index > -1) {
      const [restored] = trash.splice(index, 1)
      delete restored.deletedAt
      saveTrash(trash)
      const todos = loadTodos()
      todos.push(restored)
      saveTodos(todos)
      return { todos, trash }
    }
    return { todos: loadTodos(), trash }
  },
  clearTrash() {
    saveTrash([])
    return []
  },
  deleteFromTrash(id) {
    const trash = loadTrash()
    const index = trash.findIndex(t => t.id === id)
    if (index > -1) {
      trash.splice(index, 1)
      saveTrash(trash)
    }
    return trash
  },
  getSettings() {
    return loadSettings()
  },
  saveSettings(settings) {
    saveSettings(settings)
    return settings
  }
}
