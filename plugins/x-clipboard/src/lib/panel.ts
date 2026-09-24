/*
 * 设置面板的「行表」+ 键盘光标。
 *
 * 面板里那 10 组控件其实是**四种不同的东西** —— 单选的色点、单选的药丸、
 * 一组**各自独立的开关**（行尾那些）、一组**同一个数组设置的成员**（底栏提示 / 底栏按钮），
 * 外加真正的开关；键盘对它们的态度并不一样；所以这里把「有几行、每行几个位置、按下去改哪个设置」
 * 从模板里抽出来，变成一份能单测的表（跟 `query.ts` / `keys.ts` 一个路子）。
 *
 * ⚠️ **行表跟模板必须对得上**：模板里只写 `isCur('<行名>', <第几个位置>)`，
 * 行名只有这一个出处（`PANEL_ROWS[].id`），`tests/panel.test.ts` 会扫一遍 App.vue 来验。
 * ⚠️ 模板里**不许出现行号**：`isCur('bg', 0)` 里那个 `0` 是「这一行的第几个位置」，不是行号。
 *
 * ── 光标落在哪 ──────────────────────────────────────────────────────────
 * · 打开面板 = 落在**第一行的「当前值」**上，而且**只算位置、不落值**（见 `cursorOf`）——
 *   这是整个功能里唯一一处「做错了会静默改掉用户设置」的地方。
 * · `↑↓` 换行：落点重算成那一行的当前值（`moveRow`），**不沿用上一个列号** ——
 *   底色 6 个位置、强调色 13 个，列号搬过去没有意义；落回当前值才不会一按就跳老远。
 * · `←→` 行内移动，两端**停住不绕圈**（绕圈 = 一按就从「默认」跳到最后一颗颜色）。
 */

import { ACCENT_KEYS } from './accent.ts'
import { BG_KEYS } from './surface.ts'
import { FOOT_BUTTONS, FOOT_HINTS, FOOT_MODES, MARK_MODES, type Settings } from './settings.ts'

/**
 * 一行是哪种控件。键盘语义按它分岔，见下面 `movePatch` / `toggleAt`。
 *
 * · `single` 单选：一行里挑一个值（色点、药丸）；
 * · `multi`  多选：`values` 是**几个设置键名**，每个是一颗**独立**的开关（行尾那些）；
 * · `list`   多选：`values` 是**同一个数组设置**里的成员（底栏提示 / 底栏按钮），
 *            勾中 = 在那个数组里；「切一颗」= 数组增减一个元素；
 * · `switch` 开关。
 *
 * ⚠️ `multi` 和 `list` 的**键盘语义完全一样**（`←→` 只挪光标、`Enter` 切斯光标那一颗），
 *    分开是因为**存的地方不一样**：前者是 N 个布尔键，后者是**一个数组键**。
 *    写成一个 kind 就得在 `toggleAt` 里再按"这一行的值是不是数组"分岔 —— 那才是真的混。
 */
export type RowKind = 'single' | 'multi' | 'list' | 'switch'

export interface PanelRow {
  /** 模板靠它认行（`isCur('bg', …)`）—— **不许在模板里写行号** */
  id: string
  kind: RowKind
  /**
   * `single`：这一行的候选值，**顺序就是模板里控件的顺序**（`'auto'` = 界面上那颗「默认」）；
   * `multi`：这一行要切的几个**设置键名**（类型 / 序号各自独立，所以它不是一个值）；
   * `list`：这一行的合法成员（顺序 = 存进库里的顺序 = 模板里药丸的先后）；
   * `switch`：空着 —— 开关只有「这一行」一个位置，没有左右两个候选。
   */
  values: readonly string[]
}

/*
 * ★ 顺序 = 模板里的先后 = 面板的排布（09-17 定的「按控件类型分三段、段内短→长」）。
 *
 * ⚠️ 底色的候选值直接用 `BG_KEYS`，它**本身就含 `'auto'`**；
 *    而强调色那份 `ACCENT_KEYS` **不含** `'auto'`，得自己补上。
 *    两处不一样（`surface.ts` 和 `accent.ts` 就是这么导出的），别顺手写成一样的。
 *
 * ⚠️ `tailActs` 这一行 09-21 从**开关**变成了**多选**（收藏 / 删除拆成两个独立开关），
 *    于是它从「开关段」搬进了「药丸段」。按段内**短→长**，它当时（2 颗）排在
 *    「行尾显示」（3 颗）**前面** —— 别按"先显示后操作"的语序把它俩对调，那是往回走。
 *    09-23 加了第三颗「编辑」，这一行也是 3 颗了：**它和「行尾显示」（3）、「选中项」（3）
 *    一样长**，谁前谁后都不违背"短→长"⇒ **保持原位不动**，别为凑一个严格递增去调顺序。
 *
 * ⚠️ 09-24 加的底栏两行（按钮 3 颗 / 按键提示 15 颗）也照"段内短→长"排：
 *    「底栏」（形态 3 颗）后面接**按钮（3 颗）**再接**按键提示（15 颗）** ——
 *    反过来就是 15 → 3 的下降，会把"逐级变宽"这件事破掉。
 *    两行本身是同一摊东西（都在说底栏），挨着放也正好符合"同类放一起"。
 */
export const PANEL_ROWS: readonly PanelRow[] = [
  { id: 'bg', kind: 'single', values: BG_KEYS },
  { id: 'accent', kind: 'single', values: ['auto', ...ACCENT_KEYS] },
  // 行尾**操作**：编辑 / 收藏 / 删除三颗按钮，各自独立
  // （三颗都不开 = 鼠标没有操作入口，编辑只剩 ⌘E、收藏只剩 ⌘K、删除只剩 Delete）
  // ⚠️ 顺序 = **行尾那三颗从左到右的先后**（不是"哪个重要"）—— 面板和列表读同一句话。
  { id: 'tailActs', kind: 'multi', values: ['tailEdit', 'tailFav', 'tailDel'] },
  // 行尾**显示**：类型 / 序号 / 来源三件独立的事，各自开关，不互相顶掉
  { id: 'tail', kind: 'multi', values: ['tailType', 'tailIndex', 'tailSource'] },
  { id: 'mark', kind: 'single', values: MARK_MODES },
  // 底栏**形态**：常驻 / 淡入 / 全隐（09-24 从四档收成三档，老值 'full' / 'lean' 由
  // normalizeSettings 迁走。「显示什么」不在这里，是下面两行）
  { id: 'foot', kind: 'single', values: FOOT_MODES },
  // 底栏右边那几颗入口（设置 / 新增 / 清空）—— 一个数组设置，勾中哪几个 = 底栏画哪几个
  { id: 'footButtons', kind: 'list', values: FOOT_BUTTONS },
  // 底栏左边那排键位提示（15 条）—— 同上，一个数组设置
  { id: 'footHints', kind: 'list', values: FOOT_HINTS },
  { id: 'peek', kind: 'switch', values: [] },
  { id: 'confirmDelete', kind: 'switch', values: [] }
]

/** 光标：第几行、这一行的第几个位置 */
export interface Cursor {
  row: number
  slot: number
}

/**
 * 一行有几个「位置」。
 *
 * 开关只有 1 个 —— 「左 = 关、右 = 开」讲的是**方向**，不是两个位置：
 * 行里只有一个开关，光标停在它上面，`←→` 表达的是往哪边拨。
 */
export function slotsOf(row: PanelRow): number {
  return row.kind === 'switch' ? 1 : row.values.length
}

/** 行名 → 行号。找不到回 -1（模板里写错行名时，测试会当场红） */
export function rowIndex(id: string): number {
  return PANEL_ROWS.findIndex((r) => r.id === id)
}

/** 设置里读一项 —— 行表里的 `id` 就是设置键名，这里只做一次收窄 */
function valueOf(settings: Settings, row: PanelRow): unknown {
  return (settings as unknown as Record<string, unknown>)[row.id]
}

/**
 * 某个值落在这一行的第几个位置，认不出来就回 0。
 *
 * `multi` 行的 `values` 是**键名**、`list` 行的 `values` 是一份成员表 —— 对不上值 ⇒ 一律 0。
 * 行尾那几颗本来就是各自独立的，底栏那两行是"集合里的成员"，都没有"哪一个值"可言
 * （这也是它们 `←→` 不落值的原因）。
 */
function slotOfValue(row: PanelRow, value: unknown): number {
  if (row.kind !== 'single') return 0
  const i = row.values.indexOf(String(value))
  return i < 0 ? 0 : i
}

/**
 * 打开面板时光标落在哪。
 *
 * ⚠️ **它只算位置，返回的不是 patch** —— 这是有意设计的：如果打开面板时"选中第一个"，
 * 那一按 ⌘/ 就会把底色 / 强调色刷成「默认」、把用户原来的选择悄悄冲掉，而他什么都没按。
 * ⇒ 落点是**第一行的"当前值"**，调用方只挪光标、不落值。（`tests/panel.test.ts` 锁着这条。）
 */
export function cursorOf(settings: Settings): Cursor {
  const row = PANEL_ROWS[0]
  return { row: 0, slot: slotOfValue(row, valueOf(settings, row)) }
}

/** `↑↓` 换行。行与行到首尾也不绕圈：第一行再往上、最后一行再往下都停在原地 */
export function moveRow(cur: Cursor, delta: -1 | 1, settings: Settings): Cursor {
  const row = Math.min(PANEL_ROWS.length - 1, Math.max(0, cur.row + delta))
  const r = PANEL_ROWS[row]
  return { row, slot: slotOfValue(r, valueOf(settings, r)) }
}

/** `←→` 行内移动。到两端停住（不绕圈 —— 绕圈会一按从「默认」跳到最后一颗颜色） */
export function moveSlot(cur: Cursor, delta: -1 | 1): Cursor {
  const slot = Math.min(slotsOf(PANEL_ROWS[cur.row]) - 1, Math.max(0, cur.slot + delta))
  return { row: cur.row, slot }
}

/**
 * `←→` 该落什么值。
 *
 * - `single`：移到哪一颗就是选中哪一颗 —— 单选组本来就是"光标即选中"的语义
 *   （这也是"改个颜色只按一下"的来由）。到边了没挪动就回 `null`：既不该白写一次库，
 *   也免得在边界上反复按把同一份设置存来存去。
 * - `switch`：**左 = 关、右 = 开**。开关只有两个状态，"往左拨"自然就是关。
 * - `multi` / `list`：**回 `null`** —— 这两种行里每颗都是独立的一格（行尾操作：收藏 / 删除；
 *   行尾显示：类型 / 序号 / 来源；底栏提示 / 底栏按钮：各自一个成员），
 *   "移到哪一颗就点亮哪一颗"会在从一颗滑到下一颗时把下一颗一起点亮。所以它们 `←→` 只挪光标，
 *   `Enter` 才切。
 */
export function movePatch(cur: Cursor, delta: -1 | 1): Partial<Settings> | null {
  const row = PANEL_ROWS[cur.row]
  if (!row) return null
  if (row.kind === 'multi' || row.kind === 'list') return null
  if (row.kind === 'switch') return { [row.id]: delta > 0 } as unknown as Partial<Settings>

  const next = moveSlot(cur, delta)
  if (next.slot === cur.slot) return null
  return { [row.id]: row.values[next.slot] } as unknown as Partial<Settings>
}

/**
 * 在「一个数组设置」（`list` 行）里切一个成员：**在就删掉，不在就补上，
 * 顺序永远按定义数组来**。
 *
 * ★ 导出去给 `App.vue` 的**鼠标点击**用 —— 面板里 `Enter`（键盘）和点药丸（鼠标）
 *   必须落到同一句话上。各写一遍迟早分家：一个按定义顺序排、一个按点击先后追加，
 *   存进库里的数组就不一样了，而 `footHints` 的顺序又直接决定底栏里那排提示的先后。
 * ★ `order.filter(...)` 顺带做了两件事：**去重**（同一个成员只会出现一次）和
 *   **丢掉不认识的**（不在 `order` 里的一律留不下来）—— 跟 `normalizeSettings` 同一套规矩。
 */
export function toggleMember<T extends string>(
  list: readonly T[],
  member: T,
  order: readonly T[]
): T[] {
  const has = list.includes(member)
  return order.filter((v) => (v === member ? !has : list.includes(v)))
}

/**
 * `Enter` 该落什么值：落值 / 切换。
 *
 * `single` 行按 `Enter` 和按 `←→` 是一回事（都落在光标那一颗上）—— 留着它是为了让
 * "方向键挪、Enter 确认"这套习惯也能用，不需要记得"这一行 Enter 不生效"。
 */
export function toggleAt(settings: Settings, cur: Cursor): Partial<Settings> | null {
  const row = PANEL_ROWS[cur.row]
  if (!row) return null

  if (row.kind === 'switch') {
    return { [row.id]: !(valueOf(settings, row) === true) } as unknown as Partial<Settings>
  }

  if (row.kind === 'multi') {
    const key = row.values[cur.slot]
    if (!key) return null
    const on = (settings as unknown as Record<string, unknown>)[key] === true
    return { [key]: !on } as unknown as Partial<Settings>
  }

  if (row.kind === 'list') {
    const member = row.values[cur.slot]
    if (!member) return null
    const value = valueOf(settings, row)
    return {
      [row.id]: toggleMember(Array.isArray(value) ? (value as string[]) : [], member, row.values)
    } as unknown as Partial<Settings>
  }

  const value = row.values[cur.slot]
  return value === undefined ? null : ({ [row.id]: value } as unknown as Partial<Settings>)
}
