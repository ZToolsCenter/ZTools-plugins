import { nextTick, ref, type Ref } from 'vue'
import type { GroupDoc, TaskDoc } from '../types'
import { GROUPS_PREFIX } from './todoConstants'
import { removeDoc } from './todoPersistence'

interface TodoGroupsOptions {
  groups: Ref<GroupDoc[]>
  tasks: Ref<TaskDoc[]>
  saveGroup: (group: GroupDoc, shouldRefresh?: boolean) => void
  refreshData: () => void
  selectGroup: (id: string) => void
}

export function useTodoGroups(options: TodoGroupsOptions) {
  const groupComposerOpen = ref(false)
  const newGroupTitle = ref('')
  const editingGroupId = ref('')
  const editingGroupTitle = ref('')
  const deleteGroupId = ref('')

  function showGroupComposer() {
    groupComposerOpen.value = true
    nextTick(() => document.querySelector<HTMLInputElement>('.group-create-input')?.focus())
  }

  function createGroup(title = newGroupTitle.value) {
    const name = title.trim()
    if (!name) {
      groupComposerOpen.value = false
      return
    }
    const now = Date.now()
    const group: GroupDoc = {
      _id: `${GROUPS_PREFIX}${now}`,
      title: name,
      sort: options.groups.value.reduce((max, item) => Math.max(max, item.sort), 0) + 1,
      created_at: now
    }
    options.saveGroup(group)
    newGroupTitle.value = ''
    groupComposerOpen.value = false
    options.selectGroup(group._id)
  }

  function startGroupEdit(group: GroupDoc) {
    editingGroupId.value = group._id
    editingGroupTitle.value = group.title
  }

  function renameGroup(group: GroupDoc) {
    const title = editingGroupTitle.value.trim()
    if (!title) return
    options.saveGroup({ ...group, title })
    editingGroupId.value = ''
  }

  function deleteGroup(group: GroupDoc) {
    options.tasks.value.filter((task) => task.groupId === group._id).forEach((task) => removeDoc(task._id))
    removeDoc(group._id)
    deleteGroupId.value = ''
    options.refreshData()
    options.selectGroup(options.groups.value[0]?._id || `${GROUPS_PREFIX}pending`)
  }

  return {
    groupComposerOpen,
    newGroupTitle,
    editingGroupId,
    editingGroupTitle,
    deleteGroupId,
    showGroupComposer,
    createGroup,
    startGroupEdit,
    renameGroup,
    deleteGroup
  }
}

