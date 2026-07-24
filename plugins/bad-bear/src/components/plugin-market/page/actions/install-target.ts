// 安装目标解析和确认辅助函数

import type { ComputedRef } from 'vue'
import { resolvePluginInstallPayload } from '../../../../api/pluginMarket'
import type {
  PluginDetailResponse,
  PluginDetailVersion,
  PluginMarketPlugin,
  PluginMarketUiPlugin,
  ResolvedPluginDownloadTarget,
} from '../../../../types/pluginMarket'
import { compareVersions } from '../../utils'

type LatestHashTarget = {
  version: string
  payloadVersion: string | null
  hash: string
  build: PluginDetailVersion | null
}

/**
 * 在详情版本列表中匹配服务端返回的 latestHash，命中时补齐版本号与构建信息。
 */
function resolveLatestHashTarget(
  plugin: PluginMarketUiPlugin,
  detail?: PluginDetailResponse | null,
): LatestHashTarget | null {
  if (!plugin.latestHash) {
    return null
  }

  const matchedBuild = detail?.versions?.find((version) => version.hash === plugin.latestHash) || null
  if (matchedBuild) {
    return {
      version: matchedBuild.version,
      payloadVersion: matchedBuild.version,
      hash: plugin.latestHash,
      build: matchedBuild,
    }
  }

  return {
    version: '最新版本',
    payloadVersion: null,
    hash: plugin.latestHash,
    build: null,
  }
}

/**
 * 构建插件的最新下载目标，已安装更新优先使用 check-updates 返回的 latestHash。
 */
export function buildLatestPluginDownloadTarget(
  plugin: PluginMarketUiPlugin,
  detail?: PluginDetailResponse | null,
): ResolvedPluginDownloadTarget {
  const latestHashTarget = resolveLatestHashTarget(plugin, detail)
  if (latestHashTarget) {
    const payload = resolvePluginInstallPayload(plugin.marketPlugin || plugin, {
      version: latestHashTarget.payloadVersion,
      hash: latestHashTarget.hash,
    })

    return {
      version: latestHashTarget.version,
      hash: latestHashTarget.hash,
      downloadMode: 'hash',
      downloadUrl: payload.downloadUrl || '',
      build: latestHashTarget.build,
      plugin: payload,
    }
  }

  const latestBuild = detail?.versions?.[0] || null
  const fallbackHash = latestBuild?.hash || plugin.hash || null
  const payload = latestBuild
    ? resolvePluginInstallPayload(plugin.marketPlugin || plugin, {
        version: latestBuild.version,
        hash: latestBuild.hash,
      })
    : resolvePluginInstallPayload(plugin.marketPlugin || plugin, {
        hash: fallbackHash,
      })

  return {
    version: latestBuild?.version || payload.version,
    hash: fallbackHash,
    downloadMode: fallbackHash ? 'hash' : 'latest',
    downloadUrl: payload.downloadUrl || '',
    build: latestBuild,
    plugin: payload,
  }
}

/**
 * 解析插件操作的下载目标。
 * 已安装插件存在 latestHash 时优先使用服务端更新结果；详情页手动选择的历史版本仍按选择安装。
 */
export function resolvePluginTargetForAction(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null; selectedHash?: string | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    preferLatest?: boolean
  },
): ResolvedPluginDownloadTarget | null {
  const isSelectedDetailPlugin = plugin.name === params.selectedPluginName
  const hasSelectedDetailBuild = isSelectedDetailPlugin && !!params.pluginDetailState.selectedHash
  if (!params.preferLatest && hasSelectedDetailBuild) {
    return params.currentPluginDownloadTarget.value
  }

  const detail = isSelectedDetailPlugin ? params.pluginDetailState.detail : null
  if (plugin.latestHash) {
    return buildLatestPluginDownloadTarget(plugin, detail)
  }

  if (!params.preferLatest && isSelectedDetailPlugin && params.pluginDetailState.detail) {
    return params.currentPluginDownloadTarget.value
  }

  return buildLatestPluginDownloadTarget(plugin, detail)
}

/**
 * 判断已安装插件是否存在服务端确认的可更新构建。
 */
export function canUpgrade(plugin: PluginMarketUiPlugin): boolean {
  return !!plugin.installed && !!plugin.latestHash
}

/**
 * 构建升级/降级/重装场景的安装确认对话框内容
 */
export function buildPluginInstallConfirmation(
  plugin: PluginMarketUiPlugin,
  target: ResolvedPluginDownloadTarget | null,
): {
  title: string
  message: string
  confirmText: string
} | null {
  if (!target || !plugin.installed || !plugin.localVersion) {
    return null
  }

  const comparison = target.hash === plugin.latestHash
    ? -1
    : compareVersions(plugin.localVersion, target.version)
  const actionLabel = comparison < 0 ? '升级' : comparison > 0 ? '降级' : '重装'
  const title = comparison < 0 ? '确认升级' : comparison > 0 ? '确认降级' : '确认重装'
  const targetLabel = target.version || '最新版本'
  const message = `确定将 ${plugin.title} 从 ${plugin.localVersion || '未知版本'}${actionLabel}到 ${targetLabel}吗？安装过程会先删除旧插件，若新版本安装失败，你将暂时失去该插件。`

  return {
    title,
    message,
    confirmText: actionLabel,
  }
}

/**
 * 获取插件操作的有效安装载荷；详情页历史版本必须命中构建，服务端确认的 latestHash 更新允许按 hash 安装。
 */
export function requirePluginInstallPayload(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    canInstallFromMarket: boolean
    preferLatest?: boolean
    notifyError: (message: string) => void
  },
): PluginMarketPlugin | null {
  const target = resolvePluginTargetForAction(plugin, params)
  const isSelectedDetailPlugin =
    plugin.name === params.selectedPluginName && !!params.pluginDetailState.detail

  if (!target) {
    params.notifyError('当前插件没有可安装的版本或构建')
    return null
  }

  if (params.canInstallFromMarket) {
    const isServerConfirmedUpdate = !!plugin.latestHash && target.hash === plugin.latestHash
    if (isSelectedDetailPlugin && !params.preferLatest && !target.build && !isServerConfirmedUpdate) {
      params.notifyError('当前插件没有可安装的版本或构建')
      return null
    }
  } else if (!target.downloadUrl) {
    params.notifyError('当前插件没有可下载的文件')
    return null
  }

  return target.plugin
}

/**
 * 获取安装目标版本的可读摘要
 */
export function requirePluginInstallTargetSummary(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    preferLatest?: boolean
  },
): string {
  const target = resolvePluginTargetForAction(plugin, params)
  if (!target) {
    return plugin.version || '最新版本'
  }

  if (!target.build) {
    return target.version || '最新版本'
  }

  return target.version || '最新版本'
}

/**
 * 获取插件安装成功后的消息文本
 */
export function requirePluginInstallSuccessText(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
    preferLatest?: boolean
  },
): string {
  const targetLabel = requirePluginInstallTargetSummary(plugin, params)
  return `已安装 ${plugin.title} ${targetLabel}`
}

/**
 * 获取插件升级/降级/重装成功后的消息文本，latestHash 更新固定按服务端确认的升级处理。
 */
export function requirePluginUpgradeSuccessText(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
  },
): string {
  const target = resolvePluginTargetForAction(plugin, params)
  if (!target || !plugin.localVersion) {
    return `已安装 ${plugin.title}`
  }

  const comparison = target.hash === plugin.latestHash
    ? -1
    : compareVersions(plugin.localVersion, target.version)
  if (comparison < 0) {
    return target.version === '最新版本'
      ? `已升级 ${plugin.title} 到最新版本`
      : `已升级 ${plugin.title} 到 ${target.version}`
  }

  if (comparison > 0) {
    return `已安装 ${plugin.title} ${target.version}`
  }

  return `已重装 ${plugin.title} ${target.version}`
}

/**
 * 获取插件升级操作的失败消息文本，latestHash 更新失败保持升级语义而不受版本号影响。
 */
export function requirePluginUpgradeFailureText(
  plugin: PluginMarketUiPlugin,
  params: {
    selectedPluginName: string | null
    pluginDetailState: { detail: PluginDetailResponse | null }
    currentPluginDownloadTarget: ComputedRef<ResolvedPluginDownloadTarget | null>
  },
): string {
  const target = resolvePluginTargetForAction(plugin, params)
  if (!target || !plugin.localVersion) {
    return '升级失败'
  }

  const comparison = target.hash === plugin.latestHash
    ? -1
    : compareVersions(plugin.localVersion, target.version)
  if (comparison < 0) {
    return '升级失败'
  }

  if (comparison > 0) {
    return '安装失败'
  }

  return '重装失败'
}
