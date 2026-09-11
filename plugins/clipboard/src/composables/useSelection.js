import { computed, ref, watch } from 'vue'
import {
  clearNativeTextSelection,
  hasNativeTextSelection,
  shouldUseNativeCopy
} from '../utils/nativeCopy.js'

/**
 * @param {import('vue').ComputedRef<Array>} filteredData
 * @param {import('vue').ComputedRef<Array>} tabs
 * @param {import('vue').Ref<string>} activeTab
 * @param {Function} writeItems - (items, shouldPaste) => Promise
 * @param {Function} [onDeleteItems] - (items) => void
 */
export function useSelection(filteredData, tabs, activeTab, writeItems, onDeleteItems) {
  const activeItem = ref(null)
  const selectionAnchor = ref(null)
  const selectedItemSet = ref(new Set())
  const clipboardListRef = ref(null)

  const activeIndex = computed(() => filteredData.value.indexOf(activeItem.value))
  const selectedItems = computed(() => {
    const visibleItems = new Set(filteredData.value)
    return [...selectedItemSet.value].filter(item => visibleItems.has(item))
  })
  const selectedCount = computed(() => selectedItems.value.length)

  const replaceSelection = (items, active = items[0] || null, anchor = active) => {
    selectedItemSet.value = new Set(items)
    activeItem.value = active
    selectionAnchor.value = anchor
  }

  const selectSingle = (index) => {
    const item = filteredData.value[index]
    if (!item) return
    replaceSelection([item], item, item)
  }

  const resetSelection = () => {
    replaceSelection([])
  }

  const syncSelection = (items) => {
    if (items.length === 0) {
      resetSelection()
      return
    }

    const visibleItems = new Set(items)
    const retainedItems = [...selectedItemSet.value].filter(item => visibleItems.has(item))
    if (retainedItems.length === 0) {
      replaceSelection([items[0]], items[0], items[0])
      return
    }

    selectedItemSet.value = new Set(retainedItems)
    if (!visibleItems.has(activeItem.value)) {
      activeItem.value = retainedItems.at(-1)
    }
    if (!visibleItems.has(selectionAnchor.value)) {
      selectionAnchor.value = activeItem.value
    }
  }

  watch(() => filteredData.value.slice(), syncSelection, { immediate: true })

  const selectRange = (index) => {
    const item = filteredData.value[index]
    const anchorIndex = filteredData.value.indexOf(selectionAnchor.value)
    if (!item || anchorIndex < 0 || selectionAnchor.value.type !== item.type) {
      selectSingle(index)
      return
    }

    const direction = anchorIndex <= index ? 1 : -1
    const rangeItems = []
    for (
      let rangeIndex = anchorIndex;
      direction > 0 ? rangeIndex <= index : rangeIndex >= index;
      rangeIndex += direction
    ) {
      const rangeItem = filteredData.value[rangeIndex]
      if (rangeItem.type === item.type) rangeItems.push(rangeItem)
    }

    replaceSelection(rangeItems, item, selectionAnchor.value)
  }

  const toggleItem = (index) => {
    const item = filteredData.value[index]
    if (!item) return false

    clearNativeTextSelection()

    const currentItems = selectedItems.value
    if (currentItems.length > 0 && currentItems[0].type !== item.type) {
      selectSingle(index)
      return true
    }

    const nextSelection = new Set(selectedItemSet.value)
    if (nextSelection.has(item)) {
      nextSelection.delete(item)
      const nextActiveItem = [...nextSelection].at(-1) || null
      activeItem.value = nextActiveItem
      selectionAnchor.value = nextActiveItem
    } else {
      nextSelection.add(item)
      activeItem.value = item
      selectionAnchor.value = item
    }

    selectedItemSet.value = nextSelection
    return true
  }

  const handleItemClick = (event, index) => {
    // A text drag emits click after mouseup; keep both the DOM selection and record selection intact.
    if (
      hasNativeTextSelection() &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) return false

    if (event.shiftKey) {
      clearNativeTextSelection()
      selectRange(index)
    } else if (event.metaKey || event.ctrlKey) {
      return toggleItem(index)
    } else {
      selectSingle(index)
    }
    return true
  }

  const handleToggleClick = (event, index) => {
    if (event.shiftKey) return handleItemClick(event, index)
    return toggleItem(index)
  }

  const handleContextSelection = (index) => {
    selectSingle(index)
  }

  const getContainerEl = () => {
    const element = clipboardListRef.value
    if (!element) return null
    return element.$el || element
  }

  const scrollToActiveItem = (direction = 'down') => {
    setTimeout(() => {
      const activeElement = document.querySelector('.clipboard-item.active')
      const container = getContainerEl()
      if (!activeElement || !container) return

      const containerRect = container.getBoundingClientRect()
      const elementRect = activeElement.getBoundingClientRect()

      if (direction === 'down' && elementRect.bottom > containerRect.bottom) {
        container.scrollTop += elementRect.bottom - containerRect.bottom + 10
      } else if (direction === 'up' && elementRect.top < containerRect.top) {
        container.scrollTop += elementRect.top - containerRect.top - 10
      }
    }, 0)
  }

  const findNextIndex = (startIndex, direction, type) => {
    for (
      let index = startIndex + direction;
      index >= 0 && index < filteredData.value.length;
      index += direction
    ) {
      if (!type || filteredData.value[index].type === type) return index
    }
    return startIndex
  }

  const selectAllOfActiveType = () => {
    const item = activeItem.value || filteredData.value[0]
    if (!item) return
    const matchingItems = filteredData.value.filter(candidate => candidate.type === item.type)
    const orderedItems = [item, ...matchingItems.filter(candidate => candidate !== item)]
    replaceSelection(orderedItems, item, item)
  }

  const executeSelected = async (shouldPaste = true) => {
    if (selectedItems.value.length > 0) {
      await writeItems(selectedItems.value, shouldPaste)
    }
  }

  const handleDoubleClick = async (index) => {
    const item = filteredData.value[index]
    if (!item) return

    if (!selectedItemSet.value.has(item)) {
      selectSingle(index)
    }
    await executeSelected(true)
  }

  const handleKeydown = (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === 'c'
    ) {
      if (shouldUseNativeCopy(event) || selectedCount.value === 0) return
      event.preventDefault()
      executeSelected(false)
      return
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      selectAllOfActiveType()
      return
    }

    if (event.key === 'Escape' && selectedCount.value > 1) {
      event.preventDefault()
      selectSingle(Math.max(0, activeIndex.value))
      return
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const currentIndex = tabs.value.findIndex(tab => tab.key === activeTab.value)
      const nextIndex = event.key === 'ArrowLeft'
        ? (currentIndex > 0 ? currentIndex - 1 : tabs.value.length - 1)
        : (currentIndex < tabs.value.length - 1 ? currentIndex + 1 : 0)

      activeTab.value = tabs.value[nextIndex].key
      resetSelection()
      return
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredData.value.length === 0) return

      const direction = event.key === 'ArrowDown' ? 1 : -1
      const currentIndex = activeIndex.value >= 0 ? activeIndex.value : 0
      const type = event.shiftKey
        ? (selectionAnchor.value?.type || activeItem.value?.type)
        : null
      const nextIndex = findNextIndex(currentIndex, direction, type)

      if (event.shiftKey) {
        if (!selectionAnchor.value) {
          selectionAnchor.value = filteredData.value[currentIndex]
        }
        selectRange(nextIndex)
      } else {
        selectSingle(nextIndex)
      }

      scrollToActiveItem(direction > 0 ? 'down' : 'up')
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      executeSelected(true)
      return
    }

    if (event.key === 'Delete') {
      event.preventDefault()
      if (selectedItems.value.length > 0 && onDeleteItems) {
        onDeleteItems(selectedItems.value)
      }
    }
  }

  return {
    activeIndex,
    selectedItems,
    selectedItemSet,
    selectedCount,
    clipboardListRef,
    resetSelection,
    handleItemClick,
    handleContextSelection,
    handleDoubleClick,
    handleKeydown,
    handleToggleClick,
    scrollToActiveItem,
    toggleItem,
    copySelected: () => executeSelected(false),
    pasteSelected: () => executeSelected(true)
  }
}
