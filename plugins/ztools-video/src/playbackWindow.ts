import type { PlaybackRequest } from './types'

let player: BrowserWindow.WindowInstance | undefined
let pending: PlaybackRequest | undefined
let ready = false

function sendPending() {
  if (!player || !ready || !pending) return
  player.webContents.send('ztools-video:playback', pending)
  pending = undefined
}

export function openPlaybackWindow(request: PlaybackRequest) {
  pending = request
  if (player && !player.isDestroyed()) {
    if (player.isMinimized()) player.restore()
    player.show()
    player.focus()
    sendPending()
    return
  }

  ready = false
  const window = ztools.createBrowserWindow('dist/player.html', {
    title: '影视播放',
    width: 1080,
    height: 740,
    minWidth: 460,
    minHeight: 360,
    center: true,
    resizable: true,
    fullscreenable: true,
    webPreferences: { preload: 'preload/player.js', zoomFactor: 1 },
  }, () => {
    if (player !== window) return
    ready = true
    sendPending()
  })
  if (!window || !Number.isInteger(window.id)) throw new Error('未能打开播放窗口。')
  player = window
}
