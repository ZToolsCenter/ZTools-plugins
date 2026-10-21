const { getAppIconDataUrl, getLetterSvgIcon } = require('../icon-helper.cjs');
'use strict'

const path = require('node:path')
const { opaqueId } = require('../core/safety.cjs')
const { SCAN_DEADLINE_CODE, createDeadline } = require('../core/deadline.cjs')
const { readBoundedFile } = require('../core/bounded-file.cjs')
const { copyPrefix, copyString } = require('../core/text.cjs')

const MAX_PLATFORM_APPS = 5_000
const MAX_SCAN_ENTRIES = 20_000
const MAX_SCAN_DEADLINE_MS = 15_000
const MAX_BUNDLE_ID_LENGTH = 255
const BUNDLE_ID_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/

function normalizeBundleId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_BUNDLE_ID_LENGTH) return null
  const bundleId = copyString(trimmed)
  const segments = bundleId.split('.')
  return segments.every((segment) => BUNDLE_ID_SEGMENT.test(segment)) ? bundleId : null
}

function normalizeResidualName(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || Buffer.byteLength(trimmed, 'utf8') > 255) return null
  const name = copyString(trimmed)
  return /[\\/\u0000-\u001f\u007f]/.test(name) ? null : name
}

function cleanMetadataText(value, fallback, maxLength = 240) {
  const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  const safeFallback = typeof fallback === 'string' ? fallback : ''
  return copyPrefix(text || safeFallback, maxLength)
}

async function readPlist(plistPath, execFile, warnings = null, timeoutMs = 4_000, fileSystem = null) {
  try {
    let source = plistPath
    let input
    if (fileSystem && typeof fileSystem.lstat === 'function') {
      input = await readBoundedFile(plistPath, fileSystem)
      source = '-'
    }
    const { stdout } = await execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', source], {
      encoding: 'utf8', timeout: Math.max(1, Math.min(4_000, timeoutMs)), maxBuffer: 1024 * 1024, input,
    })
    return JSON.parse(stdout)
  } catch {
    if (warnings) warnings.push(`无法读取应用元数据：${path.basename(path.dirname(path.dirname(plistPath)), '.app')}`)
    return {}
  }
}

async function scanApps(ctx) {
  const roots = [
    { directory: path.join(ctx.home, 'Applications'), scope: 'user', protected: false },
    { directory: '/Applications', scope: 'system', protected: false },
    { directory: '/System/Applications', scope: 'system', protected: true },
  ]
  const apps = []
  const warnings = []
  const maxApps = Number.isInteger(ctx.maxApps) ? Math.max(1, Math.min(MAX_PLATFORM_APPS, ctx.maxApps)) : MAX_PLATFORM_APPS
  const maxEntries = Number.isInteger(ctx.maxEntries) ? Math.max(1, Math.min(MAX_SCAN_ENTRIES, ctx.maxEntries)) : MAX_SCAN_ENTRIES
  const timeoutMs = Number.isInteger(ctx.scanDeadlineMs) ? Math.max(1, Math.min(MAX_SCAN_DEADLINE_MS, ctx.scanDeadlineMs)) : MAX_SCAN_DEADLINE_MS
  const deadline = createDeadline(timeoutMs, ctx.now)
  let scannedEntries = 0
  let reachedLimit = false
  let limitReason = ''
  let timedOut = false
  for (const root of roots) {
    let handle
    try { handle = await deadline.run(() => ctx.fs.opendir(root.directory)) } catch (error) {
      if (error && error.code === SCAN_DEADLINE_CODE) { timedOut = true; break }
      if (!error || error.code !== 'ENOENT') warnings.push(`无法读取应用目录：${path.basename(root.directory) || root.directory}`)
      continue
    }
    const iterator = typeof handle.read === 'function' ? null : handle[Symbol.asyncIterator]()
    try {
      while (true) {
        const next = await deadline.run(async () => {
          if (typeof handle.read === 'function') {
            const entry = await handle.read()
            return { value: entry, done: entry === null }
          }
          return iterator.next()
        })
        if (next.done) break
        const entry = next.value
        scannedEntries += 1
        if (scannedEntries > maxEntries) { reachedLimit = true; limitReason = `目录条目上限 ${maxEntries}`; break }
        if (!entry.isDirectory() || !entry.name.toLowerCase().endsWith('.app')) continue
        if (apps.length >= maxApps) { reachedLimit = true; limitReason = `应用上限 ${maxApps}`; break }
        const appPath = path.join(root.directory, entry.name)
        const plist = await deadline.run(() => readPlist(path.join(appPath, 'Contents', 'Info.plist'), ctx.execFile, warnings, deadline.remaining(), ctx.fs))
        const bundleId = normalizeBundleId(plist.CFBundleIdentifier)
        const name = cleanMetadataText(plist.CFBundleDisplayName || plist.CFBundleName, entry.name.slice(0, -4))
        const key = bundleId || appPath
        apps.push({
          id: opaqueId('app', `darwin:${root.scope}:${appPath}`, ctx.secret),
          platform: 'darwin',
        icon: getAppIconDataUrl(appPath) || getLetterSvgIcon(name), name, version: cleanMetadataText(plist.CFBundleShortVersionString || plist.CFBundleVersion, '', 120) || null,
          publisher: null, appKey: key, bundleId: bundleId || null,
          install: { kind: 'bundle', path: appPath, scope: root.scope },
          uninstall: {
            mode: root.scope === 'user' && !root.protected ? 'trash' : 'manual',
            requiresElevation: root.scope !== 'user', supported: root.scope === 'user' && !root.protected,
          },
          protected: root.protected,
        })
      }
    } catch (error) {
      if (error && error.code === SCAN_DEADLINE_CODE) timedOut = true
      else warnings.push(`读取应用目录时中断：${path.basename(root.directory) || root.directory}`)
    } finally {
      if (typeof handle.close === 'function') {
        try { await handle.close() } catch {}
      }
    }
    if (reachedLimit || timedOut) break
  }
  if (reachedLimit) warnings.push(`应用枚举已达到${limitReason}`)
  if (timedOut) warnings.push(`应用扫描达到总时限 ${timeoutMs}ms，已返回部分结果。`)
  return { apps: apps.sort((a, b) => a.name.localeCompare(b.name)), warnings }
}

function residualSpecs(app, home) {
  const library = path.join(home, 'Library')
  const specs = []
  const bundleId = normalizeBundleId(app.bundleId)
  const displayName = normalizeResidualName(app.name)
  const names = [
    ...(bundleId ? [[bundleId, 'exact']] : []),
    ...(displayName && displayName !== bundleId ? [[displayName, 'strong']] : []),
  ]
  for (const [name, confidence] of names) {
    specs.push(
      ['support', path.join(library, 'Application Support', name), confidence],
      ['cache', path.join(library, 'Caches', name), confidence],
      ['log', path.join(library, 'Logs', name), confidence],
      ['state', path.join(library, 'Saved Application State', `${name}.savedState`), confidence],
    )
  }
  if (bundleId) {
    specs.push(
      ['config', path.join(library, 'Preferences', `${bundleId}.plist`), 'exact'],
      ['state', path.join(library, 'Containers', bundleId), 'exact'],
    )
  }
  return specs
}

async function inspectApp(app, ctx) {
  const candidates = []
  const bundleId = normalizeBundleId(app.bundleId)
  if (app.install.scope === 'user' && !app.protected) {
    candidates.push({ path: app.install.path, category: 'application', confidence: 'exact', reason: '用户应用目录中的应用包', selectedByDefault: true, ownership: 'user', deletable: true })
  } else {
    candidates.push({ path: app.install.path, category: 'application', confidence: 'exact', reason: '系统级应用需手动卸载', selectedByDefault: false, ownership: 'system', deletable: false })
  }
  for (const [category, candidatePath, confidence] of residualSpecs(app, ctx.home)) {
    try {
      await ctx.fs.lstat(candidatePath)
      candidates.push({ path: candidatePath, category, confidence, reason: confidence === 'exact' ? `由应用声明的 Bundle ID ${bundleId} 关联` : `仅按显示名称 ${app.name} 推断，可能与同名应用共享`, selectedByDefault: false, ownership: 'user', deletable: true })
    } catch {}
  }
  return candidates
}

module.exports = { MAX_PLATFORM_APPS, MAX_SCAN_DEADLINE_MS, MAX_SCAN_ENTRIES, cleanMetadataText, inspectApp, normalizeBundleId, normalizeResidualName, readPlist, residualSpecs, scanApps }
