// 市场插件操作：安装、下载、升级

import type { ComputedRef, Ref } from 'vue'
import {
  deleteInstalledPlugin,
  installMarketPlugin,
  upsertMarketInstalledPluginHash,
} from '../../../../api/pluginMarket'
import type { PluginDetailState, MarketBusyAction, InstalledBusyAction } from '../shared'
import type {
  PluginDetailResponse,
  PluginMarketUiPlugin,
  ResolvedPluginDownloadTarget,
} from '../../../../types/pluginMarket'
import { getErrorMessage } from '../shared'
import {
  buildPluginInstallConfirmation,
  requirePluginInstallPayload,
  requirePluginInstallSuccessText,
  requirePluginUpgradeFailureText,
  requirePluginUpgradeSuccessText,
  resolvePluginTargetForAction,
} from './install-target'

/**
 * 在外部浏览器中打开插件下载 URL（当安装 API 不可用时的后备方案）
 */
export async function openPluginDownload(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    preferLatest?: boolean
    notifyError: (message: string) => void
    notifySuccess: (message: string) => void
  },
): Promise<void> {
  const installPayload = requirePluginInstallPayload(plugin, {
    ...params,
    canInstallFromMarket: true,
  })
  if (!installPayload?.downloadUrl) {
    params.notifyError('当前插件没有可下载的文件')
    return
  }

  if (typeof window.ztools?.shellOpenExternal !== 'function') {
    params.notifyError('当前宿主未暴露下载能力')
    return
  }

  window.ztools.shellOpenExternal(installPayload.downloadUrl)
  params.notifySuccess(`已开始下载 ${plugin.title}`)
}

/**
 * 处理从市场安装插件
 * 如果内部 API 不可用则回退到下载
 */
export async function handleInstall(
  plugin: PluginMarketUiPlugin,
  params: {
    canInstallFromMarket: boolean
    selectedPluginName: string | null
    pluginDetailState: PluginDetailState
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    marketBusyPluginName: Ref<string | null>
    marketBusyAction: Ref<MarketBusyAction>
    installedBusyPluginName: Ref<string | null>
    notifyError: (message: string) => void
    notifySuccess: (message: string) => void
    reloadMarket: () => Promise<void>
    openPluginByName: (name: string) => void
    preferLatest?: boolean
  },
): Promise<void> {
  // 如果无法从市场安装，使用外部下载
  if (!params.canInstallFromMarket) {
    await openPluginDownload(plugin, params)
    return
  }

  // 检查是否有其他操作正在进行
  if (params.marketBusyPluginName.value || params.installedBusyPluginName.value) {
    return
  }

  const installPayload = requirePluginInstallPayload(plugin, {
    ...params,
    canInstallFromMarket: params.canInstallFromMarket,
  })
  if (!installPayload) {
    return
  }

  params.marketBusyPluginName.value = plugin.name
  params.marketBusyAction.value = 'download'

  try {
    const result = await installMarketPlugin(installPayload)
    if (!result.success) {
      throw new Error(result.error || '安装失败')
    }

    const target = resolvePluginTargetForAction(plugin, params)
    upsertMarketInstalledPluginHash(plugin.name, target?.hash || installPayload.hash)

    params.notifySuccess(
      requirePluginInstallSuccessText(plugin, {
        ...params,
        preferLatest: params.preferLatest,
      }),
    )
    await params.reloadMarket()
    params.openPluginByName(plugin.name)
  } catch (error) {
    console.error('[PluginMarket] 安装失败:', error)
    params.notifyError(getErrorMessage(error, '安装失败'))
  } finally {
    params.marketBusyPluginName.value = null
    params.marketBusyAction.value = null
  }
}

/**
 * 处理插件安装（始终使用最新版本）
 */
export async function handleInstallLatest(
  plugin: PluginMarketUiPlugin,
  params: {
    canInstallFromMarket: boolean
    selectedPluginName: string | null
    pluginDetailState: PluginDetailState
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    marketBusyPluginName: Ref<string | null>
    marketBusyAction: Ref<MarketBusyAction>
    installedBusyPluginName: Ref<string | null>
    notifyError: (message: string) => void
    notifySuccess: (message: string) => void
    reloadMarket: () => Promise<void>
    openPluginByName: (name: string) => void
  },
): Promise<void> {
  await handleInstall(plugin, { ...params, preferLatest: true })
}

/**
 * 处理插件升级（带确认对话框）
 * 先删除旧版本，然后安装新版本
 */
export async function handleUpgrade(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: PluginDetailState
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    marketBusyPluginName: Ref<string | null>
    marketBusyAction: Ref<MarketBusyAction>
    installedBusyPluginName: Ref<string | null>
    installedBusyAction: Ref<InstalledBusyAction>
    notifyError: (message: string) => void
    notifySuccess: (message: string) => void
    reloadMarket: () => Promise<void>
    openPluginByName: (name: string) => void
    confirmAction: (options: {
      title?: string
      message: string
      type?: 'info' | 'warning' | 'danger'
      confirmText?: string
      cancelText?: string
    }) => Promise<boolean>
  },
): Promise<void> {
  if (params.marketBusyPluginName.value || params.installedBusyPluginName.value) {
    return
  }

  if (!plugin.path) {
    params.notifyError('找不到已安装插件路径，无法升级')
    return
  }

  const installPayload = requirePluginInstallPayload(plugin, {
    ...params,
    canInstallFromMarket: true,
  })
  if (!installPayload) {
    return
  }

  // 构建确认对话框
  const target = resolvePluginTargetForAction(plugin, params)
  const confirmation = buildPluginInstallConfirmation(plugin, target)
  if (confirmation) {
    const confirmed = await params.confirmAction({
      title: confirmation.title,
      message: confirmation.message,
      type: 'warning',
      confirmText: confirmation.confirmText,
      cancelText: '取消',
    })

    if (!confirmed) {
      return
    }
  }

  const isInstalledListUpgrade = plugin.hasUpdate && !!plugin.latestHash
  params.installedBusyPluginName.value = plugin.name
  params.installedBusyAction.value = 'upgrade'
  if (!isInstalledListUpgrade) {
    params.marketBusyPluginName.value = plugin.name
    params.marketBusyAction.value = 'upgrade'
  }

  try {
    // 先删除旧版本
    const deleteResult = await deleteInstalledPlugin(plugin.path)
    if (!deleteResult.success) {
      throw new Error(deleteResult.error || '删除旧版本失败')
    }

    // 再安装新版本
    const installResult = await installMarketPlugin(installPayload)
    if (!installResult.success) {
      throw new Error(installResult.error || '安装新版本失败')
    }

    upsertMarketInstalledPluginHash(plugin.name, target?.hash || installPayload.hash)

    params.notifySuccess(
      requirePluginUpgradeSuccessText(plugin, {
        ...params,
      }),
    )
    await params.reloadMarket()
    params.openPluginByName(plugin.name)
  } catch (error) {
    console.error('[PluginMarket] 升级失败:', error)
    params.notifyError(
      getErrorMessage(
        error,
        requirePluginUpgradeFailureText(plugin, {
          ...params,
        }),
      ),
    )
    await params.reloadMarket()
  } finally {
    params.installedBusyPluginName.value = null
    params.installedBusyAction.value = null
    params.marketBusyPluginName.value = null
    params.marketBusyAction.value = null
  }
}
