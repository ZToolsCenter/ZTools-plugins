'use strict'

function copyString(value) {
  return Buffer.from(String(value), 'utf8').toString('utf8')
}

function copyPrefix(value, maxLength) {
  const limit = Number.isSafeInteger(maxLength) && maxLength >= 0 ? maxLength : 0
  return copyString(String(value).slice(0, limit))
}

module.exports = { copyPrefix, copyString }
