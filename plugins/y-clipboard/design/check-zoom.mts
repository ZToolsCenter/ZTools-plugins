/**
 * 图片预览缩放 回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-zoom.mts
 *
 * 起因：全屏看图只能"适应窗口"，截图里的细节（报错文字、表格小字）看不清，
 * 用户要求支持滚轮缩放。这里守住两件事：
 *   1. 数学是对的 —— 锚点缩放（光标下那一点不动）、边界夹取（拖不出空白），
 *      这类东西截图看不出来，只能算
 *   2. 界面层的坑别再踩 —— 关键帧里不能出现 transform（会和内联 scale 打架）、
 *      放大后必须裁在舞台里、换图要重置视图
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DBLCLICK_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  STEP_ZOOM,
  actualZoom,
  canPan,
  clampOffset,
  clampZoom,
  fitSize,
  wheelDelta,
  zoomAt,
  zoomByWheel,
} from '../src/utils/zoom.ts'

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

function near(name: string, actual: number, expected: number, eps = 1e-9): void {
  const ok = Math.abs(actual - expected) <= eps
  if (ok) pass++
  else fail++
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  期望≈${expected} 实际=${actual}`}`
  )
}

const SRC = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const view = readFileSync(join(SRC, 'components/ImagePreview.vue'), 'utf8')
const zoomSrc = readFileSync(join(SRC, 'utils/zoom.ts'), 'utf8')

/* ------------------------------------------------------------------ */
/* 1. 倍率夹取                                                         */
/* ------------------------------------------------------------------ */

console.log('\n--- 倍率夹取 ---')

check('缩到 0 以下被夹在下限', clampZoom(0.001), MIN_ZOOM)
check('放到离谱被夹在上限', clampZoom(9999), MAX_ZOOM)
check('正常倍率原样返回', clampZoom(2.5), 2.5)
check('NaN 退回 1（适应窗口）', clampZoom(NaN), 1)
check('0 退回 1', clampZoom(0), 1)
check('下限不超过 1（不然"缩小"没意义）', MIN_ZOOM < 1, true)
check('上限足够看清截图小字', MAX_ZOOM >= 8, true)
check('双击倍率是 2 倍', DBLCLICK_ZOOM, 2)
check('按钮每档 1.25 倍', STEP_ZOOM, 1.25)

/* ------------------------------------------------------------------ */
/* 2. 滚轮量归一化                                                     */
/* ------------------------------------------------------------------ */

console.log('\n--- 滚轮量归一化 ---')

check('像素模式原样', wheelDelta({ deltaY: -120, deltaMode: 0 }), -120)
check('行模式 ×16', wheelDelta({ deltaY: -3, deltaMode: 1 }), -48)
check('页模式 ×400', wheelDelta({ deltaY: -1, deltaMode: 2 }), -400)
check('不带 deltaMode 按像素算', wheelDelta({ deltaY: 100 }), 100)

check('向上滚（负）是放大', zoomByWheel(1, -100) > 1, true)
check('向下滚（正）是缩小', zoomByWheel(1, 100) < 1, true)
check('Firefox 一行也放大', zoomByWheel(1, wheelDelta({ deltaY: -3, deltaMode: 1 })) > 1, true)
check('狂滚到底停在上限', zoomByWheel(1, -100 * 300), MAX_ZOOM)
check('反向狂滚停在下限', zoomByWheel(1, 100 * 300), MIN_ZOOM)
near('一上一下回到原倍率', zoomByWheel(zoomByWheel(2.5, -120), 120), 2.5, 1e-12)
check(
  '单格滚轮幅度温和（1 格在 10%~30% 之间）',
  (() => {
    const r = zoomByWheel(1, -100) / 1
    return r > 1.1 && r < 1.3
  })(),
  true
)

/* ------------------------------------------------------------------ */
/* 3. 锚点缩放：光标下那一点必须不动                                    */
/* ------------------------------------------------------------------ */

console.log('\n--- 锚点缩放 ---')

const cases: Array<[number, number, number, number, number, number]> = [
  // offset.x, offset.y, zoom, next, mx, my
  [0, 0, 1, 2, 300, -120],
  [0, 0, 1, 0.5, -180, 90],
  [120, -60, 2, 4, 40, 40],
  [-200, 150, 3, 1.2, -350, 210],
]

for (const [ox, oy, z, nz, mx, my] of cases) {
  const off = zoomAt({ x: ox, y: oy }, z, nz, mx, my)
  // 缩放前后，锚点在"图片坐标"里的位置应完全一致
  near(`锚点 x 不动 (${ox},${z}→${nz})`, (mx - off.x) / nz, (mx - ox) / z, 1e-9)
  near(`锚点 y 不动 (${oy},${z}→${nz})`, (my - off.y) / nz, (my - oy) / z, 1e-9)
}

// 以中心为锚点：位移等比缩放
const c = zoomAt({ x: 100, y: -50 }, 2, 4, 0, 0)
near('中心锚点 x 等比', c.x, 200, 1e-12)
near('中心锚点 y 等比', c.y, -100, 1e-12)

// 视图本来居中时，无论以哪点为锚点放大，图片中心都会朝锚点的反方向走
const offCenter = zoomAt({ x: 0, y: 0 }, 1, 2, 100, 0)
near('居中时放大，图片朝锚点方向偏移', offCenter.x, -100, 1e-12)

/* ------------------------------------------------------------------ */
/* 4. 边界夹取：拖不出空白                                              */
/* ------------------------------------------------------------------ */

console.log('\n--- 平移边界 ---')

const stage = { w: 800, h: 500 }

const small = clampOffset({ x: 999, y: -999 }, 1, { w: 400, h: 300 }, stage)
check('比窗口小的图锁死居中 x', small.x, 0)
check('比窗口小的图锁死居中 y', small.y, 0)

const big = clampOffset({ x: 9999, y: 9999 }, 4, { w: 800, h: 500 }, stage)
near('放大后右边界夹住', big.x, (800 * 4 - 800) / 2, 1e-9)
near('放大后下边界夹住', big.y, (500 * 4 - 500) / 2, 1e-9)

const neg = clampOffset({ x: -9999, y: -9999 }, 4, { w: 800, h: 500 }, stage)
near('放大后左边界夹住', neg.x, -(800 * 4 - 800) / 2, 1e-9)
near('放大后上边界夹住', neg.y, -(500 * 4 - 500) / 2, 1e-9)

// 只有一个方向溢出时，另一个方向必须锁 0（不然图片会歪着飘）
const oneWay = clampOffset({ x: 500, y: 500 }, 4, { w: 800, h: 100 }, stage)
near('横向溢出时纵向不能动', oneWay.y, 0, 1e-9)

check('未溢出不可拖', canPan(1, { w: 400, h: 300 }, stage), false)
check('放大后可拖', canPan(2, { w: 800, h: 500 }, stage), true)
check('只纵向溢出也能拖', canPan(1.5, { w: 200, h: 400 }, { w: 800, h: 500 }), true)

/* ------------------------------------------------------------------ */
/* 5. 1:1 原始像素                                                     */
/* ------------------------------------------------------------------ */

console.log('\n--- 1:1 ---')

near('大图 1:1 需要放大', actualZoom(2400, 800), 3, 1e-12)
near('小图 1:1 反而要缩小', actualZoom(400, 800), 0.5, 1e-12)
check('没量到尺寸时不乱跳', actualZoom(0, 0), 1)
check('1:1 也不许超出上限', actualZoom(100000, 800) <= MAX_ZOOM, true)

/* ------------------------------------------------------------------ */
/* 6. 基准尺寸推算（CSS max-width/max-height 的效果）                   */
/* ------------------------------------------------------------------ */

console.log('\n--- 基准尺寸 ---')

const fit = fitSize({ w: 1000, h: 500 }, { w: 500, h: 500 })
near('宽图按宽度贴满', fit.w, 500, 1e-9)
near('宽图高度等比', fit.h, 250, 1e-9)

const fitTall = fitSize({ w: 400, h: 1000 }, { w: 500, h: 500 })
near('高图按高度贴满', fitTall.h, 500, 1e-9)
near('高图宽度等比', fitTall.w, 200, 1e-9)

const fitSmall = fitSize({ w: 100, h: 50 }, { w: 500, h: 500 })
check('小图不放大（max-width 只缩不放）', fitSmall.w, 100)
check('小图高度也不放大', fitSmall.h, 50)
check('量不到尺寸时返回 0（不当成"能显示"）', fitSize({ w: 0, h: 0 }, { w: 500, h: 500 }).w, 0)
check('舞台还是 0 时也不硬算', fitSize({ w: 100, h: 50 }, { w: 0, h: 0 }).h, 0)

/* ------------------------------------------------------------------ */
/* 7. 连续操作的不变量（模拟狂滚）                                      */
/* ------------------------------------------------------------------ */

console.log('\n--- 连续滚轮 40 次的不变量 ---')

let z = 1
let off = { x: 0, y: 0 }
const base = { w: 640, h: 480 }
let broken = 0
// 锚点在舞台内随机位置来回滚，倍率与位移每一轮都必须是合法状态
for (let i = 0; i < 40; i++) {
  const delta = (i % 7 === 0 ? 1 : -1) * (100 + (i % 5) * 20)
  const mx = ((i * 37) % 800) - 400
  const my = ((i * 53) % 500) - 250
  const nz = zoomByWheel(z, delta)
  off = clampOffset(zoomAt(off, z, nz, mx, my), nz, base, stage)
  z = nz
  const limit = clampOffset(off, z, base, stage)
  if (Math.abs(limit.x - off.x) > 1e-9 || Math.abs(limit.y - off.y) > 1e-9) broken++
  if (!(z >= MIN_ZOOM && z <= MAX_ZOOM)) broken++
}

check('40 轮后倍率与位移始终合法', broken, 0)
check('狂滚之后倍率仍在范围内', z >= MIN_ZOOM && z <= MAX_ZOOM, true)

/* ------------------------------------------------------------------ */
/* 8. 界面层：别踩回老坑                                                */
/* ------------------------------------------------------------------ */

console.log('\n--- 界面层 ---')

check('舞台挂了滚轮监听', /@wheel="onWheel"/.test(view), true)
check('滚轮里 preventDefault（否则会带着页面一起滚）', /e\.preventDefault\(\)/.test(view), true)

// 硬规矩 1：用 transform 定位的元素不能挂带 transform 的关键帧
const keyframes = [...view.matchAll(/@keyframes\s+([\w-]+)\s*\{([^}]*\})*?\s*\}/g)].map(
  (m) => m[0]
)
check('预览层定义了动画', keyframes.length > 0, true)
const bad = keyframes.filter((k) => /transform\s*:/.test(k))
check('没有任何关键帧改动 transform', bad.length, 0)
check('图片淡入只动透明度', /@keyframes img-in\s*\{\s*from\s*\{\s*opacity: 0;\s*\}\s*to\s*\{\s*opacity: 1;\s*\}\s*\}/.test(view), true)

check('放大后裁在舞台里（overflow: hidden）', /\.preview-stage\s*\{[^}]*overflow: hidden/.test(view), true)
// 坑 1：图片由 v-show 控制，load 那一刻元素还是 display:none，量 offsetWidth 只能是 0，
// 基准尺寸记成 0 之后锚点缩放会被一路夹回原点。基准必须取自 naturalWidth（与可见性无关）。
check('基准尺寸取自 naturalWidth（不受显示状态影响）', /naturalWidth[\s\S]{0,120}fitSize\(/.test(view), true)

// 坑 2（用户反馈）：放大不能用 transform: scale() —— 那只拉伸"适应窗口"时那张光栅化位图，
// 放大必糊（别的软件是按目标尺寸重新采样的）。必须按真实布局尺寸渲染。
check('缩放走真实布局尺寸（width = 基准 × 倍率）', /width: `\$\{b\.w \* zoom\.value\}px`/.test(view), true)
check('高度同样按倍率给', /height: `\$\{b\.h \* zoom\.value\}px`/.test(view), true)
check('放大时解除 CSS 的上限约束', /maxWidth: 'none'/.test(view), true)
check('位移仍走 transform: translate', /translate\(\$\{offset\.value\.x\}px, \$\{offset\.value\.y\}px\)/.test(view), true)
check('缩放不用 scale（纹理拉伸会糊）', /scale\(\$\{zoom\}\)/.test(view), false)
// 行首匹配（注释里会提到这个词，不能算数）
check('不写 will-change（会锁光栅倍率，放大糊）', /^\s*will-change:/m.test(view), false)
check('代码里说明了为什么不能用 scale', /不要用|绝不能用 transform: scale|不能用\s*`transform: scale\(\)`/.test(view), true)

check('换一张图要重置视图', /zoom\.value = 1/.test(view), true)
check('换图时位移也归零', /offset\.value = \{ x: 0, y: 0 \}/.test(view), true)

check('拖动用 window 级 mousemove', /window\.addEventListener\('mousemove', onMouseMove\)/.test(view), true)
check('拖动结束时解绑', /window\.removeEventListener\('mousemove', onMouseMove\)/.test(view), true)
check('拖动经过边界夹取', /onMouseMove[\s\S]{0,400}clampOffset/.test(view), true)
check('拖完不当作点背景关闭', /function onStageClick[\s\S]{0,120}if \(moved\) return/.test(view), true)
check('有 3px 抖动阈值', /Math\.abs\(dx\) \+ Math\.abs\(dy\) > 3/.test(view), true)
check('图片禁止原生拖拽（否则和我们的拖动打架）', /draggable="false"/.test(view), true)

check('顶栏有缩小按钮', /title="缩小 \(-\)"/.test(view), true)
check('顶栏有放大按钮', /title="放大 \(\+\)"/.test(view), true)
check('顶栏有百分比（点它复原）', /class="btn pct"/.test(view), true)
check('顶栏有 1:1', /按原始像素显示 \(1\)/.test(view), true)
check('1:1 的提示里带对应倍率', /`按原始像素显示 \(1\) · \$\{Math\.round\(actualRatio \* 100\)\}%`/.test(view), true)
check('到头了按钮置灰', /:disabled="zoom <= MIN_ZOOM"/.test(view), true)
check('顶栏三列布局（缩放组居中）', /grid-template-columns: 1fr auto 1fr/.test(view), true)
check('百分比用等宽数字（防跳字）', /\.btn\.pct\s*\{[^}]*tabular-nums/.test(view), true)

check('键盘 + 放大', /case '\+':/.test(view), true)
check('键盘 - 缩小', /case '-':/.test(view), true)
check('键盘 0 复原', /case '0':/.test(view), true)
check('键盘 1 原始像素', /case '1':/.test(view), true)
check('双击切换倍率', /@dblclick="toggleZoom"/.test(view), true)
// 放大糊的根因验证：1:1 处（原图信息充足、本该无损）旧做法锐利度 1.368、新做法 1.875（+37%）。
// 超过原始像素之后再放大，任何软件都只是把像素摊大 —— 这一点必须让用户看见。
check('底栏显示实际读到的像素（不是宿主记录值）', /natural\.value\.w && natural\.value\.h/.test(view), true)
check('算得出"1:1 对应多少倍率"', /actualRatio/.test(view), true)
check('超过原始像素时给出提示', /beyondActual/.test(view), true)
check('超过时百分比变色提醒', /\.btn\.pct\.over/.test(view), true)
check('提示文案说明"再放大也不会更清晰"', /再放大也不会更清晰/.test(view), true)

check('底部提示写清了滚轮缩放', /滚轮缩放/.test(view), true)
check('底部提示写清了拖动平移', /拖动平移/.test(view), true)
check('不可拖时不给抓手光标', /\.preview-stage\.pannable \{ cursor: grab/.test(view), true)

check('缩放逻辑确实抽成了可测模块', /from '\.\.\/utils\/zoom'/.test(view), true)
check('缩放模块里没有 DOM 依赖（纯函数）', /document\.|window\./.test(zoomSrc), false)
check('缩放模块标注了为什么是纯函数', /design\/check-zoom\.mts/.test(zoomSrc), true)

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`)
if (fail > 0) process.exit(1)
