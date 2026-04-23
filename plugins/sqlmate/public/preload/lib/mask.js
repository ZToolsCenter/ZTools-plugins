// mask.js — 数据脱敏
'use strict'

const { parseInsertLine, splitMultiRowInsert, quoteTableName } = require('./dedupe')

const CHINESE_SURNAMES = ['王','李','张','刘','陈','杨','黄','赵','吴','周',
  '徐','孙','马','朱','胡','郭','何','高','林','郑']
const CHINESE_NAMES = ['伟','芳','娜','秀英','敏','静','丽','强','磊','洋',
  '艳','勇','军','杰','娟','涛','明','超','秀兰','霞']

function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function fakePhone(seed) {
  const h = hashCode(seed)
  const prefixes = ['130','131','132','133','134','135','136','137','138','139',
    '150','151','152','153','155','156','157','158','159','170','171','172',
    '173','175','176','177','178','180','181','182','183','184','185','186',
    '187','188','189']
  const prefix = prefixes[h % prefixes.length]
  const rest = String(((h * 1234567) % 100000000)).padStart(8, '0')
  return prefix + rest
}

function fakeIdCard(seed) {
  const h = hashCode(seed)
  const area = String(100000 + (h % 900000))
  const year = 1970 + (h % 40)
  const month = String(1 + (h % 12)).padStart(2, '0')
  const day = String(1 + (h % 28)).padStart(2, '0')
  const seq = String((h % 999) + 1).padStart(3, '0')
  return `${area}${year}${month}${day}${seq}X`
}

function fakeEmail(seed) {
  const h = hashCode(seed)
  return `user_${h % 100000}@example.com`
}

function fakeName(seed) {
  const h = hashCode(seed)
  const surname = CHINESE_SURNAMES[h % CHINESE_SURNAMES.length]
  const given = CHINESE_NAMES[(h >> 4) % CHINESE_NAMES.length]
  return surname + given
}

function applyMaskType(rawValue, rule, cache) {
  const isQuoted = rawValue.startsWith("'") && rawValue.endsWith("'")
  const inner = isQuoted ? rawValue.slice(1, -1).replace(/''/g, "'") : rawValue
  const cacheKey = `${rule.column}:${rule.type}:${inner}`

  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)
    return isQuoted ? `'${cached.replace(/'/g, "''")}'` : cached
  }

  let fakeInner
  switch (rule.type) {
    case 'phone':        fakeInner = fakePhone(cacheKey); break
    case 'id_card':      fakeInner = fakeIdCard(cacheKey); break
    case 'email':        fakeInner = fakeEmail(cacheKey); break
    case 'name':         fakeInner = fakeName(cacheKey); break
    case 'custom_mask':  fakeInner = rule.customValue ?? '***'; break
    case 'regex_replace': {
      if (!rule.regexPattern) { fakeInner = inner; break }
      try {
        const re = new RegExp(rule.regexPattern, 'g')
        fakeInner = inner.replace(re, rule.regexReplace ?? '***')
      } catch { fakeInner = inner }
      break
    }
    default: fakeInner = inner
  }

  cache.set(cacheKey, fakeInner)
  return isQuoted ? `'${fakeInner.replace(/'/g, "''")}'` : fakeInner
}

/**
 * 内部实现：接受外部 cache，允许跨调用保持一致性（流式处理用）
 */
function maskSqlWithCache(sql, rules, cache) {
  if (!rules || rules.length === 0) return { sql, maskedCount: 0, warnings: [] }

  const lines = sql.split('\n').flatMap(splitMultiRowInsert)
  let maskedCount = 0
  const warningSet = new Set()

  const outputLines = lines.map((line) => {
    const trimmed = line.trimEnd()
    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) return trimmed
    const parsed = parseInsertLine(trimmed)
    if (!parsed) return trimmed
    const { tableName, columns, values } = parsed
    if (!columns) return trimmed

    const newValues = [...values]
    let lineModified = false

    for (const rule of rules) {
      const idx = columns.findIndex((c) => c.toLowerCase() === rule.column.toLowerCase())
      if (idx === -1) { warningSet.add(`列 "${rule.column}" 不存在，已跳过`); continue }
      const original = newValues[idx]
      const masked = applyMaskType(original, rule, cache)
      if (masked !== original) { newValues[idx] = masked; lineModified = true }
    }

    if (!lineModified) return trimmed
    maskedCount++
    const colPart = `(${columns.map((c) => `\`${c}\``).join(', ')})`
    return `INSERT INTO ${quoteTableName(tableName)} ${colPart} VALUES (${newValues.join(', ')});`
  })

  while (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() === '') {
    outputLines.pop()
  }

  return { sql: outputLines.join('\n'), maskedCount, warnings: Array.from(warningSet) }
}

function maskSql(sql, rules) {
  return maskSqlWithCache(sql, rules, new Map())
}

module.exports = { maskSql, maskSqlWithCache }
