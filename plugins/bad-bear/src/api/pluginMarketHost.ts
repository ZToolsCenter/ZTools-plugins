import type {
  InstalledPlugin,
  OperationResult,
  Platform,
  PluginLaunchOptions,
  PluginLaunchResult,
  PluginMarketPlugin,
  PluginMarketUiPlugin,
  PluginMutationResult,
  PluginReadmeResponse,
} from '../types/pluginMarket'

export function inferPlatform(): Platform {
  const userAgent = navigator.userAgent.toLowerCase()

  if (userAgent.includes('mac')) {
    return 'darwin'
  }

  if (userAgent.includes('linux')) {
    return 'linux'
  }

  return 'win32'
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  return window.ztools.internal.getPlugins()
}

export async function getRunningPlugins(): Promise<string[]> {
  return window.ztools.internal.getRunningPlugins?.() ?? []
}

export function getCurrentPlatform(): Platform {
  return window.ztools.internal.getPlatform?.() ?? inferPlatform()
}

export async function installMarketPlugin(
  plugin: PluginMarketPlugin,
): Promise<PluginMutationResult> {
  return window.ztools.internal.installPluginFromMarket(JSON.parse(JSON.stringify(plugin)))
}

export async function deleteInstalledPlugin(pluginPath: string): Promise<OperationResult> {
  return window.ztools.internal.deletePlugin(pluginPath)
}

export async function getPluginReadme(target: string): Promise<PluginReadmeResponse> {
  return window.ztools.internal.getPluginReadme(target)
}

export async function openInstalledPlugin(
  plugin: PluginMarketUiPlugin,
): Promise<PluginLaunchResult | void> {
  if (!plugin.path) {
    throw new Error('找不到插件路径')
  }

  const launch = window.ztools.internal.launch
  if (!launch) {
    throw new Error('当前宿主未暴露 launch 能力')
  }

  const payload: PluginLaunchOptions = {
    path: plugin.path,
    type: 'plugin',
    name: plugin.title || plugin.name,
    param: {},
  }

  return launch(payload)
}

export async function reloadInstalledPlugin(pluginPath: string): Promise<OperationResult> {
  const reloadPlugin = window.ztools.internal.reloadPlugin
  if (!reloadPlugin) {
    throw new Error('当前宿主未暴露 reloadPlugin 能力')
  }

  return reloadPlugin(pluginPath)
}

export async function stopInstalledPlugin(pluginPath: string): Promise<OperationResult> {
  const killPlugin = window.ztools.internal.killPlugin
  if (!killPlugin) {
    throw new Error('当前宿主未暴露 killPlugin 能力')
  }

  return killPlugin(pluginPath)
}

export async function revealPluginInFinder(pluginPath: string): Promise<void> {
  const revealInFinder = window.ztools.internal.revealInFinder
  if (!revealInFinder) {
    throw new Error('当前宿主未暴露 revealInFinder 能力')
  }

  await revealInFinder(pluginPath)
}
