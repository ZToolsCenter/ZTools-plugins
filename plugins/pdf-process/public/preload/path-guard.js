/**
 * Path allowlist helpers for preload services.
 * Outputs must stay under downloads/pdf-*; inputs must be real existing files.
 */
const path = require('node:path')
const fs = require('node:fs')

function normalizePath(p) {
  const resolved = path.resolve(String(p))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** True if child is the same as parent or a path inside parent. */
function isPathInside(parent, child) {
  if (parent == null || child == null) return false
  const rel = path.relative(normalizePath(parent), normalizePath(child))
  if (!rel) return true
  if (rel.startsWith('..')) return false
  // path.isAbsolute(rel) is true on Windows when roots differ (e.g. C: vs D:)
  if (path.isAbsolute(rel)) return false
  return true
}

function rejectNullByte(filePath, label) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error(label + '无效')
  }
  if (filePath.includes('\0')) {
    throw new Error(label + '无效')
  }
}

/**
 * Outputs (write/delete/mkdir) must live under `${downloadsRoot}/pdf-*`.
 * @returns {string} resolved absolute path
 */
function assertSafeOutputPath(filePath, downloadsRoot, label) {
  const tag = label || '输出路径'
  rejectNullByte(filePath, tag)
  if (typeof downloadsRoot !== 'string' || !downloadsRoot.trim()) {
    throw new Error('下载目录不可用')
  }
  const resolved = path.resolve(filePath)
  const root = path.resolve(downloadsRoot)
  if (!isPathInside(root, resolved)) {
    throw new Error(tag + '必须位于下载目录内')
  }
  const rel = path.relative(root, resolved)
  const firstSeg = rel.split(/[/\\]/).filter(Boolean)[0] || ''
  if (!/^pdf-/i.test(firstSeg)) {
    throw new Error(tag + '必须位于 pdf-* 任务目录内')
  }
  return resolved
}

/**
 * User-selected inputs may live anywhere on disk, but must be a real file path.
 * @returns {string} resolved absolute path
 */
function assertSafeInputFile(filePath, fsImpl) {
  const io = fsImpl || fs
  rejectNullByte(filePath, '输入路径')
  const resolved = path.resolve(filePath)
  let st
  try {
    st = io.statSync(resolved)
  } catch {
    throw new Error('输入文件不存在')
  }
  if (!st.isFile()) {
    throw new Error('输入路径不是文件')
  }
  return resolved
}

/** Log-safe path label (basename only). */
function safePathLabel(filePath) {
  try {
    if (filePath == null) return ''
    return path.basename(String(filePath))
  } catch {
    return '[path]'
  }
}

/**
 * Only https: URLs are allowed for shell.openExternal / recommend links.
 * @returns {string} normalized href
 */
function assertSafeExternalUrl(url) {
  if (typeof url !== 'string' || !url.trim()) {
    throw new Error('链接无效')
  }
  let parsed
  try {
    parsed = new URL(url.trim())
  } catch {
    throw new Error('链接无效')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('仅允许 https 链接')
  }
  return parsed.toString()
}

function isSafeExternalUrl(url) {
  try {
    assertSafeExternalUrl(url)
    return true
  } catch {
    return false
  }
}

module.exports = {
  isPathInside,
  assertSafeOutputPath,
  assertSafeInputFile,
  safePathLabel,
  assertSafeExternalUrl,
  isSafeExternalUrl,
}
