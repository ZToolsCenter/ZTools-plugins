export const PINYIN_SCHEMES = [
  { value: 'quanpin',      label: '全拼' },
  { value: 'ziranma',      label: '双拼-自然' },
  { value: 'xiaohe',       label: '双拼-小鹤' },
  { value: 'pinyinjiajia', label: '双拼-加加' },
  { value: 'microsoft',    label: '双拼-微软' },
  { value: 'sogou',        label: '双拼-搜狗' },
] as const

export type PinyinScheme = typeof PINYIN_SCHEMES[number]['value']

export type DoubleSchemeName = Exclude<PinyinScheme, 'quanpin'>

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

export function fullToDouble(syllable: string, scheme: DoubleSchemeName): string {
  const smMap = SM_MAPS[scheme], ymMap = YM_MAPS[scheme]
  let sm = '', ym = syllable
  for (const s of SM_LIST) {
    if (syllable.startsWith(s)) { sm = smMap[s] ?? s[0]; ym = syllable.slice(s.length); break }
  }
  if (!sm && !ymMap[ym]) return syllable
  const ymKey = ymMap[ym] ?? ym.slice(-1)
  return sm ? sm + ymKey : (ym[0] ?? '') + ymKey
}

export interface PinyinCache {
  full: string
  initials: string
  double: Partial<Record<DoubleSchemeName, string>>
}

export function matchesPinyinCached(name: string, query: string, scheme: PinyinScheme, cache: PinyinCache): boolean {
  if (!name || !query) return false
  const q = query.toLowerCase()
  if (name.toLowerCase().includes(q)) return true
  if (cache.full.includes(q)) return true
  if (cache.initials.includes(q)) return true
  if (scheme !== 'quanpin' && cache.double[scheme as DoubleSchemeName]?.includes(q)) return true
  return false
}
