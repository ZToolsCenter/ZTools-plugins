'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { Readable } = require('node:stream')
const yazl = require('yazl')
const { RepositoryError, mapFileSystemError } = require('./metadata-repository')

const ZIP_ENTRY_DATE = new Date('1980-01-01T00:00:00.000Z')

/** Rejects archive entries that could escape the ZIP root, collide, or serialize non-buffer content. */
function validateArchiveFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new RepositoryError('VALIDATION_ERROR', '备份包缺少文件')
  }
  const paths = new Set()
  for (const file of files) {
    const entryPath = file?.path
    const segments = typeof entryPath === 'string' ? entryPath.split('/') : []
    if (
      !entryPath || path.posix.isAbsolute(entryPath) || entryPath.includes('\\') || entryPath.includes('\0') ||
      segments.some(segment => segment === '' || segment === '.' || segment === '..') || !Buffer.isBuffer(file.content)
    ) {
      throw new RepositoryError('VALIDATION_ERROR', '备份包包含无效文件')
    }
    const collisionKey = entryPath.toLowerCase()
    if (paths.has(collisionKey)) throw new RepositoryError('VALIDATION_ERROR', '备份包包含重复文件')
    paths.add(collisionKey)
  }
}

/** Streams controlled logical package files through yazl's read-stream path into a temporary ZIP and atomically replaces the chosen target. */
async function writeBackupArchive(files, targetPath, options = {}) {
  validateArchiveFiles(files)
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    throw new RepositoryError('PATH_NOT_ALLOWED', '备份保存路径无效')
  }
  const createZipFile = options.createZipFile ?? (() => new yazl.ZipFile())
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`)
  let output
  try {
    const zipFile = createZipFile()
    output = fs.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 })
    const completed = new Promise((resolve, reject) => {
      output.once('close', resolve)
      output.once('error', reject)
      zipFile.outputStream.once('error', reject)
    })
    zipFile.outputStream.pipe(output)
    for (const file of files) {
      zipFile.addReadStream(
        Readable.from([file.content]),
        file.path,
        { size: file.content.length, mtime: ZIP_ENTRY_DATE, mode: 0o600 }
      )
    }
    zipFile.end()
    await completed
    const descriptor = fs.openSync(temporaryPath, 'r+')
    try {
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    const size = fs.statSync(temporaryPath).size
    fs.renameSync(temporaryPath, targetPath)
    return size
  } catch (error) {
    if (output && !output.closed) {
      await new Promise(resolve => {
        output.once('close', resolve)
        output.destroy()
      })
    }
    try {
      fs.rmSync(temporaryPath, { force: true })
    } catch {}
    if (error instanceof RepositoryError) throw error
    throw mapFileSystemError(error, 'WRITE_FAILED', '无法写入备份文件')
  }
}

module.exports = { validateArchiveFiles, writeBackupArchive }
