import { ref } from 'vue'

export type ModalMode = 'alert' | 'confirm' | 'prompt'

interface ModalState {
  visible: boolean
  mode: ModalMode
  title: string
  message: string
  inputValue: string
  inputPlaceholder: string
  confirmText: string
  cancelText: string
  danger: boolean
  _resolve: ((value: any) => void) | null
}

const state = ref<ModalState>({
  visible: false,
  mode: 'alert',
  title: '',
  message: '',
  inputValue: '',
  inputPlaceholder: '',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
  _resolve: null,
})

function open(mode: ModalMode, message: string, opts?: {
  title?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}): Promise<any> {
  // 若已有未关闭的弹窗，先 settle 旧 Promise，避免 await 永久挂起
  if (state.value.visible && state.value._resolve) {
    state.value._resolve(state.value.mode === 'prompt' ? null : false)
  }
  return new Promise((resolve) => {
    state.value = {
      visible: true,
      mode,
      title: opts?.title || (mode === 'alert' ? '提示' : mode === 'confirm' ? '确认' : '输入'),
      message,
      inputValue: opts?.defaultValue || '',
      inputPlaceholder: opts?.placeholder || '请输入…',
      confirmText: opts?.confirmText || '确定',
      cancelText: opts?.cancelText || '取消',
      danger: opts?.danger || false,
      _resolve: resolve,
    }
  })
}

function handleConfirm() {
  const val = state.value.mode === 'prompt' ? state.value.inputValue : true
  state.value._resolve?.(val)
  state.value.visible = false
}

function handleCancel() {
  state.value._resolve?.(state.value.mode === 'prompt' ? null : false)
  state.value.visible = false
}

export function useModal() {
  return {
    state,
    alert(message: string, opts?: { title?: string; confirmText?: string }) {
      return open('alert', message, opts)
    },
    confirm(message: string, opts?: { title?: string; confirmText?: string; cancelText?: string; danger?: boolean }) {
      return open('confirm', message, opts) as Promise<boolean>
    },
    prompt(message: string, defaultValue?: string, opts?: {
      title?: string
      placeholder?: string
      confirmText?: string
      cancelText?: string
    }) {
      return open('prompt', message, { ...opts, defaultValue }) as Promise<string | null>
    },
    handleConfirm,
    handleCancel,
  }
}
