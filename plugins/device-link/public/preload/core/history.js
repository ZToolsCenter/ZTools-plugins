'use strict'

async function removeMessageFromHistory(repository, message, sourceDeviceId, deletedAt) {
  await repository.putTombstone({
    id: message.id,
    deletedAt,
    sourceDeviceId,
  })
  await repository.removeMessage(message.id, { removeOwnedAttachments: true })
}

async function clearMessageHistory(repository, sourceDeviceId, options = {}) {
  const batchSize = options.batchSize || 1000
  const deletedAt = (options.now || (() => new Date()))().toISOString()
  let deleted = 0

  while (true) {
    const messages = await repository.listMessages(batchSize)
    if (!messages.length) break

    for (const message of messages) {
      await removeMessageFromHistory(repository, message, sourceDeviceId, deletedAt)
      deleted += 1
    }

    if (messages.length < batchSize) break
  }

  return { deleted }
}

module.exports = { clearMessageHistory, removeMessageFromHistory }
