<template>
  <el-aside :width="collapsed ? '52px' : '158px'" class="app-sidebar" :class="{ collapsed }">
    <div class="sidebar" :data-dark="isDarkMode">
      <!-- 搜索框 - 已隐藏 -->
      <!-- <div class="search-container">
        <el-input
          v-model="searchQuery"
          placeholder="搜索功能..."
          class="search-input"
          clearable
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
      </div> -->

      <!-- 主要功能菜单 - 添加可滚动容器 -->
      <div class="menu-sections-container">
        <!-- 主要功能菜单 -->
        <div class="menu-section">
          <div class="menu-item" 
               :class="{ active: currentView === 'online' }"
               @click="handleMenuSelect('online')">
            <div class="menu-icon">
              <el-icon><Search /></el-icon>
            </div>
            <span class="menu-title">{{ copy.online }}</span>
          </div>

          <div class="menu-item" 
               :class="{ active: currentView === 'all' }"
               @click="handleMenuSelect('all')">
            <div class="menu-icon">
              <el-icon><ChatDotRound /></el-icon>
            </div>
            <span class="menu-title">{{ copy.local }}</span>
            <div class="menu-badge count" v-if="localEmoticonCount > 0">{{ localEmoticonCount > 999 ? '999+' : localEmoticonCount }}</div>
          </div>

          <div class="menu-item"
               :class="{ active: currentView === 'favorite' }"
               @click="handleMenuSelect('favorite')">
            <div class="menu-icon">
              <el-icon><Star /></el-icon>
            </div>
            <span class="menu-title">{{ copy.favorite }}</span>
            <div class="menu-badge count" v-if="favoriteCount > 0">{{ favoriteCount }}</div>
          </div>


        </div>

        <!-- 工具功能 -->
        <div class="menu-section">
          <h4 class="section-title">{{ copy.createTools }}</h4>

          <div class="menu-item" 
               :class="{ active: currentView === 'workshop' }"
               @click="handleMenuSelect('workshop')">
            <div class="menu-icon">
              <el-icon><Edit /></el-icon>
            </div>
            <span class="menu-title">{{ copy.workshop }}</span>
          </div>
          
          <div class="menu-item" 
               :class="{ active: currentView === 'videotogif' }"
               @click="handleMenuSelect('videotogif')">
            <div class="menu-icon">
              <el-icon><VideoCamera /></el-icon>
            </div>
            <span class="menu-title">{{ copy.videoToGif }}</span>
          </div>
          
        </div>

        <!-- 表情库 -->
        <div class="menu-section">
          <h4 class="section-title">{{ copy.emojiLibrary }}</h4>
          
          <div class="menu-item" 
               :class="{ active: currentView === 'emoji' }"
               @click="handleMenuSelect('emoji')">
            <div class="menu-icon">
              <el-icon><ChatRound /></el-icon>
            </div>
            <span class="menu-title">{{ copy.emoji }}</span>
          </div>

          <div class="menu-item" 
               :class="{ active: currentView === 'kaomoji' }"
               @click="handleMenuSelect('kaomoji')">
            <div class="menu-icon">
              <el-icon><ChatDotRound /></el-icon>
            </div>
            <span class="menu-title">{{ copy.kaomoji }}</span>
          </div>
        </div>

        <!-- 娱乐功能 -->
        <div class="menu-section">
          <h4 class="section-title">{{ copy.fun }}</h4>
          
          <div class="menu-item" 
               :class="{ active: currentView === 'beauty' }"
               @click="handleMenuSelect('beauty')">
            <div class="menu-icon">
              <el-icon><Female /></el-icon>
            </div>
            <span class="menu-title">{{ copy.beauty }}</span>
          </div>

          <div class="menu-item" 
               :class="{ active: currentView === 'handsome' }"
               @click="handleMenuSelect('handsome')">
            <div class="menu-icon">
              <el-icon><Male /></el-icon>
            </div>
            <span class="menu-title">{{ copy.handsome }}</span>
          </div>
          
          <div class="menu-item" 
               :class="{ active: currentView === 'girlvideo' }"
               @click="handleMenuSelect('girlvideo')">
            <div class="menu-icon">
              <el-icon><VideoPlay /></el-icon>
            </div>
            <span class="menu-title">{{ copy.girlVideo }}</span>
          </div>

          <div class="menu-item" 
               :class="{ active: currentView === 'wallpaper' }"
               @click="handleMenuSelect('wallpaper')">
            <div class="menu-icon">
              <el-icon><Picture /></el-icon>
            </div>
            <span class="menu-title">{{ copy.wallpaper }}</span>
          </div>
        </div>

        <!-- 其他功能 -->
        <div class="menu-section">
          <h4 class="section-title">{{ copy.other }}</h4>
          
          <div class="menu-item" 
               :class="{ active: currentView === 'about' }"
               @click="handleMenuSelect('about')">
            <div class="menu-icon">
              <el-icon><User /></el-icon>
            </div>
            <span class="menu-title">{{ copy.about }}</span>
          </div>
        </div>
      </div>

      <div class="sidebar-footer">
        <button
          class="footer-toggle collapse-btn"
          type="button"
          :title="collapsed ? copy.expand : copy.collapse"
          :aria-label="collapsed ? copy.expand : copy.collapse"
          @click="emit('sidebarToggle')"
        >
          <el-icon>
            <Fold v-if="!collapsed" />
            <Expand v-else />
          </el-icon>
        </button>
        <button
          class="footer-toggle theme-toggle-btn"
          type="button"
          :title="isDarkMode ? copy.lightMode : copy.darkMode"
          :aria-label="isDarkMode ? copy.lightMode : copy.darkMode"
          @click="emit('darkModeToggle', !isDarkMode)"
        >
          <el-icon>
            <Sunny v-if="isDarkMode" />
            <Moon v-else />
          </el-icon>
        </button>
      </div>
    </div>
  </el-aside>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Search, User, Edit, ChatRound, ChatDotRound, VideoCamera, VideoPlay, Picture, Star, Female, Male, Moon, Sunny, Fold, Expand } from '@element-plus/icons-vue'
import { useEmoticonStore } from '@/store/emoticon'
import type { AppLanguage } from '@/utils/storage'

const props = defineProps<{
  currentView: string
  isDarkMode: boolean
  appLanguage: AppLanguage
  collapsed: boolean
}>()

const emit = defineEmits<{
  (e: 'viewChange', view: string): void
  (e: 'darkModeToggle', isDark: boolean): void
  (e: 'sidebarToggle'): void
}>()

// 获取表情包 store
const store = useEmoticonStore()

// 搜索查询 - 已隐藏搜索框，暂时保留变量
// const searchQuery = ref('')

// 实际的表情包数量，从store中获取
const localEmoticonCount = computed(() => store.allEmoticons.length)
const favoriteCount = computed(() => store.favoriteEmoticons.length)
const copy = computed(() => {
  if (props.appLanguage === 'en-US') {
    return {
      online: 'Online Search',
      local: 'Local Emoji',
      favorite: 'Favorites',
      createTools: 'Create',
      workshop: 'Workshop',
      videoToGif: 'Video to GIF',
      emojiLibrary: 'Emoji',
      emoji: 'Emoji',
      kaomoji: 'Kaomoji',
      fun: 'Fun',
      beauty: 'Beauty Images',
      handsome: 'Handsome Images',
      girlVideo: 'Beauty Video',
      wallpaper: 'Wallpaper',
      other: 'Other',
      about: 'About',
      darkMode: 'Switch to dark mode',
      lightMode: 'Switch to light mode',
      languageToggle: 'Switch language',
      collapse: 'Collapse sidebar',
      expand: 'Expand sidebar'
    }
  }

  return {
    online: '网络检索',
    local: '本地表情',
    favorite: '我的收藏',
    createTools: '创作工具',
    workshop: '表情工坊',
    videoToGif: '视频转GIF',
    emojiLibrary: '表情库',
    emoji: 'Emoji表情',
    kaomoji: '颜文字表情',
    fun: '娱乐',
    beauty: '美女图片',
    handsome: '帅哥图片',
    girlVideo: '美女视频',
    wallpaper: '精美壁纸',
    other: '其他',
    about: '关于作者',
    darkMode: '切换到暗黑模式',
    lightMode: '切换到浅色模式',
    languageToggle: '切换中英文',
    collapse: '折叠侧边栏',
    expand: '展开侧边栏'
  }
})

const handleMenuSelect = (index: string) => {
  emit('viewChange', index)
}

// 组件挂载时初始化store
onMounted(async () => {
  try {
    await store.initializeStore()
  } catch (error) {
    console.error('Failed to initialize emoticon store in sidebar:', error)
  }
})
</script>

<style scoped lang="scss">
.app-sidebar {
  overflow: hidden;
  background: transparent;
  margin-right: 0;
  transition: width 0.3s ease;

  &.collapsed {
    width: 52px;
    min-width: 52px;

    .sidebar {
      padding: 16px 0;
    }

    .menu-sections-container {
      margin-right: 0;
      padding-right: 0;
    }

    .menu-section {
      margin-bottom: 8px;

      .section-title {
        display: none;
      }

      .menu-item {
        padding: 10px 0;
        margin-bottom: 2px;
        justify-content: center;
        transform: none !important;

        .menu-icon {
          margin-right: 0;
        }

        .menu-title {
          display: none;
        }

        .menu-badge {
          display: none;
        }

        &::before {
          left: 0 !important;
        }
      }
    }

    .sidebar-footer {
      flex-direction: column;
      gap: 6px;
      padding: 12px 0 16px;
    }
  }
}

.sidebar {
  height: 100%;
  background: #ffffff;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
  border-radius: 0 20px 20px 0;
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 16px 8px;
  overflow: hidden;
  transition: all 0.3s ease;
  
  // 隐藏滚动条
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
  
  &::-webkit-scrollbar {
    display: none; /* Chrome, Safari and Opera */
  }

  // 暗色模式适配
  &[data-dark="true"] {
    background: #000000;
    box-shadow: 0 4px 24px rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  // 搜索框 - 已隐藏
  /*
  .search-container {
    flex-shrink: 0; // 防止压缩
    margin-bottom: 24px;

    .search-input {
      :deep(.el-input__wrapper) {
        background: rgba(243, 244, 246, 0.8);
        border: 1px solid rgba(209, 213, 219, 0.5);
        border-radius: 12px;
        box-shadow: none;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);

        &:hover {
          border-color: #3b82f6;
          background: rgba(243, 244, 246, 1);
        }

        &.is-focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
      }

      :deep(.el-input__inner) {
        color: #374151;
        font-size: 14px;
        
        &::placeholder {
          color: #9ca3af;
        }
      }

      :deep(.el-input__prefix) {
        color: #6b7280;
      }
    }
  }
  */

  // 菜单区域容器
  .menu-sections-container {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin-right: -12px; // 调整边距补偿
    padding-right: 12px; // 调整内边距
    padding-bottom: 16px;
    scroll-behavior: smooth; // 平滑滚动
    
    // 隐藏滚动条
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
    
    &::-webkit-scrollbar {
      display: none; /* Chrome, Safari and Opera */
    }
    
    // 鼠标悬停时显示滚动提示（可选）
    &:hover {
      // 可以在这里添加一些视觉提示，表示可以滚动
    }
  }

  .sidebar-footer {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 12px 4px 20px;
    background: inherit;
    border-top: 1px solid rgba(148, 163, 184, 0.18);
    z-index: 2;
    flex-shrink: 0;
  }

  .collapse-btn {
    .el-icon {
      transition: transform 0.3s ease;
    }
  }

  .footer-toggle {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid rgba(148, 163, 184, 0.3);
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #64748b;
    background: transparent;
    transition: all 0.2s ease;

    &:hover {
      border-color: #3b82f6;
      color: #3b82f6;
      background: rgba(59, 130, 246, 0.08);
    }

    .sidebar[data-dark="true"] & {
      border-color: rgba(255, 255, 255, 0.15);
      color: #94a3b8;

      &:hover {
        border-color: #ffffff;
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }
    }
  }

  .theme-toggle-btn {
    .el-icon {
      font-size: 14px;
      line-height: 1;
    }
  }

  // 菜单区域
  .menu-section {
    margin-bottom: 20px; // 稍微减少间距

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      margin: 0 0 12px 0;
      padding: 0 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: color 0.3s ease;
      
      .sidebar[data-dark="true"] & {
        color: #ffffff;
        font-weight: 700;
        text-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
      }
    }

    .menu-item {
      display: flex;
      align-items: center;
      padding: 11px 8px;
      margin-bottom: 4px;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      color: #4b5563;
      
      .sidebar[data-dark="true"] & {
        color: #ffffff;
        
        &:hover {
          background: rgba(255, 255, 255, 0.1);
          color: #ffffff;
          box-shadow: 0 0 15px rgba(255, 255, 255, 0.2);
          
          .menu-icon .el-icon {
            color: #ffffff;
            text-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
          }
        }
      }

      .menu-icon {
        width: 20px;
        height: 20px;
        margin-right: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        
        .el-icon {
          font-size: 18px;
          transition: all 0.3s ease;
        }
      }

      .menu-title {
        flex: 1;
        font-size: 14px;
        font-weight: 500;
        line-height: 1.2;
      }

      .menu-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 6px;
        border-radius: 7px;
        text-transform: uppercase;
        letter-spacing: 0.3px;

        &.hot {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: #ffffff;
          animation: pulse 2s infinite;
        }

        &.new {
          background: linear-gradient(135deg, #10b981, #059669);
          color: #ffffff;
        }

        &.count {
          background: rgba(59, 130, 246, 0.1);
          color: #3b82f6;
          min-width: 16px;
          line-height: 1.2;
          text-align: center;
          transition: all 0.3s ease;
          
          .sidebar[data-dark="true"] & {
            background: rgba(255, 255, 255, 0.15);
            color: #ffffff;
            font-weight: 600;
          }
        }

        &.version {
          background: rgba(107, 114, 128, 0.1);
          color: #6b7280;
          font-size: 10px;
          padding: 2px 6px;
          transition: all 0.3s ease;
          
          .sidebar[data-dark="true"] & {
            background: rgba(255, 255, 255, 0.1);
            color: #ffffff;
            font-weight: 500;
          }
        }
      }

      &:hover {
        background: rgba(59, 130, 246, 0.08);
        color: #3b82f6;
        transform: translateX(4px);
        
        .menu-icon .el-icon {
          color: #3b82f6;
          transform: scale(1.1);
        }
      }

      &.active {
        background: linear-gradient(135deg, #3b82f6, #2563eb);
        color: #ffffff;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
        transform: translateX(4px);
        
        .sidebar[data-dark="true"] & {
          background: linear-gradient(135deg, #ffffff, #cccccc);
          color: #000000;
          box-shadow: 0 4px 16px rgba(255, 255, 255, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.5);
          
          .menu-icon .el-icon {
            color: #000000;
          }
        }
        
        .menu-icon .el-icon {
          color: #ffffff;
        }
        
        .menu-badge.count {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }

        &::before {
          content: '';
          position: absolute;
          left: -20px;
          top: 50%;
          transform: translateY(-50%);
          width: 4px;
          height: 20px;
          background: #ffffff;
          border-radius: 0 4px 4px 0;
          
          .sidebar[data-dark="true"] & {
            background: #ffffff;
            box-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
          }
        }
      }
    }
  }
}

// 动画定义
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.8;
  }
}

// 响应式设计
@media (max-height: 600px) {
  .sidebar {
    padding: 16px 12px; // 调整小屏幕下的内边距

    // 添加更多上边距，补偿隐藏搜索框后的空间
    .menu-sections-container {
      margin-top: 8px;
      
      // 小屏幕下更加紧凑的布局
      .menu-section {
        margin-bottom: 16px;
        
        .section-title {
          font-size: 11px;
          margin-bottom: 8px;
        }
        
        .menu-item {
          padding: 10px 12px;
          margin-bottom: 2px;
          
          .menu-icon {
            width: 18px;
            height: 18px;
            
            .el-icon {
              font-size: 16px;
            }
          }
          
          .menu-title {
            font-size: 13px;
          }
          
          .menu-badge {
            font-size: 10px;
            padding: 1px 6px;
          }
        }
      }
    }
  }
}

// 超小屏幕优化
@media (max-height: 480px) {
  .sidebar {
    padding: 12px 10px; // 调整超小屏幕下的内边距

    .menu-sections-container {
      margin-top: 8px;
      
      .menu-section {
        margin-bottom: 12px;
        
        .menu-item {
          padding: 8px 10px;
          height: auto;
          min-height: 36px;
        }
      }
    }
  }
}

:deep(.el-aside) {
  border-right: none;
  overflow: hidden;
  background: transparent;
}
</style> 
