/*
 * 面板底色的预设表。
 *
 * 锁的是两条约定：
 *   1. `auto` 必须真的是「没画底」（`transparent`）—— 「跟顶部那行零色差」全靠这一条，
 *      一旦它变成某个具体色号，色差就又回来了（只是小一点）。
 *   2. 每个预设**都要有浅色和深色两版**，且浅的那版必须更浅 ——
 *      否则切主题时会出现「浅色面板配深色字」，那是 09-14 修过的同类错误。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { BG_KEYS, BG_PRESETS, resolveBg, resolveFloatBg } from '../src/lib/surface.ts'

/** 三个通道直接相加，够用来比大小（这里只需要「谁更浅」） */
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)
}

test('★ auto = 不画底 —— 零色差就靠它，不能被换成任何色号', () => {
  assert.equal(resolveBg('auto', false), 'transparent')
  assert.equal(resolveBg('auto', true), 'transparent')
})

test('预设：至少 4 个、键不重复、色值合法且不重复', () => {
  assert.ok(BG_PRESETS.length >= 4, '选项太少的话这个设置就没意义了')
  const keys = BG_PRESETS.map((p) => p.key)
  assert.equal(new Set(keys).size, keys.length, '键重复了')
  const vals = BG_PRESETS.flatMap((p) => [p.light, p.dark])
  assert.equal(new Set(vals).size, vals.length, '两个预设给了同一个色值')
  for (const p of BG_PRESETS) {
    assert.match(p.light, /^#[0-9a-f]{6}$/i, `${p.key} 的浅色版不是合法色值`)
    assert.match(p.dark, /^#[0-9a-f]{6}$/i, `${p.key} 的深色版不是合法色值`)
  }
})

test('★ 同一个预设：浅色那版一定比深色那版浅（标反了上面那条也救不回来）', () => {
  for (const p of BG_PRESETS) {
    assert.ok(lum(p.light) > lum(p.dark), `${p.key} 的浅深两版标反了`)
  }
})

test('认不出的当 transparent —— 不能给一个错的实底', () => {
  assert.equal(resolveBg('rainbow' as never, false), 'transparent')
})

test('BG_KEYS = auto + 全部预设，且 auto 排第一', () => {
  assert.equal(BG_KEYS[0], 'auto')
  assert.equal(BG_KEYS.length, BG_PRESETS.length + 1)
})

/*
 * 浮层（详情 / 设置 / 确认框 / 淡入底栏）的底色。
 *
 * **跟随底色是默认行为**，只有「默认」那一档是例外 —— 别把下面读成"浮层不跟随"：
 *   1. 实底预设（白 / 灰 / 暖 / 冷）→ **跟着面板同一个色号**。不跟的话就是老大最初那句
 *      「详情框的底色应该根据底色的设置来」——选个暖色面板、详情框还是冷白，像这设置没生效。
 *      **这一档老大确认过没问题。**
 *   2. `auto`（面板不画底）→ **`null` = 不覆盖**，浮层回落中性实底。
 *      这一档**没有颜色可跟**（面板自己就透明）；试过"跟到底"（浮层也 transparent + 模糊），
 *      真机上列表的密集文字**重影**、糊完是一团脏影子，老大否掉：「效果都确实不太好」。
 */
test('★ 实底预设下，浮层色号跟面板完全一致（差一点就等于没跟）', () => {
  for (const p of BG_PRESETS) {
    for (const dark of [false, true]) {
      const float = resolveFloatBg(p.key, dark)
      assert.ok(float, `${p.key} 的浮层没拿到色号`)
      assert.equal(float, resolveBg(p.key, dark), `${p.key}（${dark ? '深' : '浅'}）跟面板不一致`)
    }
  }
})

test('★ 「默认」档不覆盖（返回 null），绝不能返回 transparent —— 浮层必须自己立住', () => {
  assert.equal(resolveFloatBg('auto', false), null)
  assert.equal(resolveFloatBg('auto', true), null)
})

test('认不出的模式：浮层也不覆盖（跟 resolveBg 一样当 auto 处理）', () => {
  assert.equal(resolveFloatBg('never' as never, false), null)
})

/*
 * ★ 底色 = **一条明度阶梯 + 两个色温**（09-17 从 4 个加到 6 个，老大挑的方案 A）。
 *
 * 起因是他问"底色是不是该提供全一点"。核实下来**问题不在数量，在名不副实**：
 * 原来那四个预设里，深色主题下的 RGB 只差 5~8 个点（根本分不出是四档），
 * 浅色主题下也只有「白 / 灰」能分辨，暖·冷只是色温微调 ⇒ **名义 4 档、实际 2 档**。
 *
 * 所以加的是**明度**，不是色相 —— 色相这条路走不通：文字色 `--tx-*` 是写死的两套，
 * 不跟着底色走；浮层还会跟着底色铺到详情 / 确认框那些密集文字区（见 REFERENCE §34.3）。
 *
 * 锁三件事：
 *   1. **实底预设正好 5 个**（面板里连「默认」那颗一共 **6 颗**），顺序 = 白 → 灰 → 实 → 暖 → 冷。
 *      6 颗仍在一行内：面板内容宽 268px，色点 14 + 间距 12 ⇒ 一行最多 10 个（见 REFERENCE §34.2）；
 *   2. 前三个是**明度阶梯**：浅色端越排越深、深色端越排越亮（两端是同一条阶梯）；
 *   3. `strong` 在 `BG_KEYS` 里（面板是遍历 `BG_PRESETS` 渲染的，但**校验**认的是 `BG_KEYS`）。
 */
test('★ 底色：白 / 灰 / 实 是明度阶梯，暖冷压尾（实底 5 个 + 默认 = 面板 6 颗）', () => {
  assert.deepEqual(
    BG_PRESETS.map((p) => p.key),
    ['white', 'gray', 'strong', 'warm', 'cool']
  )
  const ladder = BG_PRESETS.slice(0, 3)
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(lum(ladder[i].light) < lum(ladder[i - 1].light), '浅色端不是越排越深')
    assert.ok(lum(ladder[i].dark) > lum(ladder[i - 1].dark), '深色端不是越排越亮')
  }
  assert.ok(BG_KEYS.includes('strong'), 'strong 没进 BG_KEYS —— 会被 normalizeSettings 丢掉')
})
