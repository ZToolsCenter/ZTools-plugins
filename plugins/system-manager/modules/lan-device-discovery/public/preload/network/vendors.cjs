'use strict'

const ouiData = require('../data/oui.json')

function normalizeMac(value) {
  if (typeof value !== 'string') return null
  const compact = value.trim().replace(/[-:.]/g, '').toUpperCase()
  if (!/^[0-9A-F]{12}$/.test(compact) || compact === '000000000000' || compact === 'FFFFFFFFFFFF') return null
  const first = Number.parseInt(compact.slice(0, 2), 16)
  if ((first & 1) === 1) return null
  return compact.match(/.{2}/g).join(':')
}

function lookupVendor(value) {
  const normalized = normalizeMac(value)
  if (!normalized) return null
  const compact = normalized.replace(/:/g, '')
  const first = Number.parseInt(compact.slice(0, 2), 16)
  if ((first & 2) === 2) return '随机或本地管理地址'
  return ouiData.entries[compact.slice(0, 6)] || null
}

module.exports = { lookupVendor, normalizeMac }
