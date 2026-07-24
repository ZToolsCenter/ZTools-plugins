import { buildShopApiAssetUrl } from '../config/runtimeConfig'
import type {
  PluginMarketCategoryDto,
  PluginMarketPlugin,
  PluginMarketPluginDto,
  PluginMarketPluginReference,
  PluginMarketStorefront,
  PluginMarketStorefrontCategory,
  StorefrontCategorySummary,
} from '../types/pluginMarket'

export function normalizeMarketAssetUrl(resourcePath?: string): string | undefined {
  if (!resourcePath) {
    return undefined
  }

  if (/^data:/i.test(resourcePath)) {
    return resourcePath
  }

  const normalizedUrl = buildShopApiAssetUrl(resourcePath)
  return normalizedUrl || undefined
}

export function buildEncodedPluginDownloadPath(
  name: string,
  version?: string | null,
  hash?: string | null,
): string {
  const encodedName = encodeURIComponent(name)

  if (hash) {
    const encodedHash = encodeURIComponent(hash)
    if (!version) {
      return `/api/v1/plugins/${encodedName}/download?hash=${encodedHash}`
    }

    const encodedVersion = encodeURIComponent(version)
    return `/api/v1/plugins/${encodedName}/${encodedVersion}/${encodedHash}/download`
  }

  if (!version) {
    return `/api/v1/plugins/${encodedName}/download`
  }

  const encodedVersion = encodeURIComponent(version)
  return `/api/v1/plugins/${encodedName}/${encodedVersion}/download`
}

export function buildPluginDownloadUrl(
  name: string,
  version?: string | null,
  hash?: string | null,
): string {
  return buildShopApiAssetUrl(buildEncodedPluginDownloadPath(name, version, hash))
}

export function resolvePluginInstallPayload(
  plugin: PluginMarketPlugin,
  options: {
    version?: string | null
    hash?: string | null
  } = {},
): PluginMarketPlugin {
  const resolvedVersion = options.version || plugin.version
  const downloadUrl = options.hash
    ? buildPluginDownloadUrl(plugin.name, options.version || null, options.hash)
    : options.version
      ? buildPluginDownloadUrl(plugin.name, resolvedVersion)
      : buildPluginDownloadUrl(plugin.name)

  return {
    ...plugin,
    version: resolvedVersion,
    hash: options.hash || plugin.hash,
    downloadUrl,
  }
}

function toPluginReference(name: string): PluginMarketPluginReference {
  return { name }
}

export function toFallbackCategoryTitle(key: string): string {
  const title = key
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join(' ')

  return title || key
}

export function adaptPlugin(dto: PluginMarketPluginDto): PluginMarketPlugin {
  const categories = Array.isArray(dto.categories)
    ? dto.categories.filter(
        (category): category is string => typeof category === 'string' && category.trim().length > 0,
      )
    : []
  const platform = Array.isArray(dto.platform)
    ? dto.platform.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : []

  return {
    name: dto.name,
    version: dto.version,
    title: dto.title || dto.name,
    description: dto.description,
    author: dto.author,
    main: dto.main,
    logo: normalizeMarketAssetUrl(dto.logo),
    preload: dto.preload,
    features: Array.isArray(dto.features) ? dto.features : [],
    platform,
    categories,
    categoryFallback: !!dto.categoryFallback,
    downloadUrl: normalizeMarketAssetUrl(dto.downloadUrl),
    hash: dto.hash ?? undefined,
    source: dto.source,
    uploaderUserId: dto.uploaderUserId ?? null,
    uploaderAccount: dto.uploaderAccount ?? null,
    uploaderUsername: dto.uploaderUsername ?? null,
    risk: dto.risk ?? null,
  }
}

export function adaptCategory(
  dto: PluginMarketCategoryDto,
  validPluginNames: Set<string>,
): PluginMarketStorefrontCategory | null {
  if (!dto.key) {
    return null
  }

  const pluginNames = Array.isArray(dto.list) ? dto.list : []
  const seenPluginNames = new Set<string>()
  const plugins = pluginNames
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .filter((name) => validPluginNames.has(name) && !seenPluginNames.has(name))
    .map((name) => {
      seenPluginNames.add(name)
      return toPluginReference(name)
    })

  return {
    key: dto.key,
    title: dto.title || toFallbackCategoryTitle(dto.key),
    description: dto.description,
    icon: normalizeMarketAssetUrl(dto.icon),
    plugins,
  }
}

export function deriveFallbackCategories(plugins: PluginMarketPlugin[]): PluginMarketCategoryDto[] {
  const categoryMap = new Map<string, string[]>()

  plugins.forEach((plugin) => {
    ;(plugin.categories || []).forEach((categoryKey) => {
      const normalizedKey = categoryKey.trim()
      if (!normalizedKey) {
        return
      }

      const list = categoryMap.get(normalizedKey) || []
      if (!list.includes(plugin.name)) {
        list.push(plugin.name)
      }
      categoryMap.set(normalizedKey, list)
    })
  })

  return Array.from(categoryMap.entries()).map(([key, list]) => ({
    key,
    title: toFallbackCategoryTitle(key),
    list,
  }))
}

export function buildCategorySummary(
  category: PluginMarketStorefrontCategory,
): StorefrontCategorySummary {
  return {
    key: category.key,
    title: category.title,
    description: category.description,
    icon: category.icon,
    showDescription: !!category.description,
    pluginCount: category.plugins.length,
  }
}

export function buildStorefront(
  plugins: PluginMarketPlugin[],
  categoryDtos: PluginMarketCategoryDto[],
): PluginMarketStorefront {
  const validPluginNames = new Set(plugins.map((plugin) => plugin.name))
  const categoryEntries = categoryDtos
    .map((category) => adaptCategory(category, validPluginNames))
    .filter((category): category is PluginMarketStorefrontCategory => !!category)

  const categories = Object.fromEntries(
    categoryEntries.map((category) => [category.key, category]),
  ) as Record<string, PluginMarketStorefrontCategory>

  const navigationCategories = categoryEntries.map(buildCategorySummary)

  const sections = [] as PluginMarketStorefront['sections']

  if (navigationCategories.length > 0) {
    sections.push({
      type: 'navigation',
      key: 'categories',
      title: '分类',
      categories: navigationCategories,
    })
  }

  if (plugins.length > 0) {
    sections.push({
      type: 'fixed',
      key: 'all-plugins',
      title: '全部插件',
      plugins: plugins.map((plugin) => toPluginReference(plugin.name)),
    })
  }

  return {
    sections,
    categories,
    categoryLayouts: {
      default: [
        {
          type: 'list',
          title: '${title} 全部插件（共 ${count} 个）',
        },
      ],
    },
  }
}
