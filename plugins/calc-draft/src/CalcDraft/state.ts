export type Row = { id: string; seq: number; expr: string; subtitle?: string }

export type Page = {
  id: string
  name: string
  rows: Row[]
  createdAt: number
  seqCounter: number
}

export type DraftDoc = {
  pages: Page[]
  activePageId: string
}

export type Workspace = {
  id: string
  name: string
  doc: DraftDoc
  createdAt: number
}

export type WorkspaceManager = {
  workspaces: Workspace[]
  activeWorkspaceId: string
}

export type Action =
  | { type: 'addRow'; pageId: string; rowId: string; expr?: string; afterRowId?: string }
  | { type: 'editRow'; pageId: string; rowId: string; expr: string }
  | { type: 'editSubtitle'; pageId: string; rowId: string; subtitle: string }
  | { type: 'deleteRow'; pageId: string; rowId: string }
  | { type: 'moveRow'; pageId: string; rowId: string; toIndex: number }
  | { type: 'addPage'; pageId: string; name?: string }
  | { type: 'deletePage'; pageId: string }
  | { type: 'renamePage'; pageId: string; name: string }
  | { type: 'setActivePage'; pageId: string }

/** 工作空间级别的 Action（操作 WorkplaceManager） */
export type WorkspaceAction =
  | { type: 'addWorkspace'; workspaceId: string; name?: string }
  | { type: 'deleteWorkspace'; workspaceId: string }
  | { type: 'renameWorkspace'; workspaceId: string; name: string }
  | { type: 'switchWorkspace'; workspaceId: string }
  | { type: 'dispatchToActive'; action: Action }

export const STORAGE_KEY = 'calc-draft:workspaces'
export const LEGACY_STORAGE_KEY = 'calc-draft:doc'

export const PAGE_NAME_MAX = 20

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random())
}

export function createEmptyDoc(): DraftDoc {
  const page: Page = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: '草稿1',
    rows: [],
    createdAt: Date.now(),
    seqCounter: 0
  }
  return { pages: [page], activePageId: page.id }
}

function updatePage(doc: DraftDoc, pageId: string, fn: (page: Page) => Page): DraftDoc {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? fn(p) : p))
  }
}

// 行号引用联动：#N 指向"改动前的第 N 行"，结构变化后按行 id 重写为新行号。
// 行被删除时其位置记为 0（#0 无法解析，展示为"未找到"）。
function refRemap(oldRows: Row[], newRows: Row[]): Map<number, number> {
  const newPosById = new Map(newRows.map((r, i) => [r.id, i + 1] as const))
  const remap = new Map<number, number>()
  oldRows.forEach((r, i) => remap.set(i + 1, newPosById.get(r.id) ?? 0))
  return remap
}

/** 跨草稿 @页序号 引用联动：页删除/重排后按页签 id 重写序号（0 = 页已删除） */
function rewriteAtRefs(expr: string, remap: Map<number, number>): string {
  return expr.replace(/@(\d+)#(\d+)/g, (raw, page: string, row: string) => {
    const next = remap.get(Number(page))
    // 页已删除：保留原引用，求值时报“未找到第 N 个草稿”更直观
    if (next === undefined || next === 0) return raw
    return `@${next}#${row}`
  })
}

function rewriteRefs(expr: string, remap: Map<number, number>): string {
  // @页名#N 是跨草稿引用，不参与本页的行号联动
  return expr.replace(/@([^#\s@]*)#(\d+)|#(\d+)/g, (raw, atPage: string, atNum: string, num: string) => {
    if (atPage !== undefined) return raw
    const next = remap.get(Number(num))
    return next === undefined ? raw : `#${next}`
  })
}

// 跨草稿联动：目标页行序变化时，重写其他页 @页序号#行序号 中的行序（行删除则保留原文，求值时报错可见）
function rewriteAtRowRefs(doc: DraftDoc, changedPageId: string, rowRemap: Map<number, number>): DraftDoc {
  const changedIdx = doc.pages.findIndex((p) => p.id === changedPageId) + 1
  if (changedIdx <= 0 || rowRemap.size === 0) return doc
  return {
    ...doc,
    pages: doc.pages.map((page) => {
      if (page.id === changedPageId) return page
      if (!page.rows.some((r) => /@\d+#/.test(r.expr))) return page
      return {
        ...page,
        rows: page.rows.map((r) =>
          /@\d+#/.test(r.expr)
            ? { ...r, expr: r.expr.replace(/@(\d+)#(\d+)/g, (raw, p: string, row: string) => {
                if (Number(p) !== changedIdx) return raw
                const next = rowRemap.get(Number(row))
                if (next === undefined || next === 0) return raw
                return `@${p}#${next}`
              }) }
            : r
        )
      }
    })
  }
}

function renumberRefs(oldRows: Row[], newRows: Row[]): Row[] {
  if (oldRows.length === 0) return newRows
  const remap = refRemap(oldRows, newRows)
  return newRows.map((r) => {
    if (!/#\d+/.test(r.expr)) return r
    const expr = rewriteRefs(r.expr, remap)
    return expr === r.expr ? r : { ...r, expr }
  })
}

export function docReducer(doc: DraftDoc, action: Action): DraftDoc {
  switch (action.type) {
    case 'addRow': {
      const page = doc.pages.find((p) => p.id === action.pageId)
      if (!page) return doc
      const seqCounter = page.seqCounter + 1
      const row: Row = { id: action.rowId, seq: seqCounter, expr: action.expr ?? '' }
      let rows = [...page.rows]
      if (action.afterRowId) {
        const index = page.rows.findIndex((r) => r.id === action.afterRowId)
        rows.splice(index >= 0 ? index + 1 : rows.length, 0, row)
      } else {
        rows.push(row)
      }
      const remap = refRemap(page.rows, rows)
      const newRows = renumberRefs(page.rows, rows)
      const doc2 = updatePage(doc, action.pageId, (p) => ({ ...p, rows: newRows, seqCounter }))
      return rewriteAtRowRefs(doc2, action.pageId, remap)
    }
    case 'editRow':
      return updatePage(doc, action.pageId, (page) => ({
        ...page,
        rows: page.rows.map((r) => (r.id === action.rowId ? { ...r, expr: action.expr } : r))
      }))
    case 'editSubtitle':
      return updatePage(doc, action.pageId, (page) => ({
        ...page,
        rows: page.rows.map((r) =>
          r.id === action.rowId
            ? { ...r, subtitle: action.subtitle.trim() || undefined }
            : r
        )
      }))
    case 'deleteRow': {
      const page = doc.pages.find((p) => p.id === action.pageId)
      if (!page) return doc
      const remap = refRemap(page.rows, page.rows.filter((r) => r.id !== action.rowId))
      const doc2 = updatePage(doc, action.pageId, (p) => ({
        ...p,
        rows: renumberRefs(page.rows, page.rows.filter((r) => r.id !== action.rowId))
      }))
      return rewriteAtRowRefs(doc2, action.pageId, remap)
    }
    case 'moveRow': {
      const page = doc.pages.find((p) => p.id === action.pageId)
      if (!page) return doc
      const from = page.rows.findIndex((r) => r.id === action.rowId)
      if (from < 0) return doc
      const to = Math.max(0, Math.min(action.toIndex, page.rows.length - 1))
      if (from === to) return doc
      const rows = [...page.rows]
      const [moved] = rows.splice(from, 1)
      rows.splice(to, 0, moved)
      const remap = refRemap(page.rows, rows)
      const doc2 = updatePage(doc, action.pageId, (p) => ({ ...p, rows: renumberRefs(page.rows, rows) }))
      return rewriteAtRowRefs(doc2, action.pageId, remap)
    }
    case 'addPage': {
      const page: Page = {
        id: action.pageId,
        name: action.name ?? `草稿 ${doc.pages.length + 1}`,
        rows: [],
        createdAt: Date.now(),
        seqCounter: 0
      }
      return { pages: [...doc.pages, page], activePageId: page.id }
    }
    case 'deletePage': {
      const idx = doc.pages.findIndex((p) => p.id === action.pageId)
      if (idx < 0) return doc
      if (doc.pages.length === 1) {
        // 仅剩一页：重建一个空页并跳转
        const page: Page = {
          id: genId(),
          name: '草稿1',
          rows: [],
          createdAt: Date.now(),
          seqCounter: 0
        }
        return { pages: [page], activePageId: page.id }
      }
      const pages = doc.pages.filter((p) => p.id !== action.pageId)
      // @页序号 引用绑定页签 id：删除页后重写所有 @ 序号
      const pageRemap = new Map<number, number>()
      doc.pages.forEach((p, i) => {
        const ni = pages.findIndex((np) => np.id === p.id)
        pageRemap.set(i + 1, ni >= 0 ? ni + 1 : 0)
      })
      const pages2 = pages.map((p) => ({
        ...p,
        rows: p.rows.map((r) =>
          /@\d+#/.test(r.expr) ? { ...r, expr: rewriteAtRefs(r.expr, pageRemap) } : r
        )
      }))
      // 优先跳到上一页；删的是第一页则跳到下一页
      const nextActive = pages[idx - 1] ?? pages[idx]
      return { pages: pages2, activePageId: nextActive.id }
    }
    case 'renamePage':
      return updatePage(doc, action.pageId, (page) => {
        const name = action.name.trim().slice(0, PAGE_NAME_MAX)
        return { ...page, name: name || page.name }
      })
    case 'setActivePage':
      return doc.pages.some((p) => p.id === action.pageId)
        ? { ...doc, activePageId: action.pageId }
        : doc
    default:
      return doc
  }
}

function isDraftDoc(value: any): value is DraftDoc {
  return (
    value &&
    Array.isArray(value.pages) &&
    value.pages.length > 0 &&
    typeof value.activePageId === 'string' &&
    value.pages.every(
      (p: any) =>
        p &&
        typeof p.id === 'string' &&
        Array.isArray(p.rows) &&
        typeof p.seqCounter === 'number'
    ) &&
    value.pages.some((p: any) => p.id === value.activePageId)
  )
}

export function loadDoc(raw: string | null): DraftDoc {
  if (!raw) return createEmptyDoc()
  try {
    const parsed = JSON.parse(raw)
    if (isDraftDoc(parsed)) return parsed as DraftDoc
    return createEmptyDoc()
  } catch {
    return createEmptyDoc()
  }
}

export function serializeDoc(doc: DraftDoc): string {
  return JSON.stringify(doc)
}

// ==================== Workspace 管理 ====================

export const WORKSPACE_NAME_MAX = 20

/** 创建空的草稿文档 */
export function createEmptyWorkspaceDoc(): DraftDoc {
  return createEmptyDoc()
}

/** 创建单工作空间的管理器（首次使用或迁移） */
export function createDefaultWorkspaceManager(): WorkspaceManager {
  const workspace: Workspace = {
    id: genId(),
    name: '默认工作空间',
    doc: createEmptyWorkspaceDoc(),
    createdAt: Date.now()
  }
  return {
    workspaces: [workspace],
    activeWorkspaceId: workspace.id
  }
}

/** 从旧版 DraftDoc 迁移到工作空间管理器 */
export function migrateFromLegacyDoc(legacyDoc: DraftDoc): WorkspaceManager {
  const workspace: Workspace = {
    id: genId(),
    name: '我的草稿',
    doc: legacyDoc,
    createdAt: Date.now()
  }
  return {
    workspaces: [workspace],
    activeWorkspaceId: workspace.id
  }
}

/** 工作空间 reducer */
export function workspaceReducer(manager: WorkspaceManager, action: WorkspaceAction): WorkspaceManager {
  switch (action.type) {
    case 'addWorkspace': {
      const workspace: Workspace = {
        id: action.workspaceId,
        name: action.name ?? `工作空间 ${manager.workspaces.length + 1}`,
        doc: createEmptyWorkspaceDoc(),
        createdAt: Date.now()
      }
      return {
        workspaces: [...manager.workspaces, workspace],
        activeWorkspaceId: workspace.id
      }
    }

    case 'deleteWorkspace': {
      if (manager.workspaces.length === 1) {
        // 最后一个工作空间：重置为默认空工作空间
        return createDefaultWorkspaceManager()
      }
      const idx = manager.workspaces.findIndex((w) => w.id === action.workspaceId)
      if (idx < 0) return manager
      const filtered = manager.workspaces.filter((w) => w.id !== action.workspaceId)
      const nextActive =
        manager.activeWorkspaceId === action.workspaceId
          ? (filtered[idx - 1] ?? filtered[idx] ?? filtered[0]).id
          : manager.activeWorkspaceId
      return { workspaces: filtered, activeWorkspaceId: nextActive }
    }

    case 'renameWorkspace': {
      return {
        ...manager,
        workspaces: manager.workspaces.map((w) =>
          w.id === action.workspaceId
            ? { ...w, name: action.name.trim().slice(0, WORKSPACE_NAME_MAX) || w.name }
            : w
        )
      }
    }

    case 'switchWorkspace': {
      return manager.workspaces.some((w) => w.id === action.workspaceId)
        ? { ...manager, activeWorkspaceId: action.workspaceId }
        : manager
    }

    case 'dispatchToActive': {
      return {
        ...manager,
        workspaces: manager.workspaces.map((w) =>
          w.id === manager.activeWorkspaceId
            ? { ...w, doc: docReducer(w.doc, action.action) }
            : w
        )
      }
    }

    default:
      return manager
  }
}

function isWorkspaceManager(value: any): value is WorkspaceManager {
  return (
    value &&
    Array.isArray(value.workspaces) &&
    value.workspaces.length > 0 &&
    typeof value.activeWorkspaceId === 'string' &&
    value.workspaces.every(
      (w: any) =>
        w &&
        typeof w.id === 'string' &&
        typeof w.name === 'string' &&
        w.doc &&
        Array.isArray(w.doc.pages) &&
        typeof w.doc.activePageId === 'string'
    ) &&
    value.workspaces.some((w: any) => w.id === value.activeWorkspaceId)
  )
}

/** 把旧版 @页名#序号或备注 引用迁移为 @页序号#行序号（尽力而为，失败保留原文） */
function migrateAtRefs(doc: DraftDoc): DraftDoc {
  const legacy = /@([^#\d@][^#]*)#([^#\s@]*)/g
  return {
    ...doc,
    pages: doc.pages.map((page) => ({
      ...page,
      rows: page.rows.map((row) => {
        if (!/@[^#\d]/.test(row.expr)) return row
        const expr = row.expr.replace(legacy, (raw, pageName: string, ref: string) => {
          const idx = doc.pages.findIndex((p) => p.name === pageName.trim())
          if (idx < 0) return raw
          const target = doc.pages[idx]
          let rowIdx = -1
          if (/^\d+$/.test(ref)) rowIdx = Number(ref) - 1
          else rowIdx = target.rows.findIndex((r) => r.subtitle === ref)
          if (rowIdx < 0) return raw
          return `@${idx + 1}#${rowIdx + 1}`
        })
        return { ...row, expr }
      })
    }))
  }
}

export function loadWorkspaceManager(raw: string | null): WorkspaceManager {
  if (!raw) return createDefaultWorkspaceManager()
  try {
    const parsed = JSON.parse(raw)
    if (isWorkspaceManager(parsed)) {
      const manager = parsed as WorkspaceManager
      return {
        ...manager,
        workspaces: manager.workspaces.map((w) => ({ ...w, doc: migrateAtRefs(w.doc) }))
      }
    }
    return createDefaultWorkspaceManager()
  } catch {
    return createDefaultWorkspaceManager()
  }
}

export function serializeWorkspaceManager(manager: WorkspaceManager): string {
  return JSON.stringify(manager)
}
