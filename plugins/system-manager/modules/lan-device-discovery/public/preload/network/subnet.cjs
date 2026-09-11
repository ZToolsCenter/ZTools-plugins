'use strict'

const { intToIPv4, ipv4ToInt } = require('./interfaces.cjs')

const MAX_HOSTS = 254

function generateCandidates(networkInterface, maxHosts = MAX_HOSTS) {
  const own = ipv4ToInt(networkInterface && networkInterface.address)
  const prefix = networkInterface && networkInterface.prefixLength
  const limit = Math.min(MAX_HOSTS, Math.max(0, Number.isFinite(maxHosts) ? Math.floor(maxHosts) : MAX_HOSTS))
  if (own == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32 || limit === 0) {
    return { addresses: [], truncated: false, scanPrefixLength: null }
  }
  if (prefix === 32) return { addresses: [], truncated: false, scanPrefixLength: 32 }

  // Broad networks are deliberately reduced to the local /24 slice. This keeps
  // discovery predictable and prevents an accidental enterprise-wide sweep.
  const scanPrefixLength = Math.max(24, prefix)
  const hostBits = 32 - scanPrefixLength
  const mask = scanPrefixLength === 0 ? 0 : (0xffffffff << hostBits) >>> 0
  const network = (own & mask) >>> 0
  const total = 2 ** hostBits
  const firstOffset = scanPrefixLength <= 30 ? 1 : 0
  const lastOffset = scanPrefixLength <= 30 ? total - 2 : total - 1
  const addresses = []
  for (let offset = firstOffset; offset <= lastOffset && addresses.length < limit; offset += 1) {
    const candidate = (network + offset) >>> 0
    if (candidate !== own) addresses.push(intToIPv4(candidate))
  }
  const possible = Math.max(0, lastOffset - firstOffset + 1 - (own >= network + firstOffset && own <= network + lastOffset ? 1 : 0))
  return {
    addresses,
    truncated: prefix < 24 || possible > limit,
    scanPrefixLength,
  }
}

module.exports = { MAX_HOSTS, generateCandidates }
