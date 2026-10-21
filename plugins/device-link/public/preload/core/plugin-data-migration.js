'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MESSAGE_PREFIX = 'device-link:message:'
const EARLY_KEY_FALLBACK_DIR = '.credential-key-fallback-early32'

function failedResult(result) {
  return Boolean(result && typeof result === 'object' && (result.error === true || typeof result.error === 'string' || result.ok === false || (Number.isFinite(Number(result.status)) && Number(result.status) >= 400)))
}

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function safeTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name)
    const stat = fs.lstatSync(candidate)
    if (stat.isSymbolicLink()) throw new TypeError('设备互联数据迁移不允许符号链接')
    if (stat.isDirectory()) safeTree(candidate)
    else if (!stat.isFile()) throw new TypeError('设备互联数据迁移只允许普通文件和目录')
  }
}

function copyAndVerify(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (!fs.existsSync(to)) fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: true })
    const sourceStat = fs.lstatSync(from)
    const destinationStat = fs.lstatSync(to)
    if (sourceStat.isDirectory() !== destinationStat.isDirectory()) return false
    if (sourceStat.isDirectory()) {
      if (!copyAndVerify(from, to)) return false
    } else if (!sourceStat.isFile() || !destinationStat.isFile()
      || sourceStat.size !== destinationStat.size || digest(from) !== digest(to)) return false
  }
  return true
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function migratedAttachmentPath(filePath, legacyDataDir, pluginDataDir) {
  if (typeof filePath !== 'string') return filePath
  const absolute = path.resolve(filePath)
  const legacyAttachments = path.join(path.resolve(legacyDataDir), 'attachments')
  if (!inside(legacyAttachments, absolute)) return filePath
  return path.join(pluginDataDir, 'attachments', path.relative(legacyAttachments, absolute))
}

async function migrateMessagePaths(db, legacyDataDir, pluginDataDir) {
  const result = await db.allDocs(MESSAGE_PREFIX)
  if (failedResult(result)) throw new Error('设备互联迁移读取数据库失败')
  const docs = Array.isArray(result) ? result : result?.rows?.map((row) => row.doc).filter(Boolean) || []
  for (const doc of docs) {
    if (!doc || doc.type !== 'device-link-message') continue
    const attachments = (doc.attachments || []).map((attachment) => ({
      ...attachment,
      path: migratedAttachmentPath(attachment.path, legacyDataDir, pluginDataDir),
    }))
    if (attachments.every((attachment, index) => attachment.path === doc.attachments[index]?.path)) continue
    const putResult = await db.put({ ...doc, attachments })
    if (failedResult(putResult)) throw new Error('设备互联迁移更新附件路径失败')
  }
}

function preparePluginDataMigration(db, pluginDataDir, legacyDataDir) {
  if (!pluginDataDir || path.resolve(pluginDataDir) === path.resolve(legacyDataDir)) {
    return { dataDir: legacyDataDir, ready: Promise.resolve(), usingPluginData: false }
  }
  try {
    if (!fs.existsSync(legacyDataDir)) {
      fs.mkdirSync(pluginDataDir, { recursive: true })
      return { dataDir: pluginDataDir, ready: Promise.resolve(), usingPluginData: true }
    }
    safeTree(legacyDataDir)
    const legacyKey = path.join(legacyDataDir, 'credential-key-v2')
    const pluginKey = path.join(pluginDataDir, 'credential-key-v2')
    if (fs.existsSync(legacyKey) && fs.existsSync(pluginKey) && digest(legacyKey) !== digest(pluginKey)) {
      const fallbackDir = path.join(pluginDataDir, EARLY_KEY_FALLBACK_DIR)
      const fallbackKey = path.join(fallbackDir, 'credential-key-v2')
      fs.mkdirSync(fallbackDir, { recursive: true })
      fs.copyFileSync(pluginKey, fallbackKey)
      if (digest(pluginKey) !== digest(fallbackKey)) throw new Error('早期 3.2 凭据密钥备份校验失败')
      fs.copyFileSync(legacyKey, pluginKey)
      if (digest(legacyKey) !== digest(pluginKey)) throw new Error('旧凭据密钥迁移校验失败')
    }
    if (!copyAndVerify(legacyDataDir, pluginDataDir)) {
      return { dataDir: legacyDataDir, ready: Promise.resolve(), usingPluginData: false }
    }
  } catch {
    return { dataDir: legacyDataDir, ready: Promise.resolve(), usingPluginData: false }
  }

  const ready = migrateMessagePaths(db, legacyDataDir, pluginDataDir).then(() => {
    fs.rmSync(legacyDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    if (fs.existsSync(legacyDataDir)) throw new Error('旧设备互联数据目录清理失败')
    fs.writeFileSync(path.join(pluginDataDir, '.device-link-plugin-data-migration-v1.json'), JSON.stringify({ version: 1, completedAt: new Date().toISOString() }))
  })
  return { dataDir: pluginDataDir, ready, usingPluginData: true }
}

module.exports = { EARLY_KEY_FALLBACK_DIR, migratedAttachmentPath, migrateMessagePaths, preparePluginDataMigration }
