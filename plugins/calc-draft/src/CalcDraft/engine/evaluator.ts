import jsep from 'jsep'
import { parseExpression, type AtRef } from './parser'

export type CellResult =
  | { status: 'ok'; value: number }
  | { status: 'error'; message: string }
  | { status: 'empty' }

export type EvalRow = { id: string; seq: number; expr: string; subtitle?: string }

export type PageEvaluation = {
  results: Map<string, CellResult>
  directDeps: Map<string, string[]>
}

export type EvalPageInfo = { id: string; name: string; rows: EvalRow[] }

/** 跨草稿引用的求值上下文：页名解析、占位符映射、懒求值缓存 */
export type PageCtx = {
  getPageByIndex: (index: number) => EvalPageInfo | undefined
  /** 行值缓存（跨草稿懒求值共享） */
  rowMemo: Map<string, CellResult>
  /** 正在求值的行 id 栈：行级环检测 */
  stack: Set<string>
}

type Fn = (...args: number[]) => number

const FUNCTIONS: Record<string, Fn> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: (x) => Math.log10(x),
  ln: Math.log,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: (...args) => Math.min(...args),
  max: (...args) => Math.max(...args),
  pow: (a, b) => Math.pow(a, b)
}

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E
}

export const FUNCTION_NAMES = Object.keys(FUNCTIONS)
export const CONSTANT_NAMES = Object.keys(CONSTANTS)

export function evaluatePage(rows: EvalRow[], ctx?: PageCtx): PageEvaluation {
  const results = new Map<string, CellResult>()
  const directDeps = new Map<string, string[]>()
  // #N 是行号引用：指向当前顺序的第 N 行
  const byPos = new Map<number, EvalRow>()
  rows.forEach((r, i) => byPos.set(i + 1, r))

  const parsed = new Map<string, { refs: number[]; atRefs: AtRef[]; replaced: string } | null>()
  for (const r of rows) {
    if (!r.expr.trim()) {
      parsed.set(r.id, null)
      directDeps.set(r.id, [])
      results.set(r.id, { status: 'empty' })
      continue
    }
    try {
      const { refs, atRefs, replaced } = parseExpression(r.expr)
      parsed.set(r.id, { refs, atRefs, replaced })
      const upstream: string[] = []
      for (const seq of refs) {
        const up = byPos.get(seq)
        if (up && !upstream.includes(up.id)) upstream.push(up.id)
      }
      directDeps.set(r.id, upstream)
    } catch {
      parsed.set(r.id, { refs: [], atRefs: [], replaced: r.expr })
      directDeps.set(r.id, [])
      results.set(r.id, { status: 'error', message: '表达式语法错误' })
    }
  }

  const rowById = new Map(rows.map((r) => [r.id, r]))
  const pending = rows.filter((r) => !results.has(r.id))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const r of pending) {
    inDegree.set(r.id, 0)
    dependents.set(r.id, [])
  }
  for (const r of pending) {
    for (const upId of directDeps.get(r.id) || []) {
      if (!inDegree.has(upId)) continue
      inDegree.set(r.id, (inDegree.get(r.id) || 0) + 1)
      dependents.set(upId, [...(dependents.get(upId) || []), r.id])
    }
  }

  const queue = pending.filter((r) => (inDegree.get(r.id) || 0) === 0).map((r) => r.id)
  let processed = 0
  while (queue.length) {
    const id = queue.shift()!
    processed++
    const r = rowById.get(id)!
    const parsedInfo = parsed.get(id)
    if (parsedInfo) {
      if (ctx) ctx.stack.add(id)
      try {
        results.set(id, evalAst(r, parsedInfo, results, byPos, ctx, rows, id))
      } finally {
        if (ctx) ctx.stack.delete(id)
      }
    }
    for (const depId of dependents.get(id) || []) {
      const next = (inDegree.get(depId) || 0) - 1
      inDegree.set(depId, next)
      if (next === 0) queue.push(depId)
    }
  }

  for (const r of pending) {
    if (!results.has(r.id)) results.set(r.id, { status: 'error', message: '循环引用' })
  }

  return { results, directDeps }
}

function evalAst(
  row: EvalRow,
  parsedInfo: { refs: number[]; atRefs: AtRef[]; replaced: string },
  results: Map<string, CellResult>,
  byPos: Map<number, EvalRow>,
  ctx?: PageCtx,
  pageRows?: EvalRow[],
  currentRowId?: string
): CellResult {
  try {
    const ast = (jsep as any)(parsedInfo.replaced)
    const value = evalNode(ast, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (Number.isNaN(value)) return { status: 'error', message: '无效数值' }
      if (value === Infinity || value === -Infinity) return { status: 'error', message: '除以零' }
      return { status: 'error', message: '表达式语法错误' }
    }
    return { status: 'ok', value }
  } catch (e: any) {
    return { status: 'error', message: e?.message || '表达式语法错误' }
  }
}

function evalNode(
  node: any,
  parsedInfo: { refs: number[]; atRefs: AtRef[]; replaced: string },
  results: Map<string, CellResult>,
  byPos: Map<number, EvalRow>,
  ctx?: PageCtx,
  pageRows?: EvalRow[],
  currentRowId?: string
): number {
  switch (node.type) {
    case 'Literal':
      return Number(node.value)
    case 'Identifier': {
      const name = String(node.name)
      if (name.startsWith('#')) {
        const seq = Number(name.slice(1))
        const target = byPos.get(seq)
        if (!target) throw new Error(`未找到 #${seq}`)
        const res = results.get(target.id)
        if (res) {
          if (res.status === 'empty') throw new Error(`未找到 #${seq}`)
          if (res.status === 'error') throw new Error(res.message)
          return res.value
        }
        if (ctx && pageRows) return resolveRowValue(target, pageRows, ctx)
        throw new Error(`未找到 #${seq}`)
      }
      const atMatch = /^_at(\d+)_$/.exec(name)
      if (atMatch) {
        const atRef = parsedInfo.atRefs[Number(atMatch[1])]
        if (!atRef) throw new Error('表达式语法错误')
        return resolveAtRef(atRef, ctx, currentRowId)
      }
      if (name in CONSTANTS) return CONSTANTS[name]
      if (name in FUNCTIONS) throw new Error(`${name} 需要调用`)
      throw new Error(`未知标识符 ${name}`)
    }
    case 'CallExpression': {
      const callee = node.callee?.name
      if (!callee || !(callee in FUNCTIONS)) throw new Error(`未知函数 ${callee || ''}`)
      const fn = FUNCTIONS[callee]
      const args = node.arguments.map((a: any) =>
        evalNode(a, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
      )
      const value = fn(...args)
      if (Number.isNaN(value)) throw new Error('无效数值')
      return value
    }
    case 'BinaryExpression': {
      const left = evalNode(node.left, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
      const right = evalNode(node.right, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
      return applyBinary(node.operator, left, right)
    }
    case 'UnaryExpression': {
      const argument = evalNode(node.argument, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
      if (node.operator === '-') return -argument
      if (node.operator === '+') return argument
      throw new Error('不支持的一元运算')
    }
    case 'ConditionalExpression': {
      const test = evalNode(node.test, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
      return test
        ? evalNode(node.consequent, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
        : evalNode(node.alternate, parsedInfo, results, byPos, ctx, pageRows, currentRowId)
    }
    default:
      throw new Error('表达式语法错误')
  }
}

/** 解析 @页序号#行序号：按行懒求值（行级 memo + 行级环检测） */
function resolveAtRef(atRef: AtRef, ctx: PageCtx | undefined, currentRowId?: string): number {
  if (!ctx) throw new Error(`未找到第 ${atRef.page} 个草稿`)
  const target = ctx.getPageByIndex(Number(atRef.page))
  if (!target) throw new Error(`未找到第 ${atRef.page} 个草稿`)
  if (atRef.ref === '') throw new Error('引用未完成')
  let row
  if (/^\d+$/.test(atRef.ref)) row = target.rows[Number(atRef.ref) - 1]
  else row = target.rows.find((r) => r.subtitle === atRef.ref)
  if (!row) throw new Error(`草稿「${target.name}」中没有第 ${atRef.ref} 行`)
  return resolveRowValue(row, target.rows, ctx)
}

/** 按行懒求值：memo 复用、in-progress 环检测 */
function resolveRowValue(row: EvalRow, pageRows: EvalRow[], ctx: PageCtx): number {
  const memo = ctx.rowMemo.get(row.id)
  if (memo) {
    if (memo.status === 'error') throw new Error(memo.message)
    if (memo.status === 'empty') throw new Error('引用未完成')
    return memo.value
  }
  if (ctx.stack.has(row.id)) throw new Error('循环引用')
  ctx.stack.add(row.id)
  const byPos = new Map(pageRows.map((r, i) => [i + 1, r] as const))
  const results = new Map<string, CellResult>()
  try {
    if (!row.expr.trim()) throw new Error('引用未完成')
    const parsed = parseExpression(row.expr)
    const value = evalNode(
      (jsep as any)(parsed.replaced),
      { refs: parsed.refs, atRefs: parsed.atRefs, replaced: parsed.replaced },
      results,
      byPos,
      ctx,
      pageRows,
      row.id
    )
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (Number.isNaN(value)) throw new Error('无效数值')
      if (value === Infinity || value === -Infinity) throw new Error('除以零')
      throw new Error('表达式语法错误')
    }
    ctx.rowMemo.set(row.id, { status: 'ok', value })
    return value
  } catch (e: any) {
    const msg = e?.message || '表达式语法错误'
    ctx.rowMemo.set(row.id, { status: 'error', message: msg })
    throw new Error(msg)
  } finally {
    ctx.stack.delete(row.id)
  }
}

function applyBinary(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b
    case '-': return a - b
    case '*': return a * b
    case '/':
      if (b === 0) throw new Error('除以零')
      return a / b
    case '%':
      if (b === 0) throw new Error('除以零')
      return a % b
    case '^': return Math.pow(a, b)
    default:
      throw new Error('不支持的运算符')
  }
}

export function upstreamRowIds(directDeps: Map<string, string[]>, rowId: string): Set<string> {
  const seen = new Set<string>()
  const stack = [...(directDeps.get(rowId) || [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const up of directDeps.get(id) || []) stack.push(up)
  }
  seen.delete(rowId)
  return seen
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return String(Number(n.toPrecision(12)))
}
