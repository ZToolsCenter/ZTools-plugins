import { describe, it, expect } from 'vitest'
import { parseLogLine } from '../src/Containers/logFormat'

describe('parseLogLine', () => {
  it('ISO 空格分隔 + 毫秒', () => {
    const p = parseLogLine('2026-08-14 16:36:57.669 UTC [26] LOG: checkpoint complete')
    expect(p.time).toBe('2026-08-14 16:36:57.669')
    expect(p.rest).toContain('checkpoint complete')
    expect(p.prefix).toBe('')
  })

  it('ISO T 分隔', () => {
    const p = parseLogLine('2026-08-15T15:34:00.123Z GET / 200')
    expect(p.time).toBe('2026-08-15T15:34:00.123')
    expect(p.rest).toContain('GET / 200')
  })

  it('斜杠日期格式', () => {
    const p = parseLogLine('2026/08/14 16:36:57 app started')
    expect(p.time).toBe('2026/08/14 16:36:57')
    expect(p.rest).toBe(' app started')
  })

  it('redis 日 月名 年 格式 + 前置 PID 前缀', () => {
    const p = parseLogLine('1:C 13 Aug 2026 06:36:46.490 * Ready to accept connections')
    expect(p.prefix).toBe('1:C ')
    expect(p.time).toBe('13 Aug 2026 06:36:46.490')
    expect(p.rest).toContain('Ready to accept connections')
  })

  it('月名 日, 年 格式', () => {
    const p = parseLogLine('Aug 13, 2026 06:36:46 LOG: ready')
    expect(p.time).toBe('Aug 13, 2026 06:36:46')
    expect(p.rest).toContain('ready')
  })

  it('方括号包裹的时间', () => {
    const p = parseLogLine('[2026-08-14 16:36:57] server listen')
    expect(p.prefix).toBe('[')
    expect(p.time).toBe('2026-08-14 16:36:57')
    expect(p.rest).toBe('] server listen')
  })

  it('compose 服务前缀 + 时间', () => {
    const p = parseLogLine('postgres-1  | 2026-08-14 16:36:57.669 UTC [26] LOG: ready')
    expect(p.prefix).toBe('postgres-1  | ')
    expect(p.time).toBe('2026-08-14 16:36:57.669')
    expect(p.rest).toContain('ready')
  })

  it('无时间戳的行原样返回', () => {
    const p = parseLogLine('just a message')
    expect(p.time).toBe('')
    expect(p.prefix).toBe('')
    expect(p.rest).toBe('just a message')
  })
})
