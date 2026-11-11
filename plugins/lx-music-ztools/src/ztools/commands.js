import router from '@renderer/router'
let last = 0, pending = Promise.resolve()
async function perform({ code, payload }) {
  if (code === 'search') {
    const text = typeof payload === 'string' ? payload.replace(/^lx(?:搜索|\s+search|\s+搜索)(?:\s+|$)/i, '').trim() : ''
    await router.push({ path: '/search', query: { text, source: 'all', type: 'music', page: '1' } })
  } else if (code === 'lyrics') {
    const status = await window.lxHost.invoke('windows:status')
    await window.lxHost.invoke(status.open ? 'windows:closeLyrics' : 'windows:openLyrics')
  } else {
    await window.lxPlayer.dispatch({ type: code === 'play-pause' ? 'playPause' : code })
    await window.ztools.outPlugin(false)
  }
}
function receive(packet) {
  if (packet.sequence <= last) return
  last = packet.sequence
  pending = pending.then(() => perform(packet.action)).catch(error => console.error('LX 指令执行失败', error))
}
window.lxHost.subscribe('commands:action', receive)
void window.lxHost.invoke('commands:ready').then(queued => queued.forEach(receive))
