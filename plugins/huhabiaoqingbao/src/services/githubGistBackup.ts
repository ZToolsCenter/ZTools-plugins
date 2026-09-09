import axios from 'axios'
import type { Emoticon } from '@/types'
import { getStorageItem, setStorageItem, STORAGE_KEYS } from '@/utils/storage'

export type BackupStatus = 'idle' | 'running' | 'success' | 'error'

export interface GithubGistBackupSettings {
  token: string
  gistId: string
  gistUrl: string
  autoBackup: boolean
  lastBackupAt: number | null
  lastBackupStatus: BackupStatus
  lastBackupMessage: string
}

interface GistFileInfo {
  filename: string
  content?: string
  truncated?: boolean
  raw_url?: string
}

interface GistResponse {
  id: string
  html_url: string
  files: Record<string, GistFileInfo | null>
}

interface GistPatchPayload {
  description?: string
  files: Record<string, { content: string } | null>
}

interface BackupManifestItem {
  id: string
  name: string
  type: string
  favorite: boolean
  createdAt: number
  createTime: number
  updateTime: number
  tags: string[]
  backupFile: string
}

interface BackupManifest {
  format: string
  exportedAt: string
  totalCount: number
  emoticons: BackupManifestItem[]
}

interface BackupFilePayload {
  format: string
  exportedAt: string
  emoticon: {
    id: string
    name: string
    type: string
    favorite: boolean
    createdAt: number
    createTime: number
    updateTime: number
    tags: string[]
  }
  file: {
    mimeType: string
    size: number
    dataBase64: string
  }
}

export interface BackupRestoreItem {
  emoticon: Emoticon
  file: Blob
}

const BACKUP_FORMAT = 'bqb-gist-backup-v1'
const MANIFEST_FILE = 'emoticons-manifest.json'
const README_FILE = 'README.md'
const EMOTICON_FILE_PREFIX = 'emoticon-'

const DEFAULT_BACKUP_SETTINGS: GithubGistBackupSettings = {
  token: '',
  gistId: '',
  gistUrl: '',
  autoBackup: false,
  lastBackupAt: null,
  lastBackupStatus: 'idle',
  lastBackupMessage: ''
}

class GithubGistBackupService {
  private taskQueue: Promise<unknown> = Promise.resolve()

  async getSettings(): Promise<GithubGistBackupSettings> {
    const settings = await getStorageItem<GithubGistBackupSettings>(
      STORAGE_KEYS.GITHUB_GIST_BACKUP,
      DEFAULT_BACKUP_SETTINGS
    )

    return {
      ...DEFAULT_BACKUP_SETTINGS,
      ...settings
    }
  }

  async saveSettings(
    partial: Partial<GithubGistBackupSettings>
  ): Promise<GithubGistBackupSettings> {
    const current = await this.getSettings()
    const next = {
      ...current,
      ...partial
    }

    await setStorageItem(STORAGE_KEYS.GITHUB_GIST_BACKUP, next)
    return next
  }

  async backupAllEmoticons(emoticons: Emoticon[]): Promise<GistResponse> {
    return this.enqueue(async () => {
      const settings = await this.getSettings()
      const token = settings.token.trim()

      if (!token) {
        throw new Error('请先填写 GitHub Token')
      }

      await this.saveSettings({
        lastBackupStatus: 'running',
        lastBackupMessage: '正在执行全量备份...'
      })

      try {
        const gist = await this.ensureGist(token, settings.gistId.trim())
        const existingGist = await this.getGist(token, gist.id)
        const files: Record<string, { content: string } | null> = {
          [MANIFEST_FILE]: {
            content: this.buildManifestContent(emoticons)
          },
          [README_FILE]: {
            content: this.buildReadmeContent()
          }
        }

        for (const emoticon of emoticons) {
          const fileName = this.getEmoticonBackupFileName(emoticon.id)
          const content = await this.buildBackupFileContent(emoticon)
          files[fileName] = { content }
        }

        for (const fileName of Object.keys(existingGist.files || {})) {
          if (
            fileName.startsWith(EMOTICON_FILE_PREFIX) &&
            !files[fileName]
          ) {
            files[fileName] = null
          }
        }

        const updatedGist = await this.patchGist(token, gist.id, {
          description: `BQB 表情包备份 ${new Date().toLocaleString('zh-CN')}`,
          files
        })

        await this.saveSettings({
          gistId: updatedGist.id,
          gistUrl: updatedGist.html_url,
          lastBackupAt: Date.now(),
          lastBackupStatus: 'success',
          lastBackupMessage: `已备份 ${emoticons.length} 个表情包`
        })

        return updatedGist
      } catch (error) {
        const message = this.getErrorMessage(error)
        await this.saveSettings({
          lastBackupStatus: 'error',
          lastBackupMessage: message
        })
        throw error
      }
    })
  }

  async autoBackupNewEmoticon(
    emoticon: Emoticon,
    file: Blob,
    allEmoticons: Emoticon[]
  ): Promise<GistResponse | null> {
    return this.enqueue(async () => {
      const settings = await this.getSettings()
      const token = settings.token.trim()

      if (!settings.autoBackup || !token) {
        return null
      }

      await this.saveSettings({
        lastBackupStatus: 'running',
        lastBackupMessage: `正在自动备份 ${emoticon.name || '新表情'}...`
      })

      try {
        const gist = await this.ensureGist(token, settings.gistId.trim())
        const updatedGist = await this.patchGist(token, gist.id, {
          description: `BQB 自动备份 ${new Date().toLocaleString('zh-CN')}`,
          files: {
            [MANIFEST_FILE]: {
              content: this.buildManifestContent(allEmoticons)
            },
            [README_FILE]: {
              content: this.buildReadmeContent()
            },
            [this.getEmoticonBackupFileName(emoticon.id)]: {
              content: await this.buildBackupFileContent(emoticon, file)
            }
          }
        })

        await this.saveSettings({
          gistId: updatedGist.id,
          gistUrl: updatedGist.html_url,
          lastBackupAt: Date.now(),
          lastBackupStatus: 'success',
          lastBackupMessage: `已自动备份 ${emoticon.name || '新表情'}`
        })

        return updatedGist
      } catch (error) {
        const message = this.getErrorMessage(error)
        await this.saveSettings({
          lastBackupStatus: 'error',
          lastBackupMessage: message
        })
        throw error
      }
    })
  }

  async downloadBackupEmoticons(): Promise<BackupRestoreItem[]> {
    return this.enqueue(async () => {
      const settings = await this.getSettings()
      const token = settings.token.trim()
      const gistId = settings.gistId.trim()

      if (!token) {
        throw new Error('请先填写 GitHub Token')
      }

      if (!gistId) {
        throw new Error('请先填写或创建 Gist ID')
      }

      await this.saveSettings({
        lastBackupStatus: 'running',
        lastBackupMessage: '正在从 Gist 同步到本地...'
      })

      try {
        const gist = await this.getGist(token, gistId)
        const manifest = await this.readManifest(gist, token)
        const restoreItems: BackupRestoreItem[] = []

        for (const manifestItem of manifest.emoticons || []) {
          const gistFile = gist.files?.[manifestItem.backupFile]
          if (!gistFile) {
            continue
          }

          const filePayload = await this.readBackupFile(gistFile, token)
          restoreItems.push({
            emoticon: {
              ...filePayload.emoticon,
              url: ''
            },
            file: this.base64ToBlob(filePayload.file.dataBase64, filePayload.file.mimeType || filePayload.emoticon.type)
          })
        }

        await this.saveSettings({
          gistId: gist.id,
          gistUrl: gist.html_url,
          lastBackupAt: Date.now(),
          lastBackupStatus: 'success',
          lastBackupMessage: `已从 Gist 读取 ${restoreItems.length} 个表情包`
        })

        return restoreItems
      } catch (error) {
        const message = this.getSyncErrorMessage(error)
        await this.saveSettings({
          lastBackupStatus: 'error',
          lastBackupMessage: message
        })
        throw error
      }
    })
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const runTask = this.taskQueue.then(task, task)
    this.taskQueue = runTask.then(
      () => undefined,
      () => undefined
    )
    return runTask
  }

  private async ensureGist(
    token: string,
    gistId: string
  ): Promise<GistResponse> {
    if (gistId) {
      try {
        const gist = await this.getGist(token, gistId)
        await this.saveSettings({
          gistId: gist.id,
          gistUrl: gist.html_url
        })
        return gist
      } catch (error: any) {
        if (axios.isAxiosError(error) && error.response?.status !== 404) {
          throw error
        }
      }
    }

    const createdGist = await this.createGist(token)
    await this.saveSettings({
      gistId: createdGist.id,
      gistUrl: createdGist.html_url
    })
    return createdGist
  }

  private async createGist(token: string): Promise<GistResponse> {
    const response = await axios.post<GistResponse>(
      'https://api.github.com/gists',
      {
        description: 'BQB 表情包备份',
        public: false,
        files: {
          [README_FILE]: {
            content: this.buildReadmeContent()
          },
          [MANIFEST_FILE]: {
            content: this.buildManifestContent([])
          }
        }
      },
      {
        headers: this.buildHeaders(token)
      }
    )

    return response.data
  }

  private async getGist(token: string, gistId: string): Promise<GistResponse> {
    const response = await axios.get<GistResponse>(
      `https://api.github.com/gists/${gistId}`,
      {
        headers: this.buildHeaders(token)
      }
    )

    return response.data
  }

  private async patchGist(
    token: string,
    gistId: string,
    payload: GistPatchPayload
  ): Promise<GistResponse> {
    const response = await axios.patch<GistResponse>(
      `https://api.github.com/gists/${gistId}`,
      payload,
      {
        headers: this.buildHeaders(token)
      }
    )

    return response.data
  }

  private buildHeaders(token: string) {
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  private async readManifest(
    gist: GistResponse,
    token: string
  ): Promise<BackupManifest> {
    const manifestFile = gist.files?.[MANIFEST_FILE]
    if (!manifestFile) {
      throw new Error('Gist 中未找到备份索引文件')
    }

    const content = await this.getGistFileContent(manifestFile, token)
    const manifest = JSON.parse(content) as BackupManifest

    if (manifest.format !== BACKUP_FORMAT) {
      throw new Error('Gist 备份格式不兼容')
    }

    return manifest
  }

  private async readBackupFile(
    gistFile: GistFileInfo,
    token: string
  ): Promise<BackupFilePayload> {
    const content = await this.getGistFileContent(gistFile, token)
    const payload = JSON.parse(content) as BackupFilePayload

    if (payload.format !== BACKUP_FORMAT) {
      throw new Error(`备份文件 ${gistFile.filename} 格式不兼容`)
    }

    return payload
  }

  private async getGistFileContent(
    gistFile: GistFileInfo,
    token: string
  ): Promise<string> {
    if (gistFile.content && !gistFile.truncated) {
      return gistFile.content
    }

    if (!gistFile.raw_url) {
      throw new Error(`无法读取备份文件 ${gistFile.filename}`)
    }

    const response = await axios.get<string>(gistFile.raw_url, {
      headers: {
        Authorization: `Bearer ${token}`
      },
      responseType: 'text'
    })

    return response.data
  }

  private buildManifestContent(emoticons: Emoticon[]): string {
    return JSON.stringify(
      {
        format: BACKUP_FORMAT,
        exportedAt: new Date().toISOString(),
        totalCount: emoticons.length,
        emoticons: emoticons.map(emoticon => ({
          ...this.sanitizeEmoticon(emoticon),
          backupFile: this.getEmoticonBackupFileName(emoticon.id)
        }))
      },
      null,
      2
    )
  }

  private buildReadmeContent(): string {
    return [
      '# BQB 表情包备份',
      '',
      '该 Gist 由呼哈表情包自动维护。',
      '',
      `备份格式: ${BACKUP_FORMAT}`,
      '',
      `- ${MANIFEST_FILE}: 备份索引与元数据`,
      `- ${EMOTICON_FILE_PREFIX}*.json: 单个表情包的元数据与 Base64 内容`
    ].join('\n')
  }

  private getEmoticonBackupFileName(id: string): string {
    return `${EMOTICON_FILE_PREFIX}${id}.json`
  }

  private sanitizeEmoticon(emoticon: Emoticon) {
    return {
      id: emoticon.id,
      name: emoticon.name,
      type: emoticon.type,
      favorite: emoticon.favorite,
      createdAt: emoticon.createdAt,
      createTime: emoticon.createTime,
      updateTime: emoticon.updateTime,
      tags: Array.from(emoticon.tags || [])
    }
  }

  private async buildBackupFileContent(
    emoticon: Emoticon,
    sourceBlob?: Blob
  ): Promise<string> {
    const blob = sourceBlob || await this.fetchEmoticonBlob(emoticon)
    const dataBase64 = await this.blobToBase64(blob)

    return JSON.stringify(
      {
        format: BACKUP_FORMAT,
        exportedAt: new Date().toISOString(),
        emoticon: this.sanitizeEmoticon(emoticon),
        file: {
          mimeType: blob.type || emoticon.type,
          size: blob.size,
          dataBase64
        }
      },
      null,
      2
    )
  }

  private async fetchEmoticonBlob(emoticon: Emoticon): Promise<Blob> {
    if (!emoticon.url) {
      throw new Error(`表情包 ${emoticon.name || emoticon.id} 缺少可读取的文件地址`)
    }

    const response = await fetch(emoticon.url)
    if (!response.ok) {
      throw new Error(`无法读取表情包文件：${emoticon.name || emoticon.id}`)
    }

    return response.blob()
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = String(reader.result || '')
        const markerIndex = result.indexOf(',')
        resolve(markerIndex >= 0 ? result.slice(markerIndex + 1) : result)
      }
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
      reader.readAsDataURL(blob)
    })
  }

  private base64ToBlob(base64: string, mimeType: string): Blob {
    const binary = atob(base64)
    const length = binary.length
    const bytes = new Uint8Array(length)

    for (let i = 0; i < length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }

    return new Blob([bytes], { type: mimeType || 'application/octet-stream' })
  }

  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const apiMessage = error.response?.data?.message
      if (typeof apiMessage === 'string' && apiMessage.trim()) {
        return `GitHub 备份失败：${apiMessage}`
      }
    }

    if (error instanceof Error && error.message) {
      return error.message
    }

    return 'GitHub 备份失败'
  }

  private getSyncErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const apiMessage = error.response?.data?.message
      if (typeof apiMessage === 'string' && apiMessage.trim()) {
        return `GitHub 同步失败：${apiMessage}`
      }
    }

    if (error instanceof Error && error.message) {
      return error.message
    }

    return 'GitHub 同步失败'
  }
}

export const githubGistBackupService = new GithubGistBackupService()
export { DEFAULT_BACKUP_SETTINGS }
