import { describe, expect, it } from 'vitest'
import {
  extractPublicContent,
  mergeHostsContent,
  normalizeManagedEnvironmentMarkers,
  parseEnvironmentBlocks,
  parseSourceToLines,
  renderLinesToSource,
} from '@/lib/hosts'
import type { Environment } from '@/types/hosts'

describe('hosts helpers', () => {
  it('parses source lines into normalized tab-separated output', () => {
    const content = ['127.0.0.1 foo.test', '# 127.0.0.1 bar.test # disabled', '# note'].join('\n')

    const lines = parseSourceToLines(content)

    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatchObject({ type: 'host', ip: '127.0.0.1', domain: 'foo.test', enabled: true })
    expect(lines[1]).toMatchObject({ type: 'host', ip: '127.0.0.1', domain: 'bar.test', enabled: false, comment: 'disabled' })
    expect(lines[2]).toMatchObject({ type: 'comment', raw: '# note' })
    expect(renderLinesToSource(lines)).toBe([
      '127.0.0.1\tfoo.test',
      '# 127.0.0.1\tbar.test # disabled',
      '# note',
    ].join('\n'))
  })

  it('preserves multiple hostnames on the same line', () => {
    const content = '127.0.0.1 localhost api.dev.com'

    const lines = parseSourceToLines(content)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      type: 'host',
      ip: '127.0.0.1',
      domain: 'localhost api.dev.com',
      enabled: true,
    })
    expect(renderLinesToSource(lines)).toBe('127.0.0.1\tlocalhost api.dev.com')
  })

  it('repairs missing end markers while preserving external sections', () => {
    const content = [
      '127.0.0.1 localhost',
      '#-------- 开发配置 --------',
      '127.0.0.1 dev.local',
      '# TailscaleHostsSectionStart',
      '100.64.0.1 tail.local',
      '# TailscaleHostsSectionEnd',
    ].join('\n')

    expect(normalizeManagedEnvironmentMarkers(content)).toBe([
      '127.0.0.1 localhost',
      '#-------- 开发配置 --------',
      '127.0.0.1 dev.local',
      '#-------- 开发配置 结束 --------',
      '# TailscaleHostsSectionStart',
      '100.64.0.1 tail.local',
      '# TailscaleHostsSectionEnd',
    ].join('\n'))
  })

  it('extracts public content and merges active environments while preserving comments', () => {
    const original = [
      '127.0.0.1 localhost',
      '# TailscaleHostsSectionStart',
      '100.64.0.1 tail.local',
      '# TailscaleHostsSectionEnd',
    ].join('\n')

    const environments: Environment[] = [
      {
        id: 'env-dev',
        name: '开发配置',
        type: 'custom',
        enabled: true,
        editMode: 'source',
        header: '#-------- 开发配置 --------',
        endMarker: '#-------- 开发配置 结束 --------',
        updatedAt: '2026-04-15T00:00:00.000Z',
        lines: parseSourceToLines('127.0.0.1 dev.local\n# 单行注释\n# 127.0.0.1 dev-disabled.local'),
      },
      {
        id: 'env-test',
        name: '测试配置',
        type: 'custom',
        enabled: true,
        editMode: 'source',
        header: '#-------- 测试配置 --------',
        endMarker: '#-------- 测试配置 结束 --------',
        updatedAt: '2026-04-15T00:00:00.000Z',
        lines: parseSourceToLines('127.0.0.1 test.local'),
      },
    ]

    expect(extractPublicContent(original)).toBe([
      '127.0.0.1\tlocalhost',
      '# TailscaleHostsSectionStart',
      '100.64.0.1\ttail.local',
      '# TailscaleHostsSectionEnd',
    ].join('\n'))
    expect(mergeHostsContent(original, environments)).toBe([
      '127.0.0.1\tlocalhost',
      '# TailscaleHostsSectionStart',
      '100.64.0.1\ttail.local',
      '# TailscaleHostsSectionEnd',
      '',
      '#-------- 开发配置 --------',
      '127.0.0.1\tdev.local',
      '# 单行注释',
      '# 127.0.0.1\tdev-disabled.local',
      '#-------- 开发配置 结束 --------',
      '#-------- 测试配置 --------',
      '127.0.0.1\ttest.local',
      '#-------- 测试配置 结束 --------',
      '',
    ].join('\n'))
  })

  it('parses managed blocks into public and custom environments', () => {
    const content = [
      '127.0.0.1 localhost',
      '#-------- 开发配置 --------',
      '127.0.0.1 dev.local',
      '#-------- 开发配置 结束 --------',
    ].join('\n')

    const blocks = parseEnvironmentBlocks(content)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'public', name: 'hosts 文件' })
    expect(blocks[1]).toMatchObject({ type: 'custom', name: '开发配置', header: '#-------- 开发配置 --------' })
  })
})
