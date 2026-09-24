/*
 * 设置面板的键盘光标（`lib/panel.ts`）。
 *
 * 这个功能有一条**"错了会静默改掉用户设置"**的红线：打开面板时光标只能落在
 * **当前值**上，而且只能给位置、不许落值 —— 否则按一下 ⌘/ 就把底色 / 强调色
 * 刷成「默认」，用户什么都没按。这条单独锁在最前面。
 *
 * 剩下的是三种控件两套规矩：单选行「移到哪颗就是选中哪颗」、多选行（行尾操作 / 行尾显示）
 * 「只挪光标、Enter 才切」、开关行「左关右开」。
 *
 * 末尾几条是**接线断言**（读 App.vue 源码）：纯函数对了不等于界面上真接通了 ——
 * `keys.test.ts` 里那些源码断言是同一个路子。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { ACCENT_KEYS } from '../src/lib/accent.ts'
import {
  PANEL_ROWS,
  cursorOf,
  movePatch,
  moveRow,
  moveSlot,
  rowIndex,
  slotsOf,
  toggleAt,
  toggleMember,
  type Cursor
} from '../src/lib/panel.ts'
import {
  FOOT_BUTTONS,
  FOOT_HINTS,
  FOOT_MODES,
  MARK_MODES,
  type Settings
} from '../src/lib/settings.ts'
import { BG_KEYS, BG_PRESETS } from '../src/lib/surface.ts'

/** 一份设置（只写关心的那几项，其余取默认值 —— 跟 settings.ts 的默认保持一致） */
function set(partial: Partial<Settings> = {}): Settings {
  return {
    peek: false,
    accent: 'auto',
    mark: 'border',
    bg: 'auto',
    foot: 'always',
    footHints: [...FOOT_HINTS],
    footButtons: [...FOOT_BUTTONS],
    confirmDelete: true,
    tailType: true,
    tailIndex: false,
    tailSource: false,
    tailFav: true,
    tailDel: true,
    tailEdit: true,
    ...partial
  }
}

const at = (row: number, slot = 0): Cursor => ({ row, slot })
const id = (name: string): number => rowIndex(name)

/* ---------------------------------------------------------------- 行表 */

test('行表 10 行，顺序 = 面板里的先后', () => {
  assert.deepEqual(
    PANEL_ROWS.map((r) => r.id),
    [
      'bg',
      'accent',
      'tailActs',
      'tail',
      'mark',
      'foot',
      'footButtons',
      'footHints',
      'peek',
      'confirmDelete'
    ]
  )
})

/*
 * 位置数必须跟界面上控件数一致 —— 对不上就是"光标能停在不存在的一格上"。
 * ⚠️ 底色那份 `BG_KEYS` **本身含 `'auto'`**，强调色那份 `ACCENT_KEYS` **不含**
 * （界面上那颗「默认」得自己补），两处不一样，这条断言顺带把这件事钉住。
 */
test('每行的位置数：底色 6 / 强调色 13 / 行尾操作 3 / 行尾显示 3 / 选中项 3 / 底栏 3 / 底栏按钮 3 / 提示 10 / 开关各 1', () => {
  assert.equal(slotsOf(PANEL_ROWS[id('bg')]), BG_KEYS.length)
  assert.equal(slotsOf(PANEL_ROWS[id('accent')]), ACCENT_KEYS.length + 1)
  assert.equal(PANEL_ROWS[id('accent')].values[0], 'auto', '强调色第一颗不是「默认」')
  assert.equal(slotsOf(PANEL_ROWS[id('tail')]), 3)
  /*
   * 行尾那三颗的**键名顺序 = 模板里 chip 的先后** —— 它俩一旦错位，
   * `←→` 挪到第 3 颗、按 Enter 切掉的却是第 2 颗那个开关（静默切错东西）。
   */
  assert.deepEqual(PANEL_ROWS[id('tail')].values, ['tailType', 'tailIndex', 'tailSource'])
  /*
   * 09-21「行尾按钮」拆成「行尾操作」两颗（收藏 / 删除），09-23 又加了第三颗「编辑」。
   * 同样是多选、同样钉顺序，而且**顺序要跟行尾那三颗从左到右的先后一致**
   * （编辑 / 收藏 / 删除，模板里就是这么渲染的）。
   * ⚠️ 这一行**排在三颗的「行尾显示」前面**：面板按段内**短→长**排。
   *    它现在也是 3 颗了 ⇒ 跟「行尾显示」「选中项」一样长，谁前谁后都不违背判据
   *    ⇒ **保持原位**，别为凑一个严格递增去调顺序。
   */
  assert.equal(slotsOf(PANEL_ROWS[id('tailActs')]), 3)
  assert.deepEqual(PANEL_ROWS[id('tailActs')].values, ['tailEdit', 'tailFav', 'tailDel'])
  assert.ok(
    id('tailActs') < id('tail'),
    '「行尾操作」跑到「行尾显示」后面去了 —— 段内要从短到长'
  )
  assert.equal(slotsOf(PANEL_ROWS[id('mark')]), MARK_MODES.length)
  // 底栏形态从四档收成三档（09-24：'lean' 退休，它的意思现在由 footHints 表达）
  assert.equal(slotsOf(PANEL_ROWS[id('foot')]), FOOT_MODES.length)
  assert.deepEqual(PANEL_ROWS[id('foot')].values, ['always', 'fade', 'none'])
  /*
   * ★ 09-24 那两行是 `list`（**一个数组设置**），不是 `multi`（N 个布尔键）——
   *   认错了会在 `toggleAt` 里把数组当成布尔取反，一按 Enter 底栏整排提示就没了。
   *   顺序同样必须 = 模板里药丸的先后 = 底栏里从左到右的先后。
   */
  assert.equal(PANEL_ROWS[id('footButtons')].kind, 'list')
  assert.deepEqual(PANEL_ROWS[id('footButtons')].values, [...FOOT_BUTTONS])
  assert.equal(PANEL_ROWS[id('footHints')].kind, 'list')
  assert.deepEqual(PANEL_ROWS[id('footHints')].values, [...FOOT_HINTS])
  // 段内短→长：15 颗那行必须排在 3 颗那行**后面**（反过来就是 15 → 3 的下降）
  assert.ok(
    id('footButtons') < id('footHints'),
    '「底栏按键提示」跑到「底栏按钮」前面去了 —— 15 颗在 3 颗上面，段内就不是短→长了'
  )
  for (const name of ['peek', 'confirmDelete']) {
    assert.equal(slotsOf(PANEL_ROWS[id(name)]), 1, `${name} 的位置数不是 1`)
  }
  // 开关只剩两行了 —— 09-23 那行「新增按钮」09-24 并进了「底栏按钮」那颗药丸
  assert.equal(PANEL_ROWS.filter((r) => r.kind === 'switch').length, 2)
})

test('行名 → 行号，写错的行名回 -1（模板写错时测试会当场红）', () => {
  assert.equal(id('bg'), 0)
  assert.equal(id('confirmDelete'), PANEL_ROWS.length - 1)
  assert.equal(id('没有这一行'), -1)
})

/* ---------------------------------------------------------------- 打开面板 */

/*
 * ★★ 这一条是整个功能的红线。
 *
 * 打开面板时光标必须落在**第一行的当前值**上，而且 `cursorOf` 只能吐出「位置」，
 * 不能顺带带出"要落的设置值" —— 否则按一下 ⌘/ 就把用户的底色 / 强调色冲成「默认」。
 */
test('★★ 打开面板：光标落在第一行的当前值上，只给位置、不落值', () => {
  assert.deepEqual(cursorOf(set()), at(0, 0))
  assert.deepEqual(cursorOf(set({ bg: 'strong' })), at(0, BG_KEYS.indexOf('strong')))

  const keys = Object.keys(cursorOf(set({ bg: 'warm' })) as unknown as Record<string, unknown>)
  assert.deepEqual(keys.sort(), ['row', 'slot'], 'cursorOf 只能给位置 —— 出现别的字段就是它开始落值了')

  // 值读不出来 / 不认识 → 回第一颗，不炸
  assert.deepEqual(cursorOf(set({ bg: undefined as never })), at(0, 0))
})

/* ---------------------------------------------------------------- ↑↓ 换行 */

test('↑↓ 换行：落点重算成那一行的当前值，不沿用上一个列号', () => {
  const s = set({ accent: 'teal' })
  assert.equal(moveRow(at(0, 5), 1, s).row, 1)
  assert.equal(
    moveRow(at(0, 5), 1, s).slot,
    PANEL_ROWS[id('accent')].values.indexOf('teal'),
    '换行后没落到新那一行的当前值上'
  )
  // 多选行没有"当前值"可言 → 落第一颗（行尾操作 / 行尾显示 / 底栏那两行都是这样）
  for (const name of ['tailActs', 'tail', 'footButtons', 'footHints']) {
    assert.equal(moveRow(at(id(name) - 1), 1, set()).slot, 0, `${name} 换行后没落到第一颗`)
  }
})

test('↑↓ 换行：行与行之间也不绕圈（第一行再往上、最后一行再往下都停住）', () => {
  assert.equal(moveRow(at(0), -1, set()).row, 0)
  assert.equal(moveRow(at(PANEL_ROWS.length - 1), 1, set()).row, PANEL_ROWS.length - 1)
})

/* ---------------------------------------------------------------- ←→ 行内 */

test('←→ 行内移动：到两端停住，不绕圈', () => {
  const last = slotsOf(PANEL_ROWS[0]) - 1
  assert.deepEqual(moveSlot(at(0, 0), -1), at(0, 0))
  assert.deepEqual(moveSlot(at(0, last), 1), at(0, last))
  assert.deepEqual(moveSlot(at(0, 1), 1), at(0, 2))
})

test('←→ 落值：单选行移到哪一颗就是选中哪一颗；到边了不落值（别白写一次库）', () => {
  const bg = PANEL_ROWS[id('bg')]
  assert.deepEqual(movePatch(at(0, 0), 1), { bg: bg.values[1] })
  assert.equal(movePatch(at(0, bg.values.length - 1), 1), null, '在最后一颗按 → 不该再落值')
  assert.equal(movePatch(at(0, 0), -1), null, '在第一颗按 ← 不该再落值')
})

test('←→ 落值：开关是「左关右开」', () => {
  const row = id('peek')
  assert.deepEqual(movePatch(at(row), 1), { peek: true })
  assert.deepEqual(movePatch(at(row), -1), { peek: false })
})

/*
 * ★ 多选行（行尾操作 / 行尾显示 / 底栏那两行）—— `←→` 只挪光标。
 * 要是让它"移到哪颗点亮哪颗"，从「收藏」滑到「删除」就会顺手把「删除」也点亮。
 */
test('★ ←→ 在多选行不给 patch：只挪光标，Enter 才切', () => {
  for (const name of ['tailActs', 'tail', 'footButtons', 'footHints']) {
    const row = id(name)
    assert.equal(movePatch(at(row, 0), 1), null, `${name} 那一行按 → 落值了`)
    assert.equal(movePatch(at(row, 1), -1), null, `${name} 那一行按 ← 落值了`)
  }
})

/* ---------------------------------------------------------------- Enter */

test('Enter：单选行落在光标那一颗上（跟 ←→ 同义）', () => {
  assert.deepEqual(toggleAt(set(), at(id('mark'), 2)), { mark: MARK_MODES[2] })
  assert.deepEqual(toggleAt(set(), at(id('bg'), 1)), { bg: BG_KEYS[1] })
})

test('★ Enter：行尾切那一颗、别的颗不受影响；三颗全灭也是合法状态', () => {
  const row = id('tail')
  assert.deepEqual(toggleAt(set(), at(row, 0)), { tailType: false })
  assert.deepEqual(toggleAt(set(), at(row, 1)), { tailIndex: true })
  // 第 3 颗是 09-18 加进来的「来源」—— 它必须落在 tailSource 上，不是又切回前两颗
  assert.deepEqual(toggleAt(set(), at(row, 2)), { tailSource: true })
  // 几颗都开时，切其中一颗只改那一颗
  assert.deepEqual(toggleAt(set({ tailIndex: true, tailSource: true }), at(row, 0)), {
    tailType: false
  })
  // 都关着也能点亮
  assert.deepEqual(toggleAt(set({ tailType: false }), at(row, 0)), { tailType: true })
})

test('Enter：开关取反', () => {
  assert.deepEqual(toggleAt(set({ peek: false }), at(id('peek'))), { peek: true })
  assert.deepEqual(toggleAt(set({ peek: true }), at(id('peek'))), { peek: false })
})

/*
 * ★ 09-21：行尾操作拆成「收藏」「删除」两颗**独立**的药丸；09-23 又加了第三颗「编辑」。
 * 面板里的先后就是 `tailEdit` → `tailFav` → `tailDel`（= 行尾那三颗从左到右），
 * `Enter` 切的是光标那一颗，另外两颗不动。
 * 「三颗都关」是老大要的合法状态（鼠标没有操作入口，编辑/收藏/删除只剩 ⌘E / ⌘K / Delete）。
 */
test('★ Enter：行尾操作切那一颗、另外两颗不受影响', () => {
  const row = id('tailActs')
  // 默认三颗都开 ⇒ 第 0/1/2 颗分别对应 编辑 / 收藏 / 删除
  assert.deepEqual(toggleAt(set(), at(row, 0)), { tailEdit: false })
  assert.deepEqual(toggleAt(set(), at(row, 1)), { tailFav: false })
  assert.deepEqual(toggleAt(set(), at(row, 2)), { tailDel: false })
  // 只要收藏、不要编辑和删除这一档：点中间那颗仍然是"改收藏"，不会把邻居牵连进来
  assert.deepEqual(toggleAt(set({ tailEdit: false, tailDel: false }), at(row, 1)), {
    tailFav: false
  })
  // 三颗都关着也能重新点亮，而且是各点各的
  const off = { tailEdit: false, tailFav: false, tailDel: false }
  assert.deepEqual(toggleAt(set(off), at(row, 0)), { tailEdit: true })
  assert.deepEqual(toggleAt(set(off), at(row, 1)), { tailFav: true })
  assert.deepEqual(toggleAt(set(off), at(row, 2)), { tailDel: true })
})

/* ---------------------------------------------------------------- Enter（一个数组设置） */

/*
 * ★★ 09-24 新的一类行：`list` —— 整行对应**一个数组设置**（底栏按键提示 / 底栏按钮）。
 *
 * 跟 `multi`（几个独立布尔键）长得像、语义也像，但**改的东西完全不同**：
 *   · `multi` —— 每颗改一个布尔键（`tailFav` / `tailType`…）；
 *   · `list`  —— 每颗改的是**同一个数组里有没有这个成员**（`footHints` / `footButtons`）。
 * ⚠️ 这是最容易写错的一处：`Enter` 落下去的必须是**新数组**，不是布尔取反。
 *   写成 `!valueOf(...)` 的话数组会被取反成 `false`，底栏那整排在界面上直接消失。
 * ⚠️ 顺序：切完必须**按定义数组的顺序**存回去（`FOOT_HINTS` / `FOOT_BUTTONS`），
 *    不然底栏那排提示的先后会跟着"用户点它的先后"变。
 */
test('★ Enter：底栏提示 / 按钮是「数组里加一个 / 减一个」，不是布尔取反', () => {
  const hints = id('footHints')
  // 第一颗是 'select'、末一颗是 'backspace'（顺序由 FOOT_HINTS 定）
  assert.deepEqual(toggleAt(set({ footHints: [] }), at(hints, 0)), { footHints: ['select'] })
  assert.deepEqual(toggleAt(set({ footHints: ['select', 'del'] }), at(hints, 0)), {
    footHints: ['del']
  })
  // 加进来的时候**按定义顺序排**，不是追加到末尾
  assert.deepEqual(toggleAt(set({ footHints: ['del'] }), at(hints, 0)), {
    footHints: ['select', 'del']
  })
  /*
   * ★ 末位那颗也要能被 Enter 切到 —— 它排在最后，模板的 `v-for` 一变，
   *   越界/对不上是最容易漏的地方（漏了不报错，只是那颗永远点不亮）。
   *
   * ⚠️ 末位是**跟着 `FOOT_HINTS` 走的**：09-24 第一批时它还是 `esc`（所以这里当时写死了
   *    `['esc']`），第二批补了 4 条之后它变成 `backspace` —— 写死一个 id 就会在下次
   *    往数组尾巴上加东西时**悄悄失效**（断言还在绿，但它验的已经不是"末位"了）。
   *    ⇒ 一律取 `FOOT_HINTS[FOOT_HINTS.length - 1]`，让这条测试自己跟着定义走。
   */
  const lastHint = FOOT_HINTS[FOOT_HINTS.length - 1]
  assert.equal(lastHint, 'backspace', '末位那条变了 —— 这条断言的前提（末位是 backspace）得一起改')
  assert.deepEqual(toggleAt(set({ footHints: [] }), at(hints, FOOT_HINTS.length - 1)), {
    footHints: [lastHint]
  })
  // 越界的位置回 null（模板改了颗数而行表没跟上时，不该改掉任何东西）
  assert.equal(toggleAt(set(), at(hints, FOOT_HINTS.length)), null)

  const buttons = id('footButtons')
  assert.deepEqual(toggleAt(set({ footButtons: [...FOOT_BUTTONS] }), at(buttons, 0)), {
    footButtons: ['add', 'clear']
  })
  assert.deepEqual(toggleAt(set({ footButtons: [] }), at(buttons, 2)), { footButtons: ['clear'] })
})

test('toggleMember：在就删、不在就补，且永远按定义顺序（丢弃不认识的成员）', () => {
  assert.deepEqual(toggleMember([], 'fav', FOOT_HINTS), ['fav'])
  assert.deepEqual(toggleMember(['fav'], 'fav', FOOT_HINTS), [])
  // 补进去的位置按 order 决定，跟 list 原来的先后无关
  assert.deepEqual(toggleMember(['del', 'select'], 'fav', FOOT_HINTS), ['select', 'fav', 'del'])
  // 不在 order 里的成员会**被丢掉**（跟 normalizeSettings 同一套规矩：认不出的不留）
  assert.deepEqual(toggleMember(['fav', '乱写'], 'del', FOOT_HINTS), ['fav', 'del'])
  // 一份脏数组也能被收拾干净
  assert.deepEqual(toggleMember(['fav', 'fav', 'x'], 'select', FOOT_HINTS), ['select', 'fav'])
})

/* ---------------------------------------------------------------- 接线 */

const SFC = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')

test('★ 打开面板只落光标、不落值（openSettings 里不许出现 updateSettings）', () => {
  const fn = SFC.slice(SFC.indexOf('function openSettings('))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /cursorOf\(/, 'openSettings 没把光标落位 —— 面板里按方向键会没反应')
  assert.doesNotMatch(body, /updateSettings\(/, 'openSettings 里出现落值了 —— 一开面板就会改掉用户设置')
})

/*
 * ★ 面板开着时，列表的「选中」要收起来（老大 09-18 真机提的）：
 *   **一屏只留一个选中，它在面板里**。不收的话列表那一行还亮着描框 / 绿底，
 *   跟面板里的光标打架，看不出"选中到底在哪边"。
 *
 * ⚠️ 收的只能是**渲染用的那个类**，`activeKey` 一个字节都不许动 ——
 *    面板**不是模态**：`⌘1`–`⌘9` 秒贴、`Delete` 删的仍然是这一行。
 *    顺手清 `activeKey` 会让这两条键悄悄作用到别的行上（而且不报错）。
 */
test('★ 面板开着时列表的 .on 收起来，但 activeKey 不动', () => {
  assert.match(
    SFC,
    /on:\s*!settingsOpen\s*&&\s*row\.key === activeKey/,
    '面板开着时列表的「选中」没收起来 —— 会跟面板里的光标打架'
  )
  const open = SFC.slice(SFC.indexOf('function openSettings('))
  assert.doesNotMatch(
    open.slice(0, open.indexOf('\n}')),
    /activeKey/,
    'openSettings 里动了 activeKey —— 面板不是模态，秒贴 / 删除会作用到别的行上'
  )
})

/*
 * 守卫的三条硬要求（都是真出过事的形状）：
 *   ① 排在 `resolveKey` 之后（要用 action 判，不是自己认 e.key）；
 *   ② 排在列表之前 —— 不拦的话面板里按 ↑↓ 会让底下的列表跟着跳；
 *   ③ 排在 `case 'enter'` 之前 —— 否则 Enter 一路走到 `pasteActive()`：
 *      粘一条 + 关窗，跟 09-17 那个确认框 Enter 穿透同一类事故。
 */
test('★ 面板的键盘守卫：排在列表与 case enter 之前，并且接上了五个键', () => {
  const kd = SFC.slice(SFC.indexOf('function onKeydown('))
  const guard = kd.search(/if \(\s*settingsOpen\.value/)
  assert.ok(guard > 0, 'onKeydown 里找不到「面板优先」的守卫')
  assert.ok(kd.indexOf('const action = resolveKey(e)') < guard, '守卫要排在 resolveKey 之后')
  assert.ok(guard < kd.indexOf("case 'enter':"), '守卫必须拦在 case enter 前面')
  assert.ok(guard < kd.indexOf("case 'up':"), '守卫必须拦在列表的 ↑↓ 前面')

  const body = kd.slice(guard, guard + 700)
  for (const key of ["'up'", "'down'", "'left'", "'right'", "'enter'"]) {
    assert.ok(body.includes(key), `守卫里没接 ${key}`)
  }
  assert.match(body, /panelKey\(/, '守卫里没调 panelKey')
})

test('★ 模板认行只用行名，且跟行表一一对应（不许多、不许少）', () => {
  const used = [...new Set([...SFC.matchAll(/isCur\('([\w-]+)'/g)].map((m) => m[1]))]
  assert.deepEqual(
    used.sort(),
    PANEL_ROWS.map((r) => r.id).sort(),
    '模板里 isCur 用的行名跟行表对不上 —— 要么模板漏了一行，要么行表改了名'
  )
})

/*
 * ★ 上一条只管"行名对不对"，管不了"位置数对不对" —— 光标停在一个模板**没渲染**的格子上
 * （比如底色写成 `isCur('bg', 9)`）时，行名断言照样绿，界面上却是"按一下没反应"。
 *
 * 面板里有两种写法，得分开验：
 *   · **字面量**（`isCur('tail', 1)` / 开关的 `isCur('peek', 0)`）：直接对 `slotsOf` 验边界；
 *   · **循环**（`v-for` 里用 `i`）：`i` 的展开范围是运行期的事，静态看不出来 ⇒
 *     只保证「这一行挂了光标」+「那两个 `i + 1` 的行确实写死了第 0 格（「默认」那颗）」，
 *     另外拿 `BG_PRESETS` 把底色那一行的两段拼起来对上总数。
 *
 * ⚠️ `i + 1` 的来历：第 0 格是「默认」药丸（写死 `isCur('bg', 0)`），循环从第 1 格起。
 */
test('★ 模板里的位置号不越界，且每行都真挂了光标', () => {
  for (const row of PANEL_ROWS) {
    const all = [...SFC.matchAll(new RegExp(`isCur\\('${row.id}',\\s*[^)]+\\)`, 'g'))].map((m) => m[0])
    assert.ok(all.length > 0, `行 ${row.id} 一次 isCur 都没挂 —— 光标停不到这一行上`)

    const max = slotsOf(row)
    for (const call of all) {
      const n = call.match(/,\s*(\d+)\s*\)/)
      if (!n) continue // 循环写法（`i` / `i + 1`），交给下面按形态验
      const v = Number(n[1])
      assert.ok(v < max, `${call} 越界了 —— 行 ${row.id} 只有 ${max} 个位置（0…${max - 1}）`)
    }
  }

  // 两个「默认 + 一串」的行：第 0 格必须写死，否则光标永远够不到「默认」
  for (const name of ['bg', 'accent']) {
    assert.match(
      SFC,
      new RegExp(`isCur\\('${name}', 0\\)`),
      `行 ${name} 没有写死的第 0 格（「默认」那颗）—— 光标够不到它`
    )
    assert.match(
      SFC,
      new RegExp(`isCur\\('${name}', i \\+ 1\\)`),
      `行 ${name} 的循环写法变了（原来是 i + 1）—— 位置号会整体错一格`
    )
  }

  // 底色的两段拼起来 = 这一行的位置数
  assert.equal(
    BG_PRESETS.length + 1,
    slotsOf(PANEL_ROWS[id('bg')]),
    'BG_PRESETS 变了但行表没跟上（或反过来）—— 光标会多出/少掉一格'
  )
})
