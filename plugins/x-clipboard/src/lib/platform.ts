/*
 * 平台判断 —— 存在的唯一理由：键盘提示里的修饰键该怎么写。
 *
 * mac 是 ⌘，Windows / Linux 是 Ctrl。**Windows 的键盘上根本没有 ⌘ 键**，
 * 提示里写「⌘K」那边的人等于看不懂，所以这里必须分平台。
 *
 * 问宿主最准（preload 直接给 `isMacOs()`），问不到再退回 navigator ——
 * 前者是权威答案，后者是「万一不在宿主里跑」时的兜底。
 * 平台在一次运行里不会变，所以算一次就缓存。
 *
 * 注意这个文件的 import **带 `.ts` 后缀**：`tests/platform.test.ts` 要直接跑它，
 * Node 的 ESM 解析是严格的，不带后缀就 ERR_MODULE_NOT_FOUND。
 * （跟 `settings.ts` 同一个道理，见那边的注释。）
 */

import { zt } from './clipboard.ts'

let cachedMac: boolean | null = null

function detectMac(): boolean {
  try {
    const v = zt().isMacOs?.()
    if (typeof v === 'boolean') return v
  } catch {
    /* 老宿主没这个接口，或者压根不在宿主里（单测） */
  }
  try {
    return /mac/i.test(navigator.platform || navigator.userAgent)
  } catch {
    return false
  }
}

function macOrNot(): boolean {
  if (cachedMac === null) cachedMac = detectMac()
  return cachedMac
}

/**
 * 修饰键 + 键名的展示写法：mac → `⌘K`，Windows / Linux → `Ctrl+K`。
 *
 * 第二个参数只是给单测留的出口（真实运行一律走宿主判断），业务代码别传。
 */
export function modKey(key: string, forceMac?: boolean): string {
  return (forceMac ?? macOrNot()) ? `⌘${key}` : `Ctrl+${key}`
}
