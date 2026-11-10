export interface Bridge {
  invoke<T>(channel: string, params?: unknown): Promise<T>
  send(channel: string, params?: unknown): void
  readSnapshot<T>(key: string): T
  on(channel: string, listener: (params: any) => void): void
  once(channel: string, listener: (params: any) => void): void
  off(channel: string, listener: (params: any) => void): void
  offAll(channel: string): void
  subscribe(channel: string, listener: (params: any) => void): () => void
  dispose(): Promise<void>
}
declare global { interface Window { lxHost: Bridge } }
