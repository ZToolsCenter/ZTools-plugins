// loginCheckJs 求值器（纯函数，可独立测试）
// 对标开源阅读（Legado）书源的 loginCheckJs 字段：
//   Legado 用 Rhino 执行任意 JS；本实现无 JS 引擎，支持社区书源最常用的
//   `cookie.contains("xxx")` / `url.contains(...)` / `body.contains(...)` /
//   `!` 取反 / `&&` / `||` 组合 / `{{cookie}}` 变量引用。
//   返回值：true = 已登录；false = 未登录；null = 无法求值（未知）。

export interface LoginCheckContext {
  /** 当前书源的 cookie（jar + 手动 cookie 合并后） */
  cookie: string
  url?: string
  body?: string
}

/** 顶层按 || 拆分（忽略括号内） */
function splitTopLevel(expr: string, sep: '&&' | '||'): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && expr.startsWith(sep, i)) {
      parts.push(cur)
      cur = ''
      i += sep.length - 1
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  return parts
}

/** 求值单个原子条件：`X.contains("str")` / `X.includes('str')` / 裸变量 / 未知返回 null */
function evalTerm(term: string, ctx: LoginCheckContext): boolean | null {
  let t = term.trim().replace(/;\s*$/, '')
  let negate = false
  while (t.startsWith('!')) {
    negate = !negate
    t = t.slice(1).trim()
  }
  while (t.startsWith('(') && t.endsWith(')')) {
    t = t.slice(1, -1).trim()
  }
  if (!t) return null

  // cookie.contains("xxx") / url.contains('xxx') / body.contains("xxx")
  const m = /^(\w+)\.(?:contains|includes)\(\s*(['"])(.*?)\2\s*\)$/.exec(t)
  if (m) {
    const [, varName, , needle] = m
    const haystack = varName === 'cookie' ? ctx.cookie
      : varName === 'url' ? (ctx.url || '')
      : varName === 'body' ? (ctx.body || '')
      : undefined
    if (haystack === undefined) return null
    const r = haystack.includes(needle)
    return negate ? !r : r
  }

  // 裸变量：cookie / url / body —— 非空即已登录
  if (/^(cookie|url|body)$/.test(t)) {
    const v = t === 'cookie' ? ctx.cookie : t === 'url' ? (ctx.url || '') : (ctx.body || '')
    const r = v.length > 0
    return negate ? !r : r
  }

  // 无法识别的表达式（如 Java 方法调用）→ 未知
  return null
}

/** 求值 loginCheckJs 表达式 */
export function evalLoginCheck(expr: string | undefined | null, ctx: LoginCheckContext): boolean | null {
  if (!expr || !expr.trim()) return null
  let text = expr.trim()
  // {{cookie}} / {{url}} / {{body}} 变量引用替换为字面值
  text = text.replace(/\{\{\s*(cookie|url|body)\s*\}\}/g, (_m, name: string) => {
    const v = name === 'cookie' ? ctx.cookie : name === 'url' ? (ctx.url || '') : (ctx.body || '')
    return `"${v.replace(/"/g, '\\"')}"`
  })
  // JS 变量声明剥离：var x = ...; return ... 取 return 之后部分
  const retIdx = text.lastIndexOf('return')
  if (retIdx >= 0) text = text.slice(retIdx + 6)

  // 按 || 拆分：任一为 true → true；任一为 null 且无 true → null
  const orParts = splitTopLevel(text, '||')
  let sawUnknown = false
  for (const orPart of orParts) {
    // 按 && 拆分：全部 true → true
    const andParts = splitTopLevel(orPart, '&&')
    let andResult: boolean | null = true
    for (const andPart of andParts) {
      const r = evalTerm(andPart, ctx)
      if (r === null) {
        andResult = null
        break
      }
      if (!r) {
        andResult = false
        break
      }
    }
    if (andResult === true) return true
    if (andResult === null) sawUnknown = true
  }
  if (sawUnknown) return null
  return false
}
