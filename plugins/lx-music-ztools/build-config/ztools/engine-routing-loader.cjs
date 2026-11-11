// Only the active output owner can switch sinks. Chromium rejects element routing
// after createMediaElementSource() hands its sink to the AudioContext.
module.exports = source => {
  source = source.replaceAll('\r\n', '\n')
  const constructor = "audioContext = new window.AudioContext({ latencyHint: 'playback' })"
  const setter = `export const setMediaDeviceId = async(mediaDeviceId: string): Promise<void> => {
  if (!audio) return
  return audio.setSinkId(mediaDeviceId)
}`
  if (!source.includes(constructor) || !source.includes(setter)) throw new Error('LX single audio owner routing contract changed')
  return source.replace('let audioContext: AudioContext', `let effectiveSinkId = ''
const normalizeOutputId = (id: string) => id === 'default' ? '' : id
let audioContext: AudioContext`)
    .replace(constructor, `effectiveSinkId = normalizeOutputId(audio.sinkId || '')
  audioContext = new window.AudioContext({ latencyHint: 'playback',
    ...(typeof window.AudioContext.prototype.setSinkId === 'function' ? { sinkId: effectiveSinkId } : {}) })`)
    .replace(setter, `let outputRouteQueue: Promise<void> = Promise.resolve()
const activeSinkId = () => normalizeOutputId(mediaSource && audioContext && typeof audioContext.sinkId === 'string'
  ? audioContext.sinkId : audio ? audio.sinkId || '' : effectiveSinkId)
export const getMediaDeviceId = () => activeSinkId() || 'default'
export const setMediaDeviceId = (mediaDeviceId: string): Promise<void> => {
  const operation = outputRouteQueue.then(async() => {
    if (!audio) return
    const canRouteContext = typeof window.AudioContext.prototype.setSinkId === 'function'
    const target = normalizeOutputId(mediaDeviceId)
    if (target && (!canRouteContext || typeof audio.setSinkId !== 'function')) {
      throw new Error('当前宿主仅支持系统默认输出')
    }
    const previous = activeSinkId()
    const route = async(sinkId: string) => {
      if (!mediaSource && typeof audio!.setSinkId === 'function') {
        try { await audio!.setSinkId(sinkId) } catch (error) {
          // A concurrent effect may have taken ownership while the element awaited.
          // In that case its AbortError is superseded by routing the new owner.
          if (!mediaSource) throw error
        }
      }
      if (mediaSource && audioContext && canRouteContext && audioContext.sinkId !== sinkId) {
        await audioContext.setSinkId(sinkId)
      }
    }
    try {
      await route(target)
      effectiveSinkId = target
    } catch (error) {
      try { if (activeSinkId() !== previous) await route(previous) } catch (rollbackError) {
        effectiveSinkId = activeSinkId()
        throw new AggregateError([error, rollbackError], '音频输出切换及回退失败')
      }
      effectiveSinkId = previous
      throw error
    }
  })
  outputRouteQueue = operation.catch(() => {})
  return operation
}`)
}
