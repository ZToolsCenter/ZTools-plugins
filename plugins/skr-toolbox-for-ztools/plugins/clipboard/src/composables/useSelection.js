import { ref } from 'vue'

/**
 * @param {import('vue').ComputedRef<Array>} filteredData
 * @param {import('vue').ComputedRef<Array>} tabs
 * @param {import('vue').Ref<string>} activeTab
 * @param {Function} copyToClipboard - (id, shouldPaste) => Promise
 */
export function useSelection(filteredData, tabs, activeTab, copyToClipboard) {
  const selectedIndex = ref(0)
  const clipboardListRef = ref(null)

  const resetSelection = () => {
    selectedIndex.value = 0
  }

  const getContainerEl = () => {
    const ref = clipboardListRef.value
    if (!ref) return null
    // 支持组件实例（通过 $el）和原生 DOM 元素
    return ref.$el || ref
  }

  const scrollToSelectedItem = (direction = 'down') => {
    setTimeout(() => {
      const selectedElement = document.querySelector('.clipboard-item.selected')
      const container = getContainerEl()
      if (selectedElement && container) {
        const containerRect = container.getBoundingClientRect()
        const elementRect = selectedElement.getBoundingClientRect()

        if (direction === 'down') {
          const isBelowViewport = elementRect.bottom > containerRect.bottom
          if (isBelowViewport) {
            const scrollOffset = elementRect.bottom - containerRect.bottom + 10
            container.scrollTop += scrollOffset
          }
        } else {
          const isAboveViewport = elementRect.top < containerRect.top
          if (isAboveViewport) {
            const scrollOffset = elementRect.top - containerRect.top - 10
            container.scrollTop += scrollOffset
          }
        }
      }
    }, 0)
  }

  const handleKeydown = (event) => {
    // 左右键切换Tab
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const currentIndex = tabs.value.findIndex(tab => tab.key === activeTab.value)
      let nextIndex

      if (event.key === 'ArrowLeft') {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : tabs.value.length - 1
      } else {
        nextIndex = currentIndex < tabs.value.length - 1 ? currentIndex + 1 : 0
      }

      activeTab.value = tabs.value[nextIndex].key
      resetSelection()
    }

    // 上下键切换选中项
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const maxIndex = filteredData.value.length - 1
      const direction = event.key === 'ArrowDown' ? 'down' : 'up'

      if (event.key === 'ArrowUp') {
        if (selectedIndex.value > 0) {
          selectedIndex.value = selectedIndex.value - 1
        }
      } else {
        if (selectedIndex.value < maxIndex) {
          selectedIndex.value = selectedIndex.value + 1
        }
      }

      scrollToSelectedItem(direction)
    }

    // 回车键复制选中项
    if (event.key === 'Enter') {
      event.preventDefault()
      const selectedItem = filteredData.value[selectedIndex.value]
      if (selectedItem) {
        copyToClipboard(selectedItem.id)
      }
    }
  }

  // 复制选中项（不粘贴）
  const copySelected = async () => {
    const selectedItem = filteredData.value[selectedIndex.value]
    if (selectedItem) {
      await copyToClipboard(selectedItem.id, false)
    }
  }

  // 粘贴选中项（复制并粘贴）
  const pasteSelected = async () => {
    const selectedItem = filteredData.value[selectedIndex.value]
    if (selectedItem) {
      await copyToClipboard(selectedItem.id, true)
    }
  }

  return {
    selectedIndex,
    clipboardListRef,
    resetSelection,
    handleKeydown,
    scrollToSelectedItem,
    copySelected,
    pasteSelected
  }
}
