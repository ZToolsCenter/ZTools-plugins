'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { randomId } = require('./crypto')

const MESSAGE_PREFIX = 'device-link:message:'
const DEVICE_PREFIX = 'device-link:device:'
const TOMBSTONE_PREFIX = 'device-link:tombstone:'
const SETTINGS_ID = 'device-link:settings'
const SYNC_ID = 'device-link:webdav'

function isNotFound(error) {
  return error?.status === 404 || error?.name === 'not_found' || error?.error === 'not_found'
}

function isFailedResult(result) {
  return Boolean(result && typeof result === 'object' && (
    result.error === true
      || typeof result.error === 'string'
      || result.ok === false
      || (Number.isFinite(Number(result.status)) && Number(result.status) >= 400)
  ))
}

function storageError(operation, result) {
  const detail = result?.reason || result?.message || result?.name || result?.error
  const error = new Error(`设备互联本地存储${operation}失败${detail ? `：${detail}` : ''}`)
  error.name = 'DeviceLinkStorageError'
  error.code = 'DEVICE_LINK_STORAGE_FAILED'
  error.status = Number(result?.status) || undefined
  return error
}

function createRepository(db, dataDir, options = {}) {
  const attachmentsDir = path.join(dataDir, 'attachments')
  const transfersDir = path.join(dataDir, 'transfers')
  const attachmentRoots = [attachmentsDir]
  const ready = Promise.resolve(options.ready)
  fs.mkdirSync(attachmentsDir, { recursive: true })
  fs.mkdirSync(transfersDir, { recursive: true })

  async function allDocs(prefix) {
    await ready
    if (typeof db.allDocs === 'function') {
      const result = await db.allDocs(prefix)
      if (isFailedResult(result)) throw storageError('读取', result)
      return Array.isArray(result) ? result : result?.rows?.map((row) => row.doc).filter(Boolean) || []
    }
    return []
  }

  return {
    attachmentsDir,
    transfersDir,
    async get(id) {
      await ready
      try {
        const result = await db.get(id)
        if (isNotFound(result)) return null
        if (isFailedResult(result)) throw storageError('读取', result)
        return result || null
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }
    },
    async put(doc) {
      await ready
      const current = await this.get(doc._id)
      const result = await db.put(current?._rev ? { ...doc, _rev: current._rev } : doc)
      if (isFailedResult(result)) throw storageError('写入', result)
      return result
    },
    async remove(id) {
      await ready
      const current = await this.get(id)
      if (!current) return false
      const result = await db.remove(current)
      if (isFailedResult(result)) throw storageError('删除', result)
      return true
    },
    async listMessages(limit = 1000, options = {}) {
      const docs = await allDocs(MESSAGE_PREFIX)
      const messages = docs
        .filter((doc) => doc && doc.type === 'device-link-message')
        .map(({ _id, _rev, type, ...message }) => message)
        .filter((message) => typeof options.filter !== 'function' || options.filter(message))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      if (typeof options.groupBy !== 'function') return messages.slice(-limit)
      const groups = new Map()
      for (const message of messages) {
        const key = String(options.groupBy(message))
        const group = groups.get(key) || []
        group.push(message)
        groups.set(key, group)
      }
      return [...groups.values()]
        .flatMap((group) => group.slice(-limit))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    },
    async getMessage(id) {
      const doc = await this.get(`${MESSAGE_PREFIX}${id}`)
      if (!doc || doc.type !== 'device-link-message') return null
      const { _id, _rev, type, ...message } = doc
      return message
    },
    async putMessage(message) {
      await this.put({ _id: `${MESSAGE_PREFIX}${message.id}`, type: 'device-link-message', ...message })
      return message
    },
    async removeMessage(id, options = {}) {
      if (options.removeOwnedAttachments) {
        const current = await this.get(`${MESSAGE_PREFIX}${id}`)
        for (const attachment of current?.attachments || []) {
          if (!attachment.path) continue
          const isOwnedAttachment = attachmentRoots.some((root) => {
            const relative = path.relative(root, path.resolve(attachment.path))
            return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
          })
          if (isOwnedAttachment) {
            try { await fs.promises.rm(attachment.path, { force: true }) } catch {}
          }
        }
      }
      return this.remove(`${MESSAGE_PREFIX}${id}`)
    },
    async listTombstones() {
      const docs = await allDocs(TOMBSTONE_PREFIX)
      return docs
        .filter((doc) => doc && doc.type === 'device-link-tombstone')
        .map(({ _id, _rev, type, ...tombstone }) => tombstone)
    },
    async putTombstone(tombstone) {
      await this.put({ _id: `${TOMBSTONE_PREFIX}${tombstone.id}`, type: 'device-link-tombstone', ...tombstone })
      return tombstone
    },
    async removeTombstone(id) {
      return this.remove(`${TOMBSTONE_PREFIX}${id}`)
    },
    async listDevices() {
      const docs = await allDocs(DEVICE_PREFIX)
      return docs
        .filter((doc) => doc && doc.type === 'device-link-device')
        .map(({ _id, _rev, type, ...device }) => ({ ...device, connected: false }))
        .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    },
    async putDevice(device) {
      await this.put({ _id: `${DEVICE_PREFIX}${device.id}`, type: 'device-link-device', ...device })
      return device
    },
    async removeDevice(id) {
      return this.remove(`${DEVICE_PREFIX}${id}`)
    },
    async getSettings() {
      return (await this.get(SETTINGS_ID)) || null
    },
    async putSettings(settings) {
      await this.put({ _id: SETTINGS_ID, type: 'device-link-settings', ...settings })
      return settings
    },
    async getSyncSettings() {
      return (await this.get(SYNC_ID)) || null
    },
    async putSyncSettings(settings) {
      await this.put({ _id: SYNC_ID, type: 'device-link-webdav', ...settings })
      return settings
    },
    newAttachmentPath(name) {
      return path.join(attachmentsDir, `${randomId(12)}-${name}`)
    },
    newTransferPath(id) {
      return path.join(transfersDir, `${id}.part`)
    },
  }
}

module.exports = { createRepository }
