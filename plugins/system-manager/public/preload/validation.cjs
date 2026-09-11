'use strict'

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/
const SAFE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/
const SAFE_CURSOR = /^[A-Za-z0-9_-]{20,256}$/

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
    this.code = 'INVALID_ARGUMENT'
    this.expose = true
    this.stack = `${this.name}: ${this.message}`
  }
}

function fail(message) {
  throw new ValidationError(message)
}

function plainObject(value, allowedKeys, label = 'request') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a plain object`)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain object`)
  if (Object.getOwnPropertySymbols(value).length) fail(`${label} contains unsupported keys`)

  const allowed = new Set(allowedKeys)
  const output = Object.create(null)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!allowed.has(key)) fail(`${label}.${key} is not allowed`)
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail(`${label}.${key} must be a data property`)
    }
    output[key] = descriptor.value
  }
  return output
}

function string(value, label, options = {}) {
  const min = options.min == null ? 1 : options.min
  const max = options.max == null ? 200 : options.max
  if (typeof value !== 'string' || value.length < min || value.length > max) fail(`${label} must be ${min}-${max} characters`)
  if (options.pattern && !options.pattern.test(value)) fail(`${label} has an invalid format`)
  if (options.values && !options.values.includes(value)) fail(`${label} is not supported`)
  return value
}

function optionalString(value, label, options = {}) {
  return value === undefined ? undefined : string(value, label, options)
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`)
  return value
}

function optionalBoolean(value, label, fallback) {
  return value === undefined ? fallback : boolean(value, label)
}

function integer(value, label, options = {}) {
  const min = options.min == null ? 0 : options.min
  const max = options.max == null ? Number.MAX_SAFE_INTEGER : options.max
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label} must be an integer from ${min} to ${max}`)
  return value
}

function optionalInteger(value, label, options = {}, fallback) {
  return value === undefined ? fallback : integer(value, label, options)
}

function stringArray(value, label, options = {}) {
  const min = options.min == null ? 0 : options.min
  const max = options.max == null ? 100 : options.max
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${label} must contain ${min}-${max} items`)
  const result = value.map((item, index) => string(item, `${label}[${index}]`, {
    min: options.itemMin == null ? 1 : options.itemMin,
    max: options.itemMax == null ? 200 : options.itemMax,
    pattern: options.pattern,
    values: options.values,
  }))
  if (options.unique !== false && new Set(result).size !== result.length) fail(`${label} must not contain duplicates`)
  return result
}

function optionalStringArray(value, label, options = {}) {
  return value === undefined ? undefined : stringArray(value, label, options)
}

function id(value, label) {
  return string(value, label, { min: 1, max: 200, pattern: SAFE_ID })
}

function idempotencyKey(value) {
  return string(value, 'idempotencyKey', { min: 8, max: 128, pattern: SAFE_IDEMPOTENCY_KEY })
}

function cursor(value) {
  return optionalString(value, 'cursor', { min: 20, max: 256, pattern: SAFE_CURSOR })
}

function pageSize(value) {
  return optionalInteger(value, 'pageSize', { min: 1, max: 100 }, 50)
}

module.exports = Object.freeze({
  SAFE_CURSOR,
  SAFE_ID,
  SAFE_IDEMPOTENCY_KEY,
  ValidationError,
  boolean,
  cursor,
  fail,
  id,
  idempotencyKey,
  integer,
  optionalBoolean,
  optionalInteger,
  optionalString,
  optionalStringArray,
  pageSize,
  plainObject,
  string,
  stringArray,
})
