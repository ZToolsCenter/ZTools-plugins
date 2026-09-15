import { ref } from 'vue'

export interface LogEntry {
  id: number
  time: string
  message: string
  detail: Record<string, any>
}

const logs = ref<LogEntry[]>([])

function refresh(): void {
  try {
    logs.value = window.services.getLogs() || []
  } catch {
    logs.value = []
  }
}

export function useLog() {
  refresh()

  function addLog(message: string, detail: Record<string, any> = {}) {
    try {
      window.services.addLog(message, detail)
    } catch {}
    refresh()
  }

  function clearLogs() {
    try {
      window.services.clearLogs()
    } catch {}
    logs.value = []
  }

  return {
    logs,
    addLog,
    clearLogs,
    refresh
  }
}
