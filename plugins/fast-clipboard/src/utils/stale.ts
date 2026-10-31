/**
 * 「失效历史」判定。
 *
 * 先说清楚什么会失效：
 *   - 文本 / 链接 / 代码 / 颜色：内容本身就在记录里，**永远不会失效**；
 *   - 文　件：记录里只有一串路径，源文件被挪走或删掉，这条就再也用不了；
 *   - 图　片：原图是宿主存在自己目录里的（还会按空间回收），文件没了记录就成了空壳。
 *
 * 失效分两档，因为界面上"已不存在"是**逐文件**标出来的：
 *   - stale（全没了）：整条记录废了；
 *   - partial（缺一部分）：卡片上那几行标着"已不存在"，但还有文件活着。
 *     这条整条复制出去会失败（写剪贴板时路径里有一个不在就整体失败），
 *     留着就是一条点了没用的记录 —— 同样该能清掉，只是代价是把还剩的
 *     那几个文件一起丢掉，所以由用户在弹窗里选，不替他决定。
 *
 * 判定仍然保守：清理不可撤销 ——
 *   1. 判断不了（比如没有 preload）→ unknown，不清理；
 *   2. 内容自带（data URL / 裸 base64）的图片 → 不看本地文件，直接算有效。
 *
 * 判定是纯函数：路径存在与否由外部注入（`opts.exists`），
 * 这样测试可以脱离 preload 直接覆盖各种磁盘状态。
 */

import type { ClipboardRecord } from '../types'
import { fileExists } from './fs'

/**
 * ok = 都能用；stale = 全没了；partial = 缺一部分；unknown = 判断不了（一定不清理）
 */
export type StaleVerdict = 'ok' | 'stale' | 'partial' | 'unknown'

export interface StaleOptions {
  /** 路径 → 是否存在；null = 判断不了。默认走 preload 的同步查询 */
  exists?: (p: string) => boolean | null
}

/** 绝对路径：`C:\a\b` / `C:/a/b` / `/a/b` */
const ABS_PATH = /^([a-zA-Z]:[\\/]|\/)/
const FILE_SCHEME = /^file:\/\//i

/**
 * 可能存着本地绝对路径的字段名。
 * 与 api.ts 的 IMAGE_KEYS 是同一个概念（不同版本宿主给的字段名不一样），
 * 这里只挑"值是本地路径"的那部分，图片数据/网络地址会被下面的规则筛掉。
 */
const LOCAL_PATH_KEYS = [
  'imagePath', 'image_path', 'filePath', 'localPath', 'absPath',
  'thumb', 'thumbnail', 'path'
]

function dedup(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))]
}

/** `file:///E:/a/b.png` → `E:/a/b.png`（分隔符保持 `/`：Node 的 fs 正反斜杠都认） */
export function pathFromSrc(src: string): string {
  if (!FILE_SCHEME.test(src)) return ''
  let s = src.slice('file://'.length)
  try {
    s = decodeURI(s)
  } catch {
    /* 编码有异常就按原样继续，下面还有规则兜着 */
  }
  // Windows 的盘符前面会被补一个 "/"（toImgSrc 保证 URL 合法），去掉它才是本地路径
  return s.replace(/^\/+(?=[a-zA-Z]:)/, '')
}

/** 值是不是一条本地路径（排除 data: / http: / 空值） */
function isLocalPath(v: unknown): v is string {
  return typeof v === 'string' && v.length > 1 && ABS_PATH.test(v) && !/^(data|https?):/i.test(v)
}

/**
 * 一条记录依赖的本地文件路径。
 * 返回空数组 = 这条记录的内容自带（文本 / data URL 图片），不看磁盘脸色。
 */
export function localPathsOf(r: ClipboardRecord): string[] {
  if (r.kind === 'file') {
    const list = r.files?.filter(Boolean)
    if (list && list.length) return dedup(list)
    return r.content && ABS_PATH.test(r.content) ? [r.content] : []
  }

  if (r.kind === 'image') {
    const out: string[] = []
    const raw = r.raw
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>
      for (const k of LOCAL_PATH_KEYS) {
        if (isLocalPath(o[k])) out.push(o[k])
      }
    }
    // 归一化后 content 是 file:// URL：它就是从宿主的本地路径转来的
    const fromSrc = pathFromSrc(r.content)
    if (fromSrc && ABS_PATH.test(fromSrc)) out.push(fromSrc)
    return dedup(out)
  }

  return []
}

/**
 * 判定一条记录。规则见文件头：全没了 = stale，缺一部分 = partial，
 * 判断不了 = unknown（一定不清理），其余 = ok。
 */
export function staleVerdict(r: ClipboardRecord, opts: StaleOptions = {}): StaleVerdict {
  const ex = opts.exists ?? fileExists
  const paths = localPathsOf(r)

  // 内容自带：不过期。文件记录连路径都没有的话本身就是残缺的，等于失效。
  if (paths.length === 0) return r.kind === 'file' ? 'stale' : 'ok'

  let alive = 0
  let gone = 0
  let unknown = 0
  for (const p of paths) {
    const v = ex(p)
    if (v === true) alive++
    else if (v === false) gone++
    else unknown++
  }

  if (alive > 0) return gone > 0 ? 'partial' : 'ok'
  // 一个都不在了：必须全部确认"确实没了"才算失效，掺着 unknown 就不动
  if (gone > 0 && unknown === 0) return 'stale'
  return 'unknown'
}

/** 挑出一批记录里已失效的那些（保留原顺序） */
export function pickStale(records: ClipboardRecord[], opts: StaleOptions = {}): ClipboardRecord[] {
  return records.filter((r) => staleVerdict(r, opts) === 'stale')
}
