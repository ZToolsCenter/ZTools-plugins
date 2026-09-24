import { computed, ref } from 'vue'
import { useLog } from './useLog'
import type { Reminder, ReminderFormData } from '../types/reminder'
import { migrateReminder } from '../types/reminder'

// 模块级单例状态，确保所有调用 useReminders() 共享同一份数据
const reminders = ref<Reminder[]>([])

function refreshFromServices(): void {
  try {
    const list = window.services.getReminders()
    reminders.value = Array.isArray(list) ? list.map(r => migrateReminder(r as any)) : []
  } catch {
    reminders.value = []
  }
}

export function useReminders() {
  const { addLog } = useLog()

  function loadReminders(): void {
    refreshFromServices()
  }

  function addReminder(formData: ReminderFormData): Reminder {
    const r = window.services.addReminder(formData) as Reminder
    refreshFromServices()
    addLog(`[新建] ${r.title} 类型=${r.type}`, { id: r.id, type: r.type })
    return r
  }

  function updateReminder(id: string, formData: ReminderFormData): boolean {
    const ok = window.services.updateReminder(id, formData)
    refreshFromServices()
    addLog(`[更新] ${formData.title}`, { id, type: formData.type })
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

  const sortedReminders = computed(() => {
    return [...reminders.value].sort((a, b) => b.createdAt - a.createdAt)
  })

  const enabledReminders = computed(() => {
    return reminders.value.filter(r => r.enabled)
  })

  return {
    reminders,
    sortedReminders,
    enabledReminders,
    loadReminders,
    addReminder,
    updateReminder,
    deleteReminder,
    toggleReminder
  }
}
