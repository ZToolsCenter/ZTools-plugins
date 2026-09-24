/*
 * 把「一条内容」写回剪贴板的动作。
 *
 * 分成两条路，区别只有一个：要不要关窗。
 *   pasteOne()  —— 写回并粘贴，宿主会关窗、切回上一个应用、模拟粘贴（回车走这条）
 *   copyOne()   —— 只写系统剪贴板，窗口留着（双击 / ⌘C 走这条）
 *
 * 关键约束（宿主实测）：clipboard.write / writeContent 这两个接口
 * 在宿主侧是无条件先关窗的，所以「复制但不关窗」不能用它们，
 * 得用 copyText / copyImage / copyFile 这三个只写剪贴板的同步接口。
 */

/*
 * 这个 import 带 `.ts` 后缀，别的模块大多不带 —— 因为 `tests/payload.test.ts` 要直接跑本模块
 * （三种类型都挤在 copyOne 这一条路径上，写错了真机上点一下才发现，正是单测该管的）。
 * Node 的 ESM 解析要求写全后缀，理由同 `settings.ts` 顶部那段。
 */
import { zt, type ClipContent } from './clipboard.ts'

/**
 * 写回剪贴板用的 payload。
 *
 * 收成**可辨识联合**而不是 `{type: ClipType; content: string | string[]}`：
 * 调用方按 `type` 分支之后，`content` 的形状就是确定的（文本是串、文件是路径数组），
 * 不必再写 as 断言 —— 类型自己把「哪种类型配哪种内容」讲清楚了。
 */
export type WritePayload =
  | { type: 'text'; content: string }
  | { type: 'file'; content: string[] }
  | { type: 'image'; content: string }

function filePaths(item: ClipContent): string[] {
  return (item.files ?? []).map((f) => f.path)
}

/** 一条内容 → 写回剪贴板用的 payload；写不出来（比如空内容）返回 null */
export function payloadOf(item: ClipContent): WritePayload | null {
  if (item.type === 'text') return { type: 'text', content: item.content ?? '' }

  if (item.type === 'file') {
    const paths = filePaths(item)
    return paths.length ? { type: 'file', content: paths } : null
  }

  const image = item.imagePath || item.content || ''
  return image ? { type: 'image', content: image } : null
}

/** 写回并粘贴（宿主的 writeContent 会关窗） */
export async function pasteOne(item: ClipContent): Promise<boolean> {
  const payload = payloadOf(item)
  if (!payload) return false
  await zt().clipboard.writeContent(payload, true)
  return true
}

/**
 * 只写剪贴板，不关窗。
 *
 * 三种类型走宿主的三个同步接口，但「内容到底取哪个字段」不再重写一遍 ——
 * `payloadOf` 里刚写过，这里照 payload 的 type 分派就行。
 */
export function copyOne(item: ClipContent): boolean {
  const payload = payloadOf(item)
  if (!payload) return false

  if (payload.type === 'text') return zt().copyText(payload.content)
  if (payload.type === 'file') return zt().copyFile(payload.content)
  return zt().copyImage(payload.content)
}
