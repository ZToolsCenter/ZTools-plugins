// 插件操作编排层 - 组合安装目标、市场和已安装操作

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { PluginDetailState, InstalledBusyAction, MarketBusyAction } from './shared'
import type { PluginMarketUiPlugin, ResolvedPluginDownloadTarget } from '../../../types/pluginMarket'
import { canUpgrade as checkCanUpgrade } from './actions/install-target'
import { handleInstall, handleInstallLatest, handleUpgrade } from './actions/market-actions'
import { handleOpenFolder, handleOpenPlugin, handleStopPlugin, handleUninstall } from './actions/installed-actions'

export function usePluginMarketActions(options: {
  selectedPluginName: Ref<string | null>
  pluginDetailState: Ref<PluginDetailState>
  currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
  canUseInternalPluginApis: Ref<boolean>
  notifyError: (message: string) => void
  notifySuccess: (message: string) => void
  confirmAction: (params: {
    title?: string
    message: string
    type?: 'info' | 'warning' | 'danger'
    confirmText?: string
    cancelText?: string
  }) => Promise<boolean>
  confirmOpenPluginRisk?: (plugin: PluginMarketUiPlugin) => Promise<boolean>
  reloadMarket: () => Promise<void>
  openPluginByName: (name: string) => void
  closePlugin: () => void
}) {
  const marketBusyPluginName = ref<string | null>(null)
  const marketBusyAction = ref<MarketBusyAction>(null)
  const installedBusyPluginName = ref<string | null>(null)
  const installedBusyAction = ref<InstalledBusyAction>(null)

  const selectedPluginBusyAction = computed(() => {
    if (!options.selectedPluginName.value) {
      return null
    }

    if (options.selectedPluginName.value === installedBusyPluginName.value) {
      return installedBusyAction.value
    }

    if (options.selectedPluginName.value === marketBusyPluginName.value) {
      return marketBusyAction.value
    }

    return null
  })

  const canInstallFromMarket = computed(() => options.canUseInternalPluginApis.value)

  function canUpgrade(plugin: PluginMarketUiPlugin): boolean {
    return checkCanUpgrade(plugin)
  }

  /**
   * 将安装动作包装到页面状态中，统一传入当前详情选择、忙碌状态和安装后刷新逻辑。
   */
  async function handleInstallWrapper(
    plugin: PluginMarketUiPlugin,
    installParams: { preferLatest?: boolean } = {},
  ): Promise<void> {
    await handleInstall(plugin, {
      canInstallFromMarket: canInstallFromMarket.value,
      selectedPluginName: options.selectedPluginName.value,
      pluginDetailState: options.pluginDetailState.value,
      currentPluginDownloadTarget: options.currentPluginDownloadTarget,
      marketBusyPluginName,
      marketBusyAction,
      installedBusyPluginName,
      notifyError: options.notifyError,
      notifySuccess: options.notifySuccess,
      reloadMarket: options.reloadMarket,
      openPluginByName: options.openPluginByName,
      preferLatest: installParams.preferLatest,
    })
  }

  /**
   * 从详情页触发安装最新版时强制忽略历史版本选择，始终解析最新可安装目标。
   */
  async function handleInstallLatestWrapper(plugin: PluginMarketUiPlugin): Promise<void> {
    await handleInstallLatest(plugin, {
      canInstallFromMarket: canInstallFromMarket.value,
      selectedPluginName: options.selectedPluginName.value,
      pluginDetailState: options.pluginDetailState.value,
      currentPluginDownloadTarget: options.currentPluginDownloadTarget,
      marketBusyPluginName,
      marketBusyAction,
      installedBusyPluginName,
      notifyError: options.notifyError,
      notifySuccess: options.notifySuccess,
      reloadMarket: options.reloadMarket,
      openPluginByName: options.openPluginByName,
    })
  }

  /**
   * 包装更新动作所需的确认弹窗、忙碌状态和刷新回调，供已安装列表与详情页复用。
   */
  async function handleUpgradeWrapper(plugin: PluginMarketUiPlugin): Promise<void> {
    await handleUpgrade(plugin, {
      selectedPluginName: options.selectedPluginName.value,
      pluginDetailState: options.pluginDetailState.value,
      currentPluginDownloadTarget: options.currentPluginDownloadTarget,
      marketBusyPluginName,
      marketBusyAction,
      installedBusyPluginName,
      installedBusyAction,
      notifyError: options.notifyError,
      notifySuccess: options.notifySuccess,
      reloadMarket: options.reloadMarket,
      openPluginByName: options.openPluginByName,
      confirmAction: options.confirmAction,
    })
  }

  /**
   * 统一处理已安装插件的打开动作，确保所有入口共享同一套风险确认逻辑。
   */
  async function handleOpenPluginWrapper(plugin: PluginMarketUiPlugin): Promise<void> {
    await handleOpenPlugin(plugin, {
      notifyError: options.notifyError,
      confirmOpenPluginRisk: options.confirmOpenPluginRisk,
    })
  }

  /**
   * 卸载插件时串联确认、宿主删除和列表刷新，避免多个入口重复维护状态细节。
   */
  async function handleUninstallWrapper(plugin: PluginMarketUiPlugin): Promise<void> {
    await handleUninstall(plugin, {
      marketBusyPluginName,
      installedBusyPluginName,
      installedBusyAction,
      notifyError: options.notifyError,
      notifySuccess: options.notifySuccess,
      confirmAction: options.confirmAction,
      closePlugin: options.closePlugin,
      reloadMarket: options.reloadMarket,
    })
  }

  /**
   * 停止运行中的插件并刷新运行状态，供列表卡片和详情页共享同一忙碌态。
   */
  async function handleStopPluginWrapper(plugin: PluginMarketUiPlugin): Promise<void> {
    await handleStopPlugin(plugin, {
      marketBusyPluginName,
      installedBusyPluginName,
      installedBusyAction,
      notifyError: options.notifyError,
      notifySuccess: options.notifySuccess,
      reloadMarket: options.reloadMarket,
    })
  }

  /**
   * 打开插件安装目录，并把宿主能力缺失等错误统一转换为页面提示。
   */
  async function handleOpenFolderWrapper(plugin: PluginMarketUiPlugin): Promise<void> {
    await handleOpenFolder(plugin, {
      notifyError: options.notifyError,
    })
  }

  return {
    marketBusyPluginName,
    marketBusyAction,
    installedBusyPluginName,
    installedBusyAction,
    selectedPluginBusyAction,
    canInstallFromMarket,
    canUpgrade,
    handleOpenPlugin: handleOpenPluginWrapper,
    handleInstall: handleInstallWrapper,
    handleInstallLatest: handleInstallLatestWrapper,
    handleUpgrade: handleUpgradeWrapper,
    handleUninstall: handleUninstallWrapper,
    handleStopPlugin: handleStopPluginWrapper,
    handleOpenFolder: handleOpenFolderWrapper,
  }
}
