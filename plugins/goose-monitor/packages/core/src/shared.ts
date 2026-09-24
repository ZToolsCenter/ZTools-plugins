/* 共享纯逻辑：分类定义、格式化、颜色/字形生成、Helper 角色推断。
   这些函数不触碰平台 API，uTools 与浏览器开发 mock 共用。 */
import type { Category, AppRow, GuiSnapshot } from "./types";

export const QUERY_PREF_KEY = "pk_query";
export const CATEGORY_PREF_KEY = "pk_category";
export const SELECTION_PREF_KEY = "pk_selected_process";
export const SORT_KEY_PREF_KEY = "pk_sort_key";
export const SORT_DIR_PREF_KEY = "pk_sort_dir";
/** 网络分类单独记，避免与通用排序互相覆盖。 */
export const NET_SORT_KEY_PREF_KEY = "pk_net_sort_key";
export const NET_SORT_DIR_PREF_KEY = "pk_net_sort_dir";

export const ALL_CATEGORIES: Category[] = [
  { id: "all", label: "全部", icon: "list", key: "1" },
  { id: "gui", label: "界面", icon: "monitor", key: "2" },
  { id: "cpu", label: "CPU", icon: "cpu", key: "3" },
  { id: "mem", label: "内存", icon: "memory-stick", key: "4" },
  { id: "net", label: "网络", icon: "wifi", key: "5" },
  { id: "bg", label: "后台", icon: "server", key: "6" },
];

export function visibleCategories(guiSupported: boolean, networkSupported: boolean): Category[] {
  return ALL_CATEGORIES
    .filter((category) => category.id !== "gui" || guiSupported)
    .filter((category) => category.id !== "net" || networkSupported)
    .map((category, index) => ({ ...category, key: String(index + 1) }));
}

/** 采集失败返回 null，调用方不得将 unknown 当成“没有窗口”。 */
export function rowsForGuiSnapshot(rows: AppRow[], snapshot: GuiSnapshot): AppRow[] | null {
  if (snapshot.status !== "supported") return null;
  const pids = new Set(snapshot.pids);
  return rows.filter((row) => (row.allPids || [row.pid]).some((pid) => pids.has(pid)));
}

/** 静态全量仅供类型/恢复校验；界面实际渲染必须使用 visibleCategories。 */
export const CATEGORIES = ALL_CATEGORIES;

export function restoreCategory(value: string | null, visible = CATEGORIES): Category["id"] {
  return visible.some((category) => category.id === value) ? value as Category["id"] : "all";
}

export function restoreQuery(value: string | null): string {
  return (value ?? "").slice(0, 200);
}

/** Tab / Shift+Tab 在可见分类间循环。 */
export function cycleCategoryIndex(current: number, direction: 1 | -1, length: number): number {
  if (length <= 0) return 0;
  if (current < 0 || current >= length) return direction > 0 ? 0 : length - 1;
  return (current + direction + length) % length;
}

export type ProcessSortKey = "mem" | "cpu" | "procs" | "name" | "network" | "download" | "upload";
export type ProcessSortDir = "asc" | "desc";

const GENERAL_SORT_KEYS: readonly ProcessSortKey[] = ["mem", "cpu", "procs", "name"];
const NET_SORT_KEYS: readonly ProcessSortKey[] = ["network", "download", "upload", "cpu", "mem", "name"];

export function sortKeysForCategory(cat: Category["id"]): readonly ProcessSortKey[] {
  return cat === "net" ? NET_SORT_KEYS : GENERAL_SORT_KEYS;
}

/** 按当前分类校验并恢复排序；非法值回落到该分类默认。 */
export function restoreSort(
  keyRaw: string | null,
  dirRaw: string | null,
  cat: Category["id"],
): { key: ProcessSortKey; dir: ProcessSortDir } {
  const allowed = sortKeysForCategory(cat);
  const key = allowed.includes(keyRaw as ProcessSortKey)
    ? keyRaw as ProcessSortKey
    : (cat === "net" ? "network" : cat === "cpu" ? "cpu" : "mem");
  const dir: ProcessSortDir = dirRaw === "asc" || dirRaw === "desc"
    ? dirRaw
    : (key === "name" ? "asc" : "desc");
  return { key, dir };
}

/** 默认无选中；第一次向下/向上分别进入首项/末项。 */
export function moveSelection(current: number, direction: -1 | 1, length: number): number {
  if (length <= 0) return -1;
  if (current < 0) return direction > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + direction));
}

/** 选择身份绑定进程组与其安全快照；结束操作仍用当前行的 snapshotToken 校验。 */
export function processSelectionKey(row: Pick<AppRow, "id" | "snapshotToken">): string {
  return `${row.id}\u0000${row.snapshotToken}`;
}

/** 从选择键取出应用 id（snapshot 段可含任意内容）。 */
export function selectionKeyAppId(selectedKey: string): string {
  const sep = selectedKey.indexOf("\u0000");
  return sep >= 0 ? selectedKey.slice(0, sep) : selectedKey;
}

/**
 * 协调当前选择：
 * 1) 完整键仍在 → 保持；
 * 2) 同 id 仅 snapshot 轮转 → 粘到新键（避免 CPU 排序时选中跳行）；
 * 3) 组消失 → 按原索引附近回退。
 */
export function reconcileSelectionKey(selectedKey: string | null, rows: AppRow[], fallbackIndex = 0): string | null {
  if (rows.length === 0) return null;
  if (selectedKey && rows.some((row) => processSelectionKey(row) === selectedKey)) return selectedKey;
  if (selectedKey) {
    const id = selectionKeyAppId(selectedKey);
    const byId = rows.find((row) => row.id === id);
    if (byId) return processSelectionKey(byId);
  }
  const index = Math.max(0, Math.min(rows.length - 1, fallbackIndex));
  return processSelectionKey(rows[index]);
}

export type EnterTarget = "list" | "search" | "interactive";
/** Enter 在列表或开发搜索框触发直接结束；交互控件不误触。 */
export function shouldTriggerKill(key: string, target: EnterTarget): boolean {
  return key === "Enter" && (target === "list" || target === "search");
}

export interface CenterScrollInput {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  rowTop: number;
  rowHeight: number;
  direction: -1 | 1;
}

/** 只有选中行中心越过可视中线才跟随，目标值按内容边界 clamp。 */
export function centeredSelectionScroll(input: CenterScrollInput): number {
  const { scrollTop, clientHeight, scrollHeight, rowTop, rowHeight, direction } = input;
  const rowCenter = rowTop + rowHeight / 2;
  const viewportCenter = scrollTop + clientHeight / 2;
  const crossed = direction > 0 ? rowCenter > viewportCenter : rowCenter < viewportCenter;
  if (!crossed) return scrollTop;
  return Math.max(0, Math.min(Math.max(0, scrollHeight - clientHeight), rowCenter - clientHeight / 2));
}

/** 全局列表快捷键必须避让原生交互元素。 */
export function isInteractiveKeyboardTag(tagName: string, contentEditable = false): boolean {
  if (contentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(tagName.toUpperCase());
}

export type SearchInputKeyAction = "native" | "clear" | "navigate";

/** 搜索框仅把 Esc 与上下键交给列表，其余输入和光标键保持原生。 */
export function searchInputKeyAction(key: string): SearchInputKeyAction {
  if (key === "Escape") return "clear";
  if (key === "ArrowDown" || key === "ArrowUp") return "navigate";
  return "native";
}

export function sortProcessRows(
  rows: AppRow[],
  key: Exclude<ProcessSortKey, "network" | "download" | "upload">,
  direction: ProcessSortDir,
): AppRow[] {
  return [...rows].sort((a, b) => {
    const compared = key === "name"
      ? a.name.localeCompare(b.name)
      : ((a[key] as number) || 0) - ((b[key] as number) || 0);
    return direction === "asc" ? compared : -compared;
  });
}

/** 运行平台，用于显示当前系统对应的修饰键。 */
export type Platform = "mac" | "win" | "linux";

export const platform: Platform = (() => {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mac|iPhone|iPad/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "win";
  return "linux";
})();

/** 主修饰键字形：mac 用 ⌘，Windows/Linux 用 Ctrl（各自键盘上的实际按键）。 */
export const modKeyLabel: string = platform === "mac" ? "⌘" : "Ctrl";

/** 判断键盘事件是否按下了本平台的主修饰键。 */
export const isModKey = (e: KeyboardEvent | MouseEvent): boolean =>
  platform === "mac" ? e.metaKey : e.ctrlKey;

/** 内存格式化：<1024MB 显示 MB，否则 GB（两位小数）。 */
export const fmtMem = (mb: number): string =>
  mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : Math.round(mb) + " MB";

/** CPU 一位小数 + %。 */
export const fmtCpu = (n: number): string => n.toFixed(1) + "%";

export function formatListenPorts(ports: number[] | undefined): string {
  if (!ports || !ports.length) return "";
  return ports.join(" ");
}

/** `8101` / `:8101` → 端口数字；非法或超范围返回 null。 */
export function parsePortQuery(query: string): number | null {
  const match = query.trim().match(/^:?(\d+)$/);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/** 名称 + 路径 + PID + 端口 + 命令行 + helpers，供普通模糊搜索。 */
export function searchHaystack(row: AppRow): string {
  const helpers = (row.helpers || []).map((hp) =>
    [hp.name, hp.role, hp.pid, formatListenPorts(hp.ports)].join(" ")
  ).join(" ");
  return [
    row.name,
    row.path,
    row.pid,
    formatListenPorts(row.ports),
    row.commandLine || "",
    helpers,
  ].join(" ");
}

function commandLineHasServerPort(commandLine: string | undefined, port: number): boolean {
  if (!commandLine) return false;
  const re = /(?:--server\.port=|-Dserver\.port=)(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(commandLine))) {
    if (Number(match[1]) === port) return true;
  }
  return false;
}

/** 空 query 全通过；端口查询精确命中 ports / helper.ports / 命令行声明端口；否则模糊搜索 haystack。 */
export function rowMatchesQuery(row: AppRow, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const port = parsePortQuery(q);
  if (port != null) {
    if ((row.ports || []).includes(port)) return true;
    if ((row.helpers || []).some((hp) => (hp.ports || []).includes(port))) return true;
    return commandLineHasServerPort(row.commandLine, port);
  }
  return fuzzyMatch(searchHaystack(row), q);
}

export const fmtRate = (bytesPerSecond: number): string => {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return "—";
  if (bytesPerSecond < 1024) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(bytesPerSecond < 10 * 1024 ? 1 : 0)} KB/s`;
  return `${(bytesPerSecond / 1024 / 1024).toFixed(bytesPerSecond < 10 * 1024 * 1024 ? 1 : 0)} MB/s`;
};

export const sumCpu = (list: AppRow[]): number =>
  list.reduce((a, x) => a + x.cpu, 0);
export const sumMem = (list: AppRow[]): number =>
  list.reduce((a, x) => a + x.mem, 0);

/** 搜索归一化：大小写不敏感，并忽略常见分隔符。 */
export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[\s._\-/:：\\]+/g, "");
}

function isAsciiWordQuery(text: string): boolean {
  return /^[a-z0-9]+$/.test(normalizeSearchText(text));
}

function fuzzyPartScore(text: string, query: string): number {
  const hay = normalizeSearchText(text);
  const needle = normalizeSearchText(query);
  if (!needle) return 0;
  if (!hay) return Number.POSITIVE_INFINITY;
  if (hay === needle) return 0;
  const index = hay.indexOf(needle);
  if (index === 0) return 4 + (hay.length - needle.length) * 0.01;
  if (index > 0) return 20 + index + (hay.length - needle.length) * 0.01;
  if (isAsciiWordQuery(query)) return Number.POSITIVE_INFINITY;

  let pos = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < needle.length; i++) {
    pos = hay.indexOf(needle[i], pos);
    if (pos < 0) return Number.POSITIVE_INFINITY;
    if (first < 0) first = pos;
    last = pos;
    pos += 1;
  }
  return 80 + first + (last - first);
}

/** 模糊匹配：拉丁字母/数字必须连续命中；中文等非拉丁查询保留按字符顺序命中（如 企微 -> 企业微信）。 */
export function fuzzyIncludes(text: string, query: string): boolean {
  return Number.isFinite(fuzzyPartScore(text, query));
}

/** 搜索相关性分数，越小越匹配；不命中返回 Infinity。 */
export function fuzzyMatchScore(text: string, query: string): number {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 0;
  let score = 0;
  for (const part of parts) {
    const partScore = fuzzyPartScore(text, part);
    if (!Number.isFinite(partScore)) return Number.POSITIVE_INFINITY;
    score += partScore;
  }
  return score;
}

/** 搜索支持空格分词；每个词都要在同一段文本里模糊命中。 */
export function fuzzyMatch(text: string, query: string): boolean {
  return Number.isFinite(fuzzyMatchScore(text, query));
}

/** 返回原始 text 中应高亮的字符位置；优先连续子串，否则退化为非连续字符高亮。 */
export function fuzzyMatchRanges(text: string, query: string): [number, number][] {
  const parts = query.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  const ranges: [number, number][] = [];
  const lower = text.toLowerCase();

  for (const part of parts) {
    const needle = normalizeSearchText(part);
    if (!needle) continue;
    let from = 0;
    let matched = false;
    const rawNeedle = part.toLowerCase();
    let index = lower.indexOf(rawNeedle, from);
    while (index >= 0) {
      ranges.push([index, index + part.length]);
      matched = true;
      from = index + part.length;
      index = lower.indexOf(rawNeedle, from);
    }
    if (matched || isAsciiWordQuery(part)) continue;

    let pos = 0;
    const local: [number, number][] = [];
    for (let i = 0; i < needle.length; i++) {
      pos = lower.indexOf(needle[i], pos);
      if (pos < 0) break;
      local.push([pos, pos + 1]);
      pos += 1;
    }
    if (local.length === needle.length) ranges.push(...local);
  }

  if (ranges.length <= 1) return ranges;
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/** 从应用名生成 1-2 字符字形。 */
export function monogramFor(name: string): string {
  const cleaned = name.replace(/\.(app|exe)$/i, "").trim();
  // 取首词的前两个字母（驼峰/空格分隔）
  const words = cleaned.split(/[\s\-_]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const w = words[0] || cleaned;
  return w.slice(0, w.length >= 2 ? 2 : 1);
}

/** 从进程名推断 Helper 角色（用于真实进程合并展示）。 */
export function inferRole(procName: string, isMain: boolean): string {
  if (isMain) return "主进程";
  const n = procName.toLowerCase();
  if (n.includes("gpu")) return "GPU";
  if (n.includes("renderer")) return "渲染进程";
  if (n.includes("plugin") || n.includes("extension")) return "扩展宿主";
  if (n.includes("network")) return "网络服务";
  if (n.includes("crashpad") || n.includes("crash")) return "崩溃监控";
  if (n.includes("utility")) return "工具进程";
  if (n.includes("helper")) return "辅助进程";
  return "子进程";
}
