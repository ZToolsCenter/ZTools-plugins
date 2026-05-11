import { ref } from 'vue'
import { FAVORITE_STORAGE_KEY } from '@/constants'

export function useFavorites() {
  const favorites = ref([])

  const loadFavorites = async () => {
    try {
      const data = await window.ztools.db.promises.get(FAVORITE_STORAGE_KEY)
      if (data && Array.isArray(data.favorites)) {
        favorites.value = data.favorites
      }
    } catch (error) {
      console.error('加载收藏列表失败:', error)
    }
  }

  const saveFavorites = async () => {
    try {
      const record = await window.ztools.db.promises.get(FAVORITE_STORAGE_KEY)
      await window.ztools.db.promises.put({
        _id: FAVORITE_STORAGE_KEY,
        _rev: record?._rev,
        favorites: JSON.parse(JSON.stringify(favorites.value))
      })
    } catch (error) {
      console.error('保存收藏列表失败:', error)
    }
  }

  const addFavorite = async (item, remark) => {
    const favoriteItem = {
      ...item,
      remark,
      favoriteTime: Date.now()
    }
    favorites.value.unshift(favoriteItem)
    await saveFavorites()
  }

  const deleteFavorite = async (index) => {
    favorites.value.splice(index, 1)
    await saveFavorites()
  }

  return {
    favorites,
    loadFavorites,
    saveFavorites,
    addFavorite,
    deleteFavorite
  }
}
