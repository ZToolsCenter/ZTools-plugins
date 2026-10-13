/**
 * 配对二维码 payload 的构建。
 *
 * 格式:androidrelay://pair?v=1&port=<port>&ip=<ip1>&ip=<ip2>&token=<token>
 * - PC 端(本函数)负责生成,Android 端 PairingQr.parse 负责解析,两侧字段顺序不敏感;
 * - 多网卡时全部 IP 都编入(USB 共享网络/虚拟网卡 IP 可能连不上,手机按序尝试);
 * - ip/token 均为 URL 安全字符,但仍统一走 encodeURIComponent 以防将来扩展;
 * - payload 不含用户个人数据,但含配对 Token,提示用户不要截图外传。
 */
export const PAIR_SCHEME = 'androidrelay'

/** 用本机地址/端口/Token 组装扫码 payload;空白地址自动剔除。 */
export function buildPairingPayload(addresses: string[], port: number, token: string): string {
  const params = new URLSearchParams()
  params.set('v', '1')
  params.set('port', String(port))
  for (const address of addresses) {
    if (address && address.trim()) params.append('ip', address.trim())
  }
  params.set('token', token)
  return `${PAIR_SCHEME}://pair?${params.toString()}`
}
