'use strict'

const { CronExpressionParser } = require('cron-parser')

/**
 * Parses a standard five-field Cron expression with optional parser dates for deterministic scheduling.
 * Null is reserved for manual-only tasks; malformed or non-five-field values return null.
 */
function parseFivePartCron(cron, options = {}) {
  if (cron === null || typeof cron !== 'string') return null
  const normalized = cron.trim()
  if (!normalized || normalized.split(/\s+/).length !== 5) return null
  try {
    return CronExpressionParser.parse(normalized, options)
  } catch {
    return null
  }
}

/** Accepts null for manual-only tasks or an expression parsed by the shared five-field boundary. */
function isValidFivePartCron(cron) {
  return cron === null || parseFivePartCron(cron) !== null
}

module.exports = { isValidFivePartCron, parseFivePartCron }
