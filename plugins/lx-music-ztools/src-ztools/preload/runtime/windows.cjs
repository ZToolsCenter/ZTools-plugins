const { randomUUID } = require('node:crypto')
const { WIN_LYRIC_RENDERER_EVENT_NAME: lyric, WIN_MAIN_RENDERER_EVENT_NAME: main, CMMON_EVENT_NAME: common } = require('../upstream/common/ipcNames.cjs')
const PARENT = 'lx-music:lyric:parent', CHILD = 'lx-music:lyric:child'
const playerKeys = new Set(['common.langId', 'player.isShowLyricTranslation', 'player.isShowLyricRoma', 'player.isSwapLyricTranslationAndRoma', 'player.isPlayLxlrc', 'player.playbackRate'])
const isConfig = key => key.startsWith('desktopLyric.') || playerKeys.has(key)
const getConfig = lx => Object.fromEntries(Object.entries(lx.appSetting).filter(([key]) => isConfig(key)))
async function call(target, method, ...args) {
  const result = await Promise.resolve().then(() => {
    if (typeof target?.[method] !== 'function') throw new Error('ZTools 窗口能力不可用：' + method)
    return target[method](...args)
  })
  if (result instanceof Error || Object.prototype.toString.call(result) === '[object Error]') throw result
  return result
}
function createWindows({ bridge, ipcRenderer, ztools, lx, ready = false }) {
  let current, closed = false, reconcilingBounds = false, queue = Promise.resolve(), lastOperation = queue, revision = 0, poll, polling, operations = 0
  const report = error => bridge.emit('bridge:error', { channel: 'desktopLyrics', message: String(error.message || error) })
  const serial = operation => {
    operations++; revision++
    const next = queue.then(operation).finally(() => { operations--; revision++ })
    lastOperation = next; queue = next.catch(report); return next
  }
  const send = (channel, params, target = current) => target && call(target.window.webContents, 'send', CHILD, { session: target.session, kind: 'event', channel, params })
  function bounds(setting, original) {
    const width = Math.max(38, Number(setting['desktopLyric.width']) || 450), height = Math.max(38, Number(setting['desktopLyric.height']) || 100)
    let x = setting['desktopLyric.x'], y = setting['desktopLyric.y']
    const display = x == null || y == null ? ztools.getPrimaryDisplay() : ztools.getDisplayNearestPoint({ x, y })
    const area = display.workArea
    const result = { width, height, x: x ?? area.x + area.width - width, y: y ?? area.y + area.height - height, ...original }
    if (setting['desktopLyric.isLockScreen']) {
      result.width = Math.min(result.width, area.width); result.height = Math.min(result.height, area.height)
      result.x = Math.max(area.x, Math.min(result.x, area.x + area.width - result.width))
      result.y = Math.max(area.y, Math.min(result.y, area.y + area.height - result.height))
    }
    return result
  }
  async function closeNow() {
    const previous = current; current = null
    if (!previous) return
    bridge.emit('lyric:port:disconnect')
    if (!await call(previous.window, 'isDestroyed')) await call(previous.window, 'destroy')
  }
  async function apply() {
    if (closed) return
    if (!ready || !lx.appSetting['desktopLyric.enable']) return closeNow()
    if (!current) {
      const session = randomUUID()
      const window = await call(ztools, 'createBrowserWindow', `dist/lyric.html?os=windows&session=${session}`, {
        ...bounds(lx.appSetting), frame: false, transparent: true, show: true, minWidth: 38, minHeight: 38,
        webPreferences: { preload: 'preload/lyric.cjs' } })
      if (!window?.webContents?.id) throw new Error('ZTools 桌面歌词窗口创建失败')
      current = { window, session }
    }
    const target = current
    await call(target.window, 'setBounds', bounds(lx.appSetting))
    await call(target.window, 'setAlwaysOnTop', Boolean(lx.appSetting['desktopLyric.isAlwaysOnTop']), 'screen-saver')
    await call(target.window, 'setIgnoreMouseEvents', Boolean(lx.appSetting['desktopLyric.isLock']), { forward: true })
    await call(target.window, 'setSkipTaskbar', !lx.appSetting['desktopLyric.isShowTaskbar'])
    await send(lyric.on_config_change, getConfig(lx), target)
  }
  const changed = keys => { if (!reconcilingBounds && keys.some(isConfig)) void serial(apply) }
  const updateBoundsConfig = rectangle => {
    reconcilingBounds = true
    try {
      lx.event_app.update_config({
        'desktopLyric.x': rectangle.x, 'desktopLyric.y': rectangle.y,
        'desktopLyric.width': rectangle.width, 'desktopLyric.height': rectangle.height,
      })
    } finally { reconcilingBounds = false }
  }
  const inited = () => { ready = true; void serial(apply) }
  lx.event_app.on('updated_config', changed); lx.event_app.on('main_window_inited', inited)
  const allowed = new Set([lyric.get_config, lyric.set_config, lyric.set_win_bounds, lyric.mouse_enter_leave, lyric.request_main_window_channel, 'lyric:port'])
  async function invoke(channel, params) {
    if (!allowed.has(channel)) throw new Error('不允许的桌面歌词请求')
    switch (channel) {
      case lyric.get_config: return getConfig(lx)
      case lyric.set_config: {
        if (!params || typeof params !== 'object' || Object.keys(params).some(key => !isConfig(key))) throw new Error('无效的桌面歌词设置')
        lx.event_app.update_config(params); await lastOperation; return
      }
      case lyric.set_win_bounds: {
        if (!params || ['x', 'y', 'w', 'h'].some(key => !Number.isFinite(params[key]))) throw new Error('无效歌词窗口尺寸')
        return serial(async () => {
          if (!current) throw new Error('无效歌词窗口尺寸')
          const target = current, before = await call(target.window, 'getBounds')
          const next = bounds(lx.appSetting, { x: before.x + params.x, y: before.y + params.y, width: Math.max(38, params.w), height: Math.max(38, params.h) })
          updateBoundsConfig(next)
          try { await apply() } catch (error) {
            let actual
            try { actual = await call(target.window, 'getBounds') } catch { actual = before }
            updateBoundsConfig(actual)
            throw error
          }
        })
      }
      case lyric.mouse_enter_leave: return send(lyric.mouse_enter_leave, Boolean(params))
      case lyric.request_main_window_channel:
        bridge.emit(main.process_new_desktop_lyric_client)
        return send(lyric.provide_main_window_channel)
      case 'lyric:port':
        if (!params || !['get_info', 'get_status', 'get_analyser_data_array'].includes(params.action)) throw new Error('无效歌词播放请求')
        bridge.emit('lyric:port:receive', params); return
    }
  }
  const receive = (_event, packet) => {
    const target = current
    if (!target || _event.senderId !== target.window.webContents.id || packet?.session !== target.session) return
    if (packet.kind === 'closed') { void serial(async () => { if (current !== target) return; current = null; bridge.emit('lyric:port:disconnect'); lx.event_app.update_config({ 'desktopLyric.enable': false }) }); return }
    if (packet.kind !== 'invoke' || typeof packet.id !== 'string') return
    void invoke(packet.channel, packet.params).then(
      result => call(target.window.webContents, 'send', CHILD, { session: target.session, kind: 'result', id: packet.id, result }),
      error => call(target.window.webContents, 'send', CHILD, { session: target.session, kind: 'result', id: packet.id, error: String(error.message || error) }),
    ).catch(report)
  }
  ipcRenderer.on(PARENT, receive)
  bridge.register('lyric:port', params => {
    if (!params || !['set_info', 'set_lyric', 'set_status', 'set_offset', 'set_playbackRate', 'set_pause', 'set_play', 'set_stop', 'send_analyser_data_array'].includes(params.action)) throw new Error('无效歌词播放器消息')
    return send('lyric:port:receive', params)
  })
  poll = setInterval(() => {
    const target = current
    if (!target || closed || polling === target || operations) return
    const observedRevision = revision
    const valid = () => !closed && current === target && revision === observedRevision && !operations
    polling = target
    void call(target.window, 'isDestroyed').then(async destroyed => {
      if (!valid()) return
      if (destroyed) { current = null; bridge.emit('lyric:port:disconnect'); lx.event_app.update_config({ 'desktopLyric.enable': false }) }
      else if (!destroyed) {
        if (lx.appSetting['desktopLyric.isAlwaysOnTop'] && lx.appSetting['desktopLyric.isAlwaysOnTopLoop']) await call(target.window, 'moveTop')
        if (!valid()) return
        const rectangle = await call(target.window, 'getBounds')
        if (!valid()) return
        const patch = Object.fromEntries(['x', 'y', 'width', 'height'].filter(key => rectangle[key] !== lx.appSetting['desktopLyric.' + key]).map(key => ['desktopLyric.' + key, rectangle[key]]))
        if (Object.keys(patch).length) lx.event_app.update_config(patch)
      }
    }).catch(report).finally(() => { if (polling === target) polling = null })
  }, 500)
  poll.unref?.()
  const service = {
    async openLyrics() { if (closed) throw new Error('歌词服务已关闭'); if (!ready) throw new Error('播放器尚未就绪'); const before = revision; lx.event_app.update_config({ 'desktopLyric.enable': true }); if (revision === before) serial(apply); await lastOperation },
    async closeLyrics() { const before = revision; lx.event_app.update_config({ 'desktopLyric.enable': false }); if (revision === before) serial(apply); await lastOperation },
    getStatus: () => ({ open: Boolean(current), ready }),
    async dispose() { if (closed) return; closed = true; clearInterval(poll); ipcRenderer.off(PARENT, receive); lx.event_app.off('updated_config', changed); lx.event_app.off('main_window_inited', inited); await queue; await closeNow() },
  }
  bridge.register('windows:openLyrics', () => service.openLyrics())
  bridge.register('windows:closeLyrics', () => service.closeLyrics())
  bridge.register('windows:status', service.getStatus)
  return service
}
module.exports = { createWindows, PARENT, CHILD }
