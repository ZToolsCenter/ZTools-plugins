/**
 * useConfirmDialog：轻量确认弹窗的模块级单例状态（替代 ztools-ui 的
 * useConfirmDialog + ZConfirmDialog）。
 *
 * - 状态（confirmState）是模块级单例：App.vue 挂载 UiConfirmDialog 渲染它，
 *   useFileLoad / useClipboardLoad / App 的覆盖确认与 HistoryPanel 的清空
 *   确认都走同一条 confirm() 通道（原行为一致）；
 * - API 与原 ztools-ui 对齐：confirm(options) 返回 Promise<boolean>，
 *   confirmState{ visible, title, message, type, confirmText, cancelText }，
 *   handleConfirm / handleCancel 供弹窗按钮回写；
 * - resolve 幂等：先到者胜（点「确定」resolve(true) 后，Esc / 遮罩引发的
 *   update:open(false) 兜底 resolve(false) 不再生效）—— reka AlertDialog
 *   的 Esc 关闭会产生第二次关闭信号，此守卫保证 Promise 只 settle 一次；
 * - Esc / 焦点圈定 / 焦点还原由 UiConfirmDialog 的 reka AlertDialog 内建
 *   （原 ztools-ui ZConfirmDialog 的 REL-001 手工焦点包装随之取消）。
 */
import { reactive } from 'vue'

export type ConfirmType = 'info' | 'warning' | 'danger'

export interface ConfirmState {
  visible: boolean
  title: string
  message: string
  type: ConfirmType
  confirmText: string
  cancelText: string
}

export interface ConfirmOptions {
  title?: string
  message?: string
  type?: ConfirmType
  confirmText?: string
  cancelText?: string
}

/** 模块级单例：唯一真源，UiConfirmDialog 只读 + 事件回写 */
export const confirmState = reactive<ConfirmState>({
  visible: false,
  title: '',
  message: '',
  type: 'info',
  confirmText: '确定',
  cancelText: '取消',
})

/** 当前 pending 的 resolver（null = 无弹窗在等结果） */
let resolver: ((confirmed: boolean) => void) | null = null

/** 幂等 settle：只 settle 一次，后续信号忽略 */
function settle(confirmed: boolean): void {
  if (resolver === null) return
  const resolve = resolver
  resolver = null
  confirmState.visible = false
  resolve(confirmed)
}

/**
 * 弹确认框：填充单例状态并返回 Promise（确定 = true，取消 / Esc = false）。
 * 与原 useConfirmDialog().confirm 的调用面完全一致。
 */
export function useConfirmDialog() {
  function confirm(options: ConfirmOptions = {}): Promise<boolean> {
    // 上一次 confirm 未 settle 时（理论不可达：弹窗串行）先按取消落定，防悬挂
    settle(false)
    confirmState.title = options.title ?? '确认'
    confirmState.message = options.message ?? ''
    confirmState.type = options.type ?? 'info'
    confirmState.confirmText = options.confirmText ?? '确定'
    confirmState.cancelText = options.cancelText ?? '取消'
    confirmState.visible = true
    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  /** 「确定」出口（AlertDialogAction 点击） */
  function handleConfirm(): void {
    settle(true)
  }

  /** 「取消」出口（AlertDialogCancel 点击 / Esc / update:open(false) 兜底） */
  function handleCancel(): void {
    settle(false)
  }

  return { confirmState, confirm, handleConfirm, handleCancel }
}
