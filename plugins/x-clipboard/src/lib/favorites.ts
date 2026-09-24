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

/**
 * 手动新增一条**文本**收藏 —— 它不来自剪贴板。
 *
 * ── 为什么另开一个函数，不并进 `addFavorite` ──
 * `addFavorite` 的入参是「宿主给的一条记录」，它会照着一份固定字段表去复制
 * （`hash` / `imagePath` / `resolution` / `files` / `appName` / `bundleId`）。
 * 手写的笔记这些**一个都没有**，硬走那边只会复制出一堆 `undefined`，还得再判一次 `type`。
 * 这里要造的是另一头的东西：只有 `type` + `content`。
 *
 * ⚠️ **判重沿用 `addFavorite` 的语义**（已存在就原样返回）—— 不然收藏里能冒出两条
 *    一模一样的备忘。手写条目没有 `hash` ⇒ `favKeyOf` 退化成 `text:${content}`，
 *    所以「两条内容相同的笔记」会被正确判重。
 *    （已知的、可解释的小瑕疵：跟**历史**里同样内容的那条**不算同一条** ——
 *     历史那条的指纹是宿主的 md5，两边算不到一起去。手动条目本来就不属于任何历史记录。）
 *
 * ⚠️ 空白内容不许进来（粘出一条空字符串没有任何意义）。判空走 `trim()`，
 *    但**存进去的是原样** —— 不替用户改他的字（首尾的空行也是他内容的一部分）。
 */
export async function addManualFavorite(content: string, list: FavItem[]): Promise<FavItem[]> {
  if (!content.trim()) return list
  const draft: ClipContent = { type: 'text', content }
  if (isFavorite(draft, list)) return list
  const next: FavItem[] = [{ ...draft, favId: newFavId(), addedAt: Date.now() }, ...list]
  await persist(next)
  return next
}

/**
 * 改一条收藏的正文。**只对文本有意义** —— 图片改不了那张 png，
 * 文件改路径其实是「换成另一个文件」，都超出「编辑」这两个字。
 *
 * ★ 先把整条摊开、只替换 `content`（`{ ...f, content }`），**别的字段一个都不动**：
 *   · `hash` 尤其不能丢 —— `favKeyOf` 优先用它，而 `App.vue` 的 `favKeys` 是拿它跟
 *     **历史行**比对的。丢了 hash，指纹就退化成 `text:新内容`，跟历史对不上 ⇒
 *     **明明还收藏着，历史那一行却不再亮星**（而且不报错）。
 *   · `addedAt` 也不能动：编辑不是「重新收藏」。收藏视图按 `addedAt` 倒序排，
 *     一改它就跳到列表顶上，人回头找不到刚编辑的那一行。
 *
 * 找不到 `favId`、或者改完跟原来**一字不差**，都原样返回、**不写库**
 * （避免一次无意义的写请求 —— `upsertDoc` 是"先读 rev 再写"，白写一次就是白跑一个来回）。
 */
export async function updateFavoriteText(
  favId: string,
  content: string,
  list: FavItem[]
): Promise<FavItem[]> {
  if (!content.trim()) return list
  const hit = list.find((f) => f.favId === favId)
  if (!hit || hit.content === content) return list
  const next = list.map((f) => (f.favId === favId ? { ...f, content } : f))
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
