<template>
  <div class="wallpaper-view">
    <el-scrollbar ref="scrollbarRef">
      <div class="wallpaper-content">
        <div class="wallpaper-header">
          <div class="search-bar">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索壁纸..."
              @keyup.enter="handleSearch"
            />
            <button @click="handleSearch">
              <el-icon><Search /></el-icon>
            </button>
          </div>
          <div class="filters">
            <select v-model="filters.sorting">
              <option value="date_added">最新</option>
              <option value="toplist">最热</option>
              <option value="random">随机</option>
              <option value="views">最多查看</option>
              <option value="favorites">最多收藏</option>
            </select>
            <select v-model="filters.categories">
              <option value="100">普通</option>
              <option value="010">动漫</option>
              <option value="001">人物</option>
              <option value="111">全部</option>
            </select>
            <select v-model="filters.purity">
              <option value="100">普通</option>
              <option value="010">限制级</option>
              <option value="001">NSFW</option>
            </select>
          </div>
        </div>

        <div class="wallpaper-grid" v-if="wallpapers.length > 0">
          <WallpaperCard
            v-for="wallpaper in wallpapers"
            :key="wallpaper.id"
            :wallpaper="wallpaper"
            @click="handleWallpaperClick"
          />
        </div>

        <div v-else-if="loading" class="loading">
          <div class="fancy-loader">
            <div class="fancy-loader-ring"></div>
            <div class="fancy-loader-ring"></div>
            <div class="fancy-loader-ring"></div>
            <div class="fancy-loader-ring"></div>
            <div class="fancy-loader-ring"></div>
          </div>
          <span class="loading-text">精彩加载中...</span>
        </div>

        <div v-else class="empty-state">
          <div class="empty-icon">
            <div class="sad-face">
              <div class="eyes">
                <div class="eye"></div>
                <div class="eye"></div>
              </div>
              <div class="mouth"></div>
              <div class="tears">
                <div class="tear"></div>
                <div class="tear"></div>
              </div>
            </div>
          </div>
          <h3 class="empty-title">没有找到相关壁纸</h3>
          <p class="empty-desc">试试换个关键词，说不定会有惊喜发现哦~</p>
        </div>

        <!-- 恢复加载更多按钮 -->
        <div v-if="wallpapers.length > 0" class="load-more">
          <button @click="loadMore" :disabled="loading">
            {{ loading ? '加载中...' : '加载更多' }}
          </button>
        </div>

        <!-- 自动加载触发器 -->
        <div 
          ref="autoLoadTrigger"
          v-show="!loading && wallpapers.length > 0"
          class="auto-load-trigger"
        ></div>
      </div>

      <!-- 返回顶部按钮 -->
      <el-backtop 
        :right="20" 
        :bottom="20" 
        target=".el-scrollbar__wrap"
        :visibility-height="200"
        class="custom-backtop"
      >
        <el-icon><Top /></el-icon>
      </el-backtop>
    </el-scrollbar>

    <div v-if="selectedWallpaper" class="wallpaper-modal" @click="selectedWallpaper = null">
      <div class="modal-content" @click.stop>
        <img :src="selectedWallpaper.path" :alt="selectedWallpaper.id" />
        <div class="modal-info">
          <div class="modal-stats">
            <span><View /> {{ formatNumber(selectedWallpaper.views) }}</span>
            <span><Star /> {{ formatNumber(selectedWallpaper.favorites) }}</span>
            <span><FullScreen /> {{ selectedWallpaper.resolution }}</span>
          </div>
          <div class="modal-actions">
            <button @click="downloadWallpaper(selectedWallpaper)">
              <Download /> 下载
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, onUnmounted, nextTick } from 'vue';
import type { Wallpaper, WallpaperSearchParams } from '../types/wallpaper';
import { searchWallpapers, API_KEY } from '../api/wallpaper';
import WallpaperCard from '../components/WallpaperCard.vue';
import { Top, Search, View, Star, FullScreen, Download } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const wallpapers = ref<Wallpaper[]>([]);
const loading = ref(false);
const currentPage = ref(1);
const searchQuery = ref('');
const selectedWallpaper = ref<Wallpaper | null>(null);
const scrollbarRef = ref();
const autoLoadTrigger = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const filters = ref<Omit<WallpaperSearchParams, 'q' | 'page'>>({
  sorting: 'date_added',
  categories: '111',
  purity: '100'
});

// 监听筛选器变化
watch(filters, () => {
  handleSearch();
}, { deep: true });

const formatNumber = (num: number) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
};

const handleSearch = async () => {
  currentPage.value = 1;
  wallpapers.value = [];
  
  // 特殊关键词检查（彩蛋功能）
  const hackerKeywords = ['黑客', '红客', '白客'];
  const isHackerSearch = hackerKeywords.includes(searchQuery.value.trim());
  
  // 如果是特殊关键词，使用临时设置进行搜索
  if (isHackerSearch) {
    await fetchWallpapers({
      q: '美女',
      page: currentPage.value,
      sorting: filters.value.sorting,
      categories: filters.value.categories,
      purity: '111'
    });
  } else {
    // 普通搜索
    await fetchWallpapers({
      q: searchQuery.value,
      page: currentPage.value,
      sorting: filters.value.sorting,
      categories: filters.value.categories,
      purity: filters.value.purity
    });
  }

  // 重新创建观察器
  nextTick(() => {
    createObserver();
  });
};

const fetchWallpapers = async (params?: WallpaperSearchParams) => {
  try {
    loading.value = true;
    const response = await searchWallpapers(params || {
      q: searchQuery.value,
      page: currentPage.value,
      sorting: filters.value.sorting,
      categories: filters.value.categories,
      purity: filters.value.purity
    });
    
    if (currentPage.value === 1) {
      wallpapers.value = response.data;
    } else {
      // 添加去重逻辑
      const existingIds = new Set(wallpapers.value.map(w => w.id));
      const newWallpapers = response.data.filter(w => !existingIds.has(w.id));
      wallpapers.value = [...wallpapers.value, ...newWallpapers];
    }
  } catch (error) {
    console.error('Error fetching wallpapers:', error);
    ElMessage({
      message: '很遗憾，您的地区或网络无法访问当前接口',
      type: 'error',
      duration: 5000,
      showClose: true
    });
    // 清空当前页的数据，以防止显示错误的数据
    if (currentPage.value === 1) {
      wallpapers.value = [];
    }
  } finally {
    loading.value = false;
  }
};

const loadMore = async () => {
  currentPage.value++;
  
  // 特殊关键词检查
  const hackerKeywords = ['黑客', '红客', '白客'];
  const isHackerSearch = hackerKeywords.includes(searchQuery.value.trim());
  
  // 根据不同情况使用不同的搜索参数
  if (isHackerSearch) {
    await fetchWallpapers({
      q: '美女',
      page: currentPage.value,
      sorting: filters.value.sorting,
      categories: filters.value.categories,
      purity: '111'
    });
  } else {
    await fetchWallpapers();
  }
};

const handleWallpaperClick = (wallpaper: Wallpaper) => {
  selectedWallpaper.value = wallpaper;
};

const downloadWallpaper = async (wallpaper: Wallpaper) => {
  try {
    const response = await fetch(wallpaper.path);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wallpaper-${wallpaper.id}.${wallpaper.file_type}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Error downloading wallpaper:', error);
  }
};

// 创建 Intersection Observer
const createObserver = () => {
  if (observer) {
    observer.disconnect();
  }

  observer = new IntersectionObserver(
    async (entries) => {
      const target = entries[0];
      if (target.isIntersecting && !loading.value) {
        await loadMore();
      }
    },
    {
      root: null,
      rootMargin: '100px',
      threshold: 0
    }
  );

  if (autoLoadTrigger.value) {
    observer.observe(autoLoadTrigger.value);
  }
};

onMounted(() => {
  fetchWallpapers();
  createObserver();
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
});
</script>

<style scoped lang="scss">
.wallpaper-view {
  height: 100vh;
  overflow: hidden;
  
  :deep(.el-scrollbar) {
    height: 100%;
  }
  
  .wallpaper-content {
    padding: 20px;
    max-width: 1400px;
    margin: 0 auto;
  }
}

.wallpaper-header {
  margin-bottom: 24px;
  display: flex;
  gap: 16px;
  align-items: center;
}

.search-bar {
  flex: 1;
  display: flex;
  gap: 8px;
  height: 42px;
}

.search-bar input {
  flex: 1;
  padding: 8px 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  transition: all 0.3s ease;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);

  &:hover {
    border-color: var(--el-border-color-hover);
  }

  &:focus {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
  }

  &::placeholder {
    color: var(--el-text-color-placeholder);
  }
}

.search-bar button {
  min-width: 42px;
  height: 42px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.search-bar button:hover {
  background: var(--el-color-primary-dark-2);
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(33, 150, 243, 0.2);
}

.search-bar button:active {
  transform: translateY(0);
  box-shadow: none;
}

.search-bar button i {
  font-size: 20px;
}

.filters {
  display: flex;
  gap: 8px;
}

.filters select {
  padding: 12px 16px;
  border: 1px solid var(--el-border-color);
  border-radius: 8px;
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.2s ease;
  min-width: 100px;
  outline: none;

  &:hover {
    border-color: var(--el-border-color-hover);
    background: var(--el-fill-color-light);
  }

  &:focus {
    border-color: var(--el-color-primary);
    box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
  }
}

.filters select option {
  background: var(--el-bg-color);
  color: var(--el-text-color-primary);
  padding: 8px;
}

.wallpaper-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 24px;
}

.loading {
  text-align: center;
  padding: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.loading-text {
  color: var(--el-text-color-secondary);
  font-size: 16px;
  letter-spacing: 1px;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0% { opacity: 0.6; }
  50% { opacity: 1; }
  100% { opacity: 0.6; }
}

.fancy-loader {
  position: relative;
  width: 80px;
  height: 80px;
}

.fancy-loader-ring {
  position: absolute;
  width: 100%;
  height: 100%;
  border: 3px solid transparent;
  border-radius: 50%;
  animation: rotate 2s cubic-bezier(0.68, -0.55, 0.265, 1.55) infinite;
}

.fancy-loader-ring:nth-child(1) {
  border-top-color: var(--el-color-primary);
  animation-delay: -0.5s;
}

.fancy-loader-ring:nth-child(2) {
  border-right-color: var(--el-color-success);
  animation-delay: -0.4s;
  width: 85%;
  height: 85%;
  top: 7.5%;
  left: 7.5%;
}

.fancy-loader-ring:nth-child(3) {
  border-bottom-color: var(--el-color-warning);
  animation-delay: -0.3s;
  width: 70%;
  height: 70%;
  top: 15%;
  left: 15%;
}

.fancy-loader-ring:nth-child(4) {
  border-left-color: var(--el-color-danger);
  animation-delay: -0.2s;
  width: 55%;
  height: 55%;
  top: 22.5%;
  left: 22.5%;
}

.fancy-loader-ring:nth-child(5) {
  border-top-color: var(--el-color-info);
  animation-delay: -0.1s;
  width: 40%;
  height: 40%;
  top: 30%;
  left: 30%;
}

@keyframes rotate {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: var(--el-text-color-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.empty-icon {
  width: 120px;
  height: 120px;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sad-face {
  position: relative;
  width: 80px;
  height: 80px;
  background: var(--el-color-primary-light-8);
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  animation: bounce 2s ease-in-out infinite;
}

.eyes {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
}

.eye {
  width: 8px;
  height: 8px;
  background: var(--el-text-color-primary);
  border-radius: 50%;
}

.mouth {
  width: 30px;
  height: 20px;
  border: 3px solid var(--el-text-color-primary);
  border-radius: 30px 30px 0 0;
  border-bottom: 0;
  position: relative;
  top: 5px;
  transform: scale(0.8);
}

.tears {
  position: absolute;
  display: flex;
  gap: 30px;
  top: 25px;
}

.tear {
  width: 4px;
  height: 4px;
  background: var(--el-color-primary);
  border-radius: 50%;
  animation: crying 1.5s linear infinite;
}

.tear:nth-child(2) {
  animation-delay: 0.75s;
}

.empty-title {
  font-size: 18px;
  color: var(--el-text-color-primary);
  margin: 0;
}

.empty-desc {
  font-size: 14px;
  color: var(--el-text-color-secondary);
  margin: 0;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes crying {
  0% {
    transform: translateY(0);
    opacity: 1;
  }
  100% {
    transform: translateY(20px);
    opacity: 0;
  }
}

.load-more {
  text-align: center;
  margin-top: 24px;
}

.load-more button {
  padding: 12px 24px;
  border: none;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: var(--el-color-white);
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.3s ease;

  &:hover {
    background: var(--el-color-primary-dark-2);
  }

  &:disabled {
    background: var(--el-disabled-bg-color);
    color: var(--el-disabled-text-color);
    cursor: not-allowed;
  }
}

.wallpaper-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  max-width: 90%;
  max-height: 90vh;
  background: white;
  border-radius: 12px;
  overflow: hidden;
}

.modal-content img {
  max-width: 100%;
  max-height: calc(90vh - 80px);
  object-fit: contain;
}

.modal-info {
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-stats {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
}

.modal-stats :deep(svg) {
  width: 1em;
  height: 1em;
  margin-right: 6px;
  vertical-align: middle;
}

.modal-actions button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  background: linear-gradient(135deg, #409eff, #1890ff);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 16px;
  font-weight: 500;
  transition: all 0.3s ease;
}

.modal-actions button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.4);
}

.modal-actions button:active {
  transform: translateY(0);
}

.modal-actions :deep(svg) {
  width: 1em;
  height: 1em;
}

/* 返回顶部按钮样式 */
:deep(.custom-backtop.el-backtop) {
  background-color: var(--el-bg-color) !important;
  border: 1px solid var(--el-border-color);
  transition: all 0.3s;
  
  .el-icon {
    font-size: 20px;
    color: var(--el-text-color-primary);
  }
  
  &:hover {
    transform: translateY(-3px);
    background-color: var(--el-color-primary) !important;
    border-color: var(--el-color-primary);
    
    .el-icon {
      color: #fff;
    }
  }
}

.auto-load-trigger {
  width: 100%;
  height: 1px;
  margin: 20px 0;
}
</style> 