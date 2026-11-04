import { computed, reactive, ref, watch } from 'vue'
import { api, favoritesStore, prefsStore, contentId, toImgSrc } from '../api'
import type { Category, ClipboardRecord, FavoriteSnapshot, ItemKind } from '../types'
import { IMG_SCALES, IMG_SCALE_ORDER, type ImgScale } from '../utils/layout'
import { webUrlOf } from '../utils/format'
import { clearFileCache, forgetFile } from '../utils/fs'
import { localPathsOf, staleVerdict } from '../utils/stale'

const PAGE_SIZE = 60
const SEARCH_DEBOUNCE = 100

/**
 * 首屏之后后台多拉一段历史，用来把分类计数算准、并让分类过滤能看到更多记录。
 * 宿主每次 getHistory 都是"全量取出再切片"，所以一次取 500 条和取 60 条的
 * 成本几乎一样 —— 分页大小在这里不是成本项，IPC 序列化才是。
 */
const HYDRATE_SIZE = 500

/** 切到某个分类但已加载数据里一条都没有时，最多再往后翻几页把它找出来 */
const CAT_SCAN_PAGES = 10

/* ------------------------------------------------------------------ */
/* 单例状态                                                            */
/* ------------------------------------------------------------------ */

const records = ref<ClipboardRecord[]>([])
const favorites = ref<FavoriteSnapshot[]>([])
const activeCat = ref<Category>('all')
const query = ref('')
const selectedIndex = ref(0)
const page = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const remoteSearching = ref(false)
/** 宿主侧历史总数（不受本地加载了几页影响，用于"全部"的计数） */
const totalCount = ref(0)
/** 后台补全历史中 */
const hydrating = ref(false)
/**
 * 远端搜索结果。
 * 必须与 records 分开存放：搜索命中的往往是靠后的历史，一旦并入 records，
 * 清空搜索词后它们会永久留在列表里、并把侧栏计数顶高。
 */
const remoteResults = ref<ClipboardRecord[]>([])
/** 宿主子输入框是否注册成功（失败时页面显示自带搜索框兜底） */
const subInputReady = ref(false)
/** 让页面内搜索框聚焦的计数器（宿主子输入框不可用时用它接手，自增即触发一次聚焦） */
const searchFocusTick = ref(0)

/* 图片行显示密度（持久化，默认标准） */
const imgScale = ref<ImgScale>(loadImgScale())
const imgScaleLabel = computed(() => IMG_SCALES[imgScale.value].label)

function loadImgScale(): ImgScale {
  const v = prefsStore.get('imgScale', 'md')
  return (IMG_SCALE_ORDER as readonly string[]).includes(v) ? (v as ImgScale) : 'md'
}

const favIds = computed(() => new Set(favorites.value.map((f) => f.id)))

/* ------------------------------------------------------------------ */
/* 过滤                                                                */
/* ------------------------------------------------------------------ */

function matchCat(r: ClipboardRecord): boolean {
  if (activeCat.value === 'all') return true
  if (activeCat.value === 'star') return favIds.value.has(favKey(r))
  return r.kind === activeCat.value
}

/**
 * 关键词匹配。口径与宿主 clipboardManager.search 保持一致：
 * 宿主匹配 content / files[].name / preview 三处，本地若只匹配 content，
 * 会出现"宿主搜得到、界面过滤掉"或反之的错乱。
 */
function matchQuery(r: ClipboardRecord): boolean {
  const q = query.value.trim().toLowerCase()
  if (!q) return true
  if (r.kind === 'file' && r.files && r.files.some((f) => f.toLowerCase().includes(q))) {
    return true
  }
  // 图片记录的 content 可能是整段 data URL / base64，拿它做文本匹配会误命中
  const c = r.content
  if (!(/^data:/i.test(c) && c.length > 256) && c.toLowerCase().includes(q)) return true
  if (r.preview?.toLowerCase().includes(q)) return true
  if (r.appName?.toLowerCase().includes(q)) return true
  return false
}

/** 收藏在记录列表中的 key（同内容同分类视为同一条） */
function favKey(r: ClipboardRecord): string {
  return contentId(r.kind, r.files ? r.files.join('|') : r.content)
}

/** star 分类下的"记录"：直接由收藏快照构造，删除原记录也不丢 */
const favoriteRecords = computed<ClipboardRecord[]>(() =>
  favorites.value.map((f) => ({
    id: f.id,
    kind: f.kind,
    rawType: f.kind,
    content: f.content,
    files: f.files,
    createdAt: f.createdAt,
    raw: null
  }))
)

/**
 * 过滤的数据源：正常是已加载历史；搜索时并入远端搜索结果（按 id 去重）。
 * 远端结果不入 records，所以清空关键词后列表会干净地回到原样。
 */
const source = computed<ClipboardRecord[]>(() => {
  if (remoteResults.value.length === 0) return records.value
  const seen = new Set<string>()
  const out: ClipboardRecord[] = []
  for (const r of remoteResults.value) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      out.push(r)
    }
  }
  for (const r of records.value) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      out.push(r)
    }
  }
  return out
})

const filtered = computed<ClipboardRecord[]>(() => {
  if (activeCat.value === 'star') {
    const q = query.value.trim().toLowerCase()
    if (!q) return favoriteRecords.value
    return favoriteRecords.value.filter(matchQuery)
  }
  return source.value.filter((r) => matchCat(r) && matchQuery(r))
})

/**
 * 列表标识：分类或搜索词发生变化 —— 等于"换了一批数据"。
 * 虚拟列表据此把滚动位置拉回顶部；翻页加载时该值不变，滚动位置得以保留。
 */
const listKey = computed(() => `${activeCat.value}|${query.value}`)

const counts = reactive<Record<Category, number>>({
  all: 0, text: 0, link: 0, code: 0, color: 0, image: 0, file: 0, star: 0
})

/**
 * 重算侧栏计数。
 *   all  —— 用宿主总数，而不是"本地已加载条数"：
 *           否则用户会看到"全部 60 条"，但往下滚还能不断加载出新记录。
 *   star —— 收藏数（独立持久化，不受分页影响）
 *   其余 —— 按已加载记录统计，后台补全（hydrate）后会覆盖更大范围
 */
function recount(): void {
  const c: Record<string, number> = {
    all: totalCount.value || records.value.length,
    star: favorites.value.length
  }
  for (const r of records.value) c[r.kind] = (c[r.kind] ?? 0) + 1
  for (const k of Object.keys(counts) as Category[]) {
    counts[k] = c[k] ?? 0
  }
}

/* ------------------------------------------------------------------ */
/* 加载                                                                */
/* ------------------------------------------------------------------ */

let loadSeq = 0
let hydrateSeq = 0
/** 已经做过"往后翻页找记录"的分类（见 scanForCat） */
const scannedCats = new Set<Category>()

async function loadFirst(): Promise<void> {
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await api.getHistory(1, PAGE_SIZE)
    if (seq !== loadSeq) return
    records.value = res.items
    page.value = 1
    hasMore.value = res.hasMore
    totalCount.value = res.total || res.items.length
    // 整页重拉过就是"追平"了，避免刚打开就白白再探一次
    syncedCount = totalCount.value
    selectedIndex.value = 0
    scannedCats.clear()
    recount()
  } finally {
    if (seq === loadSeq) loading.value = false
    // 首屏已出，再去补一段历史（不阻塞渲染）
    if (seq === loadSeq) void hydrate()
  }
}

/**
 * 后台补全：多拉一段历史，把分类计数与分类过滤的覆盖范围从"第一页"扩大。
 * 不做这件事就会出现"侧栏代码 0 条、切进去一片空，但在全部里往下滚又能看到代码"。
 */
async function hydrate(): Promise<void> {
  const seq = ++hydrateSeq
  hydrating.value = true
  try {
    const res = await api.getHistory(1, HYDRATE_SIZE)
    if (seq !== hydrateSeq) return

    const seen = new Set(records.value.map((r) => r.id))
    records.value = records.value.concat(res.items.filter((r) => !seen.has(r.id)))

    totalCount.value = res.total || records.value.length
    syncedCount = totalCount.value
    hasMore.value = res.hasMore
    // 分页游标跟进到实际数据末尾，否则后续翻页会重复拉取已加载区间
    page.value = Math.max(page.value, Math.ceil(records.value.length / PAGE_SIZE))
    recount()
  } catch {
    /* 补全失败不影响主流程：计数退回按已加载数据统计 */
  } finally {
    if (seq === hydrateSeq) hydrating.value = false
  }
}

async function loadMore(): Promise<void> {
  if (loading.value || !hasMore.value || query.value.trim()) return
  const seq = ++loadSeq
  loading.value = true
  try {
    const res = await api.getHistory(page.value + 1, PAGE_SIZE)
    if (seq !== loadSeq) return
    const seen = new Set(records.value.map((r) => r.id))
    records.value = records.value.concat(res.items.filter((r) => !seen.has(r.id)))
    page.value += 1
    hasMore.value = res.hasMore
    if (res.total) totalCount.value = res.total
    recount()
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

/* ------------------------------------------------------------------ */
/* 实时性：宿主推送 + 运行期轮询兜底                                    */
/* ------------------------------------------------------------------ */

/**
 * 轮询间隔。
 *
 * **不再区分"台前/台后"** —— v1.0.26 把退出后的轮询降到 5 秒，结果用户
 * "复制完马上再打开"时正好落在空窗里，看着还是旧的。一次 `getStatus()`
 * 只是取 4 个字段，1.2 秒一次的代价远小于"看着不动"的体验损失。
 */
export const POLL_INTERVAL_MS = 1200

/** 旧名字保留（外部/测试可能还在引用），现在与快速档一致 */
export const IDLE_POLL_INTERVAL_MS = POLL_INTERVAL_MS

/** 每次"探新"拉多少条最新的历史（够覆盖一次连续复制） */
const HEAD_SIZE = 5

/**
 * "重新亮出来"时一次补多少条。
 *
 * 插件关着的这段时间用户可能复制了一串东西，只补 5 条会在列表中间留个断层
 * （新的一批之后直接接上很旧的记录）。离开越久越明显，所以这里放宽到 50。
 */
const WAKE_SYNC_SIZE = 50

let pollTimer: ReturnType<typeof setInterval> | null = null
/** 上一拍的时间，用来识别"定时器被挂起了很久，刚恢复" */
let lastTickAt = 0

/**
 * **已经确认"本地列表追平宿主"的那个计数**。
 *
 * 这个值必须和 `totalCount`（显示用的计数）分开：
 * v1.0.26 的写法是"探到宿主计数变了就先把 totalCount 改掉，再异步去同步"，
 * 只要紧接着那次同步没把记录并进来（宿主正在写库 / 返回的 id 全都已存在 /
 * 这一拍抛错被吞掉），`totalCount` 就已经等于宿主计数了 —— 下一拍直接判定
 * "没变化"，**从此再也不同步**，直到整页重载。用户看到的就是"第二次打开
 * 数据不是最新的，必须关掉重开"。所以这里只在**确实对齐**之后才推进它。
 */
let syncedCount = 0

/**
 * 把宿主库里最新的一批记录并入列表。
 *
 * 只补"本地没有的"，并且是 prepend —— 新复制的一定在最前面。
 * 返回确实新增了几条（0 表示没变化）。
 *
 * 同步成功才推进 `syncedCount`；失败（异常、或取回来的头部跟本地对不上）
 * 就**保持原值**，让下一拍重试 —— 宁可多拉一次，也不要进入"永远不更新"的僵死态。
 */
async function syncLatest(limit = HEAD_SIZE): Promise<number> {
  const anchorId = filtered.value[selectedIndex.value]?.id ?? null
  try {
    const res = await api.getHistory(1, limit)
    const seen = new Set(records.value.map((r) => r.id))
    const fresh = res.items.filter((r) => !seen.has(r.id))
    if (fresh.length > 0) {
      records.value = fresh.concat(records.value)
    }
    const total = res.total || records.value.length
    // 先更新总数再重算计数 —— 反过来的话侧栏"全部"会停在上一次的值上，
    // 看着就是"列表长了、计数没动"。
    totalCount.value = total
    if (fresh.length > 0) recount()
    // 没有增量的情况要额外确认"头部跟宿主一致"，否则可能是宿主还没写进去，
    // 这时候推进计数就会把后续的重试挡掉。
    const hostTop = res.items[0]?.id ?? null
    if (fresh.length > 0 || !hostTop || records.value[0]?.id === hostTop) {
      syncedCount = total
    }
    return fresh.length
  } catch {
    /* 宿主忙/窗口正在关闭：这一拍不算事，不推进 syncedCount，下一拍还会再来 */
    return 0
  } finally {
    restoreSelection(anchorId)
  }
}

/**
 * 按**记录身份**重新落位，而不是按下标挪数。
 *
 * 列表在用户眼皮底下会变（轮询把新复制的内容插到最前面、远端搜索结果回来、
 * 切换分类），只改下标的话，正盯着的那条会被别人顶掉 —— 回车复制出来就不是
 *   const anchor = 当前选中记录的 id; ...改数据...; restoreSelection(anchor)
 */
function restoreSelection(id: string | null): void {
  if (!id) {
    if (selectedIndex.value >= filtered.value.length) {
      selectedIndex.value = Math.max(0, filtered.value.length - 1)
    }
    return
  }
  const i = filtered.value.findIndex((r) => r.id === id)
  if (i >= 0) selectedIndex.value = i
  else if (selectedIndex.value >= filtered.value.length) {
    selectedIndex.value = Math.max(0, filtered.value.length - 1)
  }
}

/** 用一次轻量查询判断"库里是不是多了东西"（只读，不改任何计数状态） */
async function hasNewRecords(): Promise<boolean> {
  const n = await api.clipboardCount()
  if (n === null) return true // 老宿主没有 getStatus：不看也查，反正只是多一次 IPC
  return n !== syncedCount
}

/**
 * 轮询只有这一个计时器。
 *
 * 台前台后都跑：隐藏期间 Chromium 会自己降频（1 秒下限），恢复时会立刻补拍，
 * 所以不需要我们再分档 —— 分档反而制造出"刚打开时正好没拍"的空窗。
 */
function poll(): void {
  if (pollTimer) return
  const timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)
  // Node（单元测试）里定时器会挂住事件循环；浏览器里 setInterval 返回 number，
  // 没有 unref，这行只是空操作。
  ;(timer as unknown as { unref?: () => void }).unref?.()
  pollTimer = timer
}

/**
 * 一拍的心跳。
 *
 * 除了"探新"，还顺便判断**上一拍离现在是不是远超正常间隔** —— 隐藏/挂起的页面
 * 定时器会被暂停，恢复后的第一拍就会出现明显跳拍。这就是"窗口刚被重新打开"的
 * 一个不依赖任何宿主事件的信号（`visibilitychange`、`focus` 在某些隐藏方式下并不触发）。
 */
async function tick(): Promise<void> {
  const now = Date.now()
  const jumped = lastTickAt > 0 && now - lastTickAt > POLL_INTERVAL_MS * 2.5
  lastTickAt = now
  if (jumped) {
    await refreshOnShow()
    return
  }
  if (await hasNewRecords()) await syncLatest(HEAD_SIZE)
}

/**
 * "又被打开了"时的一次对账 —— **只有一次 IPC**。
 *
 * 拉一批最新的，直接拿这次的结果判断：
 *   - 有新增 → prepend（新的一定在最前）
 *   - 没新增但**头部跟宿主不一致**（顺序变了 / 关着时复制太多超过一批）→ 整页重拉
 * 一次调用搞定，省掉"先补一批再单独查头部"那一趟，越快，用户越看不到数据被追加。
 */
let lastRefreshAt = 0
const REFRESH_DEDUPE_MS = 120

async function refreshOnShow(): Promise<void> {
  const now = Date.now()
  const since = now - lastRefreshAt
  // 负数是"系统时间回拨/校时"：不能据此判定"刚刷过"，否则会一直跳过
  if (since >= 0 && since < REFRESH_DEDUPE_MS) return
  lastRefreshAt = now

  const anchorId = filtered.value[selectedIndex.value]?.id ?? null
  try {
    // 先用最便宜的一步挡掉"其实什么都没变"的常见情况（只是打开又关上）：
    // 一次 getStatus 往往不到 1ms，比拉 50 条历史快得多。
    const n = await api.clipboardCount()
    if (n !== null && n === syncedCount) return

    const res = await api.getHistory(1, WAKE_SYNC_SIZE)
    const seen = new Set(records.value.map((r) => r.id))
    const fresh = res.items.filter((r) => !seen.has(r.id))
    // 没有新增时，头部必须跟宿主一致；不一致说明本地漏了/顺序变了，整页重拉
    if (fresh.length === 0 && res.items[0] && records.value[0]?.id !== res.items[0].id) {
      await loadFirst()
      return
    }
    if (fresh.length > 0) records.value = fresh.concat(records.value)
    const total = res.total || records.value.length
    // 先更新总数再重算：反过来侧栏"全部"会停在上一次的值上
    totalCount.value = total
    if (fresh.length > 0) recount()
    syncedCount = total
  } catch {
    /* 宿主忙：交给轮询兜底，不推进 syncedCount */
  } finally {
    restoreSelection(anchorId)
  }
}

/**
 * 恢复检测（最快的一路）：**动画帧**。
 *
 * 窗口隐藏 / 被遮挡时浏览器会暂停 `requestAnimationFrame`，重新显示后的第一帧
 * 与上一帧的间隔必然很大。这是唯一能在"窗口刚出现"这一帧就察觉的信号 ——
 * 定时器最慢要等一整拍（1.2 秒），用户就会亲眼看到数据被补上去的那一下。
 * 检测延迟约一帧（16ms），等于"打开即最新"。
 */
const FRAME_GAP_MS = 250
let frameWatchStop: (() => void) | null = null

function watchFrames(): void {
  if (frameWatchStop) return
  if (typeof requestAnimationFrame !== 'function') return
  let last = 0
  let stopped = false
  const loop = (): void => {
    if (stopped) return
    const now = Date.now()
    if (last > 0 && now - last > FRAME_GAP_MS) void refreshOnShow()
    last = now
    requestAnimationFrame(loop)
  }
  frameWatchStop = () => {
    stopped = true
  }
  requestAnimationFrame(loop)
}

/**
 * 插件到了台前：立刻对账一次，并确保轮询在跑。
 *
 * `bulk` 用于"刚被重新打开"的场景 —— 关着的时候可能复制了一串。
 */
function startWatching(bulk = false): void {
  if (bulk) void refreshOnShow()
  else void syncLatest(HEAD_SIZE)
  poll()
}

/** 插件退到台后：轮询继续保持（隐藏期间本来就会被降频），只记一笔"已离开" */
function idleWatching(): void {
  poll()
}

function stopWatching(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  lastTickAt = 0
}

/* ------------------------------------------------------------------ */
/* "插件又被打开了"的判定                                               */
/* ------------------------------------------------------------------ */

let lastShownAt = 0
/** 用来把"同一次打开"里的多个信号（focus + visibility + PluginEnter）合并成一次同步 */
const SHOW_DEDUPE_MS = 300

/**
 * dev 模式的构建戳自检（每次"被打开"都查一遍，放在去重闸门之前）。
 *
 * 背景：dev 插件的视图是**持久化**的 —— 失焦关闭只是隐藏窗口，页面里那次加载
 * 的 JS 会一直跑下去。也就是说磁盘上 dist 换了新构建，视图里还是旧代码，
 * 用户在旧代码上测新修复，怎么测都是旧行为（1.0.26~28 连续三轮"没修好"的真相）。
 *
 * 做法：vite 构建时把唯一戳写进 dist/BUILD_ID，并注入进本次页面（__BUILD_STAMP__）。
 * 这里用 preload 的 fs 读磁盘上的戳，不一致就整页 location.reload() ——
 * 重新构建完，下次打开插件自动跑上新代码，不用手动"结束运行"。
 *
 * 守卫：
 *   - 只在 file:// 下生效（dev server 是 http，Vite HMR 自己管；市场版走宿主更新流）
 *   - 读不到 BUILD_ID（无 fs / 老宿主）→ 不动作
 */
declare const __BUILD_STAMP__: string

function checkNewBuild(): void {
  if (typeof location === 'undefined' || location.protocol !== 'file:') return
  // dev server（import.meta.env.DEV 构建）没有注入这个量；typeof 对未声明标识符是安全的
  if (typeof __BUILD_STAMP__ !== 'string') return
  const services = (typeof window !== 'undefined' ? (window as unknown as { services?: { readBuildStamp?: () => string | null } }).services : undefined)
  const stamp = services?.readBuildStamp?.()
  if (stamp && stamp !== __BUILD_STAMP__) location.reload()
}

/**
 * 插件被重新亮出来时该做的事。
 *
 * 为什么要单独有这么一个入口：
 *   宿主 `createPluginView` 里有个 `shouldSkipReEnter()` —— 当插件**已经是当前视图**、
 *   并且用户又是用同一条文本指令打开时，它直接
 *   `abortCurrentSession('singleton-skip-reenter')` 返回，**不发 `PluginEnter`**。
 *   于是只挂 `onPluginEnter` 的插件：不知道窗口又开了 → 不一上来同步、轮询还停在
 *   `onPluginOut` 之后的慢速档 → 列表就像冻住了，只有"结束运行再打开"（整页重载）才好。
 *   实测就是用户报的："复制完再按快捷键打开，不刷新"。
 *
 * 所以这里改用**页面自己能感知到的信号**：窗口显示出来时 `visibilitychange` 必然触发，
 * 窗口获得焦点时还会有 `focus`；再加上宿主的 `PluginEnter`，三路任意一路都能唤醒。
 */
function onShown(): void {
  // 先查构建戳再谈别的：真要重载的话，后面的刷新都是白做
  checkNewBuild()
  const now = Date.now()
  const since = now - lastShownAt
  // 同上：时间回拨时不要把自己锁在"刚打开过"里
  if (since >= 0 && since < SHOW_DEDUPE_MS) return
  lastShownAt = now
  focusSearch()
  startWatching(true)
}

/**
 * 挂上渲染进程侧的"窗口又出现"监听。返回解绑函数（单例 store 用不到，但方便测试）。
 *
 * 四路信号，任一路都能唤醒：
 *   - `visibilitychange`：窗口显示（某些隐藏方式下不触发，所以不能只靠它）
 *   - `focus`：窗口重新获得焦点
 *   - **用户一动（鼠标/键盘）**：插件打开后用户迟早要按方向键或打字，这时列表必须是对的
 *   - 定时器跳拍（见 tick）
 */
function watchWindowShow(): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
    return () => undefined
  }
  const onFocus = (): void => onShown()
  const onVisible = (): void => {
    if (typeof document === 'undefined' || !document.hidden) onShown()
  }
  // 距上次交互超过这个间隔，才算"人刚回到插件"（避免连续打字时每一下都拉一次）
  const INTERACT_GAP_MS = 2000
  let lastInteractAt = 0
  const onInteract = (): void => {
    const now = Date.now()
    if (lastInteractAt > 0 && now - lastInteractAt > INTERACT_GAP_MS) void refreshOnShow()
    lastInteractAt = now
  }

  window.addEventListener('focus', onFocus)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', onVisible)
    document.addEventListener('keydown', onInteract, true)
    document.addEventListener('mousemove', onInteract, { passive: true })
  }
  return () => {
    window.removeEventListener?.('focus', onFocus)
    document?.removeEventListener?.('visibilitychange', onVisible)
    document?.removeEventListener?.('keydown', onInteract, true)
    document?.removeEventListener?.('mousemove', onInteract)
  }
}


/* ------------------------------------------------------------------ */
/* 搜索：本地即时过滤 + 远端防抖补充                                   */
/* ------------------------------------------------------------------ */

let searchTimer: ReturnType<typeof setTimeout> | null = null

function setQuery(q: string): void {
  query.value = q
  selectedIndex.value = 0
  if (searchTimer) clearTimeout(searchTimer)
  const kw = q.trim()
  if (!kw) {
    remoteSearching.value = false
    // 关键词清空 → 远端结果立即退场，列表回到原始历史
    remoteResults.value = []
    if (records.value.length === 0) void loadFirst()
    return
  }
  searchTimer = setTimeout(async () => {
    remoteSearching.value = true
    const anchorId = filtered.value[selectedIndex.value]?.id ?? null
    try {
      const remote = await api.search(kw)
      // 期间用户又改了关键词：丢弃这次过期结果
      if (query.value.trim() !== kw) return
      remoteResults.value = remote
    } catch {
      /* 远端搜索失败不致命：本地已加载历史仍然即时过滤 */
    } finally {
      if (query.value.trim() === kw) {
        // 远端结果是**插在前面的**，回来时按身份落位，
        // 否则等待期间用户挪过光标的话，回车复制的就是另一条了
        restoreSelection(anchorId)
        remoteSearching.value = false
      }
    }
  }, SEARCH_DEBOUNCE)
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

/**
 * 已经按 id 写回过的宿主记录。
 *
 * 宿主 `writeToClipboard` 写回时会先把原纪录从库里删掉（删了才会让你再看到
 * "最新"的一份），所以**同一个 id 第二次写必然失败**；而 `clipboard:write`
 * 失败了照样 `simulatePaste()` —— 粘出来的就是剪贴板上一条内容。
 * 记住这些 id，第二次不再去撞墙（见 copyRecord）。
 */
const spentIds = new Set<string>()

/** 一条图片记录的 content 是不是真的图片数据（不是"过大未保存"之类的占位文案） */
function isRealImageData(c: string): boolean {
  if (!c) return false
  if (/^data:image\//i.test(c)) return true
  // 裸 base64（够长才可能是一张图）
  if (/^[A-Za-z0-9+/=\s]{256,}$/.test(c)) return true
  return /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(c.trim())
}

/**
 * 把一条记录整理成"按内容写回"的载荷。拿不到内容时返回 null
 * —— 那种情况只能怪宿主 id 那条路（超大图只留了占位文案之类）。
 */
function contentPayload(
  r: ClipboardRecord
): { type: 'text' | 'image' | 'file'; content: string | string[] } | null {
  if (r.kind === 'file') {
    return r.files && r.files.length > 0 ? { type: 'file', content: r.files } : null
  }
  if (r.kind === 'image') {
    return isRealImageData(r.content) ? { type: 'image', content: r.content } : null
  }
  return r.content ? { type: 'text', content: r.content } : null
}

/**
 * 复制一条记录到系统剪贴板。
 *
 * **按内容写优先**，这是被宿主的实现方式逼出来的：
 *   - `write-content`：写成功才粘贴 → 失败时什么都不会粘，安全；
 *   - `write(id)`：**写失败也粘贴** → 失败时把剪贴板上一条内容粘出去了，
 *     就是用户遇到的"我要的是 A，粘出来是 B"。
 * 而宿主记录并不总是还在库里（写回会删原纪录、过期清理会删旧记录、
 * 图片空间回收会删原图），所以能不依赖 id 就不依赖。
 */
async function copyRecord(r: ClipboardRecord, exit = true): Promise<void> {
  let ok = false
  let why = ''
  try {
    const payload = contentPayload(r)
    if (payload) ok = await api.writeContent(payload.type, payload.content)

    // 拿不到内容（只能按 id 写）或内容写失败时，退回按 id 写一次。
    // 已经写回过的 id 宿主早删了，不去撞墙 —— 撞墙就是一次必粘的错误粘贴。
    if (!ok && !spentIds.has(r.id)) {
      ok = await api.write(r.id)
      if (ok) spentIds.add(r.id)
    }
  } catch (e) {
    why = e instanceof Error ? e.message : String(e)
  }

  if (!ok) {
    // 如实告知，并且**不要退出**：这时候退出，用户顺手 Ctrl+V 粘出来的
    // 会是剪贴板里旧的内容，比留在原地更糟。
    api.toast(why ? '复制失败：' + why : '这条记录已经失效，无法写入剪贴板')
    return
  }
  if (exit) api.outPlugin()
}

/* ------------------------------------------------------------------ */
/* 打开插件时自动聚焦搜索框                                            */
/* ------------------------------------------------------------------ */

/**
 * 聚焦重试的时间点。
 *
 * 为什么必须在 onPluginEnter 里抢焦点：宿主 process 模式的顺序是
 *   setExpendHeight → pluginView.webContents.focus() → 派发 PluginEnter
 * 也就是说宿主**先**把焦点给了插件页面，**后**才通知"插件已进入"。
 * 页面挂载时那次 setSubInput(isFocus=true) 必然被随后的 view.focus() 抢走，
 * 所以挂载时聚焦没用，必须在进入事件里补。
 *
 * 为什么要重试：窗口显示、渲染层 ack 等也会再抢一次焦点，单次调用仍可能失效。
 * 退出插件时（onPluginOut）会取消尚未执行的重试，避免在插件已关闭后空抢焦点。
 */
const FOCUS_RETRIES = [0, 120, 320]

let focusTimers: Array<ReturnType<typeof setTimeout>> = []

function cancelFocus(): void {
  for (const t of focusTimers) clearTimeout(t)
  focusTimers = []
}

/** 焦点交给页面内搜索框（宿主子输入框用不了时的兜底） */
function focusOwnInput(): void {
  subInputReady.value = false
  searchFocusTick.value++
}

/** 打开插件时调用：把焦点抢到搜索框上 */
function focusSearch(): void {
  if (!subInputReady.value) {
    searchFocusTick.value++
    return
  }
  cancelFocus()
  for (const delay of FOCUS_RETRIES) {
    focusTimers.push(
      setTimeout(() => {
        // 已有关键词：聚焦并全选，否则新输入会被拼到旧词后面（如 "vue" + "re" → "vuerre"）
        const ok = query.value.trim() ? api.selectSubInput() : api.focusSubInput()
        // 宿主注册了子输入框却不肯给焦点：退回页面内搜索框，别让用户没处打字
        if (!ok) focusOwnInput()
      }, delay)
    )
  }
}

/**
 * 在文件管理器中定位文件。
 * 成功后退出插件窗口，否则资源管理器会开在插件窗口后面，用户以为没反应。
 */
async function revealFile(path: string): Promise<void> {
  if (!path) return
  try {
    const ok = await api.reveal(path)
    if (!ok) {
      api.toast('无法定位到该路径：' + path)
      return
    }
    api.outPlugin()
  } catch (e) {
    api.toast('定位失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

/**
 * 用系统默认浏览器打开一条链接记录。
 *
 * 与"定位文件"同理，打开成功后必须退出插件：浏览器窗口会开在插件窗口
 * **后面**（插件窗口是置顶的），不退出的话用户以为点了没反应。
 * 内容不可信，所以先经 webUrlOf 过滤协议（只放行 http/https）。
 */
async function openLink(r: ClipboardRecord): Promise<void> {
  const url = webUrlOf(r.content)
  if (!url) {
    api.toast('这条内容不是一个可打开的网址')
    return
  }
  try {
    const ok = api.openExternal(url)
    if (!ok) {
      api.toast('未能打开浏览器：' + url)
      return
    }
    api.outPlugin()
  } catch (e) {
    api.toast('打开失败：' + (e instanceof Error ? e.message : String(e)))
  }
}

/**
 * 删除一条记录。
 *
 * **以界面为准（乐观删除）**：不再因为宿主接口返回失败就弹"删除失败"、
 * 然后什么都不做 —— 用户点的是界面上的记录，点了就该消失。
 *
 * 最典型的失败场景就是"收藏"分类：那里的记录是**本插件自己的快照**，
 * id 是内容 key，宿主历史库里压根没有这条 id，delete 必然失败；
 * 拿它的返回值卡住界面，等于让"删除"按钮在收藏里完全失效。
 * 宿主那边万一真没删掉，下次打开还在，再删一次即可（失败只在控制台留痕）。
 */
async function deleteRecord(r: ClipboardRecord): Promise<void> {
  const idx = filtered.value.findIndex((x) => x.id === r.id)
  if (activeCat.value === 'star') {
    // 收藏快照由本插件持久化，没有宿主记录可删：改本地即可
    favorites.value = favorites.value.filter((f) => f.id !== r.id)
    favoritesStore.save(favorites.value)
    recount()
  } else {
    records.value = records.value.filter((x) => x.id !== r.id)
    // 远端搜索结果里可能存着同一条（source 按 id 去重，只删一边它会"复活"）
    remoteResults.value = remoteResults.value.filter((x) => x.id !== r.id)
    if (totalCount.value > 0) totalCount.value -= 1
    recount()
    // 通知宿主删除，但不拿它的返回值拦界面
    void api.remove(r.id).catch((e: unknown) => {
      console.warn('[y-clipboard] 宿主侧删除未成功（界面已移除）：', e)
    })
  }
  if (idx >= 0 && idx < filtered.value.length) {
    selectedIndex.value = Math.min(idx, filtered.value.length - 1)
  } else if (filtered.value.length > 0) {
    selectedIndex.value = filtered.value.length - 1
  } else {
    selectedIndex.value = 0
  }
}

function toggleStar(r: ClipboardRecord): void {
  const key = favKey(r)
  if (favIds.value.has(key)) {
    favorites.value = favorites.value.filter((f) => f.id !== key)
  } else {
    const snap: FavoriteSnapshot = {
      id: key,
      kind: r.kind,
      content: r.content,
      files: r.files,
      createdAt: r.createdAt || Date.now()
    }
    favorites.value = [snap, ...favorites.value].slice(0, 200)
  }
  favoritesStore.save(favorites.value)
  recount()
}

/**
 * 清空历史。同样是"以界面为准"：宿主 clear 返回 0（老版本不返回 count）
 * 也照样清空列表 —— 弹了清空却什么都没变，比不弹更让人困惑。
 * 提示里的条数用界面上真实存在的条数，不用宿主的返回值。
 */
async function clearAll(): Promise<void> {
  // 条数以宿主总数为准：列表可能只加载了一部分（HYDRATE_SIZE），
  // 拿 records.length 会提示"清空 500 条"而实际清了 2000 条
  const n = Math.max(records.value.length, totalCount.value)
  void api.clear().catch((e: unknown) => {
    console.warn('[y-clipboard] 宿主侧清空未成功（界面已清空）：', e)
  })
  records.value = []
  page.value = 0
  hasMore.value = false
  totalCount.value = 0
  scannedCats.clear()
  recount()
  api.toast(n > 0 ? `已清空 ${n} 条记录` : '已清空')
}

/**
 * 「清空历史」按钮走的入口：先在插件内问一句，再调 clearAll。
 * 同样是插件内弹窗（不用 window.confirm）。
 */
async function requestClearAll(ask: ConfirmAsk = askConfirm): Promise<void> {
  const n = Math.max(records.value.length, totalCount.value)
  if (n === 0) {
    api.toast('已经没有历史了')
    return
  }
  const choice = await ask({
    title: `清空全部 ${n} 条历史？`,
    lines: ['收藏的内容会保留', '清空后无法恢复'],
    okText: '清空',
    danger: true
  })
  if (choice !== 'ok') return
  await clearAll()
}

/**
 * 本地移除若干条宿主记录。
 *
 * 与 deleteRecord 同源的三条约定：
 *   records 与 remoteResults 两边一起删（只删一边搜索结果会让它"复活"）；
 *   总数跟着减（列表变短、计数不动一样像没生效）；
 *   宿主侧 fire-and-forget，失败不回滚 —— 以界面为准。
 */
function removeRecords(list: ClipboardRecord[]): void {
  if (list.length === 0) return
  const ids = new Set(list.map((r) => r.id))
  const anchorId = filtered.value[selectedIndex.value]?.id ?? null

  records.value = records.value.filter((r) => !ids.has(r.id))
  remoteResults.value = remoteResults.value.filter((r) => !ids.has(r.id))
  // 路径存在与否的缓存是这次会话攒的，这些路径已经随记录一起走了
  for (const r of list) {
    for (const p of localPathsOf(r)) forgetFile(p)
  }
  totalCount.value = Math.max(0, totalCount.value - ids.size)
  recount()
  // 列表变短后按下标会指到别人身上，按身份重新落位
  restoreSelection(anchorId)

  for (const r of list) {
    void api.remove(r.id).catch((e: unknown) => {
      console.warn('[y-clipboard] 宿主侧删除未成功（界面已移除）：', e)
    })
  }
}

/* ------------------------------------------------------------------ */
/* 清理失效历史                                                        */
/* ------------------------------------------------------------------ */

/**
 * 一次清理最多检查多少条历史。
 *
 * 宿主的 getHistory 本身就是"全量取出再切片"，放大 pageSize 不增加宿主的开销，
 * 但 IPC 序列化的量会跟着涨（一条含 data URL 的图片记录能有几百 KB），
 * 所以设个上限，宁可少清一点也不要在这里卡住界面。
 */
export const SCAN_LIMIT = 2000

/**
 * 每批判定多少条之后让出一帧。
 *
 * 存在性查询是**同步**调用（preload 里直接读 fs），上千次连着问会把主线程
 * 钉死 —— 分批 + 让出一帧，界面才有机会显示进度、也不至于像卡死。
 */
export const SCAN_BATCH = 40

/** 清理进度：0~1（null = 没在扫） */
const cleanProgress = ref<number | null>(null)

const cleaning = computed(() => cleanProgress.value !== null)

interface StaleScan {
  /** 实际检查了多少条历史 */
  scanned: number
  /** 原文件全没了：整条废掉 */
  stale: ClipboardRecord[]
  /** 缺了一部分文件：还有几个活着，但整条复制已经会失败 */
  partial: ClipboardRecord[]
  /** 判断不了（未知）的条数 —— 不清理 */
  unknown: number
}

function nextFrame(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0))
}

/**
 * 扫一遍历史，找出"原文件已经不在了"的记录。
 *
 * 扫描前清空路径缓存：缓存是这次会话里攒的，磁盘早变了，照着缓存判定
 * 会把刚失效的记录漏掉。
 */
async function scanStale(): Promise<StaleScan> {
  // 取全量（受上限保护），而不是只扫已加载的那一页 —— 用户要的是"清干净"
  const want = Math.min(Math.max(totalCount.value, records.value.length, PAGE_SIZE), SCAN_LIMIT)
  const res = await api.getHistory(1, want)
  const list = res.items

  clearFileCache()
  const stale: ClipboardRecord[] = []
  const partial: ClipboardRecord[] = []
  let unknown = 0
  cleanProgress.value = 0
  try {
    for (let i = 0; i < list.length; i++) {
      const v = staleVerdict(list[i])
      if (v === 'stale') stale.push(list[i])
      else if (v === 'partial') partial.push(list[i])
      else if (v === 'unknown') unknown++
      if ((i + 1) % SCAN_BATCH === 0) {
        cleanProgress.value = (i + 1) / Math.max(1, list.length)
        await nextFrame()
      }
    }
    return { scanned: list.length, stale, partial, unknown }
  } finally {
    cleanProgress.value = null
  }
}

/** 弹窗结果：ok = 主操作；alt = 次操作（更保守的那一档）；cancel = 取消 */
export type ConfirmChoice = 'ok' | 'alt' | 'cancel'

export interface ConfirmRequest {
  /** 主问句 */
  title: string
  /** 补充说明，逐行展示 */
  lines: string[]
  /** 主按钮文案 */
  okText: string
  /** 次按钮文案；没有就不显示这一档 */
  altText?: string
  /** 主操作是破坏性的 → 红色 */
  danger?: boolean
}

export type ConfirmAsk = (req: ConfirmRequest) => ConfirmChoice | Promise<ConfirmChoice>

/* ------------------------------------------------------------------ */
/* 插件内确认弹窗                                                       */
/* ------------------------------------------------------------------ */

/**
 * 确认一律在插件窗口内问，**不用 window.confirm**。
 *
 * 在 Electron 里 `confirm` 弹的是系统级原生窗口：会跳到插件窗口外面、样式与
 * 主题无关、还挡住整个屏幕 —— 在一个 500px 的面板里这么做很突兀。
 * 这里改成状态机：谁想问都往这里登记，App 负责画，结果回到 Promise。
 */
const confirmRequest = ref<ConfirmRequest | null>(null)
let confirmResolve: ((c: ConfirmChoice) => void) | null = null

/** 问一句，等用户点按钮。没人接手（自动化测试）会一直挂着，所以必须注入 ask */
function askConfirm(req: ConfirmRequest): Promise<ConfirmChoice> {
  // 只保留一个弹窗：上一个没回答就又来一个，旧的直接按取消处理，
  // 否则它的 Promise 永远悬着、await 的那条链路再也不会往下走
  if (confirmResolve) {
    const prev = confirmResolve
    confirmResolve = null
    prev('cancel')
  }
  confirmRequest.value = req
  return new Promise<ConfirmChoice>((resolve) => {
    confirmResolve = resolve
  })
}

/** 弹窗/键盘把结果送回来 */
function settleConfirm(choice: ConfirmChoice): void {
  confirmRequest.value = null
  const resolve = confirmResolve
  confirmResolve = null
  if (resolve) resolve(choice)
}

/**
 * 清理失效历史：扫一遍 → 弹窗问 → 按选择删。
 *
 * 两档是刻意分开的：
 *   - 全没了的（stale）删掉毫无争议；
 *   - 只缺一部分的（partial）还有文件活着，清掉整条等于把那几个一起丢了。
 * 所以默认给的是"全部清理"，同时留一个"只清理完全失效的"退路 —— 由用户选，
 * 不替他决定。（`ask` 可注入，测试与"无界面环境"直接给答案。）
 *
 * 收藏是用户主动留下的、且是本插件自己的快照，不在清理范围内。
 */
async function cleanStale(ask: ConfirmAsk = askConfirm): Promise<void> {
  if (cleaning.value) return

  let scan: StaleScan
  try {
    scan = await scanStale()
  } catch (e) {
    api.toast('扫描失败：' + (e instanceof Error ? e.message : String(e)))
    return
  }

  const total = scan.stale.length + scan.partial.length
  if (total === 0) {
    api.toast(
      scan.scanned > 0 ? `没有发现失效记录（已检查 ${scan.scanned} 条）` : '暂无历史记录'
    )
    return
  }

  const lines: string[] = []
  if (scan.stale.length > 0) lines.push(`${scan.stale.length} 条的原文件已经全部不在了`)
  if (scan.partial.length > 0) {
    lines.push(`${scan.partial.length} 条只有部分文件还在（卡片上标着"已不存在"）`)
  }
  if (scan.unknown > 0) lines.push(`另有 ${scan.unknown} 条读不到原位置，已保留`)
  if (scan.scanned >= SCAN_LIMIT) lines.push(`本次只检查了最近 ${SCAN_LIMIT} 条历史`)
  lines.push('清理后无法恢复；收藏的内容不受影响')

  const choice = await ask({
    title: `发现 ${total} 条失效记录`,
    lines,
    okText: `清理 ${total} 条`,
    // 只有两档都非空时才有"退一步"的必要
    altText: scan.stale.length > 0 && scan.partial.length > 0 ? `只清理 ${scan.stale.length} 条` : undefined,
    danger: true
  })
  if (choice === 'cancel') return

  const target = choice === 'alt' ? scan.stale : [...scan.stale, ...scan.partial]
  removeRecords(target)
  api.toast(`已清理 ${target.length} 条失效记录`)
}

function setCat(cat: Category): void {
  activeCat.value = cat
  selectedIndex.value = 0
  void scanForCat(cat)
}

/**
 * 切到某个具体分类时，如果已加载的数据里一条都没有，就继续往后翻几页把它找出来。
 * 否则会出现"侧栏显示 0 条、切进去是空的，但在全部里往下滚又能看到"的矛盾。
 * 只针对具体类型分类：全部 / 收藏 不需要，搜索状态下翻页另有语义。
 */
async function scanForCat(cat: Category): Promise<void> {
  if (cat === 'all' || cat === 'star' || query.value.trim()) return
  // 扫过一次就够了：某类确实没有记录时，不必每次点它都白翻十几页
  if (scannedCats.has(cat)) return
  for (let i = 0; i < CAT_SCAN_PAGES; i++) {
    if (!hasMore.value) break
    if (records.value.some((r) => r.kind === cat)) break
    const before = page.value
    await loadMore()
    if (page.value === before) break // 页码没推进（并发被抢 / 已到底），避免死循环
  }
  scannedCats.add(cat)
}

function moveSelection(delta: number): void {
  const len = filtered.value.length
  if (len === 0) return
  selectedIndex.value = Math.min(len - 1, Math.max(0, selectedIndex.value + delta))
}

/** 图片密度三档循环：标准 → 大图 → 紧凑 */
function cycleImgScale(): void {
  const i = IMG_SCALE_ORDER.indexOf(imgScale.value)
  imgScale.value = IMG_SCALE_ORDER[(i + 1) % IMG_SCALE_ORDER.length]
  prefsStore.set('imgScale', imgScale.value)
}

/* 过滤结果变化时收拢选中下标，避免越界空选 */
watch(filtered, (list) => {
  if (selectedIndex.value >= list.length) selectedIndex.value = Math.max(0, list.length - 1)
})

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

let inited = false

function init(): void {
  if (inited) return
  inited = true

  favorites.value = favoritesStore.load()

  // 注册宿主子输入框。失败（宿主版本差异 / 非插件环境）时页面会显示自带搜索框兜底
  subInputReady.value = api.setSubInput(setQuery, '搜索剪贴板历史')

  /**
   * 宿主说"插件进来了"。**不能只信这个** —— 同指令重入时宿主会直接跳过它
   * （见 onShown 的注释），所以这里和 visibilitychange / focus 一并接。
   */
  api.onPluginEnter(() => {
    onShown()
  })
  // 渲染进程侧的"窗口又出现了"：这一路不依赖宿主的生命周期事件
  watchWindowShow()
  // 最快的一路：动画帧停摆后恢复（窗口刚出现的那一帧就能察觉）
  watchFrames()
  // 退出插件：取消尚未执行的重试，轮询降到慢速档（别彻底停，见 idleWatching）
  api.onPluginOut(() => {
    cancelFocus()
    idleWatching()
  })

  /**
   * 宿主推送（`clipboard.onChange` → 主进程 `sendPluginMessage('clipboard-change')`）。
   * 它只发给 `pluginManager.pluginView`（当前那个视图），实际并不总能收到 ——
   * 表现就是"插件开着，新复制的内容不出现，退出再进就好了"。
   * 所以这里只当它是**加速器**：收到就立刻同步一次，收不到另有下面的轮询兜底。
   */
  api.onChange(() => {
    void hasNewRecords().then((yes) => {
      if (yes) void syncLatest()
    })
  })

  void loadFirst()
}

export function useStore() {
  return {
    records, favorites, activeCat, query, selectedIndex,
    loading, hydrating, remoteSearching, hasMore, counts, filtered, listKey,
    subInputReady, searchFocusTick, focusSearch,
    imgScale, imgScaleLabel, cycleImgScale,
    cleaning, cleanProgress,
    init, loadFirst, loadMore, setQuery, setCat,
    copyRecord, deleteRecord, toggleStar, clearAll, requestClearAll, moveSelection,
    revealFile, openLink, favKey,
    scanStale, cleanStale,
    confirmRequest, askConfirm, settleConfirm,
    syncLatest, stopWatching
  }
}

export type Store = ReturnType<typeof useStore>

/** 供 ClipboardItem 使用的图片 src 转换（避免组件直接依赖 api 内部） */
export { toImgSrc }
export type { Category, ItemKind }
