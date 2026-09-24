import {
  convertNamingByCode,
  hasConvertibleNaming,
  isNamingCode,
  withEdgeWhitespace,
} from './naming.js'

/** 全部功能码 */
export type CaseFeatureCode =
  | 'smart'
  | 'upper'
  | 'lower'
  | 'invert'
  | 'title'
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'screaming'

const ENGLISH_LETTER = /[A-Za-z]/

/** 是否包含至少一个英文字母 */
export function hasEnglishLetter(text: string): boolean {
  return ENGLISH_LETTER.test(text)
}

export { hasConvertibleNaming, isNamingCode }

/**
 * 智能转换：仅统计英文字母
 * 大写多于小写则转小写，否则转大写
 */
export function smartConvert(text: string): string {
  let upper = 0
  let lower = 0
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') upper++
    else if (ch >= 'a' && ch <= 'z') lower++
  }
  return upper > lower ? text.toLowerCase() : text.toUpperCase()
}

export function toUpper(text: string): string {
  return text.toUpperCase()
}

export function toLower(text: string): string {
  return text.toLowerCase()
}

/** 大小写反转 */
export function invertCase(text: string): string {
  let result = ''
  for (const ch of text) {
    if (ch >= 'A' && ch <= 'Z') result += ch.toLowerCase()
    else if (ch >= 'a' && ch <= 'z') result += ch.toUpperCase()
    else result += ch
  }
  return result
}

/** 按功能码转换，未知码返回 null */
export function convertByCode(code: string, text: string): string | null {
  if (isNamingCode(code)) {
    return convertNamingByCode(code, text)
  }
  switch (code as CaseFeatureCode) {
    case 'smart':
      return withEdgeWhitespace(text, smartConvert)
    case 'upper':
      return withEdgeWhitespace(text, toUpper)
    case 'lower':
      return withEdgeWhitespace(text, toLower)
    case 'invert':
      return withEdgeWhitespace(text, invertCase)
    default:
      return null
  }
}

/** 成功提示文案 */
export function successMessage(code: string): string {
  switch (code as CaseFeatureCode) {
    case 'smart':
      return '已智能转换大小写'
    case 'upper':
      return '已转为大写'
    case 'lower':
      return '已转为小写'
    case 'invert':
      return '已反转大小写'
    case 'title':
      return '已转为首字母大写'
    case 'camel':
      return '已转为小驼峰'
    case 'pascal':
      return '已转为大驼峰'
    case 'snake':
      return '已转为蛇形命名'
    case 'screaming':
      return '已转为尖叫蛇形'
    default:
      return '转换完成'
  }
}
