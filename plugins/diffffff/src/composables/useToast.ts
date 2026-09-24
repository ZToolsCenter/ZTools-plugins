/**
 * useToast：轻量 toast 反馈的模块级单例状态（替代 ztools-ui 的 useToast）。
 *
 * - 状态（toastState）是模块级单例：任何调用方（App / useFileLoad /
 *   useDropLoad / useClipboardLoad）拿到的都是同一份，UiToastHost 渲染它；
 * - API 与原 ztools-ui useToast 对齐：info / success / error(message) +
 *   toastState{ message, type, duration, visible }，调用面零改动；
 * - 自动消失：show 内起 hideTimer，同一条 toast 重复触发时先清旧计时
 *   （连续 error 不叠加，展示时长顺延）；组件卸载由 Host 侧兜底，
 *   本模块为纯状态层、无组件依赖。
 */
import { reactive } from 'vue'

export type ToastType = 'info' | 'success' | 'error'

export interface ToastState {
  visible: boolean
  message: string
  type: ToastType
  duration: number
}

/** 模块级单例：唯一真源，UiToastHost 只读 + v-model:visible 回写 */
export const toastState = reactive<ToastState>({
  visible: false,
  message: '',
  type: 'info',
  duration: 2400,
})

/** 自动消失计时器（模块级，重复 show 时先清） */
let hideTimer: ReturnType<typeof setTimeout> | null = null

function clearHideTimer(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

/** 展示一条 toast：覆盖当前内容并重置消失计时（同一时刻只显示一条） */
function showToast(message: string, type: ToastType, duration: number): void {
  clearHideTimer()
  toastState.message = message
  toastState.type = type
  toastState.duration = duration
  toastState.visible = true
  hideTimer = setTimeout(() => {
    hideTimer = null
    toastState.visible = false
  }, duration)
}

/**
 * useToast：返回单例状态与三个类型化出口。
 * 组件卸载安全兜底：Host 卸载时隐藏 toast 并清计时（避免幽灵回调）。
 */
export function useToast() {
  return {
    toastState,
    /** 中性提示（空输入 / 剪贴板为空等引导） */
    info: (message: string, duration = 2400) => showToast(message, 'info', duration),
    /** 成功反馈（复制完成） */
    success: (message: string, duration = 2000) => showToast(message, 'success', duration),
    /** 错误反馈（对比失败 / 读取失败，停留稍长） */
    error: (message: string, duration = 3200) => showToast(message, 'error', duration),
    /** Host 卸载兜底：隐藏 + 清计时 */
    dispose: () => {
      clearHideTimer()
      toastState.visible = false
    },
  }
}
