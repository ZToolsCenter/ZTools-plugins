const SETTINGS_VERSION = 4

const DEFAULT_SOURCES = [
  {
    id: 'docker-hub',
    name: 'Docker Hub 官方',
    url: 'https://registry-1.docker.io',
    username: '',
    password: ''
  },
  {
    id: 'one-ms',
    name: '1ms.run',
    url: 'https://docker.1ms.run',
    username: '',
    password: ''
  },
  {
    id: 'xuanyuan',
    name: '轩辕镜像',
    url: 'https://docker.xuanyuan.me',
    username: '',
    password: ''
  },
  {
    id: 'xuanyuan-pro',
    name: '轩辕镜像（付费）',
    url: 'https://docker.xuanyuan.cloud',
    username: '',
    password: ''
  },
  {
    id: 'dao-cloud',
    name: 'DaoCloud · Docker Hub',
    url: 'https://docker.m.daocloud.io',
    username: '',
    password: ''
  },
  {
    id: 'dao-k8s',
    name: 'DaoCloud · Kubernetes',
    url: 'https://k8s.m.daocloud.io',
    username: '',
    password: ''
  },
  {
    id: 'dao-nvcr',
    name: 'DaoCloud · NVIDIA',
    url: 'https://nvcr.m.daocloud.io',
    username: '',
    password: ''
  },
  {
    id: 'dao-gcr',
    name: 'DaoCloud · Google',
    url: 'https://gcr.m.daocloud.io',
    username: '',
    password: ''
  },
  {
    id: 'dao-ghcr',
    name: 'DaoCloud · GitHub',
    url: 'https://ghcr.m.daocloud.io',
    username: '',
    password: ''
  },
  {
    id: 'dao-quay',
    name: 'DaoCloud · Quay',
    url: 'https://quay.m.daocloud.io',
    username: '',
    password: ''
  }
]

/** 创建插件默认设置。 */
export function createDefaultSettings(downloadPath: string): AppSettings {
  return {
    version: SETTINGS_VERSION,
    sources: DEFAULT_SOURCES.map((source) => ({ ...source, proxyEnabled: false })),
    selectedSourceId: DEFAULT_SOURCES[0].id,
    proxy: {
      protocol: 'http',
      address: '',
      username: '',
      password: ''
    },
    downloadPath
  }
}

/** 复制设置，避免设置页直接修改已生效配置。 */
export function cloneSettings(settings: AppSettings): AppSettings {
  return {
    version: SETTINGS_VERSION,
    sources: settings.sources.map((source) => ({ ...source })),
    selectedSourceId: settings.selectedSourceId,
    proxy: { ...settings.proxy },
    downloadPath: settings.downloadPath
  }
}

/** 校正本地存储中的设置结构并迁移旧版内置镜像源。 */
export function normalizeSettings(value: unknown, defaultDownloadPath: string): AppSettings {
  const defaults = createDefaultSettings(defaultDownloadPath)
  if (!isRecord(value)) return defaults

  const storedSources = readSources(value.sources)
  const sources = value.version === SETTINGS_VERSION
    ? storedSources
    : migrateLegacySources(storedSources)
  if (sources.length === 0) return defaults

  const selectedSourceId = sources.some((source) => source.id === value.selectedSourceId)
    ? String(value.selectedSourceId)
    : sources[0].id
  const proxyValue = isRecord(value.proxy) ? value.proxy : {}
  const normalizedSources = sources.map((source) => ({
    ...source,
    proxyEnabled: source.proxyEnabled || (
      value.version !== SETTINGS_VERSION &&
      source.id === selectedSourceId &&
      (
        proxyValue.enabled === true ||
        (proxyValue.enabled === undefined && Boolean(stringValue(proxyValue.address).trim()))
      )
    )
  }))
  return {
    version: SETTINGS_VERSION,
    sources: normalizedSources,
    selectedSourceId,
    proxy: {
      protocol: proxyValue.protocol === 'https' ? 'https' : 'http',
      address: stringValue(proxyValue.address),
      username: stringValue(proxyValue.username),
      password: stringValue(proxyValue.password)
    },
    downloadPath: stringValue(value.downloadPath) || defaultDownloadPath
  }
}

/** 将代理设置转换为下载引擎可使用的 URL。 */
export function buildProxyUrl(proxy: ProxySetting): string {
  const address = proxy.address.trim()
  if (!address) return ''
  const withoutProtocol = address.replace(/^https?:\/\//i, '')
  const url = new URL(`${proxy.protocol}://${withoutProtocol}`)
  if (proxy.username) url.username = proxy.username
  if (proxy.password) url.password = proxy.password
  return url.toString()
}

/** 从未知存储值中读取有效镜像源。 */
function readSources(value: unknown): ImageSourceSetting[] {
  if (!Array.isArray(value)) return []
  const sourceIds = new Set<string>()
  return value
    .filter(isRecord)
    .map((source, index) => {
      const requestedId = stringValue(source.id) || `source-${index + 1}`
      let id = requestedId
      let suffix = 2
      while (sourceIds.has(id)) {
        id = `${requestedId}-${suffix}`
        suffix += 1
      }
      sourceIds.add(id)
      return {
        id,
        name: stringValue(source.name),
        url: stringValue(source.url),
        username: stringValue(source.username),
        password: stringValue(source.password),
        proxyEnabled: source.proxyEnabled === true
      }
    })
    .filter((source) => source.name && source.url)
}

/** 合并旧设置与新版内置镜像源，并保留用户修改内容。 */
function migrateLegacySources(storedSources: ImageSourceSetting[]): ImageSourceSetting[] {
  const storedById = new Map(storedSources.map((source) => [source.id, source]))
  const builtInIds = new Set(DEFAULT_SOURCES.map((source) => source.id))
  return [
    ...DEFAULT_SOURCES.map((source) => ({
      ...source,
      proxyEnabled: false,
      ...(storedById.get(source.id) || {})
    })),
    ...storedSources.filter((source) => !builtInIds.has(source.id))
  ]
}

/** 判断未知值是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 将未知值安全转换为字符串。 */
function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
