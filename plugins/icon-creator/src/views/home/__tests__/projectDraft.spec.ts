import { describe, expect, it } from 'vitest'
import {
  buildDraftWriteCandidates,
  buildLegacyDraftWriteCandidates,
  decodeProjectDraft,
  encodeProjectDraft,
  LEGACY_DRAFT_TAB_ID,
  stripProjectArtboardThumbnails,
  stripProjectCanvasSnapshots,
  upgradeLegacyProjectDraft
} from '../projectDraft'
import type { IconCreatorDraftFile, IconCreatorProjectFile } from '../types'
import type { ProjectDraftTab } from '../projectDraft'

// 构造最小可用的工程对象：字段与 parseProjectFileValue 归一化结果对齐，
// 便于 round-trip 断言时直接 toEqual 比较而不受默认值补全影响。
function createProject(overrides: Partial<IconCreatorProjectFile> = {}): IconCreatorProjectFile {
  return {
    app: 'icon-creator',
    schemaVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    canvas: {
      width: 512,
      height: 512,
      background: '#ffffff',
      gridSize: 8,
      showPixelGrid: false,
      snapToPixelGrid: false,
      brushSize: 1,
      keylineTemplate: 'none',
      keylineMargin: 48,
      keylineOpacity: 1
    },
    fabric: { version: '6.7.0', objects: [{ type: 'rect' }] },
    layerOrder: [],
    ...overrides
  }
}

// 构造多标签草稿：两个标签（含激活态、保存路径、dirty 与视口元数据）+ 可裁剪的大字段。
function createDraft() {
  const tabAProject = createProject({
    meta: { swatches: [], stylePresets: [], snapshots: [{ name: '快照1', createdAt: 1, canvasJson: { objects: [] } }] },
    artboards: [
      { id: 'a1', name: '画板 1', canvas: createProject().canvas, fabric: { objects: [] }, layerOrder: [], thumbnail: 'data:image/png;base64,AAAA' },
      { id: 'a2', name: '画板 2', canvas: createProject().canvas, fabric: { objects: [] }, layerOrder: [] }
    ]
  })
  const tabBProject = createProject({ canvas: { ...createProject().canvas, width: 256, height: 256 } })
  const tabs: ProjectDraftTab[] = [
    { tabId: 'tab-a', title: '项目 1', project: tabAProject, viewMode: 'svg', svgPreviewMode: 'code', zoom: 2, panX: 10, panY: -10 },
    { tabId: 'tab-b', title: '项目 2', project: tabBProject, dirty: true, savedFilePath: 'D:/work/a.iconcreator.json' }
  ]
  return {
    draft: encodeProjectDraft({ activeTabId: 'tab-b', tabs, updatedAt: '2026-09-06T00:00:00.000Z' }),
    tabAProject,
    tabBProject
  }
}

describe('encodeProjectDraft / decodeProjectDraft round-trip', () => {
  it('新结构序列化往返保留标签列表、顺序、激活态与每标签元数据', () => {
    const { draft, tabAProject, tabBProject } = createDraft()
    expect(draft.draftVersion).toBe(2)
    expect(draft.schemaVersion).toBe(1)

    // 模拟 localStorage 往返（JSON 序列化 + 反序列化）后解码
    const decoded = decodeProjectDraft(JSON.parse(JSON.stringify(draft)))
    expect(decoded).not.toBeNull()
    expect(decoded!.activeTabId).toBe('tab-b')
    expect(decoded!.updatedAt).toBe('2026-09-06T00:00:00.000Z')
    expect(decoded!.tabs.map((tab) => tab.tabId)).toEqual(['tab-a', 'tab-b'])
    expect(decoded!.tabs.map((tab) => tab.title)).toEqual(['项目 1', '项目 2'])

    const [tabA, tabB] = decoded!.tabs
    // 工程 JSON 走 parseProjectFileValue 归一化后与输入保持一致
    expect(tabA.project).toEqual(tabAProject)
    expect(tabB.project).toEqual(tabBProject)
    // 标签级元数据完整保留：dirty、保存路径与视口 / 视图模式
    expect(tabA.dirty).toBeUndefined()
    expect(tabB.dirty).toBe(true)
    expect(tabB.savedFilePath).toBe('D:/work/a.iconcreator.json')
    expect(tabA.viewMode).toBe('svg')
    expect(tabA.svgPreviewMode).toBe('code')
    expect(tabA.zoom).toBe(2)
    expect(tabA.panX).toBe(10)
    expect(tabA.panY).toBe(-10)
  })

  it('activeTabId 缺失或失效时回退第一个标签', () => {
    const { draft } = createDraft()
    const missing = decodeProjectDraft({ ...draft, activeTabId: '' })
    expect(missing!.activeTabId).toBe('tab-a')
    const unknown = decodeProjectDraft({ ...draft, activeTabId: 'tab-x' })
    expect(unknown!.activeTabId).toBe('tab-a')
  })
})

describe('decodeProjectDraft 旧结构兼容', () => {
  it('旧版单标签草稿（无 tabs 字段）升级为单标签新结构', () => {
    const project = createProject()
    const legacy: IconCreatorDraftFile = {
      app: 'icon-creator',
      schemaVersion: 1,
      updatedAt: '2025-12-31T00:00:00.000Z',
      project
    }
    const decoded = decodeProjectDraft(JSON.parse(JSON.stringify(legacy)))
    expect(decoded).not.toBeNull()
    expect(decoded!.tabs).toHaveLength(1)
    expect(decoded!.tabs[0].tabId).toBe(LEGACY_DRAFT_TAB_ID)
    expect(decoded!.tabs[0].title).toBe('项目 1')
    expect(decoded!.activeTabId).toBe(LEGACY_DRAFT_TAB_ID)
    expect(decoded!.tabs[0].project).toEqual(project)
    expect(decoded!.updatedAt).toBe('2025-12-31T00:00:00.000Z')
  })

  it('upgradeLegacyProjectDraft 对同一份旧草稿可重复解码出相同结果，project 非法时返回 null', () => {
    const project = createProject()
    const first = upgradeLegacyProjectDraft(project, '2025-12-31T00:00:00.000Z')
    const second = upgradeLegacyProjectDraft(project, '2025-12-31T00:00:00.000Z')
    expect(first).toEqual(second)
    expect(upgradeLegacyProjectDraft({ app: 'other' })).toBeNull()
  })
})

describe('decodeProjectDraft 非法输入', () => {
  it('非对象、无 tabs 且无 project、空 tabs 均返回 null', () => {
    expect(decodeProjectDraft(null)).toBeNull()
    expect(decodeProjectDraft('draft')).toBeNull()
    expect(decodeProjectDraft([])).toBeNull()
    expect(decodeProjectDraft({})).toBeNull()
    expect(decodeProjectDraft({ tabs: [] })).toBeNull()
    expect(decodeProjectDraft({ tabs: 'nope' })).toBeNull()
    expect(decodeProjectDraft({ tabs: [{ tabId: 'a', title: 'A' }] })).toBeNull()
  })

  it('非法标签条目跳过、重复 tabId 去重（保留先出现者）', () => {
    const valid = { tabId: 'tab-a', title: 'A', project: createProject() }
    const decoded = decodeProjectDraft({
      activeTabId: 'tab-a',
      tabs: ['bad', null, { tabId: 'tab-b', title: 'B', project: { broken: true } }, valid, { ...valid, title: 'A2' }]
    })
    expect(decoded).not.toBeNull()
    expect(decoded!.tabs.map((tab) => tab.tabId)).toEqual(['tab-a'])
    expect(decoded!.tabs[0].title).toBe('A')
  })

  it('标签标题缺省回退“未命名项目”，非法 tabId 自动生成稳定 id', () => {
    const decoded = decodeProjectDraft({ tabs: [{ project: createProject() }] })
    expect(decoded!.tabs[0].tabId).toBe('project-tab-restored-1')
    expect(decoded!.tabs[0].title).toBe('未命名项目')
    expect(decoded!.activeTabId).toBe('project-tab-restored-1')
  })
})

describe('buildDraftWriteCandidates 配额降级链', () => {
  it('按 全量 → 去命名快照 → 去画板缩略图 → 去视口元数据 逐级累计裁剪', () => {
    const { draft } = createDraft()
    const candidates = buildDraftWriteCandidates(draft)
    expect(candidates).toHaveLength(4)

    // 级别 0：全量
    expect(candidates[0]).toBe(draft)

    // 级别 1：去掉命名画布快照，其余数据保持
    const level1 = candidates[1].tabs[0].project
    expect(level1.meta?.snapshots).toBeUndefined()
    expect(level1.meta?.swatches).toEqual([])
    expect(level1.artboards?.[0].thumbnail).toBe('data:image/png;base64,AAAA')
    expect(candidates[1].tabs[0].zoom).toBe(2)

    // 级别 2：累计去掉画板缩略图（无缩略图的画板对象保持原引用）
    const level2 = candidates[2].tabs[0].project
    expect(level2.meta?.snapshots).toBeUndefined()
    expect(level2.artboards?.[0].thumbnail).toBeUndefined()
    expect(level2.artboards?.[1]).toBe(candidates[1].tabs[0].project.artboards?.[1])
    expect(candidates[2].tabs[0].savedFilePath).toBeUndefined()
    expect(candidates[2].tabs[1].savedFilePath).toBe('D:/work/a.iconcreator.json')

    // 级别 3：再去掉视口 / 视图次要元数据，标签核心字段保留
    const level3Tab = candidates[3].tabs[0]
    expect(level3Tab.viewMode).toBeUndefined()
    expect(level3Tab.svgPreviewMode).toBeUndefined()
    expect(level3Tab.zoom).toBeUndefined()
    expect(level3Tab.panX).toBeUndefined()
    expect(level3Tab.panY).toBeUndefined()
    expect(level3Tab.tabId).toBe('tab-a')
    expect(level3Tab.title).toBe('项目 1')
    expect(level3Tab.project.fabric).toBeDefined()
  })

  it('裁剪不改动传入草稿与共享的标签内存工程对象', () => {
    const { draft, tabAProject } = createDraft()
    const snapshot = JSON.parse(JSON.stringify(draft))
    buildDraftWriteCandidates(draft)
    expect(JSON.parse(JSON.stringify(draft))).toEqual(snapshot)
    expect(tabAProject.meta?.snapshots).toHaveLength(1)
    expect(tabAProject.artboards?.[0].thumbnail).toBe('data:image/png;base64,AAAA')
  })

  it('无可裁剪字段时各级候选不产生多余的路径拷贝（保持原引用）', () => {
    const project = createProject()
    const draft = encodeProjectDraft({
      activeTabId: 'tab-a',
      tabs: [{ tabId: 'tab-a', title: 'A', project }],
      updatedAt: '2026-09-06T00:00:00.000Z'
    })
    const candidates = buildDraftWriteCandidates(draft)
    expect(candidates[0].tabs[0].project).toBe(project)
    expect(candidates[1].tabs[0].project).toBe(project)
    expect(candidates[2].tabs[0].project).toBe(project)
    expect(candidates[3].tabs[0].project).toBe(project)
  })
})

describe('buildLegacyDraftWriteCandidates 旧结构降级链', () => {
  it('依次去命名快照、去画板缩略图，共三级', () => {
    const draft: IconCreatorDraftFile = {
      app: 'icon-creator',
      schemaVersion: 1,
      updatedAt: '2026-09-06T00:00:00.000Z',
      project: createProject({
        meta: { swatches: [], stylePresets: [], snapshots: [{ name: '快照1', createdAt: 1, canvasJson: {} }] },
        artboards: [
          { id: 'a1', name: '画板 1', canvas: createProject().canvas, fabric: { objects: [] }, layerOrder: [], thumbnail: 'data:image/png;base64,BBBB' }
        ]
      })
    }
    const candidates = buildLegacyDraftWriteCandidates(draft)
    expect(candidates).toHaveLength(3)
    expect(candidates[0]).toBe(draft)
    expect(candidates[1].project.meta?.snapshots).toBeUndefined()
    expect(candidates[1].project.artboards?.[0].thumbnail).toBe('data:image/png;base64,BBBB')
    expect(candidates[2].project.artboards?.[0].thumbnail).toBeUndefined()
    // 原草稿不被改动
    expect(draft.project.meta?.snapshots).toHaveLength(1)
  })
})

describe('工程级裁剪辅助函数', () => {
  it('stripProjectCanvasSnapshots / stripProjectArtboardThumbnails 无可裁剪数据时原样返回', () => {
    const project = createProject()
    expect(stripProjectCanvasSnapshots(project)).toBe(project)
    expect(stripProjectArtboardThumbnails(project)).toBe(project)
    const withMeta = createProject({ meta: { swatches: [{ name: '红', color: '#ff0000' }], stylePresets: [] } })
    expect(stripProjectCanvasSnapshots(withMeta)).toBe(withMeta)
  })
})
