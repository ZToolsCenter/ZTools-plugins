/// <reference path="../../vendor/lx/src/common/types/common.d.ts" />
/// <reference path="../../vendor/lx/src/common/types/music.d.ts" />
/// <reference path="../../vendor/lx/src/common/types/player.d.ts" />
/// <reference path="../../vendor/lx/src/common/types/user_api.d.ts" />
/// <reference path="../../vendor/lx/src/common/types/sync.d.ts" />
/// <reference path="../../vendor/lx/src/common/types/open_api.d.ts" />

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
export interface NetworkRequestOptions {
  url: string
  id?: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array | ArrayBuffer | Record<string, unknown>
  form?: Record<string, unknown>
  formData?: Record<string, unknown>
  timeout?: number
  proxy?: string
  maxRedirects?: number
}
export interface HttpResponse {
  statusCode: number
  statusMessage: string
  headers: Record<string, string | string[]>
  raw: Uint8Array
  bytes?: number
  body: unknown
}
export interface NetworkService {
  request(options: NetworkRequestOptions): { id: string; result: Promise<HttpResponse>; cancel(): void }
  requestSource(options: Pick<NetworkRequestOptions, 'url' | 'id' | 'method' | 'headers' | 'body' | 'form' | 'formData' | 'timeout'>): { id: string; result: Promise<HttpResponse>; cancel(): void }
  cancel(id: string): void
  inspect(): { pending: number }
  dispose(): void
}
export interface SourceService {
  importScript(script: string): LX.UserApi.ImportUserApi
  list(): LX.UserApi.UserApiInfo[]
  activate(id: string): Promise<void>
  remove(ids: string[]): Promise<void>
  request(input: LX.UserApi.UserApiRequestParams): Promise<unknown>
  cancel(requestKey: string): void
  getStatus(): LX.UserApi.UserApiStatus
  getGeneration(): number
  inspect(): { generation: number; sessions: number; pending: number; http: number }
  dispose(): Promise<void>
}
export type PlayerCommand =
  | { type: 'play' | 'pause' | 'playPause' | 'prev' | 'next' | 'collect' | 'unCollect' }
  | { type: 'seek' | 'volume'; value: number }
  | { type: 'mute'; value: boolean }
  | { type: 'playList'; listId: string; index: number }
  | { type: 'search'; text: string; source?: LX.OnlineSource | 'all'; page?: number; index?: number }
export interface PlayerService {
  getState(): LX.Player.Status
  dispatch(command: PlayerCommand): Promise<void>
  subscribe(listener: (state: LX.Player.Status) => void): () => void
}
export type SyncConfig = ({ mode: 'server' } & LX.Sync.EnableServer) | ({ mode: 'client' } & LX.Sync.EnableClient)
export type SyncStatus = ({ mode: 'server' } & LX.Sync.ServerStatus) | ({ mode: 'client' } & LX.Sync.ClientStatus)
export interface SyncService {
  start(config: SyncConfig): Promise<SyncStatus>
  stop(): Promise<SyncStatus>
  getStatus(): SyncStatus
  subscribe(listener: (state: SyncStatus) => void): () => void
  dispose(): Promise<void>
}
export interface OpenAPIService {
  start(config: LX.OpenAPI.EnableServer): Promise<LX.OpenAPI.Status>
  stop(): Promise<LX.OpenAPI.Status>
  getStatus(): LX.OpenAPI.Status
  dispose(): Promise<void>
}
export interface WindowsService {
  openLyrics(): Promise<void>
  closeLyrics(): Promise<void>
  getStatus(): { open: boolean; ready: boolean }
  dispose(): Promise<void>
}
export interface BackupService {
  export(kind: 'all' | 'lists' | 'settings', path: string): Promise<void>
  import(path: string, kind: 'all' | 'lists' | 'settings'): Promise<void>
  exportListText(path: string, format: 'txt' | 'csv', merge?: boolean): Promise<void>
}
declare global { interface Window { lxHost: Bridge } }
