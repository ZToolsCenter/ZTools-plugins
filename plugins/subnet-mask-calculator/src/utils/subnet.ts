/**
 * 子网掩码计算核心逻辑
 */

/** CIDR 转子网掩码（点分十进制） */
export function cidrToMask(cidr: number): string {
  if (cidr < 0 || cidr > 32) return '0.0.0.0'
  const mask: number[] = []
  for (let i = 0; i < 4; i++) {
    const bits = Math.min(8, Math.max(0, cidr - i * 8))
    mask.push(256 - Math.pow(2, 8 - bits))
  }
  return mask.join('.')
}

/** 子网掩码（点分十进制）转 CIDR */
export function maskToCidr(mask: string): number {
  if (!isValidMask(mask)) return -1
  return mask
    .split('.')
    .map((o) => parseInt(o).toString(2).padStart(8, '0'))
    .join('')
    .split('')
    .filter((b) => b === '1').length
}

/** 数字转 IP 地址 */
function numToIp(num: number): string {
  return [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255].join('.')
}

/** IP 地址转数字 */
function ipToNum(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o), 0) >>> 0
}

/** 判断 IP 是否合法 */
export function isValidIp(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = parseInt(p)
    return !isNaN(n) && n >= 0 && n <= 255 && p === String(n)
  })
}

/** 判断子网掩码是否合法 */
export function isValidMask(mask: string): boolean {
  if (!isValidIp(mask)) return false
  const binary = mask
    .split('.')
    .map((o) => parseInt(o).toString(2).padStart(8, '0'))
    .join('')
  return /^1*0*$/.test(binary)
}

/** 获取 IP 类别 */
function getIpClass(ip: string): string {
  const first = parseInt(ip.split('.')[0])
  if (first < 128) return 'A'
  if (first < 192) return 'B'
  if (first < 224) return 'C'
  if (first < 240) return 'D（组播）'
  return 'E（保留）'
}

/** 判断是否为私有地址 */
function isPrivateIp(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

/** 计算结果类型 */
export interface SubnetResult {
  ip: string
  cidr: number
  subnetMask: string
  wildcardMask: string
  networkAddress: string
  broadcastAddress: string
  firstHost: string | null
  lastHost: string | null
  hostCount: number
  ipClass: string
  isPrivate: boolean
  binaryMask: string
  binaryIp: string
}

/** 计算子网信息 */
export function calculateSubnet(ip: string, cidr: number): SubnetResult | null {
  if (!isValidIp(ip) || cidr < 0 || cidr > 32) return null

  const ipNum = ipToNum(ip)
  const maskNum = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0

  const networkNum = (ipNum & maskNum) >>> 0
  const broadcastNum = (networkNum | (~maskNum >>> 0)) >>> 0
  const hostCount = Math.pow(2, 32 - cidr) - 2
  const firstHostNum = networkNum + 1
  const lastHostNum = broadcastNum - 1

  return {
    ip,
    cidr,
    subnetMask: cidrToMask(cidr),
    wildcardMask: numToIp((~maskNum) >>> 0),
    networkAddress: numToIp(networkNum),
    broadcastAddress: numToIp(broadcastNum),
    firstHost: hostCount > 0 ? numToIp(firstHostNum) : null,
    lastHost: hostCount > 0 ? numToIp(lastHostNum) : null,
    hostCount: Math.max(0, hostCount),
    ipClass: getIpClass(ip),
    isPrivate: isPrivateIp(ip),
    binaryMask: cidrToBinaryMask(cidr),
    binaryIp: ipToBinary(ip),
  }
}

/** CIDR 转二进制掩码 */
function cidrToBinaryMask(cidr: number): string {
  const ones = '1'.repeat(cidr)
  const zeros = '0'.repeat(32 - cidr)
  const bits = (ones + zeros).padEnd(32, '0')
  return bits
    .split('')
    .reduce<string[]>((acc, bit, i) => {
      const groupIdx = Math.floor(i / 8)
      if (!acc[groupIdx]) acc[groupIdx] = ''
      acc[groupIdx] += bit
      return acc
    }, [])
    .join('.')
}

/** IP 转二进制 */
function ipToBinary(ip: string): string {
  return ip
    .split('.')
    .map((o) => parseInt(o).toString(2).padStart(8, '0'))
    .join('.')
}

/** 从 CIDR 字符串解析（如 "192.168.1.0/24"） */
export function parseCidr(cidrStr: string): { ip: string; cidr: number } | null {
  const match = cidrStr.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/)
  if (!match) return null
  const ip = match[1]
  const cidr = parseInt(match[2])
  if (!isValidIp(ip) || cidr < 0 || cidr > 32) return null
  return { ip, cidr }
}

/** 格式化大数字（加逗号） */
export function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

/** CIDR 快速参考表 */
export const cidrQuickRef: { cidr: number; mask: string; hosts: number }[] = Array.from(
  { length: 33 },
  (_, i) => ({
    cidr: i,
    mask: cidrToMask(i),
    hosts: i === 32 ? 1 : Math.max(0, Math.pow(2, 32 - i) - 2),
  })
)
