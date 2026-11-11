import './contracts'
const wrappers = new Map<string, Map<Function, Set<(params: any) => void>>>()
const lyricPorts = new Map<string, any>()
function eventFor(name: string) {
  if (name !== 'winMain_process_new_desktop_lyric_client' && name !== 'winLyric_provide_main_window_channel') return null
  lyricPorts.get(name)?.close()
  let closed = false
  const port = { onmessage: null as Function | null, onmessageerror: null as Function | null,
    postMessage(data: unknown) { if (!closed) window.lxHost.send('lyric:port', data) },
    start() {}, close() { if (closed) return; closed = true; receive(); disconnect(); lyricPorts.delete(name) } }
  const receive = window.lxHost.subscribe('lyric:port:receive', data => port.onmessage?.({ data }))
  const disconnect = window.lxHost.subscribe('lyric:port:disconnect', () => port.close())
  lyricPorts.set(name, port)
  return { ports: [port] }
}
export function rendererInvoke<T = unknown, V = T>(name: string, params?: T): Promise<V> { return window.lxHost.invoke<V>(name, params) }
export function rendererSend<T>(name: string, params?: T): void { window.lxHost.send(name, params) }
export function rendererSendSync<T = unknown>(name: string, _params?: unknown): T { return window.lxHost.readSnapshot<T>(name) }
export function rendererOn(name: string, listener: Function): void {
  const byListener = wrappers.get(name) || new Map()
  const wrapper = (params: any) => listener({ event: eventFor(name), params })
  if (byListener.has(listener)) return
  byListener.set(listener, new Set([wrapper])); wrappers.set(name, byListener)
  window.lxHost.on(name, wrapper)
}
export function rendererOnce(name: string, listener: Function): void {
  const wrapper = (params: any) => {
    window.lxHost.off(name, wrapper)
    const byListener = wrappers.get(name)
    const set = byListener?.get(listener)
    set?.delete(wrapper)
    if (!set?.size) byListener?.delete(listener)
    if (!byListener?.size) wrappers.delete(name)
    listener({ event: eventFor(name), params })
  }
  const byListener = wrappers.get(name) || new Map()
  const set = byListener.get(listener) || new Set()
  set.add(wrapper); byListener.set(listener, set); wrappers.set(name, byListener)
  window.lxHost.once(name, wrapper)
}
export function rendererOff(name: string, listener: Function): void {
  const byListener = wrappers.get(name)
  const set = byListener?.get(listener)
  if (set) { for (const wrapper of set) window.lxHost.off(name, wrapper); byListener.delete(listener) }
  if (!byListener?.size) wrappers.delete(name)
}
export function rendererOffAll(name: string): void { window.lxHost.offAll(name); wrappers.delete(name); lyricPorts.get(name)?.close() }
