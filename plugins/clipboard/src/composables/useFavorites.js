import { ref } from 'vue'
import { FAVORITE_STORAGE_KEY } from '@/constants'

export function useFavorites() {
  const favorites = ref([])
  let saveQueue = Promise.resolve()
  let mutationVersion = 0

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
    const snapshot = JSON.parse(JSON.stringify(favorites.value))
    const saveOperation = saveQueue.then(async () => {
      const record = await window.ztools.db.promises.get(FAVORITE_STORAGE_KEY)
      await window.ztools.db.promises.put({
        _id: FAVORITE_STORAGE_KEY,
        _rev: record?._rev,
        favorites: snapshot
      })
    })

    // Keep later writes running even if one database operation fails.
    saveQueue = saveOperation.catch(() => {})

    try {
      await saveOperation
      return true
    } catch (error) {
      console.error('保存收藏列表失败:', error)
      return false
    }
  }

  const addFavorite = async (item, remark) => {
    const favoriteItem = {
      ...item,
      remark,
      favoriteTime: Date.now()
    }
    favorites.value.unshift(favoriteItem)
    mutationVersion++
    await saveFavorites()
  }

  const deleteFavorites = async (items) => {
    const targets = new Set(items)
    const previousItems = favorites.value.slice()
    const remainingItems = favorites.value.filter(item => !targets.has(item))
    if (remainingItems.length === favorites.value.length) return false

    favorites.value.splice(0, favorites.value.length, ...remainingItems)
    const currentVersion = ++mutationVersion
    const saved = await saveFavorites()

    if (!saved && mutationVersion === currentVersion) {
      favorites.value.splice(0, favorites.value.length, ...previousItems)
    }

    return saved
  }

  const deleteFavorite = async (index) => {
    const item = favorites.value[index]
    if (!item) return false
    return deleteFavorites([item])
  }

  const moveFavorite = async (fromIndex, toIndex) => {
    const lastIndex = favorites.value.length - 1
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      fromIndex > lastIndex ||
      toIndex < 0 ||
      toIndex > lastIndex ||
      fromIndex === toIndex
    ) {
      return false
    }

    const previousOrder = favorites.value.slice()
    const [movedItem] = favorites.value.splice(fromIndex, 1)
    favorites.value.splice(toIndex, 0, movedItem)
    const currentVersion = ++mutationVersion
    const saved = await saveFavorites()

    if (!saved && mutationVersion === currentVersion) {
      // Mutate in place so consumers holding the array reference also roll back.
      favorites.value.splice(0, favorites.value.length, ...previousOrder)
    }

    return saved
  }

  return {
    favorites,
    loadFavorites,
    saveFavorites,
    addFavorite,
    deleteFavorite,
    deleteFavorites,
    moveFavorite
  }
}
