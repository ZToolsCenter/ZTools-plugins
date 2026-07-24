import type {
  PluginDetailResponse,
  PluginDetailVersion,
  PluginMarketPlugin,
  PluginMarketUiPlugin,
  PluginReleaseSource,
  ResolvedPluginDownloadTarget,
} from '../../../types/pluginMarket'
import { resolvePluginInstallPayload } from '../../../api/pluginMarket'

export function mergePluginDetailIntoPlugin(
  plugin: PluginMarketUiPlugin,
  detail: PluginDetailResponse | null,
  resolvedDownloadTarget?: ResolvedPluginDownloadTarget | null,
): PluginMarketUiPlugin {
  if (!detail && !resolvedDownloadTarget) {
    return plugin
  }

  const latestBuild = detail?.versions?.[0] || null
  const resolvedBuild = resolvedDownloadTarget?.build || latestBuild
  const resolvedVersion = resolvedDownloadTarget?.version || detail?.version || plugin.version

  return {
    ...plugin,
    title: detail?.title ?? plugin.title,
    description: detail?.description ?? plugin.description,
    author: detail?.author ?? plugin.author,
    logo: detail?.logo ?? plugin.logo,
    features: detail?.features ?? plugin.features,
    main: detail?.main ?? plugin.main,
    preload: detail?.preload ?? plugin.preload,
    version: resolvedVersion,
    downloadUrl: resolvedDownloadTarget?.downloadUrl || plugin.downloadUrl,
    size: resolvedBuild?.fileSize ?? plugin.size ?? latestBuild?.fileSize,
    totalDownloads: detail?.totalDownloads ?? plugin.totalDownloads,
    avgRating: detail?.avgRating ?? plugin.avgRating,
    ratingCount: detail?.ratingCount ?? plugin.ratingCount,
  }
}

export interface PluginSourceReference {
  kind: 'provider-sync' | 'user-upload' | 'unknown'
  providerName?: string | null
}

export function parsePluginSourceReference(
  source: PluginReleaseSource | undefined,
): PluginSourceReference | null {
  if (!source) {
    return null
  }

  if (typeof source === 'string') {
    const normalized = source.trim().toLowerCase()
    if (!normalized) {
      return null
    }
    if (normalized.includes('provider')) {
      return { kind: 'provider-sync' }
    }
    if (normalized.includes('upload') || normalized.includes('manual') || normalized.includes('user')) {
      return { kind: 'user-upload' }
    }
    return { kind: 'unknown' }
  }

  const provider = source.provider
  const providerName =
    provider &&
    typeof provider === 'object' &&
    !Array.isArray(provider) &&
    typeof (provider as Record<string, unknown>).name === 'string'
      ? ((provider as Record<string, unknown>).name as string).trim()
      : null
  const typeCandidate =
    typeof source.type === 'string'
      ? source.type
      : typeof source.kind === 'string'
        ? source.kind
        : typeof source.sourceType === 'string'
          ? source.sourceType
          : ''
  const normalizedType = typeCandidate.trim().toLowerCase()

  if (normalizedType === 'local') {
    return { kind: 'user-upload' }
  }
  if (providerName || normalizedType.includes('provider')) {
    return { kind: 'provider-sync', providerName }
  }
  if (
    normalizedType.includes('upload') ||
    normalizedType.includes('manual') ||
    normalizedType.includes('user')
  ) {
    return { kind: 'user-upload' }
  }

  return { kind: 'unknown' }
}

export function mapPluginSourceLabel(reference: PluginSourceReference | null): string {
  if (!reference) {
    return ''
  }

  if (reference.kind === 'provider-sync') {
    return reference.providerName || ''
  }

  if (reference.kind === 'user-upload') {
    return '用户上传'
  }

  return '未知来源'
}

export function buildCurrentPluginDownloadTarget(
  plugin: PluginMarketUiPlugin | null,
  detail: PluginDetailResponse | null,
  selectedBuild?: PluginDetailVersion | null,
): ResolvedPluginDownloadTarget | null {
  if (!plugin) {
    return null
  }

  if (selectedBuild) {
    const payload = resolvePluginInstallPayload(plugin.marketPlugin || plugin, {
      version: selectedBuild.version,
      hash: selectedBuild.hash,
    })

    return {
      version: selectedBuild.version,
      hash: selectedBuild.hash,
      downloadMode: 'hash',
      downloadUrl: payload.downloadUrl || '',
      build: selectedBuild,
      plugin: payload,
    }
  }

  const marketPlugin = plugin.marketPlugin || plugin
  const latestBuild = detail?.versions?.[0] || null
  const payload = latestBuild
    ? resolvePluginInstallPayload(marketPlugin, {
        version: latestBuild.version,
        hash: latestBuild.hash,
      })
    : resolvePluginInstallPayload(marketPlugin)

  return {
    version: latestBuild?.version || payload.version,
    hash: latestBuild?.hash || null,
    downloadMode: latestBuild ? 'hash' : 'latest',
    downloadUrl: payload.downloadUrl || '',
    build: latestBuild,
    plugin: payload,
  }
}
