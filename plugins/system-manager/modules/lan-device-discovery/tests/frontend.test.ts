import assert from 'node:assert/strict'
import test from 'node:test'

import { evidenceLabel, safeUiError, scanStatusLabel, sortDevices, statusLabel } from '../src/composables/presentation'
import type { LanDevice } from '../src/types/discovery'

const device = (ip: string, overrides: Partial<LanDevice> = {}): LanDevice => ({
  ip,
  hostname: null,
  vendor: null,
  onlineStatus: 'unknown',
  evidence: [],
  isSelf: false,
  ...overrides,
})

test('presentation sorts IPv4 numerically and uses honest status labels', () => {
  const sorted = sortDevices([device('192.168.1.100'), device('192.168.1.2'), device('10.0.0.1')])
  assert.deepEqual(sorted.map((item) => item.ip), ['10.0.0.1', '192.168.1.2', '192.168.1.100'])
  assert.equal(statusLabel('online'), '在线')
  assert.equal(statusLabel('recently-seen'), '最近出现')
  assert.equal(statusLabel('unknown'), '状态未知')
  assert.equal(scanStatusLabel('partial'), '部分完成')
})

test('evidence labels distinguish self, ICMP and passive neighbor table', () => {
  assert.equal(evidenceLabel(device('192.168.1.1', { evidence: ['neighbor', 'icmp'] })), '邻居表 · ICMP 响应')
  assert.equal(evidenceLabel(device('192.168.1.2', { evidence: ['self'] })), '本机')
  assert.equal(evidenceLabel(device('192.168.1.3')), '未确认')
})

test('UI errors are sanitized and never expose preload exception details', () => {
  const privateError = Object.assign(new Error('/Users/alice secret command failed'), { code: 'INTERNAL' })
  assert.equal(safeUiError(privateError), '操作失败，请检查网络状态后重试。')
  assert.doesNotMatch(safeUiError(privateError), /alice|secret|command/)
  assert.match(safeUiError({ code: 'INVALID_INTERFACE' }), /网卡已变化/)
  assert.match(safeUiError({ code: 'INTERFACE_CHANGED' }), /发生变化/)
  assert.match(safeUiError({ code: 'CONFIRMATION_REQUIRED' }), /二次确认/)
})
