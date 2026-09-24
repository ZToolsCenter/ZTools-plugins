'use strict'

const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')

const FEATURE_ROUTES = Object.freeze(Object.assign(Object.create(null), {
  'system-diagnostic-report': 'modules/system-diagnostic-report/index.html',
  'application-uninstaller': 'modules/application-uninstaller/index.html',
  'startup-manager': 'modules/startup-manager/index.html',
  'system-cleaner': 'modules/system-cleaner/index.html',
  'lan-device-discovery': 'modules/lan-device-discovery/index.html',
}))

const RAW_DOT_SEGMENT = /(?:^|\/)(?:(?:\.|%2e){1,2})(?:\/|$)/i
const RAW_ENCODED_SEPARATOR = /%(?:00|2f|5c)/i

function platformPath(platform) { return platform === 'win32' ? path.win32 : path }
function pathKey(value, platform) { return platform === 'win32' ? value.toLowerCase() : value }
function fileHref(value, platform) { return pathToFileURL(value, { windows: platform === 'win32' }).href }

function isCanonicalRawHref(rawHref, canonicalHref, hash, platform) {
  const expected = `${canonicalHref}${hash}`
  if (rawHref === expected) return true
  // URL schemes are case-insensitive. Keep that single compatibility allowance on
  // Windows, while requiring every slash, escape, host, path and fragment byte to
  // already use the representation emitted by pathToFileURL.
  return platform === 'win32' && rawHref.replace(/^file:/i, 'file:') === expected
}

function trustedPages(suiteRoot, platform = process.platform) {
  const pathApi = platformPath(platform)
  const root = pathApi.resolve(suiteRoot)
  const dashboardPath = pathApi.join(root, 'index.html')
  const pages = new Map([[pathKey(dashboardPath, platform), Object.freeze({ kind: 'dashboard', featureCode: null, hashes: Object.freeze(['', '#modules']), filePath: dashboardPath, href: fileHref(dashboardPath, platform) })]])
  for (const [featureCode, route] of Object.entries(FEATURE_ROUTES)) {
    const hashes = featureCode === 'system-cleaner'
      ? Object.freeze(['', '#main'])
      : featureCode === 'system-diagnostic-report'
        ? Object.freeze(['', '#report-content'])
        : Object.freeze([''])
    const filePath = pathApi.join(root, ...route.split('/'))
    pages.set(pathKey(filePath, platform), Object.freeze({ kind: 'module', featureCode, hashes, filePath, href: fileHref(filePath, platform) }))
  }
  return pages
}

function resolveSuitePage(currentHref, suiteRoot, platform = process.platform) {
  if (typeof currentHref !== 'string' || typeof suiteRoot !== 'string') return null
  if (/^file:\/\/localhost\//i.test(currentHref)) return null
  if (RAW_DOT_SEGMENT.test(currentHref) || RAW_ENCODED_SEPARATOR.test(currentHref) || currentHref.includes('\\')) return null
  try {
    const current = new URL(currentHref)
    if (current.protocol !== 'file:' || current.host !== '' || current.search) return null
    const pathApi = platformPath(platform)
    const currentPath = pathApi.resolve(fileURLToPath(current, { windows: platform === 'win32' }))
    const canonicalHref = fileHref(currentPath, platform)
    const page = trustedPages(suiteRoot, platform).get(pathKey(currentPath, platform))
    if (!page || !page.hashes.includes(current.hash) || !isCanonicalRawHref(currentHref, canonicalHref, current.hash, platform)) return null
    return Object.freeze({
      kind: page.kind,
      featureCode: page.featureCode,
      filePath: page.filePath,
      href: page.href,
    })
  } catch {
    return null
  }
}

function targetForFeature(featureCode, suiteRoot, platform = process.platform) {
  if (typeof featureCode !== 'string' || !Object.prototype.hasOwnProperty.call(FEATURE_ROUTES, featureCode)) return null
  const route = FEATURE_ROUTES[featureCode]
  const pathApi = platformPath(platform)
  return fileHref(pathApi.join(pathApi.resolve(suiteRoot), ...route.split('/')), platform)
}

function createSuiteRouter(hostWindow, suiteRoot, currentPage = null, platform = process.platform) {
  const page = currentPage || resolveSuitePage(hostWindow?.location?.href, suiteRoot, platform)
  if (!page) return null

  function openFeature(featureCode) {
    const target = targetForFeature(featureCode, suiteRoot, platform)
    if (!target) return false
    if (target !== page.href) {
      if (typeof hostWindow.location.assign === 'function') hostWindow.location.assign(target)
      else hostWindow.location.href = target
    }
    return true
  }

  return Object.freeze({ openFeature })
}

function installSuiteRouter(hostWindow, suiteRoot, platform = process.platform) {
  const page = resolveSuitePage(hostWindow?.location?.href, suiteRoot, platform)
  if (!page) return null
  const router = createSuiteRouter(hostWindow, suiteRoot, page, platform)
  hostWindow.systemManagerSuite = router
  const api = hostWindow.ztools
  if (api && typeof api.onPluginEnter === 'function') {
    api.onPluginEnter((launchParam) => {
      const code = launchParam && typeof launchParam === 'object' ? launchParam.code : null
      router.openFeature(code)
    })
  }
  return Object.freeze({ page, router })
}

module.exports = Object.freeze({
  FEATURE_ROUTES,
  createSuiteRouter,
  installSuiteRouter,
  resolveSuitePage,
  targetForFeature,
})
