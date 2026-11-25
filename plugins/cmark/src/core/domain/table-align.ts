/**
 * 表格列对齐的读写（GFM 的 :--- / :---: / ---:）
 *
 * 为什么需要这一层：@platejs/markdown 的表格规则不认对齐 —— 反序列化时把分隔行
 * 里的冒号丢掉，序列化时又统一写成 ---。结果是「对齐改了、切个文件再回来就还原」，
 * 因为 table 节点的 align 从来没有进出过 markdown。
 *
 * 这里只在 markdown 字符串和节点树之间搬一次，不碰 remark：
 *   读：解析 md 里每个表格的分隔行 → 回填到 table 节点（以及每个单元格）
 *   写：按 table 节点上的 align 重写 md 里每个表格的分隔行
 *
 * 配对按文档出现顺序（第 n 个表格 ↔ 第 n 个 table 节点），围栏代码块里的表格不算。
 */

export type ColAlign = 'left' | 'center' | 'right'

type AnyNode = {
  type?: string
  align?: unknown
  children?: AnyNode[]
  [k: string]: unknown
}

const NL = String.fromCharCode(10)

function isFence(line: string): boolean {
  const t = line.trim()
  return t.startsWith('```') || t.startsWith('~~~')
}

/** 去掉行首尾的竖线 */
function stripPipes(line: string): string {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t
}

/** 一行表格 → 单元格文本数组 */
function splitRow(line: string): string[] {
  return stripPipes(line)
    .split('|')
    .map((c) => c.trim())
}

/** 分隔行里的单元格是否是 --- / :--- / :---: / ---: */
function isDelimCell(t: string): boolean {
  let s = t
  if (s.startsWith(':')) s = s.slice(1)
  if (s.endsWith(':')) s = s.slice(0, -1)
  if (!s.length) return false
  for (let i = 0; i < s.length; i++) if (s[i] !== '-') return false
  return true
}

/** 找 md 里所有表格块的行索引区间（[start, end)），跳过围栏代码块 */
function findTables(lines: string[]): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = []
  let inFence = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isFence(line)) {
      inFence = !inFence
      i++
      continue
    }
    if (!inFence && line.trim().startsWith('|')) {
      const start = i
      let j = i
      while (j < lines.length && lines[j].trim().startsWith('|')) j++
      if (j - start >= 2) out.push({ start, end: j })
      i = j
    } else {
      i++
    }
  }
  return out
}

function parseDelim(line: string): Array<ColAlign | null> {
  return splitRow(line).map((t) => {
    if (!isDelimCell(t)) return null
    const l = t.startsWith(':')
    const r = t.endsWith(':')
    if (l && r) return 'center'
    if (r) return 'right'
    if (l) return 'left'
    return null
  })
}

function buildDelim(aligns: Array<ColAlign | null | unknown>, cols: number): string {
  const cells: string[] = []
  for (let i = 0; i < cols; i++) {
    const a = aligns[i]
    if (a === 'center') cells.push(':---:')
    else if (a === 'right') cells.push('---:')
    else if (a === 'left') cells.push(':---')
    else cells.push('---')
  }
  return '| ' + cells.join(' | ') + ' |'
}

/** 从 markdown 里按出现顺序取出每个表格的列对齐 */
export function extractTableAligns(md: string): Array<Array<ColAlign | null>> {
  const lines = String(md || '').split(NL)
  return findTables(lines).map(({ start }) => {
    const cols = splitRow(lines[start] || '').length
    const parsed = parseDelim(lines[start + 1] || '')
    const out: Array<ColAlign | null> = []
    for (let i = 0; i < cols; i++) out.push(parsed[i] ?? null)
    return out
  })
}

/** 按文档顺序收集节点树里每个 table 节点的 align */
export function collectTableAligns(value: unknown[]): Array<Array<ColAlign | null>> {
  const out: Array<Array<ColAlign | null>> = []
  const walk = (nodes: AnyNode[] | undefined) => {
    if (!Array.isArray(nodes)) return
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue
      if (n.type === 'table') {
        const arr = Array.isArray(n.align) ? n.align : []
        out.push(arr.map((x) => (x === 'left' || x === 'center' || x === 'right' ? x : null)))
      }
      if (Array.isArray(n.children)) walk(n.children)
    }
  }
  walk(value as AnyNode[])
  return out
}

/** 把 align 回填到 table 节点和它的每个单元格上（就地修改） */
export function fillTableAligns(value: unknown[], aligns: Array<Array<ColAlign | null>>): void {
  if (!Array.isArray(aligns) || !aligns.length) return
  let idx = 0
  const walk = (nodes: AnyNode[] | undefined) => {
    if (!Array.isArray(nodes)) return
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue
      if (n.type === 'table') {
        const a = aligns[idx++]
        if (a && a.some((x) => x)) {
          n.align = a.map((x) => x ?? null)
          // 渲染层（TableCellElement）读的是 cell.align，只写 table.align 数据对但界面看不出来
          const rows = Array.isArray(n.children) ? (n.children as AnyNode[]) : []
          for (const row of rows) {
            const cells = Array.isArray(row.children) ? (row.children as AnyNode[]) : []
            cells.forEach((cell, ci) => {
              const v = a[ci]
              if (v) cell.align = v
              else delete cell.align
            })
          }
        }
      }
      if (Array.isArray(n.children)) walk(n.children)
    }
  }
  walk(value as AnyNode[])
}

/** 用 align 数据重写 markdown 里每个表格的分隔行 */
export function applyTableAligns(md: string, aligns: Array<Array<ColAlign | null>>): string {
  if (!Array.isArray(aligns) || !aligns.length) return md
  const lines = String(md || '').split(NL)
  const tables = findTables(lines)
  let changed = false
  tables.forEach(({ start }, i) => {
    const a = aligns[i]
    if (!a) return
    // 该表格没有任何对齐时保持原样，别把手写的分隔行改掉
    if (!a.some((x) => x)) return
    const cols = splitRow(lines[start] || '').length
    if (!cols) return
    lines[start + 1] = buildDelim(a, cols)
    changed = true
  })
  return changed ? lines.join(NL) : md
}
