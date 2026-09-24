/**
 * Diff 配色 token 完整性单元测试（roadmap 任务 UI-015 / §3.2 回归护栏）。
 *
 * 对 `src/main.css` 做文本断言（与 tests/ui/virtual.test.ts 对
 * --diff-line-height 的守卫同一手法）：锁定 roadmap §3.2 表格的 8 组
 * `--diff-*` token 在浅色（:root）与深色（html.dark）两个作用域的全部
 * 16 个取值逐值精确一致 —— 任何一侧漂移（手改色值 / 漏写深色分支）都会
 * 被本文件拦截。同时锁定等宽字体栈、字号（12–13px 档取 13px）、行高
 * （20px，与 DIFF_ROW_HEIGHT 的一致性另由 virtual.test.ts 守护）与
 * 内部滚动条 token 的存在。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Scandi 色板（2026-08 北欧重构）的 8 组 token 期望值（浅色 / 深色） */
const EXPECTED_DIFF_TOKENS: ReadonlyArray<{ name: string; light: string; dark: string }> = [
  { name: '--diff-del-bg', light: '#f6e7e1', dark: '#43302a' },
  { name: '--diff-del-word-bg', light: '#ecc9bd', dark: '#5d3e33' },
  { name: '--diff-del-text', light: '#96482f', dark: '#e2a58f' },
  { name: '--diff-add-bg', light: '#e5eee1', dark: '#2f3a2e' },
  { name: '--diff-add-word-bg', light: '#c5dcbf', dark: '#44593f' },
  { name: '--diff-add-text', light: '#3f6d4b', dark: '#a9cba9' },
  { name: '--diff-gutter-bg', light: '#f1efe9', dark: '#322f2a' },
  { name: '--diff-hunk-bg', light: '#e3ebef', dark: '#303a41' },
]

const mainCss = readFileSync(new URL('../../src/main.css', import.meta.url), 'utf8')

/** 抽取指定选择器块（浅色 :root / 深色 html.dark）内的 token 声明文本 */
function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  expect(start, `main.css 中应存在 ${selector} 块`).toBeGreaterThanOrEqual(0)
  const end = css.indexOf('}', start)
  return css.slice(start, end)
}

const lightBlock = extractBlock(mainCss, ':root')
const darkBlock = extractBlock(mainCss, 'html.dark')

describe('main.css：§3.2 diff token 逐值一致性', () => {
  it.each(EXPECTED_DIFF_TOKENS)('$name 浅色 = $light / 深色 = $dark', ({ name, light, dark }) => {
    expect(lightBlock).toContain(`${name}: ${light};`)
    expect(darkBlock).toContain(`${name}: ${dark};`)
  })

  it('8 组 token 在浅色与深色两个作用域都有声明（无漏写）', () => {
    for (const { name } of EXPECTED_DIFF_TOKENS) {
      expect(lightBlock.match(new RegExp(`${name}:`, 'g'))?.length).toBe(1)
      expect(darkBlock.match(new RegExp(`${name}:`, 'g'))?.length).toBe(1)
    }
  })
})

describe('main.css：排版与滚动条 token', () => {
  it('等宽字体栈与 roadmap §3.2 逐字一致', () => {
    expect(mainCss).toContain(
      '--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;',
    )
  })

  it('字号 13px（12–13px 档）、行高 20px', () => {
    expect(mainCss).toContain('--diff-font-size: 13px;')
    expect(mainCss).toContain('--diff-line-height: 20px;')
  })

  it('内部滚动条 token 浅 / 深两档齐备', () => {
    expect(lightBlock).toContain('--scrollbar-thumb: #d9d3c8;')
    expect(darkBlock).toContain('--scrollbar-thumb: #4a463d;')
  })
})
