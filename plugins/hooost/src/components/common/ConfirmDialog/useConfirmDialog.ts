import { ref, type Ref } from 'vue'

interface ConfirmOptions {
  title?: string
  message: string
  type?: 'info' | 'warning' | 'danger'
  confirmText?: string
  cancelText?: string
}

interface ConfirmState {
  visible: boolean
  title: string
  message: string
  type: 'info' | 'warning' | 'danger'
  confirmText: string
  cancelText: string
  resolve: ((value: boolean) => void) | null
}

const confirmState = ref<ConfirmState>({
  visible: false,
  title: '确认操作',
  message: '',
  type: 'info',
  confirmText: '确定',
  cancelText: '取消',
  resolve: null,
})

/**
 * 统一管理确认弹窗状态。
 */
export function useConfirmDialog(): {
  confirmState: Ref<ConfirmState>
  confirm: (options: ConfirmOptions) => Promise<boolean>
  handleConfirm: () => void
  handleCancel: () => void
} {
  const confirm = (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      confirmState.value = {
        visible: true,
        title: options.title || '确认操作',
        message: options.message,
        type: options.type || 'info',
        confirmText: options.confirmText || '确定',
        cancelText: options.cancelText || '取消',
        resolve,
      }
    })
  }

  const handleConfirm = (): void => {
    confirmState.value.resolve?.(true)
    confirmState.value.visible = false
  }

  const handleCancel = (): void => {
    confirmState.value.resolve?.(false)
    confirmState.value.visible = false
  }

  return {
    confirmState,
    confirm,
    handleConfirm,
    handleCancel,
  }
}
