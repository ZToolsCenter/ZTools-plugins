import { pinyin } from 'pinyin-pro'

export const PINYIN_SCHEMES = [
  { value: 'quanpin',      label: '全拼' },
  { value: 'ziranma',      label: '双拼-自然' },
  { value: 'xiaohe',       label: '双拼-小鹤' },
  { value: 'pinyinjiajia', label: '双拼-加加' },
  { value: 'microsoft',    label: '双拼-微软' },
  { value: 'sogou',        label: '双拼-搜狗' },
] as const

export type PinyinScheme = typeof PINYIN_SCHEMES[number]['value']

type DoubleSchemeName = Exclude<PinyinScheme, 'quanpin'>

// 双拼映射表
const YM_MAPS: Record<DoubleSchemeName, Record<string, string>> = {
  ziranma:      {a:'a',o:'o',e:'e',i:'i',u:'u',v:'v',ai:'l',ei:'z',ui:'v',ao:'k',ou:'b',iu:'q',ie:'x',ue:'t',ve:'t',er:'r',an:'j',en:'f',in:'n',un:'p',vn:'y',ang:'h',eng:'g',ing:'k',ong:'s',ia:'w',ua:'w',uo:'o',iao:'c',iou:'q',ian:'m',uan:'r',van:'p',iang:'d',uang:'d',uai:'y',ueng:'s',iong:'s'},
  xiaohe:       {a:'a',o:'o',e:'e',i:'i',u:'u',v:'v',ai:'d',ei:'w',ui:'v',ao:'c',ou:'z',iu:'q',ie:'p',ue:'t',ve:'t',er:'r',an:'j',en:'f',in:'b',un:'y',vn:'y',ang:'h',eng:'g',ing:'k',ong:'s',ia:'x',ua:'x',uo:'o',iao:'n',iou:'q',ian:'m',uan:'r',van:'r',iang:'l',uang:'l',uai:'k',ueng:'s',iong:'s'},
  pinyinjiajia: {a:'a',o:'o',e:'e',i:'i',u:'u',v:'v',ai:'q',ei:'p',ui:'v',ao:'z',ou:'b',iu:'n',ie:'x',ue:'t',ve:'t',er:'r',an:'j',en:'f',in:'k',un:'l',vn:'y',ang:'h',eng:'g',ing:'m',ong:'s',ia:'d',ua:'d',uo:'o',iao:'c',iou:'n',ian:'w',uan:'r',van:'y',iang:'y',uang:'y',uai:'y',ueng:'s',iong:'s'},
  microsoft:    {a:'a',o:'o',e:'e',i:'i',u:'u',v:'v',ai:'l',ei:'z',ui:'v',ao:'k',ou:'b',iu:'q',ie:'x',ue:'t',ve:'t',er:'r',an:'j',en:'f',in:'n',un:'p',vn:'y',ang:'h',eng:'g',ing:'k',ong:'s',ia:'w',ua:'w',uo:'o',iao:'c',iou:'q',ian:'m',uan:'r',van:'p',iang:'d',uang:'d',uai:'y',ueng:'s',iong:'s'},
  sogou:        {a:'a',o:'o',e:'e',i:'i',u:'u',v:'v',ai:'l',ei:'z',ui:'v',ao:'k',ou:'b',iu:'q',ie:'x',ue:'t',ve:'t',er:'r',an:'j',en:'f',in:'n',un:'p',vn:'y',ang:'h',eng:'g',ing:'k',ong:'s',ia:'w',ua:'w',uo:'o',iao:'c',iou:'q',ian:'m',uan:'r',van:'p',iang:'d',uang:'d',uai:'y',ueng:'s',iong:'s'},
}

const SM_MAPS: Record<DoubleSchemeName, Record<string, string>> = {
  ziranma:      {zh:'v',ch:'i',sh:'u'},
  xiaohe:       {zh:'v',ch:'i',sh:'u'},
  pinyinjiajia: {zh:'v',ch:'u',sh:'i'},
  microsoft:    {zh:'v',ch:'i',sh:'u'},
  sogou:        {zh:'v',ch:'i',sh:'u'},
}

const SM_LIST = ['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s','y','w']

function fullToDouble(syllable: string, scheme: DoubleSchemeName): string {
  const smMap = SM_MAPS[scheme], ymMap = YM_MAPS[scheme]
  let sm = '', ym = syllable
  for (const s of SM_LIST) {
    if (syllable.startsWith(s)) { sm = smMap[s] ?? s[0]; ym = syllable.slice(s.length); break }
  }
  // 韵母在映射表中才认为是合法拼音音节，否则原样返回（数字、英文等）
  if (!sm && !ymMap[ym]) return syllable
  const ymKey = ymMap[ym] ?? ym.slice(-1)
  return sm ? sm + ymKey : (ym[0] ?? '') + ymKey
}

export function matchesPinyin(name: string, query: string, scheme: PinyinScheme): boolean {
  if (!name || !query) return false
  const q = query.toLowerCase()

  // 1. 原文匹配
  if (name.toLowerCase().includes(q)) return true

  // 2. 用 pinyin-pro 获取每个字的全拼数组
  const syllables = pinyin(name, { toneType: 'none', type: 'array' }) as string[]

  // 3. 全拼连写
  if (syllables.join('').includes(q)) return true

  // 4. 首字母
  if (syllables.map(s => s[0]).join('').includes(q)) return true

  // 5. 双拼
  if (scheme !== 'quanpin') {
    const dp = syllables.map(s => fullToDouble(s, scheme as DoubleSchemeName)).join('')
    if (dp.includes(q)) return true
  }

  return false
}

export interface PinyinCache {
  full: string    // 全拼连写
  initials: string // 首字母
  double: Partial<Record<DoubleSchemeName, string>> // 各双拼方案
}

/**
 * 预计算一个名称的所有拼音形式，结果可缓存复用
 */
export function buildPinyinCache(name: string): PinyinCache {
  const syllables = pinyin(name, { toneType: 'none', type: 'array' }) as string[]
  const full = syllables.join('')
  const initials = syllables.map(s => s[0]).join('')
  const double: Partial<Record<DoubleSchemeName, string>> = {}
  for (const scheme of ['ziranma', 'xiaohe', 'pinyinjiajia', 'microsoft', 'sogou'] as DoubleSchemeName[]) {
    double[scheme] = syllables.map(s => fullToDouble(s, scheme)).join('')
  }
  return { full, initials, double }
}

/**
 * 使用预计算缓存进行匹配，避免重复调用 pinyin-pro
 */
export function matchesPinyinCached(name: string, query: string, scheme: PinyinScheme, cache: PinyinCache): boolean {
  if (!name || !query) return false
  const q = query.toLowerCase()

  if (name.toLowerCase().includes(q)) return true
  if (cache.full.includes(q)) return true
  if (cache.initials.includes(q)) return true
  if (scheme !== 'quanpin' && cache.double[scheme as DoubleSchemeName]?.includes(q)) return true

  return false
}
