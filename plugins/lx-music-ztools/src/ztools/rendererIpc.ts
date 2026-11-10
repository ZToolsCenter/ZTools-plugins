import './contracts'
const wrappers = new Map<string, Map<Function, (params: any) => void>>()
export function rendererInvoke<T = unknown, V = T>(name: string, params?: T): Promise<V> { return window.lxHost.invoke<V>(name, params) }
export function rendererSend<T>(name: string, params?: T): void { window.lxHost.send(name, params) }
export function rendererSendSync<T>(name: string, _params?: T): void { window.lxHost.readSnapshot(name) }
export function rendererOn(name: string, listener: Function): void {
  const byListener = wrappers.get(name) || new Map()
  const wrapper = (params: any) => listener({ event: null, params })
  if (byListener.has(listener)) return
  byListener.set(listener, wrapper); wrappers.set(name, byListener)
  window.lxHost.on(name, wrapper)
}
export function rendererOnce(name: string, listener: Function): void {
  const wrapper = (params: any) => { rendererOff(name, listener); listener({ event: null, params }) }
  const byListener = wrappers.get(name) || new Map()
  byListener.set(listener, wrapper); wrappers.set(name, byListener)
  window.lxHost.once(name, wrapper)
}
export function rendererOff(name: string, listener: Function): void {
  const byListener = wrappers.get(name)
  const wrapper = byListener?.get(listener)
  if (wrapper) { window.lxHost.off(name, wrapper); byListener.delete(listener) }
  if (!byListener?.size) wrappers.delete(name)
}
export function rendererOffAll(name: string): void { window.lxHost.offAll(name); wrappers.delete(name) }
