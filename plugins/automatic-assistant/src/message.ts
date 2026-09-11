import { reactive } from 'vue'

export type Severity = 'success' | 'error' | 'warning' | 'info'

export const message = reactive({
  open: false,
  text: '',
  severity: 'info' as Severity
})

let timer: number | undefined

// 顶部居中提示条，与原版 Snackbar 行为一致
export function showMessage(text: string, severity: Severity = 'info') {
  message.text = text
  message.severity = severity
  message.open = true
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    message.open = false
  }, 3000)
  return undefined
}

export function closeMessage() {
  message.open = false
  if (timer) window.clearTimeout(timer)
}
