import { describe, expect, it } from 'vitest'
import { parseProjectFileValue, stringifyProjectFile } from '../projectFile'

/** 构造一份最小可解析的工程对象（app/schemaVersion/fabric 为必需字段）。 */
function makeProject(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: 'icon-creator',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvas: { width: 512, height: 512, background: '#ffffff' },
    fabric: { version: '7.3.1', objects: [] },
    layerOrder: [],
    ...extra
  }
}

describe('工程文件的参考线 round-trip 与向后兼容', () => {
  it('旧工程无 guides 字段时解析结果保持缺省（不写回该字段）', () => {
    const { project } = parseProjectFileValue(makeProject())
    expect('guides' in project).toBe(false)
  })

  it('携带 guides 的工程解析后完整还原（含 id / 方向 / 位置）', () => {
    const guides = [
      { id: 'guide-1', orientation: 'horizontal', position: 128 },
      { id: 'guide-2', orientation: 'vertical', position: 64 }
    ]
    const { project } = parseProjectFileValue(makeProject({ guides }))
    expect(project.guides).toEqual(guides)
  })

  it('损坏的 guides 数据自动降级过滤，不阻断工程加载', () => {
    const { project } = parseProjectFileValue(makeProject({
      guides: [
        { id: 'ok', orientation: 'horizontal', position: 10 },
        { orientation: 'diagonal', position: 20 },
        { id: 'bad', orientation: 'vertical', position: 'x' },
        'not-an-object'
      ]
    }))
    expect(project.guides).toEqual([{ id: 'ok', orientation: 'horizontal', position: 10 }])
  })

  it('guides 为空数组时不写回字段，保持旧文件结构不变', () => {
    const { project } = parseProjectFileValue(makeProject({ guides: [] }))
    expect('guides' in project).toBe(false)
  })

  it('stringify → parse 往返保持参考线数据一致（updatedAt 刷新不影响 guides）', () => {
    const guides = [{ id: 'guide-9', orientation: 'vertical', position: 100.5 }]
    const text = stringifyProjectFile(parseProjectFileValue(makeProject({ guides })).project)
    const { project } = parseProjectFileValue(JSON.parse(text))
    expect(project.guides).toEqual(guides)
  })
})
