/*
 * 键盘映射。
 *
 * 这里只有「按键 → 动作名」的翻译，动作本身由 App.vue 决定。
 * 这么切是为了让键位可以单独看、单独改：**下面的 `resolveKey` 就是键位的唯一说明处**。
 *
 * 原来这里还摆着一张手写的 `KEYMAP` 表（label/desc/action 三列），但它界面上根本不展示，
 * 只有一条测试在断言它自己 —— 等于把同一套键位写了两遍，两份还可能对不上
 * （它里面把上下合成一条 `↑ ↓`、又没有 Backspace，跟 `resolveKey` 已经有出入）。
 * 删掉之后，要看全部键位就读 `resolveKey` 那个 switch，只有一处可错。
 *
 * 修饰键：`resolveKey` **两个都收**（metaKey / ctrlKey），不做平台分支 ——
 * 因为对插件来说它们本来就是同一个动作。但**展示**必须分平台，
 * Windows 的键盘上根本没有 ⌘ 键。界面上统一走 `platform.ts` 的 `modKey()`，
 * 下面 `label` 里那个 ⌘ 只是「修饰键」的占位写法。
 * ⇒ 所以 `⌘1`–`⌘9` 在 Windows 上就是 `Ctrl+1`–`Ctrl+9`，**代码里不用写平台分支**。
 *
 * 切分类为什么用 Tab / ⇧Tab 而不是 ⌘1~5：宿主那个搜索框握着焦点时，渲染层只把
 * `←→↑↓EnterTab` 六个键投给插件，`⌘1~5` 根本进不来。而 Tab 天然没有平台差异。
 * （⌘K / ⌘C / ⌘L 这些能用的前提是**焦点已经在插件里** —— 按一下 ↑↓ 就会过去，
 *  见 App.vue 的 takeKeyboard()；Esc 抢跑靠的是捕获监听器。）
 */

/**
 * `⌘1`–`⌘9`：直接粘贴第 N 行。
 *
 * ⚠️ **跟 ⌘K 同一个前提：焦点得先在插件里**（先按一次 ↑↓、或者用鼠标点过列表）。
 * 数字键**不在**宿主那六个键的白名单里，所以「打开插件就直接按 ⌘1」是收不到的 ——
 * 这不是能靠改插件绕开的事（详见 REFERENCE §26.1-D）。
 *
 * ⚠️ 序号**必须**取自渲染列表本身（`v-for` 的下标），不能另算一份 ——
 * 两处一旦不一致，按 ⌘3 粘到的就不是眼睛看到的第 3 条。
 */
export type PasteAction = `paste${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`

export type KeyAction =
  | 'up'
  | 'down'
  | 'pageDown'
  | 'pageUp'
  | 'left'
  | 'right'
  | 'enter'
  | 'escape'
  | 'remove'
  | 'backspaceSearch'
  | 'focusSearch'
  | 'copy'
  | 'favorite'
  | 'toggleFavoritesView'
  | 'cycleType'
  | 'cycleTypeBack'
  | 'openSettings'
  | PasteAction

function withMod(key: string): KeyAction | null {
  /*
   * ⌘1–⌘9 秒贴。**先判掉** —— 它是纯模式匹配，跟下面那堆语义键不是一类；
   * 塞进 switch 就只能靠 default 兜，而 default 摆在任何位置都合法、
   * 摆在开头还会从那儿往下穿透，是个容易看漏的坑。
   */
  if (/^[1-9]$/.test(key)) return `paste${key}` as PasteAction

  switch (key) {
    /*
     * ⌘⌫ / Ctrl+⌫ = 删除当前项（macOS 的惯例）。
     *
     * 裸 Backspace 已经改成「退格」了（见下面 `resolveKey`），删数据只剩 `Delete` 一个键 ——
     * 这条是给"手本来就停在 Backspace 上"的人留的路子：**按住修饰键才是删**。
     * 也顺便解释清楚为什么它不在下面那个 switch 里：修饰键路径全都先走 `withMod`。
     */
    case 'backspace':
      return 'remove'
    case 'f':
      return 'focusSearch'
    case 'c':
      return 'copy'
    /*
     * ⚠️ ⌘D 宿主收不到：它被绑给了「分离插件」，插件视图下
     * `before-input-event` 直接拦掉并 preventDefault()（已核对宿主行为）。
     * 这个分支仍然留着 —— 既不碍事，哪天宿主改了行为它自己就活过来。
     * **但别把它当可靠入口**：收藏走下面的 ⌘K。
     */
    case 'd':
      return 'favorite'
    /*
     * 收藏当前项。
     *
     * 这个键的来龙去脉值得留着看 —— 围着它错了整整一天：
     *   ① 09-15 一度删掉过（理由写的是"收藏已经能从 Tab 那一站到达"），但那只说的是
     *      「切到收藏视图」，跟「把当前项加进收藏」是两件事；删了之后收藏就只剩
     *      鼠标点行尾 ☆ 一条路。老大当天让加回来，所以留着。
     *   ② 同一天老大报「用键盘收藏完全没反应」。**真因是宿主那个搜索框一直握着焦点**
     *      （真机上看得见：按 ↑↓ 时光标还在框里闪）—— 渲染层只把 ←→↑↓EnterTab 六个键
     *      投给插件，`⌘K` 在渲染层就被丢了。**是按键没进插件，不是没实现。**
     *      修法见 App.vue 的 takeKeyboard()：按 ↑↓ 时用 `ztools.subInputBlur()`
     *      把焦点让给插件视图，之后 ⌘ 组合键全部直达。
     *   ③ 排查途中还误判过两次（"页面没重载"、"⇧Enter 才是唯一到得了的键"），
     *      两条都已作废。**教训：别用推出来的机制去否掉真机现象。**
     */
    case 'k':
      return 'favorite'
    case 'l':
      return 'toggleFavoritesView'
    /*
     * ⌘/ 开设置。
     *
     * 为什么它必须存在：底栏可以设成「全隐」—— 那一档下鼠标**没有任何**入口，
     * 这条键就是唯一的出路。**别哪天觉得它没人用就删掉**，删了等于把
     * 选了「全隐」的人锁死（连改回其他档都做不到）。
     *
     * 跟 ⌘K / ⌘C / ⌘L 同一个前提：**焦点得先在插件里**。
     * 搜索框握着焦点时宿主只投那六个键，⌘ 组合键在渲染层就被丢掉了 ——
     * 所以按之前先按一下 ↑↓ 把焦点要过来（App.vue 的 takeKeyboard()）。
     */
    case '/':
      return 'openSettings'
    /*
     * ★ ⌘↑ / ⌘↓ = 翻一屏（09-21 加）—— **跟 PageDown / PageUp 是同一个动作**，
     * 但它多一个 PageDown 没有的性质：**搜索框握着焦点时也按得到**。
     *
     * 来由：老大问"能不能用 Tab+↑ ↓"。**那个组合表达不出来** —— Tab 不是修饰键，
     * 键盘事件里根本没有"Tab 被按住"这个字段（只有 shift / ctrl / alt / meta 四个）。
     * 同时按 Tab 和 ↓，浏览器给的还是一个纯 `ArrowDown`，跟单按 ↓ 一模一样；
     * 而且 Tab / ⇧Tab 早就被「切分类」领走了。
     *
     * 但顺着他的方向查下去，确实有一类键能绕开那个前提：宿主搜索框的白名单是
     * **六个 base key（← → ↑ ↓ Enter Tab）× 任何修饰键**。依据是宿主那份 Vue 里的
     * `withKeys` —— 实现是 `hyphenate(event.key)` 跟白名单逐个比，
     * **四个修饰键一个都没检查**；转发时 `readModifiers` 又会把修饰键一起带上。
     * （已直接读 `app.asar` 核对，不是推测。）
     *
     * 那一批里为什么挑 ⌘↑ / ⌘↓：
     *   · `⇧↓` / `⇧↑` —— 会在**搜索框里选中文字**，而宿主有个判断：
     *     `currentView !== 'plugin'` 时只要搜索框**有选区**，方向键一律
     *     `stopPropagation()` 丢掉。⇒ 第一下能到，第二下就哑了。
     *   · `←` / `→` —— 会挪搜索框的光标（插件这边 `preventDefault()` 管不到另一个窗口）。
     *   · `⌘↑` / `⌘↓` —— 既不选区也不挪光标，按多少下都一样。
     *
     * ⚠️ **别把它当"PageDown 的别名"随手删掉**：它俩覆盖的场合不一样 ——
     *    PageDown / PageUp 要求焦点已经在插件里，⌘↓ / ⌘↑ 不要求（打开插件直接按就行）。
     */
    case 'arrowdown':
      return 'pageDown'
    case 'arrowup':
      return 'pageUp'
    default:
      return null
  }
}

/**
 * `paste3` → `2`，其余 → `null`。
 *
 * 让调用方拿得到「第几个」而不必自己去拆字符串；也保证「认哪几个键」这件事
 * 仍然只有 `withMod` 一处说话。
 */
export function pasteSlot(action: KeyAction | null | undefined): number | null {
  const m = /^paste([1-9])$/.exec(action ?? '')
  return m ? Number(m[1]) - 1 : null
}

export function resolveKey(e: KeyboardEvent): KeyAction | null {
  if (e.metaKey || e.ctrlKey) return withMod(e.key.toLowerCase())

  switch (e.key) {
    case 'ArrowUp':
      return 'up'
    case 'ArrowDown':
      return 'down'
    /*
     * ★ PageDown / PageUp = 翻一屏（09-21 加）。
     *
     * 来由：一屏 13 行，想找第 14 条得按十几次 ↓。
     *
     * ⚠️ **它俩不在宿主那六个转发键里**（`←→↑↓EnterTab`），所以跟 ↑↓ 有一个关键区别：
     *    能收到 PageDown 的时候，焦点**一定已经**在插件视图里了。⇒ 这条分支
     *    **不需要** `takeKeyboard()`，那一步在按键走到这儿之前就已经完成了。
     *    反过来说，「打开插件直接按 PageDown」是收不到的 —— 得先按一下 ↑↓ 或点一下列表。
     *
     * ⚠️ 别以为是宿主拦了它。查过 `app.asar`：插件视图的 `before-input-event` 里
     *    只 `preventDefault` 两个键 —— `⌘D`（分离）和 `⌘Q`（退出），
     *    其余包括 PageDown / PageUp / Home / End 一律放行。挡住它们的是搜索框那层白名单。
     *
     * 步长、基准、到头怎么办都在 App.vue 的 `pageMove()` 上面写着 —— 那边是决定处，
     * 这里只管"哪个键算翻页"。
     */
    case 'PageDown':
      return 'pageDown'
    case 'PageUp':
      return 'pageUp'
    /*
     * ←→ **只有设置面板用**（09-18 加的）：面板里「换行」是 ↑↓、「行内换位置」是 ←→。
     *
     * 列表里左右没有含义，所以它们落到全局那个 switch 里是空分支 —— 这是有意的，
     * 不是漏了。之所以还是写进这张表，是为了守住"键位只有这一处说明"：
     * 哪天有人翻键位，在这里就能看到 ←→ 已经被面板领走了。
     *
     * 宿主那六个转发键（←→↑↓EnterTab）本来就含 ←→，所以焦点在搜索框里也收得到；
     * 但**面板里按方向键时会先把焦点要回插件**（跟列表的 ↑↓ 同一个做法），
     * 免得搜索框那边同时在动光标。
     */
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    case 'Enter':
      return 'enter'
    case 'Escape':
      return 'escape'
    case 'Tab':
      // Tab 是极少数「搜索框有焦点时宿主也会转发给插件」的键，靠它才切得动分类
      return e.shiftKey ? 'cycleTypeBack' : 'cycleType'
    /*
     * ★ Backspace **不是删除键**（09-17 改）。它只退搜索框。
     *
     * 删除可以在设置里关掉确认框之后，这一键按下去就是真的没了 ——
     * 宿主是**硬删**，图像还会连磁盘文件一起 `unlink`，**没有撤销**。
     * 而「想删搜索词里的一个字」是高频动作，两者共用一个键迟早出事。
     * 真正删除只剩：`Delete` 键，或者修饰键路径里的 ⌘⌫ / Ctrl+⌫。
     *
     * 顺带说明为什么这个改动**不会**让搜索框里的退格失灵：焦点在搜索框时，
     * 宿主渲染层根本不转发 Backspace（只转 ←→↑↓EnterTab），那一路是框自己退格。
     * 这条分支只在焦点已经搬进插件（按过 ↑↓）时才会走到 ——
     * 我们要做的正是"替他把框里那个字退掉"（见 App.vue 的 backspaceSearch）。
     */
    case 'Backspace':
      return 'backspaceSearch'
    case 'Delete':
      return 'remove'
    case '/':
      return 'focusSearch'
    default:
      return null
  }
}
