<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

interface TodoItem {
  id: string
  text: string
  category: string
  completed: boolean
  createdAt: string
  completedAt: string | null
  deletedAt?: string
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

const emit = defineEmits(['close'])

const trash = ref<TodoItem[]>([])
const settings = ref<AppSettings>({ categories: [], bgColor: '#f9f9f9' })

onMounted(() => {
  trash.value = window.services.getTrash()
  settings.value = window.services.getSettings()
})

function restoreTodo(id: string) {
  const result = window.services.restoreTodo(id)
  trash.value = result.trash
}

function deletePermanently(id: string) {
  if (confirm('确定要永久删除吗？')) {
    trash.value = window.services.deleteFromTrash(id)
  }
}

function clearAll() {
  if (confirm('确定要清空回收站吗？此操作不可恢复！')) {
    trash.value = window.services.clearTrash()
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}/${month}/${day} ${hour}:${minute}`
}

function getCategoryColor(categoryId: string) {
  const cat = settings.value.categories.find(c => c.id === categoryId)
  return cat ? cat.color : '#999'
}

function getCategoryName(categoryId: string) {
  const cat = settings.value.categories.find(c => c.id === categoryId)
  return cat ? cat.name : categoryId
}
</script>

<template>
  <div class="trash-container">
    <div class="trash-header">
      <h2>回收站</h2>
      <button @click="emit('close')" class="close-btn">×</button>
    </div>

    <div class="trash-list" v-if="trash.length > 0">
      <div
        v-for="item in trash"
        :key="item.id"
        class="trash-item"
        :style="{ borderLeftColor: getCategoryColor(item.category) }"
      >
        <div class="item-content">
          <span class="item-text" :class="{ completed: item.completed }">{{ item.text }}</span>
          <span class="item-category">{{ getCategoryName(item.category) }}</span>
        </div>
        <div class="item-times">
          <span>创建: {{ formatDate(item.createdAt) }}</span>
          <span v-if="item.completedAt">完成: {{ formatDate(item.completedAt) }}</span>
          <span>删除: {{ formatDate(item.deletedAt || null) }}</span>
        </div>
        <div class="item-actions">
          <button @click="restoreTodo(item.id)" class="restore-btn">恢复</button>
          <button @click="deletePermanently(item.id)" class="delete-btn">永久删除</button>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      回收站为空
    </div>

    <div class="trash-footer" v-if="trash.length > 0">
      <button @click="clearAll" class="clear-all-btn">清空回收站</button>
    </div>
  </div>
</template>

<style scoped>
.trash-container {
  width: 100%;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh;
  box-sizing: border-box;
}

.trash-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.trash-header h2 {
  margin: 0;
  color: #333;
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  background: #ccc;
  border-radius: 50%;
  font-size: 20px;
  font-weight: bold;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #333;
}

.close-btn:hover {
  background: #999;
  color: #fff;
}

.trash-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.trash-item {
  padding: 12px;
  background: #f5f5f5;
  border-radius: 8px;
  border-left: 4px solid #999;
}

.item-content {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.item-text {
  flex: 1;
  font-size: 14px;
  color: #333;
}

.item-text.completed {
  text-decoration: line-through;
  color: #999;
}

.item-category {
  font-size: 11px;
  padding: 2px 8px;
  background: #e0e0e0;
  border-radius: 4px;
  color: #666;
}

.item-times {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: #999;
  margin-bottom: 8px;
}

.item-actions {
  display: flex;
  gap: 8px;
}

.restore-btn {
  padding: 4px 12px;
  background: #4caf50;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.delete-btn {
  padding: 4px 12px;
  background: #ffebee;
  color: #e74c3c;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.empty-state {
  text-align: center;
  padding: 40px;
  color: #999;
}

.trash-footer {
  margin-top: 15px;
  text-align: center;
}

.clear-all-btn {
  padding: 8px 16px;
  background: #ffebee;
  color: #e74c3c;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}
</style>
