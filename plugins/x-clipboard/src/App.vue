<script setup lang="ts">
/*
 * x-clipboard —— 整个界面。
 *
 * 只有几块东西：列表、按需浮出的详情、右下角两个极淡的入口（设置 / 清空历史）、
 * 以及弹出来的确认框。
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
  clearFavorites,
  favKeyOf,
  findFavorite,
  loadFavorites,
  removeFavorite,
  type FavItem
} from './lib/favorites'
import { ACCENT_KEYS, accentSwatch } from './lib/accent'
import { BG_PRESETS, resolveBg } from './lib/surface'
import { pasteSlot, resolveKey } from './lib/keys'
import { modKey } from './lib/platform'
import {
  cursorOf,
  movePatch,
  moveRow,
  moveSlot,
  rowIndex,
  toggleAt,
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
  loadSettings,
  saveSettings,
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

/** 设置面板里「底栏」那四个按钮。同上，写在一处 */
const FOOT_CHOICES: readonly { v: FootMode; label: string }[] = [
  { v: 'full', label: '完整' },
  { v: 'lean', label: '精简' },
  { v: 'fade', label: '淡入' },
  { v: 'none', label: '全隐' }
]

/**
 * 「淡入」档下，鼠标离窗口底边多近才算「贴到底了」。单位 px。
 *
 * 取 30 是有讲究的：底栏自身高约 29px（4 + 16 + 9 的 padding），
 * 所以判定范围跟浮出来那一行**一样高** —— 鼠标一碰到底栏将来会覆盖的区域，
 * 它就正好出现，不会出现「浮出来了但鼠标还在它下面」或「要挪很远才出来」的错位。
 */
const FOOT_REVEAL_ZONE = 30

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
  try {
    zt().setSubInputValue(next)
  } catch {
    /* 写不进框就只改状态 */
  }
  commitTypedQuery(next)
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
  try {
    zt().setSubInputValue(next)
  } catch {
    /* 写不进框就只改状态 */
  }
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
 * `⌘1`–`⌘9`：直接粘贴列表里的第 N 条（0 基下标）。
 *
 * ⚠️ 取的是 **`visibleRows`** —— 跟行尾显示的序号、跟模板里的 `v-for` 是同一份。
 * 另算一份「前 9 条」迟早会错位（渲染窗口、分类过滤、收藏视图三条路都得对上），
 * 到时候按 ⌘3 粘到的不是眼睛看到的第 3 条，而且极难复现。
 */
async function pasteAt(slot: number): Promise<void> {
  const row = visibleRows.value[slot]
  if (!row) return
  await pasteRow(row)
}

function copyActive(): void {
  const row = activeRow.value
  if (!row) return
  // 只写系统剪贴板，不关窗。成功与否都不弹提示（老大 09-16 要求）
  copyToClipboard(row.data)
}

async function toggleFavorite(): Promise<void> {
  const row = activeRow.value
  if (!row) return
  // 查找走 lib/favorites 的 findFavorite —— 这里原来自己又写了一遍
  // 「算指纹 + 在收藏里找」，跟 isFavorite 是逐字重复的两份实现。
  const hit = findFavorite(row.data, favorites.value)

  /*
   * 收藏 / 取消收藏**都不弹提示**（老大 09-16 要求去掉）。
   * 行尾那枚 ☆ 会立刻点亮或熄灭，状态就写在你看的那一行上 ——
   * 再浮一句「已收藏」，反而在内容上面盖一块，收益是零。
   */
  favorites.value = hit
    ? await removeFavorite(hit.favId, favorites.value)
    : await addFavorite(row.data, favorites.value)

  if (view.value === 'favorites') syncSelection()
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
   * 它压着的正是列表最后 30px（也就是最后一行**本身**）。挂 hover 的话，
   * 鼠标想去点最后一行 → 栏浮出来 → 栏盖住那一行 → 点不到。
   * 改成「离底边近就露出」之后，栏只负责显示；鼠标事件靠 `pointer-events: none`
   * 穿透过去给底下的行，那两颗按钮再单独放行（见 .foot.fade 的样式）。
   */
  if (settings.value.foot === 'fade') {
    footRevealed.value = e.clientY >= window.innerHeight - FOOT_REVEAL_ZONE
  } else if (footRevealed.value) {
    // 从「淡入」换成别的档，或者干脆切走时，别把这个标记留在 true 上
    footRevealed.value = false
  }
}

function onViewportChange(): void {
  hidePeek()
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
 * 选中项一变：先立刻收掉上一个浮层，停 150ms 再决定要不要给新的一行弹。
 * 收得干脆是要紧的 —— 连按上下键时浮层不能一路挂在后面。
 */
function schedulePeek(): void {
  hidePeek()
  if (!settings.value.peek) return
  peekTimer = window.setTimeout(() => {
    void nextTick(showPeek)
  }, 150)
}

/** 列表一滚，浮层的坐标就废了：先收起来，滚停了再摆 */
function onAnyScroll(e: Event): void {
  const target = e.target as HTMLElement | null
  // 浮层自己内部的滚动不算（长文本要在里面滚着看）
  if (target?.closest?.('.peek')) return

  // 触底续渲染：数据本来就在手里，只是还没建 DOM
  growRenderWindow()

  if (!peek.value && !peekTimer) return
  hidePeek()
  if (!settings.value.peek) return
  peekTimer = window.setTimeout(() => {
    void nextTick(showPeek)
  }, 160)
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
 * 原来这里有个 `footHint` computed：给「底栏」那一组算一句说明（四档各一句）。
 * 09-17 面板去掉全部说明文字之后它没有出口了，**连同那四句一起删掉** ——
 * 那四句（尤其「淡入 / 全隐」两档的区别、以及全隐只能靠 ⌘/ 开设置）
 * 已经搬进 README 的「设置」一节，改档位时记得同步那边。
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
    if (next.peek) schedulePeek()
    else hidePeek()
  }
}

/* ---------------------------------------------------------------- 键盘 */

/**
 * 插件自己有没有「该退的一层」：浮层开着、或者搜索框里有东西（关键词 / 分类前缀）。
 * 决定 Esc 要不要从宿主手里抢过来。
 */
function hasSomethingToFold(): boolean {
  return !!confirmBox.value || settingsOpen.value || !!keyword.value
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
   * ⌘1–⌘9 秒贴：直接粘第 N 条，不经过选中态。
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
    schedulePeek()
  })
})

// 列表整体换了（改搜索词、切收藏视图）就没什么可锚的，直接收掉；
// 顺带把渲染窗口收回最小 —— 不然在上一个分类里滚出来的几十批行会一直挂在 DOM 上
watch([view, keyword], () => {
  hidePeek()
  renderLimit.value = RENDER_STEP
})
// 弹出确认框时也别留着浮层压在下面
watch(confirmBox, hidePeek)

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
    try {
      zt().setSubInputValue('')
    } catch {
      /* 忽略 */
    }
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
          tall: row.data.type !== 'text'
        }"
        @click="onRowClick(row)"
        @dblclick="onRowDblClick(row)"
      >
        <img
          v-if="row.data.type === 'image' && !brokenThumbs.has(row.key)"
          class="thumb"
          :src="imageSrc(row.data)"
          alt=""
          loading="lazy"
          decoding="async"
          @error="markBroken(row.key)"
        />
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

        <!-- 行尾那一格。四样东西，各自可以在设置里关掉：
               · 序号（只给前 9 行）—— 配 ⌘1–⌘9 秒贴
               · 来源（VSCode / Chrome…）—— 这条是在哪个软件里复制出来的
               · 类型标签（文本 / 链接 / 图像 / 文件）
               · 收藏 / 删除两枚按钮 —— **鼠标划过、或这行是当前行**时出现（两者一致）；
                 它出现时上面三样在这一格让位（同一个位置叠着，见下面对应的 CSS）
             按钮是 absolute 叠在这一格的右端、靠透明度切换，所以它出现/消失都不改行宽
             （`.tail-acts` 给它留了固定宽度）。四样都不开就是彻底没有行尾。
             ⚠️ 序号必须取 `v-for` 的下标 —— 跟 `pasteAt()` 取的是同一个 `visibleRows`，
                另算一份迟早错位（按 ⌘3 粘到第 4 条）。
             按钮都得 .stop，不然点它们会连带触发行的 click（改选中）/ dblclick（复制）。 -->
        <div class="tail" :class="{ 'tail-acts': settings.tailActs }" @dblclick.stop>
          <span v-if="settings.tailIndex && i < 9" class="num">{{ i + 1 }}</span>
          <!-- 来源排在类型标签**前面**：两个都是淡淡的纯文字，挨着放；类型标签是带底色的
               药丸，留在最右端当这一格的收尾。
               ⚠️ `row.source` 为空时**不渲染**（老数据 / 老收藏没有 appName）——
                  显示成「未知」等于凭空多一列。 -->
          <span v-if="settings.tailSource && row.source" class="src">{{ row.source }}</span>
          <span v-if="settings.tailType" class="tag">{{ row.label }}</span>
          <div v-if="settings.tailActs" class="acts">
            <button
              class="act"
              :class="{ lit: row.favored }"
              :title="row.favored ? '取消收藏' : '收藏'"
              @click.stop="onRowFavorite(row)"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                <path d="M8 1.07L9.72 5.63L14.6 5.85L10.79 8.91L12.08 13.61L8 10.93L3.92 13.61L5.21 8.91L1.4 5.85L6.28 5.63Z" />
              </svg>
            </button>
            <button class="act danger" title="删除" @click.stop="onRowRemove(row)">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">
                <path d="M2.27 4.4H13.73" />
                <path d="M6.27 4.4V3.07A1.2 1.2 0 0 1 7.47 1.87H8.53A1.2 1.2 0 0 1 9.73 3.07V4.4" />
                <path d="M4.27 4.4L4.93 13.2A1.33 1.33 0 0 0 6.27 14.4H9.73A1.33 1.33 0 0 0 11.07 13.2L11.73 4.4" />
                <path d="M6.93 7.33V11.87" />
                <path d="M9.07 7.33V11.87" />
              </svg>
            </button>
          </div>
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

    <!-- 底栏：形态由设置里的「底栏」决定（完整 / 精简 / 淡入 / 全隐），四档见 lib/settings.ts 的 FootMode。
         左边一条极淡的键位提示（键位不写在界面上就没人知道）—— 只有「完整」档才有；
         右边两个入口，除「全隐」外三档都有。
         「收藏」也提示：⌘K 是收藏当前项**唯一**的键盘入口（⌘D 被宿主拦给「分离插件」，
         界面改不掉），这条路径不给提示就等于没有。
         「⌘1–⌘9」也提示（09-17 老大提的，原话「怎么老是忘记这个」）：这一族键在界面上
         **一处都没有** —— 行尾那列「序号」默认还是**关**的，等于连"行尾有号码"这条线索
         默认也没有；不写进底栏它就跟不存在一样。⚠️ 序号关掉只是**看不见号码**，
         键本身一直在（取的是渲染列表的下标，见下方 tail 那段）。所以提示是七项。
         它排在 Enter 后面：两条都在说"粘贴"（Enter 粘选中的那条，⌘1–⌘9 直接粘第 N 条）。
         「设置」也提示：⌘/ 原先在整个界面上**一处都没写** —— 只在设置面板里那句
         「全隐 = 只能按 ⌘/ 开设置」的解释里提过（09-17 面板去文案后**连那句也没了**，
         不写进底栏就彻底没地方知道它）。
         放在最末：`.hints` 是 `overflow: hidden`，窄窗口会**从右边静默截断**，
         所以最不常用的那一项排最后，先被截掉的也是它。
         修饰键写法跟平台走（mac ⌘ / 其它 Ctrl），走 lib/platform.ts 的 modKey()——
         Windows 键盘上没有 ⌘ 键，硬写 ⌘ 那边看不懂。
         「删除」不给提示：行尾那枚 🗑 就在眼前，不用占底栏；Delete 键自己会打。
         「淡入」档：这一行是 absolute 的、不占高度 —— 列表因此一直铺到窗口底边，
         鼠标贴到底边才浮出来（判定在 onPointerMove，长相在 .foot.fade）。
         「精简」档不用另写分支：hints 空着但它仍是 flex:1，两个入口照样被顶到右边。
         右边那个「清空」的文案随分类变（清空历史 / 清空文本历史 / … / 清空收藏）——
         它就是清掉当前这一个分类里的东西，不随关键词变。 -->
    <div
      v-if="settings.foot !== 'none'"
      class="foot"
      :class="{ fade: settings.foot === 'fade', on: footRevealed }"
    >
      <div class="hints">
        <template v-if="settings.foot === 'full'">
          <span><kbd>↑↓</kbd>选择</span>
          <span><kbd>Tab</kbd>分类</span>
          <span><kbd>Enter</kbd>粘贴</span>
          <span><kbd>{{ modKey('1') }}–{{ modKey('9') }}</kbd>秒贴</span>
          <span><kbd>{{ modKey('K') }}</kbd>收藏</span>
          <span><kbd>Esc</kbd>返回</span>
          <span><kbd>{{ modKey('/') }}</kbd>设置</span>
        </template>
      </div>
      <button class="clr set" @click="openSettings">设置</button>
      <button class="clr" @click="askClear">{{ clearLabel }}</button>
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
            ② 选中段：行尾（3 颗）→ 选中项（3 颗）→ 底栏（4 颗）
            ③ 开关段：行尾按钮 / 显示详情 / 删除前确认
          为什么不按"主题"排（比如让「行尾按钮」贴着「行尾」）：那样三种控件形状会一格一格
          交替出现 —— 色点、药丸、开关、药丸、开关…… 右边缘那一列开关被药丸行打断，看着毛躁。
          同形状的挨在一起，面板才有节奏。段与段之间靠 `.blk` 多留一点空。

          ⚠️ **方向是「短 → 长」**，别搞反（我第一版就做反了）：老大原话「为什么不是每个类都是从
             短到长呢，你是从长到短」。他给的判据很直接 —— 底色段 4 颗在 13 颗上面、行尾那几颗在
             底栏 4 颗上面。别再拿"重的放上面更稳"这种直觉改回长→短。
             （09-18 行尾加了第 3 颗「来源」之后，行尾和选中项都是 3 颗 —— 这一段平了，
              两行谁前谁后都不违背判据，所以**保持原样不动**，别为"凑成一个严格递增"去调顺序。）
          ⚠️ 开关那三行的控件宽度**完全一样**（都是"左标题 + 右侧开关"的满宽行），按颗数没有可排的；
             按**标签字数**排恰好也就是现在的先后（行尾按钮 4 / 显示详情 4 / 删除前确认 5），所以不动。
        -->
        <!-- 行尾：**多选**（跟色点一样是「点一下选上、再点一下取消」，区别只是这里能同时选好几个）。
             都不选 = 行尾什么都没有。序号 / 来源 / 类型是三件独立的事，不该互相顶掉 —— 不做成三选一。
             ⚠️ 三颗的**先后必须跟 `panel.ts` 里 `PANEL_ROWS.tail.values` 的顺序一致**：
                `←→` 挪的是第几颗、`Enter` 切的就是 `values[第几]` 那个键，错位就会静默切错开关。
                改顺序要么两边一起改，要么别改（`tests/panel.test.ts` 钉着这条）。 -->
        <div class="grp blk">
          <div class="lbl">行尾</div>
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

        <button
          class="opt blk"
          :class="{ cur: isCur('tailActs', 0) }"
          @click="updateSettings({ tailActs: !settings.tailActs })"
        >
          <span class="nm">行尾按钮</span>
          <span class="sw" :class="{ on: settings.tailActs }"><i /></span>
        </button>

        <button
          class="opt"
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
}
/* 只给两枚 22px 按钮留位。关掉按钮之后这 50px 也该还回去 ——
   不然一块空留白会按"行尾"的直觉压着内容，白占地方。 */
.tail.tail-acts {
  min-width: 50px;
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

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--tx-3);
}

/* 底栏：没有分隔线，左边一条极淡的键位提示，右边两个极淡的入口 */
.foot {
  flex: none;
  display: flex;
  align-items: center;
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
 * ⚠️ 容器本身必须 pointer-events: none —— 它压着列表最后 30px，
 * 而那 30px 正是「最后一行」的落脚处；吃掉鼠标事件的话最后一行就点不动了。
 * 只有那两颗按钮单独放行（见下）。判定在 onPointerMove，不在 CSS hover
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
.hints {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 11px;
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
/* 右下角两个极淡的入口：设置 / 清空（文案随分类变）。
 *
 * ★ 这两颗的**悬停效果跟上面「选中项」那套走**（老大 09-16 提的）：
 *   形状随 `mark` 三档（描框 / 淡底 / 实心），颜色随强调色 ——
 *   这样在设置里调「选中项」时，界面上两处"被选中"的意思是同一套语言，
 *   不会出现「行是实心块、按钮只是换了个字色」这种两套规矩。
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
/* 两条兜底（`mark` 万一还没读出来）：清空恒红、设置恒强调色。 */
.clr:hover {
  color: var(--danger);
}
.clr.set:hover {
  color: var(--accent);
}

/* 描框档（默认）：不铺色、只描一圈 —— 跟 `.row.on` 的 inset 阴影是同一句话。
   用 inset 阴影不用 border：border 会让盒子长 3px、底栏跟着抖一下。 */
.root.mark-border .clr:hover {
  box-shadow: inset 0 0 0 1.5px var(--danger);
}
.root.mark-border .clr.set:hover {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
/* 淡底档 */
.root.mark-tint .clr:hover {
  background: var(--danger-soft);
}
.root.mark-tint .clr.set:hover {
  background: var(--accent-soft);
}
/* 实心档：整块铺满 + 字反白。
   ⚠️ 红底上**不能用 `--row-on-tx`** —— 那是"配强调色"算出来的（深色主题下是近黑色），
     压在红底上会糊；这里恒用白。 */
.root.mark-solid .clr:hover {
  background: var(--danger);
  color: #fff;
}
.root.mark-solid .clr.set:hover {
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
 *   2. 底栏两颗按钮（设置 / 清空）被盖住点不到，所以 `openSettings()` 里那条 toggle
 *      一直没敢在文案里兑现；
 *   3. 面板底下压着字，面板就必须铺一层恒实底（`--surface-float`），
 *      于是「默认」档（面板透明、露宿主材质）下面板仍是白底，跟列表区有色差。
 *
 * 让位之后面板底下什么都没有，第 3 条自然消失 —— 面板改用 `--surface`，跟列表区同材质。
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
.chips {
  display: flex;
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
</style>
