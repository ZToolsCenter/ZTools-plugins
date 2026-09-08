export type MessageKind = 'text' | 'link' | 'image' | 'file'

export interface Attachment {
  id: string
  name: string
  size: number
  mime: string
  path?: string
  chunkSize?: number
  chunks?: number
}

export interface DeviceLinkMessage {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  direction: 'incoming' | 'outgoing'
  kind: MessageKind
  text?: string
  attachments: Attachment[]
  createdAt: string
  updatedAt: string
  status: 'queued' | 'sent' | 'received' | 'synced' | 'failed'
}

export interface PairedDevice {
  id: string
  name: string
  platform: string
  connected: boolean
  pairedAt: string
  lastSeenAt: string
  permissions: {
    text: boolean
    files: boolean
    clipboard: boolean
    autoDownload: boolean
  }
}

export interface ServerStatus {
  running: boolean
  port: number
  lanIPs: string[]
  selectedIP: string
  accessUrl: string
  pairingUrl: string
  pairingCode: string
  pairingExpiresAt: string
  qrDataUrl: string
}

export interface WebDavSettings {
  enabled: boolean
  baseUrl: string
  username: string
  hasPassword: boolean
  hasSyncPassword: boolean
  lastSyncedAt?: string
  status?: string
}

export interface DeviceLinkSettings {
  deviceName: string
  port: number
  pairingCodeMode: 'random' | 'custom'
  customPairingCodeSet: boolean
  autoAcceptTrustedText: boolean
  autoAcceptTrustedFiles: boolean
  maxIncomingFileBytes: number
  webdav: WebDavSettings
}

export interface DeviceLinkState {
  settings: DeviceLinkSettings
  server: ServerStatus
  devices: PairedDevice[]
  messages: DeviceLinkMessage[]
}

export interface SaveSettingsInput {
  deviceName: string
  port: number
  pairingCodeMode: 'random' | 'custom'
  customPairingCode?: string
  autoAcceptTrustedText: boolean
  autoAcceptTrustedFiles: boolean
  maxIncomingFileBytes: number
}

export interface SaveWebDavInput {
  enabled: boolean
  baseUrl: string
  username: string
  password?: string
  syncPassword?: string
}

export interface SaveAttachmentResult {
  status: 'saved' | 'cancelled' | 'missing'
  name?: string
}

export interface DeviceLinkApi {
  getState(): Promise<DeviceLinkState>
  startServer(): Promise<ServerStatus>
  stopServer(): Promise<ServerStatus>
  regeneratePairingCode(): Promise<ServerStatus>
  saveSettings(input: SaveSettingsInput): Promise<DeviceLinkSettings>
  saveWebDavSettings(input: SaveWebDavInput): Promise<WebDavSettings>
  syncWebDav(): Promise<{ status: string; uploaded: number; downloaded: number; skippedAttachments: number }>
  sendText(text: string, conversationId: string): Promise<DeviceLinkMessage>
  sendFiles(paths: string[], conversationId: string): Promise<DeviceLinkMessage>
  sendDroppedFiles(files: File[], conversationId: string): Promise<DeviceLinkMessage>
  sendImage(dataUrl: string, conversationId: string): Promise<DeviceLinkMessage>
  selectFiles(): Promise<string[]>
  copyMessage(messageId: string): Promise<boolean>
  openAttachment(messageId: string, attachmentId: string): Promise<boolean>
  saveAttachment(messageId: string, attachmentId: string): Promise<SaveAttachmentResult>
  deleteMessage(messageId: string): Promise<boolean>
  clearHistory(): Promise<{ deleted: number }>
  disconnectDevice(deviceId: string): Promise<boolean>
  subscribe(callback: (event: { type: string; data: unknown }) => void): () => void
}

declare global {
  interface Window {
    deviceLink: DeviceLinkApi
    ztools?: {
      onPluginEnter?: (callback: (params: { type?: string; code?: string; payload?: unknown }) => void) => void
      onPluginOut?: (callback: () => void) => void
      getAppVersion?: () => string
      hideMainWindow?: () => void
    }
  }
}
