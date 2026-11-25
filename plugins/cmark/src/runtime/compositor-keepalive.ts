/**
 * runtime/compositor-keepalive.ts
 *
 * 症状（ZTools 分离窗口 / WebContentsView）：
 *   长时间没有输入后，Windows 原生遮挡检测（Native Window Occlusion Detection）
 *   会把窗口判成 occluded，Chromium 随即停止渲染；窗口恢复可见时旧 surface
 *   没有被重建，整块内容区变成空的（只剩窗口框），拖动或改变窗口大小
 *   （宿主 resize → setBounds）才会重绘。Chromium 文档原话：
 *   "If a window is falsely determined to be occluded, the content area will be white."
 *
 * 对策：
 *   周期性制造一次 1px 级别的绘制，保证合成器始终有新帧提交——
 *   白屏的成因是「没有新帧可提交」，只要一直有帧，surface 就不会被判定为可回收。
 *   用像素上的 alpha 抖动而不是改布局：damage 面积极小，不触发重排、不会闪。
 *
 * 定位：最后一道兜底。宿主侧更彻底的修法是启动加
 *   --disable-features=CalculateNativeWinOcclusion
 * 这条心跳保证「即使宿主没修，也不会白屏到用户来救」。
 */
const HEARTBEAT_MS = 60_000
const DOT_ID = 'cmark-keepalive'

let started = false

/**
 * 安装合成保活。重复调用无副作用。
 * @param intervalMs 心跳间隔，默认 60s；调试时可传小值（如 3000）
 */
export function installCompositorKeepalive(intervalMs: number = HEARTBEAT_MS): void {
  if (started || typeof document === 'undefined') return
  started = true

  const mount = () => {
    const dot = document.createElement('div')
    dot.id = DOT_ID
    dot.setAttribute('aria-hidden', 'true')
    dot.style.cssText = [
      'position:fixed',
      'left:0',
      'top:0',
      'width:1px',
      'height:1px',
      'pointer-events:none',
      'user-select:none',
      'z-index:2147483647',
      'background-color:rgba(0,0,0,0)',
    ].join(';')
    document.body.appendChild(dot)

    let on = false
    const tick = () => {
      on = !on
      // 1px 范围内 alpha 变化 2%：肉眼不可辨，但会真的产生一次 raster + 新的合成帧
      dot.style.backgroundColor = on ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0)'
    }

    setInterval(tick, intervalMs)

    // 回到可见/重新获得焦点时立刻连补几帧：
    // 把白屏停留时间从「最长一个心跳周期」压到「几乎为零」，也覆盖 surface 刚重建需要多帧的情况
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      tick()
      let left = 3
      const more = () => {
        tick()
        if (--left > 0) requestAnimationFrame(more)
      }
      requestAnimationFrame(more)
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    window.addEventListener('pageshow', wake)
  }

  if (document.body) mount()
  else window.addEventListener('DOMContentLoaded', mount, { once: true })
}