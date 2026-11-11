const labels = ['LX 播放/暂停', 'LX 上一首', 'LX 下一首', 'LX 搜索', 'LX 桌面歌词']
const codes = new Set(['play-pause', 'prev', 'next', 'search', 'lyrics'])
function bindCommands({ bridge, ztools }) {
  let ready = false, closed = false, sequence = 0
  const pending = []
  bridge.register('commands:ready', () => { ready = true; return pending.splice(0) })
  bridge.register('host:hotkeySetting', label => {
    if (!labels.includes(label)) throw new Error('无效的 LX 指令')
    if (!ztools?.redirectHotKeySetting) throw new Error('当前宿主不支持快捷键设置')
    return ztools.redirectHotKeySetting(label)
  })
  return {
    enter(action) {
      if (closed || !codes.has(action?.code)) return
      const packet = { sequence: ++sequence, action }
      if (ready) bridge.emit('commands:action', packet)
      else { if (pending.length >= 50) throw new Error('待执行的 LX 指令过多'); pending.push(packet) }
    },
    dispose() { closed = true; pending.length = 0 },
  }
}
module.exports = { bindCommands }
