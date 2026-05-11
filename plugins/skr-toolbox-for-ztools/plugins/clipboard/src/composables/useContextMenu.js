import { ref } from 'vue'

export function useContextMenu() {
  const contextMenu = ref({
    show: false,
    x: 0,
    y: 0,
    item: null
  })

  const showContextMenu = (event, item, activeTab) => {
    // 收藏Tab不支持右键菜单
    if (activeTab === 'favorite') return

    event.preventDefault()
    contextMenu.value = {
      show: true,
      x: event.clientX,
      y: event.clientY,
      item: item
    }
  }

  const hideContextMenu = () => {
    contextMenu.value.show = false
  }

  return {
    contextMenu,
    showContextMenu,
    hideContextMenu
  }
}
