/**
 * Resolve logical task output coords to absolute paths under downloads/pdf-*.
 * Renderer should pass { feature, taskId, filename } — not hand-built paths.
 */
const path = require('node:path')
const { assertSafeOutputPath } = require('../path-guard')

function sanitizeSegment(name, fallback) {
  const base = String(name || fallback || 'file')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  return base || fallback || 'file'
}

/**
 * @param {string} downloadsRoot
 * @param {{ feature: string, taskId: string, filename?: string }} coords
 * @returns {{ dir: string, filePath?: string }}
 */
function resolveTaskCoords(downloadsRoot, coords) {
  if (!coords || typeof coords !== 'object') {
    throw new Error('任务路径参数无效')
  }
  const feature = sanitizeSegment(coords.feature, 'out').replace(/[^a-zA-Z0-9_-]/g, '') || 'out'
  const taskId = sanitizeSegment(coords.taskId, 'task')
  const dir = path.join(downloadsRoot, 'pdf-' + feature, taskId)
  // Ensure dir is under downloads/pdf-*
  assertSafeOutputPath(dir, downloadsRoot, '任务目录')
  if (coords.filename == null || coords.filename === '') {
    return { dir }
  }
  const rawName = String(coords.filename)
  // Reject any path separators or parent refs — filename must be a bare name
  if (/[/\\]/.test(rawName) || rawName.includes('..')) {
    throw new Error('文件名无效')
  }
  const filename = path.basename(rawName)
  if (!filename || filename === '.' || filename === '..') {
    throw new Error('文件名无效')
  }
  const filePath = path.join(dir, filename)
  assertSafeOutputPath(filePath, downloadsRoot, '任务文件')
  return { dir, filePath }
}

module.exports = {
  sanitizeSegment,
  resolveTaskCoords,
}
