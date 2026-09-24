<template>
  <div class="wallpaper-container">
    <!-- 搜索和筛选区域 -->
    <div class="search-filter-section">
      <div class="search-box">
        <el-input
          v-model="searchQuery"
          placeholder="搜索壁纸..."
          prefix-icon="el-icon-search"
          clearable
          @input="handleSearch"
        />
      </div>
      <div class="filter-box">
        <el-select v-model="selectedCategory" placeholder="选择分类" @change="handleCategoryChange">
          <el-option
            v-for="category in categories"
            :key="category.value"
            :label="category.label"
            :value="category.value"
          />
        </el-select>
      </div>
    </div>

    <!-- 壁纸展示区域 -->
    <div class="wallpaper-grid">
      <el-row :gutter="16">
        <el-col
          v-for="wallpaper in displayWallpapers"
          :key="wallpaper.id"
          :xs="24"
          :sm="12"
          :md="8"
          :lg="6"
          :xl="4"
        >
          <div class="wallpaper-card" @mouseenter="showActions(wallpaper.id)" @mouseleave="hideActions">
            <el-image
              :src="wallpaper.thumbnail"
              :preview-src-list="[wallpaper.fullImage]"
              fit="cover"
              loading="lazy"
              class="wallpaper-image"
            >
              <template #placeholder>
                <div class="image-placeholder">
                  <el-icon><Loading /></el-icon>
                </div>
              </template>
            </el-image>
            
            <div class="wallpaper-actions" v-show="activeWallpaper === wallpaper.id">
              <el-button-group>
                <el-button
                  type="primary"
                  icon="el-icon-download"
                  @click.stop="downloadWallpaper(wallpaper)"
                  title="下载壁纸"
                />
                <el-button
                  :type="wallpaper.isFavorite ? 'danger' : 'default'"
                  :icon="wallpaper.isFavorite ? 'el-icon-star-on' : 'el-icon-star-off'"
                  @click.stop="toggleFavorite(wallpaper)"
                  title="收藏壁纸"
                />
                <el-button
                  type="success"
                  icon="el-icon-picture"
                  @click.stop="setAsWallpaper(wallpaper)"
                  title="设为壁纸"
                />
              </el-button-group>
            </div>
          </div>
        </el-col>
      </el-row>
    </div>

    <!-- 加载更多 -->
    <div class="load-more" v-if="hasMoreWallpapers">
      <el-button type="primary" :loading="loading" @click="loadMore">加载更多</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, defineComponent } from 'vue'
import { ElMessage } from 'element-plus'
import type { Wallpaper } from '@/types/wallpaper'

defineComponent({
  name: 'Wallpaper'
})

// 状态定义
const searchQuery = ref('')
const selectedCategory = ref('')
const wallpapers = ref<Wallpaper[]>([])
const activeWallpaper = ref<string | null>(null)
const loading = ref(false)
const page = ref(1)
const hasMoreWallpapers = ref(true)

// 分类数据
const categories = [
  { label: '全部', value: '' },
  { label: '风景', value: 'landscape' },
  { label: '动物', value: 'animals' },
  { label: '建筑', value: 'architecture' },
  { label: '艺术', value: 'art' },
  { label: '自然', value: 'nature' },
]

// 计算属性：显示的壁纸列表
const displayWallpapers = computed(() => {
  return wallpapers.value.filter(wallpaper => {
    const matchesSearch = wallpaper.title.toLowerCase().includes(searchQuery.value.toLowerCase())
    const matchesCategory = !selectedCategory.value || wallpaper.category === selectedCategory.value
    return matchesSearch && matchesCategory
  })
})

// 方法定义
const showActions = (id: string) => {
  activeWallpaper.value = id
}

const hideActions = () => {
  activeWallpaper.value = null
}

const handleSearch = () => {
  // 实现搜索逻辑
  page.value = 1
  fetchWallpapers()
}

const handleCategoryChange = () => {
  // 实现分类切换逻辑
  page.value = 1
  fetchWallpapers()
}

const downloadWallpaper = async (wallpaper: Wallpaper) => {
  try {
    // 实现下载逻辑
    ElMessage.success('壁纸下载成功')
  } catch (error) {
    ElMessage.error('下载失败，请重试')
  }
}

const toggleFavorite = (wallpaper: Wallpaper) => {
  // 实现收藏切换逻辑
  wallpaper.isFavorite = !wallpaper.isFavorite
  ElMessage.success(wallpaper.isFavorite ? '已添加到收藏' : '已取消收藏')
}

const setAsWallpaper = async (wallpaper: Wallpaper) => {
  try {
    // 实现设置壁纸逻辑
    ElMessage.success('壁纸设置成功')
  } catch (error) {
    ElMessage.error('设置失败，请重试')
  }
}

const loadMore = () => {
  page.value++
  fetchWallpapers()
}

const fetchWallpapers = async () => {
  loading.value = true
  try {
    // 实现获取壁纸数据的逻辑
    // 这里模拟API调用
    const response = await new Promise<Wallpaper[]>(resolve => 
      setTimeout(() => resolve([
        // 模拟数据
        {
          id: '1',
          title: '示例壁纸',
          thumbnail: 'https://via.placeholder.com/300x200',
          fullImage: 'https://via.placeholder.com/1920x1080',
          category: 'landscape',
          isFavorite: false
        }
      ]), 1000)
    )
    
    if (page.value === 1) {
      wallpapers.value = response
    } else {
      wallpapers.value.push(...response)
    }
    
    hasMoreWallpapers.value = response.length > 0
  } catch (error) {
    ElMessage.error('获取壁纸失败，请重试')
  } finally {
    loading.value = false
  }
}

// 生命周期钩子
onMounted(() => {
  fetchWallpapers()
})
</script>

<style scoped>
.wallpaper-container {
  padding: 20px;
}

.search-filter-section {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.search-box {
  flex: 1;
}

.filter-box {
  width: 200px;
}

.wallpaper-grid {
  margin-bottom: 24px;
}

.wallpaper-card {
  position: relative;
  margin-bottom: 16px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  transition: transform 0.3s ease;
}

.wallpaper-card:hover {
  transform: translateY(-4px);
}

.wallpaper-image {
  width: 100%;
  height: 200px;
  object-fit: cover;
}

.image-placeholder {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 200px;
  background-color: #f5f7fa;
}

.wallpaper-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  transition: opacity 0.3s ease;
}

.load-more {
  display: flex;
  justify-content: center;
  margin-top: 24px;
}

:deep(.el-button-group) {
  display: flex;
  gap: 8px;
}

:deep(.el-button) {
  border-radius: 4px;
}
</style> 