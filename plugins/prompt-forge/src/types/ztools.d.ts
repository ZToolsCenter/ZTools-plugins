/** ZTools KV 存储接口 */
interface ZToolsKvStorage {
  get(key: string): any
  set(key: string, value: any): void
  remove(key: string): void
}

/** ZTools DB 存储接口 */
interface ZToolsDbStorage {
  getItem(key: string): any
  setItem(key: string, value: any): void
  removeItem(key: string): void
}

/** ZTools 剪贴板接口 */
interface ZToolsClipboard {
  getHistory(page: number, pageSize: number, type: string): Promise<any>
}

/** ZTools 平台 API */
interface ZToolsAPI {
  copyText(text: string): void
  clipboard?: ZToolsClipboard
  dbStorage?: ZToolsDbStorage
  showNotification(message: string): void
  hideMainWindow(): void
  outPlugin(): Promise<void>
  shellShowItemInFolder(path: string): void
}

/** 预加载的 KV 存储 */
interface KvStoragePreload {
  get(key: string): any
  set(key: string, value: any): void
  remove(key: string): void
}

declare interface Window {
  kvStorage?: KvStoragePreload
  ztools?: ZToolsAPI
}
