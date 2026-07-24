import { ref } from 'vue'

export function useFavoriteDialog() {
  const favoriteDialog = ref({
    show: false,
    remark: '',
    item: null
  })

  const openFavoriteDialog = (item) => {
    favoriteDialog.value = {
      show: true,
      remark: '',
      item: item
    }
  }

  /**
   * 确认收藏
   * @param {Function} addFn - 添加收藏的函数 (item, remark) => Promise
   * @param {string} remark - 收藏备注
   */
  const confirmFavorite = async (addFn, remark = '') => {
    if (!favoriteDialog.value.item) return
    await addFn(favoriteDialog.value.item, remark.trim())
    favoriteDialog.value.show = false
    favoriteDialog.value.remark = ''
    favoriteDialog.value.item = null
  }

  const cancelFavoriteDialog = () => {
    favoriteDialog.value.show = false
    favoriteDialog.value.remark = ''
    favoriteDialog.value.item = null
  }

  return {
    favoriteDialog,
    openFavoriteDialog,
    confirmFavorite,
    cancelFavoriteDialog
  }
}
