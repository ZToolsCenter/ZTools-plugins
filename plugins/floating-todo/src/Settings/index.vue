<script setup lang="ts">
import { ref, onMounted } from 'vue'

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

const settings = ref<AppSettings>({
  categories: [],
  bgColor: '#f9f9f9'
})

const newCategoryName = ref('')
const newCategoryColor = ref('#4a90d9')

onMounted(() => {
  settings.value = window.services.getSettings()
})

function addCategory() {
  if (!newCategoryName.value.trim()) return
  const id = Date.now().toString()
  settings.value.categories.push({
    id,
    name: newCategoryName.value.trim(),
    color: newCategoryColor.value
  })
  newCategoryName.value = ''
  saveSettings()
}

function removeCategory(id: string) {
  if (settings.value.categories.length <= 1) {
    alert('至少保留一个分类')
    return
  }
  settings.value.categories = settings.value.categories.filter(c => c.id !== id)
  saveSettings()
}

function updateCategoryColor(id: string, color: string) {
  const cat = settings.value.categories.find(c => c.id === id)
  if (cat) {
    cat.color = color
    saveSettings()
  }
}

function updateCategoryName(id: string, name: string) {
  const cat = settings.value.categories.find(c => c.id === id)
  if (cat) {
    cat.name = name
    saveSettings()
  }
}

function updateBgColor(color: string) {
  settings.value.bgColor = color
  saveSettings()
}

function saveSettings() {
  window.services.saveSettings(settings.value)
}

function close() {
  emit('close')
}
</script>

<template>
  <div class="settings-container">
    <div class="settings-header">
      <h2>设置</h2>
      <button @click="close" class="close-btn">×</button>
    </div>

    <div class="settings-section">
      <h3>背景颜色</h3>
      <div class="color-options">
        <div
          v-for="color in ['#f9f9f9', '#ffffff', '#f0f4f8', '#fef3f2', '#f0fdf4', '#fefce8', '#f5f3ff']"
          :key="color"
          class="color-option"
          :style="{ backgroundColor: color }"
          :class="{ active: settings.bgColor === color }"
          @click="updateBgColor(color)"
        ></div>
      </div>
      <div class="custom-color">
        <label>自定义颜色:</label>
        <input
          type="color"
          :value="settings.bgColor"
          @input="updateBgColor(($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <div class="settings-section">
      <h3>分类管理</h3>
      <div class="category-list">
        <div
          v-for="cat in settings.categories"
          :key="cat.id"
          class="category-item"
        >
          <input
            type="color"
            :value="cat.color"
            @input="updateCategoryColor(cat.id, ($event.target as HTMLInputElement).value)"
            class="category-color-picker"
          />
          <input
            type="text"
            :value="cat.name"
            @input="updateCategoryName(cat.id, ($event.target as HTMLInputElement).value)"
            class="category-name-input"
          />
          <button @click="removeCategory(cat.id)" class="remove-btn">删除</button>
        </div>
      </div>
      <div class="add-category">
        <input
          v-model="newCategoryName"
          placeholder="新分类名称"
          class="new-category-input"
        />
        <input
          type="color"
          v-model="newCategoryColor"
          class="category-color-picker"
        />
        <button @click="addCategory" class="add-category-btn">添加</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>回收站</h3>
      <p class="trash-info">已删除的待办可以在主界面底部的"回收站"中恢复</p>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  width: 100%;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 100vh;
  box-sizing: border-box;
}

.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.settings-header h2 {
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

.settings-section {
  margin-bottom: 25px;
  padding: 15px;
  background: #f5f5f5;
  border-radius: 8px;
}

.settings-section h3 {
  margin: 0 0 15px 0;
  font-size: 14px;
  color: #333;
}

.color-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.color-option {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.color-option.active {
  border-color: #333;
  transform: scale(1.1);
}

.custom-color {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #666;
}

.custom-color input[type="color"] {
  width: 40px;
  height: 30px;
  border: none;
  cursor: pointer;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 15px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.category-color-picker {
  width: 30px;
  height: 30px;
  border: none;
  cursor: pointer;
  border-radius: 4px;
}

.category-name-input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.remove-btn {
  padding: 6px 12px;
  background: #ffebee;
  color: #e74c3c;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.add-category {
  display: flex;
  gap: 8px;
}

.new-category-input {
  flex: 1;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.add-category-btn {
  padding: 8px 16px;
  background: #4a90d9;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.trash-info {
  font-size: 12px;
  color: #666;
  margin: 0;
}
</style>
