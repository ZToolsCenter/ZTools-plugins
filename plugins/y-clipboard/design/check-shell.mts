/**
 * 界面外壳 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-shell.mts
 *
 * 起因：顶部工具栏那一行只剩一句「在上方输入框输入关键词过滤」的说明 ——
 * 宿主自带子输入框，这句话既没信息量又白占 44px。这一行整行去掉后，
 * 「图片档位」与「清空历史」挪到侧栏底部。这里守住：
 *   1. 那句说明在全仓库消失，且工具栏不再常驻（只在搜索框兜底时才出现）
 *   2. 两个按钮确实搬到了侧栏，行为不变（二次确认 / 按分类显隐 / 危险色）
 *   3. 侧栏底部顺序稳定：清空历史在上、图片档位居中、键盘提示在下，
 *      且图片档位"占位不显"（visibility），不会带着清空历史上下跳
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
let fail = 0

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected
  if (ok) pass++
  else fail++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望=${String(expected)} 实际=${String(actual)}`}`
  )
}

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

const toolbar = read('components/Toolbar.vue')
const sidebar = read('components/Sidebar.vue')
const app = read('App.vue')

/* ------------------------------------------------------------------ */
/* 1. 说明文案与常驻工具栏已移除                                        */
/* ------------------------------------------------------------------ */

console.log('--- 顶部说明行已移除 ---')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(vue|ts|css|html)$/.test(e.name)) out.push(p)
  }
  return out
}

const allFiles = walk(SRC)
const hintHits = allFiles.filter((f) => readFileSync(f, 'utf8').includes('在上方'))
check('全仓库不再出现「在上方…」说明', hintHits.length, 0)

check('工具栏不再渲染 .hint', /class="hint"/.test(toolbar), false)
check('工具栏不再有清空历史按钮', /clearAll/.test(toolbar), false)
check('工具栏不再有图片档位按钮', /cycleImgScale/.test(toolbar), false)
check('工具栏整行只在兜底时出现', /<header v-if="showOwnInput"/.test(toolbar), true)
check(
  '兜底条件没被改坏（mock 或子输入框注册失败）',
  /isDevMock\(\) \|\| !store\.subInputReady\.value/.test(toolbar),
  true
)
check('兜底搜索框本身保留', /class="search-input"/.test(toolbar), true)
check('兜底搜索框仍会自动聚焦', /focusInput\(\)/.test(toolbar), true)

/* ------------------------------------------------------------------ */
/* 2. 两个按钮搬到侧栏，行为不变                                        */
/* ------------------------------------------------------------------ */

console.log('\n--- 图片档位 / 清空历史 迁到侧栏 ---')

check('侧栏有清空历史', /clearAll/.test(sidebar), true)
check('侧栏有图片档位', /cycleImgScale/.test(sidebar), true)
check('清空历史保留二次确认', /confirm\(/.test(sidebar), true)
check('清空历史说明收藏保留', /收藏的内容会保留/.test(sidebar), true)
check('清空历史用危险色 hover', /\.foot-btn\.danger:hover[\s\S]{0,120}--danger/.test(sidebar), true)

// 规则 5：开关类按钮按分类上下文显隐，不要常驻
check('图片档位仍是按分类显隐（非常驻）', /'is-off': !showImgScale/.test(sidebar), true)
// 但显隐不能用 v-if：footer 是靠 margin-top:auto 贴住底边的，元素一消失整块高度就变、
// 顶边下移，「清空历史」会跟着跳 ~30px（全部 ↔ 文本 是最常来回切的分类）。
check('图片档位不再用 v-if', /v-if="showImgScale"/.test(sidebar), false)
check(
  '隐藏用 visibility 占位（位置不跳）',
  /\.foot-btn\.is-off\s*\{[^}]*visibility: hidden/.test(sidebar),
  true
)
check(
  '显隐条件仍是 all / image',
  /c === 'all' \|\| c === 'image'/.test(sidebar),
  true
)
check('图片档位带当前档位标签', /图片：\{\{ store\.imgScaleLabel\.value \}\}/.test(sidebar), true)

/* ------------------------------------------------------------------ */
/* 3. 底部顺序稳定：会显隐的按钮排最后                                  */
/* ------------------------------------------------------------------ */

console.log('\n--- 侧栏底部顺序 ---')

const iClear = sidebar.indexOf('清空历史')
const iScale = sidebar.indexOf('图片：')
const iTip = sidebar.indexOf('Enter 复制')
check('清空历史在图片档位之前', iClear > 0 && iScale > iClear, true)
check('图片档位在键盘提示之前', iTip > iScale, true)
check('键盘提示仍在', /Esc 退出/.test(sidebar), true)
check('提示行不再带图标（132px 装不下图标+文案）', /class="foot-tip"[^>]*>Enter/.test(sidebar), true)

// 侧栏 132px - 左右 padding 16 - 按钮内 padding 20 - 图标 16 - 间距 6 = 74px 给文案，
// 12px 字号下 4 个汉字 = 48px，宽裕；超过 5 个字就要溢出了。
for (const label of ['清空历史', '图片：标准']) {
  const cjk = (label.match(/[一-龥]/g) || []).length
  check(`「${label}」文案不超过 4 个汉字`, cjk <= 4, true)
}

/* ------------------------------------------------------------------ */
/* 4. App 结构没散                                                     */
/* ------------------------------------------------------------------ */

console.log('\n--- App 结构 ---')

check('App 仍挂载 Toolbar（兜底入口不能丢）', /<Toolbar/.test(app), true)
check('App 仍挂载 Sidebar', /<Sidebar/.test(app), true)
check('Toolbar 在 Sidebar 之前', app.indexOf('<Toolbar') < app.indexOf('<Sidebar'), true)
check('Toolbar 不再传参（行内自洽）', /<Toolbar\s*\/>/.test(app), true)

console.log(`\n通过 ${pass}，失败 ${fail}`)
if (fail > 0) process.exit(1)
