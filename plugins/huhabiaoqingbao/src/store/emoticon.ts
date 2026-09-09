import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import type { Emoticon } from '../types'
import type { Tag } from '../types/index'
import { storageService } from '@/services/storage'
import { fileSystemService } from '@/utils/fileSystem'
import { githubGistBackupService, type BackupRestoreItem } from '@/services/githubGistBackup'

const EMOTICONS_DOC_ID = 'emoticons_list'
const EMOTICON_PREFIX = 'emoticon_'
const CUSTOM_TAGS_DOC_ID = 'custom_tags'

interface EmoticonDoc {
  _id: string
  _rev?: string
  data: Array<{
    id: string
    name: string
    tags: string[]
    favorite: boolean
    createdAt: number
  }>
}

interface EmoticonFileDoc {
  _id: string
  _rev?: string
  type: string
  data: number[] | Uint8Array // 支持两种类型
}

export const useEmoticonStore = defineStore('emoticon', () => {
  const emoticons = ref<Emoticon[]>([])
  const customTags = ref<string[]>([])
  const allTags = ref<{ name: string; count: number }[]>([])
  const loading = ref(false)
  const initialized = ref(false)

  // 计算属性
  const allEmoticons = computed(() => {
    // 返回按时间倒序排序的表情包列表
    return [...emoticons.value].sort((a, b) => b.createdAt - a.createdAt)
  })

  const favoriteEmoticons = computed(() => 
    // 收藏的表情包也按时间倒序排列
    emoticons.value
      .filter(e => e.favorite)
      .sort((a, b) => b.createdAt - a.createdAt)
  )

  // 搜索方法
  const searchEmoticons = (query: string) => {
    if (!query) return allEmoticons.value
    const lowerQuery = query.toLowerCase()
    return emoticons.value
      .filter(e =>
        e.name.toLowerCase().includes(lowerQuery) ||
        e.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  // 按来源分组计数
  const sourceCount = computed(() => {
    const counts: Record<string, number> = { all: 0, local: 0, qq: 0, wechat: 0, feishu: 0 }
    emoticons.value.forEach(e => {
      const src = e.source || 'local'
      if (counts[src] !== undefined) counts[src]++
      counts.all++
    })
    return counts
  })

  // 按来源筛选
  const filterBySource = (source: string): Emoticon[] => {
    if (source === 'all') return allEmoticons.value
    return emoticons.value
      .filter(e => (e.source || 'local') === source)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async function initializeStore() {
    if (initialized.value) return
    
    loading.value = true
    try {
      // 初始化存储服务（这会自动从文件系统恢复数据）
      await storageService.init()
      // 加载所有表情包
      emoticons.value = await storageService.getAllEmoticons()
      initialized.value = true
    } catch (error) {
      console.error('Failed to initialize emoticon store:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function refreshEmoticons() {
    try {
      emoticons.value = await storageService.getAllEmoticons()
    } catch (error) {
      console.error('Failed to refresh emoticons:', error)
    }
  }

  async function addEmoticon(emoticon: Emoticon, file: Blob) {
    try {
      const savedEmoticon = await storageService.saveEmoticon(emoticon, file)
      const index = emoticons.value.findIndex(item => item.id === savedEmoticon.id)
      if (index >= 0) {
        emoticons.value.splice(index, 1, savedEmoticon)
      } else {
        emoticons.value.push(savedEmoticon)
      }

      githubGistBackupService
        .autoBackupNewEmoticon(savedEmoticon, file, allEmoticons.value)
        .catch(error => {
          console.error('Automatic GitHub Gist backup failed:', error)
        })
    } catch (error) {
      console.error('Failed to add emoticon:', error)
      throw error
    }
  }

  async function addEmoticons(items: { emoticon: Emoticon; file: Blob }[]) {
    try {
      const savedEmoticons = await storageService.saveEmoticons(items)
      const existingIds = new Set(savedEmoticons.map(item => item.id))

      emoticons.value = [
        ...emoticons.value.filter(item => !existingIds.has(item.id)),
        ...savedEmoticons
      ]
    } catch (error) {
      console.error('Failed to add emoticons:', error)
      throw error
    }
  }

  async function toggleFavorite(emoticon: Emoticon): Promise<Emoticon> {
    try {
      // 创建一个干净的对象副本，只包含需要的属性
      const updatedEmoticon = {
        id: emoticon.id,
        name: emoticon.name,
        url: emoticon.url,
        type: emoticon.type,
        source: emoticon.source || 'local',
        favorite: !emoticon.favorite,
        createdAt: emoticon.createdAt,
        createTime: emoticon.createTime,
        updateTime: Date.now(),
        tags: Array.from(emoticon.tags || [])
      };
      
      // 先更新数据库
      await storageService.updateEmoticon(updatedEmoticon);
      
      // 成功后更新状态
      const index = emoticons.value.findIndex(e => e.id === emoticon.id);
      if (index !== -1) {
        // 使用新对象替换旧对象，触发响应式更新
        emoticons.value.splice(index, 1, updatedEmoticon);
      }
      
      // 返回更新后的对象
      return updatedEmoticon;
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
      throw error;
    }
  }

  async function deleteEmoticon(id: string) {
    try {
      await storageService.deleteEmoticon(id)
      emoticons.value = emoticons.value.filter(e => e.id !== id)
    } catch (error) {
      console.error('Failed to delete emoticon:', error)
      throw error
    }
  }

  async function deleteEmoticons(ids: string[]) {
    try {
      await storageService.deleteEmoticons(ids)
      const idSet = new Set(ids)
      emoticons.value = emoticons.value.filter(e => !idSet.has(e.id))
    } catch (error) {
      console.error('Failed to delete emoticons:', error)
      throw error
    }
  }

  // 清空全部表情包
  async function clearAllEmoticons() {
    try {
      await storageService.clearAllEmoticons()
      // 清理所有URL
      clearURLs()
      // 清空本地状态
      emoticons.value = []
    } catch (error) {
      console.error('Failed to clear all emoticons:', error)
      throw error
    }
  }

  async function updateEmoticon(emoticon: Emoticon) {
    try {
      await storageService.updateEmoticon(emoticon)
      const index = emoticons.value.findIndex(item => item.id === emoticon.id)
      if (index >= 0) {
        emoticons.value.splice(index, 1, emoticon)
      }
    } catch (error) {
      console.error('Failed to update emoticon:', error)
      throw error
    }
  }

  async function updateEmoticons(updatedEmoticons: Emoticon[]) {
    try {
      await storageService.updateEmoticons(updatedEmoticons)
      const updatedById = new Map(updatedEmoticons.map(emoticon => [emoticon.id, emoticon]))
      emoticons.value = emoticons.value.map(emoticon => updatedById.get(emoticon.id) || emoticon)
    } catch (error) {
      console.error('Failed to update emoticons:', error)
      throw error
    }
  }

  async function importBackupEmoticons(items: BackupRestoreItem[]) {
    try {
      await addEmoticons(items)
    } catch (error) {
      console.error('Failed to import backup emoticons:', error)
      throw error
    }
  }

  function clearURLs() {
    emoticons.value.forEach(emoticon => {
      if (emoticon.url?.startsWith('blob:')) {
        URL.revokeObjectURL(emoticon.url)
      }
    })
  }

  return {
    emoticons,
    customTags,
    allTags,
    loading,
    initialized,
    allEmoticons,
    favoriteEmoticons,
    sourceCount,
    searchEmoticons,
    filterBySource,
    initializeStore,
    refreshEmoticons,
    addEmoticon,
    addEmoticons,
    toggleFavorite,
    deleteEmoticon,
    deleteEmoticons,
    clearAllEmoticons,
    updateEmoticon,
    updateEmoticons,
    importBackupEmoticons,
    clearURLs
  }
})

// 工具函数：生成唯一ID
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
} 
