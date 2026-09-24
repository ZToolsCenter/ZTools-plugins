/*
 * 插件自己的设置。
 *
 * 为什么存在这里：宿主**没有给插件开设置页**。
 * ZTools 那个「插件设置」菜单里只有宿主自己的开关（搜索栏推送、分离到独立窗口、开发者工具），
 * plugin.json 的 pluginSetting 也只认 single / backgroundRunning / height，
 * 插件塞不进自己的配置项。所以设置只能存在插件自己的库里（宿主按插件名隔离），
 * 界面上的入口也是插件自己画的一个小面板。
 *
 * 键名跟收藏那份（x_clipboard.favorites）分开，各存各的文档，互不干扰。
 */

/*
 * 注意这个文件里两条 import **都带 `.ts` 后缀**，别的模块都没带。
 *
 * 为什么：`tests/settings.test.ts` 要直接跑这个模块（校验 `mark` 认哪几个值、
 * 老版本存过的值读出来会不会崩），而 Node 的 ESM 解析是严格的 ——
 * 不带后缀就 `ERR_MODULE_NOT_FOUND`。**单测能跑到的模块，它自己的 import 就得写全后缀。**
 * `tsconfig.json` 已经开了 `allowImportingTsExtensions`，Vite 和 vue-tsc 都认。
 * 只被 Vite 打包、不被单测直接跑的模块，保持不带后缀的写法。
 */
import { ACCENT_KEYS, type AccentMode } from './accent.ts'
import { upsertDoc, zt } from './clipboard.ts'
import { BG_KEYS, type BgMode } from './surface.ts'

const DOC_ID = 'x_clipboard.settings'

export interface Settings {
  /**
   * 选中图片 / 内容看不全的行时，在行旁浮出一块完整内容。
   * 默认**关**：这是给「粘贴前想看清原文」的人准备的，不需要的人不该被打扰。
   */
  peek: boolean
  /** 强调色。默认跟随 ZTools 主题色，不由插件另立一套 */
  accent: AccentMode
  /** 当前行怎么标出来：只描一圈主题色（描框）/ 铺一层淡主题色底（底色）/ 整行铺满主题色（实心） */
  mark: MarkMode
  /**
   * 面板底色。默认 `auto` —— **不画底**，露出 ZTools 窗口自己的材质。
   *
   * 顶部那行（插件名 + 命令名 + ×）的底色是宿主的，插件改不了；而它其实**没画底色**，
   * 透出来的是窗口的毛玻璃。所以想跟它零色差，只能自己也别画 ——
   * 配一个相近的色号永远会差一点，而且宿主换深浅色时立刻露馅。
   */
  bg: BgMode
  /**
   * 最下面那一行的**形态**（09-24 改：只剩"形态"这一维了）。
   *
   * 里面**显示什么**不再由这一档说了算 —— 那是 `footHints` / `footButtons` 两个多选的事。
   * 形态只管"这一行在不在、占不占高度"。默认 `always`（跟以前一样）。
   *
   * ⚠️ 它同时是「设置」的鼠标入口（除非把 `footButtons` 里的「设置」取消掉），
   * 所以不能简单给个"关掉底栏"的开关：关掉之后连改回来都做不到。
   * 详见下面 `FootMode` 的说明。
   */
  foot: FootMode
  /**
   * 删除单条记录前先问一句。默认**问**（一直以来的行为，也是安全的那一档）。
   *
   * 关掉之后 Delete 直接删、不弹框 —— 弹框对键盘流是打断（要按两次才删掉一条）。
   * 代价是**没有撤销**（宿主删了就删了，图片连磁盘文件都会一起 unlink，见 REFERENCE §26.1-A），
   * 所以这一档是「我知道自己在按什么」的人用的，插件不替他做决定，摆出来让他挑。
   *
   * ⚠️ 只管「删单条」。**清空**不受这个开关影响 —— 它一次删几十上百条、还会连带
   * unlink 一批图片，那个必须问。
   */
  confirmDelete: boolean
  /**
   * 行尾常驻显示**类型标签**（文本 / 链接 / 图像 / 文件）。
   * 跟 `tailIndex` 是**多选**关系，两样可以同时开，也可以都不开（那就是行尾什么都没有）。
   */
  tailType: boolean
  /**
   * 行尾常驻显示**序号**（**本屏前 9 行**，1–9），配 `⌘1`–`⌘9` 秒贴。
   *
   * 默认关：它是给练熟了快捷键的人用的。序号**必须**跟 `⌘N` 指向同一条 ——
   * 所以它跟快捷键走同一个换算（`lib/viewport.ts` 的 `screenNumbers`），别另算。
   *
   * 09-23 起是**按屏**算的（"这一屏从上往下第几行"），不再是"列表第几条"：
   * 后者一翻页就作废 —— 第 10 条往后屏幕上不会出现任何数字，键也就跟着废了。
   */
  tailIndex: boolean
  /**
   * 行尾常驻显示**来源应用**（VSCode / Chrome / IDEA…，短名表在 `source.ts`）。
   *
   * 默认关：实测那 786 条里前两个应用占了 88%，常驻显示就是两百多行重复同样两个词。
   * 数据本身很干净（覆盖率 100%、无脏来源），所以这个开关纯粹是"要不要看"的问题，
   * 不是"能不能显示"——摆出来让需要的人自己打开。
   *
   * 跟 `tailType` / `tailIndex` 是**多选**关系；三样都不开就是行尾什么都没有。
   */
  tailSource: boolean
  /**
   * 行尾浮现的按钮里，**显示「收藏」那一颗**（鼠标划过 / 这行是当前行时浮现）。
   *
   * 跟 `tailDel` 是**多选**关系（09-21 从单个总开关 `tailActs` 拆出来的）——
   * 之前一个开关管两颗，想要"只要收藏、不要删除"做不到。
   * 两颗都不开 = 鼠标没有任何操作入口（跟以前 `tailActs: false` 一模一样），
   * 这时收藏 / 删除只剩 ⌘K 和 Delete —— 老大明确要的就是这个自由度。
   */
  tailFav: boolean
  /** 行尾浮现的按钮里，**显示「删除」那一颗**。跟 `tailFav` 多选，见上。 */
  tailDel: boolean
  /**
   * 行尾浮现的按钮里，**显示「编辑」那一颗**（09-23 加）。
   *
   * 它跟另外两颗不太一样：**只在收藏视图的文本行上出现** ——
   * 只有收藏能编辑（历史那一摊是宿主的账），只有文本有"正文"可改
   * （图片改不了那张 png，文件改路径等于"换一个文件"）。
   *
   * 关掉之后编辑**没有消失**，还剩 `⌘E`（跟 `tailFav` → `⌘K`、`tailDel` → `Delete`
   * 一个规矩：**按钮是鼠标入口，键位是并行的另一条路**，关哪一边都不该把功能关死）。
   */
  tailEdit: boolean
  /**
   * 底栏左边显示**哪几条键位提示**（09-24 加，老大提的）。
   *
   * 跟「行尾显示」一样是**多选**：一条一条挑，也可以一条都不要
   * （一条都不要 = 09-24 之前那个「精简」档的观感）。
   * 顺序跟 `FOOT_HINTS` 一致（那是唯一的定义处，面板药丸和底栏都从它读）。
   *
   * ★ 它顺带解决了一个老问题：底栏那排本来是**定宽预算**，加不下第 9 条
   *   （Windows 上 8 条只剩 9px 余量），所以 `⌘/ 设置` 和 `⌘N 新增`
   *   当时是"拿一条换一条"挤出来的。现在放不下会**换行**，两条都回来了 —— 想看到就勾上。
   */
  footHints: FootHint[]
  /**
   * 底栏右边显示**哪几个入口按钮**（09-24 加）。
   *
   * 顺序跟 `FOOT_BUTTONS` 一致（设置 / 新增 / 清空）。
   *
   * ⚠️ 三颗**都可以取消**，包括「设置」—— 取消之后开面板只剩 `⌘/`
   *   （跟 `foot: 'none'` 是同一个性质：插件不拦着，但 README 里写着这条退路）。
   *   这也是老键 `footAdd` 的归宿：当初那颗「新增按钮」开关 = 这里取消「新增」。
   * ⚠️ 「新增」那颗**只在收藏视图**渲染（跟以前一样 —— 历史那一摊是宿主的账，
   *   没什么可"新增"），所以它在底栏按钮这一组里是唯一带视图条件的。
   */
  footButtons: FootButton[]
}

/**
 * 选中行的三种标记方式。
 *
 * 前两种都是「看得出选着就行」，第三种最重：整行铺满强调色、字反白。
 * 有人就喜欢一眼认得出的实心块，插件不替用户审美 —— 摆出来让他挑。
 */
export type MarkMode = 'border' | 'tint' | 'solid'

/** 合法值列一份，校验用它，别写成一串 if */
export const MARK_MODES: readonly MarkMode[] = ['border', 'tint', 'solid']

/**
 * 底栏的**形态**（09-24 改：从四档收成三档，"显示什么"搬去了两个多选）。
 *
 * - `always` 常驻：这一行一直在，占一行高度（默认）。
 * - `fade` 淡入：这一行**不占高度**，内容一直铺到窗口底边；
 *   鼠标贴到窗口最下面那条边时浮出来，鼠标一移开就收。
 * - `none` 全隐：彻底没有这一行，鼠标也没有入口 —— 只能按 `⌘/` 开设置。
 *
 * ⚠️ **第四档「精简」已退休**（09-24，老大拍板）：它的定义就是"去掉整排键位提示"，
 *    而那件事现在等于 `footHints: []` —— 同一个意思留两个说法迟早自相矛盾。
 *    老值 `lean` 在 `normalizeSettings` 里被迁移成 `always` + 提示一颗不选（观感一模一样）。
 *
 * ⚠️ `none` 之所以敢给，是因为**键盘那条路不依赖底栏**。`⌘/` 得先在设置里做出来，
 * 别哪天觉得它没用把它删了，否则这一档会把用户锁死（改不回其他档）。
 * 同理 `footButtons` 允许把「设置」也取消 —— 那时的退路也是 `⌘/`。
 */
export type FootMode = 'always' | 'fade' | 'none'

/** 合法值列一份，校验用它，别写成一串 if */
export const FOOT_MODES: readonly FootMode[] = ['always', 'fade', 'none']

/*
 * 底栏左边那排键位提示，**一条一条选**（09-24 加，老大提的：跟「行尾显示」一样的多选）。
 *
 * ★ 这里是**唯一的定义处**：底栏渲染的先后、面板里药丸的先后、`footHints` 里存的顺序，
 *   三处都从这一个数组读。改顺序只改这里，别在另外两处各排一遍。
 *   （跟 `tailActs.values` 那条一个规矩。）
 *   ⚠️ 每条**画什么**（键帽 + 文字）不在这个文件里 —— 那是界面的事，在 `App.vue` 的
 *      `FOOT_HINT_FACE` 里，键是这里的 id。两张表分工：**这里管"有哪几条"，那边管"长什么样"**。
 *
 * ★★ **这个数组 = 界面上所有"能按"的键**（09-24 定案）。老大原话：
 *    「既然现在加了解决方案是底栏加一行来解决一行放不下的问题，那么我们系统现在有的按键
 *      都应该加进去啊」。
 *    ⇒ **别再拿"放不下"当理由删任何一条**：那排现在放不下会**换行**，行数不再是取舍依据。
 *    以后 `keys.ts` 里新增一条能在列表里用的键，**同批往这里加一条**（并去 `FOOT_HINT_FACE`
 *    写长相），否则那条键在界面上就一处都没有 —— 这正是老大提过三次的那条规矩。
 *
 *    判据：**焦点在插件里时按得动、效果发生在列表上**。据此有两类**故意不收**的：
 *      · ←→ —— 它们**只有设置面板用**（`keys.ts` 里注释写着），在列表里什么也不做，
 *        写进底栏等于骗人；面板里的键位在 README 那张「设置面板」表里；
 *      · PageDown / PageUp、⌘⌫、`/` —— 都是**已有条目的别名**（⌘↓ 翻页 / Delete 删除 /
 *        ⌘F 搜索），一句话只写一个键帽（写哪个、为什么，见 `keys.ts` 里各自的注释），
 *        README 那张表里几条路都列着。
 *
 * 15 条是怎么凑齐的：原来那排是**定宽预算**，多出来的每一条当年都是"拿一条换一条"挤掉的 ——
 * `⌘/ 设置` / `⌘N 新增` 一直是这待遇；`Esc 返回` 则是 09-23 为了塞进 `Delete 删除` 被换掉的
 * （v1.3.0 里它本来就在：`git show 61df26a2:src/App.vue` → `<span><kbd>Esc</kbd>返回</span>`）。
 * 换行上来之后"塞不下"这个理由整个失效 ⇒ 09-24 分两批全补回来：
 *   第一批 `esc`（老大盯着设置面板问「Esc返回呢」）；
 *   第二批 `copy` / `favview` / `search` / `backspace`（老大看完第一批说"应该都加进去"）。
 *
 * ⚠️ 顺序：**新增的一律往末尾加**，既有的不挪位置（面板里光标停的序号、底栏那排的先后
 *    都跟着不变）。想让它们按主题插到对应位置（⌘C 挨着「秒贴」、⌘L 挨着「收藏」…）是
 *    一次纯顺序调整、只改这一个数组 —— 但没做之前别顺手调。
 */
export const FOOT_HINTS = [
  'select',
  'page',
  'type',
  'enter',
  'paste',
  'fav',
  'edit',
  'settings',
  'add',
  'del',
  'esc',
  'copy',
  'favview',
  'search',
  'backspace'
] as const
export type FootHint = (typeof FOOT_HINTS)[number]

/**
 * ★ 提示的**默认值**：今天界面上实际显示的那 8 条（收藏视图那一份）。
 *
 * ⚠️ 「编辑」勾上、「设置」不勾 —— 这不是随口挑的：09-23 那版里这两条是**二选一**
 *    （收藏视图出「⌘E 编辑」，别的视图出「⌘/ 设置」，因为那排塞不下第 9 条）。
 *    改成独立多选之后，默认取**收藏视图**那一份，行数正好还是 8 条 ⇒ 宽度预算一点没动
 *    （这一份在 Windows 上是 589px，可用 598 —— 余 9px，跟改之前一字不差）。
 *    想要「⌘/ 设置」的人勾上就是了。
 *
 * ⚠️ 默认里**没有** `add`（`⌘N 新增`）：它跟 `edit` 一样只在收藏视图有意义，
 *    而 8 条已经是"收藏视图那一份"的宽度上限 —— 再加它就得换行。
 *    默认不换行（一行装下、跟改之前长得一样）是刻意的：想更全的人自己去勾。
 *
 * ⚠️ 默认里也**没有** 09-24 补的那几条（`esc` / `copy` / `favview` / `search` / `backspace`）——
 *    其中 `Esc 返回` 在 v1.3.0 的底栏里本来是默认显示的（09-23 起才不在）。
 *    取舍：选了"默认一字不差"这一头 ⇒ **候选 15 条，默认只勾 8 条，剩下 7 条自己勾**
 *    （09-24 起底栏放不下会换行，勾多少都不会挤掉谁）。
 *    代价说明白 —— 想让 `esc` 恢复成默认显示，**只改这一个词**（把它挪进下面这个数组）；
 *    后果是 Windows 上默认那一行折成两行（9 条 657 > 可用 598；mac 是 594，刚好压线）。
 *    ⚠️ 别为了"看起来全"把 5 条一起塞进默认：那是 13 条、三行，就不是"默认"了。
 */
export const DEFAULT_FOOT_HINTS: readonly FootHint[] = [
  'select',
  'page',
  'type',
  'enter',
  'paste',
  'fav',
  'edit',
  'del'
]

/**
 * 底栏右边那几个入口按钮，同样是多选（顺序 = 底栏里的先后）。
 *
 * ⚠️ 顺序**不是**"哪个重要"，是**底栏里从左到右**：设置（应用级）/ 新增（收藏那一摊）/
 *    清空（当前分类）。面板里的药丸、存进 `footButtons` 的数组、底栏渲染，三处同一个先后。
 * 跟 `FOOT_HINTS` 一样，这里只管"有哪几颗"，长什么样在 `App.vue` 的 `FOOT_BUTTON_FACE`。
 */
export const FOOT_BUTTONS = ['set', 'add', 'clear'] as const
export type FootButton = (typeof FOOT_BUTTONS)[number]

/*
 * 为什么这里**没有**「深浅色」设置：
 * 深浅色是宿主的事（ZTools 设置里能选），插件照做就行。给插件单开一个
 * 「强制浅/强制深」看着像贴心，实际是会出错的 —— 宿主窗口的毛玻璃底色跟着 ZTools 主题走，
 * 插件硬切成反面的话，那块面板会显得「破」了。所以 `theme.ts` 一律读宿主的 isDark，
 * 插件不再提供覆盖。（老大 09-14 复盘时也这么说：「主题设置跟随 ztools 就可以了吧」。）
 */
export const DEFAULT_SETTINGS: Settings = {
  peek: false,
  accent: 'auto',
  // 默认描框：不铺色，列表更干净；想要更醒目的人自己去换成底色
  mark: 'border',
  // 默认跟随窗口：不画底，跟顶部那行零色差，深浅色也不用我们操心
  bg: 'auto',
  // 默认常驻：键位提示是给新手的，先给上；嫌吵的人自己去调（提示本身也是多选）
  foot: 'always',
  // 底栏里**显示什么** = 下面这两份多选。默认就是 09-24 之前那一份：
  // 8 条提示 + 设置/新增/清空三颗按钮 ⇒ 升级上来的人看到的底栏一个字都没变。
  // ⚠️ 必须**复制**一份（`[...X]`）—— 直接写 `DEFAULT_FOOT_HINTS` 的话，
  //    谁改了 `DEFAULT_SETTINGS.footHints` 就把那份只读常量一起改了，而且是静默的。
  footHints: [...DEFAULT_FOOT_HINTS],
  footButtons: [...FOOT_BUTTONS],
  // 默认问一句：一直以来的行为，也是出事代价最小的那一档
  confirmDelete: true,
  // 默认只留类型标签 —— 跟改这些项之前长得一样，老用户不该被打扰
  tailType: true,
  // 序号默认关：不按 ⌘N 的人只会觉得行尾多了一列没用的数字
  tailIndex: false,
  // 来源默认关：88% 是同样两个应用，常驻反而是噪声（理由见上面 tailSource 的说明）
  tailSource: false,
  // 两颗按钮都默认开：这是鼠标唯一的操作入口，关掉之后收藏/删除就只剩键盘了。
  // （09-21 之前是一个 `tailActs` 总开关，默认也是开 —— 拆开之后默认行为一字未变。）
  tailFav: true,
  tailDel: true,
  // 编辑那颗默认也开：它只在收藏视图的文本行上出现，出现频率本来就低，不打扰谁
  tailEdit: true
}

/**
 * 只认识自己这几个键，多余的一律丢掉，缺的补默认值，不认识的值退回安全值。
 *
 * ⚠️ 默认 `true` 的项写的是 **`!== false`** 而不是 `=== true`：`tailType` / `confirmDelete` /
 * `tailFav` / `tailDel` / `tailEdit` 的默认值是 `true`，而**老版本存下来的文档里
 * 根本没有这几个键**（`undefined`）。写成 `=== true` 就等于给所有老用户悄悄关掉了删除确认和
 * 行尾按钮 —— 那是「加一个设置」变成了「改别人已有的行为」。只有默认 `false` 的项才写 `=== true`。
 *
 * ⚠️ `tailFav` / `tailDel` / `tailEdit` 还多一层：它们是从**老键 `tailActs`**（单个开关）拆出来的，
 * 而老文档里只有 `tailActs`。所以新键缺席时不能一律给 `true` —— 那会把当初**主动关掉**
 * 行尾按钮的人又给他打开。必须退回老键的值（`tailActs !== false`，缺键也算 `true`）。
 * 判据是"这个键**存过没有**"，所以要用 `typeof === 'boolean'` 而不是 `!== false`。
 *
 * ⚠️ `raw` 当成 `Record<string, unknown>` 读，**不是** `Partial<Settings>`：
 * 库里那份数据不受我们控制（老版本写的 / 手工改过的），把它声明成 `Settings` 只是自欺 ——
 * `src.footHints` 会带上 `FootHint[]` 的类型，而运行期它可能是字符串、可能没有。
 * 这里要的正是"每个键都当成未知的看"。
 */
export function normalizeSettings(raw: unknown): Settings {
  // 老键只在这里读一次，之后不再往外写（saveSettings 写的是整份 normalize 结果）
  const src = (raw ?? {}) as Record<string, unknown>
  const legacyActs = src.tailActs !== false
  /*
   * 09-23 那个老键「底栏新增按钮」的开关。09-24 它被 `footButtons` 这个多选取代，
   * 所以这里只当**迁移来源**读一次：当初主动关掉「新增」的人，不该因为加了多选
   * 又平白多出一颗回来（跟 `tailActs` → `tailFav` 是同一个规矩）。
   */
  const legacyAdd = src.footAdd !== false
  return {
    peek: src.peek === true,
    accent: ACCENT_KEYS.includes(src.accent as never) ? (src.accent as AccentMode) : 'auto',
    mark: MARK_MODES.includes(src.mark as MarkMode) ? (src.mark as MarkMode) : 'border',
    bg: BG_KEYS.includes(src.bg as never) ? (src.bg as BgMode) : 'auto',
    // 形态：老值 'full' / 'lean' 都在 `footOf` 里迁走（四档收成三档）
    foot: footOf(src.foot),
    confirmDelete: src.confirmDelete !== false,
    tailType: src.tailType !== false,
    tailIndex: src.tailIndex === true,
    tailSource: src.tailSource === true,
    tailFav: typeof src.tailFav === 'boolean' ? src.tailFav : legacyActs,
    tailDel: typeof src.tailDel === 'boolean' ? src.tailDel : legacyActs,
    // 09-23 加的**行尾按钮之一**，所以跟 `tailFav` / `tailDel` 一样退回老键 `tailActs`。
    // ⚠️ 别写成 `=== true`：那等于给所有老用户悄悄关掉编辑按钮。
    tailEdit: typeof src.tailEdit === 'boolean' ? src.tailEdit : legacyActs,
    // 底栏显示什么：两份多选，各自归一（老文档缺键 / 缺那两个键时退回"今天的样子"）
    footHints: footHintsOf(src.footHints, src.foot),
    footButtons: footButtonsOf(src.footButtons, legacyAdd)
  }
}

/**
 * 底栏**形态**归一。除了校验合法值，还负责两个老值的迁移（09-24 四档收成三档）：
 *
 * - `'full'` → `'always'`：一码事。四档里"完整"和"常驻"是同一档，收档位时留了后者这个名字。
 * - `'lean'` → `'always'`：★ 第四档「精简」退休。它的定义就是"整排键位提示一条不留"，
 *   而那件事现在 = `footHints: []` —— 于是"形态"和"显示什么"被拆开了，
 *   同一个意思不该留两个说法。**观感一字不差**（那一档本来也没有提示）。
 *   ⚠️ 光靠 `FOOT_MODES.includes` 是不够的：`'lean'` 会落到默认值 `'always'`，
 *      看起来"对"了，但 `footHints` 那边必须同时知道"这人当初选的是精简"
 *      （否则会给他补回 8 条提示 —— 那就把升级变成了"改别人已有的行为"）。
 *      所以 `footHintsOf` 也读原始值，两处一起才算迁完。
 */
function footOf(raw: unknown): FootMode {
  if (raw === 'full' || raw === 'lean') return 'always'
  return FOOT_MODES.includes(raw as FootMode) ? (raw as FootMode) : 'always'
}

/**
 * 把存下来的数组收成一份合法的 `FootHint[]`。
 *
 * 三条规矩（跟别处的多选一致）：**认不出的丢掉、重的去重、顺序按定义数组**。
 * 后两条靠 `FOOT_HINTS.filter(...)` 一次做完 —— 输出天然有序、天然无重复。
 *
 * ⚠️ `Array.isArray` 不是多余的严谨：库里可能存着老版本写的 `"fav"` 这种字符串，
 *    `.includes` 在字符串上会命中文档里的字符（`'fav'.includes('fav')` 是 true！），
 *    于是它"看起来能用"，实际存进去的东西根本不是数组。
 */
function footHintsOf(raw: unknown, footRaw: unknown): FootHint[] {
  if (Array.isArray(raw)) return FOOT_HINTS.filter((h) => raw.includes(h))
  // 没存过（或者存成了别的形状）⇒ 默认那 8 条；
  // 但当初选「精简」档的人要**一条都不给**（那是那一档的全部意义）
  return footRaw === 'lean' ? [] : [...DEFAULT_FOOT_HINTS]
}

/**
 * 把存下来的数组收成一份合法的 `FootButton[]`。规矩同上。
 *
 * ⚠️ 老键 `footAdd` 在这里落地：新键缺席时默认三颗都在，但**当初主动关掉「新增」的人**
 *    要把 `'add'` 去掉 —— 判据跟 `tailActs` 那条一样是"存过没有"（`!== false`）。
 * ⚠️ 新键在的时候老键一个字都不算（`footButtons` 说了算），跟 `tailFav` 那条同一个规矩。
 */
function footButtonsOf(raw: unknown, legacyAdd: boolean): FootButton[] {
  if (Array.isArray(raw)) return FOOT_BUTTONS.filter((b) => raw.includes(b))
  return FOOT_BUTTONS.filter((b) => b !== 'add' || legacyAdd)
}

export async function loadSettings(): Promise<Settings> {
  try {
    const doc = (await zt().db.promises.get(DOC_ID)) as { data?: unknown } | null
    return normalizeSettings(doc?.data)
  } catch (err) {
    console.error('[x-clipboard] 读取设置失败', err)
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * 存设置。返回「是否真的写进去了」。
 *
 * ⚠️ 必须走 `upsertDoc`（它会把库里那份的 `_rev` 带上）——
 * 09-15 这里原来直接 `put({ _id, data })`，结果是**只有第一次能写进去**，
 * 之后每次都被宿主的 rev 校验拒掉，而且宿主只 resolve 一个失败对象、不抛异常，
 * 静默丢数据（老大报的「设置重启就没了」就是这个）。详见 `clipboard.ts` 里 `upsertDoc`。
 */
export async function saveSettings(next: Settings): Promise<boolean> {
  const res = await upsertDoc(DOC_ID, () => ({ data: next }))
  return res.ok
}
