import { describe, it, expect } from 'vitest'
import { stateLabel, composeStatusLabel } from '../src/Containers/labels'

describe('stateLabel', () => {
  it('状态转中文', () => {
    expect(stateLabel('running')).toBe('运行中')
    expect(stateLabel('paused')).toBe('已暂停')
    expect(stateLabel('stopped')).toBe('已停止')
    expect(stateLabel('exited')).toBe('已停止')
  })
})

describe('composeStatusLabel', () => {
  it('running(N) 转 运行中(N)', () => {
    expect(composeStatusLabel('running(2)')).toBe('运行中(2)')
    expect(composeStatusLabel('running')).toBe('运行中')
  })
  it('exited/stopped 转 已停止', () => {
    expect(composeStatusLabel('exited(1)')).toBe('已停止(1)')
    expect(composeStatusLabel('stopped')).toBe('已停止')
  })
  it('其他状态原文返回', () => {
    expect(composeStatusLabel('')).toBe('')
    expect(composeStatusLabel('starting')).toBe('starting')
  })
})
