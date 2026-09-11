'use strict'

const crypto = require('node:crypto')

function parseIPv4(value) {
  if (typeof value !== 'string') return null
  const parts = value.trim().split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => /^\d{1,3}$/.test(part) ? Number(part) : NaN)
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return octets
}

function ipv4ToInt(value) {
  const parts = parseIPv4(value)
  if (!parts) return null
  return ((((parts[0] * 256) + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function intToIPv4(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) return null
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function prefixFromNetmask(netmask) {
  const value = ipv4ToInt(netmask)
  if (value == null) return null
  let prefix = 0
  let sawZero = false
  for (let bit = 31; bit >= 0; bit -= 1) {
    const set = (value & (2 ** bit)) !== 0
    if (set && sawZero) return null
    if (set) prefix += 1
    else sawZero = true
  }
  return prefix
}

function isUsableUnicast(value) {
  const parts = parseIPv4(value)
  if (!parts) return false
  const first = parts[0]
  if (first === 0 || first === 127 || first >= 224) return false
  if (first === 169 && parts[1] === 254) return false
  return value !== '255.255.255.255'
}

function addressScope(value) {
  const parts = parseIPv4(value)
  if (!parts) return 'other'
  if (parts[0] === 10) return 'private'
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 'private'
  if (parts[0] === 192 && parts[1] === 168) return 'private'
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return 'shared'
  return 'other'
}

function stableInterfaceId(name, address, prefixLength) {
  return crypto.createHash('sha256').update(`${name}\0${address}\0${prefixLength}`).digest('hex').slice(0, 16)
}

// Keep the allow-list for automatically trusted physical names deliberately
// narrow. Linux distributions and Windows/macOS drivers use a predictable
// set of names, while a custom name must require the same confirmation as a
// known virtual adapter until we can identify it with confidence.
const TYPICAL_PHYSICAL_INTERFACE = /^(?:en\d+|en[opsx][\w-]+|eth\d+|wlan\d+|wl[\w-]+|ib\d+|usb\d+|lan\d+|wi-?fi(?:[\s_-].*)?|ethernet(?:[\s_-].*)?)$/i

// These prefixes are emitted by common Linux container/CNI runtimes and
// desktop hypervisors. They are name-based hints only; all virtual and VPN
// matches still require an explicit scan confirmation below.
const VIRTUAL_INTERFACE = /^(?:bridge[\w.-]*|br(?:idge)?[-_.]?[\w.-]*|docker[\w.-]*|podman(?:\d+|[-_.][\w.-]+)?|cni(?:\d+|[-_.][\w.-]+)?|flannel(?:\d+|[-_.][\w.-]+)?|cali[\w.-]*|kube(?:[-_.][\w.-]+)?|veth[\w.-]*|virbr[\w.-]*|lxcbr[\w.-]*|lxdbr[\w.-]*|vmnet[\w.-]*|vbox[\w.-]*|vnet[\w.-]*|q(?:vb|vo|br|tr)[\w.-]*|hyper-v[\w.-]*|macvlan[\w.-]*|ipvlan[\w.-]*|dummy\d*|ifb\d*|weave[\w.-]*|vxlan[\w.-]*|ovs(?:[-_.][\w.-]+)?|bond\d*|team\d*|awdl\d*|p2p\d*|llw\d*)$/i

const VPN_INTERFACE = /^(?:utun[\w.-]*|tun[\w.-]*|tap[\w.-]*|wg[\w.-]*|ppp[\w.-]*|ipsec[\w.-]*|tailscale[\w.-]*|zt[\w.-]*|ham[\w.-]*)$/i

function interfaceRank(name) {
  const value = String(name || '').toLowerCase()
  if (interfaceKind(value) === 'physical' && isTypicalPhysicalInterface(value)) return 0
  if (interfaceKind(value) !== 'physical') return 2
  return 1
}

function interfaceKind(name) {
  const value = String(name || '').trim().toLowerCase()
  if (VPN_INTERFACE.test(value) || /vpn/.test(value)) return 'vpn'
  if (VIRTUAL_INTERFACE.test(value)) return 'virtual'
  return 'physical'
}

function isTypicalPhysicalInterface(name) {
  return TYPICAL_PHYSICAL_INTERFACE.test(String(name || '').trim())
}

function exactInterfaceMatch(left, right) {
  return Boolean(left && right
    && left.id === right.id
    && left.name === right.name
    && left.address === right.address
    && left.prefixLength === right.prefixLength
    && left.scope === right.scope
    && left.kind === right.kind)
}

function listInterfacesFromNode(nodeOs) {
  let raw = {}
  try {
    raw = nodeOs && typeof nodeOs.networkInterfaces === 'function' ? nodeOs.networkInterfaces() : {}
  } catch {
    raw = {}
  }
  const result = []
  for (const [name, entries] of Object.entries(raw || {})) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      const family = entry && entry.family
      if (!entry || entry.internal || (family !== 'IPv4' && family !== 4)) continue
      const address = typeof entry.address === 'string' ? entry.address : ''
      if (!isUsableUnicast(address)) continue
      const cidrPrefix = typeof entry.cidr === 'string' && entry.cidr.includes('/')
        ? Number(entry.cidr.slice(entry.cidr.lastIndexOf('/') + 1))
        : null
      const prefixLength = Number.isInteger(cidrPrefix) && cidrPrefix >= 0 && cidrPrefix <= 32
        ? cidrPrefix
        : prefixFromNetmask(entry.netmask)
      if (prefixLength == null) continue
      const scope = addressScope(address)
      // Active discovery is limited to RFC1918 and carrier-grade NAT ranges.
      // A directly assigned public address must never become an implicit sweep.
      if (scope === 'other') continue
      const kind = interfaceKind(name)
      const typicalPhysical = kind === 'physical' && isTypicalPhysicalInterface(name)
      // A physical-looking but non-standard name is not enough evidence that
      // this is a user LAN adapter. Keep confirmation-first behavior for
      // custom Linux bridges, tunnel providers, and localized/driver names.
      const requiresConfirmation = scope === 'shared' || kind !== 'physical' || !typicalPhysical
      result.push({
        id: stableInterfaceId(name, address, prefixLength),
        name: String(name).slice(0, 120),
        address,
        cidr: `${address}/${prefixLength}`,
        prefixLength,
        scope,
        kind,
        requiresConfirmation,
        riskReason: scope === 'shared'
          ? '运营商共享地址网段'
          : kind === 'vpn'
            ? 'VPN 或隧道接口'
            : kind === 'virtual'
              ? '虚拟或桥接接口'
              : !typicalPhysical
                ? '无法确认接口类型，扫描前需确认'
                : null,
      })
    }
  }
  return result.sort((a, b) => {
    const rank = { private: 0, shared: 1, other: 2 }
    return rank[a.scope] - rank[b.scope]
      || interfaceRank(a.name) - interfaceRank(b.name)
      || a.name.localeCompare(b.name)
      || a.address.localeCompare(b.address)
  })
}

function subnetContains(networkInterface, ip) {
  const own = ipv4ToInt(networkInterface && networkInterface.address)
  const candidate = ipv4ToInt(ip)
  const prefix = networkInterface && networkInterface.prefixLength
  if (own == null || candidate == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (own & mask) === (candidate & mask)
}

module.exports = {
  addressScope,
  intToIPv4,
  exactInterfaceMatch,
  interfaceKind,
  interfaceRank,
  isTypicalPhysicalInterface,
  ipv4ToInt,
  isUsableUnicast,
  listInterfacesFromNode,
  parseIPv4,
  prefixFromNetmask,
  stableInterfaceId,
  subnetContains,
}
