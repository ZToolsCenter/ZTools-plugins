'use strict'

const path = require('node:path')
const { opaqueId } = require('../core/safety.cjs')
const { SCAN_DEADLINE_CODE, createDeadline } = require('../core/deadline.cjs')
const { readBoundedFile } = require('../core/bounded-file.cjs')
const { copyPrefix, copyString } = require('../core/text.cjs')

const MAX_PLATFORM_APPS = 5_000
const MAX_SCAN_ENTRIES = 20_000
const MAX_SCAN_DEADLINE_MS = 15_000
const MAX_DESKTOP_FIELDS = 128
const MAX_DESKTOP_VALUE_LENGTH = 4_096
const FLATPAK_ID_PATTERN = /^(?:[A-Za-z_][A-Za-z0-9_]*\.){2,}[A-Za-z_][A-Za-z0-9_]*$/
const FLATPAK_ARCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/
const FLATPAK_BRANCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

function parseDesktop(text) {
  const result = Object.create(null)
  let active = false
  let fields = 0
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) { active = line === '[Desktop Entry]'; continue }
    if (!active || !line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    const key = line.slice(0, index)
    if (index > 0 && key.length <= 128 && fields < MAX_DESKTOP_FIELDS) {
      result[copyString(key)] = copyString(line.slice(index + 1, index + 1 + MAX_DESKTOP_VALUE_LENGTH).replace(/\\n/g, '\n'))
      fields += 1
    }
  }
  return result
}

function commandToken(exec) {
  if (typeof exec !== 'string' || exec.length > MAX_DESKTOP_VALUE_LENGTH) return null
  const value = exec.trim().replace(/%[fFuUdDnNickvm]/g, '').trim()
  if (!value) return null
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1)
    return end > 1 && end <= 1_025 ? copyString(value.slice(1, end)) : null
  }
  const token = value.split(/\s+/)[0]
  return token.length <= 1_024 ? copyString(token) : null
}

function cleanMetadataText(value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? copyPrefix(text, maxLength) : null
}

function isValidFlatpakId(value) {
  return typeof value === 'string' && value.length <= 255 && FLATPAK_ID_PATTERN.test(value)
}

function isValidFlatpakTarget(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value) || value.startsWith('-')) return false
  if (isValidFlatpakId(value)) return true
  const parts = value.split('/')
  return parts.length === 4
    && parts[0] === 'app'
    && isValidFlatpakId(parts[1])
    && FLATPAK_ARCH_PATTERN.test(parts[2])
    && FLATPAK_BRANCH_PATTERN.test(parts[3])
    && !parts[2].includes('..')
    && !parts[3].includes('..')
}

async function scanApps(ctx) {
  const roots = [
    { directory: path.join(ctx.home, '.local', 'share', 'applications'), scope: 'user' },
    { directory: path.join(ctx.home, '.local', 'share', 'flatpak', 'exports', 'share', 'applications'), scope: 'user' },
    { directory: '/usr/share/applications', scope: 'system' },
    { directory: '/var/lib/flatpak/exports/share/applications', scope: 'system' },
  ]
  const apps = []
  const warnings = []
  const maxApps = Number.isInteger(ctx.maxApps) ? Math.max(1, Math.min(MAX_PLATFORM_APPS, ctx.maxApps)) : MAX_PLATFORM_APPS
  const maxEntries = Number.isInteger(ctx.maxEntries) ? Math.max(1, Math.min(MAX_SCAN_ENTRIES, ctx.maxEntries)) : MAX_SCAN_ENTRIES
  const timeoutMs = Number.isInteger(ctx.scanDeadlineMs) ? Math.max(1, Math.min(MAX_SCAN_DEADLINE_MS, ctx.scanDeadlineMs)) : MAX_SCAN_DEADLINE_MS
  const deadline = createDeadline(timeoutMs, ctx.now)
  let scannedEntries = 0
  let flatpakManualWarning = false
  let invalidFlatpakWarning = false
  let reachedLimit = false
  let limitReason = ''
  let timedOut = false

  for (const root of roots) {
    if (timedOut) break
    let handle
    try { handle = await deadline.run(() => ctx.fs.opendir(root.directory)) } catch (error) {
      if (error && error.code === SCAN_DEADLINE_CODE) { timedOut = true; break }
      if (!error || error.code !== 'ENOENT') warnings.push(`无法读取应用入口目录：${path.basename(root.directory) || root.directory}`)
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
        if (!entry.isFile() || !entry.name.endsWith('.desktop')) continue
        if (apps.length >= maxApps) { reachedLimit = true; limitReason = `应用上限 ${maxApps}`; break }
        const desktopPath = path.join(root.directory, entry.name)
        let values
        try { values = parseDesktop(await deadline.run(() => readBoundedFile(desktopPath, ctx.fs, { encoding: 'utf8' }))) } catch (error) {
          if (error && error.code === SCAN_DEADLINE_CODE) throw error
          warnings.push(`无法读取应用入口：${entry.name}`)
          continue
        }
        const name = cleanMetadataText(values.Name, 240)
        if (!name || values.NoDisplay === 'true' || values.Hidden === 'true') continue
        const rawFlatpakTarget = values['X-Flatpak'] || null
        const flatpakTarget = isValidFlatpakTarget(rawFlatpakTarget) ? copyString(rawFlatpakTarget) : null
        const rawSnap = values['X-SnapInstanceName'] || null
        const snap = cleanMetadataText(rawSnap, 255)
        const executable = commandToken(values.Exec)
        const kind = rawFlatpakTarget ? 'flatpak' : rawSnap ? 'snap' : executable && executable.toLowerCase().endsWith('.appimage') ? 'appimage' : 'desktop'
        const key = flatpakTarget || snap || copyString(entry.name.slice(0, -8))
        const userOperable = false
        if (kind === 'flatpak') flatpakManualWarning = true
        if (kind === 'flatpak' && !flatpakTarget) invalidFlatpakWarning = true
        apps.push({
          id: opaqueId('app', `linux:${root.scope}:${desktopPath}`, ctx.secret), platform: 'linux', name,
          version: cleanMetadataText(values['X-AppImage-Version'], 120), publisher: null, appKey: key, desktopPath,
          executable: executable && path.isAbsolute(executable) ? executable : null,
          flatpakTarget,
          install: { kind, path: kind === 'appimage' ? executable : desktopPath, scope: root.scope },
          uninstall: { mode: 'manual', requiresElevation: root.scope !== 'user' || kind === 'snap', supported: userOperable },
          protected: false,
        })
      }
    } catch (error) {
      if (error && error.code === SCAN_DEADLINE_CODE) timedOut = true
      else warnings.push(`读取应用入口目录时中断：${path.basename(root.directory) || root.directory}`)
    } finally {
      if (typeof handle.close === 'function') {
        try { await handle.close() } catch {}
      }
    }
    if (reachedLimit || timedOut) break
  }
  if (flatpakManualWarning) warnings.push('Flatpak 标识来自可变的 desktop 元数据，系统管家仅展示入口，请使用 Flatpak 管理工具卸载。')
  if (invalidFlatpakWarning) warnings.push('检测到格式异常的 Flatpak ID/ref，相关入口已降级为手动处理。')
  if (reachedLimit) warnings.push(`应用枚举已达到${limitReason}`)
  if (timedOut) warnings.push(`应用扫描达到总时限 ${timeoutMs}ms，已返回部分结果。`)
  return { apps: apps.sort((a, b) => a.name.localeCompare(b.name)), warnings }
}

function safeSegment(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text && Buffer.byteLength(text, 'utf8') <= 255 && !/[\\/\u0000-\u001f\u007f]/.test(text) && text !== '.' && text !== '..' ? copyString(text) : null
}

async function inspectApp(app, ctx) {
  const candidates = []
  if (app.uninstall.mode === 'trash' && app.install.path) {
    candidates.push({ path: app.install.path, category: app.install.kind === 'appimage' ? 'application' : 'shortcut', confidence: 'exact', reason: '用户级应用入口', selectedByDefault: true, ownership: 'user', deletable: true })
  }
  const names = [...new Set([safeSegment(app.appKey), safeSegment(app.name)].filter(Boolean))]
  const roots = [
    ['config', path.join(ctx.home, '.config')], ['cache', path.join(ctx.home, '.cache')],
    ['support', path.join(ctx.home, '.local', 'share')], ['state', path.join(ctx.home, '.local', 'state')],
  ]
  for (const [category, root] of roots) {
    for (const name of names) {
      const candidatePath = path.join(root, name)
      try {
        await ctx.fs.lstat(candidatePath)
        const confidence = name === app.appKey ? 'exact' : 'strong'
        candidates.push({ path: candidatePath, category, confidence, reason: confidence === 'exact' ? `由 desktop/package 声明的标识关联：${name}` : `仅按显示名称推断：${name}，可能与同名应用共享`, selectedByDefault: false, ownership: 'user', deletable: true })
      } catch {}
    }
  }
  return candidates
}

module.exports = { MAX_DESKTOP_FIELDS, MAX_DESKTOP_VALUE_LENGTH, MAX_PLATFORM_APPS, MAX_SCAN_DEADLINE_MS, MAX_SCAN_ENTRIES, cleanMetadataText, commandToken, inspectApp, isValidFlatpakId, isValidFlatpakTarget, parseDesktop, scanApps }
