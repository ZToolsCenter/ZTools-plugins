<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import Settings from '../Settings/index.vue'
import Trash from '../Trash/index.vue'

interface Todo {
  id: string
  text: string
  category: string
  completed: boolean
  createdAt: string
  completedAt: string | null
}

interface Category {
  id: string
  name: string
  color: string
}

interface AppSettings {
  categories: Category[]
  bgColor: string
}

const todos = ref<Todo[]>([])
const settings = ref<AppSettings>({ categories: [], bgColor: '#f9f9f9' })
const newTodoText = ref('')
const newTodoCategory = ref('personal')
const filterStatus = ref<'all' | 'pending' | 'completed'>('all')
const filterCategory = ref('all')
const editingId = ref<string | null>(null)
const editText = ref('')
const showSettings = ref(false)
const showTrash = ref(false)

const filteredTodos = computed(() => {
  let result = todos.value
  
  if (filterStatus.value === 'pending') {
    result = result.filter(t => !t.completed)
  } else if (filterStatus.value === 'completed') {
    result = result.filter(t => t.completed)
  }
  
  if (filterCategory.value !== 'all') {
    result = result.filter(t => t.category === filterCategory.value)
  }
  
  result.sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1
    }
    if (a.completed) {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0
      return bTime - aTime
    } else {
      const aTime = new Date(a.createdAt).getTime()
      const bTime = new Date(b.createdAt).getTime()
      return bTime - aTime
    }
  })
  
  return result
})

const stats = computed(() => {
  const total = todos.value.length
  const completed = todos.value.filter(t => t.completed).length
  const pending = total - completed
  return { total, completed, pending }
})

const completedCount = computed(() => {
  return filteredTodos.value.filter(t => t.completed).length
})

onMounted(() => {
  loadData()
})

function loadData() {
  todos.value = window.services.getTodos()
  settings.value = window.services.getSettings()
  if (settings.value.categories.length > 0) {
    newTodoCategory.value = settings.value.categories[0].id
  }
}

function addTodo() {
  if (!newTodoText.value.trim()) return
  window.services.addTodo(newTodoText.value.trim(), newTodoCategory.value)
  newTodoText.value = ''
  loadTodos()
}

function loadTodos() {
  todos.value = window.services.getTodos()
}

function toggleTodo(id: string) {
  todos.value = window.services.toggleTodo(id)
}

function deleteTodo(id: string) {
  todos.value = window.services.deleteTodo(id)
}

function startEdit(todo: Todo) {
  editingId.value = todo.id
  editText.value = todo.text
}

function saveEdit() {
  if (editingId.value && editText.value.trim()) {
    todos.value = window.services.updateTodo(editingId.value, { text: editText.value.trim() })
  }
  editingId.value = null
  editText.value = ''
}

function cancelEdit() {
  editingId.value = null
  editText.value = ''
}

function clearCompleted() {
  todos.value = window.services.clearCompleted()
}

function getCategoryColor(categoryId: string) {
  const cat = settings.value.categories.find(c => c.id === categoryId)
  return cat ? cat.color : '#999'
}

function getCategoryName(categoryId: string) {
  const cat = settings.value.categories.find(c => c.id === categoryId)
  return cat ? cat.name : categoryId
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hour}:${minute}`
}

function closeSettings() {
  showSettings.value = false
  loadData()
}

function closeTrash() {
  showTrash.value = false
  loadTodos()
}
</script>

<template>
  <Settings v-if="showSettings" @close="closeSettings" />
  <Trash v-else-if="showTrash" @close="closeTrash" />
  
  <div v-else class="todo-container" :style="{ backgroundColor: settings.bgColor }">
    <div class="header">
      <h1>待办事项</h1>
      <div class="header-actions">
        <button @click="showTrash = true" class="icon-btn" title="回收站">🗑️</button>
        <button @click="showSettings = true" class="icon-btn" title="设置">⚙️</button>
      </div>
    </div>

    <div class="input-section">
      <input
        v-model="newTodoText"
        @keyup.enter="addTodo"
        placeholder="添加新待办..."
        class="todo-input"
      />
      <div class="input-row">
        <select v-model="newTodoCategory" class="category-select">
          <option
            v-for="cat in settings.categories"
            :key="cat.id"
            :value="cat.id"
          >
            {{ cat.name }}
          </option>
        </select>
        <button @click="addTodo" class="add-btn">添加</button>
      </div>
    </div>

    <div class="filter-section">
      <select v-model="filterStatus" class="filter-select">
        <option value="all">全部 ({{ stats.total }})</option>
        <option value="pending">待完成 ({{ stats.pending }})</option>
        <option value="completed">已完成 ({{ stats.completed }})</option>
      </select>
      <select v-model="filterCategory" class="filter-select">
        <option value="all">全部分类</option>
        <option
          v-for="cat in settings.categories"
          :key="cat.id"
          :value="cat.id"
        >
          {{ cat.name }}
        </option>
      </select>
    </div>

    <div class="todo-list">
      <div
        v-for="todo in filteredTodos"
        :key="todo.id"
        class="todo-item"
        :class="{ completed: todo.completed }"
        :style="{ borderLeftColor: getCategoryColor(todo.category) }"
      >
        <input
          type="checkbox"
          :checked="todo.completed"
          @change="toggleTodo(todo.id)"
          class="checkbox"
        />
        
        <template v-if="editingId === todo.id">
          <input
            v-model="editText"
            @keyup.enter="saveEdit"
            @keyup.escape="cancelEdit"
            class="edit-input"
          />
          <button @click="saveEdit" class="save-btn">保存</button>
          <button @click="cancelEdit" class="cancel-btn">取消</button>
        </template>
        
        <template v-else>
          <div class="todo-content">
            <span class="todo-text" @dblclick="startEdit(todo)">{{ todo.text }}</span>
            <div class="todo-meta">
              <span class="category-tag">{{ getCategoryName(todo.category) }}</span>
              <span class="time-info">
                创建: {{ formatDate(todo.createdAt) }}
                <span v-if="todo.completedAt"> | 完成: {{ formatDate(todo.completedAt) }}</span>
              </span>
            </div>
          </div>
          <button @click="startEdit(todo)" class="edit-btn">编辑</button>
          <button @click="deleteTodo(todo.id)" class="delete-btn">删除</button>
        </template>
      </div>
      
      <div v-if="filteredTodos.length === 0" class="empty-state">
        暂无待办事项
      </div>
    </div>

    <div class="footer" v-if="filterStatus === 'completed' && completedCount > 0">
      <button @click="clearCompleted" class="clear-btn">
        清除已完成 ({{ completedCount }})
      </button>
    </div>
  </div>
</template>

<style scoped>
.todo-container {
  width: 100%;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh;
  box-sizing: border-box;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h1 {
  margin: 0;
  color: #333;
  font-size: 24px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: #e0e0e0;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: #d0d0d0;
}

.input-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 15px;
}

.todo-input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  box-sizing: border-box;
  background: white;
}

.todo-input:focus {
  outline: none;
  border-color: #4a90d9;
}

.input-row {
  display: flex;
  gap: 10px;
}

.category-select {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  background: white;
  cursor: pointer;
}

.add-btn {
  padding: 10px 20px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.add-btn:hover {
  background: #357abd;
}

.filter-section {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
}

.filter-select {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 12px;
  background: #e8e8e8;
  cursor: pointer;
}

.filter-select:focus {
  outline: none;
  border-color: #4a90d9;
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  background: white;
  border-radius: 8px;
  border-left: 4px solid #4a90d9;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

.todo-item.completed {
  opacity: 0.7;
}

.todo-item.completed .todo-text {
  text-decoration: line-through;
  color: #999;
}

.checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  margin-top: 2px;
}

.todo-content {
  flex: 1;
  min-width: 0;
}

.todo-text {
  font-size: 14px;
  color: #333;
  word-break: break-word;
}

.todo-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
}

.category-tag {
  font-size: 11px;
  padding: 2px 8px;
  background: #e0e0e0;
  border-radius: 4px;
  color: #666;
}

.time-info {
  font-size: 11px;
  color: #999;
}

.edit-btn,
.delete-btn {
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  flex-shrink: 0;
}

.edit-btn {
  background: #f0f0f0;
  color: #666;
}

.delete-btn {
  background: #ffebee;
  color: #e74c3c;
}

.edit-input {
  flex: 1;
  padding: 6px;
  border: 1px solid #4a90d9;
  border-radius: 4px;
  font-size: 14px;
}

.save-btn,
.cancel-btn {
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.save-btn {
  background: #4caf50;
  color: white;
}

.cancel-btn {
  background: #f0f0f0;
  color: #666;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #999;
}

.footer {
  margin-top: 15px;
  text-align: center;
}

.clear-btn {
  padding: 10px 20px;
  background: #ffebee;
  border: 1px solid #ffcdd2;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #e74c3c;
}

.clear-btn:hover {
  background: #ffcdd2;
}
</style>
