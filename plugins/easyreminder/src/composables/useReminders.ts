import { computed, ref } from 'vue'
import type { Reminder, ReminderFormData, ReminderGroup } from '../types/reminder'
import { migrateReminder } from '../types/reminder'

// 模块级单例状态，确保所有调用 useReminders() 共享同一份数据
const reminders = ref<Reminder[]>([])
const groups = ref<ReminderGroup[]>([])

function refreshFromServices(): void {
  try {
    const list = window.services.getReminders()
    reminders.value = Array.isArray(list) ? list.map(r => migrateReminder(r as any)) : []
  } catch {
    reminders.value = []
  }
}

function refreshGroups(): void {
  try {
    const list = typeof window.services.getGroups === 'function' ? window.services.getGroups() : []
    groups.value = Array.isArray(list) ? list : []
  } catch {
    groups.value = []
  }
}

// 新增的分组接口需要新版 preload（重启 ZTools 后才生效）
function hasGroupApi(): boolean {
  return typeof window.services?.setGroupEnabled === 'function'
}

export function useReminders() {
  function loadReminders(): void {
    refreshFromServices()
    refreshGroups()
  }

  // 日志统一由 preload 调度器记录，渲染层只负责数据读写
  function addReminder(formData: ReminderFormData): Reminder {
    const r = window.services.addReminder(formData) as Reminder
    refreshFromServices()
    return r
  }

  function updateReminder(id: string, formData: ReminderFormData): boolean {
    const ok = window.services.updateReminder(id, formData)
    refreshFromServices()
    return ok
  }

  function deleteReminder(id: string): boolean {
    const ok = window.services.deleteReminder(id)
    refreshFromServices()
    return ok
  }

  function toggleReminder(id: string): boolean {
    const ok = window.services.toggleReminder(id)
    refreshFromServices()
    return ok
  }

  function copyReminder(id: string): boolean {
    const copy = window.services.copyReminder(id)
    refreshFromServices()
    return !!copy
  }

  // 按名称复用/新建分组，返回分组对象（供表单保存时拿到 id）
  function addGroup(name: string): ReminderGroup | null {
    const group = window.services.addGroup(name)
    refreshGroups()
    return group || null
  }

  function setGroupEnabled(id: string, enabled: boolean): boolean {
    const ok = window.services.setGroupEnabled(id, enabled)
    refreshFromServices()
    return ok
  }

  function dissolveGroup(id: string): boolean {
    const ok = window.services.dissolveGroup(id)
    refreshFromServices()
    refreshGroups()
    return ok
  }

  function deleteGroup(id: string): boolean {
    const ok = window.services.deleteGroup(id)
    refreshFromServices()
    refreshGroups()
    return ok
  }

  function assignGroup(ids: string[], groupId: string): boolean {
    const ok = window.services.assignGroup(ids, groupId)
    refreshFromServices()
    return ok
  }

  function setRemindersEnabled(ids: string[], enabled: boolean): boolean {
    const ok = window.services.setRemindersEnabled(ids, enabled)
    refreshFromServices()
    return ok
  }

  function deleteReminders(ids: string[]): boolean {
    const ok = window.services.deleteReminders(ids)
    refreshFromServices()
    return ok
  }

  function reorderGroups(ids: string[]): boolean {
    const ok = window.services.reorderGroups(ids)
    refreshGroups()
    return ok
  }

  function updateReminderOrder(items: Array<{ id: string; groupId: string | null; order: number }>): boolean {
    const ok = window.services.updateReminderOrder(items)
    refreshFromServices()
    return ok
  }

  const sortedReminders = computed(() => {
    return [...reminders.value].sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || b.createdAt - a.createdAt)
  })

  const sortedGroups = computed(() => {
    return [...groups.value].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt)
  })

  return {
    sortedReminders,
    sortedGroups,
    hasGroupApi,
    loadReminders,
    addReminder,
    updateReminder,
    deleteReminder,
    toggleReminder,
    copyReminder,
    addGroup,
    setGroupEnabled,
    dissolveGroup,
    deleteGroup,
    assignGroup,
    setRemindersEnabled,
    deleteReminders,
    reorderGroups,
    updateReminderOrder
  }
}
