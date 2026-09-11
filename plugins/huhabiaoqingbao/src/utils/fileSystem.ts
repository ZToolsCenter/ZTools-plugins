import { Emoticon } from '@/types'

export class FileSystemService {
  private readonly BASE_DIR = 'emoticons'
  private isZToolsEnvironment: boolean

  constructor() {
    // 检查是否在 ZTools 环境中
    this.isZToolsEnvironment = this.checkZToolsEnvironment()

    // 只在 ZTools 环境中初始化文件系统
    if (this.isZToolsEnvironment) {
      this.ensureBaseDir()
    }
  }

  // 检查是否在 ZTools 环境中
  private checkZToolsEnvironment(): boolean {
    return typeof window !== 'undefined' &&
           window.preload &&
           window.preload.fs &&
           window.preload.utils &&
           typeof window.preload.utils.getDataPath === 'function'
  }

  // 确保基础目录存在
  private ensureBaseDir(): void {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    try {
      const basePath = this.getBasePath()
      if (!window.preload?.fs.existsSync(basePath)) {
        window.preload?.fs.mkdirSync(basePath, { recursive: true })
      }

      // 确保元数据文件存在
      const metadataPath = this.getMetadataPath()
      if (!window.preload?.fs.existsSync(metadataPath)) {
        window.preload?.fs.writeFile(metadataPath, '[]')
      }

      // 确保设置文件存在
      const settingsPath = this.getSettingsPath()
      if (!window.preload?.fs.existsSync(settingsPath)) {
        window.preload?.fs.writeFile(settingsPath, '{}')
      }
    } catch (error) {
      console.error('Failed to ensure base directory:', error)
      throw new Error('Failed to initialize file system service')
    }
  }

  // 获取基础路径
  private getBasePath(): string {
    if (!this.isZToolsEnvironment) {
      throw new Error('File system operations are only available in ZTools environment')
    }
    return window.preload.utils.getDataPath(this.BASE_DIR)
  }

  // 获取表情包文件路径
  private getEmoticonPath(id: string): string {
    if (!this.isZToolsEnvironment) {
      throw new Error('File system operations are only available in ZTools environment')
    }
    return window.preload.utils.joinPath(this.getBasePath(), `${id}.dat`)
  }

  // 获取元数据文件路径
  private getMetadataPath(): string {
    if (!this.isZToolsEnvironment) {
      throw new Error('File system operations are only available in ZTools environment')
    }
    return window.preload.utils.joinPath(this.getBasePath(), 'metadata.json')
  }

  // 获取设置文件路径
  private getSettingsPath(): string {
    if (!this.isZToolsEnvironment) {
      throw new Error('File system operations are only available in ZTools environment')
    }
    return window.preload.utils.joinPath(this.getBasePath(), 'settings.json')
  }

  // 公共方法：获取设置文件路径
  getSettingsFilePath(): string {
    return this.getSettingsPath()
  }

  // 保存表情包文件
  async saveEmoticonFile(id: string, file: Blob): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    try {
      const buffer = await file.arrayBuffer()
      const path = this.getEmoticonPath(id)
      await window.preload?.fs.writeFile(path, new Uint8Array(buffer))
    } catch (error) {
      console.error('Failed to save emoticon file:', error)
      throw error
    }
  }

  async saveEmoticonFiles(items: { id: string; file: Blob }[], concurrency = 12): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < items.length; index += concurrency) {
        const item = items[index]
        await this.saveEmoticonFile(item.id, item.file)
      }
    })

    await Promise.all(workers)
  }

  // 读取表情包文件
  async readEmoticonFile(id: string): Promise<Blob | null> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return null
    }

    try {
      const path = this.getEmoticonPath(id)
      const buffer = await window.preload?.fs.readFile(path)
      return new Blob([buffer])
    } catch {
      return null
    }
  }

  // 保存元数据
  async saveMetadata(emoticons: Emoticon[]): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    try {
      const metadata = emoticons.map(e => ({
        ...e,
        url: undefined // 不保存 URL，因为它是临时的
      }))
      await window.preload?.fs.writeFile(
        this.getMetadataPath(),
        JSON.stringify(metadata)
      )
    } catch (error) {
      console.error('Failed to save metadata:', error)
      throw error
    }
  }

  async upsertMetadata(emoticon: Emoticon): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    const metadata = await this.readMetadata()
    const nextItem = {
      ...emoticon,
      url: undefined
    }
    const existingIndex = metadata.findIndex(item => item.id === emoticon.id)

    if (existingIndex >= 0) {
      metadata.splice(existingIndex, 1, nextItem)
    } else {
      metadata.push(nextItem)
    }

    await window.preload?.fs.writeFile(
      this.getMetadataPath(),
      JSON.stringify(metadata)
    )
  }

  async removeMetadataByIds(ids: string[]): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    const idSet = new Set(ids)
    const metadata = await this.readMetadata()
    await window.preload?.fs.writeFile(
      this.getMetadataPath(),
      JSON.stringify(metadata.filter(item => !idSet.has(item.id)))
    )
  }

  // 读取元数据
  async readMetadata(): Promise<Emoticon[]> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return []
    }

    try {
      const content = await window.preload?.fs.readFile(this.getMetadataPath(), 'utf8')
      return JSON.parse(content as string)
    } catch {
      return []
    }
  }

  // 删除表情包文件
  async deleteEmoticonFile(id: string): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    try {
      const path = this.getEmoticonPath(id)
      await window.preload?.fs.unlink(path)
    } catch {
      // 忽略文件不存在的错误
    }
  }

  async deleteEmoticonFiles(ids: string[], concurrency = 24): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async (_, workerIndex) => {
      for (let index = workerIndex; index < ids.length; index += concurrency) {
        await this.deleteEmoticonFile(ids[index])
      }
    })

    await Promise.all(workers)
  }

  // 保存设置
  async saveSettings(settings: Record<string, any>): Promise<void> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return
    }

    try {
      const settingsPath = this.getSettingsPath()

      // 确保目录存在
      this.ensureBaseDir()

      await window.preload?.fs.writeFile(
        settingsPath,
        JSON.stringify(settings, null, 2)
      )
    } catch (error) {
      console.error('Failed to save settings:', error)
      throw error
    }
  }

  // 读取设置
  async readSettings(): Promise<Record<string, any>> {
    if (!this.isZToolsEnvironment) {
      console.warn('File system operations are only available in ZTools environment')
      return {}
    }

    try {
      const settingsPath = this.getSettingsPath()

      if (!window.preload?.fs.existsSync(settingsPath)) {
        return {}
      }

      const content = await window.preload?.fs.readFile(settingsPath, 'utf8')
      return JSON.parse(content as string)
    } catch (error) {
      console.error('Failed to read settings:', error)
      return {}
    }
  }

  // 检查是否在 ZTools 环境中（公共方法）
  isInZToolsEnvironment(): boolean {
    return this.isZToolsEnvironment
  }
}

export const fileSystemService = new FileSystemService()
