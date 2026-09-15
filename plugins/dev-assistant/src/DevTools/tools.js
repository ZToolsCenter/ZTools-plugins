export const TOOLS = [
  {
    id: 'json',
    name: 'JSON',
    description: '格式化、压缩、校验 JSON 文本',
    hint: '粘贴 JSON，实时展示格式化结果',
    sample: '{"name":"uTools","enabled":true,"items":[1,2,3]}',
    placeholder: '粘贴 JSON 文本…'
  },
  {
    id: 'base64',
    name: 'Base64',
    description: 'Base64 编解码',
    hint: '输入文本或 Base64，自动检测并编解码',
    sample: '研发助手 dev tools',
    placeholder: '输入文本或 Base64…'
  },
  {
    id: 'url',
    name: 'URL',
    description: 'URL 编解码',
    hint: '输入 URL 或参数片段，自动检测并编解码',
    sample: 'https://example.com/search?q=研发助手&mode=json',
    placeholder: '输入 URL 或参数片段…'
  },
  {
    id: 'sql-gorm',
    name: 'SQL转GORM',
    description: 'CREATE TABLE 转 Go GORM struct',
    hint: '粘贴 CREATE TABLE SQL，生成 GORM struct 和 TableName 方法',
    sample: 'CREATE TABLE `user_order` (\n  `id` bigint unsigned NOT NULL AUTO_INCREMENT,\n  `user_id` bigint NOT NULL COMMENT \'用户ID\',\n  `order_no` varchar(64) NOT NULL DEFAULT \'\',\n  `amount` decimal(10,2) NOT NULL DEFAULT 0.00,\n  `paid_at` datetime DEFAULT NULL,\n  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (`id`)\n);',
    placeholder: '粘贴 CREATE TABLE SQL…'
  },
  {
    id: 'json-go',
    name: 'JSON转Go',
    description: 'JSON 转 Go struct',
    hint: '粘贴 JSON 对象或对象数组，自动推导 Go struct',
    sample: '{"id":1,"name":"研发助手","tags":["tool"],"profile":{"enabled":true,"score":98.5}}',
    placeholder: '粘贴 JSON 对象或对象数组…'
  },
  {
    id: 'time',
    name: '时间戳',
    description: '时间戳与时间互转',
    hint: '输入时间戳或日期，实时转换',
    sample: '',
    placeholder: '时间戳或 2026-07-15 12:00:00，留空显示当前时间',
    autoRunEmpty: true
  },
  {
    id: 'union-decode',
    name: '返回值解压',
    description: 'Base64 + gzip 解压接口返回值',
    hint: '输入 Base64，自动解压 gzip 压缩内容',
    sample: 'eJwdiksKgDAMBe+StYtELa09S0Gqadz4ATUr8e7GbgbezHugnOe4HxAJEZu6tmuBCEm9ODIWnpM6wdZYupBUBM2ESbzVjGy+x5J0oJl/z65+CBrgfGeIu67r+wEVvCJN',
    placeholder: '输入 Base64 编码的 gzip 数据…'
  },
  {
    id: 'variable-naming',
    name: '变量命名',
    description: '中文短语转代码变量名',
    hint: '输入中文或短语，调用百度翻译后生成驼峰、下划线等变量名',
    sample: '用户订单金额',
    placeholder: '输入中文或短语，例如：用户订单金额'
  },
  {
    id: 'qrcode',
    name: '二维码',
    description: '生成二维码',
    hint: '输入任意文本或 URL，实时生成二维码',
    sample: 'https://utools.hellogithub.com',
    placeholder: '输入文本或 URL…',
    autoRunEmpty: false
  },
  {
    id: 'calc',
    name: '计算器',
    description: '多行计算稿纸，每行实时计算',
    hint: '每行输入一个表达式，支持 + - * / ** % 和 Math 函数',
    sample: '107 * 6.7\n700000 * 0.038\n33 * 200 + 2000',
    placeholder: '输入表达式，每行一个…'
  },
  {
    id: 'calendar',
    name: '日历',
    description: '月历视图与日期计算',
    hint: '查看月历，计算两个日期之差',
    sample: '',
    placeholder: '',
    autoRunEmpty: true
  },
  {
    id: 'crontab',
    name: 'Crontab',
    description: 'Cron 表达式解析与最近执行时间',
    hint: '输入 cron 表达式，实时解析含义并展示最近 10 次执行时间',
    sample: '*/5 * * * *',
    placeholder: '例如：0 9 * * 1-5'
  },
  {
    id: 'uuid',
    name: 'UUID',
    description: '生成 UUID v4',
    hint: '每次输入变化自动生成一个新 UUID',
    sample: '',
    placeholder: '输入任意字符触发生成，或直接留空',
    autoRunEmpty: true
  }
]

export function getToolById (toolId) {
  return TOOLS.find((t) => t.id === toolId) || TOOLS[0]
}

// 返回 { id, label, value }[] 数组，供 UI 逐行展示
export function getToolResults (toolId, input) {
  const raw = String(input ?? '').trim()

  switch (toolId) {
    case 'json':
      return jsonResults(raw)
    case 'base64':
      return base64Results(raw)
    case 'url':
      return urlResults(raw)
    case 'sql-gorm':
      return sqlGormResults(raw)
    case 'json-go':
      return jsonGoResults(raw)
    case 'time':
      return timeResults(raw)
    case 'calc':
      return calcResults(raw)
    case 'calendar':
      return [] // handled in UI
    case 'union-decode':
      return unionDecodeResults(raw)
    case 'variable-naming':
      return generateVariableNameResults(raw)
    case 'qrcode':
      return qrcodeResults(raw)
    case 'crontab':
      return crontabResults(raw)
    case 'uuid':
      return uuidResults()
    default:
      return []
  }
}

// ─── JSON ────────────────────────────────────────────────────────────────────

function jsonResults (raw) {
  if (!raw) return []

  // 判断输入是否是 JSON 字符串（以引号包裹的转义文本）
  const looksEscaped = raw.startsWith('"') && raw.endsWith('"')

  // 尝试 JSON 字符串反转义
  const unescapeResult = tryUnescapeJsonString(raw)

  // 尝试解析为 JSON 对象/数组
  let parsed = null
  let parseError = null
  const targetForParse = unescapeResult ?? raw
  try {
    parsed = JSON.parse(targetForParse)
  } catch (err) {
    parseError = err
  }

  const results = []

  // 如果反转义成功且是转义字符串，优先展示反转义结果
  if (looksEscaped && unescapeResult !== null) {
    results.push({ id: 'json-unescaped', label: '反转义', value: unescapeResult })

    // 再尝试对反转义结果做格式化
    try {
      const inner = JSON.parse(unescapeResult)
      results.push({ id: 'json-inner-format', label: '格式化（反转义内容）', value: JSON.stringify(inner, null, 2) })
      results.push({ id: 'json-inner-minify', label: '压缩（反转义内容）', value: JSON.stringify(inner) })
      results.push({ id: 'json-inner-escape', label: '转义（反转义内容）', value: JSON.stringify(JSON.stringify(inner)) })
    } catch {}

    return results
  }

  // 普通 JSON：解析失败则报错
  if (parsed === null && parseError !== null) {
    // 可能是普通文本，尝试转义
    results.push({ id: 'json-escaped', label: '转义为 JSON 字符串', value: JSON.stringify(raw) })
    return results
  }

  const type = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed
  const size = type === 'array'
    ? `${parsed.length} 个元素`
    : type === 'object'
      ? `${Object.keys(parsed).length} 个顶层字段`
      : type === 'string'
        ? `${parsed.length} 个字符`
        : '单值'

  results.push({ id: 'json-type', label: '类型', value: `${type}  ${size}` })
  results.push({ id: 'json-format', label: '格式化', value: JSON.stringify(parsed, null, 2) })
  results.push({ id: 'json-minify', label: '压缩', value: JSON.stringify(parsed) })
  results.push({ id: 'json-escaped', label: '转义为 JSON 字符串', value: JSON.stringify(JSON.stringify(parsed)) })

  return results
}

function tryUnescapeJsonString (raw) {
  if (!raw.startsWith('"')) return null
  try {
    const inner = JSON.parse(raw)
    if (typeof inner === 'string') return inner
  } catch {}
  return null
}

// ─── Base64 ──────────────────────────────────────────────────────────────────

function base64Results (raw) {
  if (!raw) return []
  const results = []

  // 编码
  results.push({ id: 'b64-encoded', label: '编码', value: encodeBase64(raw) })

  // 尝试解码
  try {
    const decoded = decodeBase64(raw)
    results.push({ id: 'b64-decoded', label: '解码', value: decoded })
  } catch {
    // 不是合法 Base64，不展示解码行
  }

  return results
}

function encodeBase64 (text) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64')
  }
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function decodeBase64 (text) {
  const normalized = normalizeBase64(text)
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(normalized, 'base64').toString('utf8')
  }
  const binary = atob(normalized)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function normalizeBase64 (text) {
  const value = text.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error('不是合法的 Base64')
  }
  return value + '='.repeat((4 - value.length % 4) % 4)
}

async function unionDecodeResults (raw) {
  if (!raw) return []

  const bytes = decodeBase64ToBytes(raw)
  const results = []

  const base64Text = decodeBytesToText(bytes)
  if (looksReadableText(base64Text)) {
    results.push({
      id: 'union-base64',
      label: 'Base64 解码',
      value: smartFormatText(base64Text)
    })
  }

  const decompressed = await tryDecompressBytes(bytes)
  if (decompressed) {
    const text = decodeBytesToText(decompressed.bytes)
    results.push({
      id: `union-${decompressed.format}`,
      label: `${decompressed.format.toUpperCase()} 解压`,
      value: smartFormatText(text)
    })
    return results
  }

  if (!results.length) {
    results.push({
      id: 'union-base64-info',
      label: 'Base64 解码',
      value: `已解码 ${bytes.length} 字节，但未识别到 gzip/deflate 压缩内容`
    })
  }

  return results
}

function decodeBase64ToBytes (text) {
  const normalized = normalizeBase64(text)
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'))
  }
  const binary = atob(normalized)
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function decodeBytesToText (bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf8')
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function looksReadableText (text) {
  const value = text.trim()
  if (!value) return false

  let printable = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) printable++
  }
  return printable / value.length >= 0.85
}

function smartFormatText (text) {
  const trimmed = text.trim()
  if (!trimmed) return text
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

async function tryDecompressBytes (bytes) {
  if (typeof DecompressionStream === 'undefined') return null

  for (const format of ['gzip', 'deflate']) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
      const arrayBuffer = await new Response(stream).arrayBuffer()
      return { format, bytes: new Uint8Array(arrayBuffer) }
    } catch {
      // 继续尝试下一种压缩格式
    }
  }

  return null
}

// ─── URL ─────────────────────────────────────────────────────────────────────

function urlResults (raw) {
  if (!raw) return []
  const results = []

  results.push({ id: 'url-encoded', label: '编码', value: encodeURIComponent(raw) })

  try {
    const decoded = decodeURIComponent(raw.replace(/\+/g, ' '))
    if (decoded !== raw) {
      results.push({ id: 'url-decoded', label: '解码', value: decoded })
    }
  } catch {
    // 非法编码，跳过
  }

  return results
}

// ─── SQL -> GORM / JSON -> Go struct ─────────────────────────────────────────

function sqlGormResults (raw) {
  if (!raw) return []

  const parsed = parseCreateTableStatement(raw)
  if (!parsed) {
    throw new Error('仅支持 CREATE TABLE 语句')
  }

  const imports = new Set()
  if (!parsed.columns.length) {
    throw new Error('未识别到表字段，请检查 CREATE TABLE 语句')
  }

  const structName = toGoStructName(parsed.tableName)
  const structLines = []

  for (const column of parsed.columns) {
    const fieldName = toGoFieldName(column.name)
    const goType = mapSqlColumnToGoType(column, imports)
    const gormParts = [`column:${column.name}`]
    if (column.primaryKey) gormParts.push('primaryKey')
    if (column.autoIncrement) gormParts.push('autoIncrement')
    if (column.unique) gormParts.push('unique')
    const tagParts = [`gorm:"${gormParts.join(';')}"`, `json:"${column.name}"`]
    const comment = column.comment ? `  // ${sanitizeComment(column.comment)}\n` : ''
    structLines.push(`${comment}  ${fieldName} ${goType} \`${tagParts.join(' ')}\``)
  }

  const lines = ['package models']
  if (imports.size) {
    lines.push('', 'import (')
    for (const imp of Array.from(imports).sort()) {
      lines.push(`  ${imp}`)
    }
    lines.push(')', '')
  } else {
    lines.push('')
  }

  lines.push(`type ${structName} struct {`)
  lines.push(...structLines)
  lines.push('}', '')
  lines.push(`func (${structName}) TableName() string {`)
  lines.push(`  return ${JSON.stringify(parsed.tableName)}`)
  lines.push('}')

  return [
    { id: 'sql-gorm-struct', label: 'Go GORM Struct', value: lines.join('\n') },
    { id: 'sql-gorm-table-name', label: 'TableName', value: parsed.tableName }
  ]
}

function parseCreateTableStatement (raw) {
  const normalized = String(raw ?? '').trim().replace(/;\s*$/, '')
  const match = /^create\s+table\s+(?:if\s+not\s+exists\s+)?((?:(?:`[^`]+`)|(?:"[^"]+")|(?:\[[^\]]+\])|(?:[A-Za-z0-9_]+)\.)?(?:`[^`]+`|"[^"]+"|\[[^\]]+\]|[A-Za-z0-9_]+))/i.exec(normalized)
  if (!match) return null

  const tableName = normalizeSqlIdentifier(match[1])
  const openIndex = normalized.indexOf('(', match.index + match[0].length - 1)
  if (openIndex === -1) return null

  const closeIndex = findMatchingParen(normalized, openIndex)
  if (closeIndex === -1) return null

  const body = normalized.slice(openIndex + 1, closeIndex)
  const items = splitTopLevel(body, ',')
  const columns = []
  const primaryKeys = new Set()

  for (const item of items) {
    const parsedItem = parseSqlTableItem(item)
    if (!parsedItem) continue
    if (parsedItem.kind === 'constraint') {
      for (const key of parsedItem.primaryKeys) primaryKeys.add(key)
      continue
    }
    columns.push(parsedItem)
  }

  if (primaryKeys.size) {
    for (const column of columns) {
      if (primaryKeys.has(column.name)) {
        column.primaryKey = true
      }
    }
  }

  return { tableName, columns }
}

function parseSqlTableItem (item) {
  const text = String(item ?? '').trim().replace(/,$/, '')
  if (!text) return null

  if (/^(primary\s+key|unique\s+key|unique\s+index|key|index|constraint|foreign\s+key|check)\b/i.test(text)) {
    return parseSqlTableConstraint(text)
  }

  const columnMatch = /^(?:`([^`]+)`|"([^"]+)"|\[([^\]]+)\]|([A-Za-z_][\w$]*))\s+([\s\S]+)$/i.exec(text)
  if (!columnMatch) return null

  const name = unquoteSqlIdentifier(columnMatch[1] ?? columnMatch[2] ?? columnMatch[3] ?? columnMatch[4])
  const tail = columnMatch[5].trim()
  const tokens = tail.split(/\s+/)
  const typeTokens = []
  let nullable = true
  let autoIncrement = false
  let primaryKey = false
  let unique = false
  let comment = ''

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const lower = token.toLowerCase()

    if (!typeTokens.length) {
      typeTokens.push(token)
      continue
    }

    if (lower === 'unsigned' || lower === 'zerofill') {
      typeTokens.push(token)
      continue
    }

    if (lower === 'not' && tokens[i + 1]?.toLowerCase() === 'null') {
      nullable = false
      i++
      continue
    }

    if (lower === 'null') {
      continue
    }

    if (lower === 'auto_increment') {
      autoIncrement = true
      continue
    }

    if (lower === 'primary' && tokens[i + 1]?.toLowerCase() === 'key') {
      primaryKey = true
      nullable = false
      i++
      continue
    }

    if (lower === 'unique') {
      unique = true
      if (tokens[i + 1]?.toLowerCase() === 'key' || tokens[i + 1]?.toLowerCase() === 'index') {
        i++
      }
      continue
    }

    if (lower === 'default' || lower === 'comment' || lower === 'references' || lower === 'collate' || lower === 'constraint' || lower === 'generated' || lower === 'as' || lower === 'on' || lower === 'update' || lower === 'check' || lower === 'character') {
      const rest = tokens.slice(i).join(' ')
      const commentMatch = /comment\s+('([^']*)'|"([^"]*)"|`([^`]*)`)/i.exec(rest)
      if (commentMatch) {
        comment = commentMatch[2] ?? commentMatch[3] ?? commentMatch[4] ?? ''
      }
      if (lower === 'default' && /\bnull\b/i.test(rest)) {
        nullable = true
      }
      break
    }
  }

  if (/\bnot\s+null\b/i.test(tail)) nullable = false
  if (/\bprimary\s+key\b/i.test(tail)) primaryKey = true
  if (/\bauto_increment\b/i.test(tail)) autoIncrement = true
  if (/\bunique\b/i.test(tail)) unique = true
  if (/\bdefault\s+null\b/i.test(tail)) nullable = true

  return {
    kind: 'column',
    name,
    sqlType: typeTokens.join(' ').trim(),
    nullable,
    autoIncrement,
    primaryKey,
    unique,
    comment
  }
}

function parseSqlTableConstraint (text) {
  const primaryKeys = []
  const primaryMatch = /primary\s+key\s*\(([^)]+)\)/i.exec(text)
  if (primaryMatch) {
    for (const token of primaryMatch[1].split(',')) {
      const name = unquoteSqlIdentifier(token.trim())
      if (name) primaryKeys.push(name)
    }
  }
  return { kind: 'constraint', primaryKeys }
}

function splitTopLevel (text, delimiter) {
  const result = []
  let current = ''
  let depth = 0
  let quote = null

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const prev = text[i - 1]

    if (quote) {
      current += ch
      if (ch === quote && prev !== '\\') quote = null
      continue
    }

    if (ch === '`' || ch === '"' || ch === '\'') {
      quote = ch
      current += ch
      continue
    }

    if (ch === '(') {
      depth++
      current += ch
      continue
    }

    if (ch === ')') {
      depth--
      current += ch
      continue
    }

    if (ch === delimiter && depth === 0) {
      if (current.trim()) result.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim()) result.push(current.trim())
  return result
}

function findMatchingParen (text, openIndex) {
  let depth = 0
  let quote = null

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    const prev = text[i - 1]

    if (quote) {
      if (ch === quote && prev !== '\\') quote = null
      continue
    }

    if (ch === '`' || ch === '"' || ch === '\'') {
      quote = ch
      continue
    }

    if (ch === '(') depth++
    if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

function normalizeSqlIdentifier (value) {
  const text = String(value ?? '').trim()
  const parts = splitTopLevel(text, '.')
  return unquoteSqlIdentifier(parts[parts.length - 1] ?? text)
}

function unquoteSqlIdentifier (value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return text.replace(/^\[/, '').replace(/\]$/, '').replace(/^`/, '').replace(/`$/, '').replace(/^"/, '').replace(/"$/, '')
}

function mapSqlColumnToGoType (column, imports) {
  const normalized = column.sqlType.toLowerCase()
  const nullable = column.nullable && !column.primaryKey && !column.autoIncrement
  let baseType = 'string'

  if (/\bbool(ean)?\b/.test(normalized) || /tinyint\s*\(\s*1\s*\)/.test(normalized)) {
    baseType = 'bool'
  } else if (/\b(bigint|int|integer|mediumint|smallint|tinyint)\b/.test(normalized)) {
    if (/unsigned/.test(normalized)) {
      if (/bigint/.test(normalized)) baseType = 'uint64'
      else if (/mediumint/.test(normalized) || /int\b/.test(normalized) || /integer/.test(normalized)) baseType = 'uint32'
      else if (/smallint/.test(normalized)) baseType = 'uint16'
      else baseType = 'uint8'
    } else {
      if (/bigint/.test(normalized)) baseType = 'int64'
      else if (/smallint/.test(normalized)) baseType = 'int16'
      else if (/tinyint/.test(normalized)) baseType = 'int8'
      else baseType = 'int'
    }
  } else if (/\b(decimal|numeric|double|float|real)\b/.test(normalized)) {
    baseType = 'float64'
  } else if (/\b(date|datetime|timestamp|time)\b/.test(normalized)) {
    baseType = 'time.Time'
    imports.add('"time"')
  } else if (/\b(json)\b/.test(normalized)) {
    baseType = 'json.RawMessage'
    imports.add('"encoding/json"')
  } else if (/\b(blob|binary|varbinary|bytea)\b/.test(normalized)) {
    baseType = '[]byte'
  } else {
    baseType = 'string'
  }

  if (nullable && !['[]byte', 'json.RawMessage'].includes(baseType) && !baseType.startsWith('[]')) {
    return `*${baseType}`
  }

  return baseType
}

function sanitizeComment (text) {
  return String(text ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function jsonGoResults (raw) {
  if (!raw) return []

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('请输入合法的 JSON')
  }

  const ctx = createGoInferenceContext()
  const rootType = inferJsonGoType(parsed, 'AutoGenerated', ctx)
  const code = renderGoStructFile(ctx, rootType)

  return [
    { id: 'json-go-struct', label: 'Go Struct', value: code },
    { id: 'json-go-root', label: 'Root Type', value: rootType }
  ]
}

function createGoInferenceContext () {
  return {
    defs: [],
    imports: new Set(),
    usedNames: new Set()
  }
}

function inferJsonGoType (value, typeName, ctx) {
  if (value === null || value === undefined) return 'any'
  if (Array.isArray(value)) {
    return inferJsonArrayType(value, typeName, ctx)
  }
  if (typeof value === 'object') {
    const structName = allocateStructName(typeName, ctx)
    if (!ctx.defs.some((def) => def.name === structName)) {
      ctx.defs.push(buildJsonStructDef(structName, [value], ctx))
    }
    return structName
  }
  return inferJsonScalarType(value)
}

function inferJsonArrayType (items, typeName, ctx) {
  const nonNull = items.filter((item) => item !== null && item !== undefined)
  if (!nonNull.length) return '[]any'

  if (nonNull.every((item) => typeof item === 'object' && !Array.isArray(item))) {
    const structName = allocateStructName(`${typeName}Item`, ctx)
    if (!ctx.defs.some((def) => def.name === structName)) {
      ctx.defs.push(buildJsonStructDef(structName, nonNull, ctx))
    }
    return `[]${structName}`
  }

  if (nonNull.every((item) => !Array.isArray(item) && typeof item !== 'object')) {
    const scalarType = inferJsonScalarArrayType(nonNull)
    return `[]${scalarType}`
  }

  if (nonNull.every((item) => Array.isArray(item))) {
    const innerSamples = nonNull.flatMap((item) => item)
    const innerType = inferJsonArrayType(innerSamples, `${typeName}Item`, ctx)
    return `[]${innerType}`
  }

  return '[]any'
}

function inferJsonScalarArrayType (values) {
  const kind = inferJsonScalarKind(values)
  if (!kind) return 'any'
  if (kind === 'string') return 'string'
  if (kind === 'number') {
    return values.every((value) => Number.isInteger(value)) ? 'int' : 'float64'
  }
  return kind
}

function buildJsonStructDef (structName, objects, ctx) {
  const keys = new Set()
  for (const object of objects) {
    for (const key of Object.keys(object)) {
      keys.add(key)
    }
  }

  const fields = []
  for (const key of Array.from(keys)) {
    const samples = objects
      .filter((object) => Object.prototype.hasOwnProperty.call(object, key))
      .map((object) => object[key])

    const fieldType = inferJsonFieldType(samples, objects.length, `${structName}${toGoTypeSegment(key)}`, ctx)
    fields.push({
      name: key,
      fieldName: toGoFieldName(key),
      type: fieldType.type,
      comment: fieldType.comment
    })
  }

  return {
    name: structName,
    fields
  }
}

function inferJsonFieldType (samples, totalCount, nestedTypeName, ctx) {
  const nonNull = samples.filter((value) => value !== null && value !== undefined)
  const nullable = samples.length < totalCount || samples.some((value) => value === null || value === undefined)

  if (!nonNull.length) {
    return { type: 'any' }
  }

  if (nonNull.every((value) => typeof value === 'boolean')) {
    return { type: nullable ? '*bool' : 'bool' }
  }

  if (nonNull.every((value) => typeof value === 'string')) {
    return { type: nullable ? '*string' : 'string' }
  }

  if (nonNull.every((value) => typeof value === 'number')) {
    const type = nonNull.every((value) => Number.isInteger(value)) ? 'int' : 'float64'
    return { type: nullable ? `*${type}` : type }
  }

  if (nonNull.every((value) => Array.isArray(value))) {
    const arrayType = inferJsonArrayType(nonNull.flatMap((value) => value), nestedTypeName, ctx)
    return { type: arrayType }
  }

  if (nonNull.every((value) => typeof value === 'object' && !Array.isArray(value))) {
    const structName = allocateStructName(nestedTypeName, ctx)
    if (!ctx.defs.some((def) => def.name === structName)) {
      ctx.defs.push(buildJsonStructDef(structName, nonNull, ctx))
    }
    return { type: nullable ? `*${structName}` : structName }
  }

  return { type: 'any' }
}

function inferJsonScalarKind (values) {
  if (!values.length) return null
  if (values.every((value) => typeof value === 'boolean')) return 'bool'
  if (values.every((value) => typeof value === 'string')) return 'string'
  if (values.every((value) => typeof value === 'number')) return 'number'
  return null
}

function inferJsonScalarType (value) {
  if (value === null || value === undefined) return 'any'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'number') return Number.isInteger(value) ? 'int' : 'float64'
  if (typeof value === 'string') return 'string'
  return 'any'
}

function allocateStructName (baseName, ctx) {
  const base = toGoStructName(baseName)
  let candidate = base
  let index = 2
  while (ctx.usedNames.has(candidate)) {
    candidate = `${base}${index}`
    index++
  }
  ctx.usedNames.add(candidate)
  return candidate
}

function renderGoStructFile (ctx, rootType) {
  const lines = ['package models']
  const importLines = Array.from(ctx.imports).sort()
  if (importLines.length) {
    lines.push('', 'import (')
    for (const imp of importLines) {
      lines.push(`  ${imp}`)
    }
    lines.push(')', '')
  } else {
    lines.push('')
  }

  for (const def of ctx.defs) {
    lines.push(`type ${def.name} struct {`)
    for (const field of def.fields) {
      const comment = field.comment ? `  // ${sanitizeComment(field.comment)}\n` : ''
      lines.push(`${comment}  ${field.fieldName} ${field.type} \`json:"${field.name}"\``)
    }
    lines.push('}', '')
  }

  lines.push(`// Root type: ${rootType}`)
  return lines.join('\n')
}

function toGoStructName (text) {
  const words = splitVariableWords(text)
  if (!words.length) return 'AutoGenerated'
  return words.map((word) => normalizeGoWord(word, true)).join('') || 'AutoGenerated'
}

function toGoFieldName (text) {
  const words = splitVariableWords(text)
  if (!words.length) return 'Field'
  return words.map((word) => normalizeGoWord(word, true)).join('') || 'Field'
}

function toGoTypeSegment (text) {
  return toGoStructName(text)
}

function normalizeGoWord (word, upperFirst = false) {
  const lower = String(word ?? '').toLowerCase()
  const acronym = GO_ACRONYMS[lower]
  if (acronym) return acronym
  if (/^\d+$/.test(lower)) return lower
  if (!lower) return ''
  if (upperFirst) return lower.charAt(0).toUpperCase() + lower.slice(1)
  return lower
}

const GO_ACRONYMS = {
  api: 'API',
  cpu: 'CPU',
  csv: 'CSV',
  db: 'DB',
  gorm: 'GORM',
  http: 'HTTP',
  https: 'HTTPS',
  html: 'HTML',
  id: 'ID',
  ip: 'IP',
  json: 'JSON',
  nil: 'Nil',
  os: 'OS',
  rpc: 'RPC',
  sql: 'SQL',
  ssh: 'SSH',
  ssl: 'SSL',
  tcp: 'TCP',
  tsv: 'TSV',
  ui: 'UI',
  uid: 'UID',
  url: 'URL',
  uuid: 'UUID',
  xml: 'XML'
}

// ─── 计算器 ───────────────────────────────────────────────────────────────────

export function evalLine (expr) {
  const trimmed = expr.trim()
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return null

  // 安全求值：只允许数字、运算符、括号、Math 方法
  const sanitized = trimmed
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\be\b/g, 'Math.E')
    .replace(/\b(abs|ceil|floor|round|sqrt|pow|log|log2|log10|sin|cos|tan|max|min|trunc|sign)\s*\(/g, 'Math.$1(')

  if (!/^[\d\s+\-*/%.()MathPIE,a-z_]+$/i.test(sanitized)) {
    return { error: '包含不允许的字符' }
  }

  try {
    // eslint-disable-next-line no-new-func
    const result = Function('"use strict"; return (' + sanitized + ')')()
    if (typeof result !== 'number' || !isFinite(result)) return { error: '计算结果无效' }
    return { value: result }
  } catch {
    return { error: '表达式错误' }
  }
}

function calcResults (raw) {
  if (!raw) return []
  const lines = raw.split('\n')
  return lines.map((line, i) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      return { id: `calc-${i}`, label: '', value: '', expr: line, skip: true }
    }
    const result = evalLine(trimmed)
    if (!result) return { id: `calc-${i}`, label: '', value: '', expr: line, skip: true }
    if (result.error) return { id: `calc-${i}`, label: trimmed, value: result.error, expr: line, isError: true }
    const formatted = Number.isInteger(result.value)
      ? result.value.toLocaleString('zh-CN')
      : parseFloat(result.value.toPrecision(12)).toLocaleString('zh-CN', { maximumFractionDigits: 10 })
    return { id: `calc-${i}`, label: trimmed, value: formatted, expr: line, raw: result.value }
  })
}

// ─── 时间戳 ──────────────────────────────────────────────────────────────────

function timeResults (raw) {
  const date = raw ? parseDateInput(raw) : new Date()
  const ms = date.getTime()
  return [
    { id: 'time-local', label: 'UTC+8 中国标准时间(本地时间)', value: formatLocalDateTime(date) },
    { id: 'time-date', label: 'UTC+8 中国标准时间(本地时间)，日期', value: formatLocalDate(date) },
    { id: 'time-sec', label: '时间戳(秒)', value: String(Math.floor(ms / 1000)) },
    { id: 'time-ms', label: '时间戳(毫秒)', value: String(ms) },
    { id: 'time-utc', label: '标准时间(UTC)', value: formatUtcDateTime(date) }
  ]
}

function formatLocalDateTime (date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatLocalDate (date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatUtcDateTime (date) {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

function pad (v) { return String(v).padStart(2, '0') }

function parseDateInput (value) {
  if (/^\d{10}$/.test(value)) return new Date(Number(value) * 1000)
  if (/^\d{13}$/.test(value)) return new Date(Number(value))

  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/.exec(value)
  if (m) {
    const [, y, mo, d, h = '0', mi = '0', s = '0'] = m
    return new Date(+y, +mo - 1, +d, +h, +mi, +s)
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error('无法识别日期时间，请使用 2026-07-15 12:00:00 格式')
  }
  return date
}

// ─── Crontab ──────────────────────────────────────────────────────────────────

function crontabResults (raw) {
  if (!raw) return []
  const parts = raw.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error('Cron 表达式需要 5 个字段：分 时 日 月 周')
  }
  const [min, hour, dom, month, dow] = parts
  const description = describeCron(min, hour, dom, month, dow)
  const nextTimes = getNextCronTimes(raw.trim(), 10)
  return [
    { id: 'cron-desc', label: '含义', value: description },
    { id: 'cron-next', label: '最近 10 次执行时间', value: nextTimes.map((d, i) => `第 ${i + 1} 次：${d}`).join('\n') }
  ]
}

function describeCron (min, hour, dom, month, dow) {
  let timeDesc = ''
  if (min === '*' && hour === '*') {
    timeDesc = '每分钟'
  } else if (min === '*') {
    timeDesc = `${hour === '*' ? '每小时' : `在 ${describeHours(hour)}`} 的每分钟`
  } else if (hour === '*') {
    timeDesc = `每小时的第 ${describeMinutes(min)} 分钟`
  } else {
    timeDesc = `在 ${describeHours(hour)} 的第 ${describeMinutes(min)} 分钟`
  }

  let result = timeDesc
  if (dom !== '*' && dow !== '*') {
    result += `，仅限每月 ${describeDay(dom)} 且 ${describeWeekday(dow)}`
  } else if (dom !== '*') {
    result += `，仅限每月 ${describeDay(dom)}`
  } else if (dow !== '*') {
    result += `，${describeWeekday(dow)}`
  }
  if (month !== '*') {
    result += `，限 ${describeMonth(month)}`
  }
  return result
}

function describeMinutes (expr) {
  if (expr.includes('/')) { const [, step] = expr.split('/'); return `每隔 ${step}` }
  if (expr.includes(',')) return expr.split(',').join('、')
  if (expr.includes('-')) { const [s, e] = expr.split('-'); return `${s} 到 ${e}` }
  return expr
}

function describeHours (expr) {
  if (expr.includes('/')) {
    const [start, step] = expr.split('/')
    return start === '*' ? `每隔 ${step} 小时` : `从 ${start}:00 起每隔 ${step} 小时`
  }
  if (expr.includes(',')) return expr.split(',').map((h) => `${h}:00`).join('、')
  if (expr.includes('-')) { const [s, e] = expr.split('-'); return `${s}:00 至 ${e}:59` }
  return `${expr}:00`
}

function describeDay (expr) {
  if (expr === 'L') return '最后一天'
  if (expr.includes('W')) return `最近工作日（${expr.replace('W', '')} 日附近）`
  if (expr.includes('/')) { const [, step] = expr.split('/'); return `每隔 ${step} 天` }
  if (expr.includes(',')) return expr.split(',').join('、') + ' 日'
  if (expr.includes('-')) { const [s, e] = expr.split('-'); return `${s} 至 ${e} 日` }
  return `${expr} 日`
}

function describeWeekday (expr) {
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const map = (v) => { const n = parseInt(v, 10); return n === 7 ? '周日' : (names[n] ?? v) }
  if (expr.includes(',')) return expr.split(',').map(map).join('、')
  if (expr.includes('-')) { const [s, e] = expr.split('-'); return `${map(s)} 至 ${map(e)}` }
  if (expr.includes('/')) { const [, step] = expr.split('/'); return `每隔 ${step} 天` }
  return map(expr)
}

function describeMonth (expr) {
  const names = ['', '一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
  const map = (v) => names[parseInt(v, 10)] ?? v
  if (expr.includes(',')) return expr.split(',').map(map).join('、')
  if (expr.includes('-')) { const [s, e] = expr.split('-'); return `${map(s)} 至 ${map(e)}` }
  return map(expr)
}

function getNextCronTimes (expr, count) {
  const parts = expr.split(/\s+/)
  if (parts.length !== 5) return []
  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts
  const results = []
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + 1)
  const maxTry = 366 * 24 * 60 * 2
  for (let i = 0; i < maxTry && results.length < count; i++) {
    if (matchesCron(d, minExpr, hourExpr, domExpr, monthExpr, dowExpr)) {
      results.push(formatCronDate(d))
    }
    d.setTime(d.getTime() + 60000)
  }
  return results
}

function matchesCron (d, minExpr, hourExpr, domExpr, monthExpr, dowExpr) {
  return (
    matchField(d.getMinutes(), minExpr, 0, 59) &&
    matchField(d.getHours(), hourExpr, 0, 23) &&
    matchField(d.getDate(), domExpr, 1, 31) &&
    matchField(d.getMonth() + 1, monthExpr, 1, 12) &&
    matchDow(d.getDay(), dowExpr)
  )
}

function matchField (value, expr, min, max) {
  if (expr === '*') return true
  for (const part of expr.split(',')) {
    if (matchPart(value, part, min, max)) return true
  }
  return false
}

function matchPart (value, part, min, max) {
  if (part.includes('/')) {
    const [range, stepStr] = part.split('/')
    const step = parseInt(stepStr, 10)
    const start = range === '*' ? min : parseInt(range.split('-')[0], 10)
    const end = range.includes('-') ? parseInt(range.split('-')[1], 10) : max
    if (value < start || value > end) return false
    return (value - start) % step === 0
  }
  if (part.includes('-')) {
    const [s, e] = part.split('-').map(Number)
    return value >= s && value <= e
  }
  if (part === 'L') return value === max
  return parseInt(part, 10) === value
}

function matchDow (dow, expr) {
  if (expr === '*') return true
  for (const part of expr.split(',')) {
    if (matchPart(dow, part.replace('7', '0'), 0, 6)) return true
  }
  return false
}

function formatCronDate (date) {
  const y = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${mo}-${d} ${h}:${mi}:00`
}

// ─── 变量命名 ─────────────────────────────────────────────────────────────────

export function generateVariableNameResults (englishText) {
  const words = splitVariableWords(englishText)
  if (!words.length) throw new Error('无法从翻译结果生成变量名')

  const lowerWords = words.map((word) => word.toLowerCase())
  const pascal = lowerWords.map(capitalize).join('')
  const camel = lowerWords[0] + lowerWords.slice(1).map(capitalize).join('')
  const snake = lowerWords.join('_')
  const kebab = lowerWords.join('-')
  const constant = snake.toUpperCase()

  return [
    { id: 'var-camel', label: 'camelCase', value: camel },
    { id: 'var-snake', label: 'snake_case', value: snake },
    { id: 'var-pascal', label: 'PascalCase', value: pascal },
    { id: 'var-kebab', label: 'kebab-case', value: kebab },
    { id: 'var-constant', label: 'CONSTANT_CASE', value: constant }
  ]
}

export function splitVariableWords (text) {
  const normalized = String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()

  if (!normalized) return []
  return normalized.split(/\s+/).filter(Boolean)
}

function capitalize (word) {
  if (!word) return ''
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// ─── 二维码 ───────────────────────────────────────────────────────────────────

function qrcodeResults (raw) {
  if (!raw) return []
  // 标记为异步，实际生成在 UI 层处理
  throw Object.assign(new Error('__qrcode__'), { text: raw })
}

// ─── UUID ─────────────────────────────────────────────────────────────────────

function uuidResults () {
  const crypto = globalThis.crypto
  let uuid
  if (crypto?.randomUUID) {
    uuid = crypto.randomUUID()
  } else {
    const bytes = new Uint8Array(16)
    if (crypto?.getRandomValues) crypto.getRandomValues(bytes)
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const h = [...bytes].map((b) => b.toString(16).padStart(2, '0'))
    uuid = [h.slice(0, 4), h.slice(4, 6), h.slice(6, 8), h.slice(8, 10), h.slice(10, 16)].map((g) => g.join('')).join('-')
  }
  return [{ id: 'uuid-v4', label: 'UUID v4', value: uuid }]
}
