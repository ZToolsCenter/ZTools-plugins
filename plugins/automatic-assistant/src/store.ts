import type { CategoryDoc, Feature, ScriptDoc } from './types'
import { INSET_SCRIPTS } from './insets'

export const SCRIPT_PREFIX = 'scripts/'
export const CATEGORY_PREFIX = 'category/'

export const hasZtools = () => typeof window.ztools !== 'undefined'

// 与原版一致：feature.code 为纯时间戳字符串，文档 _id = 'scripts/' + code
export const newScriptCode = () => Date.now().toString()
export const newCategoryId = () => CATEGORY_PREFIX + Date.now()

// ===== 分类 =====

// 分类排序（复刻原版 mp）：首字母为拉丁字母时按码点比较，否则用 Intl.Collator
export function sortCategories(list: CategoryDoc[]): CategoryDoc[] {
  if (list.length < 2) return list
  const collator = new Intl.Collator()
  const latin = /^[a-zA-Z]/
  return list.sort((a, b) =>
    latin.test(a.label) || latin.test(b.label)
      ? a.label > b.label
        ? 1
        : a.label < b.label
          ? -1
          : 0
      : collator.compare(a.label, b.label)
  )
}

// 脚本排序（复刻原版 fp）：按首条指令的文本/label
export function sortScripts(list: ScriptDoc[]): ScriptDoc[] {
  if (list.length < 2) return list
  const collator = new Intl.Collator()
  const latin = /^[a-zA-Z]/
  const key = (doc: ScriptDoc) => {
    const cmd = doc.feature.cmds?.[0]
    return typeof cmd === 'string' ? cmd : typeof cmd === 'object' && cmd ? cmd.label : ''
  }
  return list.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return latin.test(ka) || latin.test(kb) ? (ka > kb ? 1 : ka < kb ? -1 : 0) : collator.compare(ka, kb)
  })
}

// 默认分类优先，否则第一个（复刻原版 _p）
export function defaultCategory(list: CategoryDoc[]): CategoryDoc | undefined {
  return list.find((c) => c.label === '默认分类') || list[0]
}

export function listCategories(): CategoryDoc[] {
  if (!hasZtools()) return [{ _id: CATEGORY_PREFIX + '0', label: '默认分类' }]
  const docs = (window.ztools.db.allDocs(CATEGORY_PREFIX) || []) as unknown as CategoryDoc[]
  if (!docs.length) {
    const def: CategoryDoc = { _id: newCategoryId(), label: '默认分类' }
    const res = window.ztools.db.put(def as never)
    if (!res.error) def._rev = res.rev
    return [def]
  }
  return sortCategories(docs)
}

// ===== 自定义脚本 =====

export function listScripts(): ScriptDoc[] {
  if (!hasZtools()) return []
  return sortScripts((window.ztools.db.allDocs(SCRIPT_PREFIX) || []) as unknown as ScriptDoc[])
}

export function putDoc<T extends { _id: string; _rev?: string }>(doc: T): string | null {
  if (!hasZtools()) return '当前非 ZTools 环境'
  const res = window.ztools.db.put(JSON.parse(JSON.stringify(doc)))
  if (res.error) return res.message || '保存失败'
  doc._rev = res.rev
  return null
}

export function removeDoc(id: string): boolean {
  if (!hasZtools()) return false
  return !window.ztools.db.remove(id).error
}

// ===== 指令注册 =====

export function getEnabledFeatureCodes(): string[] {
  if (!hasZtools()) return []
  return window.ztools.getFeatures().map((f) => f.code)
}

export function setFeature(feature: Feature): boolean {
  if (!hasZtools()) return false
  return window.ztools.setFeature(JSON.parse(JSON.stringify(feature)))
}

export function removeFeature(code: string): boolean {
  if (!hasZtools()) return false
  return window.ztools.removeFeature(code)
}

// 内置脚本的 feature（code 即脚本 id，与原版一致）
export function insetFeature(id: string): Feature | null {
  const inset = INSET_SCRIPTS.find((x) => x.id === id)
  if (!inset) return null
  const feature: Feature = { code: inset.id, explain: inset.explain, cmds: inset.cmds }
  if (inset.mainHide) feature.mainHide = true
  if (inset.platform.length < 3) feature.platform = inset.platform
  return feature
}
