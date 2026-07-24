import type { AuthUser } from '../types/auth'
import type { ShopApiRuntimeConfig } from '../types/runtimeConfig'

export const DEFAULT_SHOP_API_BASE_URL = 'https://badbear.ydys.cc'

const RUNTIME_CONFIG_FILE_NAME = 'runtime-config.json'
const RUNTIME_CONFIG_PATH_SEGMENTS = ['plugins', 'bad-bear', RUNTIME_CONFIG_FILE_NAME] as const

const listeners = new Set<(config: ShopApiRuntimeConfig) => void>()

let runtimeConfig: ShopApiRuntimeConfig = createDefaultRuntimeConfig()

function createDefaultRuntimeConfig(): ShopApiRuntimeConfig {
  return {
    baseUrl: DEFAULT_SHOP_API_BASE_URL,
    token: '',
    currentUser: null,
  }
}

function cloneUser(user: AuthUser | null | undefined): AuthUser | null {
  return user
    ? {
        ...user,
      }
    : null
}

function cloneConfig(config: ShopApiRuntimeConfig): ShopApiRuntimeConfig {
  return {
    baseUrl: config.baseUrl,
    token: config.token,
    currentUser: cloneUser(config.currentUser),
  }
}

function notifyListeners(): void {
  const snapshot = getShopApiRuntimeConfig()
  listeners.forEach((listener) => listener(snapshot))
}

function isValidAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.account === 'string' &&
    typeof candidate.username === 'string' &&
    (typeof candidate.avatarUrl === 'string' || candidate.avatarUrl === null) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  )
}

type RuntimePathTools = {
  join: (...paths: string[]) => string
}

function getRuntimePathTools(): RuntimePathTools | null {
  return window.services?.path ?? null
}

function getRuntimeConfigFilePath(): string | null {
  const userDataPath = window.ztools?.getPath?.('userData')
  const pathTools = getRuntimePathTools()

  if (!userDataPath || !pathTools) {
    return null
  }

  return pathTools.join(userDataPath, ...RUNTIME_CONFIG_PATH_SEGMENTS)
}

function persistRuntimeConfig(): void {
  const filePath = getRuntimeConfigFilePath()
  if (!filePath || !window.services?.writeFile) {
    return
  }

  window.services.writeFile(filePath, JSON.stringify(runtimeConfig, null, 2))
}

function applyRuntimeConfig(config: ShopApiRuntimeConfig, persist = false): ShopApiRuntimeConfig {
  runtimeConfig = cloneConfig(config)

  if (persist) {
    persistRuntimeConfig()
  }

  notifyListeners()
  return getShopApiRuntimeConfig()
}

function sanitizeRuntimeConfig(raw: unknown): ShopApiRuntimeConfig {
  const defaults = createDefaultRuntimeConfig()

  if (!raw || typeof raw !== 'object') {
    return defaults
  }

  const source = raw as Record<string, unknown>

  return {
    baseUrl:
      typeof source.baseUrl === 'string'
        ? normalizeShopApiBaseUrl(source.baseUrl)
        : defaults.baseUrl,
    token: typeof source.token === 'string' ? source.token : defaults.token,
    currentUser: isValidAuthUser(source.currentUser) ? cloneUser(source.currentUser) : null,
  }
}

export function normalizeShopApiBaseUrl(input?: string): string {
  const trimmed = input?.trim() || ''

  if (!trimmed) {
    return DEFAULT_SHOP_API_BASE_URL
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed)
    ? trimmed
    : `http://${trimmed}`

  let parsedUrl: URL
  try {
    parsedUrl = new URL(withProtocol)
  } catch {
    throw new Error('API 地址格式不正确')
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('API 地址仅支持 http 或 https')
  }

  const normalizedPathname = parsedUrl.pathname.replace(/\/+$/, '')
  return `${parsedUrl.protocol}//${parsedUrl.host}${normalizedPathname}`
}

export function getShopApiRuntimeConfig(): ShopApiRuntimeConfig {
  return cloneConfig(runtimeConfig)
}

export function loadShopApiRuntimeConfig(): ShopApiRuntimeConfig {
  const filePath = getRuntimeConfigFilePath()

  if (!filePath || !window.services?.exists || !window.services?.readFile) {
    return applyRuntimeConfig(createDefaultRuntimeConfig())
  }

  if (!window.services.exists(filePath)) {
    return applyRuntimeConfig(createDefaultRuntimeConfig())
  }

  try {
    const content = window.services.readFile(filePath, 'utf-8')
    if (!content.trim()) {
      return applyRuntimeConfig(createDefaultRuntimeConfig())
    }

    const parsed = JSON.parse(content)
    return applyRuntimeConfig(sanitizeRuntimeConfig(parsed))
  } catch (error) {
    console.error('[ShopApiConfig] 读取运行时配置失败:', error)
    return applyRuntimeConfig(createDefaultRuntimeConfig())
  }
}

export function saveShopApiRuntimeConfig(
  patch: Partial<ShopApiRuntimeConfig>,
): ShopApiRuntimeConfig {
  const nextConfig: ShopApiRuntimeConfig = {
    baseUrl: normalizeShopApiBaseUrl(patch.baseUrl ?? runtimeConfig.baseUrl),
    token: patch.token ?? runtimeConfig.token,
    currentUser:
      patch.currentUser === undefined ? cloneUser(runtimeConfig.currentUser) : cloneUser(patch.currentUser),
  }

  return applyRuntimeConfig(nextConfig, true)
}

export function clearShopApiAuth(): ShopApiRuntimeConfig {
  return saveShopApiRuntimeConfig({
    token: '',
    currentUser: null,
  })
}

export function subscribeShopApiRuntimeConfig(
  listener: (config: ShopApiRuntimeConfig) => void,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function buildShopApiAssetUrl(
  resourcePath: string | null | undefined,
  baseUrl = runtimeConfig.baseUrl,
): string {
  if (!resourcePath) {
    return ''
  }

  if (/^https?:\/\//i.test(resourcePath)) {
    return resourcePath
  }

  const normalizedBaseUrl = normalizeShopApiBaseUrl(baseUrl)
  return `${normalizedBaseUrl}${resourcePath.startsWith('/') ? '' : '/'}${resourcePath}`
}
