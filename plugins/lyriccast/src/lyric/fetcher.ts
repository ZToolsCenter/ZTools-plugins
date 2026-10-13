/**
 * 网络请求辅助。
 * 超时与取消统一由 RequestSupervisor 创建的 AbortSignal 承担(切歌中止在途请求,
 * 防止旧歌词覆盖新歌);provider 只需把 signal 透传给 fetch。
 * 运行环境:Electron 渲染进程(Chromium)与 Node 18+ 均有全局 fetch。
 */
export class RequestSupervisor {
  private controllers = new Set<AbortController>()

  /**
   * 新建受管 AbortController:超时自动中止,cancelAll 时全部中止。
   * @param timeoutMs 单请求超时(协议约定 5 秒)
   */
  create(timeoutMs: number): AbortController {
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    controller.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        this.controllers.delete(controller)
      },
      { once: true }
    )
    return controller
  }

  /** 中止全部在途请求(切歌时调用) */
  cancelAll(): void {
    for (const controller of [...this.controllers]) controller.abort()
    this.controllers.clear()
  }
}

/**
 * fetch JSON。非 2xx 抛 Error(带 host 与状态码);中止抛 AbortError,由上层区分。
 */
export async function fetchJson(url: string, init: RequestInit = {}): Promise<any> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${new URL(url).host}`)
  }
  return response.json()
}
