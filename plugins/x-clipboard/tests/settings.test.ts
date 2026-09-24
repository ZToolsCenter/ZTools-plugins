/*
 * 设置的读取容错。
 *
 * 设置存在宿主库里、由插件自己写，所以库里的值**不受我们控制** ——
 * 可能是上一个版本写的（比如 `mark` 只有 border / tint 两种的时候），
 * 也可能被人手工改过。读的时候必须一类一类地看，认不出就退回默认，
 * 绝不把非法值原样带进界面（带进去就是"选了没反应"或者整块面板没颜色）。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_FOOT_HINTS,
  DEFAULT_SETTINGS,
  FOOT_BUTTONS,
  FOOT_HINTS,
  FOOT_MODES,
  MARK_MODES,
  normalizeSettings
} from '../src/lib/settings.ts'

test('空 / undefined → 全是默认值', () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
})

test('默认：详情关、强调色跟随、选中项描框、底色跟随窗口、底栏常驻', () => {
  assert.equal(DEFAULT_SETTINGS.peek, false)
  assert.equal(DEFAULT_SETTINGS.accent, 'auto')
  assert.equal(DEFAULT_SETTINGS.mark, 'border')
  // 「跟随窗口」= 不画底。默认就该跟顶部那行零色差，不是配一个相近的色号
  assert.equal(DEFAULT_SETTINGS.bg, 'auto')
  // 底栏默认常驻：键位提示是给刚开始用的人看的，先给上
  assert.equal(DEFAULT_SETTINGS.foot, 'always')
  /*
   * ★ 底栏里显示什么 = 两份多选，默认必须是"09-24 之前那一份" ——
   *   老用户升级上来看到的底栏要一个字都不变。
   * ⚠️ 是**复制**一份：所以这里比的是内容（deepEqual），不是同一个引用。
   */
  assert.deepEqual(DEFAULT_SETTINGS.footHints, [...DEFAULT_FOOT_HINTS])
  assert.deepEqual(DEFAULT_SETTINGS.footButtons, [...FOOT_BUTTONS])
  // 默认里没有「设置」那条提示（09-23 起它一直是"让位给编辑"的那一条）—— 想要的人自己勾
  assert.ok(!DEFAULT_SETTINGS.footHints.includes('settings'))
  // 反过来「编辑」在默认里：收藏视图那份就是有它的
  assert.ok(DEFAULT_SETTINGS.footHints.includes('edit'))
})

test('三种选中项都认（含 09-14 新加的实心）', () => {
  for (const m of MARK_MODES) {
    assert.equal(normalizeSettings({ mark: m }).mark, m)
  }
})

test('认不出的选中项退回描框，不是原样带进去', () => {
  assert.equal(normalizeSettings({ mark: 'rainbow' }).mark, 'border')
  assert.equal(normalizeSettings({ mark: 123 }).mark, 'border')
  // 老版本存过的值里没有第三种，读出来也不该崩
  assert.equal(normalizeSettings({ mark: 'solid' }).mark, 'solid')
})

test('强调色认那 12 个键，认不出退回跟随', () => {
  assert.equal(normalizeSettings({ accent: 'teal' }).accent, 'teal')
  assert.equal(normalizeSettings({ accent: 'slate' }).accent, 'slate')
  assert.equal(normalizeSettings({ accent: 'chartreuse' }).accent, 'auto')
})

test('peek 只认严格 true —— 字符串 "false" 不能算开', () => {
  assert.equal(normalizeSettings({ peek: true }).peek, true)
  assert.equal(normalizeSettings({ peek: 'false' }).peek, false)
  assert.equal(normalizeSettings({ peek: 1 }).peek, false)
})

test('底色认那几个键，认不出退回跟随窗口', () => {
  assert.equal(normalizeSettings({ bg: 'white' }).bg, 'white')
  assert.equal(normalizeSettings({ bg: 'warm' }).bg, 'warm')
  assert.equal(normalizeSettings({ bg: 'rainbow' }).bg, 'auto')
  assert.equal(normalizeSettings({ bg: 0 }).bg, 'auto')
})

test('底栏三档都认，认不出退回常驻', () => {
  for (const f of FOOT_MODES) {
    assert.equal(normalizeSettings({ foot: f }).foot, f)
  }
  assert.equal(normalizeSettings({ foot: 'hidden' }).foot, 'always')
  assert.equal(normalizeSettings({ foot: null }).foot, 'always')
})

/*
 * ★★ 09-24：底栏从**四档**收成**三档**，「精简」退休 —— 老文档里存着 'full' / 'lean'。
 *
 * 两个老值的迁移**不能只看形态那一格**：
 *   · 'full' → 'always'：一码事，`footHints` 该照默认给（8 条）；
 *   · 'lean' → 'always' + **`footHints: []`** —— 那一档的全部意义就是"整排提示一条不留"。
 *     只把形态迁过去、提示却补回 8 条，等于把一个升级变成"改别人已有的行为"
 *     （他当初特意选了精简那档）。
 */
test('★ 老值迁移：full → always（提示照默认），lean → always + 提示一条不留', () => {
  const full = normalizeSettings({ foot: 'full' })
  assert.equal(full.foot, 'always')
  assert.deepEqual(full.footHints, [...DEFAULT_FOOT_HINTS], '老「完整」档不该被改成别的提示集')

  const lean = normalizeSettings({ foot: 'lean' })
  assert.equal(lean.foot, 'always', '老「精简」档的形态没迁过来')
  assert.deepEqual(lean.footHints, [], '老「精简」档的整排提示又回来了 —— 那是改别人已有的行为')
  // 形态和"显示什么"是两件事：迁完还能自己勾回来（不是被锁死在空提示上）
  assert.equal(normalizeSettings({ foot: 'lean', footHints: ['fav'] }).footHints.length, 1)

  // 老文档（四档那版）整个读一遍，不该崩、也不该凭空多出提示
  assert.deepEqual(normalizeSettings({ foot: 'lean', tailType: true }).footHints, [])
})

test('多余的键一律丢掉，不往界面里带', () => {
  const s = normalizeSettings({ peek: true, theme: 'dark', accent: 'blue', 乱写: 1 })
  assert.deepEqual(Object.keys(s).sort(), [
    'accent',
    'bg',
    'confirmDelete',
    'foot',
    'footButtons',
    'footHints',
    'mark',
    'peek',
    'tailDel',
    'tailEdit',
    'tailFav',
    'tailIndex',
    'tailSource',
    'tailType'
  ])
})

/*
 * ★ 这一组锁的是「**加设置不能顺手改掉老用户的行为**」。
 *
 * `confirmDelete` / `tailType` / `tailFav` / `tailDel` 的默认值是 `true`，而老版本存下来的
 * 文档里**根本没有这几个键**（`undefined`）。如果 normalize 写成 `=== true`，
 * 所有老用户升级后会被悄悄关掉「删除前确认」和「行尾按钮」——
 * 那不是加设置，是改别人已有的行为。所以这里专门断言 `undefined` 要落到 `true`。
 */
test('老文档缺字段时，默认 true 的项要补 true（不能因为 undefined 就变 false）', () => {
  const old = normalizeSettings({ peek: true, accent: 'auto', mark: 'border', bg: 'auto', foot: 'full' })
  assert.equal(old.confirmDelete, true)
  assert.equal(old.tailType, true)
  assert.equal(old.tailFav, true)
  assert.equal(old.tailDel, true)
  // 09-23 加的编辑按钮：老文档里没这个键 ⇒ 也是"开着"（他一直在用的样子）
  assert.equal(old.tailEdit, true)
  /*
   * ★ 09-24 那两份多选的"老文档"分支：键从来没存过 ⇒ 给**今天界面上那一份**。
   *   底栏按钮三颗都得在（其中「新增」对应 09-23 那个老键 `footAdd`，缺键算开）；
   *   提示就是默认那 8 条。
   */
  assert.deepEqual(old.footButtons, [...FOOT_BUTTONS])
  assert.deepEqual(old.footHints, [...DEFAULT_FOOT_HINTS])
  // 序号是默认 false 的那一类，缺字段就该是关的
  assert.equal(old.tailIndex, false)
  // 来源同理：老文档里没这个键 ⇒ 关（不能因为"加了个设置"就给别人多显示一列）
  assert.equal(old.tailSource, false)
})

test('这四个新项：显式写的值要认', () => {
  const s = normalizeSettings({ confirmDelete: false, tailType: false, tailIndex: true, tailFav: false })
  assert.equal(s.confirmDelete, false)
  assert.equal(s.tailType, false)
  assert.equal(s.tailIndex, true)
  assert.equal(s.tailFav, false)
  // 没写的那几颗按默认（开）—— 几颗是各管各的，别互相牵连
  assert.equal(s.tailDel, true)
  assert.equal(s.tailEdit, true)
  assert.deepEqual(s.footButtons, [...FOOT_BUTTONS])
})

/*
 * ★ 09-24 加的两份多选（底栏提示 / 底栏按钮）：归一的三条规矩跟别处一样 ——
 *   **认不出的丢掉、重的去重、顺序按定义数组**。
 *
 * ⚠️ 最后那条（顺序）不是洁癖：`footHints` 的顺序直接决定底栏里那排提示的先后，
 *    库里的数组要是按"点击先后"排，界面上那排就会随用户手速变来变去。
 */
test('★ 底栏两份多选：认不出的丢掉、去重、按定义顺序排', () => {
  // 顺序按 FOOT_HINTS（fav 在 select 后面），不是按给的顺序（这里故意倒着写）
  assert.deepEqual(normalizeSettings({ footHints: ['del', 'fav', 'select'] }).footHints, [
    'select',
    'fav',
    'del'
  ])
  // 去重 + 丢掉不认识的（`'none'` 不是合法 id）
  assert.deepEqual(normalizeSettings({ footHints: ['fav', 'fav', 'none'] }).footHints, ['fav'])
  // 空数组是**合法值**（= 底栏一条提示都不显示，也就是老「精简」档的观感），不能当成"没存过"
  assert.deepEqual(normalizeSettings({ footHints: [] }).footHints, [])
  // 按钮那份同理
  assert.deepEqual(normalizeSettings({ footButtons: ['clear', 'set'] }).footButtons, ['set', 'clear'])
  assert.deepEqual(normalizeSettings({ footButtons: [] }).footButtons, [])

  /*
   * ⚠️ 非数组的垃圾值必须退回默认，**不能**当成数组处理。
   *    这里踩过的坑：字符串也有 `.includes`，`'fav'.includes('fav')` 是 true ——
   *    不判 `Array.isArray` 的话，库里一个手改出来的 `"fav"` 会"看起来能用"，
   *    实际存进去的根本不是数组（底栏渲染时 `.filter` 会炸）。
   */
  for (const bad of ['fav', 0, true, null, {}]) {
    assert.deepEqual(normalizeSettings({ footHints: bad }).footHints, [...DEFAULT_FOOT_HINTS])
    assert.deepEqual(normalizeSettings({ footButtons: bad }).footButtons, [...FOOT_BUTTONS])
  }
})

/*
 * ★★ 老键 `footAdd`（09-23 那个「新增按钮」开关）→ 并进 `footButtons` 多选。
 *
 * 跟 `tailActs` → `tailFav` / `tailDel` **完全同一个规矩**：新键缺席时不能一律给默认，
 * 那会把当初**主动关掉**「新增」的人又给他塞回来。判据同样是"存过没有"（`!== false`）。
 */
test('★ 老键 footAdd：主动关过「新增」的不能被重新打开，新键说了算', () => {
  // 当初关掉过 ⇒ 只少「新增」那一颗，另外两颗照旧
  assert.deepEqual(normalizeSettings({ footAdd: false }).footButtons, ['set', 'clear'])
  // 当初开着 / 没存过 ⇒ 三颗都在
  assert.deepEqual(normalizeSettings({ footAdd: true }).footButtons, [...FOOT_BUTTONS])
  assert.deepEqual(normalizeSettings({}).footButtons, [...FOOT_BUTTONS])
  // 垃圾值不是 `false` ⇒ 算"没关过"
  assert.deepEqual(normalizeSettings({ footAdd: 0 }).footButtons, [...FOOT_BUTTONS])
  // 新键在的时候老键一个字都不算（跟 tailFav 那条一致）
  assert.deepEqual(normalizeSettings({ footAdd: false, footButtons: ['add'] }).footButtons, ['add'])
})

test('默认 true 的项也认「垃圾值」—— 非 false 一律当开（不猜，只认显式关）', () => {
  assert.equal(normalizeSettings({ confirmDelete: 0 }).confirmDelete, true)
  // ⚠️ `'no'` 不是 `false` ⇒ 老键那一档算"没关过"，两颗都补成开
  assert.equal(normalizeSettings({ tailActs: 'no' }).tailFav, true)
  assert.equal(normalizeSettings({ tailActs: 'no' }).tailDel, true)
  assert.equal(normalizeSettings({ tailIndex: 'yes' }).tailIndex, false)
})

/*
 * ★★ 09-21：`tailFav` / `tailDel` 是从**老键 `tailActs`**（一个总开关管两颗）拆出来的，
 * 而老文档里**只有 `tailActs`**。
 *
 * 所以新键缺席时不能一律给 `true` —— 那会把当初**主动关掉**行尾按钮的人又给他打开，
 * 等于把一个升级变成了"改别人已有的行为"。判据是"这个键**存过没有**"，
 * 所以 `normalizeSettings` 里用的是 `typeof === 'boolean'` 而不是 `!== false`。
 */
test('★ 老键 tailActs 拆成两颗：主动关过的不能被重新打开', () => {
  // 当初关掉过 ⇒ 两颗都保持关（鼠标仍然没有操作入口，跟升级前一字不差）
  assert.equal(normalizeSettings({ tailActs: false }).tailFav, false)
  assert.equal(normalizeSettings({ tailActs: false }).tailDel, false)
  /*
   * ★ 09-23 加进第三种按钮「编辑」时**也得认这个老键** —— 否则当初主动关掉行尾按钮的人
   * 会平白多出一颗 ✎。他要的是键盘流，编辑给他 `⌘E` 就够了。
   */
  assert.equal(normalizeSettings({ tailActs: false }).tailEdit, false)
  // 当初开着 / 压根没存过这个键 ⇒ 两颗都开（跟升级前一字不差）
  assert.equal(normalizeSettings({ tailActs: true }).tailFav, true)
  assert.equal(normalizeSettings({}).tailFav, true)
  assert.equal(normalizeSettings({}).tailEdit, true)
  // 拆开之后各写各的：老的回来了也只当兜底，新键说了算
  assert.equal(normalizeSettings({ tailActs: false, tailFav: true }).tailFav, true)
  assert.equal(normalizeSettings({ tailActs: false, tailFav: true }).tailDel, false)
  assert.equal(normalizeSettings({ tailActs: false, tailEdit: true }).tailEdit, true)
  // 两个新键可以独立：只要收藏、不要删除
  const onlyFav = normalizeSettings({ tailFav: true, tailDel: false })
  assert.deepEqual([onlyFav.tailFav, onlyFav.tailDel], [true, false])
})

test('默认 true 的项也认「垃圾值」—— 非 false 一律当开（不猜，只认显式关）', () => {
  assert.equal(normalizeSettings({ confirmDelete: 0 }).confirmDelete, true)
  // ⚠️ `'no'` 不是 `false` ⇒ 老键那一档算"没关过"，两颗都补成开
  assert.equal(normalizeSettings({ tailActs: 'no' }).tailFav, true)
  assert.equal(normalizeSettings({ tailActs: 'no' }).tailDel, true)
  assert.equal(normalizeSettings({ tailIndex: 'yes' }).tailIndex, false)
})
