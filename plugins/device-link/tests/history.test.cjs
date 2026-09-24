'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { clearMessageHistory, removeMessageFromHistory } = require('../public/preload/core/history')

function fakeRepository(messages) {
  const state = {
    messages: [...messages],
    tombstones: [],
    removals: [],
  }
  return {
    state,
    async listMessages(limit) { return state.messages.slice(-limit) },
    async putTombstone(tombstone) { state.tombstones.push(tombstone) },
    async removeMessage(id, options) {
      state.removals.push({ id, options })
      state.messages = state.messages.filter((message) => message.id !== id)
      return true
    },
  }
}

test('removeMessageFromHistory creates a tombstone and only asks repository to remove owned attachments', async () => {
  const repository = fakeRepository([{ id: 'message-1' }])
  await removeMessageFromHistory(repository, { id: 'message-1' }, 'desktop-1', '2026-08-13T00:00:00.000Z')

  assert.deepEqual(repository.state.tombstones, [{
    id: 'message-1',
    deletedAt: '2026-08-13T00:00:00.000Z',
    sourceDeviceId: 'desktop-1',
  }])
  assert.deepEqual(repository.state.removals, [{ id: 'message-1', options: { removeOwnedAttachments: true } }])
})

test('clearMessageHistory deletes every batch without touching non-message records', async () => {
  const repository = fakeRepository([
    { id: 'message-1' },
    { id: 'message-2' },
    { id: 'message-3' },
    { id: 'message-4' },
    { id: 'message-5' },
  ])
  repository.state.settings = { pairingCodeMode: 'random' }
  repository.state.devices = [{ id: 'phone-1' }]

  const result = await clearMessageHistory(repository, 'desktop-1', {
    batchSize: 2,
    now: () => new Date('2026-08-13T01:02:03.000Z'),
  })

  assert.deepEqual(result, { deleted: 5 })
  assert.equal(repository.state.messages.length, 0)
  assert.equal(repository.state.tombstones.length, 5)
  assert.deepEqual(repository.state.settings, { pairingCodeMode: 'random' })
  assert.deepEqual(repository.state.devices, [{ id: 'phone-1' }])
})
