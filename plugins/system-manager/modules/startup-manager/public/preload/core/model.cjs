'use strict'

const crypto = require('node:crypto')
const path = require('node:path')

const HOME_PATTERNS = [
  /\/(?:Users|home)\/[^/\s]+/gi,
  /[A-Z]:\\Users\\[^\\\s]+/gi,
]

function copyString(value) {
  return Buffer.from(String(value), 'utf8').toString('utf8')
}

function copyPrefix(value, max) {
  const limit = Number.isSafeInteger(max) && max >= 0 ? max : 0
  return copyString(String(value).slice(0, limit))
}

function identityKey(value) {
  return `startup_${crypto.createHash('sha256').update(String(value ?? '')).digest('hex')}`
}

function cleanText(value, max = 320) {
  if (value == null) return null
  const text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return text ? copyPrefix(text, max) : null
}

function redact(value, home) {
  let text = cleanText(value, 500)
  if (!text) return null
  if (home && text.includes(home)) text = text.split(home).join('~')
  for (const pattern of HOME_PATTERNS) text = text.replace(pattern, '~')
  return text
}

function impactFor(kind, metadata = {}) {
  if (kind === 'service' || kind === 'launch-daemon') {
    return { level: 'high', basis: 'heuristic', reasons: ['系统级常驻后台组件'] }
  }
  if (kind === 'systemd-unit' && metadata.serviceType !== 'oneshot') {
    return { level: 'high', basis: 'heuristic', reasons: ['登录后常驻的用户服务'] }
  }
  if (kind === 'scheduled-task' || kind === 'launch-agent') {
    return { level: 'medium', basis: 'heuristic', reasons: ['按登录或计划触发后台任务'] }
  }
  if (kind === 'login-item' || kind === 'run-key' || kind === 'startup-folder' || kind === 'desktop-autostart') {
    return { level: 'low', basis: 'heuristic', reasons: ['用户登录时启动的应用或一次性任务'] }
  }
  return { level: 'unknown', basis: 'heuristic', reasons: ['缺少可靠的运行特征'] }
}

function createItem(input, home) {
  const action = input.action || { canToggle: false, requiresElevation: input.scope === 'system', reason: '当前来源仅支持查看' }
  return {
    key: identityKey(input.key),
    name: cleanText(input.name, 160) || '未命名项目',
    scope: input.scope === 'user' ? 'user' : 'system',
    kind: input.kind,
    source: {
      label: cleanText(input.source && input.source.label, 100) || '未知来源',
      location: redact(input.source && input.source.location, home),
    },
    trigger: cleanText(input.trigger, 120) || '未知',
    commandSummary: redact(input.commandSummary, home),
    enabled: typeof input.enabled === 'boolean' ? input.enabled : null,
    running: typeof input.running === 'boolean' ? input.running : null,
    status: cleanText(input.status, 80) || 'unknown',
    impact: input.impact || impactFor(input.kind, input.metadata),
    action: {
      canToggle: Boolean(action.canToggle),
      requiresElevation: Boolean(action.requiresElevation),
      reason: cleanText(action.reason, 200),
    },
    icon: typeof input.icon === 'string' ? input.icon : null,
    metadata: sanitizeMetadata(input.metadata || {}),
    internal: input.internal || {},
  }
}

function publicItem(item, id) {
  const { key, internal, metadata, ...safe } = item
  return { id, icon: item.icon || null, ...safe, metadata: sanitizeMetadata(metadata) }
}

function sanitizeMetadata(metadata) {
  const allowed = ['description', 'publisher', 'serviceType', 'startType']
  return Object.fromEntries(allowed.filter((key) => metadata[key] != null).map((key) => [key, cleanText(metadata[key], 200)]))
}

function safeBaseName(value) {
  return cleanText(path.basename(String(value || '')), 160)
}

module.exports = { cleanText, copyPrefix, copyString, createItem, identityKey, impactFor, publicItem, redact, safeBaseName }
