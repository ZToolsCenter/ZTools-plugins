import { ref, computed } from 'vue'
import type { Favorite } from '../types'

const favorites = ref<Favorite[]>([])

export function useFavorites() {
  /**
   * 加载所有收藏
   */
  const loadFavorites = () => {
    const docs = window.ztools.db.allDocs<Favorite>('fav_')
    favorites.value = docs.map(doc => ({
      ...doc,
      type: 'favorite' as const
    }))
  }

  /**
   * 检查是否已收藏
   */
  const isFavorited = (instanceId: string, jobName: string): boolean => {
    return favorites.value.some(
      f => f.instanceId === instanceId && f.jobName === jobName
    )
  }

  /**
   * 添加收藏
   */
  const addFavorite = (instanceId: string, instanceName: string, jobName: string, viewName: string = 'all'): boolean => {
    if (isFavorited(instanceId, jobName)) {
      return false
    }

    const favorite: Favorite = {
      _id: `fav_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'favorite',
      instanceId,
      instanceName,
      jobName,
      viewName,
      addedAt: Date.now()
    }

    window.ztools.db.put(favorite)
    favorites.value.push(favorite)
    return true
  }

  /**
   * 移除收藏
   */
  const removeFavorite = (instanceId: string, jobName: string): boolean => {
    const index = favorites.value.findIndex(
      f => f.instanceId === instanceId && f.jobName === jobName
    )

    if (index === -1) return false

    const favorite = favorites.value[index]
    window.ztools.db.remove(favorite._id)
    favorites.value.splice(index, 1)
    return true
  }

  /**
   * 切换收藏状态
   */
  const toggleFavorite = (instanceId: string, instanceName: string, jobName: string, viewName: string = 'all'): boolean => {
    if (isFavorited(instanceId, jobName)) {
      removeFavorite(instanceId, jobName)
      return false
    } else {
      addFavorite(instanceId, instanceName, jobName, viewName)
      return true
    }
  }

  /**
   * 按实例筛选收藏
   */
  const favoritesByInstance = computed(() => {
    return (instanceId: string) => favorites.value.filter(f => f.instanceId === instanceId)
  })

  /**
   * 获取收藏总数
   */
  const totalCount = computed(() => favorites.value.length)

  return {
    favorites,
    loadFavorites,
    isFavorited,
    addFavorite,
    removeFavorite,
    toggleFavorite,
    favoritesByInstance,
    totalCount
  }
}
