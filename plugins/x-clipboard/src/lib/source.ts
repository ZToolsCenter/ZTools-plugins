/*
 * 剪贴板记录的**来源应用** —— 这条内容是「在哪个软件里复制出来的」。
 *
 * 数据是现成的：宿主 `saveItem` 时就把 `appName` + `bundleId` 写进文档了，
 * `getAllItems()` 整条展开、`itemsWithStatus` 也不裁字段 ⇒ 插件这边零采集成本
 * （`ClipContent` 里那两个字段的说明见 `clipboard.ts`）。
 *
 * ── 为什么默认不显示 ────────────────────────────────────────────────────
 * 实测那 786 条：覆盖率 100%、只有 7 个应用、没有一条脏来源 —— 数据很干净。
 * 但**前两个应用就占了 88%**，常驻显示等于两百多行里反复出现同样两个词，
 * 是纯噪声。所以它跟「序号」一样**默认关**，给"想看一眼是从哪儿来的"人自己打开。
 * 开关在设置面板「行尾」那一组（`tailSource`）。
 */

import type { ClipContent } from './clipboard.ts'

/*
 * 短名表：只列**确实长到该压缩**的那几个。
 *
 * 宿主的 `appName` 是**应用全名**（"Visual Studio Code.app"），原样显示又长又占地方。
 * 表**越薄越好** —— 每多一个键就多一处跟真实应用名对不上的机会，而它对不上时不会报错，
 * 只会静默走兜底（剥掉 `.app` 直接用），很难发现。所以宁可兜底不好看，也别乱铺。
 */
const SHORT: Record<string, string> = {
  'Visual Studio Code': 'VSCode',
  'Google Chrome': 'Chrome',
  'IntelliJ IDEA': 'IDEA',
  'ima.copilot': 'ima'
}

/**
 * 一条记录该显示的来源名；**没有来源就回 `null`**（调用方据此不渲染那一格）。
 *
 * ⚠️ 回 `null` 而不是空串、也不是兜底成一个"未知"：老数据 / 老收藏里根本没有这两个键，
 *    显示「未知」等于凭空多了一列；不渲染才是对的。
 */
export function sourceLabel(item: ClipContent): string | null {
  const raw = item.appName?.trim()
  if (!raw) return null
  // 宿主给的是 "Visual Studio Code.app" 这个形状 —— 后缀对所有应用一致，剥掉
  const base = raw.replace(/\.app$/i, '').trim()
  if (!base) return null
  return SHORT[base] ?? base
}
