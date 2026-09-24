/*
 * 收藏存储。
 *
 * 收藏是插件自己的一份数据，存在插件的数据库里（宿主按插件名隔离），
 * 存的是整条内容的副本 —— 所以清空剪贴板历史不会动着收藏。
 * 键名自己起，跟宿主历史的那本账（CLIPBOARD）没有任何关系。
 */

/*
 * 这个 import 带 `.ts` 后缀，别的模块都没带 —— 因为 `tests/docstore.test.ts` 要直接跑本模块，
 * Node 的 ESM 解析是严格的，不带后缀就 ERR_MODULE_NOT_FOUND。理由同 `settings.ts` 顶部那段。
 */
import { upsertDoc, zt, type ClipContent } from './clipboard.ts'

const DOC_ID = 'x_clipboard.favorites'

export interface FavItem extends ClipContent {
  /** 收藏自己的主键（历史记录的 id 不能复用：收藏可以在历史被删之后继续存在） */
  favId: string
  addedAt: number
}

export function newFavId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 判重用的指纹：优先用宿主给的 md5，没有就按内容拼 */
export function favKeyOf(item: ClipContent): string {
  if (item.hash) return item.hash
  if (item.type === 'text') return `text:${item.content ?? ''}`
  if (item.type === 'image') return `image:${item.imagePath ?? item.content ?? ''}`
  return `file:${(item.files ?? []).map((f) => f.path).join('|')}`
}

export async function loadFavorites(): Promise<FavItem[]> {
  try {
    const doc = (await zt().db.promises.get(DOC_ID)) as { list?: FavItem[] } | null
    return Array.isArray(doc?.list) ? doc.list : []
  } catch (err) {
    console.error('[x-clipboard] 读取收藏失败', err)
    return []
  }
}

async function persist(list: FavItem[]): Promise<void> {
  /*
   * ⚠️ 必须走 `upsertDoc`（它会带上库里那份的 `_rev`），不能直接 `put({ _id, list })`。
   *
   * 不带 `_rev` 去覆盖已有的文档，**只有第一次会成功**（那一刻库里还没有 rev），
   * 之后每次都被宿主的 rev 校验拒掉 —— 而宿主**不抛异常**，只 resolve 一个
   * `{ ok: false, name: 'conflict' }`，所以失败是静默的：
   * 表现就是「收藏了第一条之后，再怎么收藏都没反应」。
   * 机制细节见 `clipboard.ts` 的 `upsertDoc`。
   */
  const res = await upsertDoc(DOC_ID, () => ({ list }))
  if (!res.ok) console.error('[x-clipboard] 收藏没存进去', res.message)
}

/**
 * 在收藏里找这一条 —— 按内容指纹比，找不到返回 undefined。
 *
 * 「这条收没收藏过」和「点一下 ☆ 该加还是该删」是同一件事的两种问法：
 * 前者只要一个布尔，后者要那一条本身（删的时候得知道 `favId`）。
 * 所以查找只写这一份，`isFavorite` 和界面上的切换都从它来 ——
 * 原来界面上自己写了一版 `favorites.find(...)`，跟这里是逐字重复的。
 */
export function findFavorite(item: ClipContent, list: FavItem[]): FavItem | undefined {
  const key = favKeyOf(item)
  return list.find((f) => favKeyOf(f) === key)
}

export function isFavorite(item: ClipContent, list: FavItem[]): boolean {
  return findFavorite(item, list) !== undefined
}

/** 收藏一条；已经在了就原样返回，不重复存 */
export async function addFavorite(item: ClipContent, list: FavItem[]): Promise<FavItem[]> {
  if (isFavorite(item, list)) return list
  // 复制整条内容；漏掉 resolution 的话，收藏里的图片行会退化成「图片」两个字
  const { type, content, preview, imagePath, resolution, files, hash, appName, bundleId } = item
  const next: FavItem[] = [
    {
      type,
      content,
      preview,
      imagePath,
      resolution,
      files,
      hash,
      /*
       * 来源也一起带上 —— 它跟 `resolution` 是同一个道理：少带一个字段，
       * 收藏列表里那一行的「行尾显示来源」就会静默失效（老收藏没有这两个键 ⇒ 不显示，正常）。
       */
      appName,
      bundleId,
      favId: newFavId(),
      addedAt: Date.now()
    },
    ...list
  ]
  await persist(next)
  return next
}

export async function removeFavorite(favId: string, list: FavItem[]): Promise<FavItem[]> {
  const next = list.filter((f) => f.favId !== favId)
  if (next.length !== list.length) await persist(next)
  return next
}

/** 一次清空全部收藏。返回清掉了几条 —— 跟宿主的 `clear(type)` 一个形状，调用方好统一处理 */
export async function clearFavorites(): Promise<number> {
  const current = await loadFavorites()
  if (!current.length) return 0
  await persist([])
  return current.length
}
