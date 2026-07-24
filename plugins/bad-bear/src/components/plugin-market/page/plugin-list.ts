// 插件列表和已安装插件状态映射辅助函数

import type { InstalledPlugin, InstalledViewPlugin, Platform, PluginMarketPlugin, PluginMarketUiPlugin } from '../../../types/pluginMarket'

/**
 * 检查插件在当前平台是否可见
 * 如果没有指定平台限制，则在所有平台可见
 */
export function isPluginVisibleOnPlatform(
  plugin: PluginMarketPlugin,
  platform: Platform,
): boolean {
  // 无平台限制则默认可见
  if (!Array.isArray(plugin.platform) || plugin.platform.length === 0) {
    return true
  }

  return plugin.platform.includes(platform)
}

/**
 * 将已安装插件数组转换为 Map 以实现 O(1) 复杂度的按名称查找
 */
export function toInstalledMap(installedPlugins: InstalledPlugin[]): Map<string, InstalledPlugin> {
  return new Map(installedPlugins.map((plugin) => [plugin.name, plugin]))
}

/**
 * 合并市场插件数据和已安装插件数据，创建统一的商店卡片模型。
 * 商店页只展示安装与运行状态，不根据版本或服务端更新检查结果暴露升级入口。
 */
export function toUiPlugin(
  plugin: PluginMarketPlugin,
  installedMap: Map<string, InstalledPlugin>,
  runningPluginSet: Set<string>,
): PluginMarketUiPlugin {
  const installedPlugin = installedMap.get(plugin.name)
  const localVersion = installedPlugin?.version

  return {
    ...plugin,
    title: plugin.title || installedPlugin?.title || plugin.name,
    description: plugin.description || installedPlugin?.description || '',
    logo: plugin.logo || installedPlugin?.logo,
    author: plugin.author || installedPlugin?.author,
    homepage: plugin.homepage || installedPlugin?.homepage,
    size: typeof plugin.size === 'number' ? plugin.size : installedPlugin?.size,
    features: plugin.features || installedPlugin?.features,
    installed: !!installedPlugin,
    path: installedPlugin?.path,
    localVersion,
    latestVersion: plugin.version || localVersion || '',
    localHash: installedPlugin?.hash,
    latestHash: undefined,
    marketPlugin: plugin,
    hasUpdate: false,
    isRunning: !!installedPlugin?.path && runningPluginSet.has(installedPlugin.path),
    isDevelopment: installedPlugin?.isDevelopment ?? false,
  }
}

/**
 * 构建已安装插件列表，并用市场数据和服务端更新检查结果进行增强。
 * 更新状态只信任 check-updates 返回的 latestHash，按安装时间降序排序。
 */
export function buildInstalledViewPlugins(
  installedPlugins: InstalledPlugin[],
  marketPluginMap: Map<string, PluginMarketPlugin>,
  runningPluginSet: Set<string>,
  updateHashMap: Map<string, string> = new Map(),
): InstalledViewPlugin[] {
  return installedPlugins
    .map((plugin): InstalledViewPlugin => {
      const marketPlugin = marketPluginMap.get(plugin.name)
      const latestVersion = marketPlugin?.version || plugin.version || ''
      const latestHash = updateHashMap.get(plugin.name)

      return {
        ...marketPlugin,
        ...plugin,
        title: marketPlugin?.title || plugin.title || plugin.name,
        description: marketPlugin?.description || plugin.description || '',
        logo: marketPlugin?.logo || plugin.logo,
        author: marketPlugin?.author || plugin.author,
        homepage: marketPlugin?.homepage || plugin.homepage,
        size: typeof marketPlugin?.size === 'number' ? marketPlugin.size : plugin.size,
        features: marketPlugin?.features || plugin.features,
        version: latestVersion,
        installed: true,
        path: plugin.path,
        localVersion: plugin.version,
        latestVersion,
        localHash: plugin.hash,
        latestHash,
        marketPlugin,
        hasUpdate: !!latestHash,
        isRunning: runningPluginSet.has(plugin.path),
        isDevelopment: !!plugin.isDevelopment,
      }
    })
    .sort((left, right) => {
      // 按安装时间降序排序
      const leftTime =
        typeof left.installedAt === 'string' ? new Date(left.installedAt).getTime() : 0
      const rightTime =
        typeof right.installedAt === 'string' ? new Date(right.installedAt).getTime() : 0
      return rightTime - leftTime
    })
}

/**
 * 解析插件引用（如从分类/插件列表）到完整的 UI 插件对象
 */
export function resolvePluginList(
  items: Array<{ name: string }> | undefined,
  pluginMap: Map<string, PluginMarketUiPlugin>,
): PluginMarketUiPlugin[] {
  if (!items?.length) {
    return []
  }

  return items
    .map((item) => pluginMap.get(item.name))
    .filter((plugin): plugin is PluginMarketUiPlugin => !!plugin)
}
