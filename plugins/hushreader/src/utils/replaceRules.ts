// 净化（替换）规则系统（对标开源阅读 Legado ReplaceRule + ContentProcessor）
// 规则按 书名/书源URL 匹配，阅读时对正文/标题逐条替换。

export interface ReplaceRule {
  id: string
  /** 规则名称 */
  name: string
  /** 分组 */
  group: string
  /** 替换内容（正则或普通字符串） */
  pattern: string
  /** 替换为 */
  replacement: string
  /** 作用范围：书名或书源URL（包含匹配，逗号分隔多个） */
  scope: string
  /** 排除范围 */
  excludeScope: string
  /** 作用于标题 */
  scopeTitle: boolean
  /** 作用于正文 */
  scopeContent: boolean
  /** 是否启用 */
  isEnabled: boolean
  /** 是否正则 */
  isRegex: boolean
  /** 排序（越小越先应用） */
  order: number
}

export function newReplaceRule(partial?: Partial<ReplaceRule>): ReplaceRule {
  return {
    id: `rp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    group: '',
    pattern: '',
    replacement: '',
    scope: '',
    excludeScope: '',
    scopeTitle: false,
    scopeContent: true,
    isEnabled: true,
    isRegex: true,
    order: 0,
    ...partial
  }
}

/** 校验规则：名称与替换内容必填，正则需可编译 */
export function validateReplaceRule(rule: ReplaceRule): string | null {
  if (!rule.name.trim()) return '缺少规则名称'
  if (!rule.pattern.trim()) return '缺少替换内容'
  if (rule.isRegex) {
    try {
      new RegExp(rule.pattern)
    } catch {
      return '正则表达式语法错误'
    }
    // 与 Legado 一致：以 | 结尾（非转义）的正则容易替换超时
    if (rule.pattern.endsWith('|') && !rule.pattern.endsWith('\\|')) {
      return '正则不能以 | 结尾（可能替换超时）'
    }
  }
  return null
}

/** 规则是否作用于当前书籍（对标 ReplaceRuleDao 的 scope 匹配） */
export function ruleMatchesBook(rule: ReplaceRule, bookName: string, bookOrigin: string): boolean {
  if (!rule.isEnabled) return false
  const name = bookName || ''
  const origin = bookOrigin || ''
  const scope = (rule.scope || '').trim()
  if (scope) {
    const scopes = scope.split(/[,，;；]/).map(s => s.trim()).filter(Boolean)
    const hit = scopes.some(s =>
      (name && (name.includes(s) || s.includes(name))) ||
      (origin && (origin.includes(s) || s.includes(origin)))
    )
    if (!hit) return false
  }
  const exclude = (rule.excludeScope || '').trim()
  if (exclude) {
    const excludes = exclude.split(/[,，;；]/).map(s => s.trim()).filter(Boolean)
    if (excludes.some(s =>
      (name && (name.includes(s) || s.includes(name))) ||
      (origin && (origin.includes(s) || s.includes(origin)))
    )) return false
  }
  return true
}

/** 对文本应用一组替换规则（正文），返回替换后的文本 */
export function applyContentReplaceRules(
  content: string,
  rules: ReplaceRule[],
  bookName: string,
  bookOrigin: string
): string {
  let result = content
  // 与 Legado 一致：替换前每行 trim
  result = result.split('\n').map(l => l.trim()).join('\n')
  const sorted = [...rules]
    .filter(r => r.scopeContent && ruleMatchesBook(r, bookName, bookOrigin))
    .sort((a, b) => a.order - b.order)
  for (const rule of sorted) {
    if (!rule.pattern) continue
    try {
      if (rule.isRegex) {
        result = result.replace(new RegExp(rule.pattern, 'g'), rule.replacement)
      } else {
        result = result.split(rule.pattern).join(rule.replacement)
      }
    } catch {
      /* 单条规则出错不影响其它规则 */
    }
  }
  return result
}

/** 对标题应用标题替换规则 */
export function applyTitleReplaceRules(
  title: string,
  rules: ReplaceRule[],
  bookName: string,
  bookOrigin: string
): string {
  let result = title
  const sorted = [...rules]
    .filter(r => r.scopeTitle && ruleMatchesBook(r, bookName, bookOrigin))
    .sort((a, b) => a.order - b.order)
  for (const rule of sorted) {
    if (!rule.pattern) continue
    try {
      if (rule.isRegex) {
        result = result.replace(new RegExp(rule.pattern, 'g'), rule.replacement)
      } else {
        result = result.split(rule.pattern).join(rule.replacement)
      }
    } catch {
      /* 忽略 */
    }
  }
  return result
}

/** 解析 Legado 净化规则 JSON（批量导入），兼容数组与单对象 */
export function parseReplaceRulesJson(text: string): ReplaceRule[] {
  const data = JSON.parse(text)
  const list = Array.isArray(data) ? data : [data]
  return list
    .filter((r: any) => r && typeof r === 'object' && (r.pattern || r.replaceRegex || r.replace))
    .map((r: any, i: number) => newReplaceRule({
      name: String(r.name || r.replaceName || `净化规则 ${i + 1}`),
      group: String(r.group || ''),
      pattern: String(r.pattern ?? r.replaceRegex ?? r.replace ?? ''),
      replacement: String(r.replacement ?? r.replacementValue ?? ''),
      scope: String(r.scope || ''),
      excludeScope: String(r.excludeScope || ''),
      scopeTitle: r.scopeTitle === true || r.scopeTitle === 1,
      scopeContent: r.scopeContent !== false && r.scopeContent !== 0,
      isEnabled: r.isEnabled !== false && r.isEnabled !== 0,
      isRegex: r.isRegex !== false && r.isRegex !== 0
    }))
}
