/** IP 排序权重：192.168.x.y 优先，x 越小越优先 */
function ipSortKey(ip: string): number {
  if (ip.startsWith('192.168.')) {
    const x = parseInt(ip.split('.')[2], 10)
    return x // 0~255, smaller is better
  }
  if (ip.startsWith('10.')) return 1000
  if (ip.startsWith('172.')) return 2000
  return 3000
}

/** 将 lanIP（可能是单个字符串或数组）规范化为统一的 IP 列表和首选 IP */
export function normalizeLanIPs(lanIP: string | string[]): { ips: string[]; primaryIP: string } {
  const ips = Array.isArray(lanIP) ? [...lanIP] : lanIP ? [lanIP] : []
  ips.sort((a, b) => ipSortKey(a) - ipSortKey(b))
  return {
    ips,
    primaryIP: ips[0] || ''
  }
}
