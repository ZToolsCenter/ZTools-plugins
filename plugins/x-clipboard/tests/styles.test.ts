/*
 * 单文件组件的样式卫生。
 *
 * 起因是一个很难看的 bug：清空历史的确认框只显示一句话、**按钮不见了**。
 * 不是按钮没渲染，是被"串味"了 —— 行尾那两枚收藏/删除按钮的容器叫 `.acts`，
 * 带 `opacity: 0; pointer-events: none; position: absolute`；确认框的按钮容器也叫 `.acts`。
 * scoped 样式只给**选择器最后一个复合选择器**加 `[data-v-x]`，
 * 于是两条规则编译出来都是 `.acts[data-v-x]`，同时命中同一个元素 —— 按钮被自己的亲戚藏了。
 *
 * 这种 bug 不看界面发现不了，所以拿两个便宜的断言把它钉住：
 *   1. 顶层"单个类名"选择器不允许重名（就是上面那种撞车）；
 *   2. 模板里用到的每个类，样式表里都得有出处（防改名改一半）。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const SFC = fileURLToPath(new URL('../src/App.vue', import.meta.url))
const src = readFileSync(SFC, 'utf8')

/*
 * 取 SFC 里某一个顶层块的内容。
 *
 * ⚠️ **`[\s\S]*` 必须是贪婪的**：模板里可以合法地出现**嵌套的 `<template v-if>`**
 * （底栏那段就有一个）。用非贪婪 `*?` 的话，抽到的"模板"会在第一个内层 `</template>`
 * 就断掉 —— 后半段整个消失，`dlgacts` 那种断言全部落空。
 * 09-16 加底栏那档设置时真踩到了：测试红了，但红的是"找不到 dlgacts"，
 * 跟实际改动八竿子打不着，差点当成自己把确认框改坏了。
 * 整个 SFC 只有一个顶层块，所以贪婪匹配到**最后一个**闭合标签才是它。
 * 同一个函数还被拿去抽 `<style>`，那边只有一个块，贪婪同样安全。
 */
function block(tag: string): string {
  const m = src.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*)</${tag}>`))
  assert.ok(m, `App.vue 里找不到 <${tag}>`)
  return m[1]
}

/** 去掉注释，别把注释里写的类名算进来 */
const css = block('style').replace(/\/\*[\s\S]*?\*\//g, '')
const template = block('template')

test('样式表里没有重名的顶层单类选择器（.acts 那种串味）', () => {
  const seen = new Map<string, number>()
  for (const group of css.match(/[^{}]+\{/g) ?? []) {
    for (const one of group.slice(0, -1).split(',')) {
      const sel = one.trim()
      // 只盯"就一个类名"的选择器：`.acts { ... }`
      // 后代 / 伪类 / 属性选择器天然带上下文，不算撞车
      if (!/^\.[A-Za-z][\w-]*$/.test(sel)) continue
      seen.set(sel, (seen.get(sel) ?? 0) + 1)
    }
  }

  const dup = [...seen].filter(([, n]) => n > 1).map(([sel]) => sel)
  assert.deepEqual(dup, [], `顶层单类选择器重名：${dup.join(', ')}`)
})

test('模板里用的类，样式表里都有', () => {
  const inCss = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]))

  const used = new Set<string>()
  // 静态：class="a b c"。
  // 前面加 `(?<![:-\w])` 是必须的 —— 不然 `:class="{ on: x === false }"` 里的
  // `class="…"` 片段也会被当成静态类名，拆出一堆 `false`、`k` 这种假货。
  for (const m of template.matchAll(/(?<![:-\w])class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (/^[a-z][\w-]*$/.test(c)) used.add(c)
  }
  // 动态：:class="{ on: x, 'mark-': y }"
  for (const m of template.matchAll(/:class="\{([^}]*)\}"/g)) {
    for (const part of m[1].split(',')) {
      const key = part.split(':')[0].trim()
      const lit = key.match(/^'([\w-]+)'$/)
      if (lit) used.add(lit[1])
      else if (/^[a-z][\w-]*$/.test(key)) used.add(key)
    }
  }

  const missing = [...used].filter((c) => !inCss.has(c)).sort()
  assert.deepEqual(missing, [], `模板用了但样式里没有：${missing.join(', ')}`)
})

test('★ 详情浮层的 box-sizing 必须是 border-box（宽度是 JS 内联给的，只有这一处能兜）', () => {
  /*
   * 老大 09-16 报的「详情框左边跟行对齐、右边却填满窗口」的真凶就是这个：
   * 宽度由 `peekGeom()` 算好内联写上去（正好等于行宽），而 `.peek` 自己又有横向 padding，
   * 本项目**没有全局 box-sizing**（默认 content-box）—— 于是实际盒子 = 行宽 + 2×padding，
   * 右边一路冲出窗口被裁掉。**别把这一行删掉。**
   *
   * 这条只能这么测：宽度不在样式表里（是 JS 内联的），所以机械扫描"width + padding"扫不到它。
   */
  const rule = css.match(/\.peek\s*\{([^}]*)\}/)
  assert.ok(rule, '样式表里找不到 .peek')
  assert.match(rule[1], /box-sizing:\s*border-box/, '.peek 少了 box-sizing: border-box')
  assert.match(rule[1], /padding:/, '.peek 不再有 padding 了？那这条断言该改写')

  // 确认框同理：同样有 width + 横向 padding
  const box = css.match(/\.box\s*\{([^}]*)\}/)
  assert.ok(box, '样式表里找不到 .box')
  assert.match(box[1], /box-sizing:\s*border-box/, '.box 少了 box-sizing: border-box')
})

test('确认框的按钮容器不再是 .acts（这条就是本次 bug 的碑）', () => {
  assert.match(template, /class="dlgacts"/)
  assert.match(css, /\.dlgacts\s*\{/)
  // 行尾那条必须带上 .row 前缀，否则又会串到确认框上
  assert.match(css, /\.row\s+\.acts\s*\{/)
  assert.doesNotMatch(css, /^\.acts\s*\{/m)
})

/*
 * 底栏两颗按钮（设置 / 清空）的悬停效果，必须跟「选中项」那套走。
 *
 * 老大 09-16 提的：在设置里调「选中项 / 强调色」时，底栏这两颗也该同步 ——
 * 不然同一屏里两套规矩（行是实心块、按钮只是换了个字色）。
 * 所以三档 × 两颗 = 6 条规则都得在：**形状随 mark、颜色随 accent**
 * （清空走 danger 红 —— 它是要删东西的，红是它的语义；但形状跟设置一模一样）。
 */
test('★ 底栏按钮的效果跟 mark 三档 + 强调色走（别退回"只变字色"）', () => {
  for (const mark of ['mark-border', 'mark-tint', 'mark-solid']) {
    assert.match(css, new RegExp(`\\.root\\.${mark} \\.clr:hover`), `${mark} 档：清空那颗没有规则`)
    assert.match(
      css,
      new RegExp(`\\.root\\.${mark} \\.clr\\.set:hover`),
      `${mark} 档：设置那颗没有规则`
    )
  }
  assert.match(css, /\.root\.mark-border \.clr\.set:hover\s*\{[^}]*var\(--accent\)/)
  assert.match(css, /\.root\.mark-solid \.clr\.set:hover\s*\{[^}]*var\(--row-on-tx\)/)
  // 危险色已经收进 `--danger`，App.vue 里不该再有硬编码的红
  assert.doesNotMatch(css, /#ff453a/i, 'danger 收进 --danger 了，别在 App.vue 里再硬写')
  // 「设置」不是危险操作，永远别跟着红
  assert.doesNotMatch(css, /\.clr\.set:hover\s*\{[^}]*--danger/)
})

/*
 * 按钮上的 UA 焦点环必须被掐掉。
 *
 * 老大 09-16 报的：点「设置」→ 弹出面板 → 按 Esc 关掉，那两个字上还围着一圈橙线
 * （Chromium 的 UA focus 环，颜色取自系统强调色，所以是琥珀色）。
 * 根因是点完焦点留在按钮上没走；而本插件**没有键盘聚焦按钮的路**
 * （Tab 被「切分类」占了），那圈环只有"鼠标点完的残留"这一种来源。
 *
 * ⚠️ 09-18 后这句话要补半句：设置面板**确实**有了键盘路，但它是**虚拟光标**（`←→↑↓`
 * 挪 `.cur`），**不调 `focus()`** —— 真去 `focus()` 就会把这条刚掐掉的 UA 环请回来。
 * 所以「UA 环只有鼠标残留」这个结论仍然成立，只是理由从"没有路"变成了"路不碰 DOM 焦点"。
 */
test('★ 按钮的 UA 焦点环已掐掉（base.css 的 button:focus）', () => {
  const base = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')
  const rule = base.match(/button:focus[\s\S]{0,140}?\{([^}]*)\}/)
  assert.ok(rule, 'base.css 里找不到 button:focus 规则')
  assert.match(rule[1], /outline:\s*none/, '按钮的焦点环又回来了')
})

/*
 * ★ 确认框居中 —— 位置由 CSS 给，**不是 JS 算的**。
 *
 * 老大 09-17 要求：删除弹框从「跟着鼠标弹（下面不够翻上方）」改成**居中**。
 * 定位于是整块从 JS 挪进 CSS（`.mask` 的 flex），`lib/popover.ts` 和它的测试一并删掉 ——
 * 那套「先 visibility:hidden 渲染一帧、量到尺寸再放出来」本来只为判断下面够不够，
 * 居中了就完全没有意义。
 *
 * 下面两条 `doesNotMatch` 是防回退：谁要是把 popover 那套加回来，先在这里红一次。
 */
test('★ 确认框居中：位置由 .mask 的 flex 给，别再让 JS 算坐标', () => {
  const mask = css.match(/\.mask\s*\{([^}]*)\}/)
  assert.ok(mask, '样式表里找不到 .mask')
  assert.match(mask[1], /display:\s*flex/, '.mask 不是 flex 容器了')
  assert.match(mask[1], /align-items:\s*center/, '.mask 少了纵向居中')
  assert.match(mask[1], /justify-content:\s*center/, '.mask 少了横向居中')

  assert.doesNotMatch(src, /placePopover|anchorAtPointer|confirmPos/, 'popover 那套定位又回来了？')
  assert.doesNotMatch(template, /:style="popStyle/, '模板里又在给确认框内联坐标了')
})

/*
 * ★ 设置面板的**排布**（09-17 老大要求）：按控件类型分三段、**段内按行长从短到长**。
 *
 *   ① 色点段：底色（4 颗）→ 强调色（13 颗）
 *   ② 选中段（药丸）：行尾（2 颗）→ 选中项（3 颗）→ 底栏（4 颗）
 *   ③ 开关段：行尾按钮 → 显示详情 → 删除前确认
 *
 * 改之前是「按主题」混排的（行尾、行尾按钮、底栏、显示详情…），三种控件形状一格一格交替，
 * 右边缘那列开关被药丸行打断。老大原话：「设置也要分类放一起才好看」。
 *
 * ⚠️ **方向是短→长**，我第一版做成了长→短，被老大当场纠回来：「为什么不是每个类都是从短到长呢，
 *    你是从长到短……应该从短到长」。改这条断言时别再顺手翻回去。
 *
 * ⚠️ 这是**有意锁住的**：以后再调整排布，请连这条断言一起改 —— 不要顺手把它删掉，
 *    否则"开关又被夹在两段药丸中间"这种回退没人拦得住。
 */
test('★ 设置面板：按控件类型分三段（段内短→长），开关段连着压在最下面', () => {
  const start = template.indexOf('class="sheet-body"')
  assert.ok(start > -1, 'App.vue 里找不到 .sheet-body')
  const end = template.indexOf('<!-- 确认框：', start)
  const panel = template.slice(start, end > start ? end : undefined)

  // 1) 开关段不许被任何药丸组打断：第一颗开关之后不能再出现 `.grp`
  const firstOpt = panel.indexOf('class="opt')
  assert.ok(firstOpt > -1, '面板里找不到开关行（.opt）')
  assert.doesNotMatch(
    panel.slice(firstOpt),
    /class="grp/,
    '开关段被药丸组打断了 —— 同形状的控件要连着排，开关统一压在最下面'
  )

  // 2) 各组标题的先后（开关段没有标题，所以只到「底栏」）
  const labels = [...panel.matchAll(/class="lbl">([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(
    labels,
    ['底色', '强调色', '行尾', '选中项', '底栏'],
    '面板分组顺序变了（期望：色点段 底色/强调色 → 选中段 行尾/选中项/底栏，段内短→长）'
  )

  // 3) 开关段的三行及其先后（标签 4/4/5 字，也正好是短→长；越靠下越危险，删除前确认压尾）
  const switches = [...panel.matchAll(/class="nm">([^<]+)</g)].map((m) => m[1])
  assert.deepEqual(switches, ['行尾按钮', '显示详情', '删除前确认'])

  // 4) 段间空隙标记 `.blk` 正好两处：第②③ 段的第一行各一次
  assert.equal(
    (panel.match(/class="(?:grp|opt) blk"/g) ?? []).length,
    2,
    '`.blk` 应该正好两处（选中段首行、开关段首行）—— 重排时记得把它跟着搬'
  )
})

/*
 * ★ 圆角只有三档：4 / 8 / 999（09-17 老大拍板）。
 *
 * 收之前散着 **4 / 5 / 6 / 7 / 8 / 10** 六个值 —— 每加一个小控件就顺手挑一个数，
 * 同一屏里"行 6、行尾按钮 5、确认框按钮 7、确认框卡片 10"谁也说不清为什么不一样。
 *
 * 这里锁三件事：
 *   1. 样式里**只允许** `var(--radius-sm|md|pill)` 和 `50%`（正圆：色点、开关圆钮，
 *      那是尺寸决定的，不进阶梯）、`0`。再出现 5 / 6 / 7 / 10 就是回退。
 *   2. **`inherit` 放行**，但它不是"第四档"：那是 `.cur::after`（键盘光标那圈淡晕）
 *      在说"我跟主人同一个形状"—— 不写死数值，主人是胶囊它就是胶囊、是正圆它就是正圆。
 *      写死一个数反而会变成"药丸外头套个方框"。
 *   3. 旧的 `--radius-row`（6px 那档）**不能复活** —— 它已经从 base.css 删掉了，
 *      样式里但凡还留着一处引用，那个元素的圆角会静默变成 0（方角），不报错、不显眼。
 */
test('★ 圆角只有三档（4 / 8 / 999）：不该再有 5 / 6 / 7 / 10', () => {
  const literals = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim())
  assert.ok(literals.length > 5, '一条圆角都没抽到 —— 正则或样式表结构变了')
  const stray = literals.filter((v) => !/^(var\(--radius-(sm|md|pill)\)|50%|0|inherit)$/.test(v))
  assert.deepEqual(stray, [], `出现了三档之外的圆角：${stray.join(' / ')}`)
  assert.ok(!css.includes('--radius-row'), '还引用着已删掉的 --radius-row（那处会静默变方角）')
})

test('★ base.css 的三档圆角变量齐全，且 --radius-row 没有复活', () => {
  const base = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')
  for (const name of ['--radius-sm', '--radius-md', '--radius-pill']) {
    assert.match(base, new RegExp(`${name}:`), `base.css 里没有 ${name}`)
  }
  assert.ok(
    !base.includes('--radius-row'),
    '--radius-row 又回来了 —— 圆角已经并成三档，别开第四档'
  )
})

/*
 * ★ 行本身的 120ms 过渡（09-17 老大提的"低幅度缓动是高级感最便宜的一招"）。
 *
 * 核实过的现状：`.act` / 药丸 / `.clr` / 开关 / `.tag` / `.num` / 淡入底栏**本来就有** .12~.16s，
 * 真正还是硬切的恰好是**最高频的那一处** —— 行的 hover 与三档选中态
 * （鼠标扫过一屏几十行、按 ↑↓ 一行行挪，全在改 background / box-shadow / color）。
 *
 * 锁三样：transition 在、三个属性都盖到、时长是 120ms（别调大 —— 低幅度缓动拖长了就变"粘"）。
 */
test('★ .row 有 120ms 过渡（background / box-shadow / color 三样都要盖到）', () => {
  // 行首锚定：不然会抽到 `.row.tall` / `.row:hover` 之类（它们不以 `.row {` 结尾，但也别冒险）
  const rule = css.match(/^\.row\s*\{[^}]*\}/m)
  assert.ok(rule, 'App.vue 里找不到 .row 规则')
  const t = rule[0].match(/transition:\s*([^;}]+)/)
  assert.ok(t, '.row 上没有 transition —— 悬停 / 选中又变回硬切了')
  for (const prop of ['background', 'box-shadow', 'color']) {
    assert.match(t[1], new RegExp(prop), `.row 的过渡没盖到 ${prop}`)
  }
  assert.match(t[1], /0\.12s/, '.row 的时长不是 120ms')
})

/*
 * ★ 次文本灰拆成两档（09-17，老大提的）：**标签 38 / 内容 52**（深色 48 / 64）。
 *
 * 拆的理由：原来一个 42% 同时管「组标签」和「次要内容」——
 * 设置面板的组名（底色 / 强调色）跟行尾图标、键帽一样重，层级是平的。
 *
 * 锁三件事：
 *   1. 两套值都在，且**深浅不是同一组百分比**（深色底上要用更高的不透明度才看得见，
 *      照搬浅色的 38/52 会让深色的标签比改之前还淡 —— 这是这条建议里唯一的坑）；
 *   2. 面板的标签（`.lbl` / `.opt .nm`）走 `--tx-label`；
 *   3. 行内的零件（`.act` 等）**仍然走 `--tx-2`** —— 它们是"内容"，别被顺手归进标签档
 *      （归错了就是行尾按钮跟着一起变淡，鼠标唯一的入口更看不见了）。
 */
test('★ 灰阶两档：标签 38 / 内容 52（深色各是 48 / 64），深浅不许共用一组数', () => {
  const base = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')
  assert.match(base, /--tx-2:\s*rgba\(0, 0, 0, 0\.52\)/, '浅色的内容档不是 52%')
  assert.match(base, /--tx-label:\s*rgba\(0, 0, 0, 0\.38\)/, '浅色的标签档不是 38%')
  assert.match(base, /--tx-2:\s*rgba\(255, 255, 255, 0\.64\)/, '深色的内容档不是 64%')
  assert.match(base, /--tx-label:\s*rgba\(255, 255, 255, 0\.48\)/, '深色的标签档不是 48%')
})

test('★ 面板标签走 --tx-label，行里零件的 --tx-2 不许被一起改掉', () => {
  const lbl = css.match(/^\.lbl\s*\{[^}]*\}/m)
  assert.ok(lbl, '找不到 .lbl')
  assert.match(lbl[0], /color:\s*var\(--tx-label\)/, '组标签没走标签档')

  const nm = css.match(/^\.opt \.nm\s*\{[^}]*\}/m)
  assert.ok(nm, '找不到 .opt .nm')
  assert.match(nm[0], /color:\s*var\(--tx-label\)/, '开关行的名字没走标签档')

  // ⚠️ 行首锚定是必需的：`.root.mark-solid .row.on .act { … }` 那条复合选择器
  // 也以 `.act {` 结尾，不锚 `^` 就会抽到它（它写的是反白色，不可能是 --tx-2）。
  const act = css.match(/^\.act\s*\{[^}]*\}/m)
  assert.ok(act, '找不到 .act')
  assert.match(
    act[0],
    /color:\s*var\(--tx-2\)/,
    '行尾 ☆ / 🗑 是"内容"，不该跟着标签一起退后（它是鼠标唯一的入口）'
  )
})

/*
 * ★ 行尾按钮：**鼠标划过 与「这行是当前行」表现必须完全一致**（09-17 晚老大真机报的）。
 *
 * 中间有一版只跟 `:hover` 走，理由是"键盘流里点不到按钮，却把类型标签盖掉了"。
 * 真机一看是错的：同一行在两套输入下长得不一样，键盘选中的行右端空着一格，
 * 看着像坏了 —— 老大原话「真实选中行却没有显示出来，这是bug」。
 *
 * 锁两件事（少一样就退回"选中行不出按钮"）：
 *   1. 选中行要把按钮放出来，且跟 hover 走**同一条规则**（分叉过，别再分）；
 *   2. 选中行的类型标签 / 序号要同步淡出 —— ⚠️ 这一格是 absolute 叠着的，
 *      不让位就会跟按钮**叠字**。淡出那条还必须带 `.tail-acts`：
 *      按钮一关，标签会在划过 / 选中时凭空消失、底下没东西顶上来。
 */
test('★ 行尾按钮：选中行跟 hover 一样出按钮，标签同步让位', () => {
  const show = css.match(/\.row:hover \.acts,\s*\.row\.on \.acts\s*\{([^}]*)\}/)
  assert.ok(show, '.row.on .acts 没了 —— 键盘选中的行又不显示按钮了')
  assert.match(show[1], /opacity:\s*1/, '选中行没有把按钮放出来')

  /*
   * 让位那一组：`.tag` / `.num` / `.src` 三样都得在。
   *
   * ⚠️ **别按固定顺序拼成一整条正则** —— 每给行尾加一样内容（09-18 加了「来源」）都会先红一次，
   *    而红的原因跟"让位到底有没有生效"半点关系没有，纯属噪声。
   *    这里改成"把这一组整个取出来、再逐样查在不在"：加东西不红，**删东西照样红**。
   */
  const fade = css.match(/(\.row:hover \.tail-acts \.tag[\s\S]*?)\{([^}]*)\}/)
  assert.ok(fade, '让位那一组没了 —— 会跟两枚按钮叠在同一格上')
  for (const cls of ['tag', 'num', 'src']) {
    assert.ok(
      fade[1].includes(`.tail-acts .${cls}`),
      `行尾的 .${cls} 不在让位那一组里 —— 鼠标划过 / 选中时会跟两枚按钮叠字`
    )
  }
  assert.match(fade[1], /\.row\.on \.tail-acts \.tag/, '让位只跟 hover 走 —— 键盘选中的行会叠字')
  assert.match(fade[2], /opacity:\s*0/, '让位那条不是 opacity: 0')
})

/*
 * ★ 「底色」档多了一根左竖条（09-17 晚方案 B：**并进底色档，不新开档位**）。
 *
 * 渊源别记反：09-14 做过又撤过（老大真机原话「为什么选中中会有个竖线，我感觉不好看」），
 * 09-17 他拿参考图重新提。定的做法是"并进「底色」档"——单为"一根线"多开一档，
 * 等于把同一个选择拆成两个，让人多纠结一次。
 *
 * 锁四件事：
 *   1. 竖条挂在 `.root.mark-tint` 下（**只有这一档有房顶**）；
 *   2. 写法是**常驻 + 切 opacity**，不是直接写 `.on::before` ——
 *      后者会让竖条凭空出现，跟行底色那 120ms 的淡入脱拍；
 *   3. 时长跟 `.row` 一样是 0.12s（两处别各走各的）；
 *   4. `.row` 上留着 `position: relative` —— 删了竖条会跑到面板最左边。
 */
test('★ 底色档的左竖条：只有 tint 档有、靠 opacity 跟着 120ms 走', () => {
  const bar = css.match(/\.root\.mark-tint \.row::before\s*\{([^}]*)\}/)
  assert.ok(bar, '底色档的左竖条没了')
  assert.match(bar[1], /position:\s*absolute/, '竖条不是绝对定位 —— 会占掉文字的位置')
  assert.match(bar[1], /opacity:\s*0/, '竖条不是"常驻 + 切 opacity"的写法（切换时会闪）')
  assert.match(bar[1], /0\.12s/, '竖条的时长跟 .row 的 120ms 不一致')

  const on = css.match(/\.root\.mark-tint \.row\.on::before\s*\{([^}]*)\}/)
  assert.ok(on, '选中行没有把竖条点亮')
  assert.match(on[1], /opacity:\s*1/, '选中行的竖条不是 opacity: 1')

  // 只有 tint 档有竖条：另两档本来就有装饰（描框 / 铺满），再加一根就是三层
  assert.doesNotMatch(css, /\.root\.mark-(border|solid) \.row::before/, '竖条漂到别的档位上了')

  // 定位基准
  const row = css.match(/^\.row\s*\{[^}]*\}/m)
  assert.ok(row, '找不到 .row 规则')
  assert.match(
    row[0],
    /position:\s*relative/,
    '.row 丢了 position: relative —— 竖条会跑到面板最左边去'
  )
})

/*
 * ★ 键盘光标 `.cur`（09-18 设置面板键盘化）：**必须跟「选中」`.on` 是两套画法**。
 *
 * 两者会同时出现 —— 打开面板时光标就落在第一行的当前值上，所以"光标停在一个已选中
 * 的控件上"是常态。要是 `.cur` 也用强调色，界面上就出现两个同样的强调色标记，
 * 分不出哪个是"光标"、哪个是"选中值"。
 *
 * 锁六件事：
 *   1. `.cur` 的**主线**取的是**中性灰 `--cur-line`**，不是 `--accent`；
 *   2. **主线**走 `outline` 通道，不是 box-shadow —— `.on` 那几条光晕（药丸 / 色点 /
 *      「默认」）本来就全写在 box-shadow 里，写在**同一个盒子**上就得跟每一条各拼一次，
 *      拼漏一处就是"选中时看不见光标"；
 *   3. 外面那圈**淡晕**（v3，老大从四个方案里挑的"A"）挂在 `::after` 上 —— 伪元素是
 *      **另一个盒子**，它的 box-shadow 跟元素的互不干扰，这才是"要两层又不撞通道"的写法；
 *   4. 开关行靠自己的 `border-radius` 让环变弯，**不许**给 `.opt` 单开一条光标规则；
 *   5. 色点那条把 `outline-offset` 让大一点，别跟 `.dot.on` 那圈灰光晕叠在一起，
 *      **而且色点要把晕掐掉**（14px 点 + 12px 间距，算术上塞不下）；
 *   6. 模板里真接上了（`isCur(...)`）—— 样式写了但没挂上去，等于没做。
 *      ⚠️ 行名对不对由 `tests/panel.test.ts` 管，这里只管"有没有挂"。
 */
test('★ 键盘光标 .cur：中性两层环（主线 outline + 伪元素淡晕），跟「选中」.on 分得开', () => {
  const cur = css.match(/^\.cur\s*\{([^}]*)\}/m)
  assert.ok(cur, '找不到 .cur 规则 —— 面板的键盘光标没了')
  assert.match(
    cur[1],
    /outline:\s*[\d.]+px\s+solid\s+var\(--cur-line\)/,
    '.cur 的主线不再是中性灰 --cur-line'
  )
  assert.doesNotMatch(cur[1], /--accent/, '.cur 用了强调色 —— 会跟「选中」撞成同一个意思')
  assert.doesNotMatch(
    cur[1],
    /box-shadow/,
    '.cur 的 box-shadow 会被 .on 的光晕盖掉 —— 主线只能走 outline'
  )
  assert.match(cur[1], /outline-offset/, '.cur 没有 outline-offset —— 环会贴着药丸边')
  assert.match(
    cur[1],
    /position:\s*relative/,
    '.cur 没有 position: relative —— 那层晕（::after）没有定位父级，会飞到别处'
  )

  // 淡晕：走伪元素（另一个盒子），不跟 .on 抢通道
  const halo = css.match(/^\.cur::after\s*\{([^}]*)\}/m)
  assert.ok(halo, '找不到 .cur::after —— 那圈淡晕没了')
  assert.match(
    halo[1],
    /outline:\s*[\d.]+px\s+solid\s+var\(--cur-halo\)/,
    '.cur::after 没用 --cur-halo 画那圈晕'
  )
  assert.match(halo[1], /outline-offset/, '.cur::after 没有 outline-offset —— 晕会压在主线底下')
  assert.match(
    halo[1],
    /border-radius:\s*inherit/,
    '.cur::after 没继承圆角 —— 晕会变成另一个形状（药丸外头套个方框）'
  )
  assert.match(halo[1], /pointer-events:\s*none/, '.cur::after 会挡住鼠标')
  assert.doesNotMatch(halo[1], /--accent/, '那圈晕用了强调色 —— 跟「选中」撞成同一个意思')

  /*
   * ★ 下面两条是**真机返工换来的**（老大：「描边和晕为什么没有贴一起，中间有白色底。
   *   是描边的圆角和晕的圆角不一样吗？」—— 是的）。
   *
   * 病根：`inset: -4px` 把盒子往外推了 4px，而 `border-radius: inherit` 拿到的是元素自己的
   * **8px**，那一圈正确的半径是 **12px** ⇒ 半径偏小 ⇒ 角的弧"少切一块" ⇒ 晕在**四个角上**
   * 鼓到主线外面，中间露出一道背景色。（指纹：直边 0 缝，角上约 2px 缝。）
   *
   * 修法：盒子**跟元素完全重合**（`inset: 0`），圆角于是天然正确；往外推的活交给
   * `outline-offset`（它沿圆角往外扩，半径自己 +offset）。所以这两条必须**一起**锁死 ——
   * 谁把 inset 改回负数，这个 bug 立刻回来。
   */
  assert.match(
    halo[1],
    /inset:\s*0\s*;/,
    '.cur::after 的盒子没跟元素重合（inset 必须 0）—— 一旦外推，border-radius: inherit 就错了，四个角会露背景色'
  )
  assert.doesNotMatch(
    halo[1],
    /box-shadow/,
    '.cur::after 又用回 box-shadow —— 那是"另一个盒子"，半径得自己算，就是四个角露缝那个坑'
  )

  /*
   * ★ 开关行的光标 = **同一圈环，只是把方角改成圆角**（09-18 晚 v2）。
   *   老大原话：「我只是觉得之前的方形不好看，你把四角变成弧形就可以了。
   *   就套环，只是别用长方形。」⇒ 他要的是**统一**：光标全站只有"一圈环"这一种说法，
   *   所以**不许**给 `.opt` 单开一条 `.opt.cur`（中间那版"改铺淡底"的写法已被否决）。
   *   环要变圆，靠的是 `.opt` 自己有个 `border-radius` —— `outline` 会跟着它弯。
   */
  const opt = css.match(/\.opt\s*\{([^}]*)\}/)
  assert.ok(opt, '找不到 .opt 规则')
  /*
   * ★ 这个圆角**只用来塑形那圈环**（`.opt` 自己没有背景色，值页面上看不见）。
   *   必须取 `--radius-sm`(4)，环的外轮廓才 = **8px**，跟列表项 `.row.on` 的描框对齐。
   *
   *   算式：环的外轮廓 = 元素圆角 + `outline-offset` 2 + 线宽 2 = 圆角 + 4 ⇒ 圆角必须 4。
   *   （列表项那边是 8px 圆角 + `inset 1.5px` 贴边，外轮廓就是 8px。）
   *
   *   ⚠️ 改回 `--radius-md`(8) 的话，环的外轮廓会变成 12px —— 比列表项圆一整圈。
   *      老大 09-18 真机同一处第三次返工就是这一条：
   *      「你设置里面这个环的角弧度，有没有参考列表项的描框的角的弧度？」
   */
  assert.match(
    opt[1],
    /border-radius:\s*var\(--radius-sm\)/,
    '.opt 的圆角不是 --radius-sm —— 环的外轮廓会变成 圆角+4，比列表项描框（8px）圆一整圈'
  )
  assert.doesNotMatch(
    css,
    /\.opt\.cur\s*\{/,
    '开关行又给光标单开了一条规则 —— 光标全站只该有一圈环（见 `.cur` 那段注释）'
  )

  // 色点：主线要往外让，别跟 .dot.on 那圈灰光晕叠一起
  const dot = css.match(/\.root \.sheet \.dot\.cur\s*\{([^}]*)\}/)
  assert.ok(dot, '色点的 .cur 偏移没了 —— 环会压在那圈灰光晕上')
  const offset = Number(cur[1].match(/outline-offset:\s*([\d.]+)px/)?.[1])
  const pushed = Number(dot[1].match(/outline-offset:\s*([\d.]+)px/)?.[1])
  assert.ok(
    pushed > offset,
    `色点的 outline-offset(${pushed}px) 没有比通例(${offset}px)更大 —— 会跟光晕叠在一起`
  )
  /*
   * ⚠️ 色点**只有线、没有晕**：14px 的点只隔 12px，而且外面本来就挂着"选中环"
   *    （实心档到 5px）—— 再叠 3px 的晕就是 7 + 3.5 > 12，算术上顶到隔壁那颗去了。
   */
  const dotHalo = css.match(/\.root \.sheet \.dot\.cur::after\s*\{([^}]*)\}/)
  assert.ok(dotHalo, '色点的 ::after 没写 —— 那圈晕会顶到隔壁色点上')
  assert.match(dotHalo[1], /content:\s*none/, '色点的 ::after 没被 content: none 关掉')

  // 模板接线：面板里真的挂了 isCur
  assert.match(template, /:\s*class="\{[^"]*cur:\s*isCur\(/, '模板里没有一处挂上 .cur —— 光标画不出来')
})

/*
 * ★ 键盘光标那两个变量（09-18 v3，base.css）：**深浅两块都得有**。
 *
 * `.cur` 取的是 `var(--cur-line)` / `var(--cur-halo)`，而 `var()` 取不到值**不报错** ——
 * outline-color 会退成 `currentColor`（跟文字一个色，环糊进字里），那圈晕直接整条消失。
 * 深色主题漏写更阴：它会**继承浅色那块的值**（42% 黑），在深底上基本看不见。
 * ⇒ 跟 `--radius-*` / `--accent-rgb` 一样，把"齐全"钉住。
 */
test('★ base.css 的 --cur-line / --cur-halo：浅色与深色两块都齐全', () => {
  const base = readFileSync(fileURLToPath(new URL('../src/styles/base.css', import.meta.url)), 'utf8')
  const dark = base.match(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/)
  assert.ok(dark, "base.css 里找不到 :root[data-theme='dark'] 块 —— 正则或结构变了")
  for (const name of ['--cur-line', '--cur-halo']) {
    assert.match(base, new RegExp(`${name}:`), `base.css 里没有 ${name} 的兜底`)
    assert.match(
      dark[1],
      new RegExp(`${name}:`),
      `深色块里没有 ${name} —— 会继承浅色那版，深底上看不见`
    )
  }
})

/*
 * ★ 面板里「选中」那颗的效果**跟随 `mark` 三档**（老大 09-18 真机提的）。
 *
 * 跟 `.row.on` / 底栏 `.clr:hover` 是同一套语汇：描框（inset 一圈）/ 淡底（accent-soft）/
 * 实心（铺满 + 反白）。来由是"同一屏里只能有一句话" ——
 * 行是描框、面板里却铺着淡底，等于调了「选中项」只统一了一半。
 *
 * 锁五件事：
 *   1. 兜底那条还是淡底（`mark` 还没读出来的那一瞬不能没样子）；
 *   2. 描框档**既不铺色**（`background: none`，不然描框 + 淡底叠成两层）又套 inset 强调色边；
 *   3. 实心档铺 `--accent`、字取 `--row-on-tx`（跟行反白同源）；
 *   4. 旧的那圈 **3px 同色光晕已经删干净** —— 留着会让描框档看着像两层环；
 *   5. 色点那两条必须带 `:not(.auto)` —— 「默认」那颗混着 `.dot` 类，误伤它就变成一颗圆环。
 */
test('★ 面板「选中」的效果跟随 mark 三档（跟行 / 底栏同一套语汇）', () => {
  const base = css.match(/\.chip\.on,\s*\.dot\.auto\.on\s*\{([^}]*)\}/)
  assert.ok(base, '找不到 `.chip.on, .dot.auto.on` 兜底那条 —— 面板的选中效果没了')
  assert.match(base[1], /background:\s*var\(--accent-soft\)/, '兜底那条不再是淡底')

  const border = css.match(
    /\.root\.mark-border \.chip\.on,\s*\.root\.mark-border \.dot\.auto\.on\s*\{([^}]*)\}/
  )
  assert.ok(border, '描框档没有规则 —— 面板里的选中还停在淡底')
  assert.match(border[1], /background:\s*none/, '描框档还在铺色 —— 描框 + 淡底会叠成两层')
  assert.match(border[1], /inset 0 0 0 1\.5px var\(--accent\)/, '描框档没有那圈 inset 强调色边')

  const solid = css.match(
    /\.root\.mark-solid \.chip\.on,\s*\.root\.mark-solid \.dot\.auto\.on\s*\{([^}]*)\}/
  )
  assert.ok(solid, '实心档没有规则 —— 面板里的选中没跟着走')
  assert.match(solid[1], /background:\s*var\(--accent\)/, '实心档没有铺满强调色')
  assert.match(solid[1], /color:\s*var\(--row-on-tx\)/, '实心档没有反白')

  // 旧光晕必须彻底消失
  assert.doesNotMatch(
    css,
    /box-shadow:\s*0 0 0 3px var\(--accent-soft\)/,
    '旧的 3px 同色光晕还在 —— 描框档会看成两层环'
  )

  // 色点：三档靠"环"的粗细 / 颜色表达，且都得排掉 `.auto`
  assert.match(
    css,
    /\.root\.mark-border \.dot:not\(\.auto\)\.on\s*\{[^}]*var\(--accent\)/,
    '描框档的色点环没换成强调色'
  )
  assert.match(
    css,
    /\.root\.mark-solid \.dot:not\(\.auto\)\.on\s*\{[^}]*var\(--accent\)/,
    '实心档的色点环没换成强调色'
  )
  assert.match(css, /\.dot\.on\s*\{[^}]*127, 127, 127/, '淡底档那条中性灰环丢了 —— 它是这一档的兜底')
})

/*
 * ★ 搜索命中的高亮（09-18）。
 *
 * 两条必须同时成立的红线：
 *   ① **不许 `v-html`** —— 剪贴板内容是任意来的，从网页复制的东西本身就是一段 HTML，
 *      塞进去就是把它渲染出来。渲染走 `row.seg` 片段数组（`v-for` + `:class="{ hl: s.hit }"`）。
 *   ② **实心档必须单独一条** —— 那一档整行铺的就是强调色，命中再铺一层强调色等于没标。
 *
 * 另外高亮底必须走 `--accent-rgb` 变量取色：强调色可能是宿主注入的，
 * 硬写一个色号会在用户换主题色时脱钩。
 */
test('★ 命中高亮：片段渲染（零 v-html）、靠变量取色、实心档单独定义', () => {
  // 注释里会提到 v-html（"别用它"），所以先把 HTML 注释剥掉再查
  const bare = template.replace(/<!--[\s\S]*?-->/g, '')
  assert.doesNotMatch(bare, /\bv-html\b/, '模板里出现了 v-html —— 剪贴板内容不可信，等于注入面')

  assert.match(template, /v-for="\(s, k\) in row\.seg"/, '模板没按片段渲染 —— 高亮一个字都画不出来')
  assert.match(template, /class="\{ hl: s\.hit \}"/, '片段没接上 .hl')

  assert.match(css, /^\.t \.hl\s*\{/m, '找不到命中高亮的底（.t .hl）')
  assert.match(css, /rgba\(var\(--accent-rgb\)/, '高亮底没走 --accent-rgb —— 宿主换主题色时会脱钩')
  assert.match(
    css,
    /\.root\.mark-solid \.row\.on \.hl\s*\{[^}]*--on-accent-rgb/,
    '实心档没单独定义 .hl —— 那一档整行就是强调色，高亮会整个消失'
  )
})

/*
 * ★ `--accent-rgb`（强调色**自身**的 rgb）三处缺一不可：
 *   `base.css` 的兜底、`accent.ts` 算出来、`theme.ts` 写进 CSS 变量。
 *
 * 少了任意一处都**不报错** —— `rgba(var(--accent-rgb), .26)` 整条失效（值解析不出来），
 * 表现只是"高亮看起来没生效"，查起来很费劲。所以机械扫一遍。
 */
test('★ --accent-rgb：base.css / accent.ts / theme.ts 三处齐全', () => {
  const read = (p: string): string =>
    readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), 'utf8')

  assert.match(
    read('styles/base.css'),
    /--accent-rgb:\s*\d+,\s*\d+,\s*\d+/,
    'base.css 没有 --accent-rgb 兜底'
  )
  assert.match(read('lib/accent.ts'), /accentRgb:/, 'accent.ts 没把强调色的 rgb 算出来')
  assert.match(
    read('lib/theme.ts'),
    /setProperty\('--accent-rgb'/,
    'theme.ts 没把 --accent-rgb 写进 CSS 变量 —— 非默认强调色下高亮会整条失效'
  )
})

/*
 * ★ 行尾「来源」（09-18）：`tailSource` 打开时行里多显示一格应用名。
 *
 * 它跟 `.num` 是同一档（淡淡的纯文字），所以两件事都得跟 `.num` 完全一致：
 *   ① 按钮浮现时**一起让位**（它们和两枚按钮 absolute 叠在同一格里）；
 *   ② 实心档**一起反白**（`--tx-3` 的灰字铺在强调色上就是一团看不见的灰）。
 * 少任何一条，都只在"特定档位 + 特定鼠标位置"下才看得见，很难发现。
 */
test('★ 行尾来源 .src：跟 .num 同一档，一起反白、一起让位', () => {
  assert.match(css, /^\.src\s*\{/m, '找不到 .src 规则')

  assert.match(
    css,
    /\.root\.mark-solid \.row\.on \.num,\s*\.root\.mark-solid \.row\.on \.src\s*\{/,
    '.src 没跟 .num 一起反白 —— 实心档上会变成看不见的灰字'
  )
  // 让位那一组由上面「行尾按钮」那条逐样验（tag / num / src），这里只查模板接线
  assert.match(template, /settings\.tailSource && row\.source/, '模板没接 tailSource 开关')
  assert.match(template, /class="src"/, '模板里没挂 .src')
})

