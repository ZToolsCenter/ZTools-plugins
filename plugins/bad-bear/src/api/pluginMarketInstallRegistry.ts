import type { InstalledPlugin, PluginUpdateCheckRequestItem } from '../types/pluginMarket'

export interface MarketInstalledPluginHashRecord {
  name: string
  hash: string
}

const MARKET_INSTALL_REGISTRY_FILE_NAME = 'installed-plugin-hashes.csv'
const MARKET_INSTALL_REGISTRY_PATH_SEGMENTS = [
  'plugins',
  MARKET_INSTALL_REGISTRY_FILE_NAME,
] as const

type RegistryPathTools = {
  join: (...paths: string[]) => string
}

function getRegistryPathTools(): RegistryPathTools | null {
  return window.services?.path ?? null
}

export function getMarketInstallRegistryFilePath(): string | null {
  const userDataPath = window.ztools?.getPath?.('userData')
  const pathTools = getRegistryPathTools()

  if (!userDataPath || !pathTools) {
    return null
  }

  return pathTools.join(userDataPath, ...MARKET_INSTALL_REGISTRY_PATH_SEGMENTS)
}

export function normalizeSha256Hash(hash: unknown): string | null {
  if (typeof hash !== 'string') {
    return null
  }

  const normalized = hash.trim().toLowerCase()
  if (/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    return normalized
  }

  if (/^[0-9a-f]{64}$/.test(normalized)) {
    return `sha256:${normalized}`
  }

  return null
}

function parseCsvRows(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]

    if (char === '"') {
      if (inQuotes && content[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      if (char === '\r' && content[index + 1] === '\n') {
        index += 1
      }
      continue
    }

    field += char
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function isBlankCsvRow(row: string[]): boolean {
  return row.every((field) => field.trim().length === 0)
}

function isRegistryHeader(row: string[]): boolean {
  return (
    row.length >= 2 &&
    row[0].trim().toLowerCase() === 'name' &&
    row[1].trim().toLowerCase() === 'hash'
  )
}

function parseMarketInstallRegistry(content: string): Map<string, string> {
  const records = new Map<string, string>()
  let hasSeenDataRow = false

  for (const row of parseCsvRows(content)) {
    if (isBlankCsvRow(row)) {
      continue
    }

    if (!hasSeenDataRow && isRegistryHeader(row)) {
      hasSeenDataRow = true
      continue
    }

    hasSeenDataRow = true
    const name = row[0]?.trim() || ''
    const hash = normalizeSha256Hash(row[1])

    if (!name || !hash) {
      continue
    }

    records.set(name, hash)
  }

  return records
}

function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) {
    return value
  }

  return `"${value.replace(/"/g, '""')}"`
}

type SerializedMarketInstalledPluginHashRecord = {
  name: string
  hash: string | null
}

function serializeMarketInstallRegistry(records: Map<string, string>): string {
  const lines = ['name,hash']
  const sortedRecords = Array.from(records.entries())
    .map(([name, hash]): SerializedMarketInstalledPluginHashRecord => ({ name: name.trim(), hash: normalizeSha256Hash(hash) }))
    .filter((record): record is MarketInstalledPluginHashRecord => !!record.name && !!record.hash)
    .sort((left, right) => left.name.localeCompare(right.name))

  for (const record of sortedRecords) {
    lines.push(`${escapeCsvField(record.name)},${escapeCsvField(record.hash)}`)
  }

  return `${lines.join('\n')}\n`
}

export function readMarketInstalledPluginHashes(): Map<string, string> {
  const filePath = getMarketInstallRegistryFilePath()
  if (!filePath || !window.services?.exists || !window.services?.readFile) {
    return new Map()
  }

  try {
    if (!window.services.exists(filePath)) {
      return new Map()
    }

    return parseMarketInstallRegistry(window.services.readFile(filePath, 'utf-8'))
  } catch (error) {
    console.warn('[PluginMarket] 读取已安装插件 hash 记录失败:', error)
    return new Map()
  }
}

export function writeMarketInstalledPluginHashes(records: Map<string, string>): void {
  const filePath = getMarketInstallRegistryFilePath()
  if (!filePath || !window.services?.writeFile) {
    return
  }

  try {
    window.services.writeFile(filePath, serializeMarketInstallRegistry(records))
  } catch (error) {
    console.warn('[PluginMarket] 写入已安装插件 hash 记录失败:', error)
  }
}

export function upsertMarketInstalledPluginHash(name: string, hash: unknown): void {
  const normalizedName = name.trim()
  if (!normalizedName) {
    return
  }

  const normalizedHash = normalizeSha256Hash(hash)
  if (!normalizedHash) {
    removeMarketInstalledPluginHash(normalizedName)
    return
  }

  const records = readMarketInstalledPluginHashes()
  records.set(normalizedName, normalizedHash)
  writeMarketInstalledPluginHashes(records)
}

export function removeMarketInstalledPluginHash(name: string): void {
  const normalizedName = name.trim()
  if (!normalizedName) {
    return
  }

  const records = readMarketInstalledPluginHashes()
  if (!records.delete(normalizedName)) {
    return
  }

  writeMarketInstalledPluginHashes(records)
}

export function applyMarketInstalledPluginHashes(
  installedPlugins: InstalledPlugin[],
  hashRecords = readMarketInstalledPluginHashes(),
): InstalledPlugin[] {
  return installedPlugins.map((plugin) => {
    const hash = hashRecords.get(plugin.name)
    return hash ? { ...plugin, hash } : plugin
  })
}

export function buildMarketPluginUpdateCheckItems(
  installedPlugins: InstalledPlugin[],
  hashRecords = readMarketInstalledPluginHashes(),
): PluginUpdateCheckRequestItem[] {
  return installedPlugins.flatMap((plugin) => {
    const hash = hashRecords.get(plugin.name)
    return hash
      ? [{
          name: plugin.name,
          hash,
        }]
      : []
  })
}
