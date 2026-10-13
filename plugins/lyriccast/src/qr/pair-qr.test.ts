import { describe, expect, it } from 'vitest'
import { buildPairingPayload } from './pair-qr'

/** 用 URLSearchParams 还原 payload 的查询参数,模拟扫码方解析。 */
function parsePayload(payload: string): URLSearchParams {
  const query = payload.split('?')[1] ?? ''
  return new URLSearchParams(query)
}

describe('buildPairingPayload', () => {
  it('包含 scheme/host/版本/端口/token', () => {
    const payload = buildPairingPayload(['192.168.1.5'], 18765, 'token-abc-123')
    expect(payload.startsWith('androidrelay://pair?')).toBe(true)
    const params = parsePayload(payload)
    expect(params.get('v')).toBe('1')
    expect(params.get('port')).toBe('18765')
    expect(params.get('token')).toBe('token-abc-123')
  })

  it('多个地址按顺序逐个编入 ip 参数', () => {
    const payload = buildPairingPayload(['192.168.1.5', '10.0.0.7'], 18765, 'x'.repeat(24))
    expect(parsePayload(payload).getAll('ip')).toEqual(['192.168.1.5', '10.0.0.7'])
  })

  it('剔除空白地址,不产生空 ip 参数', () => {
    const payload = buildPairingPayload(['192.168.1.5', '  ', ''], 18765, 'x'.repeat(24))
    expect(parsePayload(payload).getAll('ip')).toEqual(['192.168.1.5'])
  })

  it('地址两端空白被裁剪', () => {
    const payload = buildPairingPayload([' 192.168.1.5 '], 18765, 'x'.repeat(24))
    expect(parsePayload(payload).getAll('ip')).toEqual(['192.168.1.5'])
  })

  it('端口为任意合法值时原样编入', () => {
    const payload = buildPairingPayload([], 9999, 'x'.repeat(24))
    expect(parsePayload(payload).get('port')).toBe('9999')
  })
})
