import { computed, nextTick, ref, type Ref } from 'vue'
import type { GroupDoc, TaskDoc } from '../types'

export interface TaskSearchResult {
  task: TaskDoc
  group: GroupDoc
  score: number
}

interface TaskSearchOptions {
  tasks: Ref<TaskDoc[]>
  groupById: (id: string) => GroupDoc | undefined
  selectGroup: (id: string) => void
  selectTask: (id: string) => void
  closeContextMenu: () => void
}

export function useTaskSearch(options: TaskSearchOptions) {
  const taskSearchOpen = ref(false)
  const taskSearchQuery = ref('')
  const taskSearchIndex = ref(0)

  const taskSearchResults = computed(() => {
    const query = taskSearchQuery.value.trim().toLowerCase()
    const tokens = query.split(/\s+/).filter(Boolean)

    return options.tasks.value
      .map((task) => {
        const group = options.groupById(task.groupId)
        if (!group) return null

        const taskText = task.text.toLowerCase()
        const groupTitle = group.title.toLowerCase()
        const haystack = `${taskText}\n${groupTitle}`
        if (tokens.length && !tokens.every((token) => haystack.includes(token))) return null

        let score = 0
        if (!tokens.length) score += 1
        if (query && taskText === query) score += 240
        if (query && taskText.startsWith(query)) score += 180
        if (query && taskText.includes(query)) score += 120
        if (query && groupTitle.includes(query)) score += 40
        if (task.completed) score -= 8

        return { task, group, score }
      })
      .filter((result): result is TaskSearchResult => Boolean(result))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        if (a.group.sort !== b.group.sort) return a.group.sort - b.group.sort
        return a.task.sort - b.task.sort
      })
      .slice(0, 12)
  })

  function openTaskSearch() {
    options.closeContextMenu()
    taskSearchOpen.value = true
    taskSearchQuery.value = ''
    taskSearchIndex.value = 0
    nextTick(() => document.querySelector<HTMLInputElement>('.task-search-input')?.focus())
  }

  function closeTaskSearch() {
    taskSearchOpen.value = false
    taskSearchQuery.value = ''
    taskSearchIndex.value = 0
  }

  function updateTaskSearchQuery(value: string) {
    taskSearchQuery.value = value
    taskSearchIndex.value = 0
  }

  function moveTaskSearchSelection(delta: number) {
    const count = taskSearchResults.value.length
    if (!count) {
      taskSearchIndex.value = 0
      return
    }
    taskSearchIndex.value = (taskSearchIndex.value + delta + count) % count
  }

  function confirmTaskSearchSelection(result = taskSearchResults.value[taskSearchIndex.value]) {
    if (!result) return
    const taskId = result.task._id
    closeTaskSearch()
    options.selectGroup(result.group._id)
    options.selectTask(taskId)
    nextTick(() => document.querySelector<HTMLElement>('.task-card.active')?.scrollIntoView({ block: 'nearest' }))
  }

  return {
    taskSearchOpen,
    taskSearchQuery,
    taskSearchIndex,
    taskSearchResults,
    openTaskSearch,
    closeTaskSearch,
    updateTaskSearchQuery,
    moveTaskSearchSelection,
    confirmTaskSearchSelection
  }
}
