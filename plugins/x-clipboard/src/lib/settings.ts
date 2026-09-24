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
   * 最下面那一行的形态。默认 `full`（跟以前一样）。
   *
   * 这一行本来就是「告诉你怎么用」的，用熟了就变成噪音；想极简到底的人
   * 还希望内容直接铺到窗口底边。但它**同时是「设置」唯一的鼠标入口** ——
   * 所以不能简单给个开关：关掉之后连改回来都做不到。四档就是为这个留的台阶，
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
   * 行尾常驻显示**序号**（只给前 9 行），配 `⌘1`–`⌘9` 秒贴。
   *
   * 默认关：它是给练熟了快捷键的人用的。序号**必须**跟 `⌘N` 指向同一条 ——
   * 所以它跟快捷键取的是同一份渲染列表，别另算。
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
 * 底栏的四种形态。**这是唯一一个「关掉之后就找不回来」的设置，所以它必须分档。**
 *
 * - `full` 完整：键位提示 + 「设置 / 清空」。默认，也是大多数人要的。
 * - `lean` 精简：只留右边两个入口，去掉整排键位提示。
 *   键位提示是给刚开始用的人看的，用熟了就是噪音 —— 这一档最不伤入口，去掉的东西最不值钱。
 * - `fade` 淡入：这一行**不占高度**，内容一直铺到窗口底边；
 *   鼠标贴到窗口最下面那条边时，只把「设置 / 清空」浮出来，鼠标一移开就收。
 * - `none` 全隐：彻底没有这一行，鼠标也没有入口 —— 只能按 `⌘/` 开设置。
 *
 * ⚠️ `none` 之所以敢给，是因为**键盘那条路不依赖底栏**。`⌘/` 得先在设置里做出来，
 * 别哪天觉得它没用把它删了，否则这一档会把用户锁死（改不回其他档）。
 */
export type FootMode = 'full' | 'lean' | 'fade' | 'none'

/** 合法值列一份，校验用它，别写成一串 if */
export const FOOT_MODES: readonly FootMode[] = ['full', 'lean', 'fade', 'none']

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
  // 默认完整：键位提示是给新手的，先给上；嫌吵的人自己去调
  foot: 'full',
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
  tailDel: true
}

/**
 * 只认识自己这几个键，多余的一律丢掉，缺的补默认值，不认识的值退回安全值。
 *
 * ⚠️ 默认 `true` 的项写的是 **`!== false`** 而不是 `=== true`：`tailType` / `confirmDelete` /
 * `tailFav` / `tailDel` 的默认值是 `true`，而**老版本存下来的文档里根本没有这几个键**
 * （`undefined`）。写成 `=== true` 就等于给所有老用户悄悄关掉了删除确认和行尾按钮 ——
 * 那是「加一个设置」变成了「改别人已有的行为」。只有默认 `false` 的项才写 `=== true`。
 *
 * ⚠️ `tailFav` / `tailDel` 还多一层：它们是从**老键 `tailActs`**（单个开关）拆出来的，
 * 而老文档里只有 `tailActs`。所以新键缺席时不能一律给 `true` —— 那会把当初**主动关掉**
 * 行尾按钮的人又给他打开。必须退回老键的值（`tailActs !== false`，缺键也算 `true`）。
 * 判据是"这个键**存过没有**"，所以要用 `typeof === 'boolean'` 而不是 `!== false`。
 */
export function normalizeSettings(raw: unknown): Settings {
  // 老键只在这里读一次，之后不再往外写（saveSettings 写的是整份 normalize 结果）
  const src = (raw ?? {}) as Partial<Settings> & { tailActs?: unknown }
  const legacyActs = src.tailActs !== false
  return {
    peek: src.peek === true,
    accent: ACCENT_KEYS.includes(src.accent as never) ? (src.accent as AccentMode) : 'auto',
    mark: MARK_MODES.includes(src.mark as MarkMode) ? (src.mark as MarkMode) : 'border',
    bg: BG_KEYS.includes(src.bg as never) ? (src.bg as BgMode) : 'auto',
    foot: FOOT_MODES.includes(src.foot as FootMode) ? (src.foot as FootMode) : 'full',
    confirmDelete: src.confirmDelete !== false,
    tailType: src.tailType !== false,
    tailIndex: src.tailIndex === true,
    tailSource: src.tailSource === true,
    tailFav: typeof src.tailFav === 'boolean' ? src.tailFav : legacyActs,
    tailDel: typeof src.tailDel === 'boolean' ? src.tailDel : legacyActs
  }
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
