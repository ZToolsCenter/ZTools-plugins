'use strict'

const TOOL_NAMES = Object.freeze([
  'get_capabilities',
  'collect_diagnostic_report',
  'render_diagnostic_report',
  'export_diagnostic_report',
  'scan_applications',
  'list_applications',
  'inspect_application',
  'prepare_application_removal',
  'execute_application_removal',
  'scan_startup_items',
  'list_startup_items',
  'prepare_startup_change',
  'set_startup_item_enabled',
  'undo_startup_change',
  'scan_system_junk',
  'list_system_junk',
  'prepare_system_cleanup',
  'clean_system_junk',
  'list_network_interfaces',
  'prepare_lan_scan',
  'scan_lan_devices',
  'get_operation_result',
])

const SAFE_CODES = new Set([
  'ACTION_EXPIRED',
  'ACTION_NOT_FOUND',
  'AUTHORIZATION_REQUIRED',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_ARGUMENT',
  'INVALID_INTERFACE',
  'ITEM_CHANGED',
  'ITEM_NOT_FOUND',
  'NOT_FOUND',
  'OPERATION_NOT_FOUND',
  'RATE_LIMITED',
  'READ_ONLY',
  'REPORT_EXPIRED',
  'SAVE_CANCELLED',
  'SAVE_UNAVAILABLE',
  'SNAPSHOT_EXPIRED',
  'SHUTTING_DOWN',
  'STATE_UNKNOWN',
])

function boundedMessage(value, fallback) {
  const text = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[A-Z]:\\(?:Users\\[^\\\s]+|[^\s]+)(?:\\[^\s]*)?/gi, '[redacted-path]')
    .replace(/\/(?:Users|home)\/[^/\s]+(?:\/[^\s]*)?/g, '[redacted-path]')
    .replace(/(?:\/[^\/\s"'<>|`]+)+/g, '[redacted-path]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  return text || fallback
}

function publicToolError(error) {
  const exposed = Boolean(error && error.expose === true && SAFE_CODES.has(error.code))
  const code = exposed ? error.code : 'OPERATION_FAILED'
  const message = exposed
    ? boundedMessage(error.message, 'The request could not be completed')
    : 'The operation could not be completed safely; refresh state and try again'
  const result = new Error(message)
  result.name = 'SystemManagerToolError'
  result.code = code
  result.stack = `${result.name}: ${result.message}`
  return result
}

function createMcpHandlers(runtime) {
  if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime is required')
  const handlers = Object.create(null)
  for (const name of TOOL_NAMES) {
    if (typeof runtime[name] !== 'function') throw new TypeError(`runtime handler is missing: ${name}`)
    handlers[name] = async (request) => {
      try {
        return await runtime[name](request)
      } catch (error) {
        throw publicToolError(error)
      }
    }
  }
  return Object.freeze(handlers)
}

function registerMcpTools(hostWindow, handlers) {
  const api = hostWindow && hostWindow.ztools
  if (!api || typeof api.registerTool !== 'function') return Object.freeze([])
  const registered = []
  for (const name of TOOL_NAMES) {
    try {
      api.registerTool(name, handlers[name])
      registered.push(name)
    } catch {
      // Older or partially compatible hosts may reject registration. Preload
      // navigation and the feature bridge must continue to work unchanged.
    }
  }
  return Object.freeze(registered)
}

module.exports = Object.freeze({
  TOOL_NAMES,
  buildToolHandlers: createMcpHandlers,
  createMcpHandlers,
  publicToolError,
  registerSystemManagerTools: registerMcpTools,
  registerMcpTools,
})
