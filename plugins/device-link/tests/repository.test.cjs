'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRepository } = require('../public/preload/core/repository')

test('message limits apply after access filtering and independently per conversation', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-repository-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const now = Date.parse('2026-08-14T00:00:00.000Z')
  const messages = [{
    _id: 'device-link:message:private-a', type: 'device-link-message', id: 'private-a', conversationId: 'device:phone-a',
    senderId: 'phone-a', createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), attachments: [],
  }]
  for (let index = 0; index < 1001; index += 1) {
    const createdAt = new Date(now + index + 1).toISOString()
    messages.push({
      _id: `device-link:message:private-b-${index}`, type: 'device-link-message', id: `private-b-${index}`, conversationId: 'device:phone-b',
      senderId: 'phone-b', createdAt, updatedAt: createdAt, attachments: [],
    })
  }
  const repository = createRepository({
    async allDocs() { return messages },
    async get() { return null },
    async put() {},
    async remove() {},
  }, root)

  const phoneA = await repository.listMessages(1000, { filter: (message) => message.conversationId === 'device:phone-a' })
  assert.deepEqual(phoneA.map((message) => message.id), ['private-a'])

  const grouped = await repository.listMessages(2, { groupBy: (message) => message.conversationId })
  assert.deepEqual(grouped.filter((message) => message.conversationId === 'device:phone-a').map((message) => message.id), ['private-a'])
  assert.deepEqual(grouped.filter((message) => message.conversationId === 'device:phone-b').map((message) => message.id), ['private-b-999', 'private-b-1000'])
})

test('database error results are rejected instead of reporting a successful write', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-repository-error-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repository = createRepository({
    async allDocs() { return [] },
    async get(id) {
      if (id === 'remove-me') return { _id: id, _rev: '1-a' }
      return { error: true, name: 'not_found', status: 404 }
    },
    async put() { return { error: true, name: 'conflict', status: 409, reason: 'Document update conflict' } },
    async remove() { return { error: true, name: 'forbidden', status: 403 } },
  }, root)

  await assert.rejects(
    repository.putSettings({ pairingCodeMode: 'random' }),
    (error) => error.code === 'DEVICE_LINK_STORAGE_FAILED' && error.status === 409,
  )
  await assert.rejects(
    repository.remove('remove-me'),
    (error) => error.code === 'DEVICE_LINK_STORAGE_FAILED' && error.status === 403,
  )
})

test('messages can be read directly without scanning the complete history', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-repository-message-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  let requestedId = ''
  let allDocsCalls = 0
  const repository = createRepository({
    async allDocs() { allDocsCalls += 1; return [] },
    async get(id) {
      requestedId = id
      return {
        _id: id,
        _rev: '1-a',
        type: 'device-link-message',
        id: 'phone-image',
        createdAt: '2026-08-31T00:00:00.000Z',
        attachments: [{ id: 'attachment-1', path: '/tmp/phone-image.jpg' }],
      }
    },
    async put() {},
    async remove() {},
  }, root)

  const message = await repository.getMessage('phone-image')
  assert.equal(requestedId, 'device-link:message:phone-image')
  assert.equal(allDocsCalls, 0)
  assert.equal(message.id, 'phone-image')
  assert.equal(message.attachments[0].id, 'attachment-1')
  assert.equal('_rev' in message, false)
})

test('database read failures are not mistaken for missing records', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-repository-read-error-test-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const repository = createRepository({
    async allDocs() { return { error: true, name: 'unavailable', status: 503 } },
    async get() { return { error: true, name: 'unavailable', status: 503 } },
    async put() {},
    async remove() {},
  }, root)

  await assert.rejects(repository.get('settings'), (error) => error.code === 'DEVICE_LINK_STORAGE_FAILED')
  await assert.rejects(repository.listDevices(), (error) => error.code === 'DEVICE_LINK_STORAGE_FAILED')
})

test('history cleanup removes pluginData attachments but never files outside the managed root', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'device-link-attachment-roots-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const pluginData = path.join(root, 'plugin-data')
  const currentAttachment = path.join(pluginData, 'attachments', 'current.txt')
  const unrelatedFile = path.join(root, 'unrelated.txt')
  for (const file of [currentAttachment, unrelatedFile]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'fixture')
  }

  const message = {
    _id: 'device-link:message:cleanup',
    type: 'device-link-message',
    id: 'cleanup',
    attachments: [
      { path: currentAttachment },
      { path: unrelatedFile },
    ],
  }
  let removed = false
  const repository = createRepository({
    async allDocs() { return [] },
    async get(id) { return id === message._id && !removed ? message : null },
    async put() {},
    async remove() { removed = true },
  }, pluginData)

  assert.equal(await repository.removeMessage('cleanup', { removeOwnedAttachments: true }), true)
  assert.equal(fs.existsSync(currentAttachment), false)
  assert.equal(fs.existsSync(unrelatedFile), true)
})
