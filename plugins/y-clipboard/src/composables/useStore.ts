import { computed, reactive, ref, watch } from 'vue'
import { api, favoritesStore, prefsStore, isDevMock, contentId, toImgSrc } from '../api'
import type { Category, ClipboardRecord, FavoriteSnapshot, ItemKind } from '../types'
import { IMG_SCALES, IMG_SCALE_ORDER, type ImgScale } from '../utils/layout'
import { webUrlOf } from '../utils/format'

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
    try {
      const remote = await api.search(kw)
      // 期间用户又改了关键词：丢弃这次过期结果
      if (query.value.trim() !== kw) return
      remoteResults.value = remote
    } catch {
      /* 远端搜索失败不致命：本地已加载历史仍然即时过滤 */
    } finally {
      if (query.value.trim() === kw) remoteSearching.value = false
    }
  }, SEARCH_DEBOUNCE)
}

/* ------------------------------------------------------------------ */
/* 动作                                                                */
/* ------------------------------------------------------------------ */

async function copyRecord(r: ClipboardRecord, exit = true): Promise<void> {
  try {
    const isSnapshot = activeCat.value === 'star' || !r.raw
    if (isSnapshot) {
      if (r.kind === 'file' && r.files) await api.writeContent('file', r.files)
      else if (r.kind === 'image') await api.writeContent('image', r.content)
      else await api.writeContent('text', r.content)
    } else {
      await api.write(r.id)
    }
    if (exit) api.outPlugin()
  } catch (e) {
    api.toast('复制失败：' + (e instanceof Error ? e.message : String(e)))
  }
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

async function deleteRecord(r: ClipboardRecord): Promise<void> {
  const idx = filtered.value.findIndex((x) => x.id === r.id)
  const ok = await api.remove(r.id)
  if (!ok) {
    api.toast('删除失败')
    return
  }
  if (activeCat.value === 'star') {
    favorites.value = favorites.value.filter((f) => f.id !== r.id)
    favoritesStore.save(favorites.value)
    recount()
  } else {
    records.value = records.value.filter((x) => x.id !== r.id)
    if (totalCount.value > 0) totalCount.value -= 1
    recount()
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

async function clearAll(): Promise<void> {
  const n = await api.clear()
  if (n > 0 || isDevMock()) {
    records.value = []
    page.value = 0
    hasMore.value = false
    totalCount.value = 0
    scannedCats.clear()
    recount()
    api.toast(`已清空 ${n} 条记录`)
  }
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

  // 每次打开插件都把焦点抢回搜索框（挂载时那次会被宿主的 view.focus() 抢走）
  api.onPluginEnter(() => focusSearch())
  // 退出插件时取消尚未执行的重试
  api.onPluginOut(() => cancelFocus())

  api.onChange(async (payload?: unknown) => {
    // 变化项结构未知：能归一化就 prepend，否则保守重载第一页
    const maybe = Array.isArray(payload) ? payload[0] : payload
    if (maybe && typeof maybe === 'object') {
      try {
        const res = await api.getHistory(1, 5)
        const seen = new Set(records.value.map((r) => r.id))
        const fresh = res.items.filter((r) => !seen.has(r.id))
        if (fresh.length) {
          records.value = fresh.concat(records.value)
          recount()
          return
        }
        if (res.items.length) {
          records.value = res.items
          recount()
          return
        }
      } catch { /* fallthrough */ }
    }
    void loadFirst()
  })

  void loadFirst()
}

export function useStore() {
  return {
    records, favorites, activeCat, query, selectedIndex,
    loading, hydrating, remoteSearching, hasMore, counts, filtered, listKey,
    subInputReady, searchFocusTick, focusSearch,
    imgScale, imgScaleLabel, cycleImgScale,
    init, loadFirst, loadMore, setQuery, setCat,
    copyRecord, deleteRecord, toggleStar, clearAll, moveSelection,
    revealFile, openLink, favKey
  }
}

export type Store = ReturnType<typeof useStore>

/** 供 ClipboardItem 使用的图片 src 转换（避免组件直接依赖 api 内部） */
export { toImgSrc }
export type { Category, ItemKind }
