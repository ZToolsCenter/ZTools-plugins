import { describe, it, expect } from 'vitest'
import { tagVersion, pickLatest, dedupeVersions, formatTimestamp, applyDistTags } from '../../src/lib/version-tag'
import type { NpmVersion } from '../../src/lib/types'

const V = (v: string, time = 0): NpmVersion => ({ v, time, status: 'stable', isLatest: false })

describe('tagVersion', () => {
  it('无后缀 → stable', () => {
    expect(tagVersion('1.0.0')).toBe('stable')
    expect(tagVersion('2.7.16')).toBe('stable')
  })
  it('rc → rc', () => {
    expect(tagVersion('3.6.0-rc.4')).toBe('rc')
  })
  it('beta / milestone → beta', () => {
    expect(tagVersion('3.6.0-beta.17')).toBe('beta')
    expect(tagVersion('0.12.0-beta1')).toBe('beta')
  })
  it('alpha → alpha', () => {
    expect(tagVersion('3.6.0-alpha.7')).toBe('alpha')
  })
  it('canary/next/dev/nightly/insiders → dev', () => {
    expect(tagVersion('1.0.0-canary.3')).toBe('dev')
    expect(tagVersion('1.0.0-next.1')).toBe('dev')
    expect(tagVersion('1.0.0-dev.1')).toBe('dev')
    expect(tagVersion('1.0.0-nightly.20240101')).toBe('dev')
  })
  it('+build 元数据中的关键字不参与分类', () => {
    expect(tagVersion('1.0.0+rc.2')).toBe('stable')
    expect(tagVersion('1.0.0+build-rc.1')).toBe('stable')
  })
  it('v 前缀 / 0.0.0 / milestone / rc1 / 大小写', () => {
    expect(tagVersion('v1.2.3')).toBe('stable')
    expect(tagVersion('0.0.0')).toBe('stable')
    expect(tagVersion('1.0.0-milestone-1')).toBe('beta')
    expect(tagVersion('1.0.0-rc1')).toBe('rc')
    expect(tagVersion('1.0.0-BETA.1')).toBe('beta')
  })
  it('develop → dev（前缀碰撞，预期行为）', () => {
    expect(tagVersion('1.0.0-develop.1')).toBe('dev')
  })
})

describe('dedupeVersions', () => {
  it('按 v 去重并合并时间，+build 元数据视为同版本', () => {
    const a = V('1.0.0', 100)
    const b = V('1.0.0+build.2', 200)
    const out = dedupeVersions([a, b])
    expect(out).toHaveLength(1)
    expect(out[0].time).toBe(200)
  })
})

describe('pickLatest', () => {
  it('选 time 最大的版本，无 time 的跳过', () => {
    const list = [V('1.0.0', 0), V('1.1.0', 300), V('1.2.0', 200)]
    expect(pickLatest(list)?.v).toBe('1.1.0')
    expect(pickLatest([V('1.0.0', 0)])).toBeNull()
  })
})

describe('formatTimestamp', () => {
  it('输出 UTC YYYY-MM，无时间用 —', () => {
    expect(formatTimestamp(Date.parse('2024-03-05T00:00:00Z'))).toBe('2024-03')
    expect(formatTimestamp(0)).toBe('—')
  })
})

describe('applyDistTags', () => {
  it('latest 对应的版本标记 isLatest，其余 dist-tag 版本标记 isDistTag', () => {
    const list = [V('3.5.41'), V('3.6.0-beta.17'), V('3.6.0-alpha.7')]
    const out = applyDistTags(list, { latest: '3.5.41', beta: '3.6.0-beta.17' })
    expect(out.find(x => x.v === '3.5.41')?.isLatest).toBe(true)
    expect(out.find(x => x.v === '3.5.41')?.isDistTag).toBe(true)
    expect(out.find(x => x.v === '3.6.0-beta.17')?.isDistTag).toBe(true)
    expect(out.find(x => x.v === '3.6.0-alpha.7')?.isDistTag).toBe(false)
  })
  it('latest 不存在 / 空 dist-tags 时安全', () => {
    expect(applyDistTags([V('1.0.0')], { latest: '9.9.9' })[0].isLatest).toBe(false)
    expect(applyDistTags([V('1.0.0')], {})[0].isDistTag).toBe(false)
  })
  it('dist-tag 值带 +build 元数据也能匹配（与 dedupe 一致）', () => {
    expect(applyDistTags([V('1.0.0')], { latest: '1.0.0+build.5' })[0].isLatest).toBe(true)
  })
})
