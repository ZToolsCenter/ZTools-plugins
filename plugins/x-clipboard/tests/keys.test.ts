/*
 * 键位映射。
 *
 * 重点盯两件事，都是真出过问题的：
 *   1. **⌘K = 收藏当前项**。09-15 一度把这条删了（理由写的是"收藏已经能从 Tab
 *      那一站到达"），但那是「切到收藏视图」，跟「把当前项加进收藏」是两回事 ——
 *      删掉之后收藏只剩鼠标点行尾 ☆ 一条路。老大当天让加回来，这里锁住。
 *   2. **不带修饰键的 k 什么都不是**。搜索框里打字随时会敲到 k，
 *      要是没这道判断，打两个字就把当前行收藏了。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { pasteSlot, resolveKey } from '../src/lib/keys.ts'
import { DEFAULT_FOOT_HINTS, FOOT_HINTS } from '../src/lib/settings.ts'

/** 造一个够用的键盘事件 —— resolveKey 只读这四个字段 */
function ev(init: Partial<KeyboardEvent>): KeyboardEvent {
  return { metaKey: false, ctrlKey: false, shiftKey: false, key: '', ...init } as KeyboardEvent
}

const SFC = (): string =>
  readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')

/*
 * 底栏那排提示的**长相**写在 App.vue 的 `FOOT_HINT_FACE` 表里（09-24 起），
 * 「画哪几条 / 什么顺序」由设置里的 `footHints` 决定，模板那边只有一个 `v-for`。
 *
 * ⇒ 下面几条「提示条里写着 X 吗」的断言改成查那张表。链条是：
 *   **表里有这条 + 它在可选列表 `FOOT_HINTS` 里 + 底栏是循环渲染的** ⇒ 勾上就一定出现。
 * ⚠️ 别再退回"去 `.hints` 里找一段字面量" —— 那里面现在一个提示都没有，只有 `v-for`。
 */
function hintFace(id: string): string {
  const m = SFC().match(new RegExp(`^\\s{2}${id}: \\{([^}]*)\\},?$`, 'm'))
  assert.ok(m, `FOOT_HINT_FACE 里没有 ${id} —— 那条提示在界面上会是一段空白（不报错）`)
  return m[1]
}

/** 这条提示是**默认就显示**的（新装 / 升级上来的人不用去设置里勾） */
function hintShownByDefault(id: string): void {
  assert.ok(
    (DEFAULT_FOOT_HINTS as readonly string[]).includes(id),
    `默认的底栏提示里没有 ${id} —— 新用户看不到这条键`
  )
}

test('⌘K / Ctrl+K 都是收藏当前项（两个修饰键都收，不做平台分支）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'k' })), 'favorite')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'k' })), 'favorite')
})

test('大写 K 也认（withMod 走 toLowerCase）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'K' })), 'favorite')
})

test('不带修饰键的 k → null。不然打字就在收藏', () => {
  assert.equal(resolveKey(ev({ key: 'k' })), null)
})

test('⌘D 仍然映射到收藏 —— 宿主现在拦着它，但代码里这条路不能断', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'd' })), 'favorite')
})

/*
 * ★ ⌘E = 编辑当前这条收藏（09-23 加，老大提的）。
 *
 * 它存在的理由跟 ⌘K / Delete 一模一样：**行尾那颗 ✎ 现在是个能关掉的设置项**
 * （`tailEdit`）—— 关掉之后编辑不能跟着死，得留一条并行的键盘路。
 * 「按钮管鼠标、键位管键盘」是这个插件的通用规矩，别只加按钮不加键。
 */
test('⌘E / Ctrl+E 都是编辑当前这条收藏', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'e' })), 'editFavorite')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'e' })), 'editFavorite')
  assert.equal(resolveKey(ev({ metaKey: true, key: 'E' })), 'editFavorite', '大写 E 也要认')
  assert.equal(resolveKey(ev({ key: 'e' })), null, '不带修饰键的 e 是打字，不是编辑')
})

/*
 * ⌘E 的接线（源码断言）：**三个前提缺一不可**，少一个就会在错误的地方弹输入框。
 *   ① 收藏视图 —— 历史那一摊是宿主的账，插件改不了；
 *   ② 文本行 —— 图片改不了那张 png，文件改路径等于"换一个文件"；
 *   ③ 拿**这一行的 key** 当 favId（收藏视图的 key 就是 favId，别另找）。
 */
test('⌘E 接到了 editActive，且三个前提都在', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  assert.match(kd, /case 'editFavorite':[\s\S]{0,160}?editActive\(\)/, '⌘E 没接到 editActive')

  const fn = sfc.slice(sfc.indexOf('function editActive('))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /view\.value !== 'favorites'/, 'editActive 没判视图 —— 在历史视图也会弹框')
  assert.match(body, /data\.type !== 'text'/, 'editActive 没判类型 —— 图片 / 文件也会弹输入框')
  assert.match(body, /openComposer\('edit', row\.key\)/, 'editActive 没用行 key 当 favId')
})

/*
 * ★ ⌘N = 新增一条收藏（09-24 加，老大提的）。
 *
 * 理由跟 ⌘E **同构**：右下角那颗「新增」也是能在设置里关掉的
 * （09-24 之前是 `footAdd` 那个开关，现在是「底栏按钮」多选里的「新增」）——
 * 关掉之后新增就只剩这条路。老大原话：「底栏新增没有键位兜底，⌘N 是空的的话，可以配一个」。
 *
 * ⚠️ 它的提示是**要用户自己勾的**：`⌘N 新增` 就在底栏那 15 条提示里（默认不勾，
 *    因为默认那 8 条已经贴着 Windows 的宽度上限了）。想看见它就去设置里勾上 ——
 *    09-24 起底栏放不下会换行，所以它进得去（以前写死在这儿的那句"塞不下第 9 条"已经作废）。
 */
test('⌘N / Ctrl+N 都是新增一条收藏', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'n' })), 'addFavorite')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'n' })), 'addFavorite')
  assert.equal(resolveKey(ev({ metaKey: true, key: 'N' })), 'addFavorite', '大写 N 也要认')
  assert.equal(resolveKey(ev({ key: 'n' })), null, '不带修饰键的 n 是打字，不是新增')
})

/*
 * ⌘N 的接线，外加**"不看那颗按钮的显隐设置"**这一条。
 *
 * ⚠️ 后半句是这条键的**全部意义**：它正是"按钮被关掉之后"的那条路。
 *    接线时很容易顺手加一句 `if (!settings.footButtons.includes('add')) return`
 *    （"按钮开着就不需要键"），那样它刚好会在唯一需要它的那一档里失效 ——
 *    而且不报错，只是按了没反应。
 */
test('⌘N 接到了 addActive，且不看「新增」那颗按钮的显隐', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  assert.match(kd, /case 'addFavorite':[\s\S]{0,160}?addActive\(\)/, '⌘N 没接到 addActive')

  const fn = sfc.slice(sfc.indexOf('function addActive('))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.match(body, /view\.value !== 'favorites'/, 'addActive 没判视图 —— 在历史视图也会弹框')
  assert.match(body, /openComposer\('new'\)/, 'addActive 没开"新增"那一档')
  assert.ok(
    !/footButtons/.test(body),
    'addActive 里判了 footButtons —— 那它刚好在唯一需要它的那一档（按钮关掉）失效'
  )
  assert.ok(!/footHints/.test(body), 'addActive 里判了 footHints —— 提示勾不勾跟键在不在没关系')
})

test('Tab / ⇧Tab 切分类', () => {
  assert.equal(resolveKey(ev({ key: 'Tab' })), 'cycleType')
  assert.equal(resolveKey(ev({ key: 'Tab', shiftKey: true })), 'cycleTypeBack')
})

/*
 * ★ Backspace 不再等于删除（09-17 改）。
 *
 * 锁的是一次真实的数据丢失：删除能在设置里关掉确认框之后，按下去就是真删
 * （宿主硬删、图像连磁盘文件一起 unlink、没有撤销），
 * 而「想删搜索词里的一个字」是高频动作 —— 两者共用一个键迟早出事。
 * 现在：裸 Backspace = 退搜索框；删数据只剩 `Delete` 和 `⌘⌫`。
 */
test('★ 裸 Backspace 是退格，不是删除', () => {
  assert.equal(resolveKey(ev({ key: 'Backspace' })), 'backspaceSearch')
  assert.notEqual(resolveKey(ev({ key: 'Backspace' })), 'remove', 'Backspace 绝不能回到删除')
})

test('删除只剩 Delete 和 ⌘⌫ / Ctrl+⌫（macOS 惯例）', () => {
  assert.equal(resolveKey(ev({ key: 'Delete' })), 'remove')
  assert.equal(resolveKey(ev({ metaKey: true, key: 'Backspace' })), 'remove')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'Backspace' })), 'remove')
})

/*
 * 光有映射还不够：onKeydown 里没接上，这个键就是**静默无反应**（连退格都不退了）。
 * `resolveKey` 是纯函数能单测，接线长在 App.vue 里，只能做源码断言 ——
 * 跟下面确认框那条一个路子。
 */
test('onKeydown 真的把 backspaceSearch 接到了处理函数上', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  assert.match(
    kd,
    /case 'backspaceSearch':[\s\S]{0,120}?backspaceSearch\(\)/,
    "onKeydown 里没有接 backspaceSearch —— 那样退格键会变成哑键"
  )
})

/*
 * ⌘/ 开设置。**这条锁的不是一个便利键，是「全隐」那一档的唯一出路** ——
 * 底栏设成「全隐」之后鼠标没有任何入口，这条映射要是没了，
 * 选了那档的人连改回其他档都做不到。所以它必须一直在这儿。
 */
test('⌘/ / Ctrl+/ 开设置', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: '/' })), 'openSettings')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: '/' })), 'openSettings')
})

test('不带修饰键的 / 仍然是「回到搜索框」，不是开设置', () => {
  assert.equal(resolveKey(ev({ key: '/' })), 'focusSearch')
})

/*
 * ★ ⌘/ 的提示**在表里、能勾上**（09-24 起是勾选项，不再是默认显示的那一条）。
 *
 * 跟上面那条映射同一个理由，但锁的是**可发现性**：⌘/ 在界面上能出现的地方只有这一条提示
 * （设置面板里那句「全隐 = 只能按 ⌘/ 开设置」09-17 去文案时删了）。
 *
 * ⚠️ 09-24 起它**默认不勾** —— 默认那一份是"收藏视图那 8 条"（`DEFAULT_FOOT_HINTS`），
 *    而 ⌘/ 是那一排里唯一**冗余**的一条：底栏那颗「设置」按钮就在同一行、还写着同一个词。
 *    ⇒ 它不是被删了，是"想要就勾上"（底栏现在放不下会换行，勾上不会挤掉谁）。
 *    ⚠️ 但**这一档有个坑，别顺手把提示表里这条删掉**：`footButtons` 允许把「设置」那颗
 *       按钮也取消掉，那时 `⌘/` 就是唯一入口（跟「全隐」档同一个性质）。
 */
test('★ ⌘/ 设置这条提示在表里（09-24 起属于"可勾"，不再默认显示）', () => {
  assert.ok(
    (FOOT_HINTS as readonly string[]).includes('settings'),
    '提示表里没有 settings —— ⌘/ 在界面上就彻底没有出口了'
  )
  assert.match(hintFace('settings'), /mod: true, key: '\/', label: '设置'/, '⌘/ 那条提示没写全')
})

/*
 * ★ 「Esc 返回」**回到了候选表**（09-24 第一批补的，老大盯着设置面板问出来的；第二批又补了 4 条）。
 *
 * 来龙去脉：v1.3.0 的底栏里有它（原文 `<span><kbd>Esc</kbd>返回</span>`，`git show 61df26a2` 可查）；
 * 09-23 加「Delete 删除」时那排是**定宽预算**（`overflow: hidden`，Windows 只剩 9px 余量），
 * 于是"拿一条换一条"把它换掉了。09-24 底栏放不下会换行 ⇒ 换掉它的唯一理由整个失效。
 * 老大原话：「你仔细看看我们的按钮提示给全了吗？Esc返回呢？」
 *
 * ⚠️ 锁的是"**进得去**"，不是"默认显示"：
 *   ① 它在候选表 `FOOT_HINTS` 里（设置面板里出得来、勾得上）；
 *   ② 它的键帽和文字在 `FOOT_HINT_FACE` 里有（`styles.test.ts` 那条会扫一遍 id）。
 * ⚠️ 它**默认不勾**（`DEFAULT_FOOT_HINTS` 里没有它）—— 这是刻意的取舍，不是漏了：
 *    默认那一份的定位是"一字不差的那 8 条"，加它会连带改掉所有老用户的底栏宽度。
 *    想让它默认就在，改一个词（见 `settings.ts` 那个数组的注释），别在这里绕。
 * ⚠️ Esc 是**一步退**（先清关键词 → 再清分类 → 最后关插件），不是"回上一页"；
 *    它在所有视图里都管用 ⇒ `HINT_VIEW_ONLY` 里**不该有它**（有的话就等于只在某个视图里写）。
 */
test('★ 「Esc 返回」在候选表里（09-23 为 Delete 让位删过，09-24 补回）', () => {
  assert.ok(
    (FOOT_HINTS as readonly string[]).includes('esc'),
    '候选表里没有 esc —— Esc 这条路在界面上就一处都写不出来了（它是 09-23 被换掉的那条）'
  )
  assert.match(hintFace('esc'), /key: 'Esc', label: '返回'/, 'Esc 那条提示没写全')
  assert.ok(
    !/esc/.test(
      SFC().match(/const HINT_VIEW_ONLY[^=]*= \{([^}]*)\}/)?.[1] ?? ''
    ),
    'HINT_VIEW_ONLY 里给 esc 挂了视图条件 —— Esc 阶梯在所有视图里都管用，别把它藏进某一个视图'
  )
})

/*
 * ★ 09-24 **第二批**：老大一句「我们系统现在有的按键都应该加进去啊。包括你说的 cmd+L 和 cmd+C」
 *   把口径从"要不要收这条"改成了"**只收全**"。
 *
 * 来由：我在第一批之后把 `⌘C 复制` / `Backspace 退格` 判成了"可不加"（理由是"复制这一轮
 * 底栏刚显示完"）。老大否掉的是**这条政策**，不是某一条键 —— 从那以后 `FOOT_HINTS` 的定位是
 * **"界面上所有能按的键"的完整清单**（判据和"故意不收的"写在 `lib/settings.ts` 那一大段里）。
 *
 * ⚠️ 这条测试挨着 `resolveKey` 放，锁的是**键这一层**：
 *    这 4 条对应的动作在 `keys.ts` 里都有 `case`，界面上就得有对应的提示可选。
 *    （"长相对不对"由 `styles.test.ts` 那条扫 id 的测试管，两边分工。）
 */
test('★ 09-24 第二批的 4 条按键提示都在候选表里（⌘C / ⌘L / ⌘F / Backspace）', () => {
  for (const id of ['copy', 'favview', 'search', 'backspace']) {
    assert.ok(
      (FOOT_HINTS as readonly string[]).includes(id),
      `候选表里没有 ${id} —— 这条键在界面上就一处都写不出来（老大 09-24 要求"所有按键都加进去"）`
    )
  }
  // 这 4 条**都默认不勾**（默认那一份是"一字不差的那 8 条"）—— 别被当成漏了
  for (const id of ['copy', 'favview', 'search', 'backspace']) {
    assert.ok(
      !(DEFAULT_FOOT_HINTS as readonly string[]).includes(id),
      `${id} 进了默认值 —— 默认底栏会连带改样，取舍见 DEFAULT_FOOT_HINTS 那段注释`
    )
  }
  // 键帽和文字（与 styles.test.ts 重复也没关系：这条是"键这一层"的钉子）
  assert.match(hintFace('copy'), /key: 'C', label: '复制'/, '⌘C 那条提示没写全')
  assert.match(hintFace('favview'), /key: 'L', label: '收藏夹'/, '⌘L 那条提示没写全')
  assert.match(hintFace('search'), /key: 'F', label: '搜索'/, '⌘F 那条提示没写全')
  assert.match(hintFace('backspace'), /key: 'Backspace', label: '退格'/, 'Backspace 那条提示没写全')
  // ⚠️ 「收藏夹」不是「收藏」：⌘K 已经占了「收藏」那个词（一个动当前项，一个换视图）
  assert.ok(
    !/key: 'L', label: '收藏' \}/.test(SFC()),
    '「⌘L」的文案被写成「收藏」了 —— 底栏上会并排出现两个「收藏」'
  )
  // 这 4 条**都挑视图吗？都不挑** —— 复制 / 换视图 / 搜索 / 退词在所有视图里都管用
  const viewOnly = SFC().match(/const HINT_VIEW_ONLY[^=]*= \{([^}]*)\}/)?.[1] ?? ''
  for (const id of ['copy', 'favview', 'search', 'backspace']) {
    assert.ok(
      !new RegExp(`\\b${id}\\b`).test(viewOnly),
      `HINT_VIEW_ONLY 里给 ${id} 挂了视图条件 —— 它不挑视图`
    )
  }
})

/*
 * ★ 「⌘E 编辑」「⌘N 新增」都**只在收藏视图显示**（09-24 从"二选一"改成"跟随视图"）。
 *
 * 09-23 那版是拿一条换一条（`v-if` / `v-else`）：那排是**定宽预算**，
 * `.hints` 是 `flex:1` + `overflow:hidden`，超了从右边**静默截断**，
 * 而 Windows 那列已经只剩 **9px** 余量 —— 想加「⌘/ 设置」就得挤掉「⌘E 编辑」。
 *
 * 09-24 起两件事都变了：① 底栏**放不下会换行**（不再需要二选一）；
 * ② 提示改成多选，勾哪几条是用户的事。所以 `v-if` / `v-else` 那对**整个删掉**，
 * 换成"跟随视图"：⌘E 只在收藏视图管用、⌘N 新增出来的东西也落在收藏里 ——
 * **这儿没有的东西，界面上就不写**（跟右下角那颗「新增」按钮同一个口径）。
 *
 * ⚠️ 这三条是同一个意思的三面，缺一条界面就开始撒谎（底栏教人按一个按不出反应的键）：
 *   ① 那张 `HINT_VIEW_ONLY` 表里两条都在；
 *   ② 模板里**没有** v-if / v-else 那种硬编码（提示的显隐不许在模板里判）；
 *   ③ 底栏那颗「新增」按钮也带同样的视图条件。
 */
test('★ 编辑 / 新增两条提示只在收藏视图（跟随视图，不是二选一）', () => {
  const sfc = SFC()
  const viewOnly = sfc.match(/const HINT_VIEW_ONLY[^=]*= \{([^}]*)\}/)
  assert.ok(viewOnly, 'App.vue 里找不到 HINT_VIEW_ONLY —— 那两条提示会在历史视图里也显示')
  assert.match(viewOnly[1], /edit: 'favorites'/, '「编辑」没跟随视图 —— 历史视图里 ⌘E 按了没反应')
  assert.match(viewOnly[1], /add: 'favorites'/, '「新增」没跟随视图 —— 历史视图里 ⌘N 按了没反应')

  const hints = sfc.match(/<div class="hints">[\s\S]*?<\/div>/)
  assert.ok(hints, 'App.vue 里找不到底栏的 .hints 块')
  assert.match(hints[0], /v-for="h in footHintItems"/, '底栏那排不是循环渲染的 —— 勾了不会出现')
  assert.doesNotMatch(
    hints[0],
    /v-if=|v-else/,
    '底栏提示里又出现 v-if / v-else 了 —— 显示哪几条是设置说了算，别在模板里硬编码'
  )

  assert.match(
    sfc,
    /v-if="view === 'favorites' && settings\.footButtons\.includes\('add'\)"/,
    '底栏那颗「新增」没跟提示同一个口径（只在收藏视图）'
  )
})

/*
 * ⌘1–9 秒贴那一项：表里必须真的写着。
 *
 * 跟上面几条同一个理由（可发现性），但这一族键更隐蔽 —— **界面上连线索都没有**：
 * 行尾那列「序号」默认是关的，所以连"行尾会显示号码"这件事默认也看不见。
 * 09-17 老大第三次因为「实现了却没提示」提出来，原话「怎么老是忘记这个」。
 * 这条锁住它别哪天被当成"提示太挤"取消掉。
 *
 * ⚠️ 键帽里**只写一个修饰键**（`⌘1–9` / Windows `Ctrl+1–9`），写全 `⌘1–⌘9` 不行：
 *    09-23 加「Delete 删除」时按真实 CSS 量过 —— `Ctrl+1–Ctrl+9` 一个键帽就 112px，
 *    Windows 那排会溢出（窗口死 800px）。所以表里是 `key: '1–9'`，别"补全"成两个修饰键。
 *
 * ⚠️ `–9` 那两个字符**必须在**（`1–9` 整串进键帽）。09-24 把提示从模板搬进
 *    `FOOT_HINT_FACE` 表驱动时漏过一次，底栏渲染成「⌘1 秒贴」，老大真机一眼看出来。
 *    改成"只写个 1"是最容易被顺手"简化"错的地方，这条就是用来钉住它的。
 */
test('底栏提示里有 ⌘1–9 秒贴这一项，且默认显示', () => {
  assert.match(
    hintFace('paste'),
    /mod: true, key: '1–9', label: '秒贴'/,
    '⌘1–9 秒贴那条表项不对（注意 key 是整串 `1–9`，别只写 `1`）'
  )
  hintShownByDefault('paste')
})

/*
 * Delete 删除那一项（09-23 加）。
 *
 * 跟上面几条同一个理由（可发现性）：删除的**键盘路径原先一处都没写** ——
 * 行尾那枚 🗑 只对鼠标有意义（鼠标划上去才出现），而 `⌘K` 收藏那条路倒是写着。
 * 09-23 老大提的，原话「这个快捷键没有加到底栏里面，我觉得可以加上这个」。
 * 为它挤掉了「Esc 返回」：Esc 是通用键、好猜，README 里照旧列着。
 * ⚠️ 它**不带修饰键**（Delete / ⌘⌫ 都认，但键帽上写 Delete 最通用）。
 */
test('底栏提示里有 Delete 删除这一项，且默认显示', () => {
  assert.match(hintFace('del'), /key: 'Delete', label: '删除'/, 'Delete 删除那条表项不对')
  assert.doesNotMatch(hintFace('del'), /mod/, 'Delete 不该带修饰键')
  hintShownByDefault('del')
})

/*
 * ★★ 输入浮层（新增 / 编辑收藏）的键盘守卫 —— 必须是**焦点陷阱**。
 *
 * 老大 09-23 真机报的（当时还是探针那一版）：「tab 时会切换到编辑框外面，
 * 编辑框还没关呢，tab 还可以切换分类」。
 * 根因是那一版**按 `e.target.closest('.probe')` 放行**：在输入框里连按两次 Tab，
 * 第一次焦点跑到框内的按钮上（还在判据里），第二次就出浮层了 ——
 * 那一下直接漏到下面的 `Tab → cycleType`，把分类切了。
 *
 * ⇒ 判据只能是「**浮层开着**」，不能是「焦点在输入框里」。这条锁三件事：
 *   ① 守卫写成 `if (composer.value)`，且不带任何 target 判断；
 *   ② 输入框里的 `Tab` 显式挡掉（它是唯一能把焦点带出输入框的键）；
 *   ③ `hasSomethingToFold()` 带上它 —— 否则浮层里按 Esc 会穿透给宿主，**整个插件退回搜索页**。
 */
test('★ 输入浮层是焦点陷阱：Tab 不许漏出去切分类（09-23 真机报的）', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  // 只看守卫那一段：到「插件不认这个键」那个分支为止
  const head = kd.slice(0, kd.indexOf('const action = resolveKey(e)'))

  assert.match(head, /if \(composer\.value\)\s*\{/, '找不到输入浮层的守卫')
  assert.doesNotMatch(
    head,
    /composer\.value[\s\S]{0,60}?target/,
    '守卫改成按 e.target 判了 —— 连按两次 Tab 就会漏出去切分类（见上面那段）'
  )
  assert.match(head, /e\.key === 'Tab'\)\s*e\.preventDefault\(\)/, '输入框里的 Tab 没挡掉')
  assert.match(head, /e\.key === 'Enter' && !e\.shiftKey/, 'Enter 没接给保存（⇧Enter 要留给换行）')
  assert.match(head, /composerRef\.value/, '守卫里没拿输入框做判据（放行原生输入那一步）')

  const fold = sfc.match(/function hasSomethingToFold\(\)[^{]*\{([^}]*)\}/)
  assert.ok(fold, '找不到 hasSomethingToFold')
  assert.match(fold[1], /composer\.value/, 'Esc 阶梯里漏了输入浮层（Esc 会穿透把插件关掉）')
})

/*
 * 输入浮层的长相：**一块居中的小框 + 多行输入区**。
 *
 * 老大 09-23 定的口径（原话）：「我希望交互，新增和编辑都是弹出一个小框出来输入，
 * 而不是直接在项上面，因为每一项可能展示不全。弹框能展示全」。
 * ⇒ 输入区必须是 `textarea`（会折行、高度跟着内容长），**不能退回单行 `input`**
 *   —— 单行只能横向滚，长的内容照样看不全，那就把"弹框能展示全"这句话作废了。
 */
test('输入浮层：textarea（不是 input）+ 键位写在界面上', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  assert.match(sfc, /class="box composer"/, '找不到输入浮层的卡片')
  assert.match(sfc, /<textarea[\s\S]{0,200}?class="ctx"/, '输入区不是 textarea（单行看不全长内容）')
  // 键位得写在界面上，否则只有翻过 README 的人知道
  assert.match(sfc, /<kbd>Enter<\/kbd>保存/, '界面上没写 Enter 保存')
  assert.match(sfc, /<kbd>Esc<\/kbd>取消/, '界面上没写 Esc 取消')
  // 高度是 JS 算的（fitComposer），样式里不该再钉一个 height
  const css = sfc.slice(sfc.indexOf('<style'))
  const rule = css.match(/\.ctx\s*\{([^}]*)\}/)
  assert.ok(rule, '样式表里找不到 .ctx')
  assert.doesNotMatch(rule[1], /(^|\s)height:/, '.ctx 不该写死 height —— 内联样式会盖掉它，看着像没生效')
})

/*
 * ★ 确认框开着时，Enter 必须是「确定」，**不能穿透成「复制当前项」**。
 *
 * 老大 09-17 真机报的：弹框问「删除这条记录？」时按 Enter ——
 * 结果复制了当前项、**插件窗口也一起关了**，而删除根本没执行。
 * 根因是 `onKeydown` 里没有「弹框优先」这一层，Enter 一路走到 `case 'enter'` → `pasteActive()`。
 *
 * 这段逻辑长在 App.vue 的键盘处理器里、不在可单测的纯函数里，所以只能做源码断言。
 * 锁三件事：守卫在、排在 `resolveKey` 之后（它要用 action）、排在 `case 'enter'` 之前。
 */
test('★ 确认框开着时 Enter = 确定（别让它穿透去 pasteActive）', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  const guard = kd.indexOf('if (confirmBox.value)')

  assert.ok(guard > 0, 'onKeydown 里找不到「确认框优先」的守卫')
  assert.ok(
    kd.indexOf('const action = resolveKey(e)') < guard,
    '守卫要排在 resolveKey 之后 —— 它得拿 action 判断，不是自己认 e.key'
  )
  assert.ok(
    guard < kd.indexOf("case 'enter':"),
    "守卫必须拦在 case 'enter' 前面，否则 Enter 照样会去粘贴并关窗"
  )

  const body = kd.slice(guard, kd.indexOf('if (!action)'))
  assert.match(body, /action === 'enter'/, '守卫里没把 Enter 接给「确定」')
  assert.match(body, /runConfirm\(\)/, '守卫里没调 runConfirm')
})

/*
 * ⌘1–⌘9 秒贴。
 *
 * 这条键位有个必须记住的前提：**数字键不在宿主那六个键的白名单里**，
 * 所以它跟 ⌘K 一样，得先按一次 ↑↓ 把焦点搬进插件才收得到。
 * 这里锁的是「映射本身对不对」，收不收得到是宿主的事（见 REFERENCE §26.1-D）。
 */
test('⌘1–⌘9 / Ctrl+1–Ctrl+9 映射到 paste1–paste9（两个修饰键都收）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: '1' })), 'paste1')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: '5' })), 'paste5')
  assert.equal(resolveKey(ev({ metaKey: true, key: '9' })), 'paste9')
})

/*
 * ⚠️ ⌘0 不做第 10 条。
 * 行尾只给**本屏**前 9 行显示序号；如果这里认了 0，界面上就会出现一个
 * 「没有标注、但按下去有反应」的键 —— 而且 0 放在 1 前面的直觉也不成立。
 */
test('⌘0 不映射（只做 1–9）', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: '0' })), null)
})

/*
 * 不带修饰键的数字必须是 null。
 * 搜索框里搜「123」是常事，要是这里认了，打一个字就粘走一条。
 */
test('裸数字键 → null，不然在搜索框里打字就会粘贴', () => {
  assert.equal(resolveKey(ev({ key: '1' })), null)
  assert.equal(resolveKey(ev({ key: '9' })), null)
})

test('pasteSlot 把 pasteN 换成 0 基下标，别的动作一律 null', () => {
  assert.equal(pasteSlot('paste1'), 0)
  assert.equal(pasteSlot('paste9'), 8)
  assert.equal(pasteSlot('favorite'), null)
  assert.equal(pasteSlot(null), null)
  assert.equal(pasteSlot(undefined), null)
})

/*
 * ★ ←→ 已经给设置面板领走了（09-18 加）。
 *
 * 列表里左右没有含义 —— 面板开着时这一对键在 `onKeydown` 的守卫里就被拦下
 * （守卫排在列表之前），落到全局那个 switch 里是空分支，这是有意的、不是漏改。
 * 锁这条是为了两件事：① 面板的行内移动真的收得到（宿主那六个转发键本来含 ←→）；
 * ② 以后翻键位表时能看见 ←→ 已经有主。
 */
test('★ ←→ 映射到 left / right（设置面板用）', () => {
  assert.equal(resolveKey(ev({ key: 'ArrowLeft' })), 'left')
  assert.equal(resolveKey(ev({ key: 'ArrowRight' })), 'right')
  // 带修饰键的不是面板内那条路（面板里用的是裸方向键）
  assert.equal(resolveKey(ev({ metaKey: true, key: 'ArrowLeft' })), null)
})

/*
 * ★ 翻页（09-21 加）。
 *
 * 来由：一屏 13 行，找第 14 条要按十几次 ↓。
 *
 * 两族键映射到**同一个动作**，别当成重复的随手删掉一个 —— 它们覆盖的场合不一样：
 *   · `PageDown` / `PageUp` —— 语义最准，但**要求焦点已经在插件里**
 *     （它俩不在宿主那六个转发键的白名单里）；
 *   · `⌘↓` / `⌘↑` —— 走的是「六个 base key × 修饰键」那条路（宿主那份 Vue 的
 *     `withKeys` 只看 `event.key`，四个修饰键一个都没检查），
 *     **搜索框握着焦点时也按得到**，打开插件直接按就行。
 *
 * 老大最初问的是 `Tab+↑ ↓` —— 那个表达不出来（Tab 不是修饰键，事件里没有
 * "Tab 被按住"这个字段），而且 Tab / ⇧Tab 已经被「切分类」领走了。
 */
test('PageDown / PageUp 是翻页', () => {
  assert.equal(resolveKey(ev({ key: 'PageDown' })), 'pageDown')
  assert.equal(resolveKey(ev({ key: 'PageUp' })), 'pageUp')
})

test('⌘↓ / ⌘↑（以及 Ctrl+↓ / Ctrl+↑）跟 PageDown 同一个动作', () => {
  assert.equal(resolveKey(ev({ metaKey: true, key: 'ArrowDown' })), 'pageDown')
  assert.equal(resolveKey(ev({ metaKey: true, key: 'ArrowUp' })), 'pageUp')
  assert.equal(resolveKey(ev({ ctrlKey: true, key: 'ArrowDown' })), 'pageDown')
})

/*
 * ⚠️ 加了翻页之后最容易出的事故：**裸 ↑↓ 被顺手改成翻页** ——
 * 那就是把"一行一行看"整个弄没了。钉住。
 *
 * 顺带钉住 `⇧↓` / `⌥↓` 现在**仍然是走一行**（这两个修饰键不参与判定）。
 * 别把它俩改成翻页：`⇧↓` 会在搜索框里**选中文字**，而宿主的 `keydownEvent` 里
 * 有个判断 —— 非插件视图下只要搜索框**有选区**，方向键一律 `stopPropagation()` 丢掉。
 * ⇒ 第一下能到，第二下就哑了。
 */
test('★ 裸 ↑↓ 还是走一行，没被翻页抢走；⇧↓ / ⌥↓ 也仍然是走一行', () => {
  assert.equal(resolveKey(ev({ key: 'ArrowDown' })), 'down')
  assert.equal(resolveKey(ev({ key: 'ArrowUp' })), 'up')
  assert.equal(resolveKey(ev({ shiftKey: true, key: 'ArrowDown' })), 'down')
  assert.equal(resolveKey(ev({ altKey: true, key: 'ArrowDown' })), 'down')
})

/*
 * 光有映射不够 —— `onKeydown` 里没接上，翻页键就是个哑键（跟 backspace 那条同一个路子）。
 * 末段的注释块占了三百多字，所以这里给个够用的窗口，别用 {0,120} 那种紧的。
 */
test('onKeydown 真的把 pageDown / pageUp 接到了 pageMove 上', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const kd = sfc.slice(sfc.indexOf('function onKeydown('))
  assert.match(
    kd,
    /case 'pageDown':[\s\S]{0,900}?pageMove\(/,
    "onKeydown 里没有接 pageMove —— 那样翻页键会是个哑键"
  )
})

/*
 * ★ 步长必须**量**出来，不能写死 13。
 *
 * 行高有两档（纯文本 36px / 带缩略图·文件图标的 42px），一屏装几行随内容和窗口高度变。
 * 写死的话，混排的那几屏会漏掉一行 —— 而"漏一行"这种错极难被发现，
 * 人只会觉得"刚才好像扫过去一条"。
 *
 * 同时钉住「留一行」（`pageRows() - 1`）：上一屏的最后一行当新屏第一行，
 * 跟浏览器的 PageDown 一个做法，顺带保证**步长恒小于屏高 ⇒ 永远不会漏行**。
 * 想改成"整页无重叠"就是把这个 `- 1` 去掉，改了这条测试会红，提醒你是有意改的。
 */
test('★ 翻页步长是量出来的（pageRows() - 1），不是常量', () => {
  const sfc = readFileSync(fileURLToPath(new URL('../src/App.vue', import.meta.url)), 'utf8')
  const fn = sfc.slice(sfc.indexOf('function pageMove('))
  assert.ok(fn.length > 0, 'App.vue 里找不到 pageMove')
  assert.match(
    fn,
    /const step = Math\.max\(1, pageRows\(\) - 1\)/,
    'pageMove 的步长不是「实测屏高 − 1」—— 写死行数会在 42px 的图片行那几屏漏行'
  )
})

/*
 * ⌘↓ 翻页那一项：表里必须真的写着。
 *
 * 跟 ⌘/ 、⌘1–⌘9 两条同一个理由（可发现性），也是老大提过三次的那件事：
 * **实现了键盘路径就必须在界面上写出来**。翻页尤其隐蔽 —— 一个纯键盘动作，
 * 界面上本来一点线索都没有，不写就等于只有翻过 README 的人知道。
 *
 * 提示里选 ⌘↓ 而不是 PageDown：⌘↓ 在搜索框里就能按（不用先按 ↑↓ 搬焦点），
 * 是更该被看见的那一个。
 */
test('底栏提示里有 ⌘↓ 翻页这一项，且默认显示', () => {
  assert.match(hintFace('page'), /mod: true, key: '↓', label: '翻页'/, '⌘↓ 翻页那条表项不对')
  hintShownByDefault('page')
})
