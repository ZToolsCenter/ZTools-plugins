/**
 * 渲染层访问窗口间通信桥（由 public/preload/services.js 注入）。
 *
 * 只在开发时用浏览器直接打开页面才可能拿不到桥，所以这里统一做空值兜底，
 * 调用方一律用 `getBridge()?.xxx()` 的写法，不要直接摸 window.easynoteBridge。
 */

/** 便利贴 / 标签窗口 → 主窗口（窗口管家）*/
export type HostCommand = {
  type:
    | 'collapse'
    | 'restore'
    | 'request-close'
    | 'close-request'
    | 'hello'
    | 'hello-ack'
    /** 标签窗口拖动：子窗口改不了自己的位置，只能把光标坐标报给管家来 setPosition */
    | 'tab-drag'
    /** 管家 → 标签：吸附边变了（拖动换边后），让标签换边框/圆角方向 */
    | 'side'
  /** collapse 时带上，用于标签窗口显示与高度计算 */
  title?: string
  noteType?: 'note' | 'todo'
  /** tab-drag 的阶段与光标屏幕坐标 */
  phase?: 'start' | 'move' | 'end'
  x?: number
  y?: number
  side?: 'left' | 'right'
}

export interface EasynoteBridge {
  isHost(): boolean
  toHost(msg: HostCommand): void
  toWindow(id: number, msg: HostCommand): void
  onCmd(fn: (msg: HostCommand, senderId?: number) => void): void
}

export function getBridge(): EasynoteBridge | null {
  const bridge = (window as unknown as { easynoteBridge?: EasynoteBridge }).easynoteBridge
  return bridge && typeof bridge.toHost === 'function' ? bridge : null
}
