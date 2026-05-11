import { ref, type Ref } from 'vue'

interface ToastOptions {
  message: string
  type?: 'success' | 'error' | 'warning' | 'info'
  duration?: number
}

interface ToastState {
  visible: boolean
  message: string
  type: 'success' | 'error' | 'warning' | 'info'
  duration: number
}

const toastState = ref<ToastState>({
  visible: false,
  message: '',
  type: 'info',
  duration: 3000,
})

export function useToast(): {
  toastState: Ref<ToastState>
  show: (options: ToastOptions) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
  hide: () => void
} {
  const show = (options: ToastOptions): void => {
    toastState.value = {
      visible: true,
      message: options.message,
      type: options.type || 'info',
      duration: options.duration || 3000,
    }
  }

  const success = (message: string, duration = 3000): void => {
    show({ message, type: 'success', duration })
  }

  const error = (message: string, duration = 3000): void => {
    show({ message, type: 'error', duration })
  }

  const warning = (message: string, duration = 3000): void => {
    show({ message, type: 'warning', duration })
  }

  const info = (message: string, duration = 3000): void => {
    show({ message, type: 'info', duration })
  }

  const hide = (): void => {
    toastState.value.visible = false
  }

  return {
    toastState,
    show,
    success,
    error,
    warning,
    info,
    hide,
  }
}
