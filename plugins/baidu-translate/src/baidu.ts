/**
 * 百度翻译领域常量：支持语言表、错误码映射、字节计算。
 * 语言与错误码以百度翻译开放平台文档为准（通用翻译 API）。
 *
 * @author yhx
 */

import type { LangOption } from './types'

/** 百度通用翻译支持的语言（auto 只能作为源语言） */
export const LANGS: LangOption[] = [
  { code: 'auto', name: '自动检测' },
  { code: 'zh', name: '中文' },
  { code: 'cht', name: '繁体中文' },
  { code: 'en', name: '英语' },
  { code: 'yue', name: '粤语' },
  { code: 'wyw', name: '文言文' },
  { code: 'jp', name: '日语' },
  { code: 'kor', name: '韩语' },
  { code: 'fra', name: '法语' },
  { code: 'spa', name: '西班牙语' },
  { code: 'th', name: '泰语' },
  { code: 'ara', name: '阿拉伯语' },
  { code: 'ru', name: '俄语' },
  { code: 'pt', name: '葡萄牙语' },
  { code: 'de', name: '德语' },
  { code: 'it', name: '意大利语' },
  { code: 'el', name: '希腊语' },
  { code: 'nl', name: '荷兰语' },
  { code: 'pl', name: '波兰语' },
  { code: 'bul', name: '保加利亚语' },
  { code: 'est', name: '爱沙尼亚语' },
  { code: 'dan', name: '丹麦语' },
  { code: 'fin', name: '芬兰语' },
  { code: 'cs', name: '捷克语' },
  { code: 'rom', name: '罗马尼亚语' },
  { code: 'slo', name: '斯洛文尼亚语' },
  { code: 'swe', name: '瑞典语' },
  { code: 'hu', name: '匈牙利语' },
  { code: 'vie', name: '越南语' }
]

/** 百度 API error_code → 用户能看懂的中文提示 */
export const ERROR_MSG: Record<string, string> = {
  NO_CONFIG: '尚未配置百度翻译密钥，请先到设置中填写',
  EMPTY_INPUT: '请输入要翻译的内容',
  NETWORK: '网络请求失败，请检查网络后重试',
  TIMEOUT: '请求超时，请重试',
  APPID_REQUIRED: '请填写 APPID',
  SECRET_REQUIRED: '请填写密钥（Secret Key）',
  ENCRYPT_FAIL: '密钥加密保存失败，请重试',

  BAIDU_52001: '请求超时，请重试',
  BAIDU_52002: '百度翻译服务临时不可用，请稍后重试',
  BAIDU_52003: 'APPID 无效或未被授权，请检查设置',
  BAIDU_54000: '请求参数缺失（一般是插件问题，请反馈）',
  BAIDU_54001: '签名错误，请核对 APPID 与密钥是否配套',
  BAIDU_54003: '请求过于频繁，请稍后再试',
  BAIDU_54004: '账户余额不足，请到百度翻译开放平台充值',
  BAIDU_54005: '请求过于频繁或文本过长，请稍后再试',
  BAIDU_58000: '百度翻译服务失败，请稍后重试',
  BAIDU_58001: '不支持的语言方向，请调整目标语言',
  BAIDU_58002: '百度翻译服务当前已关闭，请到开放平台检查',
  BAIDU_58003: '文本超出单次翻译上限（6000 字节），请分段翻译',
  BAIDU_90107: '认证失败或权限不足，请检查账号状态'
}

export function errMsgOf(code: string | undefined, msg?: string): string {
  if (!code) return '未知错误'
  const base = ERROR_MSG[code] || `翻译失败（错误码 ${code.replace(/^BAIDU_/, '')}）`
  // 网络类错误带上真实原因，方便定位（DNS/代理/HTTP 状态等）
  if ((code === 'NETWORK' || code === 'TIMEOUT') && msg) return `${base}（${msg}）`
  return base
}

/* ------------------------------------------------------------------ */
/* 词典数据解析（百度 dict 字段，数据源与 fanyi.baidu.com 同源）          */
/* ------------------------------------------------------------------ */

/** 词性释义组（简明词典） */
export interface DictPart {
  part: string
  means: string[]
}

/** 词形变化 */
export interface DictExchange {
  name: string
  values: string[]
}

/** 英英释义组 */
export interface DictEnDef {
  pos: string
  senses: string[]
  examples: string[]
  similar: string[]
}

/** 归一后的词典信息 */
export interface DictInfo {
  word: string
  /** 英式/美式/其他（中文词为拼音）音标 */
  phEn: string
  phAm: string
  phOther: string
  parts: DictPart[]
  /** 无词性结构的简明含义（中文词常见） */
  means: string[]
  /** 考试标签（高考 / CET4 / 考研…） */
  tags: string[]
  exchanges: DictExchange[]
  enDefs: DictEnDef[]
}

/** exchange 字段 key → 中文名 */
const EXCHANGE_LABELS: Record<string, string> = {
  word_pl: '复数',
  word_third: '第三人称单数',
  word_past: '过去式',
  word_done: '过去分词',
  word_ing: '现在分词',
  word_er: '比较级',
  word_est: '最高级'
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []
}

/**
 * 把百度 dict JSON 归一成 DictInfo；结构对不上返回 null。
 * 兼容英文 query（simple_means + edict）与中文 query（simple_means 为主）。
 */
export function buildDictInfo(raw: unknown): DictInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, any>
  const sm = root.word_result?.simple_means
  if (!sm || typeof sm !== 'object') return null

  /**
   * symbols 是数组：兼类词（如 claims / take）每个词性一段，各带自己的音标与 parts。
   * 必须遍历全部，只取 [0] 会把其他词性的含义全部丢掉（表现为"claims 只显示索赔"）。
   * 音标取第一个非空的，正常情况下各段一致。
   */
  const symbols = Array.isArray(sm.symbols) ? sm.symbols : []
  let phEn = ''
  let phAm = ''
  let phOther = ''
  const parts: DictPart[] = []
  const seen = new Set<string>()
  for (const sym of symbols) {
    if (!sym || typeof sym !== 'object') continue
    if (!phEn && typeof sym.ph_en === 'string' && sym.ph_en) phEn = sym.ph_en
    if (!phAm && typeof sym.ph_am === 'string' && sym.ph_am) phAm = sym.ph_am
    if (!phOther && typeof sym.ph_other === 'string' && sym.ph_other) phOther = sym.ph_other
    if (!Array.isArray(sym.parts)) continue
    for (const p of sym.parts) {
      if (!p || typeof p !== 'object') continue
      const means = strArr(p.means)
      if (!means.length) continue
      const key = String(p.part ?? '') + '\u0000' + means.join('\u0001')
      if (seen.has(key)) continue
      seen.add(key)
      parts.push({ part: String(p.part ?? ''), means })
    }
  }

  const exchanges: DictExchange[] = []
  const ex = sm.exchange
  if (ex && typeof ex === 'object') {
    for (const [key, label] of Object.entries(EXCHANGE_LABELS)) {
      const values = strArr((ex as Record<string, unknown>)[key])
      if (values.length) exchanges.push({ name: label, values })
    }
  }

  const enDefs: DictEnDef[] = []
  const edictItems = root.word_result?.edict?.item
  if (Array.isArray(edictItems)) {
    for (const entry of edictItems) {
      if (!entry || typeof entry !== 'object') continue
      const groups = Array.isArray(entry.tr_group) ? entry.tr_group : []
      for (const g of groups) {
        const senses = strArr(g?.tr)
        if (!senses.length) continue
        enDefs.push({
          pos: String(entry.pos ?? ''),
          senses,
          examples: strArr(g?.example),
          similar: strArr(g?.similar_word)
        })
      }
    }
  }

  return {
    word: String(sm.word_name ?? ''),
    phEn,
    phAm,
    phOther,
    parts,
    means: strArr(sm.word_means),
    tags: strArr(sm.tags?.core),
    exchanges,
    enDefs
  }
}

/** 百度返回的源语言代码 → 名称（给结果卡片显示"检测语言"用） */
export function langName(code: string | undefined): string {
  if (!code) return ''
  return LANGS.find((l) => l.code === code)?.name || code
}

/**
 * 生成英语变形词的原形候选（按可能性排序，最多 3 个）。
 * claims→claim / boxes→box / claimed→claim / stopped→stop / making→make / studies→study。
 */
export function lemmaCandidates(word: string): string[] {
  const w = word.toLowerCase()
  const out: string[] = []
  const push = (s: string) => {
    if (s && s !== w && /^[a-z][a-z'-]*$/.test(s) && !out.includes(s)) out.push(s)
  }
  if (w.endsWith('ies') && w.length > 4) push(w.slice(0, -3) + 'y')
  if (w.endsWith('ves') && w.length > 4) {
    push(w.slice(0, -3) + 'f')
    push(w.slice(0, -3) + 'fe')
  }
  if (w.endsWith('es') && w.length > 3) {
    push(w.slice(0, -1))
    push(w.slice(0, -2))
  } else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    push(w.slice(0, -1))
  }
  if (w.endsWith('ied') && w.length > 4) push(w.slice(0, -3) + 'y')
  if (w.endsWith('ed') && w.length > 4) {
    push(w.slice(0, -1))
    push(w.slice(0, -2))
  }
  if (w.endsWith('ing') && w.length > 5) {
    push(w.slice(0, -3) + 'e')
    push(w.slice(0, -3))
  }
  if (w.endsWith('er') && w.length > 4) {
    push(w.slice(0, -2))
    push(w.slice(0, -1))
  }
  if (w.endsWith('est') && w.length > 5) {
    push(w.slice(0, -3))
    push(w.slice(0, -2))
  }
  return out.slice(0, 3)
}

/** 词典内容丰富度评分（在原词词典与原形词典之间择优） */
export function dictScore(d: DictInfo | null): number {
  if (!d) return 0
  const means = d.parts.reduce((n, p) => n + p.means.length, 0) + d.means.length
  const enSenses = d.enDefs.reduce((n, e) => n + e.senses.length, 0)
  return means * 2 + enSenses + d.exchanges.length
}

/** 是否单个英文词（含连字符/撇号，如 well-known、don't） */
export function isEnglishWord(text: string): boolean {
  return /^[a-zA-Z][a-zA-Z'-]*$/.test(text.trim())
}

/** UTF-8 字节数（免费版单次 q 上限 6000 字节，字符数会超但字节数不一定） */
export function utf8Bytes(str: string): number {
  return new TextEncoder().encode(str).length
}

/**
 * 智能方向判定（配合 to='smart'）：
 *   - 出现日文假名 / 韩文 → 目标中文；
 *   - 中文为主（汉字数 ≥ 拉丁字母数）→ 目标英文；
 *   - 其余（纯英文等外文）→ 目标中文。
 */
export function pickSmartTarget(text: string): string {
  const t = String(text || '')
  if (/[\u3040-\u30ff]/.test(t) || /[\uac00-\ud7af]/.test(t)) return 'zh'
  const han = (t.match(/[\u4e00-\u9fff]/g) || []).length
  if (han > 0) {
    const latin = (t.match(/[A-Za-z]/g) || []).length
    return han >= latin ? 'en' : 'zh'
  }
  return 'zh'
}
