import { ref, computed } from 'vue'

export interface QueueItem {
  id: string
  skillId: string
  skillName: string
  type: 'download' | 'install'
  platformNames?: string[]
  status: 'pending' | 'running' | 'success' | 'error'
  progress?: string
  error?: string
  startedAt: number
}

const queue = ref<QueueItem[]>([])
const isExpanded = ref(false)

export function useDownloadQueue() {
  function addDownload(skillId: string, skillName: string) {
    const item: QueueItem = {
      id: `dl-${skillId}-${Date.now()}`,
      skillId,
      skillName,
      type: 'download',
      status: 'running',
      startedAt: Date.now(),
    }
    queue.value.push(item)
    return item
  }

  function addInstall(skillId: string, skillName: string, platformNames: string[]) {
    const item: QueueItem = {
      id: `inst-${skillId}-${Date.now()}`,
      skillId,
      skillName,
      type: 'install',
      platformNames,
      status: 'running',
      startedAt: Date.now(),
    }
    queue.value.push(item)
    return item
  }

  function updateItem(id: string, patch: Partial<QueueItem>) {
    const idx = queue.value.findIndex((item) => item.id === id)
    if (idx >= 0) {
      queue.value[idx] = { ...queue.value[idx], ...patch }
    }
  }

  function removeItem(id: string) {
    queue.value = queue.value.filter((item) => item.id !== id)
  }

  function clearCompleted() {
    queue.value = queue.value.filter((item) => item.status === 'running' || item.status === 'pending')
  }

  const activeCount = computed(() => queue.value.filter((item) => item.status === 'running' || item.status === 'pending').length)
  const hasItems = computed(() => queue.value.length > 0)

  return {
    queue,
    isExpanded,
    activeCount,
    hasItems,
    addDownload,
    addInstall,
    updateItem,
    removeItem,
    clearCompleted,
  }
}
