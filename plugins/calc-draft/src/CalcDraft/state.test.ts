import { describe, it, expect } from 'vitest'
import {
  createDefaultWorkspaceManager,
  createEmptyDoc,
  docReducer,
  loadDoc,
  loadWorkspaceManager,
  migrateFromLegacyDoc,
  serializeDoc,
  serializeWorkspaceManager,
  workspaceReducer,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  type DraftDoc
} from './state'
import { colorForSeq, PALETTE } from './palette'

function docWithRows(): DraftDoc {
  let doc = createEmptyDoc()
  const pageId = doc.activePageId
  doc = docReducer(doc, { type: 'addRow', pageId, rowId: 'r1', expr: '1' })
  doc = docReducer(doc, { type: 'addRow', pageId, rowId: 'r2', expr: '2' })
  doc = docReducer(doc, { type: 'addRow', pageId, rowId: 'r3', expr: '3' })
  return doc
}

describe('docReducer rows', () => {
  it('addRow 按创建顺序分配 seq', () => {
    const doc = docWithRows()
    const rows = doc.pages[0].rows
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3])
    expect(doc.pages[0].seqCounter).toBe(3)
  })

  it('删除最大 seq 行后再添加，seq 不复用', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'deleteRow', pageId: doc.activePageId, rowId: 'r3' })
    doc = docReducer(doc, { type: 'addRow', pageId: doc.activePageId, rowId: 'r4', expr: '9' })
    const rows = doc.pages[0].rows
    expect(rows.find((r) => r.id === 'r4')!.seq).toBe(4)
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 4])
  })

  it('删除中间行不影响其他 seq', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'deleteRow', pageId: doc.activePageId, rowId: 'r2' })
    const rows = doc.pages[0].rows
    expect(rows.map((r) => r.seq)).toEqual([1, 3])
  })

  it('moveRow 只改顺序不改 seq', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'moveRow', pageId: doc.activePageId, rowId: 'r3', toIndex: 0 })
    const rows = doc.pages[0].rows
    expect(rows.map((r) => r.id)).toEqual(['r3', 'r1', 'r2'])
    expect(rows.map((r) => r.seq)).toEqual([3, 1, 2])
  })

  it('editSubtitle 设置与清空备注', () => {
    let doc = docWithRows()
    const pid = doc.activePageId
    doc = docReducer(doc, { type: 'editSubtitle', pageId: pid, rowId: 'r2', subtitle: ' 家电预算 ' })
    expect(doc.pages[0].rows.find((r) => r.id === 'r2')!.subtitle).toBe('家电预算')
    doc = docReducer(doc, { type: 'editSubtitle', pageId: pid, rowId: 'r2', subtitle: '   ' })
    expect(doc.pages[0].rows.find((r) => r.id === 'r2')!.subtitle).toBeUndefined()
  })

  it('editRow 只改 expr', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r1', expr: '42' })
    expect(doc.pages[0].rows[0]).toEqual({ id: 'r1', seq: 1, expr: '42' })
  })
})

describe('行号引用联动（#N 指向当前行号）', () => {
  const expr = (id: string, n: number) => `${id}#${n}` // 便于断言引用文本

  it('在引用行之前插入，引用整体后移', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r3', expr: '#2 * 2' })
    // 在第 2 行（r2）之前插入新行：r2 变 #3，引用 #2 应改写为 #3
    doc = docReducer(doc, {
      type: 'addRow',
      pageId: doc.activePageId,
      rowId: 'r0',
      expr: '',
      afterRowId: 'r1'
    })
    expect(doc.pages[0].rows.find((r) => r.id === 'r3')!.expr).toBe('#3 * 2')
  })

  it('在被引用行之前插入后求值仍指向同一行 id', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r3', expr: '#2 + 0' })
    doc = docReducer(doc, {
      type: 'addRow',
      pageId: doc.activePageId,
      rowId: 'r0',
      expr: '',
      afterRowId: 'r1'
    })
    // r2 原是 #2，插入后是 #3；r3 的引用应已改写为 #3
    expect(doc.pages[0].rows.map((r) => r.expr)).toEqual(['1', '', '2', '#3 + 0'])
  })

  it('删除被引用行，引用失效为 #0；其余引用前移', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r3', expr: '#1 + #2' })
    doc = docReducer(doc, { type: 'deleteRow', pageId: doc.activePageId, rowId: 'r2' })
    expect(doc.pages[0].rows.find((r) => r.id === 'r3')!.expr).toBe('#1 + #0')
  })

  it('拖拽换位后引用跟随行移动', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r3', expr: '#1 * #2' })
    // r3 移到最前：r1 从 #1 变 #2，r2 从 #2 变 #3
    doc = docReducer(doc, { type: 'moveRow', pageId: doc.activePageId, rowId: 'r3', toIndex: 0 })
    expect(doc.pages[0].rows.find((r) => r.id === 'r3')!.expr).toBe('#2 * #3')
  })

  it('悬空引用（超出行数）保持原样', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r1', expr: '#9 + 1' })
    doc = docReducer(doc, { type: 'addRow', pageId: doc.activePageId, rowId: 'r4', expr: '' })
    expect(doc.pages[0].rows.find((r) => r.id === 'r1')!.expr).toBe('#9 + 1')
  })

  it('数字中的 # 只改引用 token，不动普通数字', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r3', expr: '12 + #1' })
    // r3 移到最前：#1 指向的 r1 从 #1 变 #2，前导数字 12 不受影响
    doc = docReducer(doc, { type: 'moveRow', pageId: doc.activePageId, rowId: 'r3', toIndex: 0 })
    expect(doc.pages[0].rows.find((r) => r.id === 'r3')!.expr).toBe('12 + #2')
  })
})

describe('docReducer pages', () => {
  it('addPage 新建页并激活', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'addPage', pageId: 'p2', name: '第二页' })
    expect(doc.pages).toHaveLength(2)
    expect(doc.activePageId).toBe('p2')
  })

  it('deletePage 切到相邻页', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'addPage', pageId: 'p2', name: '第二页' })
    doc = docReducer(doc, { type: 'deletePage', pageId: doc.activePageId })
    expect(doc.pages).toHaveLength(1)
    expect(doc.activePageId).toBe(doc.pages[0].id)
  })

  it('删除最后一个草稿：重建空页并跳转', () => {
    let doc = createEmptyDoc()
    const oldId = doc.activePageId
    doc = docReducer(doc, { type: 'deletePage', pageId: doc.activePageId })
    expect(doc.pages).toHaveLength(1)
    expect(doc.activePageId).not.toBe(oldId)
    expect(doc.pages[0].rows).toEqual([])
  })

  it('删除中间页跳到上一页，删除第一页跳到下一页', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'addPage', pageId: 'p2', name: '第二页' })
    doc = docReducer(doc, { type: 'addPage', pageId: 'p3', name: '第三页' })
    // 删除中间页 p2 → 跳到上一页 p1
    doc = docReducer(doc, { type: 'deletePage', pageId: 'p2' })
    expect(doc.activePageId).toBe(doc.pages[0].id)
    // 再删除第一页 p1 → 跳到下一页 p3
    doc = docReducer(doc, { type: 'deletePage', pageId: doc.pages[0].id })
    expect(doc.activePageId).toBe('p3')
  })

  it('renamePage 改名', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'renamePage', pageId: doc.activePageId, name: '工资' })
    expect(doc.pages[0].name).toBe('工资')
  })

  it('renamePage 截断超长标题，空名不生效', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'renamePage', pageId: doc.activePageId, name: '字'.repeat(30) })
    expect(doc.pages[0].name).toBe('字'.repeat(20))
    doc = docReducer(doc, { type: 'renamePage', pageId: doc.activePageId, name: '   ' })
    expect(doc.pages[0].name).toBe('字'.repeat(20))
  })

  it('setActivePage 切页', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'addPage', pageId: 'p2', name: 'x' })
    doc = docReducer(doc, { type: 'setActivePage', pageId: doc.pages[0].id })
    expect(doc.activePageId).toBe(doc.pages[0].id)
  })
})

describe('持久化', () => {
  it('serialize/load 往返', () => {
    const doc = docWithRows()
    const restored = loadDoc(serializeDoc(doc))
    expect(restored).toEqual(doc)
  })

  it('null → 空文档', () => {
    const doc = loadDoc(null)
    expect(doc.pages).toHaveLength(1)
    expect(doc.pages[0].rows).toEqual([])
  })

  it('损坏 JSON → 空文档不抛异常（Review Focus #4）', () => {
    const doc = loadDoc('{not json')
    expect(doc.pages).toHaveLength(1)
    expect(doc.activePageId).toBe(doc.pages[0].id)
  })

  it('结构非法（缺 pages）→ 空文档', () => {
    const doc = loadDoc('{"foo":1}')
    expect(doc.pages).toHaveLength(1)
  })

  it('STORAGE_KEY 固定', () => {
    expect(STORAGE_KEY).toBe('calc-draft:workspaces')
    expect(LEGACY_STORAGE_KEY).toBe('calc-draft:doc')
  })
})

describe('workspaceReducer', () => {
  it('addWorkspace 新建工作空间并激活', () => {
    const initial = createDefaultWorkspaceManager()
    const action = { type: 'addWorkspace' as const, workspaceId: 'ws-2' }
    const next = workspaceReducer(initial, action)
    expect(next.workspaces).toHaveLength(2)
    expect(next.activeWorkspaceId).toBe('ws-2')
    expect(next.workspaces[1].name).toBe('工作空间 2')
  })

  it('deleteWorkspace 删除并切换到相邻工作空间', () => {
    let manager = createDefaultWorkspaceManager()
    const ws2Id = 'ws-2'
    manager = workspaceReducer(manager, { type: 'addWorkspace', workspaceId: ws2Id })
    expect(manager.workspaces).toHaveLength(2)
    manager = workspaceReducer(manager, { type: 'deleteWorkspace', workspaceId: manager.activeWorkspaceId })
    expect(manager.workspaces).toHaveLength(1)
    expect(manager.activeWorkspaceId).toBe(manager.workspaces[0].id)
  })

  it('deleteWorkspace 最后一个工作空间会重置为默认', () => {
    let manager = createDefaultWorkspaceManager()
    manager = workspaceReducer(manager, { type: 'deleteWorkspace', workspaceId: manager.workspaces[0].id })
    expect(manager.workspaces).toHaveLength(1)
    expect(manager.workspaces[0].name).toBe('默认工作空间')
  })

  it('renameWorkspace 重命名', () => {
    let manager = createDefaultWorkspaceManager()
    const wsId = manager.workspaces[0].id
    manager = workspaceReducer(manager, { type: 'renameWorkspace', workspaceId: wsId, name: '项目A' })
    expect(manager.workspaces[0].name).toBe('项目A')
  })

  it('switchWorkspace 切换活动工作空间', () => {
    let manager = createDefaultWorkspaceManager()
    manager = workspaceReducer(manager, { type: 'addWorkspace', workspaceId: 'ws-2' })
    const firstId = manager.workspaces[0].id
    manager = workspaceReducer(manager, { type: 'switchWorkspace', workspaceId: firstId })
    expect(manager.activeWorkspaceId).toBe(firstId)
  })

  it('dispatchToActive 只影响当前工作空间', () => {
    let manager = createDefaultWorkspaceManager()
    const firstWsId = manager.workspaces[0].id
    manager = workspaceReducer(manager, { type: 'addWorkspace', workspaceId: 'ws-2' })
    // 切换回第一个工作空间
    manager = workspaceReducer(manager, { type: 'switchWorkspace', workspaceId: firstWsId })
    const rowTestId = 'row-test-1'
    manager = workspaceReducer(manager, {
      type: 'dispatchToActive',
      action: { type: 'addRow', pageId: manager.workspaces[0].doc.activePageId, rowId: rowTestId, expr: '1+1' }
    })
    expect(manager.workspaces[0].doc.pages[0].rows).toHaveLength(1)
    expect(manager.workspaces[1].doc.pages[0].rows).toHaveLength(0)
  })

  it('migrateFromLegacyDoc 将旧文档迁移到新工作空间', () => {
    const legacyDoc = createEmptyDoc()
    const manager = migrateFromLegacyDoc(legacyDoc)
    expect(manager.workspaces).toHaveLength(1)
    expect(manager.workspaces[0].name).toBe('我的草稿')
    expect(manager.workspaces[0].doc).toBe(legacyDoc)
  })

  it('serialize/loadWorkspaceManager 往返', () => {
    let manager = createDefaultWorkspaceManager()
    manager = workspaceReducer(manager, { type: 'addWorkspace', workspaceId: 'ws-2', name: '第二空间' })
    const raw = serializeWorkspaceManager(manager)
    const loaded = loadWorkspaceManager(raw)
    expect(loaded.workspaces).toHaveLength(2)
    expect(loaded.workspaces[1].name).toBe('第二空间')
  })

  it('loadWorkspaceManager 损坏 JSON 时不抛异常', () => {
    const loaded = loadWorkspaceManager('{invalid json')
    expect(loaded.workspaces).toHaveLength(1)
    expect(loaded.workspaces[0].name).toBe('默认工作空间')
  })
})

describe('colorForSeq', () => {
  it('同 seq 颜色稳定', () => {
    expect(colorForSeq(1)).toBe(colorForSeq(1))
  })

  it('超出调色板长度循环', () => {
    expect(colorForSeq(PALETTE.length + 1)).toBe(colorForSeq(1))
  })
})
