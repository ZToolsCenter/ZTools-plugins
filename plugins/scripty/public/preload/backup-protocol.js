'use strict'

const path = require('node:path')
const { RepositoryError } = require('./metadata-repository')

const EXPORT_FORMAT_VERSION = '1.1'
const LEGACY_EXPORT_FORMAT_VERSION = '1.0'
const LEGACY_REQUIRED_DATA_PATHS = Object.freeze([
  'data/environments.json',
  'data/scripts.json',
  'data/settings.json',
  'data/tasks.json'
])
const REQUIRED_DATA_PATHS = Object.freeze([
  'data/dependencies.json',
  'data/environments.json',
  'data/scriptFolders.json',
  'data/scripts.json',
  'data/settings.json',
  'data/tasks.json'
])
const MAX_JSON_BYTES = 5 * 1024 * 1024
const MAX_SCRIPT_BYTES = 10 * 1024 * 1024
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024
const MAX_PACKAGE_FILES = 10000
const MAX_COMPRESSION_RATIO = 100
const HASH_PATTERN = /^[0-9a-f]{64}$/
const SCRIPT_PATH_PATTERN = /^scripts\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:js|py|ps1|sh)$/

/** Compares protocol paths by code units so ordering never depends on host locale. */
function compareStableText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

/** Returns whether a ZIP path is canonical, root-relative, and allowed by backup protocol 1.0. */
function isAllowedPackagePath(entryPath) {
  if (typeof entryPath !== 'string' || !entryPath || entryPath.includes('\\') || entryPath.includes('\0')) return false
  if (path.posix.isAbsolute(entryPath) || /^[A-Za-z]:\//.test(entryPath) || entryPath.startsWith('//')) return false
  const segments = entryPath.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false
  return entryPath === 'manifest.json' || REQUIRED_DATA_PATHS.includes(entryPath) || LEGACY_REQUIRED_DATA_PATHS.includes(entryPath) || SCRIPT_PATH_PATTERN.test(entryPath)
}

/** Returns the per-entry uncompressed-byte limit for one canonical package path. */
function getPackageFileLimit(entryPath) {
  return entryPath.endsWith('.json') ? MAX_JSON_BYTES : MAX_SCRIPT_BYTES
}

/** Rejects invalid export option implications shared by package writers and readers. */
function assertExportOptions(options, code = 'VALIDATION_ERROR') {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new RepositoryError(code, '导出选项格式无效')
  }
  for (const field of ['includeEnvironments', 'includeEnvironmentValues', 'includeSensitiveValues']) {
    if (typeof options[field] !== 'boolean') throw new RepositoryError(code, `${field} 必须是布尔值`)
  }
  if (!options.includeEnvironments && (options.includeEnvironmentValues || options.includeSensitiveValues)) {
    throw new RepositoryError(code, '不导出环境变量时不能包含变量值')
  }
  if (options.includeSensitiveValues && !options.includeEnvironmentValues) {
    throw new RepositoryError(code, '包含敏感值前必须包含环境变量值')
  }
}

module.exports = {
  EXPORT_FORMAT_VERSION,
  LEGACY_EXPORT_FORMAT_VERSION,
  LEGACY_REQUIRED_DATA_PATHS,
  HASH_PATTERN,
  MAX_COMPRESSION_RATIO,
  MAX_JSON_BYTES,
  MAX_PACKAGE_BYTES,
  MAX_PACKAGE_FILES,
  MAX_SCRIPT_BYTES,
  REQUIRED_DATA_PATHS,
  assertExportOptions,
  compareStableText,
  getPackageFileLimit,
  isAllowedPackagePath
}
