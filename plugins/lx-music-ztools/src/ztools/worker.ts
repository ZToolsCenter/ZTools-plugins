import './contracts'
const remote = (kind: string) => new Proxy({}, { get(_target, method: string) {
  if (method === 'then') return undefined
  return (...args: any[]) => window.lxHost.invoke(`worker:${kind}`, { method, args })
} })
export const createMainWorker = () => remote('main')
export const createDownloadWorker = () => remote('download')
export const proxyCallback = <T extends Function>(callback: T): T => callback
export default () => ({ main: createMainWorker(), download: createDownloadWorker() })
