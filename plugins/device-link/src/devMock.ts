import type { DeviceLinkApi, DeviceLinkMessage, DeviceLinkState, SaveSettingsInput, SaveWebDavInput } from './types'

export function installDevMock() {
  const now = new Date()
  const messages: DeviceLinkMessage[] = [
    {
      id: 'demo-1', conversationId: 'device:phone', senderId: 'phone', senderName: 'Harris 的 iPhone', direction: 'incoming', kind: 'text',
      text: '在手机上看到一篇不错的文章，发到电脑继续看。', attachments: [],
      createdAt: new Date(now.getTime() - 120000).toISOString(), updatedAt: new Date(now.getTime() - 120000).toISOString(), status: 'received',
    },
    {
      id: 'demo-2', conversationId: 'shared', senderId: 'desktop', senderName: '工作电脑', direction: 'outgoing', kind: 'link',
      text: 'https://ztools.app/device-link', attachments: [],
      createdAt: new Date(now.getTime() - 70000).toISOString(), updatedAt: new Date(now.getTime() - 70000).toISOString(), status: 'sent',
    },
    {
      id: 'demo-3', conversationId: 'device:phone', senderId: 'phone', senderName: 'Harris 的 iPhone', direction: 'incoming', kind: 'image', text: '刚拍的白板',
      attachments: [{ id: 'attachment-demo', name: 'IMG_2048.HEIC', size: 2843000, mime: 'image/heic' }],
      createdAt: new Date(now.getTime() - 30000).toISOString(), updatedAt: new Date(now.getTime() - 30000).toISOString(), status: 'received',
    },
  ]
  const state: DeviceLinkState = {
    settings: {
      deviceName: 'Harris 的 MacBook Pro', port: 32125, pairingCodeMode: 'random', customPairingCodeSet: false,
      autoAcceptTrustedText: true, autoAcceptTrustedFiles: false, maxIncomingFileBytes: 10 * 1024 ** 3,
      webdav: { enabled: true, baseUrl: 'https://dav.example.com/device-link/', username: 'demo', hasPassword: true, hasSyncPassword: true, status: 'ready' },
    },
    server: {
      running: true, port: 32125, lanIPs: ['192.168.1.23'], selectedIP: '192.168.1.23', accessUrl: 'http://192.168.1.23:32125',
      pairingUrl: 'http://192.168.1.23:32125/#pair=demo', pairingCode: '834921', pairingExpiresAt: new Date(now.getTime() + 1800000).toISOString(),
      qrDataUrl: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="white"/><path d="M8 8h28v28H8zm56 0h28v28H64zM8 64h28v28H8zm40-16h12v12H48zm20 0h8v20h-8zm-20 24h20v8H48zm28 8h16v12H76z" fill="#111"/><rect x="15" y="15" width="14" height="14" fill="white"/><rect x="71" y="15" width="14" height="14" fill="white"/><rect x="15" y="71" width="14" height="14" fill="white"/></svg>'),
    },
    devices: [
      {
        id: 'phone', name: 'Harris 的 iPhone', platform: 'iOS', connected: true,
        pairedAt: new Date(now.getTime() - 86400000).toISOString(), lastSeenAt: now.toISOString(),
        permissions: { text: true, files: true, clipboard: true, autoDownload: false },
      },
      {
        id: 'android-phone', name: 'Pixel 9 Pro', platform: 'Android', connected: true,
        pairedAt: new Date(now.getTime() - 3600000).toISOString(), lastSeenAt: now.toISOString(),
        permissions: { text: true, files: true, clipboard: true, autoDownload: false },
      },
    ],
    messages,
  }

  const api: DeviceLinkApi = {
    async getState() { return structuredClone(state) },
    async startServer() { state.server.running = true; return structuredClone(state.server) },
    async stopServer() { state.server.running = false; return structuredClone(state.server) },
    async regeneratePairingCode() { state.server.pairingCode = '592748'; return structuredClone(state.server) },
    async saveSettings(input: SaveSettingsInput) { Object.assign(state.settings, input); return structuredClone(state.settings) },
    async saveWebDavSettings(input: SaveWebDavInput) { Object.assign(state.settings.webdav, input, { hasPassword: Boolean(input.password), hasSyncPassword: Boolean(input.syncPassword) }); return structuredClone(state.settings.webdav) },
    async syncWebDav() { return { status: 'success', uploaded: 2, downloaded: 0, skippedAttachments: 0 } },
    async sendText(text: string, conversationId: string) {
      const message: DeviceLinkMessage = { id: crypto.randomUUID(), conversationId, senderId: 'desktop', senderName: state.settings.deviceName, direction: 'outgoing', kind: /^https?:\/\//.test(text) ? 'link' : 'text', text, attachments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'sent' }
      state.messages.push(message)
      return structuredClone(message)
    },
    async sendFiles(_paths: string[], conversationId: string) { return structuredClone({ ...messages[2], id: crypto.randomUUID(), conversationId, senderId: 'desktop', direction: 'outgoing' }) },
    async sendDroppedFiles(files: File[], conversationId: string) {
      const timestamp = new Date().toISOString()
      const message: DeviceLinkMessage = {
        id: crypto.randomUUID(), conversationId, senderId: 'desktop', senderName: state.settings.deviceName, direction: 'outgoing', kind: 'file',
        attachments: files.map((file) => ({ id: crypto.randomUUID(), name: file.name, size: file.size, mime: file.type || 'application/octet-stream' })),
        createdAt: timestamp, updatedAt: timestamp, status: 'sent',
      }
      state.messages.push(message)
      return structuredClone(message)
    },
    async sendImage(_dataUrl: string, conversationId: string) { return structuredClone({ ...messages[2], id: crypto.randomUUID(), conversationId, senderId: 'desktop', direction: 'outgoing' }) },
    async selectFiles() { return [] },
    async copyMessage() { return true },
    async openAttachment(_messageId: string, _attachmentId: string) { return true },
    async saveAttachment(_messageId: string, _attachmentId: string) { return { status: 'saved', name: 'IMG_2048.HEIC' } },
    async deleteMessage(id: string) { state.messages = state.messages.filter((item) => item.id !== id); return true },
    async clearHistory() { const deleted = state.messages.length; state.messages = []; return { deleted } },
    async disconnectDevice(id: string) { state.devices = state.devices.filter((item) => item.id !== id); return true },
    subscribe() { return () => undefined },
  }
  window.deviceLink = api
}
