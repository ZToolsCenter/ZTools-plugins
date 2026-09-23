/*
 * 宿主接口的薄封装。
 *
 * 本文件是 `window.ztools` 的唯一入口 —— 其余模块只认这里导出的 `zt()` 与类型。
 * 接口语义（返回形状、参数含义）都以宿主实际行为为准，不依赖任何第三方插件源码。
 */

export type ClipType = 'text' | 'image' | 'file'

export interface ClipFile {
  name: string
  path: string
  isDirectory?: boolean
  exists?: boolean
}

/** 一条剪贴板内容的「干货」—— 历史记录和收藏都只用这几个字段 */
export interface ClipContent {
  type: ClipType
  content?: string
  preview?: string
  imagePath?: string
  /** 图片尺寸，宿主给的形如 `1280 * 720` */
  resolution?: string
  files?: ClipFile[]
  /** 宿主给的 md5，用来判重 */
  hash?: string
  /*
   * 来源应用 —— **复制那一刻**的前台窗口，不是"现在是谁在前台"。
   *
   * 宿主 `saveItem` 时就把这两个字段一起写进文档了，`getAllItems()` 又是整条展开
   * ⇒ **不需要任何新采集**：本插件当初删「来源」时只是没把它声明出来。
   * ⚠️ `appName` 带 `.app` 后缀（"Visual Studio Code.app"），显示前要剥（见 `source.ts`）。
   */
  appName?: string
  bundleId?: string
}

/** 宿主剪贴板历史里的一条记录 */
export interface ClipItem extends ClipContent {
  id: string
  timestamp: number
}

/* ------------------------------------------------------------------ *
 * 宿主 API 声明
 * 只声明本插件用到的部分。走 unknown 转换，不去扩充
 * @ztools-center/ztools-api-types 已经声明的 Window 类型，免得两边形状打架。
 * ------------------------------------------------------------------ */

interface HostClipboard {
  getHistory(
    page?: number,
    pageSize?: number,
    filter?: string
  ): Promise<{ items?: ClipItem[]; total?: number } | undefined>
  search(keyword: string): Promise<ClipItem[] | { items?: ClipItem[] } | undefined>
  /*
   * ↑ 宿主的 `search` 声明在这儿，但**本插件不调它** —— 它内部就是
   * `getHistory(1, 1e3, keyword)`，同样要先「读全库 + 全量排序」。
   * 我们改成取一次全量后在前端过滤（见下面的 `matchClip`），
   * 留着这条只是为了把宿主的接口面记全。
   */
  delete(id: string): Promise<{ success?: boolean } | undefined>
  clear(type?: ClipType): Promise<{ success?: boolean; count?: number } | undefined>
  /** 写回剪贴板；shouldPaste 为真时宿主会自己关窗、切回上一个应用并模拟粘贴 */
  write(id: string, shouldPaste?: boolean): Promise<{ success?: boolean } | undefined>
  writeContent(
    data: { type: ClipType; content: string | string[] },
    shouldPaste?: boolean
  ): Promise<{ success?: boolean } | undefined>
  onChange(callback: (item: ClipItem) => void): void
}

interface HostDb {
  promises: {
    get(id: string): Promise<unknown>
    put(doc: Record<string, unknown>): Promise<unknown>
    remove(id: string): Promise<unknown>
  }
}

interface HostApi {
  clipboard: HostClipboard
  db: HostDb
  /** 以下三个是同步接口，只写系统剪贴板，不会关窗 —— 「复制但不关窗」靠它们 */
  copyText(text: string): boolean
  copyImage(image: string): boolean
  copyFile(filePath: string | string[]): boolean
  setSubInput(
    onChange: (details: { text?: string; value?: string } | string) => void,
    placeholder?: string,
    isFocus?: boolean
  ): Promise<unknown>
  setSubInputValue(text: string): Promise<unknown>
  subInputFocus(): void
  /**
   * `subInputFocus` 的反向操作：**把焦点从搜索框搬进插件视图**。
   *
   * 它做的事只有一件：宿主收到后把键盘焦点交给当前插件的视图
   * （宿主对它的说明就是「子输入框失去焦点，插件应用获得焦点」）。
   * 这是宿主发起的同步 IPC，sender 就是插件自己的视图，所以不用我们传任何参数。
   *
   * 为什么非要有这玩意儿：宿主那个搜索框只要拿着焦点，渲染层**只把
   * `←→↑↓EnterTab` 六个键投给插件**（`SearchBox` 上就挂了那六个 `withKeys`），
   * 其余组合键在渲染层就被丢掉了 —— 这就是「用键盘收藏（⌘K）没反应」的真因。
   * 把焦点让给插件之后，按键直接进插件页，⌘K / ⌘C / ⌘L / Delete 全部生效。
   *
   * ⚠️ 它是 `sendSync`（同步阻塞 IPC），别在会连发的地方调。
   */
  subInputBlur(): void
  /** 宿主当前主题：{ isDark, primaryColor, customColor, windowMaterial } */
  getThemeInfo?(): { isDark?: boolean; primaryColor?: string; customColor?: string }
  /** 主题变更（系统深浅色 / 用户在设置里换主题色）时会回调 */
  onThemeChange?(callback: (info: unknown) => void): void
  /**
   * 平台检测。宿主 preload 直接给的同步方法，比看 navigator 准。
   * **只留 `isMacOs`** —— 它决定键盘提示里的修饰键写 ⌘ 还是 Ctrl。
   * （宿主还给了 `isWindows` / `isLinux` / `internal.getPlatform()`，本插件用不到；
   *   按本文件「只声明用到的部分」的原则，不声明。）
   */
  isMacOs?(): boolean
  onPluginEnter(callback: (action?: { code?: string }) => void): void
  onPluginOut(callback: () => void): void
}

export function zt(): HostApi {
  return (window as unknown as { ztools: HostApi }).ztools
}

/* ------------------------------------------------------------------ *
 * 写插件自己的文档（宿主 db）
 * ------------------------------------------------------------------ */

export interface DocWriteResult {
  ok: boolean
  message?: string
}

export type DocBuilder = (current: Record<string, unknown> | null) => Record<string, unknown>

/** 同一个 id 的写入串成一条链，见 upsertDoc 的说明 */
const writeChains = new Map<string, Promise<unknown>>()

/**
 * 写一份插件自己的文档，**自动带上库里那份的 `_rev`**。
 *
 * ⚠️ 这里的「先读再写」不是代码风格，是宿主底层的硬要求。`db.put` 的规则是：
 * **这个 id 已经有文档、而传进去的 `_rev` 跟库里那份对不上，它会直接拒绝这次写入**
 * —— 返回一个 `{ ok: false, name: 'conflict' }`，**不抛异常**；
 * 只有 `_rev` 跟库里一致、或者库里本来就没有这份文档，才真的写得进去。
 *
 * ⇒ 传一份**不带 `_rev`** 的文档去覆盖已有的，**只有第一次会成功**（那一刻库里还没有 rev）；
 * 之后每一次都 conflict。更坑的是它**不抛异常**：失败是**静默**的，
 * 调用方以为写成功了，重启一看还是旧值。
 * （09-15 老大报的「改了强调色和选中项、重启就没了」就是踩在这里。）
 *
 * `build` 拿到的是库里现有文档（可能是 `null`），返回要写进去的内容（不用管 `_id` / `_rev`）。
 * 同一个 `id` 的写入会**串行**：连点两个设置项时两次写会同读一个 `_rev`，后一次照样冲突。
 */
export function upsertDoc(id: string, build: DocBuilder): Promise<DocWriteResult> {
  const run = (writeChains.get(id) ?? Promise.resolve())
    .then(() => writeDocOnce(id, build))
    .catch((err) => {
      console.error('[x-clipboard] 写库异常', id, err)
      return { ok: false, message: String(err) } satisfies DocWriteResult
    })
  // 这一环失败也不能断链：catch 已经把异常吃掉，后面的写入照样排队执行
  writeChains.set(id, run)
  return run
}

async function writeDocOnce(id: string, build: DocBuilder): Promise<DocWriteResult> {
  const db = zt().db.promises
  const current = ((await db.get(id)) ?? null) as Record<string, unknown> | null
  const doc: Record<string, unknown> = { ...build(current), _id: id }
  if (current && typeof current._rev === 'string') doc._rev = current._rev

  const res = (await db.put(doc)) as { ok?: boolean; message?: string } | undefined
  if (res && res.ok === false) {
    console.error('[x-clipboard] 写库被宿主的 rev 校验挡下', id, res.message)
    return { ok: false, message: res.message }
  }
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * 取数
 * ------------------------------------------------------------------ */

/**
 * 一次取够，不做分页。
 *
 * ⚠️ 这个数**同时是「整库」的意思**：宿主的库上限是 `maxItems = 1000`（超了自己删旧的），
 * 所以传 1000 = 把整个库要过来。前端的分类过滤和关键词过滤（`matchClip`）都建立在
 * 「手里这份就是整库」之上 —— **改小它会让过滤静默地少结果，别动。**
 */
export const PAGE_SIZE = 1000

function pickItems(res: unknown): ClipItem[] {
  if (Array.isArray(res)) return res as ClipItem[]
  const items = (res as { items?: ClipItem[] } | null | undefined)?.items
  return Array.isArray(items) ? items : []
}

/**
 * 取一次全量。**不带任何参数** —— 分类和关键词都在前端过滤（见 `matchClip`）。
 *
 * 宿主那两个接口返回形状不同（`search` 给数组、`getHistory` 给 `{items}`），
 * `pickItems` 统一成数组。
 */
export async function fetchHistory(): Promise<ClipItem[]> {
  try {
    return pickItems(await zt().clipboard.getHistory(1, PAGE_SIZE))
  } catch (err) {
    console.error('[x-clipboard] 读取剪贴板历史失败', err)
    return []
  }
}

/**
 * 这条记录吃不吃这个关键词。
 *
 * ★ 规则是**照着宿主复刻**的：宿主 `getHistory` 的 filter 依次试
 *   `content` → `files[].name` → `preview`，全部小写包含，任一命中就留下。
 *
 * 为什么要复刻而不是调宿主的 `search`：`search(keyword)` 内部就是
 * `getHistory(1, 1e3, keyword)`，而 `getHistory` **不管传什么 pageSize 都要先
 * 「读全库 → 全量排序」**（宿主的固定流程，插件改不了）。所以交给宿主搜，
 * 就等于**每敲一个字符跑一趟全量往返**。
 *
 * 而我们本来就一次把整库拉进内存（`PAGE_SIZE` = 宿主上限），
 * **本地过滤和宿主过滤面对的是同一个集合** —— 结果严格一致，但一次往返都不用花。
 *
 * ⚠️ 上面那句"同一个集合"靠两个数撑着：宿主 `maxItems = 1000`、我们 `PAGE_SIZE = 1000`。
 *    **谁把 `PAGE_SIZE` 改小，搜索就会静默地少结果（不报错，就是搜不出来）。**
 * ⚠️ 要改这里的匹配规则，先回去读宿主 `getHistory` 的 filter —— 两边必须一致。
 */
export function matchClip(item: ClipContent, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  const l = lowerOf(item)
  if (l.content?.includes(kw)) return true
  if (item.files) return l.names ? l.names.some((n) => n.includes(kw)) : false
  return Boolean(l.preview?.includes(kw))
}

/**
 * 小写化结果的缓存 —— 纯粹为了**别重复分配**，匹配规则一个字没变。
 *
 * 改关键词是"每敲一个字符过滤一遍全部记录"，而 `toLowerCase()` 会**新分配一个等长的字符串**：
 * 一份几 MB 的正文，敲一个字就多出几 MB 的临时分配（剪贴板里真会躺这种东西）。
 * 所以按**对象**缓存第一次算好的小写串。
 *
 * 安全性来自 `App.vue` 早就定下的那条规矩：`items` 永远**整体替换**、从不原地改某一条的字段
 * （见那边 `items` 声明处的注释）。对象不换 → 字段就不变 → 缓存永远是对的。
 * 用 WeakMap 是为了不额外占地：这一批记录被换掉之后，旧的那些连同缓存一起可以被回收。
 * 代价只是"搜过的那些记录会多留一份小写副本"，量级跟原文一样 —— 换来的是每次敲键零分配。
 */
const lowerCache = new WeakMap<
  ClipContent,
  { content?: string; names?: string[]; preview?: string }
>()

function lowerOf(item: ClipContent): { content?: string; names?: string[]; preview?: string } {
  let hit = lowerCache.get(item)
  if (!hit) {
    hit = {
      content: item.content?.toLowerCase(),
      // `files` 存在就走它、不再看 `preview` —— 宿主那个 filter 的怪癖，这里也照旧
      names: item.files?.map((f) => f.name.toLowerCase()),
      preview: item.preview?.toLowerCase()
    }
    lowerCache.set(item, hit)
  }
  return hit
}

export async function deleteItem(id: string): Promise<boolean> {
  try {
    const res = await zt().clipboard.delete(id)
    return res?.success !== false
  } catch (err) {
    console.error('[x-clipboard] 删除失败', err)
    return false
  }
}

/** 清空历史。宿主自己会保留收藏 —— 收藏本来就不在宿主那本账上。 */
export async function clearHistory(type?: ClipType): Promise<number> {
  try {
    const res = await zt().clipboard.clear(type)
    return res?.count ?? 0
  } catch (err) {
    console.error('[x-clipboard] 清空历史失败', err)
    return 0
  }
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/**
 * 本地原生路径 → 能喂给 `<img>` 的 `file://` URL。**空串进、空串出。**
 *
 * ⚠️ **不能无脑 `'file://' + path`**（09-19 Windows 真机踩的）：宿主给的
 *    `imagePath` 是**原生绝对路径**，Windows 上长这样 `C:\Users\…\a.png`，
 *    拼出来是 `file://C:%5CUsers%5C…` —— `\` 被 `encodeURI` 编成 `%5C`，
 *    整串没有斜杠，于是全部落进 URL 的 **host** 位置，`new URL()` 直接抛
 *    `Invalid URL` ⇒ `<img>` 触发 `@error` ⇒ **缩略图全线退成占位图标**。
 *    macOS 是 `/Users/…`，`file://` 后头正好接一个 `/`，凑成 `file:///…`
 *    才是合法的 —— 所以这个 bug 在 mac 上一直看不见。
 *
 * 三种路径各自该拼成什么：
 *   POSIX   `/Users/x/.ztools/…/a.png`  → `file:///Users/x/.ztools/…/a.png`
 *   Windows `C:\Users\x\…\a.png`        → `file:///C:/Users/x/…/a.png`（盘符前补一个 `/`）
 *   UNC     `\\server\share\a.png`      → `file://server/share/a.png`（server 是 host，只留两个 `/`）
 */
export function fileUrl(p: string): string {
  if (!p) return ''
  if (/^(file|data|blob|https?):/i.test(p)) return p
  // 反斜杠先换成正斜杠：`encodeURI` 会把 `\` 编成 `%5C`，路径就此报废
  const flat = p.replace(/\\/g, '/')
  // `encodeURI` 对路径基本够用（`:` `/` 都留着），但它按"整条 URL"设计，
  // **不编 `#` 和 `?`** —— 那俩在 URL 里有别的含义，会把路径从中间截断，单独补上。
  const enc = (s: string) => encodeURI(s).replace(/#/g, '%23').replace(/\?/g, '%3F')
  // `C:/…` 这种盘符开头：必须凑成 `file:///C:/…`（三个斜杠），少一个就成 host 了
  if (/^[a-zA-Z]:\//.test(flat)) return 'file:///' + enc(flat)
  // `//server/share`：server 要当 host，所以只能 `file:` + 两个斜杠
  if (flat.startsWith('//')) return 'file:' + enc(flat)
  return 'file://' + enc(flat)
}

/**
 * 一条**图片内容记录**的缩略图 URL（宿主把它存成 `imagePath`）。
 *
 * 判「文件行要不要也显示缩略图」在 `fileThumbSrc` —— 那边拼路径用的就是这个 `fileUrl`，
 * 所以两处的平台差异只有一份实现。
 */
export function imageSrc(item: ClipContent): string {
  return fileUrl(item.imagePath || item.content || '')
}

/*
 * ------------------------------------------------------------------ *
 * 「这是个图片文件吗」—— 纯看扩展名
 * ------------------------------------------------------------------ *
 *
 * ⚠️ **这跟宿主的类型判定是两回事，别混。**
 *
 * 宿主判 `type` 看的是**剪贴板上放的是什么东西**，不看文件名：先问"有没有文件列表"
 * （mac `clipboard.has("NSFilenamesPboardType")` / win `CF_HDROP`），有就一律 `file`，
 * 再问图片、最后才轮到文本。所以复制一个 `a.png` **文件**得到的永远是 `type: "file"`，
 * 扩展名根本不参与 —— 插件改不了，也不该假装能改（记录里写的还是文件）。
 *
 * 这里做的是**纯显示层**的让步：文件行本来只有一个通用文件图标，看不出是不是张图。
 * 既然记录里带着完整路径，那就顺手把它当图片显示出来，跟图片行长得一样。
 * **只影响长相**：类型标签还是「文件」，按 Tab 到「图像」也照样看不到它。
 */

/**
 * 认作图片的扩展名。
 *
 * 只收 **Chromium 真渲染得出来** 的那几种 —— 认了却渲染不出来，只会白跑一次
 * `@error` 再退回文件图标（`.tif` / `.heic` 就是这种：看着像图片，Chromium 打不开）。
 * `svg` 是**故意不收**的：它多半是图标 / 线条图，缩进 32×24 的框里什么都看不出来，
 * 不如留个文件图标。想收就加在这儿，别改判定顺序。
 */
const IMAGE_FILE = /\.(?:png|jpe?g|jfif|webp|gif|bmp|avif|ico)$/i

export function isImageFileName(name: string): boolean {
  return IMAGE_FILE.test(name)
}

/**
 * 文件行要显示的缩略图 URL —— 不是图片文件就返回空串（那一格还是文件图标）。
 *
 * 只认**恰好一个、且不是目录**的文件：
 * 多选了 5 个文件却显示其中一张的缩略图，会让人以为"这条内容就是那张图"，
 * 而它其实是 5 个文件。多选就老老实实显示文件图标 + 数量。
 *
 * 读不出来（文件被删 / 挪走 / 是个坏文件）不用在这里管 —— `<img>` 自己会 `@error`，
 * 由调用方退回文件图标（见 App.vue 的 `markBroken`）。
 */
export function fileThumbSrc(item: ClipContent): string {
  if (item.type !== 'file') return ''
  const files = item.files
  if (!files || files.length !== 1) return ''
  const f = files[0]
  if (f.isDirectory || !isImageFileName(f.name)) return ''
  return fileUrl(f.path)
}

/**
 * 折叠空白时最多看这么多字符。
 *
 * 列表里一行只显示约 40 个字，没必要为了它把整篇正文跑一遍 `\s+` 正则。
 * 400 是个宽裕的上限：除非一条内容的**前 400 个字符全是空白**（正常剪贴板不会），
 * 折叠结果和扫全串完全一样。
 *
 * ⚠️ `highlight.ts` 也用它 —— 命中落在这 400 字之外时，那边要回到全文去取片段。
 *    改这个数会让"行里显示多长"和"前移的窗口多大"一起变，别只改一边。
 */
export const PREVIEW_SCAN = 400

export function previewText(item: ClipContent): string {
  if (item.type === 'text') {
    return (item.content ?? '').slice(0, PREVIEW_SCAN).replace(/\s+/g, ' ').trim()
  }
  if (item.type === 'image') {
    // 宿主把图片存成 `<时间戳>-<随机串>.png`，文件名是纯噪声，显示尺寸才有信息量
    if (item.resolution) return item.resolution.replace(/\s*\*\s*/, ' × ')
    return item.preview || '图片'
  }
  const files = item.files ?? []
  if (!files.length) return item.preview || '文件'
  const head = files[0].name
  return files.length > 1 ? `${head}（共 ${files.length} 个文件）` : head
}
