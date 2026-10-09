/**
 * 侧栏分类（含图标素材）回归测试
 *   node --experimental-strip-types --import ./design/ts-register.mjs design/check-cats.mts
 *
 * 这一套守着五件容易出事的事：
 *
 *   1. **图标两两不像**。起因是「全部」和「文本」都画成三条横线，16px 下分不出来。
 *      现在图标是外部素材（_shared/clipboard-icons），换素材时光比文件名没用 ——
 *      这里直接**解 PNG 比像素**，两张图长得像就会挂。
 *   2. **必须是透明底**（v2 起全线只用 glyphs 版）。带底板的 cards 版底色不透光，
 *      深色主题下会变成一块刺眼的亮白方块 —— 实拍确认过，8 个图标像 8 个发光按钮。
 *   3. **大图标位用大素材**：20px 的图标位用 64px 那档，空态/占位（32–48px）用 128px
 *      原图。用错了在 DPR 2 的屏幕上会虚。
 *   4. **素材本身可用**：分辨率够、不是整块空白、字形在统一画布里是居中的
 *      （不居中会导致 8 个图标视觉上参差不齐）。
 *   5. **界面层真的用上了**：用 <img>、有 object-fit: contain
 *      （万一素材换回紧裁的异形版本，漏了 contain 就会被拉变形）。
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { decodePng } = require('./png.cjs')

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

/** 断言"至少/至多/大于"这类范围时用，避免把阈值写成等号 */
function checkThat(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`)
}

const { CATS } = await import('../src/utils/categories.ts')
const { KIND_META } = await import('../src/utils/format.ts')
const { CAT_ICONS, CAT_ICONS_LG } = await import('../src/utils/icons.ts')

/** 读源码做界面层断言（不依赖 DOM） */
function src(rel: string): string {
  return readFileSync(new URL('../src/' + rel, import.meta.url), 'utf8')
}
const sidebar = src('components/Sidebar.vue')
const iconsTs = src('utils/icons.ts')
const item = src('components/ClipboardItem.vue')
const codeCard = src('components/CodeCard.vue')
const fileCard = src('components/FileCard.vue')
const imageCard = src('components/ImageCard.vue')
const app = src('App.vue')

/* ------------------------------------------------------------------ */
/* 1. 分类清单                                                         */
/* ------------------------------------------------------------------ */

console.log('--- 分类完整性 ---')
check('分类数量', CATS.length, 8)
check(
  '分类顺序',
  CATS.map((c) => c.key).join(','),
  'all,text,link,code,color,image,file,star'
)
check('每个分类都有标签', CATS.every((c) => !!c.label), true)
check('每个分类都有图标', CATS.every((c) => typeof c.icon === 'string' && c.icon.length > 0), true)

/* ------------------------------------------------------------------ */
/* 2. 素材映射（文件名 → 分类）                                         */
/* ------------------------------------------------------------------ */

console.log('\n--- 素材映射 ---')

/** 图标 URL 在 Node 下是 "./src/assets/icons/…/xxx.png"（见 design/ts-hooks.mjs） */
const fileOf = (url: string): string => url.split('/').pop() || ''
const dirOf = (url: string): string => url.split('/').slice(-2)[0] || ''

const EXPECT: Record<string, string> = {
  all: 'all.png',
  text: 'text.png',
  link: 'link.png',
  code: 'code.png',
  color: 'color.png',
  image: 'image.png',
  file: 'file.png',
  // 素材里收藏叫 fav；内部 key 是 star
  star: 'fav.png'
}

for (const c of CATS) {
  check(`「${c.label}」用 ${EXPECT[c.key]}`, fileOf(c.icon), EXPECT[c.key])
  // 全线只用透明底字形版（glyphs），带底板的卡片版在深色主题下会变成亮白块
  check(`「${c.label}」用透明底字形版`, /glyphs/.test(c.icon), true)
}

check('8 个分类指向 8 张不同素材', new Set(CATS.map((c) => fileOf(c.icon))).size, 8)
check(
  '两档素材一一对应（同一批图形）',
  Object.keys(CAT_ICONS).sort().join() === Object.keys(CAT_ICONS_LG).sort().join(),
  true
)
check(
  '两档素材同名同数',
  Object.keys(CAT_ICONS)
    .map((k) => fileOf((CAT_ICONS as never)[k]))
    .sort()
    .join() ===
    Object.keys(CAT_ICONS_LG)
      .map((k) => fileOf((CAT_ICONS_LG as never)[k]))
      .sort()
      .join(),
  true
)
check('小图标位用 64px 预缩档', Object.values(CAT_ICONS).every((u) => /\/64\//.test(u as string)), true)
check('大图标位用 128px 原图档', Object.values(CAT_ICONS_LG).every((u) => !/\/64\//.test(u as string)), true)

const iconsRoot = new URL('../src/assets/icons/', import.meta.url)
const localPath = (url: string): URL => new URL(url.replace(/^\.\/src\/assets\/icons\//, ''), iconsRoot)
check('小图标位素材文件都存在', CATS.every((c) => existsSync(localPath(c.icon))), true)
check(
  '大图标位素材文件都存在',
  Object.values(CAT_ICONS_LG).every((u) => existsSync(localPath(u as string))),
  true
)
check('仓库里不再有 cards 版素材', existsSync(new URL('cards', iconsRoot)), false)
check('空态/引导场景用大图档', /CAT_ICONS_LG\.all/.test(app), true)
check('源码里不再引用 CAT_CARDS', /CAT_CARDS/.test(app + iconsTs + imageCard + sidebar), false)

/* ------------------------------------------------------------------ */
/* 3. 素材像素：够清楚、不是空的、两两不像                               */
/* ------------------------------------------------------------------ */

console.log('\n--- 素材像素 ---')

type Img = { width: number; height: number; channels: number; data: Buffer }
const imgs = new Map<string, Img>()
for (const c of CATS) {
  imgs.set(c.key, decodePng(localPath(c.icon)) as Img)
}

/**
 * 缩放到 n×n 的 RGB 均值。
 * 透明像素按"底色"处理：字形版是紧裁的，四角全透明，
 * 直接平均透明像素的 RGB 会读到生成器写进去的杂色。
 */
function thumb(img: Img, n = 8): number[] {
  const { width, height, channels, data } = img
  const out: number[] = []
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const x0 = Math.floor((tx * width) / n)
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / n))
      const y0 = Math.floor((ty * height) / n)
      const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / n))
      let r = 0
      let g = 0
      let b = 0
      let wsum = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * channels
          // 有 alpha 通道就按 alpha 加权：透明像素不应参与配色比较
          const a = channels === 4 ? data[i + 3] / 255 : channels === 2 ? data[i + 1] / 255 : 1
          r += data[i] * a
          g += data[i + 1] * a
          b += data[i + 2] * a
          wsum += a
        }
      }
      if (wsum === 0) out.push(255, 255, 255)
      else out.push(r / wsum, g / wsum, b / wsum)
    }
  }
  return out
}

/** 缩略图加权色，用于两两比较（越接近越像） */
function thumbDiff(a: Img, b: Img): number {
  const ta = thumb(a)
  const tb = thumb(b)
  let sum = 0
  for (let i = 0; i < ta.length; i++) sum += Math.abs(ta[i] - tb[i])
  return sum / ta.length
}

/** 四角 alpha 均值：透明底素材应接近 0，卡片版应接近 255 */
function cornerAlpha(img: Img): number {
  const { width, height, channels, data } = img
  if (channels !== 4) return 255
  const s = Math.max(1, Math.floor(width * 0.05))
  let sum = 0
  let n = 0
  for (const [cx, cy] of [
    [0, 0],
    [width - s, 0],
    [0, height - s],
    [width - s, height - s]
  ]) {
    for (let y = cy; y < cy + s; y++) {
      for (let x = cx; x < cx + s; x++) {
        sum += data[(y * width + x) * channels + 3]
        n++
      }
    }
  }
  return sum / n
}

/** 以"最亮格与最暗格的亮度差"衡量图形是否有内容（整块纯色会趋近 0） */
function contrast(img: Img): number {
  const t = thumb(img)
  let min = 255
  let max = 0
  for (let i = 0; i < t.length; i += 3) {
    const l = 0.299 * t[i] + 0.587 * t[i + 1] + 0.114 * t[i + 2]
    if (l < min) min = l
    if (l > max) max = l
  }
  return max - min
}

checkThat(
  '小图标档边长 ≥ 64px（20px 图标位 + DPR 2 都够）',
  CATS.every((c) => Math.min(imgs.get(c.key)!.width, imgs.get(c.key)!.height) >= 64),
  CATS.map((c) => `${fileOf(c.icon)}=${imgs.get(c.key)!.width}x${imgs.get(c.key)!.height}`).join(' ')
)

const lg = Object.entries(CAT_ICONS_LG).map(
  ([k, u]) => [k, decodePng(localPath(u as string)) as Img] as const
)
checkThat(
  '大图标档边长 ≥ 128px（空态 48px 在 DPR 2 下要 96 物理像素）',
  lg.every(([, i]) => i.width >= 128 && i.height >= 128),
  lg.map(([k, i]) => `${k}=${i.width}x${i.height}`).join(' ')
)

console.log('\n--- 统一画布：正方形 + 字形居中（否则 8 个图标会参差不齐）---')

for (const c of CATS) {
  const im = imgs.get(c.key)!
  check(`「${c.label}」画布是正方形`, im.width === im.height, true)
}
for (const [k, im] of lg) {
  check(`大图档「${k}」画布是正方形`, im.width === im.height, true)
}

/** 非透明像素的包围盒中心相对画布中心的偏移（百分比） */
function offCenter(img: Img): number {
  const { width, height, channels, data } = img
  let minx = width
  let miny = height
  let maxx = -1
  let maxy = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const a = channels === 4 ? data[i + 3] : channels === 2 ? data[i + 1] : 255
      if (a > 8) {
        if (x < minx) minx = x
        if (y < miny) miny = y
        if (x > maxx) maxx = x
        if (y > maxy) maxy = y
      }
    }
  }
  const cx = (minx + maxx) / 2
  const cy = (miny + maxy) / 2
  return Math.max(Math.abs(cx - width / 2), Math.abs(cy - height / 2)) / width * 100
}

for (const c of CATS) {
  const o = offCenter(imgs.get(c.key)!)
  checkThat(`「${c.label}」字形在画布里居中`, o <= 3, `偏移=${o.toFixed(2)}%`)
}

/** 字形占画布的比例（留白太多会让同样容器尺寸下看着比其他图标小） */
function fill(img: Img): number {
  const { width, height, channels, data } = img
  let minx = width
  let miny = height
  let maxx = -1
  let maxy = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels
      const a = channels === 4 ? data[i + 3] : channels === 2 ? data[i + 1] : 255
      if (a > 8) {
        if (x < minx) minx = x
        if (y < miny) miny = y
        if (x > maxx) maxx = x
        if (y > maxy) maxy = y
      }
    }
  }
  return Math.max(maxx - minx + 1, maxy - miny + 1) / width * 100
}

const fills = CATS.map((c) => ({ label: c.label, f: fill(imgs.get(c.key)!) }))
console.log('  字形占画布：' + fills.map((x) => `${x.label}=${x.f.toFixed(0)}%`).join(' '))
checkThat(
  '每个字形都撑得起画布（≥40%，太小会看着比别的图标小一圈）',
  fills.every((x) => x.f >= 40),
  fills.map((x) => `${x.label}=${x.f.toFixed(0)}%`).join(' ')
)

for (const c of CATS) {
  checkThat(
    `「${c.label}」素材不是一张纯色/空白图`,
    contrast(imgs.get(c.key)!) >= 40,
    `对比度=${contrast(imgs.get(c.key)!).toFixed(1)}`
  )
}

console.log('\n--- 形态：两档素材都必须是透明底 ---')

for (const c of CATS) {
  const a = cornerAlpha(imgs.get(c.key)!)
  checkThat(
    `「${c.label}」是透明底（深色主题下不会变成亮白块）`,
    a <= 8,
    `四角alpha=${a.toFixed(1)}`
  )
}
for (const [k, img] of lg) {
  const a = cornerAlpha(img)
  checkThat(
    `大图档「${k}」也是透明底`,
    a <= 8,
    `四角alpha=${a.toFixed(1)}`
  )
}

console.log('\n--- 图标两两不像（20px 下长得像 = 分不出来）---')

let minThumb = Infinity
let minPair = ''
for (let i = 0; i < CATS.length; i++) {
  for (let j = i + 1; j < CATS.length; j++) {
    const a = CATS[i]
    const b = CATS[j]
    const pt = thumbDiff(imgs.get(a.key)!, imgs.get(b.key)!)
    if (pt < minThumb) {
      minThumb = pt
      minPair = `${a.label}/${b.label}`
    }
  }
}
console.log(`  最像的一对：${minPair} = ${minThumb.toFixed(1)}`)
checkThat('没有两张素材在小尺寸下分不出来', minThumb >= 8, `最小=${minThumb.toFixed(1)}`)

// 显式回归：这两对配色最接近，最容易被换素材换重复
const diff = (x: string, y: string): number => thumbDiff(imgs.get(x)!, imgs.get(y)!)
checkThat('代码 ≠ 图片（都是青绿系）', diff('code', 'image') >= 8, `差=${diff('code', 'image').toFixed(1)}`)
checkThat('颜色 ≠ 文件（都是暖橙系）', diff('color', 'file') >= 8, `差=${diff('color', 'file').toFixed(1)}`)
checkThat('全部 ≠ 文本（历史回归）', diff('all', 'text') >= 8, `差=${diff('all', 'text').toFixed(1)}`)

/* ------------------------------------------------------------------ */
/* 4. 界面层：真的用 img 引了这些素材、尺寸与适配都对                    */
/* ------------------------------------------------------------------ */

console.log('\n--- 界面层 ---')

check('侧栏用 <img> 渲染图标（图片不能再靠 stroke 变色）', /<img[^>]*class="cat-icon"/.test(sidebar), true)
check('侧栏不再有分类图标用的 <svg>', /:d="cat\.icon"|catIconColor/.test(sidebar), false)
check('侧栏图标绑到 cat.icon', /:src="cat\.icon"/.test(sidebar), true)
check('图片不可被拖出（拖拽会带出一张半透明幽灵图）', /draggable="false"/.test(sidebar), true)

/** 从 CSS 里读出一个类声明的某个属性值（本仓库样式都是静态的，够用） */
function cssOf(source: string, cls: string, prop: string): string {
  const m = source.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`))
  if (!m) return ''
  const p = m[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))
  return p ? p[1].trim() : ''
}

const catIconW = cssOf(sidebar, 'cat-icon', 'width')
check(
  '侧栏图标位 20px（28 / 24px 都试过，用户仍反馈偏大，再收一档）',
  catIconW,
  '20px'
)
check('图标位高度与宽度一致', cssOf(sidebar, 'cat-icon', 'height'), '20px')
checkThat('图标位 flex: none（不被长标签压扁）', /\.cat-icon\s*\{[^}]*flex:\s*none/.test(sidebar), true)

for (const [label, source, cls] of [
  ['侧栏分类', sidebar, 'cat-icon'],
  ['文本/链接/颜色项', item, 'type-icon'],
  ['代码卡片', codeCard, 'type-icon'],
  ['文件卡片', fileCard, 'type-icon'],
  ['图片占位', imageCard, 'fallback-icon']
] as const) {
  // 素材现在虽然是统一正方形画布，仍保留 contain：
  // 万一以后换回紧裁的异形版本（各图宽高比不同），漏了它就会被硬拉变形。
  check(`${label}有 object-fit: contain`, cssOf(source, cls, 'object-fit'), 'contain')
}

for (const [name, s, attr] of [
  ['文本/链接/颜色项', item, 'meta.icon'],
  ['代码卡片', codeCard, 'KIND_META.code.icon'],
  ['文件卡片', fileCard, 'KIND_META.file.icon']
] as const) {
  check(`${name}用 <img> 引素材`, new RegExp(`<img[^>]*:src="${attr.replace('.', '\\.')}"`).test(s), true)
}
check('类型标识不再用内联 svg', /icon-svg type-icon/.test(item + codeCard + fileCard), false)
check(
  '图片占位用大图档（32px 显示，64px 那档在 DPR 2 下不够）',
  /<img[^>]*class="fallback-icon"[^>]*CAT_ICONS_LG\.image/.test(imageCard),
  true
)
check('空态用大图档素材', /<img[^>]*class="empty-icon"[^>]*CAT_ICONS_LG\.all/.test(app), true)

check('列表项类型图标也是 20px', cssOf(item, 'type-icon', 'width'), '20px')
check('代码卡片类型图标也是 20px', cssOf(codeCard, 'type-icon', 'width'), '20px')
check('文件卡片类型图标也是 20px', cssOf(fileCard, 'type-icon', 'width'), '20px')
check('图片占位 32px', cssOf(imageCard, 'fallback-icon', 'width'), '32px')
check('空态 48px', cssOf(app, 'empty-icon', 'width'), '48px')
check('空态图标高度与宽度一致', cssOf(app, 'empty-icon', 'height'), '48px')

// 图标位（.lead）要能容下 20px 图标还留点边距 ——
// 容器必须严格大于图标（贴边难看），但文件行可用内容高只有 34px，超了撑破行高。
// 24px 容器 = 20px 图标 + 两侧各 2px，是"不贴边又不撑破"的取值。
const leadPx = (s: string): number => Number((cssOf(s, 'lead', 'width') || '0').replace('px', ''))
for (const [label, s] of [
  ['文本/链接/颜色项', item],
  ['文件卡片', fileCard]
] as const) {
  const w = leadPx(s)
  const h = Number((cssOf(s, 'lead', 'height') || '0').replace('px', ''))
  checkThat(`${label}的图标容器 ≥23px（20px 图标贴边就难看）`, w >= 23 && h >= 23, `${w}x${h}`)
  checkThat(`${label}的容器不超过 34px（文件行可用内容只有 34px，超了撑破行高）`, w <= 34 && h <= 34, `${w}x${h}`)
  checkThat(`${label}的容器比图标大（留白 ≥3px）`, w - 20 >= 3 && h - 20 >= 3, `${w}x${h}`)
}
checkThat('代码卡片的图标容器也是 24px', leadPx(codeCard) === 24, cssOf(codeCard, 'lead', 'width'))

/* ------------------------------------------------------------------ */
/* 5. 与 KIND_META 的关系                                              */
/* ------------------------------------------------------------------ */

console.log('\n--- 与 KIND_META 的关系 ---')

// 侧栏分类图标应当复用列表项的类型图标，避免同一类型出现两套图形
for (const k of ['text', 'link', 'code', 'color', 'image', 'file'] as const) {
  const cat = CATS.find((c) => c.key === k)!
  check(`「${cat.label}」复用 KIND_META 图标`, cat.icon === KIND_META[k].icon, true)
}
check('素材映射集中在 utils/icons.ts（视图层不自己拼路径）', /CAT_ICONS/.test(iconsTs), true)
check('素材来源写明了（便于换素材时回溯）', /_shared\/clipboard-icons/.test(iconsTs), true)
check('代码里写明了透明底的理由', /深色主题下会变成一块刺眼的亮白方块/.test(iconsTs), true)
check('代码里写明了两档素材的分工理由', /64\/` 版/.test(iconsTs), true)

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`)
if (fail > 0) process.exitCode = 1
