/**
 * 轻量级消息提示（仅 console，不再调用系统通知）
 * Toast 反馈请使用 useToast 或 ResultToast 组件
 */
export const notify = (msg: string) => {
  console.info('[notify]', msg)
}

