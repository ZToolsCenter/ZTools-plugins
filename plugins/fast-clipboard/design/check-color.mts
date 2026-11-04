/**
 * rgb/rgba/hsl/hsla 颜色分类回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-color.mts
 *
 * 背景：颜色分类原来只认 #hex。用户复制 `rgb(...)` / `rgba(...)` 后落进了"文本"，
 * 颜色分类里看不到、也没有色块。这次把 CSS 颜色函数整族纳入：
 *   1. **判定**（utils/format 的 isColorValue）：rgb/rgba/hsl/hsla 整串匹配，
 *      逗号与 CSS4 空格/斜杠两种写法都认，散文里的颜色函数不误判；
 *   2. **分类**（api 的 detectKind 用 isColorValue）—— normalizeRecord 对每条
 *      记录现算 kind，所以宿主历史里已有的 rgb 记录**自动**归入颜色分类，无需迁移；
 *   3. **色块**（ClipboardItem 的 colorSwatchOf）：rgb()/hsl() 本身就是合法的
 *      CSS background 值，直接原样上色。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`)
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = (p: string): string => readFileSync(join(root, 'src', p), 'utf8')

const { isHexColor, isCssColorFunc, isColorValue, colorSwatchOf } = await import('../src/utils/format.ts')
const { detectKind } = await import('../src/api.ts')

/* ------------------------------------------------------------------ */
/* 一、判定                                                            */
/* ------------------------------------------------------------------ */

console.log('--- rgb / rgba 各种写法 ---')
check('rgb 逗号+空格', isColorValue('rgb(255, 0, 0)'), true)
check('rgb 无空格', isColorValue('rgb(255,0,0)'), true)
check('RGB 大写', isColorValue('RGB(255, 0, 0)'), true)
check('rgba 带小数 alpha', isColorValue('rgba(91, 141, 239, 0.45)'), true)
check('rgba alpha 为 1', isColorValue('rgba(0, 0, 0, 1)'), true)
check('rgba alpha 为百分比', isColorValue('rgba(0, 0, 0, 50%)'), true)
check('CSS4 空格语法', isColorValue('rgb(255 0 0)'), true)
check('CSS4 空格+斜杠 alpha', isColorValue('rgb(255 0 0 / 0.5)'), true)
check('rgba 斜杠百分比 alpha', isColorValue('rgba(255 0 0 / 50%)'), true)
check('rgb 超过 255 的值也认（分类从宽，交给 CSS 渲染兜底）', isColorValue('rgb(300, 0, 0)'), true)

console.log('\n--- hsl / hsla ---')
check('hsl 标准', isColorValue('hsl(152, 69%, 31%)'), true)
check('hsla 带 alpha', isColorValue('hsla(0, 0%, 0%, 0.8)'), true)
check('hsl 色相带 deg', isColorValue('hsl(120deg, 50%, 50%)'), true)

console.log('\n--- #hex 仍然认识（不能被改坏） ---')
check('6 位 hex', isColorValue('#5B8DEF'), true)
check('3 位 hex', isColorValue('#fff'), true)
check('8 位 hex', isColorValue('#5B8DEFFF'), true)
check('isHexColor 仍然只认 hex', isHexColor('rgb(255, 0, 0)'), false)

console.log('\n--- 不该被判成颜色 ---')
check('散文里提到 rgb', isColorValue('把 rgb(255,0,0) 改成红色试试'), false)
check('括号没闭合', isColorValue('rgb(255, 0, 0'), false)
check('尾随逗号', isColorValue('rgb(255, 0, 0,)'), false)
check('空参数', isColorValue('rgb()'), false)
check('超长数字不是颜色分量', isColorValue('rgb(12345, 0, 0)'), false)
check('非颜色函数', isColorValue('scale(1, 2)'), false)
check('单词', isColorValue('rgba'), false)
check('空串', isColorValue('   '), false)

/* ------------------------------------------------------------------ */
/* 二、分类（detectKind）                                               */
/* ------------------------------------------------------------------ */

console.log('\n--- detectKind：rgb 族归入颜色 ---')
check('rgb → color', detectKind('rgb(255, 0, 0)'), 'color')
check('rgba → color', detectKind('rgba(91, 141, 239, 0.45)'), 'color')
check('hsl → color', detectKind('hsl(152, 69%, 31%)'), 'color')
check('#hex → color（原行为不变）', detectKind('#5B8DEF'), 'color')
check('hex 超过 6 位不会被误吞成分量', detectKind('#fffffff'), 'text')
check('网址仍是 link（颜色判定不抢它的活）', detectKind('https://example.com/rgb(255,0,0)'), 'link')
check('普通句子仍是 text', detectKind('今天把主题色调成了 rgb(91,141,239)，效果不错'), 'text')
check('短句不受影响', detectKind('你好世界'), 'text')

/* ------------------------------------------------------------------ */
/* 三、色块与界面契约                                                    */
/* ------------------------------------------------------------------ */

console.log('\n--- 色块（colorSwatchOf）---')
check('hex 原样返回', colorSwatchOf(' #5B8DEF '), '#5B8DEF')
check('rgba 原样返回（它本身就是合法的 CSS background）', colorSwatchOf('rgba(91, 141, 239, 0.45)'), 'rgba(91, 141, 239, 0.45)')
check('非颜色返回空串（不渲染色块）', colorSwatchOf('普通文本'), '')

console.log('\n--- 界面契约 ---')
const itemSrc = src('components/ClipboardItem.vue')
check('色块改用 colorSwatchOf（覆盖 rgb 族）', /colorSwatchOf\(props\.record\.content\)/.test(itemSrc), true)
check('不再单独依赖 isHexColor', /isHexColor/.test(itemSrc), false)
check('api 的 detectKind 用统一的 isColorValue', /isColorValue\(t\)\) return 'color'/.test(src('api.ts')), true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
