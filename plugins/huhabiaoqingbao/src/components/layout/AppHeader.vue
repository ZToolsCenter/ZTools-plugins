<template>
  <el-header height="auto" class="app-header">
    <div class="header-wrapper">
      <!-- 左侧搜索和筛选控件 -->
      <div class="search-box">
        <div class="search-filter">
          <!-- 椭圆形搜索框 -->
          <div class="custom-search-input">
            <el-icon class="search-icon"><Search /></el-icon>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索表情包..."
              class="search-field"
              @input="handleSearch"
            />
            <button 
              v-if="searchQuery"
              class="clear-btn"
              @click="clearSearch"
            >
              <el-icon><Close /></el-icon>
            </button>
          </div>

          <!-- 自定义分类选择器 -->
          <div class="custom-select-wrapper">
            <button
              class="custom-select-btn"
              @click="toggleTagDropdown"
              :class="{ 'active': showTagDropdown }"
            >
              <span class="select-text">{{ getSelectedTagLabel() }}</span>
              <el-icon class="dropdown-icon" :class="{ 'rotate': showTagDropdown }">
                <ArrowDown />
              </el-icon>
            </button>

            <!-- 下拉选项 -->
            <div v-if="showTagDropdown" class="custom-dropdown">
              <div class="dropdown-item" @click="selectTag(null)">
                <span>全部分类</span>
              </div>
              <div class="dropdown-item" @click="selectTag('gif')">
                <span>动图</span>
              </div>
              <div
                v-for="tag in tags"
                :key="tag.id"
                class="dropdown-item"
                @click="selectTag(tag.id)"
              >
                <span>{{ tag.name }}</span>
              </div>
              <div class="dropdown-divider"></div>
              <div class="dropdown-item manage-item" @click="openTagManager">
                <el-icon><Management /></el-icon>
                <span>管理</span>
              </div>
            </div>
          </div>

          <!-- 来源筛选下拉 -->
          <div class="source-select-wrapper">
            <button
              class="custom-select-btn source-btn"
              @click="toggleSourceDropdown"
              :class="{ 'active': showSourceDropdown }"
            >
              <span class="select-text">{{ getSourceLabel() }}</span>
              <el-icon class="dropdown-icon" :class="{ 'rotate': showSourceDropdown }">
                <ArrowDown />
              </el-icon>
            </button>

            <div v-if="showSourceDropdown" class="custom-dropdown source-dropdown">
              <div
                v-for="option in sourceOptions"
                :key="option.value"
                class="dropdown-item"
                :class="{ 'active-source': currentSource === option.value }"
                @click="selectSource(option.value)"
              >
                <span>{{ option.label }}</span>
                <span class="item-count" v-if="getSourceCount(option.value) > 0">{{ getSourceCount(option.value) }}</span>
              </div>
            </div>
          </div>

          <!-- 下拉遮罩层 - 点击关闭下拉框 -->
          <div
            v-if="showTagDropdown || showSourceDropdown"
            class="dropdown-overlay"
            @click="closeAllDropdowns"
          ></div>
        </div>
      </div>

      <!-- 右侧操作按钮组 - 扁平文字设计 -->
      <div class="action-buttons">
        <!-- 添加按钮 -->
        <el-upload
          class="upload-wrapper"
          :show-file-list="false"
          :accept="'.png,.jpg,.jpeg,.gif'"
          :before-upload="handleUpload"
        >
          <button class="flat-btn primary">
            <span class="btn-text">添加</span>
          </button>
        </el-upload>

        <!-- 导入按钮 -->
        <button class="flat-btn success" @click="handleImportClick">
          <span class="btn-text">导入</span>
        </button>

        <button class="flat-btn backup-btn" @click="openBackupDialog">
          <span class="btn-text">备份</span>
        </button>

        <!-- 选择按钮 -->
        <button 
          class="flat-btn select-btn"
          :class="{ 
            'active': isSelectMode
          }"
          :disabled="!total"
          @click="handleSelectMode"
         
        >
          <span class="btn-text">{{ isSelectMode ? '退出' : '选择' }}</span>
        </button>
      </div>
    </div>
    
    <!-- 分类管理对话框 -->
    <TagManager 
      v-model="showTagManager" 
      @tagsUpdated="handleTagsUpdated"
    />

    <el-dialog
      v-model="showBackupDialog"
      title="GitHub Gist 备份"
      width="460px"
      top="12px"
      class="backup-dialog"
      destroy-on-close
    >
      <div class="backup-panel">
        <div class="backup-actions backup-actions-top">
          <button class="dialog-btn primary" :disabled="backupBusy" @click="saveBackupConfig">保存设置</button>
          <button class="dialog-btn primary" :disabled="backupBusy" @click="syncBackupToLocal">
            {{ backupBusy ? '处理中...' : '同步到本地' }}
          </button>
          <button class="dialog-btn primary" :disabled="backupBusy" @click="runManualBackup">
            {{ backupBusy ? '备份中...' : '立即备份' }}
          </button>
        </div>

        <div class="backup-tip">
          使用你自己的 GitHub Token 和 Gist 进行备份。首次留空 `Gist ID` 时会自动创建私有 Gist。
        </div>

        <div class="backup-section">
          <div class="backup-field">
            <div class="field-head">
              <span class="field-label">GitHub Token</span>
              <button class="mini-link-btn" @click="openCreateToken">
                去 GitHub 创建
              </button>
            </div>
            <el-input
              v-model="backupForm.token"
              type="password"
              show-password
              placeholder="填写带 Gists 写权限的 Token"
              clearable
            />
            <span class="field-hint">推荐使用 Fine-grained Token，并开启 `Gists: write` 权限。</span>
          </div>

          <div class="backup-grid">
            <div class="backup-field">
              <span class="field-label">Gist ID</span>
              <el-input
                v-model="backupForm.gistId"
                placeholder="可留空自动创建"
                clearable
              />
            </div>

            <div class="backup-switch-row">
              <div class="switch-copy">
                <span class="field-label">自动备份</span>
                <span class="field-hint">新增表情包后自动同步</span>
              </div>
              <el-switch v-model="backupForm.autoBackup" />
            </div>
          </div>
        </div>

        <div class="backup-status-card">
          <div class="status-card-head">
            <span class="status-card-title">备份状态</span>
            <span class="status-card-caption">同步信息会保存在本地</span>
          </div>
          <div class="status-row">
            <span class="status-label">当前状态</span>
            <span class="status-value" :class="backupForm.lastBackupStatus">
              {{ getBackupStatusText(backupForm.lastBackupStatus) }}
            </span>
          </div>
          <div class="status-row">
            <span class="status-label">最近结果</span>
            <span class="status-message">{{ backupForm.lastBackupMessage || '暂无备份记录' }}</span>
          </div>
          <div class="status-row">
            <span class="status-label">最近时间</span>
            <span class="status-message">{{ formatBackupTime(backupForm.lastBackupAt) }}</span>
          </div>
          <div v-if="backupForm.gistUrl" class="status-row">
            <span class="status-label">Gist 地址</span>
            <button class="gist-link-btn" @click="openGistLink">{{ backupForm.gistUrl }}</button>
          </div>
        </div>
      </div>
    </el-dialog>
    
    <!-- 插槽内容 -->
    <slot></slot>
  </el-header>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, FolderAdd, Management, Select, Close, ArrowDown } from '@element-plus/icons-vue'
// import JSZip from 'jszip' // 使用动态导入解决兼容性问题
import type { Emoticon } from '@/types'
import TagManager from '@/components/TagManager.vue'
import { useEmoticonStore } from '@/store/emoticon'
import {
  DEFAULT_BACKUP_SETTINGS,
  githubGistBackupService,
  type BackupStatus,
  type GithubGistBackupSettings
} from '@/services/githubGistBackup'

interface Tag {
  id: number
  name: string
}

const props = defineProps<{
  total?: number
  emoticons?: Emoticon[]
  isSelectMode?: boolean
  activeSource?: string
  sourceCount?: Record<string, number>
}>()

const emit = defineEmits<{
  (e: 'search', query: string): void
  (e: 'upload', file: File): void
  (e: 'filter', tagId: number | null, isGif?: boolean): void
  (e: 'tagsUpdated', updatedTags: Tag[], deletedTags: string[]): void
  (e: 'selectMode'): void
  (e: 'sourceFilter', source: string): void
  (e: 'importClicked'): void
}>()

const searchQuery = ref('')
const showTagManager = ref(false)
const tags = ref<Tag[]>([])
const activeTagId = ref<number | null>(null)
const isGifOnly = ref(false)
const selectedTag = ref<number | string | null>(null)
const showTagDropdown = ref(false)
const showSourceDropdown = ref(false)
const currentSource = ref(props.activeSource || 'all')
const showBackupDialog = ref(false)
const backupBusy = ref(false)
const backupForm = ref<GithubGistBackupSettings>({
  ...DEFAULT_BACKUP_SETTINGS
})
const emoticonStore = useEmoticonStore()

// 从 localStorage 加载标签数据
onMounted(() => {
  const savedTags = localStorage.getItem('emoticon-tags')
  if (savedTags) {
    tags.value = JSON.parse(savedTags)
  }

  void loadBackupSettings()
})

// 处理标签更新
const handleTagsUpdated = (updatedTags: Tag[]) => {
  // 找出被删除的标签名称
  const deletedTags = tags.value
    .filter(oldTag => !updatedTags.some(newTag => newTag.id === oldTag.id))
    .map(tag => tag.name)
  
  // 更新本地标签列表
  tags.value = updatedTags
  
  // 如果当前选中的标签被删除，清除筛选
  if (activeTagId.value && !updatedTags.some(tag => tag.id === activeTagId.value)) {
    handleTagSelect(null)
  }
  
  // 发送标签更新事件，包含已删除的标签名称
  emit('tagsUpdated', updatedTags, deletedTags)
}

// 处理标签选择
const handleTagSelect = (value: number | string | null) => {
  if (value === 'gif') {
    isGifOnly.value = true
    activeTagId.value = null
  } else {
    isGifOnly.value = false
    activeTagId.value = value as number | null
  }
  emit('filter', activeTagId.value, isGifOnly.value)
}

// 来源筛选
const sourceOptions = [
  { value: 'all', label: '全部来源' },
  { value: 'local', label: '呼哈表情' },
  { value: 'qq', label: 'QQ 导入' },
  { value: 'wechat', label: '微信导入' },
  { value: 'feishu', label: '飞书导入' }
]

const toggleSourceDropdown = () => {
  showSourceDropdown.value = !showSourceDropdown.value
  if (showSourceDropdown.value) {
    showTagDropdown.value = false
  }
}

const closeAllDropdowns = () => {
  showTagDropdown.value = false
  showSourceDropdown.value = false
}

const selectSource = (source: string) => {
  currentSource.value = source
  showSourceDropdown.value = false
  emit('sourceFilter', source)
}

const getSourceLabel = () => {
  const option = sourceOptions.find(o => o.value === currentSource.value)
  return option ? option.label : '全部来源'
}

const getSourceCount = (source: string) => {
  return props.sourceCount?.[source] ?? 0
}

// 监听 activeSource prop 变化
watch(() => props.activeSource, (val) => {
  if (val) currentSource.value = val
})

// 处理搜索
const handleSearch = () => {
  emit('search', searchQuery.value)
}

// 处理单个文件上传
const handleUpload = async (file: File) => {
  if (!file) {
    ElMessage.error('请选择文件')
    return false
  }
  
  // 验证文件类型
  const isValidType = ['image/png', 'image/jpeg', 'image/gif'].includes(file.type)
  if (!isValidType) {
    ElMessage.error('只支持PNG、JPEG和GIF格式的图片')
    return false
  }
  
  // 验证文件大小（5MB）
  const isLt5M = file.size / 1024 / 1024 < 5
  if (!isLt5M) {
    ElMessage.error('图片大小不能超过5MB')
    return false
  }
  
  emit('upload', file)
  return false
}

// 处理导入按钮点击
const handleImportClick = () => {
  emit('importClicked')
}

// 处理选择模式
const handleSelectMode = () => {
  console.log('AppHeader - 点击选择模式按钮，当前状态:', props.isSelectMode)
  console.log('AppHeader - 即将发送 selectMode 事件')
  emit('selectMode')
}

// 监听 isSelectMode 变化
watch(() => props.isSelectMode, (newVal) => {
  console.log('AppHeader - isSelectMode 状态变化:', newVal)
}, { immediate: true })

// 清除搜索
const clearSearch = () => {
  searchQuery.value = ''
  handleSearch()
}

// 切换标签下拉框
const toggleTagDropdown = () => {
  showTagDropdown.value = !showTagDropdown.value
  if (showTagDropdown.value) {
    showSourceDropdown.value = false
  }
}

// 选择标签
const selectTag = (value: number | string | null) => {
  console.log('选择标签:', value)
  selectedTag.value = value
  showTagDropdown.value = false
  handleTagSelect(value)
}

// 获取选中标签的显示文本
const getSelectedTagLabel = () => {
  if (selectedTag.value === null) return '全部分类'
  if (selectedTag.value === 'gif') return '动图'
  const tag = tags.value.find(t => t.id === selectedTag.value)
  return tag ? tag.name : '选择分类'
}

// 打开标签管理器
const openTagManager = () => {
  showTagManager.value = true
  showTagDropdown.value = false
}

const loadBackupSettings = async () => {
  backupForm.value = await githubGistBackupService.getSettings()
}

const normalizeBackupForm = () => {
  backupForm.value = {
    ...backupForm.value,
    token: backupForm.value.token.trim(),
    gistId: backupForm.value.gistId.trim(),
    gistUrl: backupForm.value.gistUrl.trim()
  }
}

const persistBackupSettings = async () => {
  normalizeBackupForm()

  if (backupForm.value.autoBackup && !backupForm.value.token) {
    throw new Error('开启自动备份前，请先填写 GitHub Token')
  }

  const saved = await githubGistBackupService.saveSettings({
    token: backupForm.value.token,
    gistId: backupForm.value.gistId,
    gistUrl: backupForm.value.gistUrl,
    autoBackup: backupForm.value.autoBackup
  })

  backupForm.value = saved
  return saved
}

const saveBackupConfig = async () => {
  try {
    backupBusy.value = true
    await persistBackupSettings()
    ElMessage.success('备份设置已保存')
  } catch (error) {
    console.error('Failed to save backup config:', error)
    ElMessage.error(error instanceof Error ? error.message : '保存备份设置失败')
  } finally {
    backupBusy.value = false
  }
}

const runManualBackup = async () => {
  try {
    backupBusy.value = true
    await persistBackupSettings()

    if (!emoticonStore.initialized) {
      await emoticonStore.initializeStore()
    }

    const gist = await githubGistBackupService.backupAllEmoticons(emoticonStore.allEmoticons)
    await loadBackupSettings()

    ElMessage.success(
      gist.html_url
        ? `备份完成，已同步到 Gist`
        : '备份完成'
    )
  } catch (error) {
    console.error('Manual backup failed:', error)
    await loadBackupSettings()
    ElMessage.error(error instanceof Error ? error.message : '备份失败，请重试')
  } finally {
    backupBusy.value = false
  }
}

const syncBackupToLocal = async () => {
  try {
    backupBusy.value = true
    await persistBackupSettings()

    if (!emoticonStore.initialized) {
      await emoticonStore.initializeStore()
    }

    const backupItems = await githubGistBackupService.downloadBackupEmoticons()
    await emoticonStore.importBackupEmoticons(backupItems)
    await loadBackupSettings()

    ElMessage.success(`已同步 ${backupItems.length} 个表情包到本地`)
  } catch (error) {
    console.error('Sync backup to local failed:', error)
    await loadBackupSettings()
    ElMessage.error(error instanceof Error ? error.message : '同步到本地失败')
  } finally {
    backupBusy.value = false
  }
}

const openBackupDialog = async () => {
  await loadBackupSettings()
  showBackupDialog.value = true
}

const openGistLink = () => {
  const gistUrl = backupForm.value.gistUrl
  if (!gistUrl) return

  if (window.ztools && (window.ztools as any).shellOpenExternal) {
    ;(window.ztools as any).shellOpenExternal(gistUrl)
  } else {
    window.open(gistUrl, '_blank')
  }
}

const openCreateToken = () => {
  const tokenUrl = 'https://github.com/settings/personal-access-tokens/new?name=BQB%20Gist%20Backup&description=%E7%94%A8%E4%BA%8E%E5%91%BC%E5%93%88%E8%A1%A8%E6%83%85%E5%8C%85%E5%A4%87%E4%BB%BD&gists=write'

  if (window.ztools && (window.ztools as any).shellOpenExternal) {
    ;(window.ztools as any).shellOpenExternal(tokenUrl)
  } else {
    window.open(tokenUrl, '_blank')
  }
}

const getBackupStatusText = (status: BackupStatus) => {
  if (status === 'running') return '进行中'
  if (status === 'success') return '成功'
  if (status === 'error') return '失败'
  return '未开始'
}

const formatBackupTime = (timestamp: number | null) => {
  if (!timestamp) return '暂无'
  return new Date(timestamp).toLocaleString('zh-CN')
}
</script>

<style scoped lang="scss">
.app-header {
  background: var(--el-bg-color);
  border-radius: 16px;
  overflow: visible;
  margin: 8px;
  position: relative;
  z-index: 20;

  :global([data-theme="dark"]) &,
          :global(html.dark) & {
    background: var(--el-bg-color);
  }
}

.header-wrapper {
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  padding: 8px 12px;
  gap: 8px;
  overflow: visible;

  .search-box {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: visible;

    .search-filter {
      display: flex;
      flex-wrap: nowrap;
      gap: 6px;
      align-items: center;
      width: 100%;
      min-width: 0;
      overflow: visible;

      // 自定义椭圆形搜索框
      .custom-search-input {
        position: relative;
        display: flex;
        align-items: center;
        flex: 1 1 auto;
        min-width: 100px;
        max-width: 180px;
        height: 32px;
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 0 12px;
        transition: all 0.2s ease;

        &:hover {
          border-color: #cbd5e1;
          background-color: #f1f5f9;
        }

        &:focus-within {
          border-color: #3b82f6;
          background-color: #ffffff;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .search-icon {
          color: #64748b;
          font-size: 14px;
          margin-right: 6px;
          flex-shrink: 0;
        }

        .search-field {
          flex: 1;
          min-width: 0;
          border: none;
          outline: none;
          background: transparent;
          font-size: 13px;
          color: #1e293b;

          &::placeholder {
            color: #94a3b8;
          }
        }

        .clear-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          padding: 2px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;

          &:hover {
            color: #64748b;
            background-color: #e2e8f0;
          }

          .el-icon {
            font-size: 12px;
          }
        }

        // 暗黑模式适配
        :global([data-theme="dark"]) &,
        :global(html.dark) & {
          background-color: rgba(30, 41, 59, 0.6);
          border-color: rgba(100, 116, 139, 0.4);

          &:hover {
            border-color: rgba(100, 116, 139, 0.6);
            background-color: rgba(30, 41, 59, 0.8);
          }

          &:focus-within {
            border-color: #3b82f6;
            background-color: rgba(30, 41, 59, 0.9);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
          }

          .search-icon {
            color: #94a3b8;
          }

          .search-field {
            color: #f1f5f9;

            &::placeholder {
              color: #64748b;
            }
          }

          .clear-btn {
            color: #64748b;

            &:hover {
              color: #94a3b8;
              background-color: rgba(100, 116, 139, 0.3);
            }
          }
        }
      }

      // 自定义分类选择器
      .custom-select-wrapper {
        position: relative;
        flex-shrink: 0;
        z-index: 1001;

        .custom-select-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 32px;
          padding: 0 8px;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          color: #475569;
          transition: all 0.2s ease;
          outline: none;
          width: 100px;
          flex-shrink: 0;

          &:hover {
            border-color: #cbd5e1;
            background-color: #f1f5f9;
          }

          &.active {
            border-color: #3b82f6;
            background-color: #ffffff;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }

          .select-text {
            flex: 1;
            min-width: 0;
            text-align: left;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .dropdown-icon {
            font-size: 12px;
            color: #64748b;
            transition: transform 0.2s ease;

            &.rotate {
              transform: rotate(180deg);
            }
          }

          // 暗黑模式适配
          :global([data-theme="dark"]) &,
          :global(html.dark) & {
            background-color: rgba(30, 41, 59, 0.6);
            border-color: rgba(100, 116, 139, 0.4);
            color: #cbd5e1;

            &:hover {
              border-color: rgba(100, 116, 139, 0.6);
              background-color: rgba(30, 41, 59, 0.8);
            }

            &.active {
              border-color: #3b82f6;
              background-color: rgba(30, 41, 59, 0.9);
              box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
            }

            .dropdown-icon {
              color: #94a3b8;
            }
          }
        }

        // 下拉选项
        .custom-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 1000;
          margin-top: 4px;
          overflow: hidden;

          .dropdown-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 14px;
            color: #475569;
            transition: background-color 0.2s ease;

            &:hover {
              background-color: #f8fafc;
            }

            &.manage-item {
              color: #3b82f6;

              &:hover {
                background-color: #eff6ff;
              }
            }

            span {
              flex: 1;
            }
          }

          .dropdown-divider {
            height: 1px;
            background-color: #e2e8f0;
            margin: 4px 0;
          }

          // 暗黑模式适配
          :global([data-theme="dark"]) &,
          :global(html.dark) & {
            background: rgba(30, 41, 59, 0.98);
            border-color: rgba(100, 116, 139, 0.4);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);

            .dropdown-item {
              color: #cbd5e1;

              &:hover {
                background-color: rgba(51, 65, 85, 0.6);
              }

              &.manage-item {
                color: #60a5fa;

                &:hover {
                  background-color: rgba(59, 130, 246, 0.2);
                }
              }
            }

            .dropdown-divider {
              background-color: rgba(100, 116, 139, 0.4);
            }
          }
        }
      }

      // 来源筛选下拉
      .source-select-wrapper {
        position: relative;
        flex-shrink: 0;
        z-index: 1001;

        .source-btn {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 32px;
          padding: 0 8px;
          background-color: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          color: #475569;
          transition: all 0.2s ease;
          outline: none;
          min-width: 72px;

          &:hover {
            border-color: #cbd5e1;
            background-color: #f1f5f9;
          }

          &.active {
            border-color: #3b82f6;
            background-color: #ffffff;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
          }

          .select-text {
            flex: 1;
            text-align: left;
            white-space: nowrap;
          }

          .dropdown-icon {
            font-size: 12px;
            color: #64748b;
            transition: transform 0.2s ease;

            &.rotate {
              transform: rotate(180deg);
            }
          }

          :global([data-theme="dark"]) &,
          :global(html.dark) & {
            background-color: rgba(30, 41, 59, 0.6);
            border-color: rgba(100, 116, 139, 0.4);
            color: #cbd5e1;

            &:hover {
              border-color: rgba(100, 116, 139, 0.6);
              background-color: rgba(30, 41, 59, 0.8);
            }

            &.active {
              border-color: #3b82f6;
              background-color: rgba(30, 41, 59, 0.9);
              box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
            }

            .dropdown-icon {
              color: #94a3b8;
            }
          }
        }

        .source-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          z-index: 1000;
          margin-top: 4px;
          overflow: hidden;
          min-width: 120px;

          .dropdown-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-size: 13px;
            color: #475569;
            transition: background-color 0.2s ease;

            &:hover {
              background-color: #f8fafc;
            }

            &.active-source {
              color: #3b82f6;
              font-weight: 500;
              background-color: #eff6ff;
            }

            .item-count {
              font-size: 11px;
              color: #94a3b8;
              background: #f1f5f9;
              padding: 1px 6px;
              border-radius: 10px;
              min-width: 20px;
              text-align: center;
            }
          }

          :global([data-theme="dark"]) &,
          :global(html.dark) & {
            background: rgba(30, 41, 59, 0.98);
            border-color: rgba(100, 116, 139, 0.4);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);

            .dropdown-item {
              color: #cbd5e1;

              &:hover {
                background-color: rgba(51, 65, 85, 0.6);
              }

              &.active-source {
                color: #60a5fa;
                background-color: rgba(59, 130, 246, 0.15);
              }

              .item-count {
                background: rgba(100, 116, 139, 0.3);
                color: #94a3b8;
              }
            }
          }
        }
      }
    }

    // 下拉遮罩层
    .dropdown-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
    }
  }

  .action-buttons {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 6px;
    align-items: center;
    margin-left: auto;
    flex-shrink: 0;

    // 上传组件包装器
    .upload-wrapper {
      :deep(.el-upload) {
        display: block;
      }
    }

    // 扁平按钮基础样式
    .flat-btn {
      height: 32px;
      padding: 0 10px;
      border: 1px solid transparent;
      border-radius: 9px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s ease;
      outline: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 46px;
      white-space: nowrap;
      
      .btn-text {
        line-height: 1;
      }
      
      // 统一蓝色按钮样式（添加、导入、备份）
      &.primary,
      &.success,
      &.backup-btn {
        background-color: #2563eb;
        border-color: #2563eb;
        color: #ffffff;

        &:hover {
          background-color: #1d4ed8;
          border-color: #1d4ed8;
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(37, 99, 235, 0.22);
        }

        &:active {
          background-color: #1e40af;
          border-color: #1e40af;
          transform: translateY(0);
        }

        :global([data-theme="dark"]) &,
          :global(html.dark) & {
          background-color: #3b82f6;
          border-color: #3b82f6;

          &:hover {
            background-color: #2563eb;
            border-color: #2563eb;
            box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);
          }

          &:active {
            background-color: #1d4ed8;
            border-color: #1d4ed8;
          }
        }
      }
      
    }
    
    // 选择按钮 - 统一蓝色（与 primary/success/backup-btn 一致）
    .flat-btn.select-btn {
      background-color: #2563eb;
      border-color: #2563eb;
      color: #ffffff;

      &:hover:not(:disabled) {
        background-color: #1d4ed8;
        border-color: #1d4ed8;
        transform: translateY(-1px);
        box-shadow: 0 4px 10px rgba(37, 99, 235, 0.22);
      }

      &:active {
        background-color: #1e40af;
        border-color: #1e40af;
        transform: translateY(0);
      }

      // 禁用状态
      &:disabled {
        background-color: #f1f5f9;
        color: #cbd5e1;
        cursor: not-allowed;
        transform: none;
        box-shadow: none;
        border-color: transparent;

        &:hover {
          transform: none;
          box-shadow: none;
        }
      }

      // 暗黑模式
      :global([data-theme="dark"]) &,
      :global(html.dark) & {
        background-color: #3b82f6;
        border-color: #3b82f6;

        &:hover:not(:disabled) {
          background-color: #2563eb;
          border-color: #2563eb;
          box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);
        }

        &:active {
          background-color: #1d4ed8;
          border-color: #1d4ed8;
        }

        &:disabled {
          background-color: rgba(51, 65, 85, 0.5);
          color: #64748b;
          border-color: transparent;
        }
      }
    }
  }

  // 添加响应式布局 - 紧凑模式，确保单行显示
  @media screen and (max-width: 768px) {
    .search-box .search-filter {
      .custom-search-input {
        max-width: 140px;
        min-width: 80px;
      }

      .custom-select-wrapper,
      .source-select-wrapper {
        .custom-select-btn,
        .source-btn {
          min-width: 60px;
          padding: 0 6px;
          font-size: 12px;
        }
      }
    }

    .action-buttons .flat-btn {
      min-width: 40px;
      padding: 0 8px;
      font-size: 12px;
    }
  }

  // 中等屏幕适配
  @media screen and (max-width: 1024px) {
    .search-box .search-filter {
      .custom-search-input {
        max-width: 160px;
      }
    }
  }
}

// 确保头部不会被压缩
:deep(.el-header) {
  flex-shrink: 0;
  border-bottom: 1px solid var(--el-border-color-light);
  border-radius: 16px;
  background-color: var(--el-bg-color);
  position: relative;
  z-index: 1;
  margin: 8px;
}

.backup-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;

  .backup-tip {
    padding: 7px 11px;
    border-radius: 16px;
    background: linear-gradient(180deg, #f8fbff 0%, #f1f5f9 100%);
    border: 1px solid #dbe5f0;
    color: #526277;
    font-size: 12px;
    line-height: 1.45;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(30, 41, 59, 0.6) 100%);
      border-color: rgba(100, 116, 139, 0.4);
      color: #94a3b8;
    }
  }

  .backup-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 20px;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    border: 1px solid #e2e8f0;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(30, 41, 59, 0.4) 100%);
      border-color: rgba(100, 116, 139, 0.4);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
  }

  .backup-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .backup-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: stretch;

    @media (max-width: 560px) {
      grid-template-columns: 1fr;
    }
  }

  .field-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #f1f5f9;
    }
  }

  .field-hint {
    font-size: 12px;
    color: #64748b;
    line-height: 1.4;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #94a3b8;
    }
  }

  .mini-link-btn {
    padding: 0;
    border: none;
    background: transparent;
    color: #2563eb;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;

    &:hover {
      color: #1d4ed8;
      text-decoration: underline;
    }

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #60a5fa;

      &:hover {
        color: #93c5fd;
      }
    }
  }

  .backup-switch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    min-width: 146px;

    .switch-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      background: rgba(51, 65, 85, 0.5);
      border-color: rgba(100, 116, 139, 0.4);
    }
  }

  .backup-status-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px;
    border-radius: 20px;
    background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
    border: 1px solid #e2e8f0;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75);

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      background: linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(30, 41, 59, 0.4) 100%);
      border-color: rgba(100, 116, 139, 0.4);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }
  }

  .status-card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 6px;
    margin-bottom: 2px;
    border-bottom: 1px solid #e2e8f0;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      border-bottom-color: rgba(100, 116, 139, 0.4);
    }
  }

  .status-card-title {
    font-size: 13px;
    font-weight: 700;
    color: #0f172a;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #f1f5f9;
    }
  }

  .status-card-caption {
    font-size: 11px;
    color: #64748b;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #94a3b8;
    }
  }

  .status-row {
    display: grid;
    grid-template-columns: 56px minmax(0, 1fr);
    align-items: flex-start;
    gap: 8px;
    padding: 4px 0;
  }

  .status-label {
    font-size: 12px;
    color: #64748b;
    line-height: 1.5;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #94a3b8;
    }
  }

  .status-value,
  .status-message {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: #1e293b;
    line-height: 1.5;
    word-break: break-all;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #e2e8f0;
    }
  }

  .status-value {
    &.running {
      color: #2563eb;

      :global([data-theme="dark"]) &,
          :global(html.dark) & {
        color: #60a5fa;
      }
    }

    &.success {
      color: #059669;

      :global([data-theme="dark"]) &,
          :global(html.dark) & {
        color: #34d399;
      }
    }

    &.error {
      color: #dc2626;

      :global([data-theme="dark"]) &,
          :global(html.dark) & {
        color: #f87171;
      }
    }
  }

  .gist-link-btn {
    padding: 0;
    border: none;
    background: transparent;
    color: #2563eb;
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    line-height: 1.5;
    word-break: break-all;

    &:hover {
      color: #1d4ed8;
      text-decoration: underline;
    }

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #60a5fa;

      &:hover {
        color: #93c5fd;
      }
    }
  }

  :deep(.el-input__wrapper) {
    min-height: 34px;
    padding: 0 10px;
    border-radius: 12px;
    box-shadow: 0 0 0 1px #d7dee7 inset;
  }

  :deep(.el-input__inner) {
    font-size: 12px;
  }
}

.backup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  flex-wrap: wrap;
}

.backup-actions-top {
  padding-bottom: 0;
}

.dialog-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: all 0.2s ease;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #ffffff;

    &:hover:not(:disabled) {
      background: #1d4ed8;
      border-color: #1d4ed8;
    }
  }
}

:deep(.backup-dialog .el-dialog) {
  border-radius: 24px;
  overflow: hidden;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  margin-top: 0 !important;
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;

  :global([data-theme="dark"]) &,
          :global(html.dark) & {
    background: linear-gradient(180deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%);
  }
}

:deep(.backup-dialog .el-dialog__header) {
  padding: 16px 18px 0;

  .el-dialog__title {
    color: #1e293b;

    :global([data-theme="dark"]) &,
          :global(html.dark) & {
      color: #f1f5f9;
    }
  }
}

:deep(.backup-dialog .el-dialog__body) {
  padding: 10px 18px 16px;
  border-radius: 0 0 24px 24px;
  overflow-y: auto;
}
</style>
