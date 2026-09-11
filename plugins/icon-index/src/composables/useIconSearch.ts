import { computed, ref } from 'vue'
import { iconifyClient } from '../services/iconify'
import type { IconItem, IconPage } from '../types/icon'

export function useIconSearch() {
  const query = ref('')
  const activeQuery = ref('')
  const result = ref<IconPage | null>(null)
  const selectedIndex = ref(-1)
  const loading = ref(false)
  const error = ref('')
  let controller: AbortController | null = null

  const items = computed(() => result.value?.items ?? [])
  const selected = computed<IconItem | null>(() => items.value[selectedIndex.value] ?? null)

  async function search(nextQuery = query.value, page = 1): Promise<void> {
    const trimmed = nextQuery.trim()
    if (!trimmed) {
      error.value = '请输入搜索关键词'
      return
    }

    controller?.abort()
    controller = new AbortController()
    loading.value = true
    error.value = ''

    try {
      const pageResult = await iconifyClient.search(trimmed, page, undefined, controller.signal)
      query.value = trimmed
      activeQuery.value = trimmed
      result.value = pageResult
      selectedIndex.value = pageResult.items.length ? 0 : -1
    } catch (reason) {
      if (controller.signal.aborted) return
      error.value = reason instanceof Error ? reason.message : '搜索失败，请稍后重试'
    } finally {
      if (!controller.signal.aborted) loading.value = false
    }
  }

  async function goToPage(page: number): Promise<void> {
    if (!activeQuery.value || page < 1 || loading.value) return
    await search(activeQuery.value, page)
  }

  function select(index: number): void {
    if (!items.value.length) return
    selectedIndex.value = Math.max(0, Math.min(index, items.value.length - 1))
  }

  return {
    query,
    activeQuery,
    result,
    items,
    selected,
    selectedIndex,
    loading,
    error,
    search,
    goToPage,
    select
  }
}
