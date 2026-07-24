/**
 * 主窗口侧：创建/聚焦桌面便利贴独立窗口。
 *
 * 关键约束：ztools.createBrowserWindow 只接受 file:// 本地地址。
 * - 生产模式：location.href 为 file://，可创建独立窗口，并通过 ?note=xxx 传递要打开的便签 id。
 * - dev 模式：主窗口跑在 http://localhost:5173，createBrowserWindow 拒绝 http url，
 *   由 App.vue 回退为「主窗口内嵌编辑视图」。
 */

let stickyWin: BrowserWindow.WindowInstance | null = null

const STICKY_W = 360
const STICKY_H = 480

interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

function getWorkArea(): WorkArea {
  try {
    const display = window.ztools.getPrimaryDisplay() as any
    const wa = display?.workArea || display?.bounds
    if (wa && wa.width && wa.height) return wa
  } catch {
    /* ignore */
  }
  return { x: 0, y: 0, width: 1280, height: 720 }
}

/** 是否支持创建独立便利贴窗口（仅生产 file:// 模式可用） */
export function isStandaloneSupported(): boolean {
  return /^file:/i.test(location.href) && typeof window.ztools?.createBrowserWindow === 'function'
}

/** 便利贴窗口是否正在打开（未被销毁） */
export function isStickyNoteOpen(): boolean {
  return stickyWin !== null && !stickyWin.isDestroyed()
}

/** 创建/聚焦便利贴窗口。noteId 为空=新建草稿；非空=打开已保存便签 */
export function openStickyWindow(noteId?: string | null): boolean {
  if (!isStandaloneSupported()) return false

  // 如果已有打开的窗口，先关闭它（单例模式，但允许多次打开不同内容）
  closeStickyWindow()

  const wa = getWorkArea()
  const x = Math.round(wa.x + wa.width - STICKY_W - 24)
  const y = Math.round(wa.y + 24)

  // 生产模式：基础 url（去掉可能存在的 query）+ ?note=xxx
  const base = location.href.split('?')[0]
  const url = noteId ? `${base}?note=${encodeURIComponent(noteId)}` : base

  try {
    stickyWin = window.ztools.createBrowserWindow(
      url,
      {
        width: STICKY_W,
        height: STICKY_H,
        minWidth: 260,
        minHeight: 240,
        x,
        y,
        frame: false,
        resizable: true,
        alwaysOnTop: true,
        hasShadow: true,
        skipTaskbar: false,
        // parent: null 让窗口独立于主窗口，关闭主窗口时不连带关闭
        parent: null,
        webPreferences: { zoomFactor: 1 }
      } as BrowserWindow.InitOptions,
      () => {
        try {
          window.ztools.hideMainWindow()
        } catch {
          /* ignore */
        }
      }
    )
    return true
  } catch (e) {
    console.error('创建便利贴窗口失败:', e)
    stickyWin = null
    return false
  }
}

/** 关闭当前便利贴窗口（如果存在） */
export function closeStickyWindow(): void {
  if (stickyWin && !stickyWin.isDestroyed()) {
    try {
      stickyWin.close()
    } catch {
      /* ignore */
    }
  }
  stickyWin = null
}