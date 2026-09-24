<script setup lang="ts">
/*
 * x-clipboard —— 整个界面。
 *
 * 只有几块东西：列表、按需浮出的详情、右下角几个极淡的入口（设置 / 新增 / 清空历史）、
 * 以及弹出来的确认框与输入浮层。
 * 没有分类栏、没有复选框、没有来源/时间/字符数、没有常驻按钮。
 * 分类（全部 / 文本 / 图像 / 文件 / 收藏）走 Tab / ⇧Tab 循环，都不占版面。
 *
 * 详情是**浮层**（`.peek`），不是插进列表里的一行：
 * 插进去会把下面的行全推走，上下键一按列表就跳；浮层不碰布局，选中项一变就收掉。
 */

import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import {
  clearHistory,
  deleteItem,
  fetchHistory,
  fileThumbSrc,
  imageSrc,
  matchClip,
  zt,
  type ClipContent,
  type ClipItem,
  type ClipType
} from './lib/clipboard'
import { rowText, splitHighlight, type Seg } from './lib/highlight'
import { copyOne as copyToClipboard, pasteOne } from './lib/payload'
import {
  addFavorite,
  addManualFavorite,
  clearFavorites,
  favKeyOf,
  findFavorite,
  loadFavorites,
  removeFavorite,
  updateFavoriteText,
  type FavItem
} from './lib/favorites'
import { ACCENT_KEYS, accentSwatch } from './lib/accent'
import { BG_PRESETS, resolveBg } from './lib/surface'
import { pasteSlot, resolveKey } from './lib/keys'
import { firstRowAt, screenNumbers, slotRowIndex } from './lib/viewport'
import { modKey } from './lib/platform'
import {
  cursorOf,
  movePatch,
  moveRow,
  moveSlot,
  rowIndex,
  toggleAt,
  toggleMember,
  type Cursor
} from './lib/panel'
import { peekGeom, peekKindOf, type PeekGeom, type PeekKind } from './lib/peek'
import {
  backspaceQuery,
  catOf,
  cycleCat,
  TYPE_LABEL,
  labelOf,
  parseQuery,
  prefixOf,
} from './lib/query'
import { resolveSelection } from './lib/selection'
import {
  DEFAULT_SETTINGS,
  FOOT_BUTTONS,
  FOOT_HINTS,
  loadSettings,
  saveSettings,
  type FootButton,
  type FootHint,
  type FootMode,
  type MarkMode,
  type Settings
} from './lib/settings'
import { sourceLabel } from './lib/source'
import { applyTheme, isDark } from './lib/theme'

type View = 'history' | 'favorites'

/** 设置面板里「选中项」那三个按钮。写在一处，模板只管循环 */
const MARK_CHOICES: readonly { v: MarkMode; label: string }[] = [
  { v: 'border', label: '描框' },
  { v: 'tint', label: '底色' },
  { v: 'solid', label: '实心' }
]

/** 设置面板里「底栏」那三个按钮（**形态**：这一行在不在 / 占不占高度）。
 *  ⚠️ 09-24 四档收成三档：「精简」退休，它的意思现在是「底栏按键提示」一条都不选。
 *  老值 'full' / 'lean' 由 `lib/settings.ts` 的 `footOf()` 迁成 'always'。 */
const FOOT_CHOICES: readonly { v: FootMode; label: string }[] = [
  { v: 'always', label: '常驻' },
  { v: 'fade', label: '淡入' },
  { v: 'none', label: '全隐' }
]

/*
 * 底栏那两排东西**长什么样**（键帽 + 文字 / 按钮名）。
 *
 * ⚠️ 这两张表只管长相，**有哪几个**在 `lib/settings.ts` 的 `FOOT_HINTS` / `FOOT_BUTTONS` 里
 *    （顺序也由它定）。分成两处是因为"加一条提示"和"这条提示怎么画"是两件事，
 *    但两张表的**键必须一一对应** —— 少一个，那一格会渲染成 `undefined`
 *    （不报错，界面上就是一段空白），所以 `tests/styles.test.ts` 会对着 id 扫一遍。
 * ★ `mod: true` = 这个键帽要带修饰键（`modKey()` 按平台给 ⌘ / Ctrl）。
 *   不带的（↑↓ / Tab / Enter / Delete / Esc / Backspace）两个平台写法一样，别顺手也套上 modKey。
 */
const FOOT_HINT_FACE: Record<FootHint, { mod?: true; key: string; label: string }> = {
  select: { key: '↑↓', label: '选择' },
  page: { mod: true, key: '↓', label: '翻页' },
  type: { key: 'Tab', label: '分类' },
  enter: { key: 'Enter', label: '粘贴' },
  // ⚠️ 秒贴的键帽是 **`1–9`**（`⌘1–9` / Windows `Ctrl+1–9`）—— 整串都在键帽里，
  //    09-24 从旧模板搬进这张表时**漏过那个 `–9`**（渲染成「⌘1 秒贴」），老大真机一眼看出来。
  //    写成 `⌘1–⌘9` 光这一个键帽就 112px，Windows 那排本来就最紧（见下面底栏那段注释）。
  paste: { mod: true, key: '1–9', label: '秒贴' },
  fav: { mod: true, key: 'K', label: '收藏' },
  edit: { mod: true, key: 'E', label: '编辑' },
  settings: { mod: true, key: '/', label: '设置' },
  add: { mod: true, key: 'N', label: '新增' },
  del: { key: 'Delete', label: '删除' },
  /*
   * ★ `Esc 返回`（09-24 补回候选表）。
   *
   * v1.3.0 的底栏里本来就有它（`<span><kbd>Esc</kbd>返回</span>`），09-23 加
   * 「Delete 删除」时因为那排是**定宽预算**，把它"拿一条换一条"换掉了。
   * 现在放不下会换行 ⇒ 换掉它的理由没了；老大 09-24 盯着设置面板问「Esc返回呢」，
   * 于是补成第 11 条候选（当时排在最末、既有的 10 条一条都不挪位置 —— 09-24 第二批又往
   * 后接了 4 条，它就不是末位了；顺序规则见 `lib/settings.ts` 的 `FOOT_HINTS`）。
   *
   * ⚠️ 它**不在** `DEFAULT_FOOT_HINTS` 里（默认不勾）：取舍和"怎么改回去"写在
   *    `lib/settings.ts` 那个数组的注释里。别看见它是灰的就以为"没给全"。
   * ⚠️ 跟 `edit` / `add` 不同，它**不挑视图** —— Esc 阶梯（清关键词 → 清分类 → 关插件）
   *    在所有视图里都一样，所以 `HINT_VIEW_ONLY` 里没有它。
   * ⚠️ 这里的 `返回` 是**一步退**的意思，不是"回上一页"：词没退光就退词、词空了退分类、
   *    都没有了才关插件。label 沿用 v1.3.0 那两个字的写法，改文案前先看 README 那张表。
   */
  esc: { key: 'Esc', label: '返回' },
  /*
   * ★ 下面 4 条是 09-24 **第二批**补的（老大：「既然现在加了解决方案是底栏加一行来解决一行
   *   放不下的问题，那么我们系统现在有的按键都应该加进去啊。包括你说的 cmd+L 和 cmd+C」）。
   *   到这一批为止，**界面上所有"焦点在插件里时按得动、效果发生在列表上"的键都在候选表里了**
   *   （判据和"故意不收的那几条"写在 `lib/settings.ts` 的 `FOOT_HINTS` 注释里）。
   */
  /*
   * 复制：`⌘C` —— **只复制、不粘贴、窗口不关**（跟 Enter 粘贴 是一对）。
   *
   * ⚠️ 它跟系统的"复制选中文字"同名不同事，所以这条提示比别的更有必要：
   *    在列表里按 ⌘C 是把**当前这一条**写回剪贴板，不是复制你选中的那几个方块字。
   * ⚠️ 前提跟 ⌘K / ⌘E / ⌘N 一样：**焦点得先在插件里**（先按一次 ↑↓ 或点过列表）。
   */
  copy: { mod: true, key: 'C', label: '复制' },
  /*
   * 收藏夹：`⌘L` —— 一步跳到「收藏」，再按一次退回「全部」（`toggleFavoritesView`）。
   *
   * ⚠️ 文案是「收藏夹」不是「收藏」：**`⌘K` 已经占了「收藏」那个词**（它是对当前这条的
   *    动作），而 `⌘L` 换的是**视图**。两个都叫「收藏」，底栏上就会并排出现两个「收藏」。
   *    想换文案（「切收藏」/「收藏视图」…）改这一个词即可，它是这一排里最长的一条之一（3 字）。
   */
  favview: { mod: true, key: 'L', label: '收藏夹' },
  /*
   * 搜索：`⌘F` —— 把焦点交回搜索框。
   *
   * ⚠️ 它还有一条路是**裸 `/`**（`keys.ts` 的 `case '/'`）。提示里只写 `⌘F`：
   *    跟 `⌘↓` 之于 `PageDown` 同一个规矩 —— **只写那个更好的**。两条路的可用条件其实
   *    一样（都得焦点在插件里），`⌘F` 是"找"的通用键、还能走 `modKey()` 给 Windows 出
   *    `Ctrl+F`，比一个裸斜杠好认。两条 README 那张表里都列着。
   */
  search: { mod: true, key: 'F', label: '搜索' },
  /*
   * 退格：`Backspace` —— **只退搜索框，不删数据**（造这个分歧的是 09-17 那条改动：
   * 删除改走 Delete，Backspace 专心退词）。
   *
   * ⚠️ 文案是「退格」而不是「删除」：这两个键在这插件里是**两件完全不同的事**，
   *    底栏上并排写着「退格」和「删除」，用户才分得清哪个是退词、哪个是删数据。
   * ⚠️ 它是这一排里键帽最长的（`Backspace` 9 个字母），键帽宽度约 62px —— 无所谓，
   *    现在放不下会换行。
   */
  backspace: { key: 'Backspace', label: '退格' }
}

const FOOT_BUTTON_FACE: Record<FootButton, string> = {
  set: '设置',
  add: '新增',
  // ⚠️ 面板里的名字恒是「清空」；底栏上那颗的文案随分类变（清空历史 / 清空收藏…），
  //    那是 `clearLabel` 的事，别把两者合成一个。
  clear: '清空'
}

/*
 * ★ 只在**收藏视图**里有意义的提示。
 *
 * 「编辑」只在收藏视图能用（历史那一摊是宿主的账，改不了），「新增」同理。
 * 这跟底栏那颗「新增」按钮是**同一个口径**（它的 `v-if` 里就写着 `view === 'favorites'`）：
 * **这儿没有的东西，界面上就不写**。不然底栏会在历史视图里教人按一个按不出反应的键。
 *
 * ⚠️ 这是"多选"里唯一一处"勾了也可能不显示"的地方 —— 别把它当成 bug 抹掉：
 *    抹掉就等于界面开始撒谎（底栏写着 ⌘E 编辑，按下去什么都不发生）。
 */
const HINT_VIEW_ONLY: Partial<Record<FootHint, View>> = { edit: 'favorites', add: 'favorites' }

/**
 * 「淡入」档下，鼠标离窗口底边多近才算「贴到底了」的**兜底**值。单位 px。
 *
 * ★ 09-24 的修正：这个判定范围**必须是底栏当下真实的高度**（见 `footH` / `measureFoot`），
 *   写死一个数只在"底栏恒为一行"时成立。现在放不下会**换行**，底栏可能是两三行高，
 *   拿 30 去判就等于"只盖住第一行"—— 鼠标停在第二行上时底栏反而收起来了（自己跟自己打架）。
 *   所以底下那个数只剩"还没量过 / 底栏不在"时的兜底，真值每次量。
 *   原来的 30 是这么来的：一行底栏约 29px（4 + 16 + 9 的 padding）。
 */
const FOOT_REVEAL_FALLBACK = 30

/** 底栏这一行**量出来的**高度。`onPointerMove` 的判定用它，别再写死 */
const footH = ref(FOOT_REVEAL_FALLBACK)

const footRef = ref<HTMLElement | null>(null)

/**
 * 量一次底栏高度（含 padding）。底栏没挂载（「全隐」档）时留着上一次的数 —— 无所谓，
 * 那一档根本不走浮现判定，而切回「淡入」时会被那个 watcher 重新量一遍。
 */
function measureFoot(): void {
  const el = footRef.value
  if (el) footH.value = el.getBoundingClientRect().height
}

/*
 * 列表里的一行。历史用宿主 id 当键，收藏用收藏自己的 id —— 两者渲染完全一样。
 *
 * `text` / `seg` / `label` / `favored` 是**算好放在这儿的**，不是渲染时才现算。
 * 原因：模板里写 `{{ previewText(row.data) }}`、`isFavored(row.data)` 这种**函数调用**，
 * 意味着**每次重渲染都要对每一行重跑一遍** —— 按一下 ↑↓ 就是全表重算，
 * 而 `favKeyOf` 对文本项要拼**整个正文**、`labelOf` 要对正文跑整串正则、
 * `rowText` + `splitHighlight` 要扫一遍正文再切片段。
 * 现在这些成本只发生在 `rows` 重算时（列表内容变了），且收藏判重走 Set 是 O(1)。
 */
interface Row {
  key: string
  data: ClipContent
  item?: ClipItem
  /**
   * 行里显示的那一行字（文本已折叠空白、图片显示尺寸、文件显示名）。
   * ⚠️ 搜索时它**不是** `previewText` 的原样输出 —— 命中在看不见的地方时会被前移（`rowText`）。
   */
  text: string
  /**
   * 上面那行字**切好的片段**，命中的那些 `hit` 为真，模板据此铺底色。
   *
   * ⚠️ 渲染用片段数组、**不用 `v-html`**：剪贴板内容是不可信的
   *    （从网页复制来的东西本身就是一段 HTML）。
   */
  seg: Seg[]
  /**
   * 行首那格要不要显示**真缩略图**，要就给出 URL，不要就是空串（那一格走图标）。
   *
   * 两种来源打平成一个字段：
   *   · `type === "image"` —— 宿主存的图（`imageSrc`）；
   *   · `type === "file"` —— **单个且扩展名是图片**的文件（`fileThumbSrc`）。
   *
   * ⚠️ 后者纯粹是**显示层的让步**，别把它读成"文件变成图片了"：宿主判类型看的是剪贴板
   *    上放的是文件还是位图，不看扩展名（复制一个 `.png` 文件永远是 `file`，插件的类型
   *    标签也照旧写「文件」、按 Tab 到「图像」照样看不见它）。这里只是"既然路径就在手里，
   *    那就把图标换成长相"，判定逻辑全在 `lib/clipboard.ts` 的 `fileThumbSrc`。
   *
   * 空串同时也是"这一行没有可显示的图"的唯一说法 —— 模板里 `row.thumb &&` 就是它兜底。
   */
  thumb: string
  /**
   * 来源应用的短名（`VSCode` / `Chrome`…），**没有来源就是 `null`**（那一格不渲染）。
   * 老数据和老收藏里没有 `appName`，所以这里必须是「可能为空」而不是空串。
   */
  source: string | null
  /** 行尾类型标签：文本 / 链接 / 图像 / 文件 */
  label: string
  /** 这条在不在收藏里（收藏视图里恒为 true） */
  favored: boolean
}

/*
 * ⚠️ 这里用 `shallowRef` 而不是 `ref`，是**故意的**。
 *
 * `ref([])` 会把数组里**每一层的每个对象/数组**都递归包成 Proxy（连 `files[]` 里每个
 * 文件对象、每条记录的每个字段都建依赖表）。而我们对这两份数据的使用方式是
 * **整体替换**（`items.value = await fetchHistory(...)`），从来不原地改某一条的字段 ——
 * 那些 Proxy 一次都不会被用到，纯粹是常驻内存和写入时的开销。
 *
 * 浅响应式下「整体换数组」照样触发更新（换的是 `.value` 本身），行为完全一致。
 * 如果哪天要原地改某条记录（比如改 `brokenThumbs` 那种），记得改回 `ref` 或手动 trigger。
 */
const items = shallowRef<ClipItem[]>([])
const favorites = shallowRef<FavItem[]>([])
const keyword = ref('')
const activeKey = ref('')
const brokenThumbs = ref<Set<string>>(new Set())

/*
 * 下一次 syncSelection 要不要**强制**落回第一条。
 *
 * 为什么需要它、以及「范围变了落顶部 / 只是刷新就原地不动」这两条规则的来龙去脉，
 * 都写在 lib/selection.ts 里。这里只记一句：切分类切回「全部」时旧选中项还活着，
 * 光靠「当前项没了才落回第一条」是修不掉的。
 */
let pinToTop = false

const listRef = ref<HTMLElement | null>(null)
const rootRef = ref<HTMLElement | null>(null)
const confirmBox = ref<{ text: string; danger: boolean; run: () => void } | null>(null)

/*
 * 「淡入」档的底栏现在该不该露出来。判定在 `onPointerMove`（不是给底栏挂 hover，
 * 为什么见 `.foot.fade` 那段样式）。平时恒 false —— 其他三档根本不看它。
 */
const footRevealed = ref(false)

/* ------------------------------------------------------------------ 行尾

 *
 * 行尾那一格有两样东西是**跟着设置走**的：
 *   · `actsShown` —— 收藏 / 删除两颗按钮开着几颗（0 / 1 / 2）。模板靠它决定要不要
 *     给按钮留位、以及留**几颗**的位（`.tail-acts` / `.tail-acts-one`）。
 *   · `favFlash` —— 快捷键收藏之后那一颗「行内瞬时星」的落点。
 *
 * ⚠️ 瞬时星**只在行尾没有收藏按钮（`tailFav` 为假）时才出现**（老大 09-21 定的）：
 *    按钮开着的时候它自己会立刻点亮 / 熄灭，再闪一颗就是同一句话说两遍。
 *    删除**不做**退场动画 —— 数据当场就没了，用户看得出来成功了。
 */

/**
 * 行尾按钮这一格**要留几颗的位**（0 / 1 / 2 / 3）。
 *
 * ★ 收藏视图里文本行还可能多一颗「编辑」（09-23 加，可以在设置里关）——
 *   这里**按最多的情况留位**，不是按每一行实际渲染几颗：要真按实际算，
 *   文本行三颗、图片/文件行两颗，两种行的行尾宽窄不一，`.t` 的右边界就参差了。
 *
 * ⚠️ 那句 `+ 1`（编辑那颗）**不能写成"先判 n > 0"**：三颗全关时 n 本来是 0，
 *    可编辑那颗照样会渲染 —— 那它就**没有被留位**（`.acts` 是绝对定位的），
 *    会直接压在行尾的类型标签上。
 */
const actsShown = computed(() => {
  const n = (settings.value.tailFav ? 1 : 0) + (settings.value.tailDel ? 1 : 0)
  const edit = view.value === 'favorites' && settings.value.tailEdit ? 1 : 0
  return n + edit
})

/** 瞬时星亮多久。⚠️ 跟样式里 `@keyframes fav-flash` 的时长是**同一个数**（`styles.test.ts` 钉着） */
const FAV_FLASH_MS = 1100

/**
 * 瞬时星：落在哪一行、第几次。
 *
 * `n` 是给模板当 `:key` 用的：同一条连着按两次（收藏 → 取消）时元素并没被卸载，
 * CSS 动画不会自己重播 —— 换掉 key 才会真正重建一个，动画从头来。
 */
const favFlash = ref<{ key: string; n: number } | null>(null)

let favFlashTimer: number | undefined

/** 让某一行闪一颗星。同一行连按只把它续上（并重播动画），不会叠出第二颗 */
function flashFavorite(key: string): void {
  window.clearTimeout(favFlashTimer)
  favFlash.value = { key, n: favFlash.value?.key === key ? favFlash.value.n + 1 : 1 }
  favFlashTimer = window.setTimeout(() => {
    favFlash.value = null
  }, FAV_FLASH_MS)
}

/* ------------------------------------------------------------------ 浮层

 * 现在只剩两个浮层，**都不需要 JS 定位**：
 *   · `.box` 确认框 —— **居中**，靠 `.mask` 的 flex 钉死。
 *     它以前是"跟着鼠标弹、下面不够翻上方"，量尺寸的算术在 `lib/popover.ts`；
 *     09-17 老大要求改成居中之后，那套「先 `visibility:hidden` 渲染一帧、量完再放出来」
 *     的两步流程整个用不上了 —— 连带 `popover.ts` 一起删掉，**别再把它加回来**。
 *   · `.peek` 详情浮层 —— 用 `bottom` 定位，不依赖自己的高度。
 *   （`.sheet` 设置面板贴在窗口右边一整条，由 CSS 钉死，从来不用量。）
 */

/* ---------------------------------------------------------------- 详情浮层 */

/**
 * 浮层的落位。坐标全部相对 `.root`：
 *   dir === 'down' —— 贴在行的下边，用 offset 当 top
 *   dir === 'up'   —— 下方塞不下，翻到行的上边，用 offset 当 bottom
 * 用 bottom 而不是算好的 top，是为了不依赖浮层自己渲染完的高度。
 *
 * 落位算术本身在 `lib/peek.ts` 的 `peekGeom`（纯函数、有测试）——
 * 只管量三个矩形，规则和踩过的坑都写在那儿。这里只负责量。
 */
interface PeekBox extends PeekGeom {
  key: string
  kind: PeekKind
}

const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
const settingsOpen = ref(false)
const peek = ref<PeekBox | null>(null)

/*
 * 「新增 / 编辑收藏」那块输入浮层。
 *
 * 形状是老大 09-23 定的口径：**两个动作都弹出一个小框来输入，不做行内编辑** ——
 * 原话「因为每一项可能展示不全。弹框能展示全」。所以输入区是 `textarea`（会折行），
 * 不是单行 `input`（单行只能横向滚，长的照样看不全），而且高度跟着内容长（`fitComposer`）。
 *
 * `null` = 没开；`mode` 决定标题和保存时走哪条路。
 * `favId` 只在 `edit` 时有 —— 它同时就是**那一行的 key**（收藏视图里 `makeRow` 用的正是它）。
 */
const composer = ref<{ mode: 'new' | 'edit'; favId?: string } | null>(null)
/** 输入框里的草稿 */
const composerText = ref('')
const composerRef = ref<HTMLTextAreaElement | null>(null)

/* ---------------------------------------------------------------- 派生数据 */

const query = computed(() => parseQuery(keyword.value))

/*
 * 当前分类。**认前缀只在这里认一次** ——
 * 视图、清空文案、Esc 该退哪一层、是否吃关键词，全从这个 computed 上取。
 *
 * 原来 `view` 和 `clearLabel` 各是一个 computed、各自 `catOf(keyword.value)` 一遍，
 * 再加上 `query` 里那次 `parseQuery` —— 同一个前缀每敲一个字要认三遍。
 * 收成一个之后，正则只跑一次，而且「当前在哪个分类」只有一处定义，不会哪天两处对不上。
 */
const cat = computed(() => catOf(keyword.value))

/*
 * 视图**不是**一个独立状态，它是从搜索框前缀算出来的 ——
 * `收藏:` 就是收藏视图，其余四个前缀都是历史视图（各自带不带类型过滤由 rows 决定）。
 *
 * 这么算而不是各存一份，是因为「前缀是分类的唯一真相」：两份状态迟早会对不上
 * （改了一处忘了另一处，搜索框写着 `全部:` 却在看收藏）。算出来就不会。
 */
const view = computed<View>(() => (cat.value === 'favorites' ? 'favorites' : 'history'))

/**
 * 收藏行的可搜索文本：正文 / 预览 / 文件名与路径，拼一起，大小写不敏感。
 *
 * 算一次记住（按对象缓存）：改一个字符它会被**每条收藏各算一遍**，而这里 `toLowerCase()`
 * 是全串的、还会 `map + join`。收藏对象同样是"整体替换、绝不原地改字段"
 * （增删都是 `favorites.value = await add/removeFavorite(...)`），所以缓存不会失效。
 */
const favHayCache = new WeakMap<FavItem, string>()

function favHaystack(f: FavItem): string {
  let hit = favHayCache.get(f)
  if (hit === undefined) {
    const files = (f.files ?? []).map((x) => `${x.name} ${x.path}`).join(' ')
    hit = `${f.content ?? ''} ${f.preview ?? ''} ${files}`.toLowerCase()
    favHayCache.set(f, hit)
  }
  return hit
}

/*
 * 列表内容。两个视图各一份数据，**没有任何置顶** ——
 * 历史按粘贴时间倒序，收藏按收藏时间倒序，都只遵循"新的在上面"这一条。
 *
 * 收藏不掺进历史里是有意的：收藏攒到二三十条，要是压在「全部」顶上，
 * 每粘一次新内容都得往下滚一大截。找收藏就走 Tab 切到「收藏」那一站（或 ⌘L）。
 */
/*
 * 收藏键集合。判「这行收没收藏」做成 **O(1) 查表** ——
 * 原来是每行 `favorites.value.some(f => favKeyOf(f) === key)`，而 `favKeyOf`
 * 对文本项返回的是 `text:` 拼**整个正文**：1000 行 × 收藏数，每次都要新建几百个大字符串。
 * 而且模板里一行调两遍（class 和 title 各一次），成本再翻倍。
 * 现在每条收藏的键只算一次、装进 Set。
 */
const favKeys = computed(() => new Set(favorites.value.map(favKeyOf)))

/**
 * 把一条数据包成一行：显示用的几样在这一次算完，渲染时直接取。
 *
 * `kw` 是搜索关键词 —— 命中靠后时 `rowText` 先把它前移到看得见的位置，再切成片段。
 * 没有关键词时 `rowText` 原样返回 `previewText` 的结果、`splitHighlight` 返回一整段，
 * 整个功能等于没开（加高亮之前是什么样，现在就还是什么样）。
 */
function makeRow(
  base: { key: string; data: ClipContent; item?: ClipItem },
  favored: boolean,
  kw: string
): Row {
  const text = rowText(base.data, kw)
  return {
    ...base,
    text,
    seg: splitHighlight(text, kw),
    // 图片记录走 `imageSrc`，图片扩展名的文件走 `fileThumbSrc`，两者都可能给空串
    thumb: base.data.type === 'image' ? imageSrc(base.data) : fileThumbSrc(base.data),
    source: sourceLabel(base.data),
    label: labelOf(base.data),
    favored: favored || favKeys.value.has(favKeyOf(base.data))
  }
}

const rows = computed<Row[]>(() => {
  if (view.value === 'favorites') {
    const kw = query.value.text
    const q = kw.trim().toLowerCase()
    // 收藏视图里每一行本来就是收藏，不用再查一遍表
    return [...favorites.value]
      .sort((a, b) => b.addedAt - a.addedAt)
      .filter((f) => !q || favHaystack(f).includes(q))
      .map((f) => makeRow({ key: f.favId, data: f }, true, kw))
  }
  const want = query.value.type
  const kw = query.value.text
  /*
   * ★ 关键词在这里**本地过滤**，不再交给宿主搜。
   *   `items.value` 本来就是一次取回的全量（`PAGE_SIZE` = 宿主库上限），
   *   所以本地过滤和宿主过滤是同一个集合 —— 结果一致，但省掉每敲一个字符的全量往返。
   *   匹配规则在 `lib/clipboard.ts` 的 `matchClip`（照宿主复刻，改之前先回去核对）。
   */
  return items.value
    .filter((i) => (!want || i.type === want) && matchClip(i, kw))
    .sort((a, b) => b.timestamp - a.timestamp)
    .map((i) => makeRow({ key: i.id, data: i, item: i }, false, kw))
})

/**
 * 按 key 找一行。
 *
 * 这里原来挂着一个 `rowMap` computed（把 rows 建成 Map，好让查找是 O(1)）——
 * 但真正用它的只有"当前行"和"悬停的那一行"两处，**都是用户动作触发的稀有路径**，
 * 代价却是**每次 rows 变化都要建一个 n 条目的 Map**（改关键词时每敲一个字一次，
 * 1000 条 = 1000 次 Map 插入 + 1000 个子数组）。换来的只是稀有路径上少扫一遍数组 —— 亏的。
 * 现在当场 find：常态零成本，稀有路径 O(n)，等价于原来的结果。
 */
function findRow(key: string): Row | null {
  return rows.value.find((r) => r.key === key) ?? null
}

const activeIndex = computed(() => rows.value.findIndex((r) => r.key === activeKey.value))
const activeRow = computed(() => findRow(activeKey.value))

/** 浮层里要显示的那一行 */
const peekRow = computed(() => (peek.value ? findRow(peek.value.key) : null))

const peekStyle = computed(() => {
  const p = peek.value
  if (!p) return {}
  const style: Record<string, string> = {
    left: `${p.left}px`,
    width: `${p.width}px`,
    maxHeight: `${p.maxH}px`
  }
  if (p.dir === 'down') style.top = `${p.offset}px`
  else style.bottom = `${p.offset}px`
  return style
})

/** 图片要自己限高：光靠容器限高会撑出滚动条，明明能整张放下却要滚 */
const peekImageStyle = computed(() => ({ maxHeight: `${(peek.value?.maxH ?? 200) - 18}px` }))

const emptyText = computed(() => {
  if (view.value === 'favorites') {
    return query.value.text.trim() ? '没有匹配的收藏' : '还没有收藏'
  }
  const { type, text } = query.value
  const what = type ? TYPE_LABEL[type] : ''
  if (text.trim()) return type ? `没有匹配的${what}内容` : '没有匹配的内容'
  if (type) return `还没有${what}内容`
  return '剪贴板还是空的'
})

/*
 * ───────────────────────── 渲染窗口 ─────────────────────────
 *
 * 数据是**全量**的（分类过滤要靠它，不能只留前几页），
 * 但**没必要把 1000 行 DOM 全建出来** —— 这是本插件里最大的一块常驻内存：
 * 1000 行 × 十来个元素 ≈ 一万个 DOM 节点，每个都带样式和布局对象，
 * Chromium 侧的代价**远大于**我们那点 JS 数据（记录里只有文本和路径，图片在磁盘上）。
 *
 * 所以只渲染前 `renderLimit` 行，滚到快见底再放一批。
 * 键盘走到窗口之外由 `ensureRendered()` 兜（不然 ↑↓ 会走到一个还没渲染出来的行上，
 * `scrollIntoView` 找不到元素，表现就是"按了没反应"）。
 */
const RENDER_STEP = 120
/** 触底前多少像素就放出下一批，免得滚到底那一帧看见空白 */
const RENDER_LOOKAHEAD = 400

const renderLimit = ref(RENDER_STEP)
const visibleRows = computed(() => rows.value.slice(0, renderLimit.value))

/** 键盘要走到窗口外面去，先把那一行放出来 */
function ensureRendered(index: number): void {
  if (index >= renderLimit.value) renderLimit.value = index + 1
}

/** 滚到快见底就把下一批放出来。列表是往下长的，放完 scrollHeight 变大，不会自己循环 */
function growRenderWindow(): void {
  const el = listRef.value
  if (!el || renderLimit.value >= rows.value.length) return
  const rest = el.scrollHeight - el.scrollTop - el.clientHeight
  if (rest < RENDER_LOOKAHEAD) {
    renderLimit.value = Math.min(rows.value.length, renderLimit.value + RENDER_STEP)
  }
}

/*
 * ───────────────────────── 屏首 ─────────────────────────
 *
 * `⌘1`–`⌘9` 和行尾那枚序号都**按屏**算（09-23 改）：
 * `⌘N` = 你现在看得见的这一屏里，从上往下第 N 行。
 *   ⚠️ 这里的 N 是**数字**（就是 `⌘1`–`⌘9` 那排）；09-24 又加了个**字母** `⌘N`（新增收藏），
 *      两个含义撞了同一个写法 —— 读到这儿别混（那条在 `addActive()` 上面）。
 *
 * 以前取的是「列表第 N 条」那种绝对序号 —— 一翻页就作废：屏幕上的行既没有编号、
 * 也没有能粘它的键（列表第 13 条往后 `⌘1` 永远指向屏外），键和眼睛看到的东西脱钩。
 *
 * `screenTop` 是这一屏第一行在 `rows` 里的下标，**滚动时它会变**。
 * 全插件只有这一处"滚动会改快捷键含义"，别再另算第二份。
 */
const screenTop = ref(0)

/**
 * 量一次屏首。判定 =「底边越过视口上沿」—— **被上沿切掉半行的那一行也算屏首**，
 * 跟 `pageMove()` 量翻页基准用的是同一句。两处必须同口径：不然翻完页按 ⌘1
 * 粘到的不是屏幕上第一行。
 *
 * 怎么找在 `lib/viewport.ts` 的 `firstRowAt()` 里（二分 + 单测），这里只负责把 DOM 量给它。
 */
function measureFirstRow(): number {
  const list = listRef.value
  if (!list) return 0
  const els = list.querySelectorAll<HTMLElement>('.row')
  if (!els.length) return 0
  const box = list.getBoundingClientRect()
  return firstRowAt(els.length, (i) => els[i].getBoundingClientRect().bottom > box.top + 1)
}

/**
 * 重采一次**屏首**。凡是会让行位挪动的事，做完都得叫它一声：
 * 滚动、底栏高度变（换形态 / 提示换行）、列表整张换（改词 / 切分类）、数据刷新、窗口尺寸变。
 *
 * ⚠️ 漏掉任何一处，表现都是**"按 ⌘3 粘到别的行"** —— 不报错、也没有任何迹象。
 *    所以全部收在这一个函数里，别再各写一遍 `screenTop.value = measureFirstRow()`。
 * ⚠️ DOM 刚改过、这一帧还没渲染出来时要包一层：`void nextTick(remapScreenTop)` ——
 *    那会儿量到的还是旧布局。
 */
function remapScreenTop(): void {
  screenTop.value = measureFirstRow()
}

/** 本屏该显示哪几个序号（`行下标 → 1–9`）。只有 9 条，跟着滚动重算不心疼 */
const rowNums = computed(() => screenNumbers(screenTop.value, rows.value.length))

/* ---------------------------------------------------------------- 取数 */

/**
 * 取一次全量。**不带任何参数** —— 关键词和分类都在 `rows` 里前端过滤。
 *
 * 调用它的只剩四条路（都是"宿主库里可能真的变了"）：
 * `onMounted` / `onPluginEnter`（每次打开对齐一次）/ `clipboard.onChange`（120ms 防抖）/
 * 删除、清空之后。**改关键词、切分类都不再走这里** —— 见 `writeQuery`。
 */
async function reload(): Promise<void> {
  items.value = await fetchHistory()
  syncSelection()
  // 新数据可能让整列挪位（比如别处刚复制了一条，全体后移一格）⇒ 屏首重采一次，
  // 不然 ⌘1 指向的会是挪之前那一行
  void nextTick(remapScreenTop)
}

async function refreshFavorites(): Promise<void> {
  favorites.value = await loadFavorites()
  if (view.value === 'favorites') syncSelection()
}

/** 列表变了以后修一次当前行。规则（含「切回全部要不要落回第一条」）在 lib/selection.ts */
function syncSelection(): void {
  const next = resolveSelection(rows.value.map((r) => r.key), { active: activeKey.value }, pinToTop)
  pinToTop = false
  activeKey.value = next.active
}

let reloadTimer: number | undefined
function scheduleReload(): void {
  window.clearTimeout(reloadTimer)
  reloadTimer = window.setTimeout(() => void reload(), 120)
}

/* ---------------------------------------------------------------- 搜索框（宿主原生输入框） */

/*
 * 给宿主那行搜索框传的 placeholder。
 *
 * 为什么是**一个空格**而不是空串：宿主不让它真空。三层兜底，逐层记一遍备查 ——
 * 主进程 `setSubInput`：`placeholder: placeholder || "搜索"`；
 * 渲染层 `updateSubInputPlaceholder`：`const newValue = placeholder2 || "搜索"`；
 * 切插件时 `updateCurrentPlugin`：`plugin.subInputPlaceholder` 为假值也回落 "搜索"。
 * 所以传 `''` 只会拿到宿主的「搜索」两个字。空格是真值，能绕过兜底，
 * 渲染出来是一行空白 —— 我们要的就是空白。
 * （顺带一提：那行灰字根本不是原生 placeholder，宿主把它画成一个兄弟 div
 *   `v-if="!modelValue"`，真正的 input 上 `placeholder=""`。所以空白不会影响输入。）
 *
 * 为什么干脆不要提示词：原来那句「搜索剪贴板…　Tab 切分类　文本: 图像: 文件:」三段里有两段是废话 ——
 * 「Tab 切分类」底栏键位条里已经写着；`文本: 图像: 文件:` 按一次 Tab 就会自己写进框里，看得见的东西不用再讲一遍。
 * 剩下的「搜索剪贴板…」在剪贴板插件里也谈不上信息量：这是个输入框，能打字是常识。
 * 而它却是整屏最长的一行灰字 —— 我们连分类栏都删了，没有理由留一条 28 字的说明书。
 */
const SUB_INPUT_PLACEHOLDER = ' '

async function attachSubInput(): Promise<void> {
  try {
    await zt().setSubInput(
      (details) => {
        const next =
          typeof details === 'string' ? details : details?.text ?? details?.value ?? ''
        /*
         * ★ 用户**直接在宿主搜索框里打字 / 退格**走的是这条路（`writeQuery` 那条是我们程序化写框时才走）。
         *   两条路都**只改本地状态、不取数** —— 关键词只影响 `rows` 的前端过滤。
         *   要重新取数的只有四类时机，全都在别处（打开插件 / 剪贴板变化 / 删除 / 清空）。
         *
         * ★ 落选中项的规矩**只有 `commitTypedQuery` 那一处**（见它的注释）：
         *   **搜索框内容一变 ⇒ 列表整张重筛 ⇒ 落回第一条 + 滚回顶上**（不分变多变少）。
         *   ⚠️ 这里**别再直接写 `syncSelection()`** —— 那正是老大两轮报的 bug（搜 `abc` 退光后
         *   ↑↓ 不从第一条；退到一半时也一样）。原生编辑和插件代按退格必须走同一条规矩。
         */
        commitTypedQuery(next)
      },
      SUB_INPUT_PLACEHOLDER,
      true
    )
  } catch (err) {
    console.error('[x-clipboard] 请求搜索框失败', err)
  }
}

function focusSearch(): void {
  try {
    zt().subInputFocus()
  } catch {
    /* 拿不到焦点也不影响鼠标操作 */
  }
}

/**
 * 把键盘焦点从宿主的搜索框搬到插件视图。
 *
 * ── 为什么非要有这一步 ──
 * 搜索框（= 插件模式的子输入框）拿着焦点时，宿主渲染层**只把 `←→↑↓EnterTab`
 * 六个键投给插件**（`SearchBox` 上就挂了那六个 `withKeys`），`⌘K`/`⌘C`/`⌘L`/`Delete`
 * 这一类在渲染层就被丢掉了 —— 老大的「↑↓ 选好了行、按 ⌘K 却没反应」就是这个。
 * 09-15 真机上看得很清楚：按 ↑↓ 时光标还在搜索框里一闪一闪，焦点根本没挪窝。
 *
 * 宿主提供了反向开关（主进程 `subInputBlur`）：
 * `ztools.subInputBlur()` → `pluginManager.getCurrentPluginView().webContents.focus()`
 * 宿主自己的注释就写着「子输入框失去焦点，插件应用获得焦点」。焦点搬过去之后
 * 按键直接进插件页，⌘ 组合键全部生效。
 *
 * ── 于是规矩 ──
 * **一按 ↑↓ 开始用键盘浏览，焦点就让给插件；想打字了再还回去** ——
 * 可打印字符由 `typeIntoSearch` 递过去，`/` 和输入法组字走 `focusSearch`。
 *
 * ⚠️ 它调的是 `sendSync`（同步阻塞 IPC），所以调用点用 `!e.repeat` 挡掉长按连发。
 *
 * ⚠️ 这里**故意不做"是不是已经让过焦点"的判断**。那个调用本身是幂等的（宿主就是
 * 一次 `webContents.focus()`），多让一次没有任何损失；反倒是状态旗子一旦猜错
 * （比如用户点了搜索框、旗子却没跟上），⌘K 会**安静地再次失灵**，而且没有任何迹象。
 * 宁可多调一次，也不要一个会悄悄错掉的开关。
 */
function takeKeyboard(): void {
  try {
    zt().subInputBlur()
  } catch {
    /* 拿不到焦点也还能用鼠标 */
  }
}

/**
 * 焦点在插件时用户按了一个**可打印字符** —— 他想往搜索框里打字，可那个框收不到。
 * 替他把这一个字补进去，焦点也就顺势回搜索框了。
 *
 * 不用额外调 `subInputFocus()`：宿主 `setSubInputValue` 的实现**末尾硬编码**调了
 * 它（`this.subInputFocus(event)`），写值本身就会把焦点还回去。
 */
function typeIntoSearch(ch: string): void {
  writeQuery(keyword.value + ch)
}

/**
 * 搜索框被人改了之后，把新值落到状态上 —— **落选中项的规矩只有这一处**。
 *
 * 两个来源都走它：
 *   1. 用户在宿主搜索框里**原生编辑**（打字 / 退格 / 选中一段删掉）→ `setSubInput` 回调；
 *   2. 插件**代他按退格** → `backspaceSearch`。
 *
 * ★ 规矩（09-17 老大**两轮**要求后定稿）：
 *   **搜索框内容一变 = 列表整张重筛 = 一张新列表 ⇒ 落回第一条、列表滚回顶上。**
 *   不区分"变多还是变少"：打字、退一格、退到一半、退光、清空，全都算。
 *
 *   ⚠️ 第一轮我只做了"**退成空**才回顶"（理由写着"还有词只是缩小范围、选中项还在就原地不动"）——
 *   老大当场又报了一条：**"删到一半时，列表根据搜索框剩下的内容重新渲染了，为什么这时候 ↑↓
 *   没有重新从第一行开始"**。他说得对：剩下的关键词一换，旧选中那条在新列表里可能跑到第 12 位
 *   （甚至已经不在列表里），而用户看到的是一张从头铺开的新列表 —— 光标停在中间就成了"莫名其妙
 *   从那儿开始"。所以那条"半条规则"作废，判据不再需要（`isScopeReset` 已删）。
 *
 *   ★ 唯一**不**回顶的是"列表自己变了"（别人复制了新东西 → `reload` / `refreshFavorites`）：
 *     那不是"用户在看的东西"变了，只是他看的那一行被刷新了 ⇒ 选中项还活着就原地不动
 *     —— 那是 `resolveSelection` 的默认规矩（`pinToTop = false`），别跟这条混。
 *
 * ⚠️ 为什么还要显式滚一下：不能只靠 `watch(activeKey)` ——
 * 如果选中项本来就正好是第一条，`activeKey` **没变**，那个 watch 不触发，
 * 列表会停在用户之前滚到的位置，高亮却在屏幕外。老大那句"列表展示也要回到第一条"指的就是这个。
 *
 * ⚠️ 值没变就直接返回：宿主 `setSubInputValue` 的实现里**末尾会 `notifySubInputChange(text)`**
 * （= 把我们自己写进去的值再回声一次给这个回调）。我们这边 `writeQuery` / `backspaceSearch`
 * 写完框**自己也会调一次**，不加这道闸就会跑两遍。多跑一遍本身无害（幂等），
 * 但回声是**异步**到的 —— 万一它落地前用户已经按了 ↑↓ 挪去别的行，
 * 那次迟到的"落回第一条"就把人拽回去了。值没变就说明列表没重筛，什么都不用做。
 */
function commitTypedQuery(next: string): void {
  if (keyword.value === next) return
  keyword.value = next
  pinToTop = true
  void nextTick(scrollActiveIntoView)
  syncSelection()
}

/**
 * Backspace：**只退搜索框，永不删数据**（09-17 改语义）。
 *
 * 以前它跟 Delete 一样删当前项。而删除现在可以在设置里关掉确认框 ——
 * 「想删搜索词里的一个字」这个高频动作，一下就变成"整条记录没了"
 * （宿主是硬删、图像连磁盘文件一起 unlink，**没有撤销**）。退格键不该有这种权力。
 * 现在它只做退格：有词退一个字符 / 只剩分类前缀就把前缀也退掉 / 空框不动。
 * 删数据只剩 `Delete` 和 `⌘⌫`（见 lib/keys.ts）。
 *
 * ⚠️ **不走 `writeQuery`**，走 `commitTypedQuery` —— 两条路的落位规矩现在**一样**（都是无条件回顶，
 * 见 `commitTypedQuery`），区别只有一个：`writeQuery` 会替我们把值写进框（这里已经写了）、
 * 而框里刚写进去的值会被宿主回声回来，多写一次就是多余的往返。
 * ⚠️ 第一轮这里写的是"退格是逐字的、只有退成空才算范围变化，所以不能无条件回顶" ——
 * **那句话已作废**（老大真机反馈：退到一半时列表同样重筛了）。现在逐字退也每一下都回顶。
 *
 * ⚠️ 焦点会**自动回到搜索框**：宿主 `setSubInputValue` 末尾硬编码调了 `subInputFocus()`
 * （同 `typeIntoSearch` 那段的说明）。这恰好是我们想要的 —— 连按退格时，
 * 后面几下由搜索框自己处理，一个字一个字地退，全程碰不到"删数据"那条分支。
 */
function backspaceSearch(): void {
  const next = backspaceQuery(keyword.value)
  if (next === null) return
  writeSubInput(next)
  commitTypedQuery(next)
}

/**
 * 把值写进宿主那个搜索框（`backspaceSearch` / `writeQuery` 共用这一处）。
 *
 * ⚠️ 失败**只吞掉、不报错**：写不进框顶多让框里的字跟本地状态差一拍，
 *    下一次打字或切分类会自己对齐；为这个弹一条错误出来，比不同步本身更糟。
 * ⚠️ 它顺带把焦点还给搜索框 —— 宿主 `setSubInputValue` 的实现**末尾硬编码**调了
 *    `subInputFocus(event)`，写值本身就会还焦点，这里不用再补一次（同 `typeIntoSearch`）。
 */
function writeSubInput(next: string): void {
  try {
    zt().setSubInputValue(next)
  } catch {
    /* 写不进框就只改状态 */
  }
}

/**
 * 改搜索框内容的唯一出口：本地状态和宿主那个框永远一起写，不留第二份真相。
 *
 * ★ 这里**故意不 reload**。切分类只换前缀、改关键词只换过滤词 ——
 *   两件事都**不改变宿主库里的内容**，所以没有理由再跑一趟「读全库 + 全量排序 + 传回来」。
 *   列表靠 `rows` 这个 computed 立刻重算，比原来还快一拍（原来要等一次异步往返）。
 *
 *   需要重新取数的只剩四条路：`onMounted` / `onPluginEnter`（每次打开对齐一次）/
 *   `clipboard.onChange` / 删除与清空之后。
 *
 * ⚠️ `syncSelection()` 原来挂在 `reload()` 的尾巴上，这里去掉 reload 之后必须自己补一次，
 *   否则切分类不会落回第一条（上面那句 `pinToTop = true` 就白设了）。
 */
function writeQuery(next: string): void {
  keyword.value = next
  writeSubInput(next)
  pinToTop = true
  syncSelection()
}

function clearSearch(): void {
  writeQuery('')
}

/**
 * Tab / ⇧Tab：在五个分类之间循环（全部 → 文本 → 图像 → 文件 → 收藏）。
 *
 * 五站都会把前缀写进搜索框 —— 包括「全部:」和「收藏:」，
 * 不然站在哪一站光看界面看不出来。收藏能进这支循环，正因为它是前缀的一种。
 * 算法在 lib/query.ts 的 cycleCat 里（纯字符串进、纯字符串出，能单测）。
 *
 * 为什么是 Tab 而不是 ⌘1~5：宿主只把 ↑↓←→EnterTab 这六个键转发给插件，
 * 其余按键在搜索框有焦点时根本到不了插件 —— 而默认状态就是搜索框有焦点。
 * Tab 两种焦点状态下都能用，还顺手绕开了 ⌘/Ctrl 的平台差异。
 */
function cycleType(delta: number): void {
  writeQuery(cycleCat(keyword.value, delta))
}

/* ---------------------------------------------------------------- 光标 */

/** 把当前行挪到这一行。列表里只有「当前行」一种选中态 —— 不做多选。 */
function selectOnly(row: Row): void {
  activeKey.value = row.key
}

function move(delta: number): void {
  if (!rows.value.length) return
  const from = activeIndex.value < 0 ? 0 : activeIndex.value
  const to = Math.min(rows.value.length - 1, Math.max(0, from + delta))
  const row = rows.value[to]
  if (!row) return
  // 目标行还在渲染窗口之外就先把它放出来，否则下面那步 scrollIntoView 找不到元素
  ensureRendered(to)
  selectOnly(row)
}

/*
 * ───────────────────────── 翻页 ─────────────────────────
 *
 * `PageDown` / `PageUp`：一次跳一屏（09-21，老大提的 —— 一屏 13 行，
 * 找第 14 条要按十几次 ↓）。
 *
 * 三个决定都写在这儿，免得以后有人"顺手改一下"：
 *
 * ① **步长是量出来的，不是常量 13。** 行高有两档（纯文本 36px / 带缩略图·文件图标的
 *    42px，见 base.css 的 `--row-h` / `--row-h-tall`），一屏到底装几行随内容和窗口高度变。
 *    写死 13 的话，混排的那几屏会漏掉一行 —— 而"漏一行"这种错极难被发现，
 *    人只会觉得"刚才好像扫过去一条"。
 *
 * ② **留一行**：步长 = 一屏行数 − 1，上一屏的最后一行当新屏的第一行。
 *    浏览器的 PageDown 也是这么做的，好处是两屏之间有个重合的抓手。
 *    ⇒ 顺带一个保证：步长恒小于屏高，所以**永远不会漏行**。
 *    （想改成"整页无重叠"，把下面那个 `- 1` 去掉就行，一处。）
 *
 * ③ **基准是"屏幕最上面那一行"，不是"当前行"。** 这样"按一下"和"屏幕动一屏"
 *    永远是同一件事（跟 vim 的 Ctrl+F 同一套）。若拿当前行当基准，用 ↓ 把光标
 *    挪到屏幕中间之后再翻页，屏幕只会挪半屏 —— 每次按键前进多少还不一样，就没法预期了。
 *
 * 翻过去之后**新屏的第一行就是新的当前行**，列表滚到它贴顶。
 * 当前行绝不能落在屏幕外面 —— 否则接下来按 Enter 粘到哪一条就成了盲猜。
 *
 * ⚠️ 前提：焦点得先在插件里（跟 ⌘K / Delete 一样）。PageDown 不在宿主那六个转发键里，
 *    所以打开插件就直接按是没反应的。详见 lib/keys.ts 里那两条 case 上面的说明。
 */

/** 当前视口里**完整露出来**的行数。42px 的行自然少占一格，所以只能量 */
function pageRows(): number {
  const list = listRef.value
  if (!list) return 1
  const box = list.getBoundingClientRect()
  let n = 0
  for (const el of list.querySelectorAll<HTMLElement>('.row')) {
    const r = el.getBoundingClientRect()
    if (r.top >= box.top - 1 && r.bottom <= box.bottom + 1) n++
  }
  return Math.max(1, n)
}

function pageMove(dir: 1 | -1): void {
  const list = listRef.value
  if (!list || !rows.value.length) return

  const step = Math.max(1, pageRows() - 1)
  // 基准 = 屏幕最上面那一行（跟 ⌘1 的起点同一处，见 `measureFirstRow()`）
  const from = activeIndex.value < 0 ? 0 : measureFirstRow()
  const to = Math.min(rows.value.length - 1, Math.max(0, from + dir * step))
  const row = rows.value[to]
  if (!row) return
  // 到头了：停在原地，**不循环**（循环会让人分不清自己翻到哪儿了）
  if (row.key === activeKey.value) return

  // 目标行可能还在渲染窗口之外，先放出来 —— 不然下面量不到它的位置
  ensureRendered(to)
  selectOnly(row)

  /*
   * 把它顶到屏幕最上面。
   *
   * ⚠️ 这一步**不能**用 `scrollIntoView({ block: 'nearest' })`（`scrollActiveIntoView`
   *    用的那个）：`nearest` 在"这一行已经完整可见"时什么都不做，而翻页要的恰恰是
   *    "把它挪到最上面"。用它的话，当光标本来就在屏幕中间时，按 PageDown 会纹丝不动。
   *
   * 直接写 `scrollTop`，跟 `watch(activeKey)` 里那次 `scrollActiveIntoView()` 不打架：
   * 等它跑的时候这一行已经完整可见，`nearest` 自然成了空操作。
   *
   * 放在 `nextTick` 里是因为上一步的 `ensureRendered()` 可能要新建 DOM（渲染窗口外的行）。
   */
  void nextTick(() => {
    const el = listRef.value
    if (!el) return
    const els = el.querySelectorAll<HTMLElement>('.row')
    const target = els[to]
    const first = els[0]
    if (!target || !first) return
    // 两个 offsetTop 相减：行的定位基准是 `.root` 而不是 `.list`，但同一次相减
    // 会把那个基准抵消掉，差值就是内容坐标系里的真实距离（跟滚动位置无关）。
    el.scrollTop = target.offsetTop - first.offsetTop
    // 屏首这一刻就换了（目标行顶到屏幕最上面）⇒ 顺手重采，
    // 不用等下一个 scroll 事件 —— 等它的话，中间那一小段 ⌘1 还指着旧起点
    remapScreenTop()
  })
}

/* ---------------------------------------------------------------- 动作 */

/** 把某一条粘出去。历史走宿主、收藏走自己那条路 —— 两种行都是同一个动作 */
async function pasteRow(row: Row): Promise<void> {
  // 历史记录优先走宿主的 write：它自己会关窗、切回上一个应用、模拟粘贴
  if (row.item) {
    await zt().clipboard.write(row.item.id, true)
    return
  }
  // 收藏项没有宿主 id，只能自己把内容写回去（宿主同样会关窗粘贴）
  // 不弹提示（老大 09-16 要求去掉全部 toast）
  await pasteOne(row.data)
}

async function pasteActive(): Promise<void> {
  const row = activeRow.value
  if (!row) return
  await pasteRow(row)
}

/**
 * `⌘1`–`⌘9`：粘贴**本屏**第 N 行（`slot` 是 0 基下标）。
 *
 * 起点是屏首 `screenTop`，**不是列表开头** —— 09-23 改的口径，为的是翻页 / 下滑之后
 * 屏幕上那些行仍然有键可用。跟 `pageMove()` 量翻页基准用的是同一处，别分家。
 *
 * ⚠️ 取的是 **`visibleRows`** —— 跟行尾显示的序号（`rowNums`）、跟模板里的 `v-for`
 * 是同一份。另算一份迟早会错位（渲染窗口、分类过滤、收藏视图三条路都得对上），
 * 到时候按 ⌘3 粘到的不是眼睛看到的第 3 行，而且极难复现。
 *
 * ⚠️ 越界（翻到最后一屏、下方不足 9 行）就什么都不做 —— **不夹到最后一个**
 * （夹了 ⌘7 / ⌘8 / ⌘9 会连着粘同一条）。判定在 `lib/viewport.ts` 的 `slotRowIndex()`。
 */
async function pasteAt(slot: number): Promise<void> {
  const at = slotRowIndex(screenTop.value, slot, rows.value.length)
  if (at === null) return
  const row = visibleRows.value[at]
  if (!row) return
  await pasteRow(row)
}

function copyActive(): void {
  const row = activeRow.value
  if (!row) return
  // 只写系统剪贴板，不关窗。成功与否都不弹提示（老大 09-16 要求）
  copyToClipboard(row.data)
}

/**
 * 收藏 / 取消收藏当前这一条。
 *
 * 反馈分两种（老大 09-21 定的）：
 *   · 行尾**有**收藏按钮 —— 那枚 ☆ 会立刻点亮 / 熄灭，状态就写在你看的那一行上，
 *     不再加别的东西（这时候闪星是重复的）；
 *   · 行尾**没有**收藏按钮 —— 界面上什么都不会动，等于"静默成功" ⇒ 补一颗行内瞬时星。
 * 两种都**不弹提示**（老大 09-16 要求去掉全部 toast）：在内容上面盖一块的收益是零。
 */
async function toggleFavorite(): Promise<void> {
  const row = activeRow.value
  if (!row) return
  // 查找走 lib/favorites 的 findFavorite —— 这里原来自己又写了一遍
  // 「算指纹 + 在收藏里找」，跟 isFavorite 是逐字重复的两份实现。
  const hit = findFavorite(row.data, favorites.value)
  favorites.value = hit
    ? await removeFavorite(hit.favId, favorites.value)
    : await addFavorite(row.data, favorites.value)

  if (view.value === 'favorites') syncSelection()
  // ⚠️ 必须排在写库**之后**：那颗星实心 / 空心是跟着收藏状态走的，
  //    先闪再写会先画出一颗错的（刚收藏却显示空心）。
  if (!settings.value.tailFav) flashFavorite(row.key)
}

/**
 * `⌘E`：编辑当前这条收藏。
 *
 * 它是行尾那颗 ✎ 的**键盘并行走廊** —— 那颗按钮能在设置里关掉（`tailEdit`），
 * 关掉之后编辑就只剩这条路（跟 `tailFav` → `⌘K`、`tailDel` → `Delete` 同一个规矩）。
 *
 * 三个前提缺一不可，不满足就**什么都不做**（不报错、不提示 —— 跟 ⌘K 在空列表上一样，
 * 是按到了一个"这儿没有的东西"，不是出错）：
 *   ① 在收藏视图 —— 历史那一摊是宿主的账，插件改不了；
 *   ② 当前行是文本 —— 图片改不了那张 png，文件改路径等于"换一个文件"；
 *   ③ 那一行的 key 就是 `favId`（收藏视图的 `makeRow` 用的正是它，见 composer 那段注释）。
 */
function editActive(): void {
  if (view.value !== 'favorites') return
  const row = activeRow.value
  if (!row || row.data.type !== 'text') return
  openComposer('edit', row.key)
}

/**
 * `⌘N`：新增一条收藏。
 *
 * 它是右下角那颗「新增」的**键盘并行走廊** —— 那颗按钮能在设置里关掉
 * （`底栏按钮` 那组多选里取消「新增」，09-24 之前是老键 `footAdd`），
 * 关掉之后新增就只剩这条路（跟 `tailEdit` → `⌘E`、`tailDel` → `Delete` 同一个规矩：
 * 按钮管鼠标、键位管键盘，关哪边都不把功能关死）。
 *
 * ⚠️ **跟那颗按钮显不显示无关** —— 设置只管界面上画不画按钮，这条键不看它，
 *    它正是关掉按钮之后的那条路（跟 `⌘E` 不看 `tailEdit` 完全同构）。
 *    （底栏那条 `⌘N 新增` 的提示也一样：它是"要不要写出来"的问题，不是"键在不在"。）
 *
 * ⚠️ **只有收藏视图里有意义**：新增出来的东西本来就落在收藏里，
 *    在历史那边弹出这个框会让人以为在改历史。别的视图按它**什么都不做**，这是对的。
 *    下面那颗按钮不用再判一遍 —— 它的 `v-if` 里已经写着 `view === 'favorites'`。
 */
function addActive(): void {
  if (view.value !== 'favorites') return
  openComposer('new')
}

/**
 * 删当前这一条。
 *
 * 「要不要先问一句」是**设置项**（`confirmDelete`），默认问。
 * 关掉它的人多半是键盘流：弹框对键盘流是打断 —— 删一条要按两次。
 *
 * ⚠️ 关掉之后**没有撤销**：宿主的 `deleteItem` 是硬删，图像连磁盘文件都会一起 unlink
 * （已核实，见 REFERENCE §26.1-A）。所以这一档是「知道自己在按什么」的人用的。
 * ⚠️ 只管单条。**清空**（`askClear`）不受这个开关影响 —— 那个一次几十上百条，必须问。
 */
function askRemove(): void {
  const row = activeRow.value
  if (!row) return
  if (!settings.value.confirmDelete) {
    void runRemove()
    return
  }
  const text = view.value === 'favorites' ? '删除这条收藏？' : '删除这条记录？'
  void openConfirm(text, true, runRemove)
}

async function runRemove(): Promise<void> {
  const row = activeRow.value
  if (!row) return
  if (view.value === 'favorites') {
    favorites.value = await removeFavorite(row.key, favorites.value)
  } else if (row.item) {
    await deleteItem(row.item.id)
    await reload()
  }
  syncSelection()
}

/* ---------------------------------------------------------------- 底栏显示什么 */

/**
 * 底栏左边这一刻**真该画**的提示（含键帽文案）。
 *
 * 顺序 = 设置里那份数组的顺序（也就是 `FOOT_HINTS` 的先后 —— `toggleMember`
 * 和 `normalizeSettings` 两处都按定义顺序收，所以存进库里的就是有序的）。
 * 「编辑 / 新增」在本视图里没意义时会被滤掉，见 `HINT_VIEW_ONLY`。
 */
const footHintItems = computed(() =>
  settings.value.footHints
    .filter((h) => {
      const only = HINT_VIEW_ONLY[h]
      return only === undefined || only === view.value
    })
    .map((h) => {
      const f = FOOT_HINT_FACE[h]
      return { id: h, key: f.mod ? modKey(f.key) : f.key, label: f.label }
    })
)

/**
 * 面板里点一颗提示药丸。
 *
 * ⚠️ 跟键盘那条路（`toggleAt` + `toggleMember`）**共用同一个 `toggleMember`** ——
 *    鼠标和键盘必须落到同一句话上。各写一遍迟早分家：一个按定义顺序排、
 *    一个按点击先后追加，存进库里的数组就不一样了（而它还直接决定底栏里的先后）。
 */
function toggleFootHint(id: FootHint): void {
  updateSettings({ footHints: toggleMember(settings.value.footHints, id, FOOT_HINTS) })
}

/** 面板里点一颗按钮药丸。同上（设置 / 新增 / 清空） */
function toggleFootButton(id: FootButton): void {
  updateSettings({ footButtons: toggleMember(settings.value.footButtons, id, FOOT_BUTTONS) })
}

/* ---------------------------------------------------------------- 清空 */

/** 底栏那个按钮的文案 —— 跟着当前分类走，别让「清空」变成一个作用域不明的词 */
const CLEAR_LABEL: Record<'all' | ClipType | 'favorites', string> = {
  all: '清空历史',
  text: '清空文本历史',
  image: '清空图像历史',
  file: '清空文件历史',
  favorites: '清空收藏'
}

const clearLabel = computed(() => CLEAR_LABEL[cat.value])

/**
 * 「清空」= 清掉**当前分类**里的东西，不是清掉你正在看的那几条。
 *
 * 为什么按分类、而不是恒清全部：分类就写在搜索框里、永远看得见，所以作用域从来
 * 不是隐藏状态；反过来那个坑更实 —— 站在「文本:」看着一屏文本点一下，把图像和文件
 * 也一起清了，而且不可撤销。收藏那一站同理，它是插件自己另一摊数据，文案就写「清空收藏」。
 *
 * 关键词**不参与**作用域：宿主的 `clear(type)` 也只能按类型清，而且关键词是「望远镜」、
 * 分类才是「范围」。确认框里把这句写明，免得有人以为清的是搜出来的那几条。
 */
function askClear(): void {
  // 快照一次：确认框开着时 Tab 还能切分类，回调要清的必须是**按下按钮那一刻**那个分类
  const cur = cat.value
  const note = query.value.text.trim() ? '（不受搜索关键词影响）' : ''

  if (cur === 'favorites') {
    if (!favorites.value.length) return
    void openConfirm(`清空全部收藏？不可撤销。剪贴板历史不受影响。${note}`, true, async () => {
      await clearFavorites()
      await refreshFavorites()
    })
    return
  }

  const what = cur === 'all' ? '全部剪贴板历史' : `全部${TYPE_LABEL[cur]}历史`
  const keep = cur === 'all' ? '收藏不受影响。' : ''
  void openConfirm(`清空${what}？不可撤销。${keep}${note}`, true, async () => {
    await clearHistory(cur === 'all' ? undefined : cur)
    await reload()
  })
}

/**
 * 弹确认框的唯一入口。
 *
 * 位置全交给 CSS（`.mask` 的 flex 居中）—— **这里不再量尺寸、也不排坐标**。
 * 09-17 之前它是「跟着鼠标弹、下面不够翻上方」，老大要求改居中之后那套就整块删了
 * （连同 `lib/popover.ts`）。
 */
function openConfirm(text: string, danger: boolean, run: () => void): void {
  // 一次只留一个浮层：设置面板还在的话先收掉，不然它会被确认框那层接点击的透明层压住、点了没反应
  settingsOpen.value = false
  confirmBox.value = { text, danger, run }
}

function runConfirm(): void {
  const box = confirmBox.value
  confirmBox.value = null
  void box?.run()
}

/* ---------------------------------------------------------------- 鼠标 */

function onRowClick(row: Row): void {
  selectOnly(row)
}

function onRowDblClick(row: Row): void {
  selectOnly(row)
  // 双击 = 复制，同样不弹提示
  copyToClipboard(row.data)
}

/** 图片读不出来（文件被删/被清理）就退回占位图标，不留一个破图 */
function markBroken(key: string): void {
  brokenThumbs.value = new Set([...brokenThumbs.value, key])
}

function onWindowMouseDown(e: MouseEvent): void {
  const el = e.target as HTMLElement | null
  if (settingsOpen.value && !el?.closest('.sheet') && !el?.closest('.set')) {
    settingsOpen.value = false
  }
}

/** 只管底栏「淡入」档的浮现判定；确认框居中之后，这里不再记鼠标落点 */
function onPointerMove(e: MouseEvent): void {
  /*
   * 底栏「淡入」档：鼠标贴到窗口底边才把那一行浮出来。
   *
   * 为什么用 mousemove 算距离，而不是给那条浮出来的栏挂 :hover ——
   * 它压着的正是列表最后几十 px（也就是最后一行**本身**）。挂 hover 的话，
   * 鼠标想去点最后一行 → 栏浮出来 → 栏盖住那一行 → 点不到。
   * 改成「离底边近就露出」之后，栏只负责显示；鼠标事件靠 `pointer-events: none`
   * 穿透过去给底下的行，那几颗按钮再单独放行（见 .foot.fade 的样式）。
   *
   * ⚠️ 判定范围用 `footH`（**量出来的**底栏高度），不是写死的数：
   *    09-24 起底栏放不下会换行，它可能是两三行高 —— 只盖住一行的话，
   *    鼠标停在第二行上底栏反倒收起来了。
   */
  if (settings.value.foot === 'fade') {
    footRevealed.value = e.clientY >= window.innerHeight - footH.value
  } else if (footRevealed.value) {
    // 从「淡入」换成别的档，或者干脆切走时，别把这个标记留在 true 上
    footRevealed.value = false
  }
}

function onViewportChange(): void {
  hidePeek()
  // 窗口大小变了 ⇒ 底栏可能换行也可能不换行（宽度变了）⇒ 高度重量一次
  measureFoot()
  // 窗口高度变了 ⇒ 一屏装得下几行也变了 ⇒ 屏首重采（⌘1–⌘9 从它数起）
  remapScreenTop()
}

/** 行尾的收藏 / 删除：先把这一行选成当前项，再走跟键位同一条路，避免两套逻辑 */
function onRowFavorite(row: Row): void {
  selectOnly(row)
  void toggleFavorite()
}

function onRowRemove(row: Row): void {
  selectOnly(row)
  askRemove()
}

/* ---------------------------------------------------------------- 详情浮层 */

/** 当前行的 DOM。列表里同时最多只有一行带 .on */
function activeRowEl(): HTMLElement | null {
  return listRef.value?.querySelector('.row.on') ?? null
}

/** 行里的文字是不是真被 CSS 截断了 —— 量出来，不猜字数 */
function textTruncated(el: HTMLElement): boolean {
  const t = el.querySelector('.t')
  return !!t && t.scrollWidth > t.clientWidth + 1
}

let peekTimer: number | undefined

/*
 * 浮层「收掉之后隔多久才给新的一行重新摆」。
 *
 * 两个来源节奏不一样：**换行**（↑↓ / 点一行）是键盘连按，收得要快；
 * **滚动**是手在滚，等它停下来再摆更稳。差 10ms，肉眼分不出，但故意留着两个名字 ——
 * 将来只调其中一个时不必再猜"这个数是给谁的"。
 */
const PEEK_DELAY_MOVE = 150
const PEEK_DELAY_SCROLL = 160

function hidePeek(): void {
  window.clearTimeout(peekTimer)
  peek.value = null
}

function showPeek(): void {
  if (!settings.value.peek || view.value !== 'history' || confirmBox.value) return

  const row = activeRow.value
  const el = activeRowEl()
  const list = listRef.value
  const root = rootRef.value
  if (!row || !el || !list || !root) return

  const kind = peekKindOf(row.data, textTruncated(el))
  if (!kind) {
    peek.value = null
    return
  }

  // 尺子：行（宽度和左右都以它为准）/ 列表（只管上下边界）/ 根（坐标原点）
  const geom = peekGeom(
    el.getBoundingClientRect(),
    list.getBoundingClientRect(),
    root.getBoundingClientRect()
  )
  if (!geom) {
    peek.value = null
    return
  }

  peek.value = { key: row.key, kind, ...geom }
}

/**
 * 收掉当前浮层，`delay` 之后再决定要不要给新的一行摆一个。
 *
 * 收得干脆是要紧的 —— 连按上下键、连着滚时，浮层不能一路挂在后面追。
 * ⚠️ 两个来源（换行 / 滚动）共用这一个函数，只是 delay 不同 ——
 *    别各写一份，`hidePeek` + `peekTimer` + `nextTick(showPeek)` 这三件事漏一件都是"浮层乱飘"。
 */
function schedulePeek(delay: number): void {
  hidePeek()
  if (!settings.value.peek) return
  peekTimer = window.setTimeout(() => {
    void nextTick(showPeek)
  }, delay)
}

/**
 * 列表一滚，浮层的坐标就废了：先收起来，滚停了再摆。
 *
 * ⚠️ **只认列表自己滚**（`e.target === .list`）。
 *
 * scroll 事件不冒泡，这个监听是挂在**捕获阶段**的 ⇒ 页面上**任何**可滚区域动一下都会打进来：
 * 设置面板的 `.sheet-body`、输入浮层里那个 `<textarea>`、详情浮层内部……
 * 而下面两句是"把整列 DOM 量一遍"：`growRenderWindow` 读 `.list` 的三个尺寸，
 * `remapScreenTop` 要 `querySelectorAll('.row')` 再逐个 `getBoundingClientRect()`（二分几次）。
 * **两样都是主线程上的强制布局** —— 在面板里滚一下、在输入框里滚一行，白干一整帧的活，
 * 表现就是"该顺的地方顿一下"。
 * 而屏首/续渲染只跟列表自己的滚动有关，所以别的来源直接退。
 * （原写法只挡了 `.peek` 一处，面板和 textarea 这两条路一直在白跑。）
 */
function onAnyScroll(e: Event): void {
  if ((e.target as Node | null) !== listRef.value) return

  // 触底续渲染：数据本来就在手里，只是还没建 DOM
  growRenderWindow()

  // 屏首要跟着滚（⌘1–⌘9 和行尾那枚序号都按它算）
  remapScreenTop()

  if (!peek.value && !peekTimer) return
  schedulePeek(PEEK_DELAY_SCROLL)
}

/* ---------------------------------------------------------------- 设置 */

/*
 * 设置面板的键盘光标（09-18 加）。
 *
 * 面板**不接 DOM 焦点** —— Tab 被「切分类」占着，真去 `focus()` 一个按钮还会带出
 * Chromium 的 UA 焦点环（base.css 里刚掐掉的那个）。所以这里是自己画一个环表示
 * "键盘现在停在哪一格"（`.cur`），`on`（已选中）那套强调色光晕不动。
 * 位置怎么算、按下去改什么，全在 `lib/panel.ts`。
 */
const cur = ref<Cursor>({ row: 0, slot: 0 })

/**
 * 开 / 关设置面板。
 *
 * 面板**贴在窗口右边一整条**（CSS 里 `top/right/bottom: 0` 钉死），不是挂在「设置」按钮上的浮层 ——
 * 所以这里只有开关状态，没有"量尺寸、算坐标"那一步。打开时列表 / 空态 / 底栏会按 `--sheet-w`
 * 让出右边这一条（样式里 `.root.sheet-open` 那几条），它底下没有内容，
 * 因此也不配压暗层（它是面板，不是模态）。
 *
 * 下面这条 toggle 现在真的能用了：底栏那颗「设置」不再被面板盖住，点得到第二下。
 * ⌘/ 走的也是这一条。
 */
function openSettings(): void {
  const willOpen = !settingsOpen.value
  settingsOpen.value = willOpen
  if (!willOpen) return
  hidePeek()
  confirmBox.value = null // 一次只留一个浮层
  /*
   * ★ 打开时把光标落到**第一行的「当前值」**上，而且**只落光标、不落值**。
   *
   * 这一句要是写成"选中第一个"，那按一下 ⌘/ 就会把底色、强调色悄悄刷成「默认」——
   * 用户什么都没按，设置却变了。`cursorOf` 只算位置、返回的不是 patch，正是为了这个。
   */
  cur.value = cursorOf(settings.value)
}

/*
 * 原来这里有个 `footHint` computed：给「底栏」那一组算一句说明（当时四档各一句）。
 * 09-17 面板去掉全部说明文字之后它没有出口了，**连同那几句一起删掉** ——
 * 那几句（尤其「淡入 / 全隐」两档的区别、以及全隐只能靠 ⌘/ 开设置）
 * 已经搬进 README 的「设置」一节，改档位时记得同步那边。
 * （09-24 起形态只剩三档，且"显示什么"搬去了「底栏按钮 / 底栏按键提示」两份多选 ——
 *  README 那一段也是同批改的，两边别各说各话。）
 */

/**
 * 改设置的唯一出口：本地状态、落库、落到 CSS 变量，三个地方一起走。
 * 主题和强调色默认都是「跟随 ZTools」—— 用户在宿主换了色这边不会打架。
 */
function updateSettings(patch: Partial<Settings>): void {
  const next: Settings = { ...settings.value, ...patch }
  settings.value = next
  // 存失败不再弹提示（老大 09-16 要求）。留痕仍在：upsertDoc 自己会 console.error
  void saveSettings(next)
  applyTheme(next)

  // 换了底栏档位就把「淡入」的浮现标记清掉，免得切走之后还留着一个没用的 true
  if (patch.foot !== undefined) footRevealed.value = false

  if (patch.peek !== undefined) {
    if (next.peek) schedulePeek(PEEK_DELAY_MOVE)
    else hidePeek()
  }
}

/* ------------------------------------------------- 新增 / 编辑收藏（输入浮层） */

/**
 * 输入框高度。★ **上限**，也是老大 09-24 从效果图里挑的那一档 —— 他挑的是「撑满」。
 *
 * 401 是**档位名**，真正的高度取「401」和「弹框可用高度」里的小值（见 composerMaxH），
 * 标准窗口下取到的就是撑满：
 *   插件视口 550（真机实测；宿主常数写的是 542）− `.mask` 上下留边 24 = 可用 **526**
 *   卡片里除输入框之外固定 **129**（上下内边距 32 + 标题行 33 + 键位行 34 + 按钮 30 ——
 *   拿 09-23 那张截图反推的：卡片总高 261 − 当时输入框的 132 = 129）
 *   ⇒ 526 − 129 = **397** —— 跟 401 这一档只差个取整，看着就是撑满。
 *
 * ★ 所以这一档是**定高**的：框永远占满可用高度、跟内容多少无关（长内容在框里滚）。
 *   `.ctx` 的 `min-height` 写的是**同一个算式**，两边必须一起改：只改一边的话，
 *   高的那一头说了算，卡片会顶破 `.box` 的 `max-height`、多出一层滚动条。
 *   ⚠️ **机制没删**：把 `.ctx` 的 `min-height` 调小，`fitComposer` 那套
 *      「归 auto 量 scrollHeight」立刻恢复成"跟内容长"，别再重写一遍。
 */
const COMPOSER_MAX_H = 401

/**
 * 弹框里除输入框之外的全部高度 = `.mask` 上下留边 24 + 卡片自身 129，再加 2px 余量。
 *
 * ⚠️ 那 2px 不是凑数：现在输入框顶到 397 时卡片正好等于 `.box` 的 `max-height`（`100vh - 24px`），
 *    差一像素就会在卡片上再生一根滚动条，变成「框里滚」套「卡片滚」两层。留 2px 把这个边界断开。
 */
const COMPOSER_CHROME_H = 155

/**
 * 这一刻输入框最高能长到多少。
 *
 * ⚠️ 用 `window.innerHeight` 现算，而不是写死上面那个 542：**插件窗口可以被拖出来单独调整大小**
 *    （宿主自己那套独立窗口能拖到 300 高），小窗口下还按 401 长就会把弹框顶穿。
 *    `.box` 虽然有 `max-height` + 滚动兜底，但那样会变成「输入框在弹框里滚」这种两层滚动的怪样子。
 *    下限 88 是给「窗口再小也别把输入框压成一条缝」。
 */
function composerMaxH(): number {
  return Math.max(88, Math.min(COMPOSER_MAX_H, window.innerHeight - COMPOSER_CHROME_H))
}

/**
 * 让输入框跟着内容长高。
 *
 * ★ 这一条就是「弹框能展示全」那句话的落地：固定高度的框里长一点的备忘照样看不全，
 *   那弹框就白弹了。做法是先把高度归 `auto` 量出 `scrollHeight`，再取它跟上限的较小值。
 *   ⚠️ 那个归零不能省 —— 不归零时量到的永远是上一次的高度，框只会越删越长。
 *   （`.ctx` 的 `min-height` 顶着下限，所以内容少时量出来就是那个下限，不会缩成一条。）
 * ★ 09-24 换成「撑满」那一档之后，`.ctx` 的 `min-height` 跟这里的上限是**同一个算式**，
 *   于是量出来的数正好等于下限 —— 框就定死在撑满的高度上，内容多了在框里滚。
 *   这是有意的，不是这段失效了：把 `.ctx` 的 `min-height` 改小，它立刻恢复「跟内容长」。
 */
function fitComposer(): void {
  const el = composerRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, composerMaxH())}px`
}

/**
 * 开输入浮层。`edit` 时把原文填进去，并记住是哪一条。
 *
 * ⚠️ `takeKeyboard()` 是**必需的第一步**：宿主的搜索框默认握着焦点，不让一次的话
 *    输入框一个字都收不到（跟 `⌘K` 失灵同一件事，见 takeKeyboard 上面的说明）。
 *    09-23 真机验过：`takeKeyboard()` + `focus()` 这一套能让输入框正常收键，含中文输入法。
 */
function openComposer(mode: 'new' | 'edit', favId?: string): void {
  composerText.value =
    mode === 'edit' ? (favorites.value.find((f) => f.favId === favId)?.content ?? '') : ''
  composer.value = { mode, favId }
  takeKeyboard()
  void nextTick(() => {
    composerRef.value?.focus()
    fitComposer()
  })
}

function closeComposer(): void {
  composer.value = null
}

/**
 * 保存。
 *
 * 空白内容直接不动（按钮那边也是 `disabled`，这里是兜底）—— `addManualFavorite` /
 * `updateFavoriteText` 自己又各判了一道。三层同一个规矩：**空内容不许进库**。
 */
async function saveComposer(): Promise<void> {
  const text = composerText.value
  const at = composer.value
  if (!at || !text.trim()) return

  if (at.mode === 'edit' && at.favId) {
    favorites.value = await updateFavoriteText(at.favId, text, favorites.value)
  } else {
    const before = favorites.value.length
    favorites.value = await addManualFavorite(text, favorites.value)
    /*
     * 新增的那条排在列表最上（`addedAt` 最新）⇒ **把它选中**。
     * 不选的话，列表要是正滚在下面，新条目落在看不见的地方，用户拿不到"存上了"的反馈；
     * `activeKey` 一变，那个 `watch` 自己会把它滚进视野。
     * ⚠️ 判重命中时列表没变长 —— 那就别动选中，不然会跳到一条本来就有的行上。
     */
    if (favorites.value.length > before) activeKey.value = favorites.value[0].favId
  }

  composer.value = null
  if (view.value === 'favorites') syncSelection()
}

/* ---------------------------------------------------------------- 键盘 */

/**
 * 插件自己有没有「该退的一层」：浮层开着、或者搜索框里有东西（关键词 / 分类前缀）。
 * 决定 Esc 要不要从宿主手里抢过来。
 *
 * ⚠️ 输入浮层也在这一列：它开着时 Esc 必须被抢下来（浮层自己收层），
 *    不然那一按穿透给宿主 = **整个插件退回搜索页**，敲了半天的东西一起没。
 */
function hasSomethingToFold(): boolean {
  return !!confirmBox.value || settingsOpen.value || !!composer.value || !!keyword.value
}

/**
 * Esc 的「抢跑」。
 *
 * 宿主的 Esc（返回搜索页）是 preload 里注册的**冒泡**监听器，注册得比插件早，
 * 冒泡阶段它先跑 —— 从主进程代码看，它会先 `sendSync` 问一句、然后直接返回搜索页，
 * 插件的 preventDefault 这时候已经晚了。所以想拦它，只能挂**捕获**监听器：
 * 同一个 window 上，捕获阶段先于冒泡阶段执行，跟谁先注册无关。
 *
 * 只在插件确实有东西要退的时候才拦（宿主看到 defaultPrevented 就会放手），
 * 其余情况一律放行 —— 空列表上按 Esc 仍然是宿主那句「返回搜索页」。
 * 真正退一层的动作在下面的冒泡处理器里做：preventDefault 不阻断传播。
 */
function onKeydownCapture(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (!hasSomethingToFold()) return
  e.preventDefault()
}

function onKeydown(e: KeyboardEvent): void {
  /*
   * 开发期专用：⌘⇧R 强制整页重载。正式构建里 `import.meta.env.DEV` 是 false，
   * vite 会静态替换成死代码，这段不会进包（构建后可以 grep 一下 `.reload(` 确认）。
   *
   * 为什么非留不可：Vite 的 HMR 只让「模板 / CSS」立即生效，**`setup()` 不会重跑** ——
   * `onMounted` 注册的监听器、`onPluginOut` 的回调、函数实现，全都还是旧那一份。
   * 所以改逻辑必须让页面真重新加载一次；而宿主把插件视图缓存着（退出再进不重载），
   * 这个宿主版本的开发者工具里那个「重载」按钮又调的是一个宿主没实现的内部接口。
   * 于是最省事的出口就是自己留一个。（见 MEMORY「开发与装机机制」）
   */
  if (import.meta.env.DEV && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
    e.preventDefault()
    location.reload()
    return
  }

  /*
   * ★★ 输入浮层（新增 / 编辑收藏）：**它是唯一的焦点**，跟确认框同一个位置、同一个道理。
   *
   * ── 为什么必须在最前面拦 ──
   * 往下一段是那个「插件不认这个键」的分支，它对**任何可打印字符**都会 `preventDefault()`
   * 再 `typeIntoSearch()` 转发给宿主的搜索框 —— 输入框一个字都收不到。而且 `Enter` 更狠：
   * 它会一路走到粘贴那条 case → `pasteActive()`（**粘一条 + 关窗口**）；`Tab` 去切分类、
   * `Backspace` 去退搜索框、`Delete` 去删记录。全都要挡在这条分支之上。
   *
   * ── ⚠️⚠️ 判据为什么是「浮层开着」而不是「焦点在输入框里」──
   * 09-23 先在探针上踩过一次：那一版按 `e.target.closest('.probe')` 放行，结果在输入框里
   * 连按两次 `Tab` —— 第一次焦点跑到框内的「关闭」按钮上（还在判据范围内），第二次就跑出
   * 浮层了，**那一下直接漏下去切了分类**。老大的原话：「编辑框还没关呢，tab 还可以切换分类」。
   * ⇒ 只要浮层开着，**除了输入框自己的原生输入，一个键都不许走**，焦点也别想溜出去。
   *
   * ── 放行的关键动作是「不 preventDefault」──
   * 在输入框里那一路**不拦**，才是让浏览器自己把字打进去。只 `Tab` 例外（见下）。
   */
  if (composer.value) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeComposer()
      return
    }
    // ⇧Enter 留给换行（备忘可能是多行），裸 Enter 才是保存
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void saveComposer()
      return
    }
    if (e.target === composerRef.value) {
      /*
       * 输入框里：放行原生输入（不 preventDefault）。
       * ⚠️ 但 `Tab` 要单独挡掉 —— 它是唯一一个能把焦点带出输入框的键，一旦让它跑掉，
       *    下一次按键的 `e.target` 就在框外了，上面那条判据立刻失效（就是这个坑）。
       *    浮层里只有一个输入区，`Tab` 本来也没有去处，挡掉不损失任何东西。
       */
      if (e.key === 'Tab') e.preventDefault()
      return
    }
    // 焦点不知怎么到了别处（按钮上等）：吞掉，别让它操作到底下的列表
    e.preventDefault()
    return
  }

  const action = resolveKey(e)

  /*
   * ★ 确认框开着的时候，**它就是唯一的焦点**：Enter = 按「确定」，Esc = 关掉，其余键一律吞掉。
   *
   * 不加这一段会出事（09-17 真机，老大报的）：Enter 会一路走到下面的 `case 'enter'`
   * → `pasteActive()` —— 于是「复制当前项 + 插件窗口也关了」，而弹框问的那件事根本没执行。
   * 人以为自己按了「确定」，实际是复制了一条并退出了插件。
   *
   * 别的键也一并挡掉：弹框是「一次只回答一个问题」的状态，此时打字没有合理去处
   * （下面那段会把可打印字符塞进搜索框，必须拦在它前面）。
   */
  if (confirmBox.value) {
    e.preventDefault()
    if (action === 'enter') runConfirm()
    else if (action === 'escape') confirmBox.value = null
    return
  }

  /*
   * ★ 设置面板开着时，方向键和 Enter 归面板（09-18）。
   *
   * 为什么必须拦在列表前面：
   *   ① `↑↓` 本来就是列表的选择键，不拦的话「在面板里按 ↓」会让底下的列表跟着跳一格；
   *   ② `Enter` 更严重 —— 它会一路走到 `case 'enter'` → `pasteActive()`，也就是
   *      「粘一条 + 插件窗口一起关掉」，可面板里按 Enter 的人只想落一个设置值。
   *      这跟 09-17 那个确认框 Enter 穿透是同一类事故，所以摆在同一个位置：
   *      **确认框（更模态）在前，面板在后，两者都在列表之前**。
   *
   * 只吃 `↑↓←→Enter` 五个键，其余一律放行 —— 面板不是模态：搜索框照样能打字
   * （Esc / Backspace / 可打印字符都走它们原来的路），Tab 也照样切分类。
   *
   * `e.repeat` 一律挡掉：长按会连发，而 `←→` 在单选组上是**直接落库**的
   * （`updateSettings` → `saveSettings`，没有防抖）—— 连发就是一串互相踩的写请求，
   * 而 `upsertDoc` 是"先读 rev 再写"，踩起来会**静默丢数据**（跟 09-15 那个
   * 「设置重启就没了」同一个坑）。宁可让人一格一格按。
   */
  if (
    settingsOpen.value &&
    (action === 'up' ||
      action === 'down' ||
      action === 'left' ||
      action === 'right' ||
      action === 'enter')
  ) {
    e.preventDefault()
    if (e.repeat) return
    takeKeyboard()
    panelKey(action)
    return
  }

  if (!action) {
    /*
     * 插件不认这个键。分两种情况：
     *
     * ① 可打印字符 → 用户想往搜索框打字，但焦点这会儿在插件手里，那个框一个字都收不到。
     *    替他把这一个字递过去（顺带把焦点还回去）。
     * ② 输入法在组字（`Process` / keyCode 229）→ 中文没法一个字一个字地转，
     *    直接把焦点还给搜索框，让输入法在那边正常组合。代价是这一次按键会被丢掉，
     *    但接下来就正常了（光标回到框里，用户看得见）。
     *
     * 焦点在搜索框时这些键根本不会进到插件里来，所以这两条不算常态路径。
     */
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key.length === 1) {
        e.preventDefault()
        typeIntoSearch(e.key)
      } else if (e.isComposing || e.key === 'Process' || e.keyCode === 229) {
        focusSearch()
      }
    }
    return
  }

  // Esc 的最后一步（关窗）归宿主，只有在插件自己有东西可收的时候才拦
  if (action === 'escape') {
    /*
     * 一层一层退：设置面板 → 关键词 → 分类前缀 → 交还宿主。
     * （确认框那一层在上面就退掉了 —— 它是"唯一焦点"状态，不等走到这儿。）
     *
     * 以前这里只认关键词，浮层开着的时候按 Esc 会**穿透到宿主**，
     * 结果是「整个插件退回搜索页，弹框下次进来还在」—— 而弹框又因为样式串味没有按钮，
     * 人就被卡死了。浮层开着的那次 Esc，必须先收浮层。
     *
     * 能不能真的拦住宿主，取决于上面那个捕获监听器（它负责抢先 preventDefault）；
     * 两个一起才成立：捕获那边负责「别让宿主抢跑」，这里负责「到底退哪一层」。
     */
    if (settingsOpen.value) {
      e.preventDefault()
      settingsOpen.value = false
      return
    }

    if (keyword.value) {
      e.preventDefault()
      // 带前缀又带关键词时，先只扔关键词、留下分类，再按一次才清分类。
      // 用 cat 而不是 type 判：收藏也是个真分类（type 是 null，判不出来）。
      if (cat.value !== 'all' && query.value.text) writeQuery(prefixOf(cat.value))
      else clearSearch()
    }
    return
  }

  e.preventDefault()

  /*
   * ⌘1–⌘9 秒贴：直接粘**本屏**第 N 行（从屏幕最上面那一行数起），不经过选中态。
   * 翻页 / 下滑之后照样按 —— 这是 09-23 改的口径，见 `pasteAt()` 与 `lib/viewport.ts`。
   *
   * 放在 switch 前面而不是塞一个 case：它是一族（九条）动作，塞进 switch 只能靠 default 兜，
   * 而 default 的站位又容易读错。判定本身在 `lib/keys.ts` 的 `withMod` 里，这里只取下标。
   *
   * ⚠️ 它跟 ⌘K 一样**要求焦点已经在插件里**（数字键不在宿主那六个键的白名单里）。
   */
  const slot = pasteSlot(action)
  if (slot !== null) {
    void pasteAt(slot)
    return
  }

  switch (action) {
    case 'up':
      // 一按方向键就是"我在用键盘浏览" —— 把焦点从搜索框让给插件，
      // 否则后面的 ⌘K / ⌘C / ⌘L / Delete 都到不了这里（详见 takeKeyboard 上面的说明）。
      // `!e.repeat` 挡的是长按连发：连发时焦点早让过去了，没必要每帧来一次同步 IPC。
      if (!e.repeat) takeKeyboard()
      move(-1)
      break
    case 'down':
      if (!e.repeat) takeKeyboard()
      move(1)
      break
    case 'pageDown':
    case 'pageUp':
      /*
       * 翻一屏。
       *
       * `takeKeyboard()` 只有 `⌘↓` / `⌘↑` 这条来路用得上 —— 它俩是宿主从搜索框
       * 转发过来的，按下去的时候焦点还在搜索框。`PageDown` / `PageUp` 不在那六个
       * 转发键里，能走到这儿就说明焦点已经在插件里了，这一下等于空跑。
       * 跟 ↑↓ 同一个目的：**从这一下起算"我在用键盘浏览"** ——
       * 不然后面按 ⌘K / ⌘C / Delete 还是收不到（详见 takeKeyboard 上面的说明）。
       *
       * ⚠️ 跟 ↑↓ 一样用 `!e.repeat` 挡住长按连发：连发时焦点早就过去了，
       *    没必要每帧来一次同步 IPC。
       * ⚠️ 但**不挡** `e.repeat` 本身 —— 长按一路翻下去正是想要的，
       *    跟 ←→ 那种"直接落库"的键不是一回事。
       */
      if (!e.repeat) takeKeyboard()
      pageMove(action === 'pageDown' ? 1 : -1)
      break
    case 'enter':
      void pasteActive()
      break
    case 'remove':
      askRemove()
      break
    case 'backspaceSearch':
      // 退格：只退搜索框，不删数据（09-17 改，详见函数上的说明）
      backspaceSearch()
      break
    case 'focusSearch':
      focusSearch()
      break
    case 'copy':
      copyActive()
      break
    case 'favorite':
      void toggleFavorite()
      break
    case 'editFavorite':
      // ⌘E —— 行尾那颗 ✎ 的键盘并行路（它能被设置关掉，关掉之后只剩这条）
      editActive()
      break
    case 'addFavorite':
      // ⌘N —— 右下角那颗「新增」的键盘并行路（那颗按钮能被设置关掉，关掉之后只剩这条）
      addActive()
      break
    case 'toggleFavoritesView':
      // ⌘L 是 Tab 循环的捷径：一步跳到「收藏」那一站，再按一次退回「全部」
      writeQuery(prefixOf(view.value === 'favorites' ? 'all' : 'favorites') + query.value.text)
      break
    case 'cycleType':
      cycleType(1)
      break
    case 'cycleTypeBack':
      cycleType(-1)
      break
    case 'openSettings':
      // ⌘/ —— 底栏设成「全隐」之后，这是**唯一**开设置的路（所以它删不得）
      void openSettings()
      break
  }
}

/*
 * 面板里那几个键吃到之后干什么（09-18）。
 *
 * 三种控件、两套规矩：
 *   · 单选行（底色 / 强调色 / 选中项 / 底栏）：`←→` **移到哪一颗就是选中哪一颗** ——
 *     面板里的单选本来就是"光标即选中"，所以改个颜色只按一下。
 *   · 行尾那一行是**多选**（类型 / 序号各自独立、可以都开也可以都关）：
 *     `←→` **只挪光标**，`Enter` 才切那一颗。"移到哪颗就点亮哪颗"在这儿是错的 ——
 *     从类型滑到序号会顺手把序号也点亮。
 *   · 开关行：`←→` 就是往左拨（关）/ 往右拨（开）。
 * `↑↓` 一律只换行 —— 落点重算成那一行的当前值，不落值。判定全在 `lib/panel.ts`（有单测）。
 */
type PanelKey = 'up' | 'down' | 'left' | 'right' | 'enter'

function panelKey(action: PanelKey): void {
  if (action === 'enter') {
    const patch = toggleAt(settings.value, cur.value)
    if (patch) updateSettings(patch)
    scrollCursorIntoView()
    return
  }

  if (action === 'up' || action === 'down') {
    cur.value = moveRow(cur.value, action === 'up' ? -1 : 1, settings.value)
  } else {
    /*
     * 先按**旧**光标算该落什么值、再挪光标：`movePatch` 自己会算目标格，
     * 到边了（根本没挪动）它回 null —— 那时候什么都不该写。
     */
    const patch = movePatch(cur.value, action === 'left' ? -1 : 1)
    if (patch) updateSettings(patch)
    cur.value = moveSlot(cur.value, action === 'left' ? -1 : 1)
  }
  scrollCursorIntoView()
}

/** 模板里认「这一格是不是光标」：行名 → 行号只认行表那一份，**模板不许写行号** */
function isCur(id: string, slot: number): boolean {
  return cur.value.row === rowIndex(id) && cur.value.slot === slot
}

/**
 * 把光标滚进视野。
 *
 * 面板内容比窗口高的时候必须滚一下（强调色那 13 颗占两行，窗口拉矮了就到屏幕外了），
 * 否则按 ↓ 之后光标跑去看不见的地方，人就不知道它去哪了。
 * `block: 'nearest'`：已经在视野里就一动不动 —— 不然每按一下整块面板都跟着跳。
 */
function scrollCursorIntoView(): void {
  void nextTick(() => {
    document.querySelector('.sheet .cur')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

/* ---------------------------------------------------------------- 生命周期 */

/**
 * 把所有浮层收干净：确认框、设置面板。
 *
 * 单独拎出来，是因为它有三个触发源，而且**故意冗余**：
 *   1. 插件退出 / 重新进入（宿主发的 PluginOut、PluginEnter）；
 *   2. 窗口失焦 —— 「鼠标点了别的软件」就是这个信号；
 *   3. 页面可见性变化 —— 视图被宿主藏起来再放出来。
 * 宿主只保证发进出事件，但视图被隐藏时渲染进程可能被冻结，回调不保证按顺序落地。
 * 多挂两根绳子，"上次那个弹框还赖在那儿" 就不会再发生。
 */
function closePopovers(): void {
  confirmBox.value = null
  settingsOpen.value = false
}

/** 窗口失焦 —— 点了别的软件、宿主被切走，浮层就不该再挂着 */
function onWindowBlur(): void {
  closePopovers()
}

/** 页面从隐藏变可见（或反过来）—— 重新露出来的第一件事就是把上次的浮层收掉 */
function onVisibilityChange(): void {
  closePopovers()
}

function resetSession(): void {
  keyword.value = '' // 前缀也一并清掉（前缀就存在关键词里）—— 顺带把视图带回「全部」
  activeKey.value = ''
  hidePeek()
  closePopovers()
}

function scrollActiveIntoView(): void {
  const el = listRef.value?.querySelector('.row.on')
  el?.scrollIntoView({ block: 'nearest' })
}

watch(activeKey, () => {
  void nextTick(() => {
    scrollActiveIntoView()
    // `scrollIntoView` 可能刚把列表挪了（光标走出视口时）⇒ 屏首重采一次，
    // 不然 ⌘1 还指着挪之前的第一行
    remapScreenTop()
    schedulePeek(PEEK_DELAY_MOVE)
  })
})

// 列表整体换了（改搜索词、切收藏视图）就没什么可锚的，直接收掉；
// 顺带把渲染窗口收回最小 —— 不然在上一个分类里滚出来的几十批行会一直挂在 DOM 上
watch([view, keyword], () => {
  hidePeek()
  renderLimit.value = RENDER_STEP
  // 换了内容就等于回到顶（渲染窗口一收，滚动位置也没了）⇒ 屏首归零
  void nextTick(remapScreenTop)
})
// 弹出确认框时也别留着浮层压在下面
watch(confirmBox, hidePeek)

/*
 * ★ 底栏那一行的**高度**变了，两件事都得跟着重采 —— 所以并成**一个** watcher。
 *
 * 高度会变的原因有四个（都在这条 watch 里）：
 *   · 换了形态（`foot`）：常驻 ⇄ 淡入 ⇄ 全隐，占不占高度就变了；
 *   · 「底栏按键提示」多选变了：提示多了会**换行**（09-24 起允许）⇒ 两行甚至三行；
 *   · 「底栏按钮」多选变了：少一颗按钮 ⇒ `.hints` 反而变宽 ⇒ 可能又不用换行了；
 *   · 切了视图 / 开关设置面板：`⌘E 编辑` / `⌘N 新增` 这两条提示只在收藏视图出现，
 *     而面板开着时底栏要**让出右边一条**（`.root.sheet-open .foot`）⇒ 变窄也更容易换行。
 *
 * 为什么要重采：
 *   ① `footH` —— 「淡入」档的浮现判定范围必须等于真实高度（不然第二行点不到，
 *      见 `onPointerMove` 与 `FOOT_REVEAL_FALLBACK` 的说明）；
 *   ② `screenTop` —— 常驻档下底栏多占一行，列表就少一行，**屏首会跟着挪**
 *      （`pageRows()` 数的是真正渲染出来的 `.row`），而 `⌘1`–`⌘9` 和行尾那枚序号
 *      都按 `screenTop` 算。不重采的话：勾一条提示，⌘1 就指错一行，而且不报错。
 *
 * ⚠️ 两个 must 在**同一个** `nextTick` 里、按这个先后跑：`.hints` 先换成新高度，
 *    列表才跟着变矮，屏首才量得准。
 */
watch(
  [
    settingsOpen,
    view,
    () => settings.value.foot,
    // 用 `join()` 而不是 `.length`：勾掉「删除」、勾上「秒贴」条数一样，但**宽度差很多**
    () => settings.value.footHints.join(),
    () => settings.value.footButtons.join()
  ],
  () => {
    void nextTick(() => {
      measureFoot()
      remapScreenTop()
    })
  }
)

onMounted(async () => {
  await attachSubInput()
  await Promise.all([
    reload(),
    refreshFavorites(),
    loadSettings().then((s) => {
      settings.value = s
      // 设置读出来之后再落一次：主题 / 强调色的覆盖以这里为准
      applyTheme(s)
    })
  ])

  window.addEventListener('keydown', onKeydown)
  // Esc 的抢跑必须走捕获阶段，不然会被宿主 preload 里那个冒泡监听器抢先（详见 onKeydownCapture）
  window.addEventListener('keydown', onKeydownCapture, true)
  window.addEventListener('mousedown', onWindowMouseDown)
  window.addEventListener('mousemove', onPointerMove)
  // 列表滚动的坐标会失效，用捕获听着（scroll 不冒泡）
  window.addEventListener('scroll', onAnyScroll, true)
  window.addEventListener('resize', onViewportChange)
  // 失焦、以及页面被宿主藏起来/放出来：都收浮层，别让弹框跨过"插件不在前台"这段时间活着
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibilityChange)

  // 底栏高度先量一次（上面那条 watch 只在它**变**的时候才跑，开机这一趟得自己来）：
  // 「淡入」档的浮现判定和常驻档下屏首的位置都按它算。
  void nextTick(measureFoot)

  void zt().clipboard.onChange(() => {
    if (view.value === 'history') scheduleReload()
  })
  void zt().onPluginEnter(() => {
    resetSession()
    void reload()
    void refreshFavorites()
  })
  void zt().onPluginOut(() => {
    resetSession()
    // 走同一个出口：清空那个框，写不进去也无所谓（下次打开会对齐）
    writeSubInput('')
  })
})

onUnmounted(() => {
  /*
   * 这里必须跟 onMounted 一一对应 —— 之前 resize 注册的是 onViewportChange、
   * 卸的却是 hidePeek，等于没卸掉（mousemove 也漏了）。平时看不出问题，
   * 但 dev 模式下组件被热替换重挂时，旧的监听器会留下来继续跑，行为就变得没法解释。
   */
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('keydown', onKeydownCapture, true)
  window.removeEventListener('mousedown', onWindowMouseDown)
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('scroll', onAnyScroll, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('blur', onWindowBlur)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.clearTimeout(reloadTimer)
  window.clearTimeout(peekTimer)
  window.clearTimeout(favFlashTimer)
})

</script>

<template>
  <div ref="rootRef" class="root" :class="['mark-' + settings.mark, { 'sheet-open': settingsOpen }]">
    <div v-if="rows.length" ref="listRef" class="list">
      <!-- ⚠️ 面板开着时列表的「选中」要收起来（`!settingsOpen`）—— **一屏只留一个选中，它在面板里**
           （老大 09-18 真机提的）。收掉的只是这一个类，`activeKey` 一点没动：面板不是模态，
           `⌘1`–`⌘9` 秒贴、`Delete` 删的仍然是这一行。
           ⚠️ **别改成用 CSS 收**（写 `.sheet-open .row.on { … }` 那种）：mark 三档 + 实心档那组
              "行内零件全覆盖"（`.t` / `.thumb` / `.tag` / `.num` / `.src` / `.act`）都得跟着逐条
              抵消，漏一处就是"面板开着、那一行的字还反着白"——白字铺在透明底上等于看不见。 -->
      <div
        v-for="(row, i) in visibleRows"
        :key="row.key"
        class="row"
        :class="{
          on: !settingsOpen && row.key === activeKey,
          tall: row.data.type !== 'text',
          'fav-flash': !!favFlash && favFlash.key === row.key
        }"
        @click="onRowClick(row)"
        @dblclick="onRowDblClick(row)"
      >
        <!-- ⚠️ 这一格是**三岔、且顺序不能换**的：缩略图（有图才出）→ 文件图标 → 图片占位图标。
              倒数第二条按 `type === "file"` 兜，所以"图片扩展名的文件"一旦读不出来（文件被删/
              挪走），掉到的是**文件图标** —— 正是它该有的样子，不会变成破图。
              最后那条才轮到 `type === "image"`：它专管"图片记录读不出来"（宿主那份 png 被
              清掉了），用的是同一个 `.thumb` 但里头放的是占位 svg。 -->
        <img
          v-if="row.thumb && !brokenThumbs.has(row.key)"
          class="thumb"
          :src="row.thumb"
          alt=""
          loading="lazy"
          decoding="async"
          @error="markBroken(row.key)"
        />
        <!-- 文件行。普通文件走这个图标；**单个图片扩展名的文件**由上面那条 `<img>` 先接走
             （`fileThumbSrc` 认 .png/.jpg/…，判定和名单都在 `lib/clipboard.ts`）。
             类型标签照旧是「文件」—— 它确实还是个文件，只是长出了缩略图。 -->
        <div v-else-if="row.data.type === 'file'" class="ficon">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
            <path d="M9.3 2.3H4.9a1.4 1.4 0 0 0-1.4 1.4v8.6a1.4 1.4 0 0 0 1.4 1.4h6.2a1.4 1.4 0 0 0 1.4-1.4V5.4z" />
            <path d="M9.3 2.3v3.1h3.2" />
          </svg>
        </div>
        <div v-else-if="row.data.type === 'image'" class="thumb">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <rect x="2.2" y="3.3" width="11.6" height="9.4" rx="1.7" />
            <circle cx="5.7" cy="6.6" r="1.05" />
            <path d="M2.6 11.1l3.1-3 2.4 2.3 2.1-2.1 3.2 3.1" />
          </svg>
        </div>

        <!-- 行里那行字。命中的片段多铺一层强调色底（`.hl`）。
             ⚠️ 走片段数组、**不用 `v-html`** —— 剪贴板内容是不可信的：从网页复制来的
                东西本身就是一段 HTML，塞进 `v-html` 等于在插件里把它渲染出来。
             ⚠️ 整行必须写在一行里：`.t` 是单行省略号，标签之间多一个换行/缩进都会
                变成真实字符，白白挤掉一格。 -->
        <div class="t"><span v-for="(s, k) in row.seg" :key="k" :class="{ hl: s.hit }">{{ s.t }}</span></div>

        <!-- 行尾那一格。常驻四样，各自可以在设置里关掉：
               · 序号（**本屏前 9 行**）—— 配 ⌘1–⌘9 秒贴，屏上写着 3 的那行就是 ⌘3
               · 来源（VSCode / Chrome…）—— 这条是在哪个软件里复制出来的
               · 类型标签（文本 / 链接 / 图像 / 文件）
               · 操作按钮 —— 收藏 / 删除（09-21 起**各开各的**，原来「行尾按钮」一个总开关管两颗，
                 想要"只要收藏、不要删除"做不到）；**收藏视图里文本行还多一颗「编辑」**
                 （09-23 加，见下）。鼠标划过、或这行是当前行时出现（两者一致），
                 它出现时上面三样在这一格让位（同一个位置叠着，见下面对应的 CSS）
             按钮是 absolute 叠在这一格的右端、靠透明度切换，所以它出现/消失都不改行宽
             （`.tail-acts` / `-one` / `-three` 按**这一格要留几颗**给宽度）。
             常驻那几样全关、且不在收藏视图，就是彻底没有行尾。
             ⚠️ 序号由 `rowNums`（本屏前 9 行 → 1–9）算，**不是** `i + 1`：
                `i` 是它在整个列表里的位置，滚到第 3 屏就变成 13 打头了。
                口径必须跟 `pasteAt()` 完全一致（同一个 `screenNumbers`），
                另算一份迟早错位（按 ⌘3 粘到别的行）。
             按钮都得 .stop，不然点它们会连带触发行的 click（改选中）/ dblclick（复制）。 -->
        <div
          class="tail"
          :class="{
            'tail-acts': actsShown > 0,
            'tail-acts-one': actsShown === 1,
            'tail-acts-three': actsShown === 3
          }"
          @dblclick.stop
        >
          <span v-if="settings.tailIndex && rowNums.has(i)" class="num">{{ rowNums.get(i) }}</span>
          <!-- 来源排在类型标签**前面**：两个都是淡淡的纯文字，挨着放；类型标签是带底色的
               药丸，留在最右端当这一格的收尾。
               ⚠️ `row.source` 为空时**不渲染**（老数据 / 老收藏没有 appName）——
                  显示成「未知」等于凭空多一列。 -->
          <span v-if="settings.tailSource && row.source" class="src">{{ row.source }}</span>
          <span v-if="settings.tailType" class="tag">{{ row.label }}</span>
          <div v-if="actsShown" class="acts">
            <!-- ★ 编辑（09-23 加）：只在**收藏视图的文本行**上出。
                 · 只有收藏能编辑 —— 历史那一摊是宿主的账，插件改不了；
                 · 只有文本能编辑 —— 图片改不了那张 png，文件改路径其实是"换一个文件"，
                   都超出「编辑」两个字（理由写在 lib/favorites.ts 的 updateFavoriteText）。
                 它打开的是那块**输入浮层**，不是行内编辑（形状是老大 09-23 定的口径：
                 「新增和编辑都是弹出一个小框出来输入……弹框能展示全」）。
                 ⚠️ `.stop` 跟另外两颗一样，不挡的话点它会连带触发行 click（改选中）/ dblclick（复制）。
                 ⚠️ 它多占一颗的位置 —— 留位在 `actsShown` 那边（收藏视图按最多算），别在这儿动宽度。
                 ⚠️ 顺序跟设置面板「行尾操作」那一行一致（编辑 / 收藏 / 删除）——
                    `lib/panel.ts` 的 `tailActs.values` 就是这三个，改顺序要两边一起改。 -->
            <button
              v-if="view === 'favorites' && row.data.type === 'text' && settings.tailEdit"
              class="act"
              title="编辑"
              @click.stop="openComposer('edit', row.key)"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M2.9 13.1l.7-2.9 7.9-7.9 2.2 2.2-7.9 7.9z" />
                <path d="M10.2 3.6l2.2 2.2" />
              </svg>
            </button>
            <button
              v-if="settings.tailFav"
              class="act"
              :class="{ lit: row.favored }"
              :title="row.favored ? '取消收藏' : '收藏'"
              @click.stop="onRowFavorite(row)"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                <path d="M8 1.07L9.72 5.63L14.6 5.85L10.79 8.91L12.08 13.61L8 10.93L3.92 13.61L5.21 8.91L1.4 5.85L6.28 5.63Z" />
              </svg>
            </button>
            <button v-if="settings.tailDel" class="act danger" title="删除" @click.stop="onRowRemove(row)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <path d="M2.27 4.4H13.73" />
                <path d="M6.27 4.4V3.07A1.2 1.2 0 0 1 7.47 1.87H8.53A1.2 1.2 0 0 1 9.73 3.07V4.4" />
                <path d="M4.27 4.4L4.93 13.2A1.33 1.33 0 0 0 6.27 14.4H9.73A1.33 1.33 0 0 0 11.07 13.2L11.73 4.4" />
                <path d="M6.93 7.33V11.87" />
                <path d="M9.07 7.33V11.87" />
              </svg>
            </button>
          </div>

          <!-- 瞬时星：`⌘K` 收藏完那一下的回执，**只在行尾没有收藏按钮时**才需要
               （按钮开着的时候它自己会点亮 / 熄灭，再闪一颗就是同一句话说两遍）。
               ⚠️ 绝对定位、不进流：它是"刚成功了"的一句话，不该把行里的字挤走 ——
                  放进流里 `.tail` 会宽出一颗星、`.t` 跟着短一截，每次收藏都跳一下。
               ⚠️ `:key` 用次数：同一条连着按两次（收藏 → 取消）时元素没被卸载，
                  CSS 动画不会自己重播，换掉 key 才会真正重建一个。 -->
          <span
            v-if="favFlash && favFlash.key === row.key"
            :key="favFlash.n"
            class="favflash"
            :class="{ hollow: !row.favored }"
            aria-hidden="true"
          >
            <svg viewBox="0 0 16 16" stroke-linejoin="round">
              <path d="M8 1.07L9.72 5.63L14.6 5.85L10.79 8.91L12.08 13.61L8 10.93L3.92 13.61L5.21 8.91L1.4 5.85L6.28 5.63Z" />
            </svg>
          </span>
        </div>
      </div>
    </div>

    <div v-else class="empty">{{ emptyText }}</div>

    <!-- 详情浮层：浮在列表之上，不占列表的位置 -->
    <div v-if="peek && peekRow" class="peek" :style="peekStyle">
      <img
        v-if="peek.kind === 'image'"
        class="peek-img"
        :src="imageSrc(peekRow.data)"
        :style="peekImageStyle"
        alt=""
      />
      <div v-else-if="peek.kind === 'text'" class="peek-tx">{{ peekRow.data.content }}</div>
      <ul v-else class="peek-files">
        <li v-for="(f, i) in peekRow.data.files ?? []" :key="f.path + i">
          <span class="n" :class="{ gone: f.exists === false }">{{ f.name }}</span>
          <span class="p">{{ f.path }}</span>
        </li>
      </ul>
    </div>

    <!-- 底栏：**里面显示什么**全由设置里那两份多选决定（`footHints` / `footButtons`），
         而这一行**在不在、占不占高度**由「底栏」那三个形态档决定
         （常驻 / 淡入 / 全隐，见 lib/settings.ts 的 FootMode）。
         左边一条极淡的键位提示（键位不写在界面上就没人知道），右边几颗入口。
         ⚠️ 「全隐」档下这一整块**不渲染** —— 连提示带按钮一起没有，
            那时开设置只剩 `⌘/`（README 里写着这条退路）。
         「收藏」也提示：⌘K 是收藏当前项**唯一**的键盘入口（⌘D 被宿主拦给「分离插件」，
         界面改不掉），这条路径不给提示就等于没有。
         「⌘1–⌘9」也提示（09-17 老大提的，原话「怎么老是忘记这个」）：这一族键在界面上
         **一处都没有** —— 行尾那列「序号」默认还是**关**的，等于连"行尾有号码"这条线索
         默认也没有；不写进底栏它就跟不存在一样。⚠️ 序号关掉只是**看不见号码**，
         键本身一直在（取的是**本屏**前 9 行，见 `pasteAt()` 与下方 tail 那段）。
         它排在 Enter 后面：两条都在说"粘贴"（Enter 粘选中的那条，⌘1–9 粘本屏第 N 行）。
         ⚠️ 键帽里只写一个修饰键（`⌘1–9` / Windows `Ctrl+1–9`）—— 写成 `⌘1–⌘9` /
         `Ctrl+1–Ctrl+9` 光这一个键帽就要 112px，那一排本来就最紧（见下）。
         「设置」也提示：⌘/ 原先在整个界面上**一处都没写** —— 只在设置面板里那句
         「全隐 = 只能按 ⌘/ 开设置」的解释里提过（09-17 面板去文案后**连那句也没了**）。
         修饰键写法跟平台走（mac ⌘ / 其它 Ctrl），走 lib/platform.ts 的 modKey()——
         Windows 键盘上没有 ⌘ 键，硬写 ⌘ 那边看不懂。
         「删除」也提示（09-23 加的）。为它**挤掉了「Esc 返回」**：
         Esc 是通用键、好猜（README 里照旧列着），而删除原先在界面上只有行尾那枚 🗑 ——
         那只对鼠标有意义，**键盘删除（Delete / ⌘⌫）一处都没写**。
         ★ 09-24 **「Esc 返回」又回到候选表**（当时是第 11 条，排在最末）—— 换掉它的唯一理由是
         "那排塞不下"，而 09-24 起放不下会换行 ⇒ 理由没了。它默认不勾（见 settings.ts
         里 `DEFAULT_FOOT_HINTS` 那段取舍），想要的人勾上就行。
         ⚠️ 底栏**没显示**某条提示 ≠ 那条没给全：候选表是 `FOOT_HINTS`（15 条，= 界面上
         所有能按的键），默认只勾其中 8 条。"给全了没"要对着 `FOOT_HINTS` 看，不是对着这一排看。
         ⚠️ 「编辑」和「新增」**只在收藏视图出现**（跟右下角那颗「新增」按钮同一个口径：
             这儿没有的东西就不写）—— 见 `HINT_VIEW_ONLY`。
             ⌘E 只在收藏视图管用；⌘N 新增出来的东西也落在收藏里。

         ── 换行（09-24 老大提的） ────────────────────────────────────────────
         ★ 这一排从"定宽预算、超了从右边静默截断"改成了**放不下就换行**。
         起因是它在设置面板开着的时候会被截掉一半（`.root.sheet-open .foot` 要让出
         `--sheet-w` 那 300px，可用宽度掉到 ~448）—— 而那正是他在挑提示的时候。
         现在勾多了就是两行、三行，一条都不会少。
         ⚠️ 换行带来的**三处连带**（都是改错了不报错的那种，别漏）：
           ① `.foot` 的 `align-items` 改成了 `flex-end` —— 两行时那几颗按钮要落在**最后一行**
              上（不然它们悬在中间，读起来像掉队）；写法见样式那段。
           ② 「淡入」档的浮现判定范围必须**量底栏的真实高度**（`footH` / `measureFoot`）——
              还按写死的 30 判，第二行就"看得见点不到"。
           ③ 常驻档下底栏高一行，列表就少一行 ⇒ **屏首会挪**，`screenTop` 得跟着重采
              （不然 ⌘1–⌘9 和行尾那枚序号一起指错）。这三处都在那条
              `[settingsOpen, view, foot, footHints, footButtons]` 的 watch 里收口。
         ⚠️ 宽度预算仍然要算，只是不再是"超了就没了"：一行里能放几条决定的是**换不换行**，
            所以**默认那 8 条**在 Windows 上仍然是贴着边的 ——
            实测（清空取最长的「清空文本历史」⇒ 可用 624px）：**mac 526 ✅ 余 98；win 589 ✅ 余 35**；
            收藏视图（可用 598，见下面那段算式）win 余 9px。默认值就是照这一档挑的。
            量法：把 `.foot`/`.hints`/`kbd`/`.clr` 的样式抄进一个 800px 的 HTML，
            跑无头 Chrome `--dump-dom`，脚本把 `clientWidth` 与「各项宽之和 + 间隙」写进 DOM 再读。
         右边那颗「清空」的文案随分类变（清空历史 / 清空文本历史 / … / 清空收藏）——
         它就是清掉当前这一个分类里的东西，不随关键词变。 -->
    <div
      v-if="settings.foot !== 'none'"
      ref="footRef"
      class="foot"
      :class="{ fade: settings.foot === 'fade', on: footRevealed }"
    >
      <div class="hints">
        <!-- 画哪几条、什么顺序，全在 `footHintItems` 里（设置里那份数组 ⇒ FOOT_HINTS 的先后）。
             ⚠️ 这里**不许**再写一条 `v-if` 决定某条提示显不显示 —— 显不显示是用户勾的，
                唯一的例外是"本视图里没有意义的那两条"，那个判断在 `HINT_VIEW_ONLY`（computed 里）。
             每条的键帽 + 文字在 `FOOT_HINT_FACE` 里（`mod: true` 的走 modKey() 按平台给 ⌘ / Ctrl）。 -->
        <span v-for="h in footHintItems" :key="h.id"><kbd>{{ h.key }}</kbd>{{ h.label }}</span>
      </div>
      <!-- ★ 右边这几颗也全是多选（09-24 之前是写死的 + 一颗 `footAdd` 开关）：
           「设置」应用级 / 「新增」只动收藏那一摊 / 「清空」动当前分类。
           ⚠️ 三颗都可能在设置里被取消，包括「设置」—— 那时开面板只剩 `⌘/`。
           ⚠️ 「新增」**只在收藏视图**（历史视图没什么可"新增"），它跟 `⌘N` 那条提示同生死；
              而 `⌘N` 这个键**不归这里管**：取消按钮只是不画鼠标入口，键照旧能用
              （见 `addActive`）。
           ⚠️ 底栏仍然是**定宽预算**的（只是超了会换行）：它挤得进来，靠的是
              **收藏视图的「清空收藏」比最长的「清空文本历史」短两格**：
                内容区 772（800 − 左右各 14）
                − 3×12(间隙) − 38(设置) − 38(新增) − 62(清空收藏) = **可用 598**
                Windows 那排提示要 589 ⇒ **余 9px** ✅；mac 只要 526 ⇒ 余 72 ✅
                （老基线：历史视图可用 624，win 余 35）
                ⚠️ 取消一颗之后可用变大，那是**多出余量**，不用重算。
              ★ 中文标签字宽恒 1em（12px 字号 ⇒ 每字 12px），所以这几个数是**算准**的，
                跟字体无关；只有 `Ctrl+…` 那些拉丁串会随系统字体漂几 px。
              ⚠️ **再加一个入口 / 再加长某条提示之前，先把这条式子重算一遍**（更细的量法见 §47.2）。 -->
      <button v-if="settings.footButtons.includes('set')" class="clr set" @click="openSettings">
        设置
      </button>
      <button
        v-if="view === 'favorites' && settings.footButtons.includes('add')"
        class="clr add"
        @click="openComposer('new')"
      >
        新增
      </button>
      <button v-if="settings.footButtons.includes('clear')" class="clr" @click="askClear">
        {{ clearLabel }}
      </button>
    </div>

    <!-- 设置：宿主不给插件设置页，只能自己画一个。
         它贴在窗口右边一整条（top/right/bottom: 0），这次是**真占位置**的并排 ——
         打开时列表 / 空态 / 底栏按 `--sheet-w` 让出右边这一条（见样式里「设置面板」一节），
         所以它底下没有任何内容，也就不配压暗层：它是「面板」，不是「模态」。
         关掉的方式有三条：**点左边列表那一大片**（onWindowMouseDown 的 `!el.closest('.sheet')`）、
         **再点一次底栏那颗「设置」**（它现在没被面板盖住了）、或按 Esc（走 Esc 阶梯里那级）。 -->
    <div v-if="settingsOpen" class="sheet">
      <!--
        可滚的那一段，也是面板唯一的内边距盒子（见样式里 `.sheet` 那段说明）。

        ★ 09-17 起，**面板里只有控件、没有一句说明文字** —— 连标题「偏好设置」也去掉了。
          老大原话：「每一项的文字描述太多了……详细使用介绍可以在 README 里加上」。
          所以这里既没有 `.cap`、每个组下面也没有 `.hint`、开关下面也没有 `.ds`。
          **想解释某个设置是干什么的，改 README，别往这里加字。**
      -->
      <div class="sheet-body">
        <div class="grp">
          <div class="lbl">底色</div>
          <div class="dots">
            <button
              class="dot auto"
              :class="{ on: settings.bg === 'auto', cur: isCur('bg', 0) }"
              @click="updateSettings({ bg: 'auto' })"
            >
              默认
            </button>
            <button
              v-for="(p, i) in BG_PRESETS"
              :key="p.key"
              class="dot"
              :class="{ on: settings.bg === p.key, cur: isCur('bg', i + 1) }"
              :style="{ background: resolveBg(p.key, isDark) }"
              @click="updateSettings({ bg: p.key })"
            ></button>
          </div>
        </div>

        <div class="grp">
          <div class="lbl">强调色</div>
          <div class="dots">
            <button
              class="dot auto"
              :class="{ on: settings.accent === 'auto', cur: isCur('accent', 0) }"
              @click="updateSettings({ accent: 'auto' })"
            >
              默认
            </button>
            <button
              v-for="(k, i) in ACCENT_KEYS"
              :key="k"
              class="dot"
              :class="{ on: settings.accent === k, cur: isCur('accent', i + 1) }"
              :style="{ background: accentSwatch(k, isDark) }"
              @click="updateSettings({ accent: k })"
            ></button>
          </div>
        </div>

        <!--
          ────────────────────────────────────────────────────────────────
          ★ 09-17 老大要求：按「控件类型」分三段，段内按行长**从短到长**（短的在上面，逐级变宽）。
            ① 色点段：底色（4 颗、一行）→ 强调色（13 颗、两行）
            ② 多选段：行尾操作（3 颗）→ 行尾显示（3 颗）→ 选中项（3 颗）
                      → 底栏（3 颗）→ 底栏按钮（3 颗）→ 底栏按键提示（15 颗）
            ③ 开关段：显示详情 / 删除前确认
          为什么不按"主题"排（比如让「行尾操作」贴着「行尾显示」的另一半）：那样几种控件形状会一格一格
          交替出现 —— 色点、药丸、开关、药丸、开关…… 右边缘那一列开关被药丸行打断，看着毛躁。
          同形状的挨在一起，面板才有节奏。段与段之间靠 `.blk` 多留一点空。

          ⚠️ **方向是「短 → 长」**，别搞反（我第一版就做反了）：老大原话「为什么不是每个类都是从
             短到长呢，你是从长到短」。他给的判据很直接 —— 底色段 4 颗在 13 颗上面、行尾那几颗在
             底栏那几颗上面。别再拿"重的放上面更稳"这种直觉改回长→短。
             （09-18 行尾加了第 3 颗「来源」之后，行尾和选中项都是 3 颗 —— 这一段平了，
              两行谁前谁后都不违背判据，所以**保持原样不动**，别为"凑成一个严格递增"去调顺序。）
          ⚠️ 09-21「行尾按钮」从开关拆成「行尾操作」（收藏 / 删除两颗药丸）之后，
             它从**开关段**搬进了**多选段**：按短→长排在「行尾显示」（3 颗）**前面**。
             别按"先显示后操作"的语序把它俩对调 —— 那是往回走（`panel.ts` 里也写着这条）。
          ⚠️ 09-24 底栏那两行也照短→长排：**按钮（3 颗）在按键提示（15 颗）前面**。
             反过来就是 15 → 3 的下降，"逐级变宽"当场破掉。两行都是底栏的东西，挨着放正好。
          ⚠️ 开关段只剩两行，宽度完全一样（"左标题 + 右侧开关"的满宽行），按颗数没有可排的；
             按**标签字数**排也不减：显示详情 4 / 删除前确认 5。
             （09-23 那行「新增按钮」**已撤** —— 它并进了上面「底栏按钮」那颗药丸里。）
        -->
        <!-- 行尾**操作**：编辑 / 收藏 / 删除三颗按钮，各开各的（三颗都关 = 鼠标没有操作入口，
             编辑只剩 ⌘E、收藏只剩 ⌘K、删除只剩 Delete —— 老大 09-21 要的就是这个自由度）。
             跟下面「行尾显示」一样是**多选**：点一下选上、再点一下取消，三颗互不顶掉。
             ⚠️ 这三颗的**先后必须跟 `panel.ts` 里 `PANEL_ROWS.tailActs.values` 的顺序一致**，
                而且**跟行尾那三颗从左到右的先后也一致**（编辑 / 收藏 / 删除）——
                面板和列表读同一句话，别在这儿按"哪个重要"重排。
             ★ 「编辑」（09-23 加）：关掉之后行尾那颗 ✎ 就不出了（它本来也只在收藏视图的
                文本行上出现），编辑改走 `⌘E`。 -->
        <div class="grp blk">
          <div class="lbl">行尾操作</div>
          <div class="chips">
            <button
              class="chip"
              :class="{ on: settings.tailEdit, cur: isCur('tailActs', 0) }"
              @click="updateSettings({ tailEdit: !settings.tailEdit })"
            >
              编辑
            </button>
            <button
              class="chip"
              :class="{ on: settings.tailFav, cur: isCur('tailActs', 1) }"
              @click="updateSettings({ tailFav: !settings.tailFav })"
            >
              收藏
            </button>
            <button
              class="chip"
              :class="{ on: settings.tailDel, cur: isCur('tailActs', 2) }"
              @click="updateSettings({ tailDel: !settings.tailDel })"
            >
              删除
            </button>
          </div>
        </div>

        <!-- 行尾**显示**：**多选**（跟色点一样是「点一下选上、再点一下取消」，区别只是这里能同时选好几个）。
             都不选 = 行尾什么都没有。序号 / 来源 / 类型是三件独立的事，不该互相顶掉 —— 不做成三选一。
             ⚠️ 三颗的**先后必须跟 `panel.ts` 里 `PANEL_ROWS.tail.values` 的顺序一致**：
                `←→` 挪的是第几颗、`Enter` 切的就是 `values[第几]` 那个键，错位就会静默切错开关。
                改顺序要么两边一起改，要么别改（`tests/panel.test.ts` 钉着这条）。 -->
        <div class="grp">
          <div class="lbl">行尾显示</div>
          <div class="chips">
            <button
              class="chip"
              :class="{ on: settings.tailType, cur: isCur('tail', 0) }"
              @click="updateSettings({ tailType: !settings.tailType })"
            >
              类型
            </button>
            <button
              class="chip"
              :class="{ on: settings.tailIndex, cur: isCur('tail', 1) }"
              @click="updateSettings({ tailIndex: !settings.tailIndex })"
            >
              序号
            </button>
            <button
              class="chip"
              :class="{ on: settings.tailSource, cur: isCur('tail', 2) }"
              @click="updateSettings({ tailSource: !settings.tailSource })"
            >
              来源
            </button>
          </div>
        </div>

        <div class="grp">
          <div class="lbl">选中项</div>
          <div class="chips">
            <button
              v-for="(m, i) in MARK_CHOICES"
              :key="m.v"
              class="chip"
              :class="{ on: settings.mark === m.v, cur: isCur('mark', i) }"
              @click="updateSettings({ mark: m.v })"
            >
              {{ m.label }}
            </button>
          </div>
        </div>

        <!-- 底栏**形态**：这一行在不在、占不占高度（常驻 / 淡入 / 全隐）。
             ★ 09-24 从四档收成三档 —— 老第四档「精简」退休了：它的意思就是
                "整排键位提示一条不留"，而那件事现在由下面「底栏按键提示」表达
                （一条都不勾）。同一个意思留两个说法迟早自相矛盾。
             ⚠️ 老值 'full' / 'lean' 由 `lib/settings.ts` 的 `footOf()` 迁成 'always'
                （'lean' 还要把 `footHints` 一起清空，见 `footHintsOf`）。 -->
        <div class="grp">
          <div class="lbl">底栏</div>
          <div class="chips">
            <button
              v-for="(f, i) in FOOT_CHOICES"
              :key="f.v"
              class="chip"
              :class="{ on: settings.foot === f.v, cur: isCur('foot', i) }"
              @click="updateSettings({ foot: f.v })"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <!-- 底栏右边那几颗入口（09-24 加，老大提的「底栏右侧的按钮做到设置里可多选控制展示哪些」）。
             ★ 09-23 那颗单独的「新增按钮」开关并进了这里 —— 当初它管的事
                （「右下角的新增可不可以也加到设置里面去控制是否显示」）就是这一组里的一颗。
             ⚠️ 三颗的**先后必须跟 `panel.ts` 里 `PANEL_ROWS.footButtons.values` 一致**
                （= `FOOT_BUTTONS`：设置 / 新增 / 清空）—— 面板、库里存的数组、底栏三处同一句话。
             ⚠️ 三颗**都可以取消**，包括「设置」：取消之后开面板只剩 `⌘/`（README 里写着退路）。 -->
        <div class="grp">
          <div class="lbl">底栏按钮</div>
          <div class="chips">
            <button
              v-for="(b, i) in FOOT_BUTTONS"
              :key="b"
              class="chip"
              :class="{ on: settings.footButtons.includes(b), cur: isCur('footButtons', i) }"
              @click="toggleFootButton(b)"
            >
              {{ FOOT_BUTTON_FACE[b] }}
            </button>
          </div>
        </div>

        <!-- 底栏左边那排键位提示（09-24 加）—— 跟「行尾显示」一样是多选，**15 条**里随便挑，
             一条都不勾也行（那就是以前那个「精简」档的观感）。
             ★ 09-24 起底栏**放不下会换行**，所以 `⌘/ 设置` 和 `⌘N 新增` 这两条也回来了
                —— 以前是"拿一条换一条"挤出来的（Windows 上 8 条只剩 9px）。
             ★★ **这一组现在是"界面上所有能按的键"的完整清单**（老大 09-24 的定案，
                原话「我们系统现在有的按键都应该加进去啊」）—— 分两批补齐：
                  第一批 第 11 条 `Esc 返回`（09-23 为给「Delete 删除」腾地方被换掉的那条）；
                  第二批 `复制 ⌘C` / `收藏夹 ⌘L` / `搜索 ⌘F` / `退格 Backspace`。
                「故意不收的」只有两类（←→ 只面板用、以及 PageDown/⌘⌫/`/` 这种别名），
                判据写在 `lib/settings.ts` 的 `FOOT_HINTS` 那段注释里。
                ⇒ **别再拿"放不下了"当理由删任何一条，也别再漏新的键**：新的键要同批加进来。
             ⚠️ 面板药丸**不是**"勾上的样子" —— 没勾的那几颗是灰的（`chips` 的 `.on` 管颜色），
                灰 ≠ 没给全。老大 09-24 连问两次「给全了吗 / Esc 返回呢」，看的就是这一组。
             ⚠️ 本面板是**窄条**（`--sheet-w` 300px，减去左右内边距只剩 268），
                15 颗药丸**一定会换行** —— `.chips` 上的 `flex-wrap: wrap` 就是为这一行加的，
                少了它药丸会溢出到面板外面被 `overflow-x: hidden` 裁掉（不报错，只是后半截看不见）。
             ⚠️ 「编辑」「新增」两条**只在收藏视图显示**（跟随视图，不是面板不认勾）——
                解释在 `App.vue` 的 `HINT_VIEW_ONLY` 那段。 -->
        <div class="grp">
          <div class="lbl">底栏按键提示</div>
          <div class="chips">
            <button
              v-for="(h, i) in FOOT_HINTS"
              :key="h"
              class="chip"
              :class="{ on: settings.footHints.includes(h), cur: isCur('footHints', i) }"
              @click="toggleFootHint(h)"
            >
              {{ FOOT_HINT_FACE[h].label }}
            </button>
          </div>
        </div>

        <button
          class="opt blk"
          :class="{ cur: isCur('peek', 0) }"
          @click="updateSettings({ peek: !settings.peek })"
        >
          <span class="nm">显示详情</span>
          <span class="sw" :class="{ on: settings.peek }"><i /></span>
        </button>

        <!--
          ⚠️ 关掉之后**没有撤销**：宿主删了就删了，图像连磁盘文件都会一起 unlink。
          这句提醒已经**从面板挪进 README**（老大要求面板不写文案）——
          以后改这块时别顺手写出"关了也找得回来"之类的说法。只管单条，清空永远会问。
        -->
        <button
          class="opt"
          :class="{ cur: isCur('confirmDelete', 0) }"
          @click="updateSettings({ confirmDelete: !settings.confirmDelete })"
        >
          <span class="nm">删除前确认</span>
          <span class="sw" :class="{ on: settings.confirmDelete }"><i /></span>
        </button>
      </div>
    </div>

    <!-- 新增 / 编辑收藏：一块居中的输入浮层。
         形状按老大 09-23 定的口径来 —— 原话「我希望交互，新增和编辑都是弹出一个小框出来输入，
         而不是直接在项上面，因为每一项可能展示不全。弹框能展示全」。**别改成行内编辑。**
         ⚠️ 它跟确认框一样是**模态**（`.mask` 铺满窗口、挡住底下的列表），但**故意不挂
            `@click.self`**：里面可能已经敲了一段字，点歪一下就丢，代价比"少一条关法"大得多。
            关法就两条：`Esc` / 「取消」按钮。键盘那一路（含 Tab 焦点陷阱）在 onKeydown 开头。 -->
    <div v-if="composer" class="mask">
      <div class="box composer">
        <p class="msg">{{ composer.mode === 'edit' ? '编辑收藏' : '新增收藏' }}</p>
        <!-- `textarea` 不是 `input`：单行框只能横向滚，长的备忘照样看不全 —— 那就白弹了。
             高度靠 fitComposer() 跟着内容长。 -->
        <textarea
          ref="composerRef"
          v-model="composerText"
          class="ctx"
          spellcheck="false"
          :placeholder="composer.mode === 'edit' ? '' : '写下要记住的内容…'"
          @input="fitComposer"
        ></textarea>
        <!-- ★ 键位必须写在界面上（不然只有翻过 README 的人知道）。沿用全局那套 `kbd` 键帽；
             `⇧` 两个平台写法一样，不用走 modKey()。 -->
        <p class="ckey"><kbd>Enter</kbd>保存 · <kbd>⇧Enter</kbd>换行 · <kbd>Esc</kbd>取消</p>
        <div class="dlgacts">
          <button @click="closeComposer">取消</button>
          <button class="pri" :disabled="!composerText.trim()" @click="saveComposer">保存</button>
        </div>
      </div>
    </div>

    <!-- 确认框：**居中**（位置全在 `.mask` 那条 flex 里，JS 不参与）。
         那层 .mask 除了居中，还负责接"点别处关掉"；它不压暗整个界面 ——
         这个弹框只问一句话，没必要把整屏压暗。 -->
    <div v-if="confirmBox" class="mask" @click.self="confirmBox = null">
      <div class="box">
        <p class="msg">{{ confirmBox.text }}</p>
        <!--
          类名不能叫 .acts —— 行尾那两枚收藏/删除按钮的容器就叫 .acts，
          在同一个 scoped 样式表里，`.acts` 是「顶层单个类名」，
          编译出来都是 `.acts[data-v-x]`，两条规则会同时命中同一个元素：
          行尾那条带着 opacity:0 / pointer-events:none / position:absolute，
          会把确认框的按钮一起藏掉。所以这里换个名字，下面行尾那条也收窄成 .row .acts。
        -->
        <div class="dlgacts">
          <button @click="confirmBox = null">取消</button>
          <button class="pri" :class="{ danger: confirmBox.danger }" @click="runConfirm">确定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.root {
  position: relative; /* 详情浮层与设置面板的定位基准 */
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 设置面板的宽度。面板开着时列表 / 空态 / 底栏按这个值让位（见下面「设置面板」一节），
     面板自己也拿它当宽度 —— 两处必须是同一个数，不然让出来的地方面板填不满，
     底下会漏出一条还能被行铺到的缝。 */
  --sheet-w: min(300px, calc(100vw - 24px));
}

/* 列表 */
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 8px 4px;
}

.row {
  display: flex;
  align-items: center;
  gap: 9px;
  height: var(--row-h);
  padding: 0 var(--pad-x);
  margin-bottom: 1px;
  border-radius: var(--radius-md);
  box-sizing: border-box;
  /* 「底色」档那根左竖条的定位基准。
     ⚠️ 删了它，竖条会往上找到 `.root`（也是 relative）⇒ 跑到面板最左边去。
     行内别的东西不受影响：`.acts` 的基准是更近的 `.tail`（自己也是 relative）。 */
  position: relative;
  /*
   * ★ 120ms 低幅度缓动（09-17，老大提的）：**这里是全屏最高频的一处动效** ——
   * 鼠标扫过、按 ↑↓ 一行行挪，改的都是 background / box-shadow / color，
   * 之前是硬切（瞬时跳变），一屏几十行看着就"廉价"。
   *
   * ⚠️ **只给 `.row` 加，不给行内零件加**：实心档（mark-solid）铺满时字要反白，
   *    那牵涉 `.t` / `.thumb` / `.ficon` / `.tag` / `.num` / `.act` 六七个选择器，
   *    全加一遍又是一批散落声明；而行底色 120ms 滑过去时，字色那点瞬变基本看不出来。
   *    （真要让"字也滑"，落点是那几条**基础规则**，不是下面 `.row.on` 那些复合选择器 ——
   *      加在复合选择器上只有"退出选中"那一半会过渡，进去时仍然是硬切。）
   */
  transition: background 0.12s ease, box-shadow 0.12s ease, color 0.12s ease;
}
.row.tall {
  height: var(--row-h-tall);
}
.row:hover {
  background: var(--row-hover);
}
/* 当前行：具体长什么样由设置里的「选中项」决定（三种，各有人喜欢）。
   底色 —— 铺一层 13% 的淡主题色；
   描框 —— 不铺色，只在行里描一圈 1.5px 的主题色（用 inset 阴影而不是 border，
           不然行会因为多出的 1.5px 而抖一下）；
   实心 —— 整行铺满主题色、字反白。
           字色不是写死的白：深色主题的强调色是亮色（`#34d399` 这种），
           白字在上面只有 2:1 对比度、直接糊，所以用 theme.ts 算好的 `--row-on-tx`。 */
.root.mark-tint .row.on {
  background: var(--accent-soft);
}
/*
 * ★ 底色档的左竖条（09-17 晚老大定，方案 B）。
 *
 * 渊源别搞反：09-14 先做过「13% 淡底 + 左竖条」，真机上被老大撤了
 * （原话「为什么选中中会有个竖线，我感觉不好看」）；09-17 他又拿参考图重新提。
 * 这次的结论是**不新开档位，只并进「底色」档** —— 单为"一根线"多开一档，
 * 等于把同一个选择拆成两个，让人多纠结一次。
 *
 * ⚠️ 伪元素**常驻、只切 opacity**，不是写成 `.row.on::before`：
 *    后者会让竖条凭空出现，跟行底色那 120ms 的淡入对不上拍，切换时会"闪"一下。
 * ⚠️ 只有 tint 档有竖条。border 档描的就是一圈框、solid 档整行铺满，
 *    那两档再加一根竖条就是三层装饰 —— 别顺手给它们也来一根。
 * ⚠️ 竖条落在行内边距（`--pad-x: 9px`）里，占 0~3px，文字从 9px 起 ⇒ 天然留 6px，
 *    不需要给 `.t` 补 padding。
 * ⚠️ 圆角用 `--radius-pill`（阶梯内），**别顺手写 2px**：3px 宽的盒子上一写 2px 就跳出
 *    「圆角只有三档」那条红线（测试会红）。999px 在这么窄的盒子上会被按比例压到 1.5px，
 *    正好是两端半圆 —— 就是这张条子想要的样子。
 */
.root.mark-tint .row::before {
  content: '';
  position: absolute;
  left: 0;
  top: 5px;
  bottom: 5px;
  width: 3px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.root.mark-tint .row.on::before {
  opacity: 1;
}
.root.mark-border .row.on {
  background: transparent;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.root.mark-solid .row.on {
  background: var(--accent);
  color: var(--row-on-tx);
}
/* 实心行里的零件全得跟着反白 —— 它们平时用的是 --tx-1 / --tx-2，铺在深色底上会看不见 */
.root.mark-solid .row.on .t,
.root.mark-solid .row.on .ficon,
.root.mark-solid .row.on .thumb {
  color: var(--row-on-tx);
}
.root.mark-solid .row.on .thumb {
  background: rgba(var(--on-accent-rgb), 0.22);
}
/* 类型标签平时是 --tx-3 的灰字，铺在实心主题色上同样会糊 —— 一并反白 */
.root.mark-solid .row.on .tag {
  background: rgba(var(--on-accent-rgb), 0.18);
  color: var(--row-on-tx);
}
/* 序号和来源都没有那个底，只要反白 —— 漏一个，那一样在实心主题色上就是一团看不见的灰字 */
.root.mark-solid .row.on .num,
.root.mark-solid .row.on .src {
  color: var(--row-on-tx);
}
.root.mark-solid .row.on .act {
  color: rgba(var(--on-accent-rgb), 0.78);
}
.root.mark-solid .row.on .act:hover {
  background: rgba(var(--on-accent-rgb), 0.2);
  color: var(--row-on-tx);
}
/* 已收藏的星本来用 --accent 填色 —— 在实心行上等于自己填自己，得改成反白色 */
.root.mark-solid .row.on .act.lit,
.root.mark-solid .row.on .act.lit:hover {
  color: var(--row-on-tx);
}
.root.mark-solid .row.on .act.lit svg {
  fill: var(--row-on-tx);
}
/* 瞬时星同理：强调色底上填强调色的星 = 自己填自己，实心行里一律反白。
   ⚠️ 空心那颗（刚取消收藏）得把 fill 收回去，不然反白填满 = 看起来像"刚收藏"，
      反馈正好说反。特异性比上面那条多一个类，能盖住。 */
.root.mark-solid .row.on .favflash svg {
  stroke: var(--row-on-tx);
  fill: var(--row-on-tx);
}
.root.mark-solid .row.on .favflash.hollow svg {
  fill: none;
}
/* 删除键悬停本来是红色，铺在彩色实心底上会打架，统一走反白的深一层 */
.root.mark-solid .row.on .act.danger:hover {
  background: rgba(var(--on-accent-rgb), 0.34);
  color: var(--row-on-tx);
}

/* 内容本身 */
.t {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  line-height: 1.3;
  color: var(--tx-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/*
 * 搜索命中：给命中的那几个字铺一层强调色底（片段由 `splitHighlight` 切好，模板 `v-for` 出来）。
 *
 * 一律用**底色**表达、不动字色：动字色会跟「实心档整行反白」正面打架，
 * 而且中英混排里逐字换色读起来是断的。
 *
 * 两档轻重 —— 一屏只留一个重音：**当前行重、其余行轻**。
 * 不这样分的话，一列里每一行都有好几块同样重的色块，眼睛不知道该落哪。
 *
 * ⚠️ 这个底必须是**强调色的半透明层**（`rgba(var(--accent-rgb), …)`），不能写死一个色：
 *    强调色可能是宿主注入的（用户会在 ZTools 设置里换），硬写就跟宿主脱钩了。
 */
.t .hl {
  background: rgba(var(--accent-rgb), 0.26);
  border-radius: var(--radius-sm);
}
.row.on .hl {
  background: rgba(var(--accent-rgb), 0.5);
}
/*
 * 实心档要**反过来**：那一档整行铺的就是强调色，命中再铺一层强调色等于没标。
 * 所以这里改用"字色做底"——跟同档下缩略图底 `rgba(var(--on-accent-rgb), .22)`
 * 是同一套语言（见上面那组 mark-solid 覆盖），再加粗补一点份量。
 *
 * ⚠️ 只有实心档需要这条。描框档不铺底、底色档那 13% 还压得住 26% 的高亮，
 *    别顺手给它们也来一条（那就成了"三档三个样"，说不清为什么）。
 */
.root.mark-solid .row.on .hl {
  background: rgba(var(--on-accent-rgb), 0.28);
  font-weight: 700;
}

.thumb {
  flex: none;
  width: 32px;
  height: 24px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  background: rgba(127, 127, 127, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tx-2);
}
.thumb svg {
  width: 14px;
  height: 14px;
}

.ficon {
  flex: none;
  display: flex;
  color: var(--tx-2);
}
.ficon svg {
  width: 15px;
  height: 15px;
}

/* 行尾那一格。三样东西可以并存，各自能在设置里关掉：序号、类型标签、两枚按钮。
   两个标签是普通流里的元素；按钮是 absolute 叠在这一格右端、靠透明度切换 ——
   所以按钮出现/消失都不改行宽（`.tail-acts` 那 50px 就是给它留的）。
   按钮是鼠标唯一的操作入口（原先的右键菜单已删，功能跟这两枚按钮完全重复）；
   键盘用户走 Delete。两边是同一套逻辑。 */
.tail {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
  height: 22px;
  /* 行尾按钮那一格占多宽。平时 0（没有按钮），`.tail-acts` / `.tail-acts-one` 各自覆盖；
     瞬时星靠它停在按钮左边（见 `.favflash`）。 */
  --acts-w: 0px;
}
/*
 * 给行尾按钮留位 —— **开着几颗就留几颗**（09-21 拆成两颗独立按钮之后才有这回事）：
 * 两颗 22 + 2 + 22 = 46、一颗 22，各多给 4px 当缝隙。
 * 一颗都不开时这几 px 也该还回去，不然一块空留白会按"行尾"的直觉压着内容，白占地方。
 *
 * ⚠️ `--acts-w` 是**同一个数**留给瞬时星用的（它得停在按钮左边，不能压着「删除」）。
 * ⚠️ 两条的特异性一样（都是 `.tail.X`），靠**源码顺序**决出谁赢 ⇒ `-one` 必须排在后面。
 */
.tail.tail-acts {
  min-width: 50px;
  --acts-w: 46px;
}
.tail.tail-acts-one {
  min-width: 26px;
  --acts-w: 22px;
}
/*
 * ★ 三颗（09-23 加）：只有**收藏视图**会有 —— 编辑 + 收藏 + 删除。
 *   22×3 + 2×2(缝) = 70，再各给 4px 当缝隙。
 *
 * ⚠️ 它必须排在 `.tail-acts` **后面** —— 两条特异性一样（都是 `.tail.X`），
 *    靠源码顺序决出谁赢（理由同下面 `.tail-acts-one` 那条）。
 * ⚠️ 收藏视图里**所有行**都按三颗留位（`actsShown` 那边按最多算），
 *    哪怕图片/文件行上并没有「编辑」那颗 —— 不然两种行的行尾一宽一窄，`.t` 的右边界参差。
 */
.tail.tail-acts-three {
  min-width: 74px;
  --acts-w: 70px;
}
/* 序号：给 ⌘1–⌘9 用的，刻意做得很淡 —— 它是熟练之后的参考线，不是内容本身。
   tabular-nums 让每个数字占同样宽，几十行竖着排不会左右跳。 */
.num {
  color: var(--tx-3);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  transition: opacity 0.15s;
}
/*
 * 来源（VSCode / Chrome…）。跟序号同一档：**淡淡的纯文字**，不是内容本身 ——
 * 它是"这条从哪儿来"的参考线，不该跟正文抢注意力。
 *
 * ⚠️ 那三行截断必须有：`appName` 是**任意应用**给的，短名表只覆盖已知那几个，
 *    碰上一个长名字（"某公司内部工具.app"）这一格会把 `.t` 挤掉一大截。
 *    `.t` 是 `flex: 1; min-width: 0`，挤不破，但行会一眼看出来难看。
 */
.src {
  color: var(--tx-3);
  font-size: 11px;
  max-width: 84px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: opacity 0.15s;
}
.tag {
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  background: rgba(127, 127, 127, 0.1);
  color: var(--tx-3);
  font-size: 11px;
  line-height: 1.5;
  transition: opacity 0.15s;
}
/* 只作用于行尾：写成 .row .acts，别用顶层 .acts —— 同名会串到确认框的按钮上 */
.row .acts {
  position: absolute;
  top: 0;
  right: 0;
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
/*
 * ★ 两枚按钮的出场条件：**鼠标划过、或者「这行是当前行」—— 两者一模一样**。
 *
 * 09-17 晚回退过一次：中间有一版只跟 `:hover` 走，理由是"键盘流里点不到按钮，
 * 却把「这行是什么类型 / 序号几」盖掉了"。真机一看是错的 —— 同一行在两套输入下
 * 长得不一样，键盘选中的行右端空着一格（老大原话「真实选中行却没有显示出来，这是bug」）。
 * **现在 hover 与 `.on` 表现完全一致，别再让它们分叉。**
 *
 * ⚠️ 这条代价是有意接受的：开着「类型 / 序号」时，这两样在这一格上给按钮让位 ——
 *    那一格是 absolute 叠着的，二者只能取一；要"都看得见"就得给 `.tail` 永久加宽，
 *    那是拿**每一行**的文本宽度去换（整个列表都短一截），不划算。
 *
 * ⚠️ 淡出那两条必须带 `.tail-acts`：按钮关掉时若还留着淡出，
 * 标签会在鼠标划过 / 选中时凭空消失，而底下没有东西顶上来。
 */
.row:hover .tail-acts .tag,
.row.on .tail-acts .tag,
.row:hover .tail-acts .num,
.row.on .tail-acts .num,
.row:hover .tail-acts .src,
.row.on .tail-acts .src {
  opacity: 0;
}
.row:hover .acts,
.row.on .acts {
  opacity: 1;
  pointer-events: auto;
}
.act {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  /* 5 → 4（09-17 收圆角）：它属于「行内小件」那一档，跟缩略图 / 键帽 / 类型标签同档 */
  border-radius: var(--radius-sm);
  background: none;
  color: var(--tx-2);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.act svg {
  width: 14px;
  height: 14px;
}
.act:hover {
  background: rgba(127, 127, 127, 0.14);
  color: var(--tx-1);
}
/* 已收藏：星实心且跟主题色 */
.act.lit {
  color: var(--accent);
}
.act.lit svg {
  fill: var(--accent);
}
.act.danger:hover {
  color: var(--danger);
}

/*
 * ★ 行内瞬时星（09-21）：`⌘K` 收藏完之后，**行尾没有收藏按钮时唯一的反馈**。
 *
 * 形态就是行尾那枚 ☆（同一个 path、同样是实心 = 已收藏），只是它自己会淡掉 ——
 * 实心 = 刚收藏、空心 = 刚取消，跟按钮那套 `lit` 是同一个语义。
 *
 * ⚠️ **绝对定位、不进流**：它只是"刚才那一下成了"的一句回执，不该为此把行里的字挤走。
 *    放进流里（做成 `.tail` 的第一个孩子）`.tail` 会宽出一颗星、`.t` 跟着短一截 ——
 *    每收藏一次，你正看着的那行文字就跳一下。
 * ⚠️ `right` 让开按钮那一格（`--acts-w`）：收藏按钮关着的时候，「删除」可能正开在那儿，
 *    星落在它头上就是叠字。
 * ⚠️ 动画时长跟 JS 里的 `FAV_FLASH_MS` 是**同一个数**（`styles.test.ts` 钉着），
 *    改一个就得改另一个；`forwards` 保证放完停在透明上，不会"亮着一颗不走的星"。
 */
.favflash {
  position: absolute;
  top: 0;
  bottom: 0;
  right: calc(var(--acts-w) + 2px);
  display: flex;
  align-items: center;
  pointer-events: none;
  transform-origin: right center;
  animation: fav-flash 1.1s ease forwards;
}
/* 弹一下 → 停住 → 淡掉，总长就是 `FAV_FLASH_MS` */
@keyframes fav-flash {
  0% {
    opacity: 0;
    transform: scale(0.72);
  }
  14% {
    opacity: 1;
    transform: scale(1);
  }
  70% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
    transform: scale(1);
  }
}
.favflash svg {
  width: 11px;
  height: 11px;
  stroke: var(--accent);
  fill: var(--accent);
  stroke-width: 1.1;
}
/* 刚取消收藏：给一颗"熄灭"的空心星，别让反馈说反 */
.favflash.hollow svg {
  fill: none;
  stroke: var(--tx-2);
}
/*
 * 星亮着的那 1.1s 里，常驻那三样（序号 / 来源 / 类型）也让位 —— 跟按钮出场是同一套做法，
 * 星就落在它们原来待的那一格上，不叠字。
 * ⚠️ 这里**不带 `.tail-acts`**：两颗按钮全关时 `.tail` 上根本没有那个类，而瞬时星照闪。
 */
.row.fav-flash .tail .num,
.row.fav-flash .tail .src,
.row.fav-flash .tail .tag {
  opacity: 0;
}

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--tx-3);
}

/* 底栏：没有分隔线，左边一条极淡的键位提示，右边几颗极淡的入口。
 *
 * ⚠️ `align-items: flex-end`（09-24 从 `center` 改的）：底栏放不下时左边那排**会换行**
 *    （见 `.hints`），两行时右边那几颗按钮要落在**最后一行**上 —— 居中的话它们会悬在
 *    两行中间，看着像掉队了。一行时这个值和 `center` 没有可见差别（两边都一样高）。
 */
.foot {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 4px 14px 9px;
}
/*
 * 「淡入」档：这一行**不占高度** —— absolute 让它退出 flex 布局，
 * 列表（flex: 1）于是把窗口铺满，内容一直落到窗口底边，中间没有那条带子。
 *
 * 底色用 --surface-float（浮层专用、**永不透明**）：它现在是压在内容之上的浮层，
 * 跟着面板一起透明会跟底下的行糊成一片。它跟不跟面板的底色走，见 `surface.ts` 的 resolveFloatBg。
 *
 * ⚠️ 容器本身必须 pointer-events: none —— 它压着列表最后几十 px（09-24 起底栏可能换行，
 * 压住的不再恒是 30px；度量在 `measureFoot()`），而那正是「最后一行」的落脚处；
 * 吃掉鼠标事件的话最后一行就点不动了。
 * 只有那几颗按钮单独放行（见下）。判定在 onPointerMove，不在 CSS hover
 * —— 理由写在那段代码里。
 */
.foot.fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s;
  background: var(--surface-float);
}
.foot.fade.on {
  opacity: 1;
}
.foot.fade.on .clr {
  pointer-events: auto;
}
/*
 * 底栏左边那排键位提示。
 *
 * ★ 09-24 起 `flex-wrap: wrap`（老大提的「当选的过多超长时，能不能放不下时底栏再加一行」）：
 *   以前是 `overflow: hidden` + `nowrap` 的**定宽预算** —— 超了就从右边**静默截断**
 *   （不报错、不省略号，只是少一截字）。设置面板开着时尤其明显：那时底栏要让出
 *   `--sheet-w` 那 300px，可用宽度掉到 ~448，8 条提示只能看见 5 条 ——
 *   而那正是他挑提示的时候。现在放不下就换行，一条都不会少。
 * ⚠️ `white-space: nowrap` **留着**：它管的是"每一条提示自己的字不许折行"
 *    （`Tab 分类` 断成两行就成两坨了），**不拦** flex 的换行 —— flex 的行是按每个
 *    item 的外框排的，跟 `white-space` 无关。别以为它是旧写法顺手删掉。
 * ⚠️ `gap: 4px 11px`：列间还是 11px（跟以前一模一样），多出来的是**行间 4px** ——
 *    两行提示之间要有一点缝才读得开，但也不能给大：这一行是"尽量薄"的东西。
 * ⚠️ `overflow: hidden` 留着当最后一道保险（万一有哪条比整行还宽，宁可裁掉也别顶到按钮上）。
 */
.hints {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 11px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 11px;
  color: var(--tx-3);
}
.hints span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
kbd {
  padding: 1px 4px;
  border-radius: var(--radius-sm);
  background: rgba(127, 127, 127, 0.12);
  color: var(--tx-2);
  font-family: inherit;
  font-size: 11px;
  line-height: 1.5;
}
/* 右下角几个极淡的入口：设置 / 新增（只在收藏视图，可在设置里关）/ 清空（文案随分类变）。
 *
 * ★ 这几颗的**悬停效果跟上面「选中项」那套走**（老大 09-16 提的）：
 *   形状随 `mark` 三档（描框 / 淡底 / 实心），颜色随强调色 ——
 *   这样在设置里调「选中项」时，界面上两处"被选中"的意思是同一套语言，
 *   不会出现「行是实心块、按钮只是换了个字色」这种两套规矩。
 *   ⚠️「新增」跟「设置」同一档（强调色），只有「清空」是红的 —— 见上面那段注释：
 *     加一个入口，`.set` / `.add` 那四条规则要成对加。
 *   · 设置 → 强调色（跟行的选中态完全同色）
 *   · 清空 → 容器里的 danger 红（它是要删东西的，红是它的语义），
 *            但**形状跟设置一模一样**：描框档红描边、淡底档红淡底、实心档红实底反白。
 *
 * ⚠️ 为什么要 padding + radius：这俩原来是 `padding: 0` 的裸文字，
 *    「描一圈」会直接贴着字画、看着像把字框住了。行的选中态是个 36px 高的块，
 *    按钮得有个同构的盒子（小胶囊）才装得下描边和实底。
 * ⚠️ 点完残留的焦点环见 `base.css` 的 `button:focus` 那条。 */
.clr {
  background: none;
  border: 0;
  padding: 2px 7px;
  /* 跟行同一档（原来是 `--radius-row` = 6px，09-17 连行一起并进 8px 那一档）*/
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 12px;
  color: var(--tx-3);
  white-space: nowrap;
  transition: color 0.12s, background 0.12s, box-shadow 0.12s;
}
/* 两条兜底（`mark` 万一还没读出来）：清空恒红、设置恒强调色。
   ★「新增」跟「设置」共用这套强调色 —— 它俩都不是破坏性动作（红那档只留给清空），
     所以下面四条规则都是 `.clr.set` 与 `.clr.add` 成对出现。**加一个入口就一起加两个选择器**，
     漏掉一处那个档位下就没有反馈（不报错，只是"按下去没动静"）。 */
.clr:hover {
  color: var(--danger);
}
.clr.set:hover,
.clr.add:hover {
  color: var(--accent);
}

/* 描框档（默认）：不铺色、只描一圈 —— 跟 `.row.on` 的 inset 阴影是同一句话。
   用 inset 阴影不用 border：border 会让盒子长 3px、底栏跟着抖一下。 */
.root.mark-border .clr:hover {
  box-shadow: inset 0 0 0 1.5px var(--danger);
}
.root.mark-border .clr.set:hover,
.root.mark-border .clr.add:hover {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
/* 淡底档 */
.root.mark-tint .clr:hover {
  background: var(--danger-soft);
}
.root.mark-tint .clr.set:hover,
.root.mark-tint .clr.add:hover {
  background: var(--accent-soft);
}
/* 实心档：整块铺满 + 字反白。
   ⚠️ 红底上**不能用 `--row-on-tx`** —— 那是"配强调色"算出来的（深色主题下是近黑色），
     压在红底上会糊；这里恒用白。 */
.root.mark-solid .clr:hover {
  background: var(--danger);
  color: #fff;
}
.root.mark-solid .clr.set:hover,
.root.mark-solid .clr.add:hover {
  background: var(--accent);
  color: var(--row-on-tx);
}

/* 详情浮层
   界面里唯一一处带投影的东西 —— 浮层必须压在内容之上还能看清，
   底色 + 一道极浅的描边 + 投影是让「这是浮起来的」一眼成立的最省事的办法。

   左右内边距走 --pad-x，跟 .row 用的**同一个值**：浮层的盒子已经跟行盒对齐
   （宽度和左边距都以行为准，见 lib/peek.ts 的 peekGeom），内边距再不一样，
   正文就比行里的正文多缩进 3px，看着还是"错开一格"。

   ⚠️⚠️ **`box-sizing: border-box` 是必需的，别删** —— 宽度是 JS 算好内联写上去的（正好等于行宽），
   而这里又有横向 padding；本项目**没有全局 box-sizing**（默认 content-box），
   少了这一行，实际盒子 = 行宽 + 18px，右边会一路冲出窗口被裁掉，看着就是
   「左边跟行对齐、右边填满」—— 老大 09-16 报的那个 bug，真凶就是这一行缺失
   （不是当初猜的滚动条：那只是 7px 的零头，padding 才是 18px 的大头）。 */
.peek {
  position: absolute;
  z-index: 10;
  box-sizing: border-box;
  padding: 9px var(--pad-x);
  border-radius: var(--radius-md);
  background: var(--surface-float);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.16), 0 0 0 0.5px var(--line);
  overflow: auto;
  overscroll-behavior: contain;
}
.peek-tx {
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--tx-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.peek-img {
  display: block;
  margin: 0 auto;
  max-width: 100%;
  border-radius: var(--radius-sm);
}
.peek-files {
  margin: 0;
  padding: 0;
  list-style: none;
}
.peek-files li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 5px 0;
}
.peek-files li + li {
  border-top: 0.5px solid var(--line);
}
.peek-files .n {
  font-size: 12.5px;
  color: var(--tx-1);
}
.peek-files .n.gone {
  color: var(--tx-3);
  text-decoration: line-through;
}
.peek-files .p {
  font-size: 11.5px;
  line-height: 1.4;
  color: var(--tx-2);
  word-break: break-all;
}

/* 设置面板 */
/*
 * ★ 面板打开时，列表 / 空态 / 底栏**让出右边一条**（`--sheet-w`）。
 *
 * 以前面板是 `position: fixed` 压在它们上面，代价有三处：
 *   1. 行尾那一格（类型标签 ⇄ ☆/🗑）被盖住 —— 面板开着时鼠标动不了当前行；
 *   2. 底栏那几颗按钮（设置 / 新增 / 清空）被盖住点不到，所以 `openSettings()` 里那条 toggle
 *      一直没敢在文案里兑现；
 *   3. 面板底下压着字，面板就必须铺一层恒实底（`--surface-float`），
 *      于是「默认」档（面板透明、露宿主材质）下面板仍是白底，跟列表区有色差。
 *
 * 让位之后面板底下什么都没有，第 3 条自然消失 —— 面板改用 `--surface`，跟列表区同材质。
 * ⚠️ 让位带来的**副作用**：底栏也变窄了（少了 `--sheet-w`），于是左边那排键位提示
 *    更容易换行（09-24 起会换行，而不再是从右边静默截断 —— 见 `.hints`）。
 *    这是**好事**：面板开着正是他在挑提示的时候，那时看到的就是"这一行真会长什么样"。
 *    `screenTop` / `footH` 都跟着重采（那条 watcher 里有 `settingsOpen`）。
 *
 * 用 `margin-right`（缩盒子）而不是 `padding-right`（推内容）：`.list` 的盒子铺到哪儿，
 * 那根 7px 自绘滚动条就在哪儿 —— 给 padding 的话滚动条仍然留在窗口最右边、
 * 也就是面板底下，看不见也拖不到。
 *
 * `.foot.fade` 是 `absolute` + `left/right: 0`，这里不用给它单开一条：左右都写了、
 * `width: auto` 时 margin 照样参与计算，它自己就缩了。
 */
.root.sheet-open .list,
.root.sheet-open .empty,
.root.sheet-open .foot {
  margin-right: var(--sheet-w);
}

/*
 * 设置面板：**钉在窗口右边一整条**（上到下通高），跟列表并排 —— 不是浮在按钮上的小卡。
 *
 * 为什么不继续做浮层：它内容多（五组），浮起来得靠压暗层立层次、还盖住大半个列表；
 * 贴边则左边的内容原样可见可点，「看设置」和「对着列表调」不冲突 —— 所以这里也没有 mask。
 *
 * 「并排」现在是**布局上**真的并排了（列表按 `--sheet-w` 让了位），不再只是"贴在右边"：
 * 它底下没有任何内容，所以底色可以跟列表区一样取 `--surface` ——
 * 「默认」档那一份是透明的（露宿主材质），不再是一块白底，跟列表的色差没有了。
 * ⚠️ 改底色之前必须先有让位，只改底色就是真的穿透（09-16 试过，密集文字重影，否掉）。
 *
 * 宽度跟窗口走：窄了跟着缩，不至于把列表挤没（最少给列表留 24px）。
 * 位置是 CSS 钉的，`App.vue` 那边不用再量尺寸算坐标。
 * 层次只靠左边一条 0.5px 描边，**不加圆角、也不加投影** —— 它三面到边，圆角会露出窗口本色；
 * 投影是"浮在内容之上"才需要的东西，它现在是并排的一列，再往列表上压一圈 30px 的暗影
 * 就它一处有阴影，跟列表区也不像同一种材质了（浮层的投影见 `.peek` / `.mask`）。
 *
 * ★ 结构是「面板（`.sheet`，管定位/描边/底色）+ 可滚内容（`.sheet-body`，管内边距/滚动）」。
 * ⚠️ 09-17 之前 `.sheet` 上面还钉着一条标题 `.cap`，为了让标题不跟着滚才把滚动单独关在
 * `.sheet-body` 里（`.cap` 已随「面板不写文案」一起去掉）。**两段结构保留**：
 * 它是"内边距和滚动条在同一个盒子里"的写法，也省得滚动条跑到窗口最右边去。
 */
.sheet {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 18;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  width: var(--sheet-w);
  overflow: hidden;
  border-left: 0.5px solid var(--line);
  background: var(--surface);
}
/*
 * 可滚的内容段，也是面板**唯一**的内边距盒子：横向留白必须在这儿（放 `.sheet` 上，
 * 那条 0.5px 描边和滚动条都会被推进来）。滚动条（7px 自绘）归它，
 * 于是滚动条落在面板右侧内缘，不是窗口最右边。
 *
 * 上边距给 16px：去掉标题之后，第一组标签直接对着窗口顶边，14px 显得有点顶。
 */
.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 16px 20px;
}
.grp {
  margin-bottom: 16px;
}
/*
 * 段间距。面板按控件类型分三段（色点 / 选中 / 开关），**新一段的第一行**加一次它。
 * 只靠 `.grp` 那 16px 的话，三段会摊成一张平铺的清单，"分类放一起"看不出来；
 * 加上它就是 **段间 28px、段内 16px**，三段的边界一眼可见。
 * ⚠️ 跟 `.grp` 不会打架：`.grp` 只管 `margin-bottom`，这里只管 `margin-top`，
 *   两个属性不重叠，所以不依赖源码顺序（跟 `.dot.auto` 那种靠特异性的情况不同）。
 */
.blk {
  margin-top: 12px;
}
/*
 * 组标题。**整个面板只有两档字号**（13 交互 / 12 说明），层级交给字重和颜色去做 ——
 * 原来这里 11.5px、开关标题 13.5px、说明 11px，一共六个尺寸混着，看着就毛躁。
 * ★ 颜色走 `--tx-label`（09-17 拆出来的**标签档**：浅 38% / 深 48%）——
 * 不再跟行尾图标、键帽那些"内容"共用一个 42%：它只是分组名，该比内容再退一步。
 */
.lbl {
  margin-bottom: 9px;
  font-size: 13px;
  font-weight: 500;
  color: var(--tx-label);
}
/*
 * ★ `flex-wrap: wrap` 是 09-24 为「底栏按键提示」那一排加的，别删。
 *
 * 面板是个**窄条**（`--sheet-w` 300px，减掉左右各 16px 内边距只剩 268），
 * 15 颗药丸约 800px（09-24 第二批补到 15 条之后更长了；`收藏夹` 那颗三字的最宽）
 * —— 不换行的话它们会横向溢出，而 `.sheet-body` 是
 * `overflow-x: hidden`：**超出的部分直接看不见**（不报错、也没有滚动条），
 * 用户会以为"这行只有前几颗能选"。
 * ⚠️ `gap: 10px` 一个值管两个方向：换行之后行间也是 10px。药丸 26px 高、
 *    `.grp` 之间 16px —— 10px 的行间缝仍然读得出"这是同一组"，不用另配。
 */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
/*
 * ★ 面板里的小按钮只有一种长相：**药丸**（`border-radius: var(--radius-pill)`）。
 *   未选中 = 裸文字（透明底 + 次文本灰）；**选中的"效果"跟随 `mark` 三档** —— 见下面那段。
 *
 *   ⚠️ 以前每颗都垫一层 `rgba(127,127,127,.1)` 的灰底，一排看过去像一排实心按钮；
 *   面板「默认」档是透明的（露窗口毛玻璃），灰底在毛玻璃上尤其吵。
 *   现在只有"选中的那一颗"有底，其余就是文字。
 *   ⚠️ `.dot.auto`（「默认」那颗）走同一套：它是药丸，不是色点。它比 `.chip`
 *   多写一条 `width: auto` —— `.dot` 那个 14px 是给色点的，不能套到它头上。
 */
.chip,
.dot.auto {
  width: auto;
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--tx-2);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, box-shadow 0.12s;
}
.chip:hover,
.dot.auto:hover {
  background: var(--row-hover);
}
/*
 * ★ 选中的"效果"**跟随 `mark` 三档**（老大 09-18 真机提的）。
 *
 *   跟列表行 `.row.on`、底栏两颗 `.clr:hover` 是**同一套语汇**：描框 / 淡底 / 实心。
 *   来由：界面上凡是"被选中"的地方只能有一句话 —— 否则行是描框、面板里却铺着淡底，
 *   同一屏里两套规矩，改一次 `选中项` 只统一了一半。
 *
 *   兜底这条 = 淡底档（也管 `mark` 还没读出来的那一瞬）。
 *   ⚠️ 原来是「淡底 + 外面再晕一圈 3px 同色光晕」，**光晕那条已删** ——
 *      "描框档"要的就是干净的一圈，光晕留着会让它看起来像两层环。
 */
.chip.on,
.dot.auto.on {
  background: var(--accent-soft);
  color: var(--accent);
}
/* 描框档（默认）：不铺色、只描一圈 —— 跟 `.row.on` 的 inset 阴影是同一句话。
   ⚠️ `background: none` 是必须的：兜底那条铺了淡底，不撤掉就是"描框 + 淡底"两层。
      代价是这一档里 hover 一颗已选中的药丸不再变色（`background` 被这条压住了）——
      它已经是选中态，不给额外的 hover 反馈反而是对的。 */
.root.mark-border .chip.on,
.root.mark-border .dot.auto.on {
  background: none;
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
/* 实心档：整颗铺满 + 字反白。
   ⚠️ 补一条 `box-shadow: none`：`.dot.auto`（「默认」那颗）身上还挂着 `.dot` 那圈
      1px 灰底环和 `.dot.on` 的 5px 灰环（见下面 `.dot` 那段），铺了实底之后
      再套一圈灰环 = 实心档唯一一处"不干净"。`.chip` 本来就没有环，这条对它无害。 */
.root.mark-solid .chip.on,
.root.mark-solid .dot.auto.on {
  background: var(--accent);
  color: var(--row-on-tx);
  box-shadow: none;
}
/* 「默认」+ 12 个色点，一行摆不下（面板内容区 268px），让它自己换行。
   09-17 收敛：色点 20px → 14px、间距 8px → 12px（点小了但更透气，一行反而放得下更多）
   ⚠️ `.hint`（组下面那行灰色说明）那条规则**已随"面板去文案"一起删掉** ——
   面板里现在一个说明字都没有，要解释某个设置就改 README（见模板里那段注释）。 */
.dots {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
.dot {
  width: 14px;
  height: 14px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.25);
}
/*
 * 色点的选中：留一圈底色当缝、外面再套一圈中性环，免得跟色点本身撞色。
 * ★ 这条现在只管**淡底档 / 兜底**（描框档和实心档换成强调色环，见下面两条）。
 * ⚠️ 缝要取 --surface-float（浮层自己的底色）而不是 --surface —— 色点在设置面板里，
 * 而面板「默认」档下是透明的（露出窗口毛玻璃），拿它当缝就等于没缝。
 * 09-17：环从 `--tx-2` 实色改成 35% 中性灰、缝和环一起放大两档 ——
 * 点本身只有 14px，一道实色环会把它箍成一颗纽扣，灰环才是"光晕"。
 * （「默认」那颗不是色点，是药丸，样式在上面那段 `.chip, .dot.auto` 里，别在这儿找。）
 */
.dot.on {
  box-shadow: 0 0 0 2px var(--surface-float), 0 0 0 5px rgba(127, 127, 127, 0.35);
}
/*
 * 色点也有「选中」，也跟随 `mark` 三档 —— 但色点**没法铺底、也没字可反白**
 * （它本身就是一块颜色），所以三档在它身上只能靠"那圈环"的粗细 / 颜色表达：
 *   描框档 = 细一点的强调色环；实心档 = 粗的强调色环；
 *   淡底档 = 就保持上面那条中性灰环（色点没有"底"可铺 ⇒ 这一档不加表达）。
 *
 * ⚠️ 必须 `:not(.auto)`：「默认」那颗身上**也挂着 `.dot` 类**（模板里是 `class="dot auto"`），
 *    不排掉的话这条会把药丸的环也换成圆环。那两套类名撞在一起是历史遗留 ——
 *    面板里凡是写 `.dot` 的规则，都得先想一遍"会不会误伤 `.auto`"。
 * ⚠️ `--surface-float` 那圈"缝"不能省：环直接贴着色点的话，跟色点本身撞色的那几颗
 *    （比如正在用的那颗强调色）就看不出环在哪了。
 */
.root.mark-border .dot:not(.auto).on {
  box-shadow: 0 0 0 2px var(--surface-float), 0 0 0 3.5px var(--accent);
}
.root.mark-solid .dot:not(.auto).on {
  box-shadow: 0 0 0 2px var(--surface-float), 0 0 0 5px var(--accent);
}
/*
 * ★ 键盘光标（09-18）：`↑↓←→` 在面板里挪的就是它。
 *
 * 跟「选中」（`.on`）**必须是两套**，因为两者会同时出现 —— 光标正停在一个已选中的
 * 控件上是常态（打开面板时它就落在当前值上）：
 *   · `.on` = 强调色（淡底 + 光晕 / 色点是灰光晕），说的是"这个值是当前值"；
 *   · `.cur` = 中性灰的**两层**（主线 + 一圈更淡的同色外带），说的是"键盘停在这儿"。
 *     ⚠️ 别用 `--accent`：那就跟"选中"撞成同一个意思，分不出哪一个是光标。
 *
 * 为什么用 `outline` 而不是 `box-shadow`：`.on` 那几条光晕本来就写在 box-shadow 里，
 * 用 box-shadow 就得跟每一条各拼一次（药丸 / 色点 / 「默认」/ 开关……拼漏一处就是
 * "选中时看不见光标"）。`outline` 是另一条通道，天然互不覆盖，也不用管圆角 ——
 * 它会跟着 `border-radius` 走（色点是正圆、药丸是胶囊，都自动对上）。
 *
 * 为什么不用 `:focus` / UA 焦点环：面板**不接 DOM 焦点**（Tab 被「切分类」占了，
 * 真去 focus 还会把 base.css 里刚掐掉的琥珀色 UA 环带回来）。所以这里自己画一个。
 * 顺带：`.cur[data-v-x]`（0,2,0）压得过 `button:focus`（0,1,1），环不会被那条 outline:none 吃掉。
 *
 * ⚠️ `outline-offset` + 环宽决定**往外占多宽**，这是唯一要算的数（v3 起）：
 *    药丸 / 开关行 = 2px 缝 + 2px 线 + 3px 晕 = 往外 **7px**；
 *    `.chips` 那排 gap 10px、`.opt` 之间 16px，都塞得下。
 *    色点 14px 却只隔 12px，**塞不下**（见下面那两条）—— 所以色点只有线、没有晕。
 */
/*
 * ★ v3（09-18 晚，老大从四个方案里挑了"A"）。
 *
 * 来由：v2 把方角改圆之后他仍不满意 ——
 * **「环这种形式没问题，就是环能不能做好看一点？现在就一条细细的黑线来做环，
 *   感觉不怎么好看，有没有好看的做法？」**
 * ⇒ 病根不是"线太细"，是**单独一条实心边只会被读成"框"**。
 *   现代焦点环（Tailwind 的 ring、Chrome、macOS）都是**两层**：一条主线 + 一圈同色更淡的
 *   外带，叠起来才读成"光"。另一层问题是 `--tx-1` 近黑，对比度压过旁边的开关键，抢戏。
 *
 * v3 = 两件事：① 线从近黑的 `--tx-1` 换成**中性灰** `--cur-line`，1.5px → 2px；
 *              ② 外面加一层 `--cur-halo` 的淡晕（伪元素）。两个变量都在 base.css。
 *
 * ⚠️ 晕**必须挂在伪元素上**，不能写在 `.cur` 自己身上：`.on` 那几条（描框 inset /
 *    实心铺色 / 色点光晕）**全在 box-shadow 里**，写在同一个盒子上就是互相覆盖，
 *    得逐条跟 `.on` 各拼一次（拼漏一处 = "选中时看不见光标"）。
 *    伪元素是**另一个盒子**，挂它身上就跟 `.on` 互不干扰 —— 这才是既拿到两层、
 *    又不用跟 `.on` 拼通道的写法。
 * ⚠️ 两层都走 **`outline` 通道**（不是 box-shadow）：它是独立通道，
 *    而且**天然跟着 `border-radius` 走**（`outline-offset` 会连半径一起往外扩）——
 *    药丸是胶囊、色点是正圆、开关行是 8px 圆角，三种形状都不用另外写数。
 *    ⚠️ 这一点是**踩过坑才定死的**：第一版拿 `box-shadow` 画晕，半径得自己算，
 *       结果四个角上晕和主线之间露出一道背景色（老大真机一眼看出来了）。详见下面 `.cur::after`。
 * ⚠️ 不许出现 `--accent`：那会跟"选中"撞成同一个意思（测试钉着这条）。
 *
 * ⚠️ 中间那版"开关行改铺淡底、药丸 / 色点换浅灰环"的写法**已被老大否决**过：
 *    他要的是**统一** —— 满屏"键盘停在这儿"只有**一圈环**这一种说法。
 *    别因为 `.on` 的档位多就再分两套画法。
 */
.cur {
  /* 伪元素要拿它当定位父级 */
  position: relative;
  outline: 2px solid var(--cur-line);
  outline-offset: 2px;
}
/*
 * 晕：**跟元素自己同一个盒子**（`inset: 0`），再靠 `outline-offset` 把它推到主线外面去
 * （主线外缘在 4px，晕铺 4→7px，跟主线紧挨）。
 *
 * ⚠️⚠️ 为什么**不能**写成 `inset: -4px` + `box-shadow`（第一版就是这样，老大真机一眼看出毛病）：
 *    `border-radius: inherit` 继承到的是 `.opt` 自己的 **8px**，可盒子已经被外推了 4px，
 *    那一圈的正确圆角应该是 **12px**。半径偏小 ⇒ 角的弧"少切一块"⇒ 晕在**四个角上鼓到主线
 *    外面**，中间露出一道约 2px 的背景色。直边好好的，只有角上有缝 —— 这就是它的指纹。
 *    （老大截图的原话：「描边和晕为什么没有贴一起，中间有白色底。是描边的圆角和晕的圆角
 *      不一样吗？」—— 三个字：是的，就是。逐像素量出来 y=27 直边处线/晕相邻 0 缝，
 *      y=19/20 圆角处夹着 2px 的 `#f4f4f4`。）
 *
 * ⇒ 修法：**让盒子跟元素完全重合**（`inset: 0`），这样 `border-radius: inherit` 就永远是对的；
 *    往外推的活儿交给 `outline-offset` —— 它是**沿着圆角往外扩**的（半径自己 +offset），
 *    所以药丸、正圆、8px 圆角三种形状都不用另外写数。
 *    （佐证：主线那个 outline 在 `offset: 2px` 下量出来的角半径是 10 而不是 8 ⇒
 *      `outline-offset` 确实会扩半径，不是把方框平移。）
 * ⚠️ 别再换成 `box-shadow`：那是"另一个盒子"，半径得自己算，就是上面这个坑。
 */
.cur::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  outline: 3px solid var(--cur-halo);
  outline-offset: 4px;
  pointer-events: none;
}
/*
 * 色点又小又密（14px 点、12px 间距），而且外面本来就挂着"选中环"（实心档到 5px）——
 * 再叠一圈晕就是 7 + 3.5 > 12，**算术上顶到隔壁那颗去了**。所以色点只画线、不画晕。
 * 缝给 4.5px 而不是原来的 4px：线加粗到 2px 后，4px 的缝会让环压进"实心档"那圈 5px 环里。
 */
.root .sheet .dot.cur {
  outline-offset: 4.5px;
}
.root .sheet .dot.cur::after {
  content: none;
}
.opt {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
  /*
   * ★ 这个圆角**只为一件事存在**：塑形键盘光标那圈环（`.cur`）。
   *   `.opt` 自己 `background: none`、没有任何背景色，所以这个值**页面上永远看不见** ——
   *   它只是经由 `outline` 让那圈环跟着弯（见 `.cur` 那段）。
   *
   * ★ 取 `--radius-sm`(4) 而不是 `--radius-md`(8)：**为了跟列表项的描框弧度对齐。**
   *   两个框的弧度不能比"`border-radius` 写了多少"，得比**那圈线自己的外轮廓半径**：
   *     · 列表项 `.row.on`（描框档）= 8px 圆角 + `inset 1.5px` **贴边往里** ⇒ 外轮廓 **8px**
   *     · 这里的环 = 元素圆角 + `outline-offset: 2px` + 2px 线（**往外让**）⇒ 外轮廓 **圆角 + 4**
   *   所以元素圆角必须是 **4**，环的外轮廓才是 8 —— 跟列表项一模一样。
   *   三条轮廓一起对：环 **6 / 7 / 8** vs 列表项 **6.5 / 7.25 / 8**（差 ≤0.5px）。
   *
   * 来由（老大 09-18 真机，同一处第三次返工）：
   *   先是「方形不好看」⇒ v2 给了 8px；然后他一句
   *   **「你设置里面这个环的角弧度，有没有参考列表项的描框的角的弧度？」**
   *   —— 才发现 8px 的底让环的外轮廓成了 12px，**比列表项圆了整整 4px**。
   * ⚠️ 别再调回 `--radius-md`：环会立刻"圆一圈"，又跟列表项对不上。
   * ⚠️ 也别给 `.opt` 铺底去表达光标：满屏"键盘停在这儿"只有**一圈环**这一种说法；
   *    而且 `.on` 那套全写在 `background` / `box-shadow` 上，铺底会跟"选中"打架。
   */
  border-radius: var(--radius-sm);
  /* 开关是**连着排的一整段**（行尾按钮 / 显示详情 / 删除前确认）——
     09-17 重排后它们不再被药丸行打断（原来「底栏」夹在中间）。
     段内的行距就靠这条 16px，段**上面**那一次额外空隙由 `.blk` 给。 */
  margin-bottom: 16px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
/* 最后一段的间距交给 `.sheet-body` 自己的 padding，别叠成两倍 */
.sheet-body > :last-child {
  margin-bottom: 0;
}
/*
 * 开关那一行 = 「名字 + 开关」，跟上面几组是同一套排版（13px 的标签 + 右边的控件）。
 *
 * ⚠️ 名字用自己的 `flex: 1` 把开关顶到右边（原来这活儿在外层那个 `.txt` 包着的盒子上，
 * 09-17 面板去掉说明文字后那层包装没用了，一起删）。`min-width: 0` 留着，
 * 窄窗口下长名字先被压缩，不会把开关挤出面板。
 * ⚠️ 颜色跟组标题一样走 `--tx-label`（**标签档**，浅 38% / 深 48%）：面板里没有文案之后，
 * 每一行都长成"标签 + 控件"，名字再比组标题重就没有道理了。
 */
.opt .nm {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--tx-label);
}
/* ★ 原来是有一条 `.opt .mk`（开关行里那颗键帽的定位）—— 09-24 撤掉了：
   它唯一的主人「新增按钮」那一行并进了「底栏按钮」那颗药丸，键帽跟着一起没了
   （老大在"键帽放哪"那两条路里挑的是「药丸只写名字」）。
   ⇒ 别为一个不存在的元素留规则；哪天再有开关行要挂键帽，按当时的样式重新写。 */
.sw {
  flex: none;
  position: relative;
  width: 34px;
  height: 20px;
  /* 跟第一行 13px 的标题视觉居中（开关比那行字高 4px 上下，各让 2px）*/
  margin-top: -2px;
  /* 10 → 999：这个 10px 从来不是"中间值散落" —— 它是 20px 高的一半，也就是**胶囊端**。
     写成 `--radius-pill` 之后语义才对，以后改轨道高度也不会留下一个错的数。 */
  border-radius: var(--radius-pill);
  background: rgba(127, 127, 127, 0.3);
  transition: background 0.15s;
}
.sw.on {
  background: var(--accent);
}
.sw i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.sw.on i {
  transform: translateX(14px);
}

/*
 * 确认框：**居中**。
 *
 * 居中交给 flex（`.mask` 撑满窗口 + 两条 center），不再由 JS 算坐标 ——
 * 以前是"贴着鼠标弹、下面不够翻上方"，那需要先渲染一帧量自己的高度。
 *
 * `.mask` 另外接"点空白处关掉"。它不压暗整个界面：这个弹框只问一句话，压暗整屏太重。
 * `.box` 只写长相和上限：窗口窄了自己缩，窗口矮了自己滚，不会顶到屏幕外面去。
 */
.mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px; /* 兜底留边：窗口再小也不让弹框贴到边上 */
}
.box {
  /* 同 .peek：有 width 又有横向 padding，没有全局 box-sizing，必须自己写 */
  box-sizing: border-box;
  width: min(250px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 16px 18px;
  /* 10 → 8（09-17 收圆角）：跟详情浮层 `.peek` 同一档 —— 两个都是浮在内容上的卡片，
     一个 8 一个 10 本来就是"顺手挑的数"，摆在同一屏里能看出不一样。 */
  border-radius: var(--radius-md);
  background: var(--surface-float);
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.28), 0 0 0 0.5px var(--line);
  text-align: center;
}
.msg {
  margin: 0 0 14px;
  font-size: 13.5px;
  color: var(--tx-1);
}
.dlgacts {
  display: flex;
  gap: 8px;
}
.dlgacts button {
  flex: 1;
  height: 30px;
  border: 0.5px solid var(--line);
  /* 7 → 8（09-17 收圆角）：它在确认框里，归「浮层」那一档 */
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--tx-1);
  font-size: 13px;
  cursor: pointer;
}
.dlgacts button:hover {
  background: var(--row-hover);
}
.dlgacts button.pri {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--row-on-tx);
}
.dlgacts button.pri:hover {
  filter: brightness(1.08);
}
.dlgacts button.pri.danger {
  border-color: var(--danger);
  background: var(--danger);
}

/*
 * 新增 / 编辑收藏那块输入浮层。
 *
 * 长相直接沿用确认框那套（`.mask` 居中 + `.box` 卡片），只是宽一点、正文左对齐 ——
 * 它装的是内容，不是一句话。
 *
 * ⚠️ `.box` 是 `text-align: center`（确认框只有一句话，居中对），
 *    所以输入框必须自己写回 `left`，不然敲进去的字全是居中的。
 * ⚠️ 输入框的**高度是 JS 写的**（`fitComposer`，跟着内容长）——
 *    这里**故意不写 `height`**：写了会被内联样式盖掉，看着像没生效，回头还找不着。
 *    只留一条 `min-height` 兜第一帧（内联高度还没落上去的时候）。
 */
.box.composer {
  /* ★ 尺寸对齐「弹框能展示全」那句话（09-23 真机反馈「改大点，这样才能看全收藏的信息」）：
     开头是 440 宽 / 输入框 66 高，长一点的备忘一进去就得滚，等于白弹；
     09-23 先放到 640×132，09-24 老大在效果图里挑了**最宽的那一档 776**。
     776 = 插件视口 800 − 左右各 12px（那 12px 就是 `.mask` 自己的 padding）。
     13px 字号一行约 55 个汉字；`100vw - 24px` 兜小窗口，跟上面这条算式同一个数。
     ⚠️ 纵向不用在这里管：高度是 JS 算的（`composerMaxH()`），见上面那段推导。 */
  width: min(776px, calc(100vw - 24px));
  text-align: left;
}
.ctx {
  box-sizing: border-box;
  display: block;
  width: 100%;
  /* ★ 09-24 挑了「撑满」那一档：空框 = 弹框可用高度 − 卡片里除输入框之外的 129。
     `100vh - 155` 跟 JS 那边 `composerMaxH()` 是**同一个算式**，两边必须一起改 ——
     只改一边时高的那一头说了算，卡片会顶破 `.box` 的 `max-height` 多出一根滚动条。
     内联高度（`fitComposer` 写的）第一帧还没落上去时，就靠这条顶着。 */
  min-height: min(401px, calc(100vh - 155px));
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--tx-1);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  text-align: left; /* ⚠️ 拦掉 `.box` 的居中 */
  resize: none;
  outline: none;
  overflow-y: auto;
}
.ctx:focus {
  border-color: var(--accent);
}
/* 空的时候那行提示字，跟"还没收藏"那一档同色（三级文本） */
.ctx::placeholder {
  color: var(--tx-3);
}
/* 键位那一行：跟底栏提示同一档（三级文本），别跟正文抢注意力。
   ★ 得写在界面上 —— 不然只有翻过 README 的人知道 Enter 能保存。 */
.ckey {
  margin: 8px 0 12px;
  color: var(--tx-3);
  font-size: 11px;
}
/* 内容为空时「保存」是灰的：点下去没反应，比灰着更让人困惑 */
.dlgacts button:disabled {
  opacity: 0.4;
  cursor: default;
}
.dlgacts button:disabled:hover {
  background: transparent;
}
.dlgacts button.pri:disabled:hover {
  filter: none;
}
</style>
