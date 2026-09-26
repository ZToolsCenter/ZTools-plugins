# 计算草稿（calc-draft）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 ZTools 插件"计算草稿"——单栏可编辑计算列表，`#seq` 稳定引用 + 点击复制/注入，多页持久化，macOS Spotlight 风格界面。

**Architecture:** jsep 解析表达式为 AST，自研 evaluator 做拓扑求值与环检测；顶层 `useReducer` 管理 `DraftDoc`（pages/rows），localStorage debounce 持久化；UI 为单栏卡片行 + 毛玻璃页签栏，颜色由 `seq` 映射调色板。

**Tech Stack:** React 19、TypeScript、Vite 6、jsep、Vitest

**Spec:** `docs/superpowers/specs/2026-09-23-calc-draft-design.md`

## Global Constraints

- `#N` 的 N 是创建顺序 `seq`，插入/删除/排序不重新编号；删除后 `seq` 不复用
- 每个 `seq` 颜色固定：`colorForSeq(seq)` 从调色板循环取色
- 表达式能力：四则 `+ - * /`、`^ %`、括号、函数 `sqrt sin cos tan log ln abs round floor ceil min max pow`、常量 `pi e`
- 点击数字 = 复制剪贴板 + toast；`Alt+点击` = 注入当前聚焦输入框光标处
- 错误仅行内呈现（红字短文案），不弹全局弹窗，不阻塞其他行
- 持久化键 `calc-draft:doc`，debounce 500ms，损坏回退空文档
- UI：无边框、大圆角（16-20px）、阴影层次、卡片感；非活动行 `opacity: 0.55`，上游依赖描边高亮
- ZTools 窗口由宿主接管；`plugin.json` 仅保留 `code: "calc"`，`cmds: ["计算", "草稿", "calc"]`，`pluginSetting.height: 840`（schema 无 width 字段）
- 空表达式行显示占位、不报错
- 运行时仅新增依赖 `jsep`；开发依赖新增 `vitest`
- 每任务结束 commit（首个任务先 `git init`）

## Review Focus

以下输入/失败模式最可能咬人，各自由所属任务的测试钉住：

1. **删除 seq 最大的行后再新建行** → seq 不得复用（否则颜色与引用错乱）→ Task 3 `state.test.ts`
2. **循环引用**（A→B→A）→ 整组标错且不挂起、不栈溢出 → Task 2 `evaluator.test.ts`
3. **编辑中游行** → 仅下游拓扑序重算，无关行结果不变 → Task 2 `evaluator.test.ts`
4. **localStorage 损坏 / 非法 JSON** → 回退空文档、应用不崩溃 → Task 3 `state.test.ts`
5. **浮点误差 `0.1+0.2`** → 显示 `0.3` 而非 `0.30000000000000004` → Task 2 `evaluator.test.ts`

---

### Task 1: 表达式解析 parser

**Files:**
- Create: `src/CalcDraft/engine/parser.ts`
- Test: `src/CalcDraft/engine/parser.test.ts`
- Modify: `package.json`（scripts、devDependencies）
- Create: `vitest.config.ts`

**Interfaces:**
- Consumes: 无（首任务）
- Produces:
  - `parseExpression(expr: string): { refs: number[] }` — 语法错误 `throw Error(message)`
  - `tokenizeForDisplay(expr: string): Array<{ type: 'number' | 'ref' | 'ident' | 'other'; text: string; seq?: number }>`

- [ ] **Step 1: 初始化 git 与依赖**

```bash
git init
npm install jsep
npm install -D vitest
```

在 `package.json` scripts 中加入：

```json
"test": "vitest run"
```

- [ ] **Step 2: 创建 vitest 配置**

创建 `vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
```

- [ ] **Step 3: 写失败测试**

创建 `src/CalcDraft/engine/parser.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { parseExpression, tokenizeForDisplay } from './parser'

describe('parseExpression', () => {
  it('返回空 refs（纯算术）', () => {
    expect(parseExpression('1 + 2 * 3').refs).toEqual([])
  })

  it('提取 #ref 的 seq', () => {
    expect(parseExpression('#1 + #12 * 2').refs).toEqual([1, 12])
  })

  it('同一 ref 重复出现只记录一次', () => {
    expect(parseExpression('#3 + #3').refs).toEqual([3])
  })

  it('语法错误时 throw', () => {
    expect(() => parseExpression('1 +')).toThrow()
    expect(() => parseExpression('sqrt(')).toThrow()
  })

  it('支持函数与常量', () => {
    expect(() => parseExpression('sqrt(4) + pi * e')).not.toThrow()
  })

  it('支持 ^ 与 % 以及括号', () => {
    expect(() => parseExpression('(2 + 3) ^ 2 % 7')).not.toThrow()
  })
})

describe('tokenizeForDisplay', () => {
  it('拆分 ref/数字/标识符/其他', () => {
    expect(tokenizeForDisplay('#1+2.5*sqrt')).toEqual([
      { type: 'ref', text: '#1', seq: 1 },
      { type: 'other', text: '+' },
      { type: 'number', text: '2.5' },
      { type: 'other', text: '*' },
      { type: 'ident', text: 'sqrt' }
    ])
  })

  it('保留空白为 other', () => {
    expect(tokenizeForDisplay('1 + 2')).toEqual([
      { type: 'number', text: '1' },
      { type: 'other', text: ' ' },
      { type: 'other', text: '+' },
      { type: 'other', text: ' ' },
      { type: 'number', text: '2' }
    ])
  })
})
```

- [ ] **Step 4: 运行确认失败**

Run: `npm test`
Expected: FAIL（`./parser` 不存在）

- [ ] **Step 5: 最小实现**

创建 `src/CalcDraft/engine/parser.ts`：

```ts
import jsep from 'jsep'

jsep.addIdentifierChar('#')
jsep.addBinaryOp('^', 11, true)
jsep.addBinaryOp('%', 10)

export type ParseResult = { refs: number[] }

export function parseExpression(expr: string): ParseResult {
  const ast = jsep(expr)
  const refs: number[] = []
  walk(ast, (node: any) => {
    if (node.type === 'Identifier' && typeof node.name === 'string' && node.name.startsWith('#')) {
      const seq = Number(node.name.slice(1))
      if (Number.isInteger(seq) && seq >= 1 && !refs.includes(seq)) refs.push(seq)
    }
  })
  return { refs }
}

function walk(node: any, visit: (n: any) => void): void {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type') continue
    const value = node[key]
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}

export type DisplayToken = {
  type: 'number' | 'ref' | 'ident' | 'other'
  text: string
  seq?: number
}

const TOKEN_RE = /#(\d+)|(\d+\.?\d*)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([\s\S])/g

export function tokenizeForDisplay(expr: string): DisplayToken[] {
  const tokens: DisplayToken[] = []
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(expr))) {
    if (m[1] !== undefined) tokens.push({ type: 'ref', text: m[0], seq: Number(m[1]) })
    else if (m[2] !== undefined) tokens.push({ type: 'number', text: m[0] })
    else if (m[3] !== undefined) tokens.push({ type: 'ident', text: m[0] })
    else tokens.push({ type: 'other', text: m[0] })
  }
  return tokens
}
```

- [ ] **Step 6: 运行确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/CalcDraft/engine/
git commit -m "feat: expression parser with #ref extraction and display tokenizer"
```

---

### Task 2: 求值器 evaluator

**Files:**
- Create: `src/CalcDraft/engine/evaluator.ts`
- Test: `src/CalcDraft/engine/evaluator.test.ts`

**Interfaces:**
- Consumes: `parseExpression(expr): { refs: number[] }`（Task 1）
- Produces:
  - `type CellResult = { status: 'ok'; value: number } | { status: 'error'; message: string } | { status: 'empty' }`
  - `evaluatePage(rows: Array<{ id: string; seq: number; expr: string }>): { results: Map<string, CellResult>; directDeps: Map<string, string[]> }`
  - `upstreamRowIds(directDeps: Map<string, string[]>, rowId: string): Set<string>`
  - `formatNumber(n: number): string`

- [ ] **Step 1: 写失败测试**

创建 `src/CalcDraft/engine/evaluator.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { evaluatePage, upstreamRowIds, formatNumber } from './evaluator'

const row = (id: string, seq: number, expr: string) => ({ id, seq, expr })

describe('evaluatePage', () => {
  it('四则与优先级', () => {
    const { results } = evaluatePage([row('a', 1, '1 + 2 * 3')])
    expect(results.get('a')).toEqual({ status: 'ok', value: 7 })
  })

  it('解析 #ref 并求值', () => {
    const { results } = evaluatePage([
      row('a', 1, '10'),
      row('b', 2, '#1 * 2 + 1')
    ])
    expect(results.get('b')).toEqual({ status: 'ok', value: 21 })
  })

  it('引用顺序与拓扑无关（后行先引用不依赖书写顺序以外的环）', () => {
    const { results } = evaluatePage([
      row('a', 1, '#2 + 1'),
      row('b', 2, '5')
    ])
    expect(results.get('a')).toEqual({ status: 'ok', value: 6 })
  })

  it('缺失 ref → 未找到', () => {
    const { results } = evaluatePage([row('a', 1, '#9 + 1')])
    expect(results.get('a')).toEqual({ status: 'error', message: '未找到 #9' })
  })

  it('除零 → 除以零', () => {
    const { results } = evaluatePage([row('a', 1, '1 / 0')])
    expect(results.get('a')).toEqual({ status: 'error', message: '除以零' })
  })

  it('循环引用 → 整组标错且不挂起', () => {
    const { results } = evaluatePage([
      row('a', 1, '#2 + 1'),
      row('b', 2, '#1 + 1')
    ])
    expect(results.get('a')).toEqual({ status: 'error', message: '循环引用' })
    expect(results.get('b')).toEqual({ status: 'error', message: '循环引用' })
  })

  it('自引用 → 循环引用', () => {
    const { results } = evaluatePage([row('a', 1, '#1 + 1')])
    expect(results.get('a')).toEqual({ status: 'error', message: '循环引用' })
  })

  it('编辑中游行后仅下游受影响（模拟改 expr 重新 evaluatePage）', () => {
    const before = evaluatePage([
      row('a', 1, '2'),
      row('b', 2, '#1 * 10'),
      row('c', 3, '100')
    ])
    expect(before.results.get('b')).toEqual({ status: 'ok', value: 20 })
    const after = evaluatePage([
      row('a', 1, '3'),
      row('b', 2, '#1 * 10'),
      row('c', 3, '100')
    ])
    expect(after.results.get('b')).toEqual({ status: 'ok', value: 30 })
    expect(after.results.get('c')).toEqual({ status: 'ok', value: 100 })
  })

  it('函数与常量', () => {
    const { results } = evaluatePage([
      row('a', 1, 'sqrt(9)'),
      row('b', 2, 'abs(-4)'),
      row('c', 3, 'max(1, 7, 3)'),
      row('d', 4, 'round(2.6)'),
      row('e', 5, 'pi')
    ])
    expect(results.get('a')).toEqual({ status: 'ok', value: 3 })
    expect(results.get('b')).toEqual({ status: 'ok', value: 4 })
    expect(results.get('c')).toEqual({ status: 'ok', value: 7 })
    expect(results.get('d')).toEqual({ status: 'ok', value: 3 })
    expect((results.get('e') as any).value).toBeCloseTo(Math.PI)
  })

  it('^ 右结合', () => {
    const { results } = evaluatePage([row('a', 1, '2 ^ 3 ^ 2')])
    expect(results.get('a')).toEqual({ status: 'ok', value: 512 })
  })

  it('空表达式 → empty 而非错误', () => {
    const { results } = evaluatePage([row('a', 1, '   ')])
    expect(results.get('a')).toEqual({ status: 'empty' })
  })

  it('语法错误 → 行内 error', () => {
    const { results } = evaluatePage([row('a', 1, '1 +')])
    expect(results.get('a')!.status).toBe('error')
  })

  it('无关行不受错误行影响', () => {
    const { results } = evaluatePage([
      row('a', 1, '1 +'),
      row('b', 2, '2 + 2')
    ])
    expect(results.get('a')!.status).toBe('error')
    expect(results.get('b')).toEqual({ status: 'ok', value: 4 })
  })

  it('上游 error 时下游传播消息', () => {
    const { results } = evaluatePage([
      row('a', 1, '1 / 0'),
      row('b', 2, '#1 + 1')
    ])
    expect(results.get('b')).toEqual({ status: 'error', message: '除以零' })
  })

  it('directDeps 记录上游行 id', () => {
    const { directDeps } = evaluatePage([
      row('a', 1, '1'),
      row('b', 2, '#1 + 1')
    ])
    expect(directDeps.get('b')).toEqual(['a'])
    expect(directDeps.get('a')).toEqual([])
  })
})

describe('upstreamRowIds', () => {
  it('计算传递上游', () => {
    const deps = new Map([
      ['a', []],
      ['b', ['a']],
      ['c', ['b']],
      ['d', []]
    ])
    expect(upstreamRowIds(deps, 'c')).toEqual(new Set(['a', 'b']))
    expect(upstreamRowIds(deps, 'a')).toEqual(new Set())
  })

  it('环状依赖不死循环', () => {
    const deps = new Map([
      ['a', ['b']],
      ['b', ['a']]
    ])
    expect(upstreamRowIds(deps, 'a')).toEqual(new Set(['b']))
  })
})

describe('formatNumber', () => {
  it('消除 0.1+0.2 浮点噪声', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3')
  })

  it('整数不带小数点', () => {
    expect(formatNumber(7)).toBe('7')
  })

  it('保留有效小数', () => {
    expect(formatNumber(1 / 3)).toBe('0.333333333333')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`./evaluator` 不存在）

- [ ] **Step 3: 最小实现**

创建 `src/CalcDraft/engine/evaluator.ts`：

```ts
import { parseExpression } from './parser'

export type CellResult =
  | { status: 'ok'; value: number }
  | { status: 'error'; message: string }
  | { status: 'empty' }

export type EvalRow = { id: string; seq: number; expr: string }

export type PageEvaluation = {
  results: Map<string, CellResult>
  directDeps: Map<string, string[]>
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

export function evaluatePage(rows: EvalRow[]): PageEvaluation {
  const results = new Map<string, CellResult>()
  const directDeps = new Map<string, string[]>()
  const bySeq = new Map<number, EvalRow>()
  for (const r of rows) bySeq.set(r.seq, r)

  const parsed = new Map<string, { refs: number[] } | null>()
  for (const r of rows) {
    if (!r.expr.trim()) {
      parsed.set(r.id, null)
      directDeps.set(r.id, [])
      results.set(r.id, { status: 'empty' })
      continue
    }
    try {
      const { refs } = parseExpression(r.expr)
      parsed.set(r.id, { refs })
      const upstream: string[] = []
      for (const seq of refs) {
        const up = bySeq.get(seq)
        if (up && !upstream.includes(up.id)) upstream.push(up.id)
      }
      directDeps.set(r.id, upstream)
    } catch {
      parsed.set(r.id, { refs: [] })
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
      results.set(id, evalAst(r, parsedInfo.refs, results, bySeq))
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
  refs: number[],
  results: Map<string, CellResult>,
  bySeq: Map<number, EvalRow>
): CellResult {
  try {
    const ast = (jsep as any)(row.expr)
    const value = evalNode(ast, refs, results, bySeq)
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
  refs: number[],
  results: Map<string, CellResult>,
  bySeq: Map<number, EvalRow>
): number {
  switch (node.type) {
    case 'Literal':
      return Number(node.value)
    case 'Identifier': {
      const name = String(node.name)
      if (name.startsWith('#')) {
        const seq = Number(name.slice(1))
        const target = bySeq.get(seq)
        if (!target) throw new Error(`未找到 #${seq}`)
        const res = results.get(target.id)
        if (!res || res.status === 'empty') throw new Error(`未找到 #${seq}`)
        if (res.status === 'error') throw new Error(res.message)
        return res.value
      }
      if (name in CONSTANTS) return CONSTANTS[name]
      if (name in FUNCTIONS) throw new Error(`${name} 需要调用`)
      throw new Error(`未知标识符 ${name}`)
    }
    case 'CallExpression': {
      const callee = node.callee?.name
      if (!callee || !(callee in FUNCTIONS)) throw new Error(`未知函数 ${callee || ''}`)
      const fn = FUNCTIONS[callee]
      const args = node.arguments.map((a: any) => evalNode(a, refs, results, bySeq))
      const value = fn(...args)
      if (Number.isNaN(value)) throw new Error('无效数值')
      return value
    }
    case 'BinaryExpression': {
      const left = evalNode(node.left, refs, results, bySeq)
      const right = evalNode(node.right, refs, results, bySeq)
      return applyBinary(node.operator, left, right)
    }
    case 'UnaryExpression': {
      const argument = evalNode(node.argument, refs, results, bySeq)
      if (node.operator === '-') return -argument
      if (node.operator === '+') return argument
      throw new Error('不支持的一元运算')
    }
    case 'ConditionalExpression': {
      const test = evalNode(node.test, refs, results, bySeq)
      return test
        ? evalNode(node.consequent, refs, results, bySeq)
        : evalNode(node.alternate, refs, results, bySeq)
    }
    default:
      throw new Error('表达式语法错误')
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

import jsep from 'jsep'

export function upstreamRowIds(directDeps: Map<string, string[]>, rowId: string): Set<string> {
  const seen = new Set<string>()
  const stack = [...(directDeps.get(rowId) || [])]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const up of directDeps.get(id) || []) stack.push(up)
  }
  return seen
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return String(Number(n.toPrecision(12)))
}
```

注意：`import jsep from 'jsep'` 放在文件顶部（实现时整理 import 顺序至文件头）。

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/CalcDraft/engine/
git commit -m "feat: evaluator with topo sort, cycle detection, functions, formatNumber"
```

---

### Task 3: 状态模型 state + 调色板 palette

**Files:**
- Create: `src/CalcDraft/state.ts`
- Create: `src/CalcDraft/palette.ts`
- Test: `src/CalcDraft/state.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `type Row = { id: string; seq: number; expr: string }`
  - `type Page = { id: string; name: string; rows: Row[]; createdAt: number; seqCounter: number }`
  - `type DraftDoc = { pages: Page[]; activePageId: string }`
  - `type Action =` 见实现（init/addRow/editRow/deleteRow/moveRow/addPage/deletePage/renamePage/setActivePage）
  - `createEmptyDoc(): DraftDoc`
  - `docReducer(doc: DraftDoc, action: Action): DraftDoc`
  - `loadDoc(raw: string | null): DraftDoc`
  - `serializeDoc(doc: DraftDoc): string`
  - `STORAGE_KEY = 'calc-draft:doc'`
  - `colorForSeq(seq: number): string`、`PALETTE: string[]`

- [ ] **Step 1: 写失败测试**

创建 `src/CalcDraft/state.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  createEmptyDoc,
  docReducer,
  loadDoc,
  serializeDoc,
  STORAGE_KEY,
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

  it('editRow 只改 expr', () => {
    let doc = docWithRows()
    doc = docReducer(doc, { type: 'editRow', pageId: doc.activePageId, rowId: 'r1', expr: '42' })
    expect(doc.pages[0].rows[0]).toEqual({ id: 'r1', seq: 1, expr: '42' })
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

  it('不能删除最后一页', () => {
    const doc = createEmptyDoc()
    const next = docReducer(doc, { type: 'deletePage', pageId: doc.activePageId })
    expect(next.pages).toHaveLength(1)
  })

  it('renamePage 改名', () => {
    let doc = createEmptyDoc()
    doc = docReducer(doc, { type: 'renamePage', pageId: doc.activePageId, name: '工资' })
    expect(doc.pages[0].name).toBe('工资')
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
    expect(STORAGE_KEY).toBe('calc-draft:doc')
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL（`./state`、`./palette` 不存在）

- [ ] **Step 3: 最小实现**

创建 `src/CalcDraft/palette.ts`：

```ts
export const PALETTE = [
  '#7AA2F7',
  '#9ECE6A',
  '#E0AF68',
  '#F7768E',
  '#BB9AF7',
  '#7DCFFF',
  '#C0CAF5',
  '#FF9E64',
  '#73DACA',
  '#FF757F'
]

export function colorForSeq(seq: number): string {
  const index = ((seq - 1) % PALETTE.length + PALETTE.length) % PALETTE.length
  return PALETTE[index]
}
```

创建 `src/CalcDraft/state.ts`：

```ts
export type Row = { id: string; seq: number; expr: string }

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

export type Action =
  | { type: 'addRow'; pageId: string; rowId: string; expr?: string; afterRowId?: string }
  | { type: 'editRow'; pageId: string; rowId: string; expr: string }
  | { type: 'deleteRow'; pageId: string; rowId: string }
  | { type: 'moveRow'; pageId: string; rowId: string; toIndex: number }
  | { type: 'addPage'; pageId: string; name?: string }
  | { type: 'deletePage'; pageId: string }
  | { type: 'renamePage'; pageId: string; name: string }
  | { type: 'setActivePage'; pageId: string }

export const STORAGE_KEY = 'calc-draft:doc'

export function createEmptyDoc(): DraftDoc {
  const page: Page = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: '未命名草稿',
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

export function docReducer(doc: DraftDoc, action: Action): DraftDoc {
  switch (action.type) {
    case 'addRow':
      return updatePage(doc, action.pageId, (page) => {
        const seqCounter = page.seqCounter + 1
        const row: Row = { id: action.rowId, seq: seqCounter, expr: action.expr ?? '' }
        if (action.afterRowId) {
          const index = page.rows.findIndex((r) => r.id === action.afterRowId)
          if (index >= 0) {
            const rows = [...page.rows]
            rows.splice(index + 1, 0, row)
            return { ...page, rows, seqCounter }
          }
        }
        return { ...page, rows: [...page.rows, row], seqCounter }
      })
    case 'editRow':
      return updatePage(doc, action.pageId, (page) => ({
        ...page,
        rows: page.rows.map((r) => (r.id === action.rowId ? { ...r, expr: action.expr } : r))
      }))
    case 'deleteRow':
      return updatePage(doc, action.pageId, (page) => ({
        ...page,
        rows: page.rows.filter((r) => r.id !== action.rowId)
      }))
    case 'moveRow':
      return updatePage(doc, action.pageId, (page) => {
        const from = page.rows.findIndex((r) => r.id === action.rowId)
        if (from < 0) return page
        const to = Math.max(0, Math.min(action.toIndex, page.rows.length - 1))
        if (from === to) return page
        const rows = [...page.rows]
        const [moved] = rows.splice(from, 1)
        rows.splice(to, 0, moved)
        return { ...page, rows }
      })
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
      if (doc.pages.length <= 1) return doc
      const pages = doc.pages.filter((p) => p.id !== action.pageId)
      if (pages.length === doc.pages.length) return doc
      const activePageId =
        doc.activePageId === action.pageId ? pages[0].id : doc.activePageId
      return { pages, activePageId }
    }
    case 'renamePage':
      return updatePage(doc, action.pageId, (page) => ({ ...page, name: action.name }))
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
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test`
Expected: PASS（含 Review Focus #1、#4）

- [ ] **Step 5: Commit**

```bash
git add src/CalcDraft/state.ts src/CalcDraft/palette.ts src/CalcDraft/state.test.ts
git commit -m "feat: draft state model with stable seq and palette"
```

---

### Task 4: 插件接入与 CalcDraft 空骨架

**Files:**
- Modify: `src-ztools/plugin.json`
- Modify: `src/App.tsx`
- Create: `src/CalcDraft/index.tsx`
- Create: `src/CalcDraft/index.css`
- Modify: `src/main.css`
- Modify: `src/env.d.ts`
- Modify: `src-ztools/preload/services.js`
- Delete: `src/Hello/`、`src/Read/`、`src/Write/`

**Interfaces:**
- Consumes: `createEmptyDoc`、`docReducer`、`loadDoc`、`serializeDoc`、`STORAGE_KEY`（Task 3）
- Produces: 默认导出 `CalcDraft`：React 组件，挂载后展示页签栏 + 空状态 + 底栏；后续任务在其上加行列表

- [ ] **Step 1: 收敛 plugin.json**

将 `src-ztools/plugin.json` 的 `features` 替换为单一 calc 功能，并加 `pluginSetting`：

```json
{
  "$schema": "node_modules/@ztools-center/ztools-api-types/resource/ztools.schema.json",
  "name": "calc-draft",
  "title": "计算草稿",
  "description": "计算草稿纸，记录多步计算，友好且现代的交互界面",
  "author": "Agitator",
  "version": "0.0.1",
  "main": "dist/index.html",
  "preload": "preload/services.js",
  "logo": "logo.png",
  "development": {
    "main": "http://localhost:5173"
  },
  "pluginSetting": {
    "height": 840,
    "single": true
  },
  "features": [
    {
      "code": "calc",
      "explain": "计算草稿：多步计算，中间结果可引用",
      "icon": "logo.png",
      "cmds": ["计算", "草稿", "calc"]
    }
  ]
}
```

- [ ] **Step 2: 清空模板服务与类型**

`src-ztools/preload/services.js` 整文件替换为：

```js
// 通过 window 对象向渲染进程注入 nodejs 能力（当前无服务，保留扩展点）
window.services = {}
```

`src/env.d.ts` 整文件替换为：

```ts
/// <reference types="vite/client" />
/// <reference types="@ztools-center/ztools-api-types" />

declare global {
  interface Window {
    services: Record<string, never>
  }
}

export {}
```

- [ ] **Step 3: 删除模板组件**

```bash
git rm -r src/Hello src/Read src/Write
```

- [ ] **Step 4: 路由接入**

`src/App.tsx` 整文件替换为：

```tsx
import { useEffect, useState } from 'react'
import CalcDraft from './CalcDraft'

export default function App() {
  const [route, setRoute] = useState('')

  useEffect(() => {
    window.ztools.onPluginEnter((action: any) => {
      setRoute(action.code)
    })
    window.ztools.onPluginOut(() => {
      setRoute('')
    })
  }, [])

  if (route === 'calc') return <CalcDraft />

  return null
}
```

- [ ] **Step 5: 空骨架组件与样式**

创建 `src/CalcDraft/index.tsx`：

```tsx
import { useEffect, useReducer, useState } from 'react'
import './index.css'
import { createEmptyDoc, docReducer, loadDoc, serializeDoc, STORAGE_KEY } from './state'

export default function CalcDraft() {
  const [doc, dispatch] = useReducer(docReducer, undefined, () =>
    loadDoc(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null)
  )
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeDoc(doc))
      } catch {
        // 存储失败不阻塞使用
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [doc, ready])

  const page = doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0] ?? createEmptyDoc().pages[0]

  return (
    <div className="calc-draft">
      <header className="cd-topbar">
        <div className="cd-tabs">
          {doc.pages.map((p) => (
            <button
              key={p.id}
              className={`cd-tab${p.id === doc.activePageId ? ' cd-tab-active' : ''}`}
              onClick={() => dispatch({ type: 'setActivePage', pageId: p.id })}
            >
              {p.name}
            </button>
          ))}
          <button
            className="cd-tab-add"
            title="新建草稿页"
            onClick={() =>
              dispatch({
                type: 'addPage',
                pageId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())
              })
            }
          >
            +
          </button>
        </div>
        <div className="cd-meta">
          {page.name} · {page.rows.length} 行
        </div>
      </header>

      <main className="cd-body">
        <div className="cd-empty">
          输入表达式，回车开始计算 · 支持 #1 引用上文结果
        </div>
      </main>

      <footer className="cd-statusbar">
        <span>Enter 新行 · 点击数字复制 · Alt+点击 注入</span>
      </footer>
    </div>
  )
}
```

创建 `src/CalcDraft/index.css`：

```css
.calc-draft {
  box-sizing: border-box;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 10px;
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(122, 162, 247, 0.12), transparent 60%),
    rgba(24, 24, 32, 0.92);
  color: #c0caf5;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  backdrop-filter: blur(20px);
}

.cd-topbar {
  border-radius: 16px;
  padding: 12px 16px;
  background: rgba(30, 30, 44, 0.75);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.cd-tabs {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.cd-tab {
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(192, 202, 245, 0.55);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cd-tab:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #c0caf5;
}

.cd-tab-active {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12), 0 0 16px rgba(122, 162, 247, 0.25);
}

.cd-tab-add {
  border: none;
  background: transparent;
  color: rgba(192, 202, 245, 0.55);
  font-size: 16px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
}

.cd-tab-add:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.cd-meta {
  margin-top: 8px;
  font-size: 12px;
  color: rgba(192, 202, 245, 0.45);
}

.cd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: 20px;
  padding: 16px;
  background: rgba(18, 18, 26, 0.55);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.cd-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(192, 202, 245, 0.35);
  font-size: 14px;
  letter-spacing: 0.02em;
}

.cd-statusbar {
  border-radius: 14px;
  padding: 8px 16px;
  font-size: 12px;
  color: rgba(192, 202, 245, 0.45);
  background: rgba(30, 30, 44, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
```

修改 `src/main.css`：将全局 `button` 的 `background: none var(--blue)` 改为避免覆盖插件按钮样式：

```css
button {
  border: none;
  background: none;
  color: var(--light);
  line-height: 2.5;
  cursor: pointer;
  transition: opacity 0.2s;
  font-family: inherit;
}
```

- [ ] **Step 6: 类型检查 + 测试**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: plugin wiring with calc route and empty shell"
```

---

### Task 5: 行列表渲染与求值接线

**Files:**
- Create: `src/CalcDraft/components/CalcRow.tsx`
- Create: `src/CalcDraft/components/NumberCell.tsx`
- Create: `src/CalcDraft/components/Toast.tsx`
- Modify: `src/CalcDraft/index.tsx`
- Modify: `src/CalcDraft/index.css`

**Interfaces:**
- Consumes:
  - `evaluatePage`、`CellResult`、`formatNumber`、`upstreamRowIds`（Task 2）
  - `colorForSeq`（Task 3）
  - `tokenizeForDisplay`（Task 1）
  - `docReducer` actions（Task 3）
- Produces:
  - `CalcDraft` 默认导出增强：可见行列表、结果、编辑、复制/注入、聚光灯
  - `<NumberCell text={string} onCopy={(text) => void} onInject={(text) => void} />`
  - `<Toast message={string | null} />`
  - `<CalcRow ... />` props 见实现

- [ ] **Step 1: 创建 NumberCell**

创建 `src/CalcDraft/components/NumberCell.tsx`：

```tsx
interface NumberCellProps {
  text: string
  onCopy: (text: string) => void
  onInject: (text: string) => void
  className?: string
}

export default function NumberCell({ text, onCopy, onInject, className }: NumberCellProps) {
  return (
    <button
      type="button"
      className={`cd-num${className ? ` ${className}` : ''}`}
      title="点击复制 · Alt+点击注入"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        if (e.altKey) onInject(text)
        else onCopy(text)
      }}
    >
      {text}
    </button>
  )
}
```

- [ ] **Step 2: 创建 Toast**

创建 `src/CalcDraft/components/Toast.tsx`：

```tsx
export default function Toast({ message }: { message: string | null }) {
  if (!message) return null
  return <div className="cd-toast">{message}</div>
}
```

- [ ] **Step 3: 创建 CalcRow**

创建 `src/CalcDraft/components/CalcRow.tsx`：

```tsx
import { tokenizeForDisplay } from '../engine/parser'
import type { CellResult } from '../engine/evaluator'
import { formatNumber } from '../engine/evaluator'
import { colorForSeq } from '../palette'
import NumberCell from './NumberCell'

export type CalcRowProps = {
  rowId: string
  seq: number
  expr: string
  result: CellResult
  color: string
  isEditing: boolean
  isActive: boolean
  isUpstream: boolean
  onChange: (expr: string) => void
  onFocus: () => void
  onBlur: () => void
  onEnter: () => void
  onEscape: () => void
  onCopy: (text: string) => void
  onInject: (text: string) => void
  onRequestEdit: () => void
}

export default function CalcRow(props: CalcRowProps) {
  const { rowId, seq, expr, result, color, isEditing, isActive, isUpstream } = props
  const classes = [
    'cd-row',
    isActive ? 'cd-row-active' : '',
    isUpstream ? 'cd-row-upstream' : '',
    isEditing ? 'cd-row-editing' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} data-row-id={rowId} style={{ ['--row-color' as any]: color }}>
      <span className="cd-seq" style={{ background: color }}>
        #{seq}
      </span>

      <div className="cd-expr" onClick={props.onRequestEdit}>
        {isEditing ? (
          <input
            className="cd-input"
            autoFocus
            value={expr}
            spellCheck={false}
            onChange={(e) => props.onChange(e.target.value)}
            onFocus={props.onFocus}
            onBlur={props.onBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                props.onEnter()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                props.onEscape()
              }
            }}
          />
        ) : (
          <span className="cd-expr-view">
            {tokenizeForDisplay(expr).map((t, i) => {
              if (t.type === 'number') {
                return (
                  <NumberCell
                    key={i}
                    text={t.text}
                    className="cd-num-inline"
                    onCopy={props.onCopy}
                    onInject={props.onInject}
                  />
                )
              }
              if (t.type === 'ref') {
                return (
                  <span key={i} className="cd-ref" style={{ color }}>
                    {t.text}
                  </span>
                )
              }
              return <span key={i}>{t.text}</span>
            })}
            {expr.trim() === '' && <span className="cd-placeholder">输入表达式…</span>}
          </span>
        )}
      </div>

      <div className="cd-result">
        {result.status === 'ok' && (
          <NumberCell
            text={formatNumber(result.value)}
            className="cd-num-result"
            onCopy={props.onCopy}
            onInject={props.onInject}
          />
        )}
        {result.status === 'error' && <span className="cd-error">{result.message}</span>}
        {result.status === 'empty' && <span className="cd-result-empty">=</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 接线 index.tsx**

用以下内容替换 `src/CalcDraft/index.tsx`（在 Task 4 版本上扩展；`doc`/`dispatch`/持久化逻辑不变，body 区改为行列表；页签可先保持简单按钮版，Task 8 再增强）：

```tsx
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './index.css'
import { createEmptyDoc, docReducer, loadDoc, serializeDoc, STORAGE_KEY } from './state'
import { evaluatePage, upstreamRowIds, type CellResult } from './engine/evaluator'
import { colorForSeq } from './palette'
import CalcRow from './components/CalcRow'
import Toast from './components/Toast'

export default function CalcDraft() {
  const [doc, dispatch] = useReducer(docReducer, undefined, () =>
    loadDoc(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null)
  )
  const [ready, setReady] = useState(false)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [activeRowId, setActiveRowId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  const page =
    doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0] ?? createEmptyDoc().pages[0]

  const evaluation = useMemo(() => evaluatePage(page.rows), [page.rows])

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeDoc(doc))
      } catch {
        // 忽略存储失败
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [doc, ready])

  useEffect(() => {
    if (!pendingFocusId) return
    setEditingRowId(pendingFocusId)
    setPendingFocusId(null)
  }, [pendingFocusId, page.rows])

  const showToast = (message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 1500)
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showToast(`已复制 ${text}`)
    } catch {
      showToast('复制失败')
    }
  }

  const injectRef = useRef<HTMLInputElement | null>(null)
  document.addEventListener('focusin', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.classList.contains('cd-input')) {
      injectRef.current = e.target
    }
  })

  const handleInject = (text: string) => {
    const input = injectRef.current
    if (!input || !document.contains(input)) {
      showToast('请先聚焦一行输入框')
      return
    }
    input.focus()
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    const next = input.value.slice(0, start) + text + input.value.slice(end)
    const cursor = start + text.length
    const rowId = input.closest('[data-row-id]')?.getAttribute('data-row-id')
    if (rowId) {
      dispatch({ type: 'editRow', pageId: page.id, rowId, expr: next })
      requestAnimationFrame(() => {
        input.setSelectionRange(cursor, cursor)
      })
    }
  }

  const addRow = (afterRowId?: string) => {
    const rowId =
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())
    dispatch({ type: 'addRow', pageId: page.id, rowId, expr: '', afterRowId })
    setPendingFocusId(rowId)
    return rowId
  }

  const upstream = activeRowId ? upstreamRowIds(evaluation.directDeps, activeRowId) : new Set<string>()

  return (
    <div className="calc-draft">
      <header className="cd-topbar">
        <div className="cd-tabs">
          {doc.pages.map((p) => (
            <button
              key={p.id}
              className={`cd-tab${p.id === doc.activePageId ? ' cd-tab-active' : ''}`}
              onClick={() => dispatch({ type: 'setActivePage', pageId: p.id })}
            >
              {p.name}
            </button>
          ))}
          <button
            className="cd-tab-add"
            title="新建草稿页"
            onClick={() =>
              dispatch({
                type: 'addPage',
                pageId:
                  typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : String(Date.now())
              })
            }
          >
            +
          </button>
        </div>
        <div className="cd-meta">
          {page.name} · {page.rows.length} 行
        </div>
      </header>

      <main className="cd-body">
        {page.rows.length === 0 ? (
          <div className="cd-empty">输入表达式，回车开始计算 · 支持 #1 引用上文结果</div>
        ) : (
          <div className="cd-rows">
            {page.rows.map((row) => {
              const result: CellResult = evaluation.results.get(row.id) ?? { status: 'empty' }
              return (
                <CalcRow
                  key={row.id}
                  rowId={row.id}
                  seq={row.seq}
                  expr={row.expr}
                  result={result}
                  color={colorForSeq(row.seq)}
                  isEditing={editingRowId === row.id}
                  isActive={activeRowId === row.id}
                  isUpstream={activeRowId !== row.id && upstream.has(row.id)}
                  onChange={(expr) =>
                    dispatch({ type: 'editRow', pageId: page.id, rowId: row.id, expr })
                  }
                  onFocus={() => setActiveRowId(row.id)}
                  onBlur={() => {
                    setActiveRowId((current) => (current === row.id ? null : current))
                    setEditingRowId((current) => (current === row.id ? null : current))
                  }}
                  onEnter={() => addRow(row.id)}
                  onEscape={(undefined as any)}
                  onCopy={handleCopy}
                  onInject={handleInject}
                  onRequestEdit={() => {
                    setEditingRowId(row.id)
                    setActiveRowId(row.id)
                  }}
                />
              )
            })}
          </div>
        )}
      </main>

      <footer className="cd-statusbar">
        <button className="cd-add-btn" onClick={() => addRow(page.rows[page.rows.length - 1]?.id)}>
          + 新行
        </button>
        <span>Enter 新行 · 点击数字复制 · Alt+点击 注入</span>
      </footer>

      <Toast message={toast} />
    </div>
  )
}
```

注意：实现时将 `onEscape` 正确传为 `() => { setEditingRowId(null) }`（上方 `undefined as any` 仅为避免复制遗漏，编码时必须写成真实回调）；`focusin` 监听放入 `useEffect` 并在卸载时移除，不得在 render 期间直接 `document.addEventListener`。

- [ ] **Step 5: 行样式追加到 index.css**

在 `src/CalcDraft/index.css` 末尾追加：

```css
.cd-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cd-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
}

.cd-body.has-focus .cd-row:not(.cd-row-active):not(.cd-row-upstream) {
  opacity: 0.55;
}

.cd-row:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
}

.cd-row-upstream {
  box-shadow: 0 0 0 1px var(--row-color), 0 4px 12px rgba(0, 0, 0, 0.22);
}

.cd-row-active {
  background: rgba(255, 255, 255, 0.07);
}

.cd-seq {
  font-size: 11px;
  font-weight: 600;
  color: #1a1b26;
  border-radius: 999px;
  padding: 3px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.cd-expr {
  min-width: 0;
  cursor: text;
}

.cd-input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: #c0caf5;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.5;
  padding: 0;
}

.cd-expr-view {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-all;
}

.cd-ref {
  font-weight: 600;
}

.cd-placeholder {
  color: rgba(192, 202, 245, 0.3);
}

.cd-result {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 18px;
  font-weight: 600;
  text-align: right;
  min-width: 72px;
}

.cd-num {
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 2px 6px;
  border-radius: 8px;
  cursor: pointer;
  line-height: 1.4;
}

.cd-num:hover {
  background: rgba(255, 255, 255, 0.1);
}

.cd-num-result {
  color: #9ece6a;
  font-size: 18px;
  font-weight: 600;
}

.cd-num-inline {
  color: #e0af68;
  font-size: 14px;
}

.cd-error {
  color: #f7768e;
  font-size: 12px;
  font-weight: 500;
}

.cd-result-empty {
  color: rgba(192, 202, 245, 0.3);
}

.cd-add-btn {
  border: none;
  background: rgba(122, 162, 247, 0.18);
  color: #7aa2f7;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.6;
}

.cd-add-btn:hover {
  background: rgba(122, 162, 247, 0.3);
}

.cd-statusbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.cd-toast {
  position: fixed;
  top: 20px;
  right: 20px;
  background: rgba(40, 44, 60, 0.95);
  color: #c0caf5;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  animation: cd-toast-in 0.18s ease;
  z-index: 100;
}

@keyframes cd-toast-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

同时给 `.cd-body` 的聚焦态：在 `index.tsx` 的 `<main className="cd-body">` 上改为 `className={`cd-body${activeRowId ? ' has-focus' : ''}`}`。

- [ ] **Step 6: 类型检查 + 测试**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

手动验证（`npm run dev` + ZTools 或浏览器）：
- 输入 `1+2` 回车 → 显示 `= 3`
- 第二行输入 `#1*10` → `= 30`，`#1` 着色
- 点击结果 `3` → toast「已复制 3」
- 点击某行进入编辑，其余行变暗，上游行描边

- [ ] **Step 7: Commit**

```bash
git add src/CalcDraft/
git commit -m "feat: row list with evaluation, copy cells, spotlight"
```

---

### Task 6: 行操作、页签增强与快捷键

**Files:**
- Modify: `src/CalcDraft/components/CalcRow.tsx`
- Modify: `src/CalcDraft/index.tsx`
- Modify: `src/CalcDraft/index.css`
- Create: `src/CalcDraft/components/PageTabs.tsx`

**Interfaces:**
- Consumes: Task 3 `docReducer`（deleteRow/moveRow/renamePage/deletePage/addPage）、Task 5 的 CalcDraft 状态
- Produces:
  - `<PageTabs pages activePageId onCreate onRename onDelete onSwitch />`
  - CalcRow 增加：hover 操作（复制表达式/复制结果/删除）、HTML5 拖拽
  - CalcDraft 全局快捷键：`Cmd/Ctrl+D`、`Cmd/Ctrl+Shift+N`、`Cmd/Ctrl+Enter`、`Alt+↑/↓`

- [ ] **Step 1: 创建 PageTabs**

创建 `src/CalcDraft/components/PageTabs.tsx`：

```tsx
import { useState } from 'react'
import type { Page } from '../state'

type PageTabsProps = {
  pages: Page[]
  activePageId: string
  onCreate: () => void
  onRename: (pageId: string, name: string) => void
  onDelete: (pageId: string) => void
  onSwitch: (pageId: string) => void
}

export default function PageTabs(props: PageTabsProps) {
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')

  const commitRename = (pageId: string) => {
    const name = draftName.trim()
    if (name) props.onRename(pageId, name)
    setEditingId(null)
  }

  return (
    <div className="cd-tabs">
      {props.pages.map((p) => (
        <div key={p.id} className="cd-tab-wrap">
          {editingId === p.id ? (
            <input
              className="cd-tab-input"
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onBlur={() => commitRename(p.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(p.id)
                if (e.key === 'Escape') setEditingId(null)
              }}
            />
          ) : (
            <button
              className={`cd-tab${p.id === props.activePageId ? ' cd-tab-active' : ''}`}
              onClick={() => props.onSwitch(p.id)}
              onDoubleClick={() => {
                setDraftName(p.name)
                setEditingId(p.id)
              }}
              onMouseEnter={() => setMenuFor(p.id)}
              onMouseLeave={() => setMenuFor(null)}
            >
              {p.name}
              {menuFor === p.id && p.id !== editingId && (
                <span
                  className="cd-tab-menu"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (props.pages.length <= 1) return
                    if (window.confirm(`删除「${p.name}」？`)) props.onDelete(p.id)
                  }}
                  title="删除页"
                >
                  ⋯
                </span>
              )}
            </button>
          )}
        </div>
      ))}
      <button className="cd-tab-add" title="新建草稿页" onClick={props.onCreate}>
        +
      </button>
    </div>
  )
}
```

- [ ] **Step 2: CalcRow 增加操作与拖拽**

在 `src/CalcDraft/components/CalcRow.tsx` 的 `CalcRowProps` 增加：

```ts
onDelete: () => void
onMove: (rowId: string, toIndex: number, position: 'before' | 'after') => void
onCopyExpr: () => void
onDragStateChange?: (dragging: boolean) => void
```

在行根 `div` 上增加拖拽属性与 hover 操作条（`cd-row-actions`）：

```tsx
<div
  className={classes}
  data-row-id={rowId}
  style={{ ['--row-color' as any]: color }}
  draggable={isEditing ? false : true}
  onDragStart={(e) => {
    e.dataTransfer.setData('text/row-id', rowId)
    e.dataTransfer.effectAllowed = 'move'
    props.onDragStateChange?.(true)
  }}
  onDragEnd={() => props.onDragStateChange?.(false)}
  onDragOver={(e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }}
  onDrop={(e) => {
    e.preventDefault()
    const fromId = e.dataTransfer.getData('text/row-id')
    if (!fromId || fromId === rowId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    props.onMove(fromId, index, position)
  }}
>
```

为支持 `onMove` 的 before/after 语义，CalcRow 需接收 `index: number`；在 `CalcDraft` 中换算：`toIndex = position === 'before' ? index : index + 1`（若 from < to 则减 1，由 reducer 按 id 重插实现时注意：reducer `moveRow` 按目标下标插入，调用前先删除再插入的语义已在 reducer 中通过 splice 实现，`toIndex` 传最终期望下标即可——实现时在 CalcDraft 内计算：先找 fromIndex，若 from < to 目标则 to 调整）。

hover 操作条 JSX（放在 `.cd-result` 之后）：

```tsx
<div className="cd-row-actions">
  <button type="button" title="复制表达式" onMouseDown={(e) => e.preventDefault()} onClick={props.onCopyExpr}>
    ⧉
  </button>
  <button type="button" title="删除行" onMouseDown={(e) => e.preventDefault()} onClick={props.onDelete}>
    ⌦
  </button>
</div>
```

对应样式：

```css
.cd-row-actions {
  display: none;
  gap: 4px;
  position: absolute;
  right: 10px;
  top: -10px;
}

.cd-row {
  position: relative;
}

.cd-row:hover .cd-row-actions {
  display: flex;
}

.cd-row-actions button {
  border: none;
  background: rgba(40, 44, 60, 0.95);
  color: #c0caf5;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}

.cd-tab-wrap {
  position: relative;
}

.cd-tab-menu {
  margin-left: 6px;
  opacity: 0.7;
}

.cd-tab-input {
  border: none;
  outline: none;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 13px;
  width: 110px;
}
```

- [ ] **Step 3: CalcDraft 接入页签、行操作与快捷键**

修改 `src/CalcDraft/index.tsx`：

1. 顶部栏改用 `PageTabs`：

```tsx
<PageTabs
  pages={doc.pages}
  activePageId={doc.activePageId}
  onCreate={() =>
    dispatch({
      type: 'addPage',
      pageId: crypto.randomUUID()
    })
  }
  onRename={(pageId, name) => dispatch({ type: 'renamePage', pageId, name })}
  onDelete={(pageId) => dispatch({ type: 'deletePage', pageId })}
  onSwitch={(pageId) => dispatch({ type: 'setActivePage', pageId })}
/>
```

2. CalcRow 传入删除/移动/复制表达式：

```tsx
const rows = page.rows
const handleMove = (fromId: string, toIndexBase: number, position: 'before' | 'after') => {
  const fromIndex = rows.findIndex((r) => r.id === fromId)
  if (fromIndex < 0) return
  let toIndex = position === 'before' ? toIndexBase : toIndexBase + 1
  if (fromIndex < toIndex) toIndex -= 1
  if (fromIndex === toIndex) return
  dispatch({ type: 'moveRow', pageId: page.id, rowId: fromId, toIndex })
}
```

在 map 中补：

```tsx
index={index}
onDelete={() => {
  dispatch({ type: 'deleteRow', pageId: page.id, rowId: row.id })
}}
onMove={handleMove}
onCopyExpr={() => handleCopy(row.expr)}
```

（`page.rows.map((row, index) => ...)`）

3. 全局快捷键（`useEffect` 挂载/卸载）：

```tsx
useEffect(() => {
  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      const row = page.rows.find((r) => r.id === activeRowId) || page.rows[page.rows.length - 1]
      if (!row) return
      const res = evaluation.results.get(row.id)
      if (res && res.status === 'ok') handleCopy(String(res.value))
      else showToast('无结果可复制')
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      dispatch({
        type: 'addPage',
        pageId: crypto.randomUUID()
      })
    } else if (mod && e.key === 'Enter') {
      e.preventDefault()
      addRow(page.rows[page.rows.length - 1]?.id)
    } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const rowId = activeRowId
      if (!rowId) return
      e.preventDefault()
      const fromIndex = page.rows.findIndex((r) => r.id === rowId)
      if (fromIndex < 0) return
      const toIndex = e.key === 'ArrowUp' ? fromIndex - 1 : fromIndex + 1
      if (toIndex < 0 || toIndex >= page.rows.length) return
      dispatch({ type: 'moveRow', pageId: page.id, rowId, toIndex })
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}, [page, activeRowId, evaluation])
```

- [ ] **Step 4: 类型检查 + 测试**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

手动验证：
- 页签双击重命名、hover ⋯ 删除（剩一页不可删）
- 行 hover 出现 ⧉/⌦；拖拽换序后 `#seq` 不变
- `Cmd/Ctrl+D` 复制、`Alt+↓` 下移、`Cmd/Ctrl+Enter` 末尾加行、`Cmd/Ctrl+Shift+N` 新页

- [ ] **Step 5: Commit**

```bash
git add src/CalcDraft/
git commit -m "feat: page tabs, row actions, drag reorder, shortcuts"
```

---

### Task 7: 构建与验收清单

**Files:**
- Modify: `README.md`（仅当需要同步功能描述时）
- 无新增业务代码（发现缺陷则修复并回归相关任务测试）

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 可发布的 `src-ztools/dist/` 构建产物

- [ ] **Step 1: 全量测试与类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 成功输出 `src-ztools/dist/`

- [ ] **Step 3: 对照规格走查（Success Criteria）**

逐项勾验 `docs/superpowers/specs/2026-09-23-calc-draft-design.md` §12：

1. 多行 `#N` 引用正确；中间插入/删除行引用不断链、结果正确
2. 同 `seq` 颜色一致，链路可追踪
3. 单击结果复制 + toast；`Alt+点击` 注入聚焦输入框
4. 多页独立保存，刷新/重开恢复
5. 界面：无边框、大圆角、阴影、卡片感、聚光灯（非活动行 0.55 透明度、上游描边）
6. 循环引用/未找到/除零行内红字，且不破坏其他行

另验 Review Focus 五条手工场景（删最大 seq 行再新建、环引用、中游编辑、损坏存储恢复、`0.1+0.2` 显示 `0.3`——最后一条以单测为准，UI 抽查）。

- [ ] **Step 4: 修复发现的问题（如有）**

每修复一处：补/改对应测试 → `npm test` → commit：

```bash
git add -A
git commit -m "fix: <description>"
```

- [ ] **Step 5: 最终 Commit（如有 README 更新）**

```bash
git add README.md docs/
git commit -m "docs: align readme with calc-draft features"
```

---

## Self-Review 记录

1. **Spec coverage:** 解析/求值/引用（T1-T2）、状态/持久化/多页（T3-4,6）、UI 布局/聚光灯/卡片（T4-5）、复制/注入/Toast（T5）、页签/行操作/快捷键（T6）、plugin.json/preload 清理（T4）、测试与构建（各任务+T7）——均有任务对应。`Shift+Enter` 编辑确认在 T5 CalcRow `onKeyDown` 覆盖。
2. **Placeholder scan:** T5 Step 4 曾留 `undefined as any` 占位 → 已在同段以文字强制要求实现为真实回调；无 TBD/TODO。
3. **Type consistency:** `CellResult`/`evaluatePage`/`colorForSeq`/`docReducer` action 形状跨任务一致；T6 新增 props（`index`/`onDelete`/`onMove`/`onCopyExpr`）在 T6 内定义并在 CalcDraft 同任务接线。
4. **Review Focus:** 五条均在所属任务有对应测试（T3：seq 不复用、损坏存储；T2：环、中游编辑、formatNumber）。
