import type { FileItem, NumberRule, SequenceStyle } from './session'

const chineseDigits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const financialDigits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const chineseUnits = ['', '十', '百', '千']
const financialUnits = ['', '拾', '佰', '仟']

function formatChinese(value: number, financial: boolean): string {
  if (!Number.isFinite(value)) return String(value)
  const integer = Math.trunc(value)
  if (integer < 0) return `负${formatChinese(-integer, financial)}`
  if (integer === 0) return '零'

  const digits = financial ? financialDigits : chineseDigits
  const units = financial ? financialUnits : chineseUnits
  const groupUnits = ['', '万', '亿', '兆']
  const groups: { value: number; text: string; position: number }[] = []
  let remaining = integer
  let position = 0
  while (remaining > 0) {
    const group = remaining % 10000
    let part = ''
    let zeroPending = false
    for (let digitPosition = 0; digitPosition < 4; digitPosition += 1) {
      const digit = Math.floor(group / (10 ** digitPosition)) % 10
      if (!digit) {
        if (part && group % (10 ** (digitPosition + 1)) !== 0) zeroPending = true
        continue
      }
      if (zeroPending) part = digits[0] + part
      zeroPending = false
      let unit = units[digitPosition]
      const omitLeadingOne = !financial && digitPosition === 1 && digit === 1 && group < 20
      if (omitLeadingOne) unit = '十'
      part = `${omitLeadingOne ? '' : digits[digit]}${unit}${part}`
    }
    if (part) groups.unshift({ value: group, text: part, position })
    remaining = Math.floor(remaining / 10000)
    position += 1
  }
  let result = ''
  let previousPosition = -1
  for (const group of groups) {
    if (result && (group.position < previousPosition - 1 || group.value < 1000)) result += digits[0]
    result += group.text + (groupUnits[group.position] ?? '')
    previousPosition = group.position
  }
  return result
}

function formatAlpha(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  let remaining = Math.trunc(value)
  if (remaining < 1) return String(remaining)
  let result = ''
  while (remaining > 0) {
    remaining -= 1
    result = String.fromCharCode(97 + remaining % 26) + result
    remaining = Math.floor(remaining / 26)
  }
  return result
}

export function formatSequence(value: number, style: SequenceStyle, digits: number): string {
  switch (style) {
    case 'arabic':
      return String(Math.trunc(value)).padStart(Math.max(0, Math.trunc(digits)), '0')
    case 'chinese-lower':
      return formatChinese(value, false)
    case 'chinese-upper':
      return formatChinese(value, true)
    case 'alpha-lower':
      return formatAlpha(value)
    case 'alpha-upper':
      return formatAlpha(value).toUpperCase()
  }
}

export function applyNumberRule(file: FileItem, index: number, rule: NumberRule): string {
  const sequence = formatSequence(rule.start + index, rule.style, rule.digits)
  return `${rule.prefix}${sequence}${rule.suffix}${file.extension}`
}
