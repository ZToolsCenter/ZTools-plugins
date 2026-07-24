// 已安装插件操作：打开、卸载、停止、打开文件夹

import type { Ref } from 'vue'
import {
  deleteInstalledPlugin,
  openInstalledPlugin,
  removeMarketInstalledPluginHash,
  revealPluginInFinder,
  stopInstalledPlugin,
} from '../../../../api/pluginMarket'
import type { InstalledBusyAction } from '../shared'
import type { PluginMarketUiPlugin } from '../../../../types/pluginMarket'
import { getErrorMessage } from '../shared'

/**
 * 处理打开已安装的插件。
 * 对来自插件市场的插件会先执行风险确认，弹框被直接关闭时中断本次打开。
 */
export async function handleOpenPlugin(
  plugin: PluginMarketUiPlugin,
  params: {
    notifyError: (message: string) => void
    confirmOpenPluginRisk?: (plugin: PluginMarketUiPlugin) => Promise<boolean>
  },
): Promise<void> {
  try {
    if (params.confirmOpenPluginRisk) {
      const confirmed = await params.confirmOpenPluginRisk(plugin)
      if (!confirmed) {
        return
      }
    }

    const result = await openInstalledPlugin(plugin)
    if (result && result.success === false) {
      throw new Error(result.error || '打开插件失败')
    }
  } catch (error) {
    console.error('[PluginMarket] 打开插件失败:', error)
    params.notifyError(getErrorMessage(error, '打开插件失败'))
  }
}

/**
 * 处理插件卸载（带确认对话框）
 */
export async function handleUninstall(
  plugin: PluginMarketUiPlugin,
  params: {
    marketBusyPluginName: Ref<string | null>
    installedBusyPluginName: Ref<string | null>
    installedBusyAction: Ref<InstalledBusyAction>
    notifyError: (message: string) => void
    notifySuccess: (message: string) => void
    confirmAction: (options: {
      title?: string
      message: string
      type?: 'info' | 'warning' | 'danger'
      confirmText?: string
      cancelText?: string
    }) => Promise<boolean>
    closePlugin: () => void
    reloadMarket: () => Promise<void>
  },
): Promise<void> {
  if (!plugin.path) {
    params.notifyError('找不到插件路径，无法卸载')
    return
  }

  if (params.marketBusyPluginName.value || params.installedBusyPluginName.value) {
    return
  }

  const confirmed = await params.confirmAction({
    title: '确认卸载',
    message: `确定卸载 ${plugin.title} 吗？`,
    type: 'danger',
    confirmText: '卸载',
    cancelText: '取消',
  })
  if (!confirmed) {
    return
  }

  params.installedBusyPluginName.value = plugin.name
  params.installedBusyAction.value = 'uninstall'

  try {
    const result = await deleteInstalledPlugin(plugin.path)
    if (!result.success) {
      throw new Error(result.error || '卸载失败')
    }

    params.notifySuccess(`已卸载 ${plugin.title}`)
    removeMarketInstalledPluginHash(plugin.name)
    params.closePlugin()
    await params.reloadMarket()
  } catch (error) {
    console.error('[PluginMarket] 卸载失败:', error)
    params.notifyError(getErrorMessage(error, '卸载失败'))
  } finally {
    params.installedBusyPluginName.value = null
    params.installedBusyAction.value = null
  }
}

/**
 * 处理停止已运行的插件
 */
export async function handleStopPlugin(
  plugin: PluginMarketUiPlugin,
  params: {
    marketBusyPluginName: Ref<string | null>
    installedBusyPluginName: Ref<string | null>
    installedBusyAction: Ref<InstalledBusyAction>
    notifyError: (message: string) => void
    notifySuccess: (message: string) => void
    reloadMarket: () => Promise<void>
  },
): Promise<void> {
  if (!plugin.path) {
    params.notifyError('找不到插件路径，无法停止运行')
    return
  }

  if (params.marketBusyPluginName.value || params.installedBusyPluginName.value) {
    return
  }

  params.installedBusyPluginName.value = plugin.name
  params.installedBusyAction.value = 'stop'

  try {
    const result = await stopInstalledPlugin(plugin.path)
    if (!result.success) {
      throw new Error(result.error || '停止运行失败')
    }

    params.notifySuccess(`已停止 ${plugin.title} 运行`)
    await params.reloadMarket()
  } catch (error) {
    console.error('[PluginMarket] 停止插件失败:', error)
    params.notifyError(getErrorMessage(error, '停止运行失败'))
  } finally {
    params.installedBusyPluginName.value = null
    params.installedBusyAction.value = null
  }
}

/**
 * 处理在 Finder/Explorer 中打开插件文件夹
 */
export async function handleOpenFolder(
  plugin: PluginMarketUiPlugin,
  params: {
    notifyError: (message: string) => void
  },
): Promise<void> {
  if (!plugin.path) {
    params.notifyError('找不到插件路径，无法打开目录')
    return
  }

  try {
    await revealPluginInFinder(plugin.path)
  } catch (error) {
    console.error('[PluginMarket] 打开插件目录失败:', error)
    params.notifyError(getErrorMessage(error, '打开插件目录失败'))
  }
}
