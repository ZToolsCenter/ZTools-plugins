import jsep from 'jsep'

jsep.addIdentifierChar('#')
jsep.addBinaryOp('^', 11, true)
jsep.addBinaryOp('%', 10)

export type AtRef = { page: string; ref: string }  // 均为 1-based 序号字符串

export type ParseResult = {
  refs: number[]
  /** @页名#序号或备注 形式的跨草稿引用（已替换为 ASCII 占位标识符） */
  atRefs: AtRef[]
  /** @ 引用替换成占位符后的表达式，jsep 用它解析 */
  replaced: string
}

// 先把 @引用 预替换为纯 ASCII 占位标识符，jsep 不需要认识中文和 @。
// 完整形式 @页序号#行序号；输入中的裸 @查询（尚未选完）也占位，求值时报“引用未完成”
const AT_RE = /@(\d+)#([^#\s@+\-*/^%(),:]+)|@([^#\s@]*)$/g

export function parseExpression(expr: string): ParseResult {
  const atRefs: AtRef[] = []
  const replaced = expr.replace(AT_RE, (_m, page: string, ref: string, bare: string) => {
    const key = `_at${atRefs.length}_`
    atRefs.push({ page: bare !== undefined ? bare : page, ref: bare !== undefined ? '' : ref })
    return key
  })

  const ast = jsep(replaced)
  const refs: number[] = []
  walk(ast, (node: any) => {
    if (node.type === 'Identifier' && typeof node.name === 'string' && node.name.startsWith('#')) {
      const seq = Number(node.name.slice(1))
      if (Number.isInteger(seq) && seq >= 1 && !refs.includes(seq)) refs.push(seq)
    }
  })
  return { refs, atRefs, replaced }
}

function walk(node: any, visit: (node: any) => void): void {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const key of Object.keys(node)) {
    if (key === 'type') continue
    const value = node[key]
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}

export type DisplayToken =
  | { type: 'number' | 'ident' | 'other'; text: string }
  | { type: 'ref'; text: string; seq: number }
  | { type: 'atref'; text: string; page: string; ref: string }

const TOKEN_RE = /@(\d+)#([^#\s@+\-*/^%(),:]*)|#(\d+)|(\d+\.?\d*)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([\s\S])/g

export function tokenizeForDisplay(expr: string): DisplayToken[] {
  const tokens: DisplayToken[] = []
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(expr))) {
    if (m[1] !== undefined) {
      tokens.push({ type: 'atref', text: m[0], page: m[1], ref: m[2] })
    } else if (m[3] !== undefined) {
      tokens.push({ type: 'ref', text: `#${m[3]}`, seq: Number(m[3]) })
    } else if (m[4] !== undefined) {
      tokens.push({ type: 'number', text: m[0] })
    } else if (m[5] !== undefined) {
      tokens.push({ type: 'ident', text: m[0] })
    } else {
      tokens.push({ type: 'other', text: m[0] })
    }
  }
  return tokens
}
