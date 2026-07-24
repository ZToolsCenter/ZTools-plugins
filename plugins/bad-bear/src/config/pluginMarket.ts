const DEFAULT_PLUGIN_MARKET_REMOTE_BASE_URL =
  'https://github.com/ZToolsCenter/ZTools-plugins/releases/latest/download'

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

export const PLUGIN_MARKET_REMOTE_BASE_URL = normalizeBaseUrl(
  DEFAULT_PLUGIN_MARKET_REMOTE_BASE_URL,
)

export function buildPluginMarketLatestUrl(
  baseUrl = PLUGIN_MARKET_REMOTE_BASE_URL,
): string {
  return `${normalizeBaseUrl(baseUrl)}/latest`
}

export function buildPluginMarketPluginsUrl(
  baseUrl = PLUGIN_MARKET_REMOTE_BASE_URL,
): string {
  return `${normalizeBaseUrl(baseUrl)}/plugins.json`
}

export function buildPluginMarketLayoutUrl(
  baseUrl = PLUGIN_MARKET_REMOTE_BASE_URL,
): string {
  return `${normalizeBaseUrl(baseUrl)}/layout.yaml`
}

export function buildPluginMarketCategoriesUrl(
  baseUrl = PLUGIN_MARKET_REMOTE_BASE_URL,
): string {
  return `${normalizeBaseUrl(baseUrl)}/categories.json`
}

export function getPluginMarketRemote(baseUrl = PLUGIN_MARKET_REMOTE_BASE_URL) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)

  return {
    baseUrl: normalizedBaseUrl,
    latest: buildPluginMarketLatestUrl(normalizedBaseUrl),
    plugins: buildPluginMarketPluginsUrl(normalizedBaseUrl),
    layout: buildPluginMarketLayoutUrl(normalizedBaseUrl),
    categories: buildPluginMarketCategoriesUrl(normalizedBaseUrl),
  }
}

export const PLUGIN_MARKET_REMOTE = getPluginMarketRemote()
