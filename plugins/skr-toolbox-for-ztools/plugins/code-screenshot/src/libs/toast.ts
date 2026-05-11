import { reactive } from 'vue'

/**
 * 提示消息类型定义
 */
export type ToastType = 'success' | 'error' | 'info' | 'warning'

/**
 * 提示消息接口
 */
interface Toast {
  /**
   * 消息唯一标识
   */
  id: number
  /**
   * 消息内容
   */
  message: string
  /**
   * 消息类型
   */
  type: ToastType
  /**
   * 显示时长（毫秒），0 表示不自动关闭
   */
  duration?: number
}

// 提示消息列表（响应式）
const toasts = reactive<Toast[]>([])
// 下一个消息的 ID
let nextId = 0

/**
 * 提示消息存储对象
 * 提供添加、移除、快捷创建各类消息的方法
 */
const toastStore = {
  toasts,
  /**
   * 添加提示消息
   * @param message - 消息内容
   * @param type - 消息类型
   * @param duration - 显示时长（毫秒），默认 3000ms
   * @returns 消息 ID
   */
  add(message: string, type: ToastType = 'info', duration: number = 3000) {
    const id = nextId++
    toasts.push({ id, message, type, duration })

    if (duration > 0) {
      setTimeout(() => {
        this.remove(id)
      }, duration)
    }
    return id
  },
  /**
   * 移除提示消息
   * @param id - 消息 ID
   */
  remove(id: number) {
    const index = toasts.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.splice(index, 1)
    }
  },
  /** 成功提示 */
  success(msg: string, duration?: number) { return this.add(msg, 'success', duration) },
  /** 错误提示 */
  error(msg: string, duration?: number) { return this.add(msg, 'error', duration) },
  /** 信息提示 */
  info(msg: string, duration?: number) { return this.add(msg, 'info', duration) },
  /** 警告提示 */
  warning(msg: string, duration?: number) { return this.add(msg, 'warning', duration) }
}

/**
 * 创建提示消息实例的 composable
 * @returns toastStore 实例
 */
export function useToast() {
  return toastStore
}
