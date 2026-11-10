const DEFAULT_STATE = { status: 'stoped', name: '', singer: '', albumName: '', picUrl: '', progress: 0, duration: 0, playbackRate: 1, lyricLineText: '', lyricLineAllText: '', lyric: '', tlyric: '', rlyric: '', lxlyric: '', collect: false, volume: 1, mute: false }
function bindPlayer({ bridge, lx, names }) {
  lx.player_status = { ...DEFAULT_STATE }
  bridge.setSnapshot('player:state', lx.player_status)
  bridge.register(names.player_status, patch => {
    const safe = Object.fromEntries(Object.entries(patch).filter(([key, value]) => Object.hasOwn(DEFAULT_STATE, key) && typeof value === typeof DEFAULT_STATE[key]))
    lx.event_app.player_status(safe)
    bridge.setSnapshot('player:state', lx.player_status)
  })
  bridge.register(names.inited, () => { bridge.setSnapshot('player:ready', true); lx.event_app.main_window_inited() })
}
module.exports = { bindPlayer }
