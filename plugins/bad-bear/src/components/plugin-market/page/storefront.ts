import type {
  CategoryInfo,
  CategoryLayoutSection,
  InstalledPlugin,
  PluginMarketFetchResponse,
  PluginMarketPlugin,
  PluginMarketSectionModel,
  PluginMarketStorefrontCategory,
  PluginMarketStorefrontSection,
  PluginMarketUiPlugin,
  Platform,
  StorefrontCategorySummary,
} from '../../../types/pluginMarket'
import {
  buildInstalledViewPlugins,
  isPluginVisibleOnPlatform,
  resolvePluginList,
  toInstalledMap,
  toUiPlugin,
} from './shared'

export function buildMarketViewState(
  marketResult: PluginMarketFetchResponse,
  nextInstalledPlugins: InstalledPlugin[],
  nextRunningPluginPaths: string[],
  currentPlatform: Platform,
  updateHashMap: Map<string, string> = new Map(),
): {
  uiPlugins: PluginMarketUiPlugin[]
  marketPlugins: PluginMarketPlugin[]
  storefrontCategories: Record<string, CategoryInfo>
  storefrontSections: PluginMarketSectionModel[]
  categoryLayouts: Record<string, CategoryLayoutSection[]>
  installedViewPlugins: ReturnType<typeof buildInstalledViewPlugins>
} {
  const runningSet = new Set<string>(nextRunningPluginPaths)
  const installedMap = toInstalledMap(nextInstalledPlugins)
  const marketPlugins: PluginMarketPlugin[] = (marketResult.data || []).filter((plugin) =>
    isPluginVisibleOnPlatform(plugin, currentPlatform),
  )

  const uiPlugins: PluginMarketUiPlugin[] = marketPlugins.map((plugin) =>
    toUiPlugin(plugin, installedMap, runningSet),
  )

  const nextPluginMap = new Map<string, PluginMarketUiPlugin>(
    uiPlugins.map((plugin) => [plugin.name, plugin]),
  )
  const nextMarketPluginMap = new Map<string, PluginMarketPlugin>(
    marketPlugins.map((plugin) => [plugin.name, plugin]),
  )
  const nextCategories: Record<string, CategoryInfo> = {}
  const storefront = marketResult.storefront

  if (storefront?.categories) {
    Object.entries(storefront.categories).forEach(
      ([key, category]: [string, PluginMarketStorefrontCategory]) => {
        const categoryPlugins = resolvePluginList(category.plugins, nextPluginMap)
        nextCategories[key] = {
          key: category.key,
          title: category.title,
          description: category.description,
          icon: category.icon,
          plugins: categoryPlugins,
        }
      },
    )
  }

  const nextSections: PluginMarketSectionModel[] = []

  ;(storefront?.sections || []).forEach((section: PluginMarketStorefrontSection) => {
    if (section.type === 'banner') {
      if (section.items?.length) {
        nextSections.push(section)
      }
      return
    }

    if (section.type === 'navigation') {
      const categories = section.categories || []

      if (categories.length > 0) {
        nextSections.push({
          type: 'navigation',
          key: section.key,
          title: section.title,
          categories,
        })
      }
      return
    }

    const sectionPlugins = resolvePluginList(section.plugins, nextPluginMap)
    if (sectionPlugins.length > 0) {
      nextSections.push({
        type: section.type,
        key: section.key,
        title: section.title,
        plugins: sectionPlugins,
      })
    }
  })

  return {
    uiPlugins,
    marketPlugins,
    storefrontCategories: nextCategories,
    storefrontSections: nextSections,
    categoryLayouts: storefront?.categoryLayouts || {},
    installedViewPlugins: buildInstalledViewPlugins(
      nextInstalledPlugins,
      nextMarketPluginMap,
      runningSet,
      updateHashMap,
    ),
  }
}

/**
 * 在流式刷新尚未结束时，用新快照覆盖同名插件并保留旧内容，避免页面因为未到达的条目而闪烁。
 */
export function mergeMarketSnapshots(
  previous: PluginMarketFetchResponse | null,
  incoming: PluginMarketFetchResponse,
): PluginMarketFetchResponse {
  if (!previous?.success || !previous.data?.length) {
    return incoming
  }

  const mergedPlugins = new Map<string, PluginMarketPlugin>()
  ;(previous.data || []).forEach((plugin) => {
    mergedPlugins.set(plugin.name, plugin)
  })
  ;(incoming.data || []).forEach((plugin) => {
    mergedPlugins.set(plugin.name, plugin)
  })

  return {
    success: incoming.success,
    error: incoming.error,
    data: Array.from(mergedPlugins.values()),
    storefront: incoming.storefront || previous.storefront,
  }
}

/**
 * 流结束后直接采用最终快照，让已下线插件和无效分类在一次收敛中被清理掉。
 */
export function finalizeMarketSnapshot(
  snapshot: PluginMarketFetchResponse,
): PluginMarketFetchResponse {
  return snapshot
}
