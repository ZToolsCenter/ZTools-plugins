'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

function fileDigest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function assertSafeTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name)
    const stat = fs.lstatSync(entryPath)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) assertSafeTree(entryPath)
    else if (!stat.isFile()) throw new TypeError('插件数据迁移只允许普通文件和目录')
  }
}

function copyMissingTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.name === 'runtime' && fs.existsSync(destinationPath)) {
      if (fs.lstatSync(destinationPath).isSymbolicLink()) throw new TypeError('runtime 目录不能是符号链接')
      continue
    }
    if (fs.existsSync(destinationPath)) continue
    fs.cpSync(sourcePath, destinationPath, { recursive: true, force: false, errorOnExist: true })
  }
}

function verifySourceIncluded(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.name === 'runtime' && fs.existsSync(destinationPath)) {
      if (fs.lstatSync(destinationPath).isSymbolicLink()) return false
      continue
    }
    if (!fs.existsSync(destinationPath)) return false
    const sourceStat = fs.lstatSync(sourcePath)
    const destinationStat = fs.lstatSync(destinationPath)
    if (sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) {
      if (!sourceStat.isSymbolicLink() || !destinationStat.isSymbolicLink()
        || fs.readlinkSync(sourcePath) !== fs.readlinkSync(destinationPath)) return false
      continue
    }
    if (sourceStat.isDirectory() !== destinationStat.isDirectory()) return false
    if (sourceStat.isDirectory()) {
      if (!verifySourceIncluded(sourcePath, destinationPath)) return false
    } else if (!sourceStat.isFile() || !destinationStat.isFile()
      || sourceStat.size !== destinationStat.size
      || fileDigest(sourcePath) !== fileDigest(destinationPath)) return false
  }
  return true
}

function migrateDefaultDataDir(api, legacyDataDir) {
  let pluginData = ''
  try { pluginData = typeof api?.getPath === 'function' ? api.getPath('pluginData') : '' } catch {}
  if (typeof pluginData !== 'string' || !path.isAbsolute(pluginData)) {
    return Object.freeze({ path: legacyDataDir, migrated: false, usingPluginData: false })
  }
  const destination = path.resolve(pluginData)
  const legacy = path.resolve(legacyDataDir)
  if (destination === legacy) return Object.freeze({ path: destination, migrated: false, usingPluginData: true })
  let migrated = false
  try {
    if (fs.existsSync(legacy)) {
      assertSafeTree(legacy)
      copyMissingTree(legacy, destination)
      if (!verifySourceIncluded(legacy, destination)) {
        return Object.freeze({ path: legacy, migrated: false, usingPluginData: false })
      }
      fs.rmSync(legacy, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      if (fs.existsSync(legacy)) return Object.freeze({ path: legacy, migrated: false, usingPluginData: false })
      migrated = true
    }
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(path.join(destination, '.cc-switch-plugin-data-migration-v1.json'), JSON.stringify({ version: 1, completedAt: new Date().toISOString() }))
    return Object.freeze({ path: destination, migrated, usingPluginData: true })
  } catch {
    if (fs.existsSync(legacy)) return Object.freeze({ path: legacy, migrated: false, usingPluginData: false })
    if (fs.existsSync(destination)) return Object.freeze({ path: destination, migrated: true, usingPluginData: true })
    return Object.freeze({ path: legacy, migrated: false, usingPluginData: false })
  }
}

module.exports = Object.freeze({ assertSafeTree, copyMissingTree, migrateDefaultDataDir, verifySourceIncluded })
