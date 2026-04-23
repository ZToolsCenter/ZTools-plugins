// rename.js — 表名/列名批量替换
'use strict'

function replaceTableName(line, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `(INSERT\\s+INTO\\s+)(\`${escaped}\`|(?<!\`)\\b${escaped}\\b(?!\`))`,
    'i'
  )
  return line.replace(re, `$1\`${to}\``)
}

function replacePrefixTableName(line, fromPrefix, toPrefix) {
  const escaped = fromPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `(INSERT\\s+INTO\\s+)(\`${escaped}([^)\`\\s]*)\`|(?<!\`)\\b${escaped}(\\S*?)\\b(?![\`(]))`,
    'i'
  )
  return line.replace(re, (_m, prefix, _full, rest1, rest2) => {
    const rest = rest1 ?? rest2 ?? ''
    return `${prefix}\`${toPrefix}${rest}\``
  })
}

function replaceColumnName(line, from, to) {
  const valuesMatch = line.match(/VALUES\s*\(/i)
  if (!valuesMatch || valuesMatch.index === undefined) return line
  const beforeValues = line.slice(0, valuesMatch.index)
  const firstParen = beforeValues.indexOf('(')
  if (firstParen === -1) return line
  const colSection = beforeValues.slice(firstParen + 1, beforeValues.lastIndexOf(')'))
  const afterColSection = line.slice(firstParen + 1 + colSection.length)
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(\`${escaped}\`|(?<!\`)\\b${escaped}\\b(?!\`))`, 'gi')
  const newColSection = colSection.replace(re, `\`${to}\``)
  return beforeValues.slice(0, firstParen + 1) + newColSection + afterColSection
}

function applyRulesToLine(line, rules) {
  if (!/^INSERT\s+INTO\s+/i.test(line)) return line
  let result = line
  for (const rule of rules) {
    if (rule.from === rule.to) continue
    if (rule.type === 'table') result = replaceTableName(result, rule.from, rule.to)
    else if (rule.type === 'prefix') result = replacePrefixTableName(result, rule.from, rule.to)
    else if (rule.type === 'column') result = replaceColumnName(result, rule.from, rule.to)
  }
  return result
}

function renameSql(sql, rules) {
  if (!rules || rules.length === 0) return { sql, replacedCount: 0 }
  const lines = sql.split('\n')
  let replacedCount = 0
  const outputLines = lines.map((line) => {
    const trimmed = line.trimEnd()
    if (!/^INSERT\s+INTO\s+/i.test(trimmed)) return trimmed
    const modified = applyRulesToLine(trimmed, rules)
    if (modified !== trimmed) replacedCount++
    return modified
  })
  while (outputLines.length > 0 && outputLines[outputLines.length - 1].trim() === '') {
    outputLines.pop()
  }
  return { sql: outputLines.join('\n'), replacedCount }
}

module.exports = { renameSql }
