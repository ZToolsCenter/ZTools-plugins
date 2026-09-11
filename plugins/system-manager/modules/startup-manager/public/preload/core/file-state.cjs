'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { readBoundedFile } = require('./bounded-file.cjs')

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function stateEvidence(state) {
  if (!state || typeof state !== 'object') return state
  const { content, ...evidence } = state
  return evidence
}

function isStrictlyInside(parent, target) {
  const relative = path.relative(parent, target)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function readMutableRoot(rootPath, homePath, fileSystem = fs) {
  const rootStat = await fileSystem.lstat(rootPath)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    const error = new Error('用户可写根目录不是普通目录或为符号链接')
    error.code = 'UNSAFE_ROOT'
    throw error
  }
  const realHome = await fileSystem.realpath(homePath)
  const canonicalRoot = await fileSystem.realpath(rootPath)
  if (!isStrictlyInside(realHome, canonicalRoot)) {
    const error = new Error('用户可写根目录越过真实主目录边界')
    error.code = 'UNSAFE_ROOT'
    throw error
  }
  return { rootPath, homePath, realHome, canonicalRoot, dev: rootStat.dev, ino: rootStat.ino }
}

async function assertMutableRoot(expected, fileSystem = fs) {
  if (!expected) {
    const error = new Error('缺少用户可写根目录证据')
    error.code = 'UNSAFE_ROOT'
    throw error
  }
  const current = await readMutableRoot(expected.rootPath, expected.homePath, fileSystem)
  if (current.realHome !== expected.realHome || current.canonicalRoot !== expected.canonicalRoot || current.dev !== expected.dev || current.ino !== expected.ino) {
    const error = new Error('用户可写根目录已变化，请刷新后重试')
    error.code = 'ITEM_CHANGED'
    throw error
  }
  return current
}

async function readState(file, fileSystem = fs) {
  const linkStat = await fileSystem.lstat(file)
  if (linkStat.isSymbolicLink()) {
    const error = new Error('拒绝操作符号链接启动项')
    error.code = 'UNSAFE_FILE'
    throw error
  }
  if (!linkStat.isFile()) {
    const error = new Error('启动项不是普通文件')
    error.code = 'UNSAFE_FILE'
    throw error
  }
  const content = await readBoundedFile(file, fileSystem, { initialStat: linkStat })
  const realPath = await fileSystem.realpath(file)
  const parentRealPath = await fileSystem.realpath(path.dirname(file))
  return {
    content,
    hash: digest(content),
    size: linkStat.size,
    mtimeMs: linkStat.mtimeMs,
    dev: linkStat.dev,
    ino: linkStat.ino,
    mode: linkStat.mode,
    realPath,
    parentRealPath,
  }
}

async function assertUnchanged(file, expected, fileSystem = fs) {
  const current = await readState(file, fileSystem)
  if (!expected
    || current.hash !== expected.hash
    || current.size !== expected.size
    || current.dev !== expected.dev
    || current.ino !== expected.ino
    || current.realPath !== expected.realPath
    || current.parentRealPath !== expected.parentRealPath) {
    const error = new Error('项目已被其他程序修改，请刷新后重试')
    error.code = 'ITEM_CHANGED'
    throw error
  }
  return current
}

module.exports = { assertMutableRoot, assertUnchanged, digest, isStrictlyInside, readMutableRoot, readState, stateEvidence }
