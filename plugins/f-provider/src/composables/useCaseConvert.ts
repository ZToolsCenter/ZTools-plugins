/**
 * 命名风格转换器（纯函数）：把任意英文/混合字符串拆成词，再按 8 种代码命名风格重组。
 *
 * 设计为纯函数模块，无 Vue 响应式依赖，可被任意视图直接 import 复用。
 * 语义翻译由 translation provider 完成；这里只负责把英文短语（provider 译文）
 * 转换成 camelCase / snake_case 等命名风格候选。
 */

/** 风格唯一标识。 */
export type CaseStyleKey =
  | 'camelCase'
  | 'PascalCase'
  | 'snake_case'
  | 'CONSTANT_CASE'
  | 'kebab-case'
  | 'camel_Snake'
  | 'Pascal_Snake'
  | 'flatcase'
  | 'UPPERFLAT'

/** 风格定义：key + 展示名 + 由 token 数组生成最终字符串的格式化函数。 */
export interface CaseStyle {
  key: CaseStyleKey
  /** 中文展示名（候选列表右侧标注用）。 */
  label: string
  /** 由小写 token 数组生成该风格的字符串。 */
  format: (tokens: string[]) => string
}

/**
 * 把任意字符串拆成小写词数组（tokenize）。
 * 兼容以下边界：
 *   - 空白 / 下划线 / 短横线 / 其它标点作为分隔符
 *   - camelCase / PascalCase 内部大小写边界（`userId` → `user id`）
 *   - 连续大写缩写（`HTTPServer` → `http server`）
 *   - 字母与数字边界（`userId2Name` → `user id 2 name`）
 *   - CJK 字符作为一个整体 token 保留（兜底：provider 译不出英文时原文仍可用）
 *
 * 例：`'userLoginRetry HTTPServer v2'` → `['user', 'login', 'retry', 'http', 'server', 'v', '2']`
 */
export function tokenize(input: string): string[] {
  if (!input) return []
  // 第一步：在大小写/数字/CJK 边界插入分隔符，统一成空格分隔的串再 split。
  //   (?<=[a-z])(?=[A-Z])            小写→大写边界：user|Id
  //   (?<=[A-Z])(?=[A-Z][a-z])       连续大写末尾：HTTP|Server
  //   (?<=[0-9])(?=[A-Za-z])         数字→字母：2|Name
  //   (?<=[A-Za-z])(?=[0-9])         字母→数字：v|2
  //   CJK 与非 CJK 之间也切一刀：用户|Name / Name|用户
  const SPLIT_RE = /(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[0-9])(?=[A-Za-z])|(?<=[A-Za-z])(?=[0-9])|([\u4e00-\u9fff\u3400-\u4dbf]+)|(?<=[\u4e00-\u9fff\u3400-\u4dbf])(?=[A-Za-z0-9])|(?<=[A-Za-z0-9])(?=[\u4e00-\u9fff\u3400-\u4dbf])/g
  // 上面 CJK 捕获组会把整段中文带走；用 replace 把它包成「 空格+中文+空格 」
  const withBoundaries = input
    .replace(SPLIT_RE, (m, cjk) => (cjk ? ' ' + cjk + ' ' : ' '))
    // 把所有非字母数字 CJK 的字符（标点、空白、-_等）统一成空格
    .replace(/[^A-Za-z0-9\u4e00-\u9fff\u3400-\u4dbf]+/g, ' ')
    .trim()
  if (!withBoundaries) return []
  return withBoundaries
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t) ? t : t.toLowerCase()))
}

// ─── 大小写工具 ──────────────────────────────────────────────────────
const cap = (w: string): string => (w ? w[0].toUpperCase() + w.slice(1) : w)

// ─── 8 种命名风格格式化器 ────────────────────────────────────────────
export const STYLES: CaseStyle[] = [
  {
    key: 'camelCase',
    label: '驼峰 camelCase',
    // 首词小写、其余词首字母大写：userLoginRetry
    format: (t) => t.map((w, i) => (i === 0 ? w : cap(w))).join('')
  },
  {
    key: 'PascalCase',
    label: '大驼峰 PascalCase',
    format: (t) => t.map(cap).join('')
  },
  {
    key: 'snake_case',
    label: '下划线 snake_case',
    format: (t) => t.join('_')
  },
  {
    key: 'CONSTANT_CASE',
    label: '常量 CONSTANT_CASE',
    format: (t) => t.map((w) => w.toUpperCase()).join('_')
  },
  {
    key: 'kebab-case',
    label: '短横线 kebab-case',
    format: (t) => t.join('-')
  },
  {
    key: 'camel_Snake',
    label: '混合 camel_Snake',
    // 首词小写、其余词大写，以下划线连接：user_Login_Retry
    format: (t) => t.map((w, i) => (i === 0 ? w : cap(w))).join('_')
  },
  {
    key: 'Pascal_Snake',
    label: '帕斯卡蛇 Pascal_Snake',
    format: (t) => t.map(cap).join('_')
  },
  {
    key: 'flatcase',
    label: '全小写 flatcase',
    format: (t) => t.join('')
  },
  {
    key: 'UPPERFLAT',
    label: '全大写 UPPERFLAT',
    format: (t) => t.map((w) => w.toUpperCase()).join('')
  }
]

/** 单条候选：风格 key + 展示名 + 转换后的字符串。 */
export interface CaseCandidate {
  key: CaseStyleKey
  label: string
  value: string
}

/**
 * 由英文短语生成全部风格的候选列表（保持 STYLES 顺序）。
 * 输入为空时返回空数组（调用方负责兜底）。
 */
export function toCandidates(englishText: string): CaseCandidate[] {
  const tokens = tokenize(englishText)
  if (!tokens.length) return []
  return STYLES.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.format(tokens)
  }))
}

/**
 * 判断文本是否「基本是英文」（含数字/标点，但无 CJK）。
 * 用于代码翻译视图决定是否跳过 provider 翻译直接走风格转换。
 */
export function isMostlyAscii(text: string): boolean {
  if (!text) return false
  return !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)
}
