/* ProcKill 主应用 —— 原生 TS 紧凑数据表（行内进程树 + Helper 合并）。
   由 bridge 驱动真实数据；浏览器无后端时走动态 mock。

   渲染策略（关键，去闪烁）：
   - 骨架（toolbar/main/滚动区）只 mount() 一次，永不销毁。
   - 之后所有刷新走 update*()，只改文本/样式/类，不重建 DOM。
   - 列表用 id→节点 的增量 diff：复用已有行、新增缺失行、移除消失行、
     只移动真正错位的节点。轮询刷新时 DOM 身份不变 → 数值跳动但绝不闪烁。 */
import "./styles_guard";
import { detectBridge, usesEmbeddedSearch, type PlatformBridge } from "./bridge";
import type { AppRow, Category, CategoryId, NetworkAppUsage } from "./types";
import { layoutForCat, metricHdrLabel, type MetricCol } from "./category-layout";
import {
  visibleCategories,
  CATEGORY_PREF_KEY,
  QUERY_PREF_KEY,
  SELECTION_PREF_KEY,
  SORT_KEY_PREF_KEY,
  SORT_DIR_PREF_KEY,
  NET_SORT_KEY_PREF_KEY,
  NET_SORT_DIR_PREF_KEY,
  fmtMem,
  fmtCpu,
  fmtRate,
  formatListenPorts,
  isModKey,
  fuzzyMatchScore,
  parsePortQuery,
  rowMatchesQuery,
  moveSelection,
  sortProcessRows,
  processSelectionKey,
  reconcileSelectionKey,
  restoreCategory,
  restoreQuery,
  restoreSort,
  cycleCategoryIndex,
  rowsForGuiSnapshot,
  searchInputKeyAction,
  shouldTriggerKill,
  centeredSelectionScroll,
  type ProcessSortKey,
  type ProcessSortDir,
} from "./shared";
import { icon } from "./icons";
import { appIcon, kbd, h, highlight } from "./atoms";
import {
  SHOW_PID_PREF_KEY,
  SHOW_PORTS_PREF_KEY,
  persistBool,
  restoreDisplayPrefs,
  portsVisibleOnPage,
  buildSettingsPage,
  type DisplayPrefKey,
  type SettingsPageRefs,
} from "./settings";
import {
  THEME_PREF_KEY,
  applyDataTheme,
  installSystemThemeWatch,
  resolveEffectiveTheme,
  resolveThemeState,
  type ThemePref,
  type UiTheme,
} from "./theme";

type SortKey = ProcessSortKey;
type SortDir = ProcessSortDir;

// 列布局：category-layout.ts（每 tab 一套列）
const REFRESH_MS = 2000;

interface State {
  cat: CategoryId;
  sortKey: SortKey;
  sortDir: SortDir;
  selectedKey: string | null;
  expanded: Set<string>;
  query: string;
  list: AppRow[]; // 当前分类的原始（未排序未过滤）列表
  loading: boolean;
  loadError: string | null;
  networkUsage: Map<string, NetworkAppUsage>;
  theme: UiTheme;
  themePref: ThemePref;
  page: "list" | "settings";
  showPid: boolean;
  showPorts: boolean;
}

// 一行复用的节点引用集合（增量更新时按需改这些子节点）。
interface RowRefs {
  wrap: HTMLElement;      // 整组容器（主行 + 展开的 helper 行）
  row: HTMLElement;       // 主行
  caret: HTMLButtonElement; // 展开箭头容器
  nameLine: HTMLElement;  // 名称行
  pathLine: HTMLElement;  // hover 才显示的 PID
  portsLine: HTMLElement; // 服务端口
  procWrap: HTMLElement;  // 进程数单元
  cpuVal: HTMLElement;
  memVal: HTMLElement;
  downloadVal: HTMLElement;
  uploadVal: HTMLElement;
  helperBox: HTMLElement; // helper 行的挂载容器
  iconHolder: HTMLElement;
  signature: string;      // 上次渲染用的内容指纹，跳过无变化的更新
}

type RowFocusAction = "expand";
interface RowFocusSnapshot { key: string; action: RowFocusAction }

class ProcKillApp {
  private bridge: PlatformBridge;
  private categories: Category[] = [];
  private savedCategory: CategoryId;
  private root: HTMLElement;
  private s: State;
  private refreshTimer: number | null = null;
  // 仅在用户主动改变选中项（键盘上下导航）时置 true，updateList 据此把选中项滚入视野一次。
  // 轮询刷新不置位 → 不会在用户下滑时把列表强行拉回顶部。
  private pendingScrollDirection: -1 | 1 | null = null;
  private selectionFallbackIndex = 0;
  // 请求序号：每次发起 load/polling 自增并捕获当时的分类，返回时校验仍是最新请求且分类未变，
  // 否则丢弃——防止快速切分类时较慢的旧请求乱序返回，把旧分类数据写进当前分类标题下。
  private loadSeq = 0;
  // 刚 kill 掉的进程组 id → 遮罩到期时间（performance.now ms）。
  // 防两类“复活”：① kill 时已在途的 list 响应整包写回；② 真实后端进程退出有延迟，
  // 下一两次刷新仍可能列出它。在落列表前过滤掉这些 id，短时遮罩后自动失效。
  private recentlyKilled = new Map<string, number>();
  private static readonly KILL_MASK_MS = 4000;
  private killingId: string | null = null;
  private networkInFlight = false;
  private lastNetworkStart = Number.NEGATIVE_INFINITY;
  private static readonly NETWORK_CADENCE_MS = 5000;

  // ---- 持久骨架节点引用（mount 后填充，永不为 null）----
  private win!: HTMLElement;
  private closeHint!: HTMLButtonElement;
  private categoryBtns: Record<string, { btn: HTMLElement; label: HTMLElement; key: HTMLElement }> = {};
  private searchBar!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private scroll!: HTMLElement;
  private headGrid!: HTMLElement;
  private emptyEl!: HTMLElement;
  private skeletonEl!: HTMLElement;
  private listMain!: HTMLElement;
  private listToolbar!: HTMLElement;
  private settingsPage!: SettingsPageRefs;
  private settingsBtn!: HTMLButtonElement;

  // 是否运行在 uTools 环境（用于叠加 uTools 专属视觉）
  private get isUtools(): boolean { return this.bridge.name === "utools"; }
  private get usesEmbeddedSearch(): boolean { return usesEmbeddedSearch(this.bridge.name); }

  // 列表行复用表
  private rows = new Map<string, RowRefs>();

  constructor(root: HTMLElement, bridge: PlatformBridge) {
    this.root = root;
    this.bridge = bridge;
    // uTools 插件窗口高度由宿主动态决定，height:100% 链可能塌缩导致列表滚不动；
    // 打上标记后 CSS 改用 100vh 固定视口高度，确保滚动区能正确收敛并响应滚轮。
    if (this.bridge.name === "utools") document.body.classList.add("utools");
    const { theme, themePref } = resolveThemeState(
      this.bridge.getPref(THEME_PREF_KEY),
      this.isUtools,
    );
    const initialCategory = restoreCategory(this.bridge.getPref(CATEGORY_PREF_KEY));
    this.savedCategory = initialCategory;
    const sortPrefs = initialCategory === "net"
      ? {
          key: this.bridge.getPref(NET_SORT_KEY_PREF_KEY) ?? this.bridge.getPref(SORT_KEY_PREF_KEY),
          dir: this.bridge.getPref(NET_SORT_DIR_PREF_KEY) ?? this.bridge.getPref(SORT_DIR_PREF_KEY),
        }
      : {
          key: this.bridge.getPref(SORT_KEY_PREF_KEY),
          dir: this.bridge.getPref(SORT_DIR_PREF_KEY),
        };
    const initialSort = restoreSort(sortPrefs.key, sortPrefs.dir, initialCategory);
    const display = restoreDisplayPrefs(
      this.bridge.getPref(SHOW_PID_PREF_KEY),
      this.bridge.getPref(SHOW_PORTS_PREF_KEY),
    );
    this.s = {
      cat: initialCategory,
      sortKey: initialSort.key,
      sortDir: initialSort.dir,
      // 每次打开都从当前结果的第一行开始；进程快照变化时仍由会话内选择键保持稳定。
      selectedKey: null,
      expanded: new Set(),
      query: restoreQuery(this.bridge.getPref(QUERY_PREF_KEY)),
      list: [],
      loading: true,
      loadError: null,
      networkUsage: new Map(),
      theme,
      themePref,
      page: "list",
      showPid: display.showPid,
      showPorts: display.showPorts,
    };
    this.refreshResolvedTheme();
  }

  private refreshResolvedTheme(): void {
    this.s.theme = resolveEffectiveTheme(this.s.themePref, this.isUtools);
    const extra = this.win ? [this.win] : undefined;
    applyDataTheme(this.s.theme, extra);
  }

  private installThemeWatch(): void {
    installSystemThemeWatch(() => {
      if (this.s.themePref !== "auto") return;
      this.refreshResolvedTheme();
      this.update();
    });
  }

  private syncAutoTheme(): void {
    if (this.s.themePref !== "auto") return;
    const next = resolveEffectiveTheme("auto", this.isUtools);
    if (next !== this.s.theme) {
      this.refreshResolvedTheme();
      this.update();
    }
  }

  // 切换排序列时重置方向：名称默认升序（A→Z），数字列默认降序（大→小）。
  private setSortKey(key: SortKey): void {
    this.s.sortKey = key;
    this.s.sortDir = key === "name" ? "asc" : "desc";
    this.persistSort();
  }

  private persistSort(): void {
    if (this.s.cat === "net") {
      this.bridge.setPref(NET_SORT_KEY_PREF_KEY, this.s.sortKey);
      this.bridge.setPref(NET_SORT_DIR_PREF_KEY, this.s.sortDir);
      return;
    }
    this.bridge.setPref(SORT_KEY_PREF_KEY, this.s.sortKey);
    this.bridge.setPref(SORT_DIR_PREF_KEY, this.s.sortDir);
  }

  private readSortPrefs(cat: CategoryId): { key: string | null; dir: string | null } {
    if (cat === "net") {
      return {
        key: this.bridge.getPref(NET_SORT_KEY_PREF_KEY) ?? this.bridge.getPref(SORT_KEY_PREF_KEY),
        dir: this.bridge.getPref(NET_SORT_DIR_PREF_KEY) ?? this.bridge.getPref(SORT_DIR_PREF_KEY),
      };
    }
    return {
      key: this.bridge.getPref(SORT_KEY_PREF_KEY),
      dir: this.bridge.getPref(SORT_DIR_PREF_KEY),
    };
  }

  private applySortForCategory(cat: CategoryId): void {
    const prefs = this.readSortPrefs(cat);
    const next = restoreSort(prefs.key, prefs.dir, cat);
    this.s.sortKey = next.key;
    this.s.sortDir = next.dir;
    this.persistSort();
  }

  // ---------- 派生数据 ----------
  private sortList(list: AppRow[]): AppRow[] {
    const { sortKey, sortDir } = this.s;
    const sorted = sortKey === "network" || sortKey === "download" || sortKey === "upload"
      ? [...list].sort((a, b) => {
          const usage = (row: AppRow) => this.s.networkUsage.get(processSelectionKey(row));
          const value = (row: AppRow) => {
            const item = usage(row);
            if (!item) return -1;
            if (sortKey === "download") return item.downloadBps;
            if (sortKey === "upload") return item.uploadBps;
            return item.downloadBps + item.uploadBps;
          };
          return (sortDir === "asc" ? 1 : -1) * (value(a) - value(b));
        })
      : sortProcessRows(list, sortKey, sortDir);
    return sorted.sort((a, b) => {
      const q = this.s.query.trim();
      if (q) {
        const bySearch = this.searchScore(a, q) - this.searchScore(b, q);
        if (bySearch !== 0) return bySearch;
      }
      return 0;
    });
  }

  private searchScore(app: AppRow, query: string): number {
    if (parsePortQuery(query) != null) return rowMatchesQuery(app, query) ? 0 : Number.POSITIVE_INFINITY;
    const helperScore = app.helpers.reduce((best, hp) => Math.min(
      best,
      80 + fuzzyMatchScore(`${hp.name} ${hp.role} ${hp.pid} ${formatListenPorts(hp.ports)}`, query),
    ), Number.POSITIVE_INFINITY);
    return Math.min(
      fuzzyMatchScore(app.name, query),
      20 + fuzzyMatchScore(String(app.pid), query),
      30 + fuzzyMatchScore(formatListenPorts(app.ports), query),
      40 + fuzzyMatchScore(app.path, query),
      50 + fuzzyMatchScore(app.commandLine || "", query),
      helperScore,
    );
  }

  private get filtered(): AppRow[] {
    const q = this.s.query.trim();
    const base = this.s.list;
    if (!q) return base;
    return base.filter((a) => rowMatchesQuery(a, q));
  }

  private visibleCache: AppRow[] | null = null;
  private get visible(): AppRow[] {
    if (this.visibleCache) return this.visibleCache;
    this.visibleCache = this.sortList(this.filtered);
    return this.visibleCache;
  }
  private invalidateVisible(): void { this.visibleCache = null; }

  private get selApp(): AppRow | null {
    const key = this.s.selectedKey;
    return key ? this.visible.find((row) => processSelectionKey(row) === key) || null : null;
  }

  // ---------- 数据加载 ----------
  async load(initial = false): Promise<void> {
    if (this.s.cat === "net" && this.networkInFlight) return;
    const seq = ++this.loadSeq;
    const cat = this.s.cat;
    if (cat === "net") {
      this.networkInFlight = true;
      this.lastNetworkStart = performance.now();
    }
    try {
      let list: AppRow[];
      if (cat === "gui") {
        const [all, snapshot] = await Promise.all([
          this.bridge.listProcesses("all"),
          this.bridge.getGuiSnapshot(),
        ]);
        const matched = rowsForGuiSnapshot(all, snapshot);
        if (!matched) throw new Error(snapshot.error || "可见窗口采集失败");
        list = matched;
      } else if (cat === "net") {
        const snapshot = await this.bridge.getNetworkSnapshot();
        if (snapshot.status !== "supported") throw new Error(snapshot.error || "网络采样失败");
        this.s.networkUsage = new Map(snapshot.apps.map((item) => [processSelectionKey(item.app), item]));
        list = snapshot.apps.map((item) => item.app);
      } else {
        list = await this.bridge.listProcesses(cat);
      }
      // 期间又发起了新请求 / 分类已切走 → 丢弃这份过期结果，避免串台。
      if (seq !== this.loadSeq || cat !== this.s.cat) return;
      this.rememberSelectionIndex();
      this.s.list = this.maskKilled(list);
      this.s.loading = false;
      this.s.loadError = null;
      this.update();
    } catch (e) {
      if (seq !== this.loadSeq || cat !== this.s.cat) return;
      console.error("[ProcKill] load failed", e);
      this.s.loading = false;
      const message = cat === "net" ? "网络采样失败，已保留上次结果" :
        cat === "gui" ? "可见窗口刷新失败，已保留上次结果" :
        "读取进程失败，请检查权限后重试";
      this.s.loadError = message;
      if (this.s.list.length) this.toast(message);
      this.update();
    } finally {
      if (cat === "net") this.networkInFlight = false;
      if (initial) this.startPolling();
    }
  }

  private startPolling(): void {
    if (this.refreshTimer != null) return;
    this.refreshTimer = window.setInterval(() => {
      if (document.hidden) return;      // 窗口隐藏/最小化时不刷新
      if (this.killingId) return;       // kill 进行中，跳过轮询避免阻塞放大
      if (this.s.cat === "net" && performance.now() - this.lastNetworkStart < ProcKillApp.NETWORK_CADENCE_MS) return;
      void this.load();
    }, REFRESH_MS);
  }

  // ---------- 进程动作 ----------
  private async doKill(app: AppRow): Promise<void> {
    if (this.killingId) return;
    this.rememberSelectionIndex();
    this.killingId = app.id;
    this.update();
    try {
      const res = await this.bridge.killProcess(app);
      if (res.ok) {
        // ① 让所有在途 load/polling 响应失效（它们仍含被 kill 的进程，回来会整包写回使其复活）
        ++this.loadSeq;
        // ② 短时遮罩该 id：真实后端进程退出有延迟，接下来一两次刷新仍可能列出它
        this.recentlyKilled.set(app.id, performance.now() + ProcKillApp.KILL_MASK_MS);
        this.s.list = this.s.list.filter((a) => a.id !== app.id);
        if (this.s.selectedKey === processSelectionKey(app)) this.setSelectedKey(null);
      } else {
        this.toast(`结束失败：${res.error || "权限不足或进程已退出"}`);
      }
    } catch (error) {
      console.error("[ProcKill] kill failed", error);
      this.toast("结束失败：无法连接进程服务，请刷新后重试");
    } finally {
      this.killingId = null;
      this.update();
    }
  }

  // 过滤掉处于遮罩期内的、刚被 kill 的进程；顺便清理已过期的遮罩项。
  private maskKilled(list: AppRow[]): AppRow[] {
    if (this.recentlyKilled.size === 0) return list;
    const now = performance.now();
    for (const [id, until] of this.recentlyKilled) {
      if (now >= until) this.recentlyKilled.delete(id);
    }
    if (this.recentlyKilled.size === 0) return list;
    return list.filter((a) => !this.recentlyKilled.has(a.id));
  }

  /** 回车 / 关闭按钮：直接强制结束，无确认弹窗。 */
  private tryKill(app: AppRow | null): void {
    if (!app || this.killingId) return;
    void this.doKill(app);
  }

  private toggleExpand(app: AppRow | null): void {
    if (!app || !app.helpers.length) return;
    const n = this.s.expanded;
    n.has(app.id) ? n.delete(app.id) : n.add(app.id);
    this.update();
  }

  private rebuildListHeader(): void {
    const lay = layoutForCat(this.s.cat);
    this.headGrid.title = this.s.cat === "net" ? "网络速率约每 5 秒更新" : "";
    this.headGrid.style.gridTemplateColumns = lay.gridTemplate;
    this.headGrid.replaceChildren();
    this.headGrid.appendChild(h("span"));
    this.headGrid.appendChild(h("span", { className: "t-label", text: lay.nameHdr }));
    for (const m of lay.metrics) {
      if (m === "cpu" || m === "mem" || m === "download" || m === "upload") {
        this.headGrid.appendChild(this.sortHdr(metricHdrLabel(m), m));
      } else {
        const align = m === "path" ? "left" : "right";
        this.headGrid.appendChild(h("span", {
          className: "t-label",
          style: { textAlign: align },
          text: metricHdrLabel(m),
        }));
      }
    }
  }

  private refreshGridLayout(): void {
    this.rebuildListHeader();
    const cols = layoutForCat(this.s.cat).gridTemplate;
    for (const [, ref] of this.rows) ref.row.style.gridTemplateColumns = cols;
  }

  private setSelectedKey(key: string | null): void {
    this.s.selectedKey = key;
    this.bridge.setPref(SELECTION_PREF_KEY, key ?? "");
  }

  private rememberSelectionIndex(): void {
    if (!this.s.selectedKey) return;
    const index = this.visible.findIndex((row) => processSelectionKey(row) === this.s.selectedKey);
    if (index >= 0) this.selectionFallbackIndex = index;
  }

  private setQuery(query: string): void {
    this.selectionFallbackIndex = 0;
    // 搜索结果变化后默认选中第一条，避免沿用仍然命中的旧选中项。
    this.setSelectedKey(null);
    this.s.query = restoreQuery(query);
    this.bridge.setPref(QUERY_PREF_KEY, this.s.query);
  }

  private setCat(cat: CategoryId): void {
    if (cat === this.s.cat || !this.categories.some((category) => category.id === cat)) return;
    this.s.cat = cat;
    this.applySortForCategory(cat);
    this.bridge.setPref(CATEGORY_PREF_KEY, cat);
    this.refreshGridLayout();
    this.setSelectedKey(null);
    this.selectionFallbackIndex = 0;
    this.s.loading = true;
    this.s.loadError = null;
    // 立刻清掉旧分类数据，否则 update() 会用旧 list 渲染、在新标题下短暂闪现旧分类行；
    // 若随后 load() 失败，旧数据还会永久残留。清空后进入加载态，新数据到了再 diff 填充。
    this.s.list = [];
    this.clearAllRows();
    this.update();
    this.load();
  }

  private cycleCategory(direction: 1 | -1): void {
    if (this.categories.length === 0) return;
    const index = this.categories.findIndex((category) => category.id === this.s.cat);
    const next = cycleCategoryIndex(index, direction, this.categories.length);
    this.setCat(this.categories[next].id);
    this.scroll?.focus({ preventScroll: true });
  }

  // 设置搜索词（uTools 带词进入 / 子输入框驱动）。
  private setSearch(query: string, focus: boolean): void {
    this.setQuery(query);
    this.update();
    if (focus && !this.isUtools) window.setTimeout(() => this.searchInput?.focus(), 0);
  }

  private toast(msg: string): void {
    let t = document.getElementById("pk-toast");
    if (!t) {
      t = h("div", { attrs: { id: "pk-toast" }, style: {
        position: "absolute", bottom: "52px", left: "50%", transform: "translateX(-50%)",
        background: "var(--bg-elev)", border: "1px solid var(--border-2)",
        color: "var(--fg-1)", font: "var(--t-sm)", padding: "8px 14px",
        borderRadius: "8px", boxShadow: "var(--shadow-pop)", zIndex: "60",
        maxWidth: "60%", textAlign: "center", transition: "opacity .25s",
      } });
      this.win.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    window.setTimeout(() => { if (t) t.style.opacity = "0"; }, 2600);
  }

  // ---------- 键盘 ----------
  private setPage(page: "list" | "settings"): void {
    if (this.s.page === page) return;
    this.s.page = page;
    this.update();
    if (page === "settings") this.settingsPage.back.focus();
    else this.scroll.focus({ preventScroll: true });
  }

  private setDisplayPref(key: DisplayPrefKey, value: boolean): void {
    this.s[key] = value;
    this.bridge.setPref(key === "showPid" ? SHOW_PID_PREF_KEY : SHOW_PORTS_PREF_KEY, persistBool(value));
    this.settingsPage.sync({ showPid: this.s.showPid, showPorts: this.s.showPorts });
    this.update();
  }

  private installKeys(): void {
    window.addEventListener("keydown", (e) => {
      const mod = isModKey(e);
      const s = this.s;
      if (s.page === "settings") {
        if (e.key === "Escape") {
          e.preventDefault();
          this.setPage("list");
        }
        return;
      }
      // Tab / Shift+Tab：循环切换可见分组（全局接管，含搜索框与分类按钮焦点）。
      if (e.key === "Tab") {
        e.preventDefault();
        this.cycleCategory(e.shiftKey ? -1 : 1);
        return;
      }
      // 搜索框保留普通输入/左右键，只把 Esc 与上下键交给结果列表。
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (target === this.searchInput) {
        const action = searchInputKeyAction(e.key);
        if (action === "clear") {
          e.preventDefault();
          this.setQuery("");
          this.update();
          return;
        }
        if (action === "native" && !shouldTriggerKill(e.key, "search")) return;
      } else if (target?.closest("input, textarea, select, button, a, [contenteditable]:not([contenteditable='false']), [role='button'], [role='checkbox'], [role='tab'], [role='menuitem']")) {
        return;
      }
      // ⌘/Ctrl + 1–5 切换固定分类。
      if (mod && e.key >= "1" && e.key <= String(this.categories.length)) {
        e.preventDefault();
        const c = this.categories[+e.key - 1];
        if (c) this.setCat(c.id);
        return;
      }
      // ⌘F / Ctrl+F / "/" 搜索
      if ((mod && e.key.toLowerCase() === "f") || e.key === "/") {
        e.preventDefault();
        // uTools 环境：内嵌搜索栏已隐藏、搜索由宿主子输入框接管，
        // 故把焦点交还给 uTools 子输入框（subInputSelect = 聚焦并选中已有内容）。
        if (this.isUtools) {
          const u = (window as any).utools;
          if (typeof u?.subInputSelect === "function") u.subInputSelect();
          else if (typeof u?.subInputFocus === "function") u.subInputFocus();
          return;
        }
        this.setSearch(s.query, true);
        return;
      }
      const v = this.visible;
      const current = s.selectedKey
        ? v.findIndex((row) => processSelectionKey(row) === s.selectedKey)
        : -1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = moveSelection(current, 1, v.length);
        this.setSelectedKey(next >= 0 ? processSelectionKey(v[next]) : null);
        this.selectionFallbackIndex = Math.max(0, next);
        this.pendingScrollDirection = 1;
        this.update();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = moveSelection(current, -1, v.length);
        this.setSelectedKey(next >= 0 ? processSelectionKey(v[next]) : null);
        this.selectionFallbackIndex = Math.max(0, next);
        this.pendingScrollDirection = -1;
        this.update();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const a = this.selApp;
        if (a && a.helpers.length && !s.expanded.has(a.id)) this.toggleExpand(a);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const a = this.selApp;
        if (a && s.expanded.has(a.id)) this.toggleExpand(a);
      } else if (!e.repeat && shouldTriggerKill(e.key, target === this.searchInput ? "search" : "list")) {
        e.preventDefault();
        this.tryKill(this.selApp);
      } else if (e.key === "r" && mod) {
        e.preventDefault();
        this.load();
      } else if (e.key === "Escape") {
        if (s.query || document.activeElement === this.searchInput) {
          this.setQuery(""); this.searchInput?.blur();
          this.update();
        }
      } else if (mod && e.key === ",") {
        e.preventDefault();
        this.setPage("settings");
      }
    });
  }

  // uTools 工具栈钩子：带词进入 / 顶部子输入框驱动搜索。
  private installUtoolsHooks(): void {
    const w = window as any;
    // 进入插件：先按 uTools 当前主题校准（auto 模式），再带词进入。
    w.__prockillEnter = (keyword: string) => {
      this.syncAutoTheme();
      this.setSearch(typeof keyword === "string" ? keyword : "", true);
    };
    // uTools 顶部子输入框实时驱动过滤（text 可能为空 → 清空过滤）。
    w.__prockillSubInput = (text: string) => {
      const q = typeof text === "string" ? text : "";
      this.setQuery(q);
      this.update();
    };
  }

  // ============================================================
  //  骨架挂载（只跑一次）
  // ============================================================
  private mount(): void {
    this.win = h("div", {
      className: "win",
      attrs: { "data-theme": this.s.theme },
    });

    this.win.appendChild(this.buildHeader());
    this.win.appendChild(this.buildMain());
    this.settingsPage = buildSettingsPage(
      { showPid: this.s.showPid, showPorts: this.s.showPorts },
      () => this.setPage("list"),
      (key, value) => this.setDisplayPref(key, value),
    );
    this.win.appendChild(this.settingsPage.root);

    this.root.appendChild(this.win);
  }

  private buildHeader(): HTMLElement {
    const s = this.s;
    const enterLabel = this.bridge.runtimePlatform === "mac" ? "↩" : "Enter";
    this.settingsBtn = h("button", {
      className: "pk-settings-btn",
      attrs: { type: "button", "aria-label": "打开设置", title: "设置" },
      on: { click: () => this.setPage("settings") },
      children: [icon("settings", 15, { color: "var(--fg-2)" } as any)],
    }) as HTMLButtonElement;
    this.closeHint = h("button", {
      className: "pk-close-hint",
      attrs: { type: "button", "aria-label": "立即结束当前选中应用", title: "立即结束当前选中应用" },
      style: {
        color: "var(--fg-2)", whiteSpace: "nowrap", marginLeft: "auto", height: "30px",
        display: "inline-flex", alignItems: "center", gap: "6px", padding: "0 8px",
        border: "1px solid transparent", borderRadius: "7px", background: "transparent", cursor: "pointer",
      },
      on: { click: () => this.tryKill(this.selApp) },
      children: [kbd(enterLabel), document.createTextNode("关闭应用")],
    }) as HTMLButtonElement;
    this.searchInput = h("input", {
      attrs: { placeholder: "搜索名称、PID…", "aria-label": "过滤进程" },
      style: {
        width: "150px", minWidth: "0", background: "transparent", border: "none", outline: "none",
        color: "var(--fg-1)", font: "var(--t-sm)",
      },
      on: { input: (e) => { this.setQuery((e.target as HTMLInputElement).value); this.update(); } },
    }) as HTMLInputElement;
    this.searchBar = h("div", {
      className: "pk-toolbar-search",
      attrs: { role: "search" },
      style: {
        width: "190px", height: "28px", flex: "none", display: "flex", alignItems: "center",
        gap: "7px", padding: "0 9px", borderRadius: "7px", background: "var(--bg-panel)",
        border: "1px solid var(--border-1)",
      },
      children: [icon("search", 13, { color: "var(--fg-3)" } as any), this.searchInput],
    });
    const tabs = h("div", {
      className: "pk-cat-tabs",
      attrs: { role: "tablist", "aria-label": "进程分类" },
      style: { display: "flex", alignItems: "center", gap: "2px", minWidth: "0", overflowX: "auto", overflowY: "hidden" },
    });
    for (const c of this.categories) {
      const label = h("span", { style: { font: "var(--t-sm)", color: "var(--fg-2)", whiteSpace: "nowrap" }, text: c.label });
      const key = h("span", { style: { display: "none" } });
      const btn = h("button", {
        className: "pk-cat-tab",
        attrs: {
          role: "tab",
          "aria-selected": c.id === s.cat ? "true" : "false",
          tabindex: c.id === s.cat ? "0" : "-1",
          ...(c.id === s.cat ? { "data-active": "" } : {}),
        },
        style: {
          display: "inline-flex", alignItems: "center", height: "26px", padding: "0 9px",
          borderRadius: "7px", border: "1px solid transparent", cursor: "pointer",
          textAlign: "left", background: "transparent", flex: "none",
        },
        on: {
          click: () => this.setCat(c.id),
          keydown: (event) => this.onCategoryKeydown(event as KeyboardEvent, c.id),
        },
        children: [label],
      });
      this.categoryBtns[c.id] = { btn, label, key };
      tabs.appendChild(btn);
    }
    this.listToolbar = h("header", {
      className: `pk-toolbar${this.usesEmbeddedSearch ? " pk-toolbar--dev" : ""}`,
      style: {
        height: "42px", flex: "none", display: "flex", alignItems: "center", gap: "8px",
        padding: "0 10px", background: "var(--bg-sidebar)",
      },
      children: [tabs, this.closeHint, ...(this.usesEmbeddedSearch ? [this.searchBar] : []), this.settingsBtn],
    });
    return this.listToolbar;
  }

  private buildMain(): HTMLElement {
    const s = this.s;
    const main = h("main", {
      className: "pk-list-page",
      style: {
        // minHeight:0 解除 flex item 默认 min-height:auto，
        // 否则内容超高时 .scroll 会被撑开而非内部滚动（uTools Chromium 严格遵守规范，故仅此处复现）。
        flex: "1", minWidth: "0", minHeight: "0", overflow: "hidden",
        display: "flex", flexDirection: "column",
        background: "var(--bg-panel)",
      },
    });

    // 列头（按分类 tab 重建列）
    this.headGrid = h("div", {
      className: "pk-list-head",
      style: {
        display: "grid", gap: "4px", alignItems: "center",
        padding: "0 6px 0 12px", height: "24px", flex: "none",
      },
    });
    main.appendChild(this.headGrid);
    this.rebuildListHeader();

    // 列表滚动区（持久）
    this.scroll = h("div", {
      className: "scroll",
      attrs: { id: "pk-scroll", role: "listbox", tabindex: "0", "aria-label": "进程列表，使用上下方向键移动选择，Tab 切换分组" },
      style: { flex: "1 1 auto", minHeight: "0", overflowY: "auto" },
    });
    // 加载骨架（Tab 切换 / 首屏）与文案空态（无数据 / 错误）
    this.skeletonEl = this.buildSkeleton();
    this.emptyEl = h("div", {
      className: "pk-empty",
      attrs: { role: "status" },
      style: { padding: "40px", textAlign: "center", color: "var(--fg-3)", font: "var(--t-sm)", display: "none" },
    });
    this.scroll.appendChild(this.skeletonEl);
    this.scroll.appendChild(this.emptyEl);
    main.appendChild(this.scroll);
    this.listMain = main;
    return main;
  }

  private buildSkeleton(): HTMLElement {
    // 名称条宽度错落，避免假列表像对齐的方块墙。
    const nameWidths = [120, 168, 100, 148, 88, 180, 112, 136];
    const rows = nameWidths.map((w) => h("div", {
      className: "pk-skeleton-row",
      children: [
        h("span", { className: "pk-skeleton-bone pk-skeleton-icon" }),
        h("span", { className: "pk-skeleton-bone pk-skeleton-name", style: { width: `${w}px` } }),
        h("div", { className: "pk-skeleton-metrics", children: [
          h("span", { className: "pk-skeleton-bone pk-skeleton-m" }),
          h("span", { className: "pk-skeleton-bone pk-skeleton-m" }),
          h("span", { className: "pk-skeleton-bone pk-skeleton-m" }),
        ] }),
      ],
    }));
    return h("div", {
      className: "pk-skeleton",
      attrs: {
        "aria-hidden": "true",
        role: "presentation",
      },
      style: { display: "none" },
      children: rows,
    });
  }

  private sortHdr(label: string, key: SortKey): HTMLElement {
    const s = this.s;
    const arrow = icon("chevron-down", 11, {} as any);
    const btn = h("button", {
      attrs: {
        "data-key": key,
        "aria-label": `按${label}排序`,
        "aria-sort": s.sortKey === key ? (s.sortDir === "asc" ? "ascending" : "descending") : "none",
      },
      style: {
        width: "100%", border: "none", background: "transparent", cursor: "pointer", textAlign: "right",
        display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: "3px",
        padding: "0", font: "var(--t-label)", textTransform: "uppercase",
        letterSpacing: "0.07em", fontWeight: "600", color: "var(--fg-3)",
      },
      on: { click: () => {
        if (s.sortKey === key) {
          s.sortDir = s.sortDir === "desc" ? "asc" : "desc";
          this.persistSort();
        } else {
          this.setSortKey(key);
        }
        this.update();
      } },
      children: [document.createTextNode(label), arrow],
    });
    (btn as any).__arrow = arrow;
    return btn;
  }

  // ============================================================
  //  增量更新（每帧调用，只改变化的部分）
  // ============================================================
  update(): void {
    this.invalidateVisible();
    const v = this.visible;
    const s = this.s;
    this.win.setAttribute("data-category", s.cat);
    this.win.setAttribute("data-page", s.page);
    this.win.setAttribute("data-show-pid", s.showPid ? "1" : "0");
    this.win.setAttribute("data-show-ports", portsVisibleOnPage(s.showPorts, s.cat) ? "1" : "0");
    const onSettings = s.page === "settings";
    this.listToolbar.hidden = onSettings;
    this.listMain.hidden = onSettings;
    this.settingsPage.root.hidden = !onSettings;
    if (onSettings) {
      this.settingsPage.sync({ showPid: s.showPid, showPorts: s.showPorts });
      return;
    }
    if (!(s.loading && v.length === 0)) {
      const restored = reconcileSelectionKey(s.selectedKey, v, this.selectionFallbackIndex);
      if (restored !== s.selectedKey) this.setSelectedKey(restored);
      if (restored) this.selectionFallbackIndex = Math.max(0, v.findIndex((row) => processSelectionKey(row) === restored));
    }

    this.updateHeader(v);
    this.updateTabs();
    this.updateSearchBar();
    this.updateList(v);
  }

  private updateHeader(v: AppRow[]): void {
    const s = this.s;
    this.closeHint.disabled = !this.selApp || !!this.killingId;
    this.closeHint.style.opacity = this.closeHint.disabled ? "0.45" : "1";
    this.closeHint.style.cursor = this.closeHint.disabled ? "default" : "pointer";

    // 列头高亮 + 箭头（仅可排序的 CPU/内存列）
    for (const hdr of this.headGrid.querySelectorAll("button[data-key]")) {
      const el = hdr as HTMLElement;
      const key = el.getAttribute("data-key") as SortKey;
      const active = s.sortKey === key;
      el.style.color = active ? "var(--fg-1)" : "var(--fg-3)";
      el.setAttribute("aria-sort", active ? (s.sortDir === "asc" ? "ascending" : "descending") : "none");
      el.setAttribute("aria-label", `按${el.textContent?.trim() || "指标"}排序，当前${active ? (s.sortDir === "asc" ? "升序" : "降序") : "未排序"}`);
      const arrow = (el as HTMLElement & { __arrow?: HTMLElement }).__arrow;
      if (arrow) {
        arrow.style.display = active ? "" : "none";
        arrow.style.transform = s.sortDir === "asc" ? "scaleY(-1)" : "none";
      }
    }
  }

  private updateTabs(): void {
    const s = this.s;
    for (const c of this.categories) {
      const ref = this.categoryBtns[c.id];
      const on = c.id === s.cat;
      // 选中态背景 / 描边交给 CSS（.pk-cat-tab[data-active]），这里只清 inline 覆盖。
      ref.btn.style.background = "";
      ref.btn.style.borderColor = "transparent";
      ref.label.style.color = on ? "var(--fg-1)" : "var(--fg-2)";
      ref.label.style.fontWeight = on ? "600" : "";
      ref.btn.setAttribute("aria-selected", on ? "true" : "false");
      ref.btn.setAttribute("tabindex", on ? "0" : "-1");
      if (on) ref.btn.setAttribute("data-active", "");
      else ref.btn.removeAttribute("data-active");
    }
  }

  private onCategoryKeydown(event: KeyboardEvent, id: CategoryId): void {
    const index = this.categories.findIndex((category) => category.id === id);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % this.categories.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + this.categories.length) % this.categories.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.categories.length - 1;
    else return;
    event.preventDefault();
    const category = this.categories[next];
    this.setCat(category.id);
    window.setTimeout(() => this.categoryBtns[category.id]?.btn.focus(), 0);
  }

  private updateSearchBar(): void {
    const s = this.s;
    // 正式 uTools 只使用宿主 subInput；该紧凑输入框仅存在于浏览器开发 mock。
    // 仅当值不同步时写入，避免打断输入法/光标
    if (this.searchInput.value !== s.query) this.searchInput.value = s.query;
  }

  // 列表增量 diff：复用/新增/移除/重排，只动必要节点。
  private updateList(v: AppRow[]): void {
    const s = this.s;
    const focusSnapshot = this.captureRowFocus();
    if (v.length === 0) this.scroll.removeAttribute("aria-activedescendant");

    // 加载中且无数据：骨架屏，不用「加载中」文案
    if (s.loading && v.length === 0) {
      this.showSkeleton();
      this.clearAllRows();
      this.restoreRowFocus(focusSnapshot, v);
      return;
    }
    if (s.loadError && v.length === 0) {
      this.showEmpty(s.loadError);
      this.clearAllRows();
      this.restoreRowFocus(focusSnapshot, v);
      return;
    }
    if (v.length === 0) {
      this.showEmpty(s.query ? "没有匹配的进程" : "没有进程");
      this.clearAllRows();
      this.restoreRowFocus(focusSnapshot, v);
      return;
    }
    this.hideListPlaceholders();
    const selected = this.selApp;
    if (selected) this.scroll.setAttribute("aria-activedescendant", `pk-row-${this.domId(selected.id)}`);
    else this.scroll.removeAttribute("aria-activedescendant");

    const wantIds = new Set(v.map((a) => a.id));

    // 1) 删除已消失的行
    for (const [id, ref] of this.rows) {
      if (!wantIds.has(id)) { ref.wrap.remove(); this.rows.delete(id); }
    }

    // 2) 按目标顺序复用/新建，并就地排序
    let prev: HTMLElement | null = null; // 上一个已就位的 wrap
    v.forEach((a, i) => {
      let ref = this.rows.get(a.id);
      if (!ref) {
        ref = this.buildRow(a);
        this.rows.set(a.id, ref);
      }
      this.updateRow(ref, a, i, s.selectedKey === processSelectionKey(a));

      // 顺序校正：当前 wrap 应紧跟在 prev 之后
      const shouldFollow = prev ? prev.nextSibling : this.scroll.firstChild;
      if (ref.wrap !== shouldFollow) {
        this.scroll.insertBefore(ref.wrap, shouldFollow);
      }
      prev = ref.wrap;
    });

    this.restoreRowFocus(focusSnapshot, v);

    // 方向键选择越过可视中线后才跟随；轮询与鼠标选择不触发居中大跳。
    const direction = this.pendingScrollDirection;
    const sel = direction ? this.selApp : null;
    this.pendingScrollDirection = null;
    const el = sel && this.rows.get(sel.id)?.row;
    if (el && direction) {
      const cont = this.scroll;
      const rRect = el.getBoundingClientRect();
      const cRect = cont.getBoundingClientRect();
      cont.scrollTop = centeredSelectionScroll({
        scrollTop: cont.scrollTop,
        clientHeight: cont.clientHeight,
        scrollHeight: cont.scrollHeight,
        rowTop: rRect.top - cRect.top + cont.scrollTop,
        rowHeight: rRect.height,
        direction,
      });
    }
  }

  private showSkeleton(): void {
    this.emptyEl.style.display = "none";
    this.emptyEl.textContent = "";
    this.skeletonEl.style.display = "";
    this.scroll.setAttribute("aria-busy", "true");
  }

  private showEmpty(msg: string): void {
    this.skeletonEl.style.display = "none";
    this.scroll.removeAttribute("aria-busy");
    this.emptyEl.textContent = msg;
    this.emptyEl.style.display = "";
  }

  private hideListPlaceholders(): void {
    this.skeletonEl.style.display = "none";
    this.emptyEl.style.display = "none";
    this.emptyEl.textContent = "";
    this.scroll.removeAttribute("aria-busy");
  }

  private clearAllRows(): void {
    for (const [, ref] of this.rows) ref.wrap.remove();
    this.rows.clear();
  }

  private domId(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "-");
  }

  private captureRowFocus(): RowFocusSnapshot | null {
    const active = document.activeElement as HTMLElement | null;
    const actionEl = active?.closest<HTMLElement>("[data-row-action]");
    const row = actionEl?.closest<HTMLElement>(".pk-process-row");
    const key = row?.getAttribute("data-selection-key");
    const action = actionEl?.getAttribute("data-row-action");
    if (!key || action !== "expand") return null;
    return { key, action };
  }

  private restoreRowFocus(snapshot: RowFocusSnapshot | null, rows: AppRow[]): void {
    if (!snapshot) return;
    const app = rows.find((row) => encodeURIComponent(processSelectionKey(row)) === snapshot.key);
    if (!app) {
      this.scroll.focus({ preventScroll: true });
      return;
    }
    const ref = this.rows.get(app.id);
    ref?.caret.focus({ preventScroll: true });
  }

  private rowCellsForLayout(
    caret: HTMLElement,
    nameCol: HTMLElement,
    procWrap: HTMLElement,
    cpuCol: HTMLElement,
    memCol: HTMLElement,
    downloadCol: HTMLElement,
    uploadCol: HTMLElement,
  ): HTMLElement[] {
    const map: Record<MetricCol, HTMLElement> = {
      procs: procWrap, cpu: cpuCol, mem: memCol, download: downloadCol, upload: uploadCol, path: procWrap,
    };
    const cells: HTMLElement[] = [caret, nameCol];
    for (const m of layoutForCat(this.s.cat).metrics) cells.push(map[m]);
    return cells;
  }

  // 新建一行（结构骨架，值由 updateRow 填）。
  private buildRow(a: AppRow): RowRefs {
    const s = this.s;
    const wrap = h("div", { className: "pk-app-group" });

    const caret = h("button", {
      className: "pk-row-caret",
      attrs: { type: "button", "data-row-action": "expand", "aria-label": `${a.name} 的子进程`, "aria-expanded": "false" },
      style: {
        width: "16px", height: "16px", display: "grid", placeItems: "center",
        border: "none", background: "transparent", cursor: "pointer", padding: "0",
      },
      on: { click: (e) => { e.stopPropagation(); this.selectById(a.id, false); this.toggleExpand(this.findById(a.id)); } },
    });

    const iconHolder = h("span", { style: { display: "inline-flex" } });
    const nameLine = h("div", { className: "t-sm pk-row-name", style: { color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0" } });
    const portsLine = h("span", { className: "pk-row-ports", style: { whiteSpace: "nowrap", flex: "none" } });
    const pathLine = h("span", { className: "pk-row-pid", style: { font: "400 12px/16px var(--font-mono)", color: "var(--fg-3)", whiteSpace: "nowrap", flex: "none" } });
    const nameCol = h("div", { className: "pk-row-main", style: { display: "flex", alignItems: "center", gap: "8px", minWidth: "0" }, children: [iconHolder, nameLine, portsLine, pathLine] });

    const procWrap = h("div", { className: "num", style: { textAlign: "right" } });
    const cpuVal = h("span", { className: "t-mono", style: { fontSize: "11px", display: "block", textAlign: "right" } });
    const cpuCol = h("div", { style: { textAlign: "right" }, children: [cpuVal] });
    const memVal = h("span", { className: "t-mono", style: { fontSize: "11px", display: "block", textAlign: "right" } });
    const memCol = h("div", { style: { textAlign: "right" }, children: [memVal] });
    const downloadVal = h("span", { className: "t-mono", style: { fontSize: "11px", display: "block", textAlign: "right", whiteSpace: "nowrap" } });
    const downloadCol = h("div", { className: "pk-network-download", style: { textAlign: "right" }, children: [downloadVal] });
    const uploadVal = h("span", { className: "t-mono", style: { fontSize: "11px", display: "block", textAlign: "right", whiteSpace: "nowrap" } });
    const uploadCol = h("div", { className: "pk-network-upload", style: { textAlign: "right" }, children: [uploadVal] });

    const row = h("div", {
      className: "pk-process-row",
      attrs: { id: `pk-row-${this.domId(a.id)}`, role: "option", tabindex: "-1", "aria-selected": "false" },
      style: {
        display: "grid", gridTemplateColumns: layoutForCat(this.s.cat).gridTemplate, alignItems: "center", gap: "4px",
        padding: "0 6px 0 12px", height: "38px", cursor: "pointer", position: "relative",
        background: "transparent",
      },
      on: {
        click: () => { this.selectById(a.id); },
        dblclick: () => this.toggleExpand(this.findById(a.id)),
      },
      children: this.rowCellsForLayout(caret, nameCol, procWrap, cpuCol, memCol, downloadCol, uploadCol),
    });

    const helperBox = h("div");
    wrap.appendChild(row);
    wrap.appendChild(helperBox);

    return {
      wrap, row, caret, nameLine, pathLine, portsLine, procWrap,
      cpuVal, memVal, downloadVal, uploadVal, helperBox, iconHolder,
      signature: "",
    };
  }

  private findById(id: string): AppRow | null {
    return this.visible.find((a) => a.id === id) || null;
  }
  private selectById(id: string, focusList = true): void {
    const index = this.visible.findIndex((a) => a.id === id);
    const app = index >= 0 ? this.visible[index] : null;
    if (app) {
      this.selectionFallbackIndex = index;
      this.setSelectedKey(processSelectionKey(app));
      this.update();
      if (focusList) this.scroll.focus({ preventScroll: true });
    }
  }

  private fillMetricCells(
    ref: RowRefs,
    a: AppRow,
    metrics: readonly MetricCol[],
  ): void {
    const show = new Set(metrics);
    const clear = (el: HTMLElement) => { el.replaceChildren(); };
    if (!show.has("procs") && !show.has("path")) clear(ref.procWrap);
    else if (show.has("path")) {
      ref.procWrap.style.textAlign = "left";
      ref.procWrap.replaceChildren(h("span", {
        style: {
          font: "var(--t-mono-sm)", color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", display: "block",
        },
        text: a.path,
      }));
    } else if (show.has("procs")) {
      ref.procWrap.style.textAlign = "right";
      if (a.procs > 1) {
        ref.procWrap.replaceChildren(h("span", {
          style: { font: "var(--t-mono-sm)", color: "var(--fg-2)", whiteSpace: "nowrap" },
          text: "×" + a.procs,
        }));
      } else {
        ref.procWrap.replaceChildren(h("span", { style: { font: "var(--t-mono-sm)", color: "var(--fg-3)" }, text: "×1" }));
      }
    }
    if (show.has("cpu")) {
      ref.cpuVal.textContent = fmtCpu(a.cpu);
    } else {
      ref.cpuVal.textContent = "";
    }
    if (show.has("mem")) {
      ref.memVal.textContent = fmtMem(a.mem);
    } else {
      ref.memVal.textContent = "";
    }
    const usage = this.s.networkUsage.get(processSelectionKey(a));
    ref.downloadVal.textContent = show.has("download") ? (usage ? fmtRate(usage.downloadBps) : "采样中") : "";
    ref.uploadVal.textContent = show.has("upload") ? (usage ? fmtRate(usage.uploadBps) : "采样中") : "";
  }

  // 更新一行的内容（只在指纹变化时改 DOM）。
  private updateRow(ref: RowRefs, a: AppRow, index: number, selected: boolean): void {
    const s = this.s;
    const expanded = s.expanded.has(a.id);
    ref.row.setAttribute("data-selection-key", encodeURIComponent(processSelectionKey(a)));
    // 指纹：决定是否需要重绘这一行（含值、选中、展开、量尺基准、图标相关、helper 明细）。
    // helper 明细必须纳入：展开态下，即便父级聚合值四舍五入后不变，helper 的 pid/cpu/mem 仍可能变。
    // 图标字段纳入：真实图标异步补上或系统归属变化时要能重画。
    const q = s.query.trim().toLowerCase();
    const sig = [
      a.cpu, a.mem, a.procs, a.pid, a.name, a.path, (a.ports || []).join(","),
      s.showPid ? 1 : 0, portsVisibleOnPage(s.showPorts, s.cat) ? 1 : 0,
      this.s.networkUsage.get(processSelectionKey(a))?.downloadBps ?? "",
      this.s.networkUsage.get(processSelectionKey(a))?.uploadBps ?? "",
      a.snapshotToken, (a.allPids || []).join(","),
      selected ? 1 : 0, expanded ? 1 : 0,
      a.sys ? 1 : 0, a.systemOwned ? 1 : 0, a.iconUrl || "",
      q, // 搜索词纳入：改词时已渲染行要重画匹配高亮
      s.cat,
      a.helpers.map((hp) => `${hp.pid}:${hp.cpu}:${hp.mem}:${hp.name}:${hp.role}:${(hp.ports || []).join(",")}`).join(","),
    ].join("|");
    if (ref.signature === sig) {
      // 仅选中态可能因键盘移动而频繁变；已包含在 sig，无需额外处理
      return;
    }
    ref.signature = sig;

    // 选中样式由 CSS 驱动（方案 A：轻底 + 左线）；wrap 的 data-sel 让展开 helper 同组高亮。
    if (selected) {
      ref.row.setAttribute("data-sel", "1");
      ref.wrap.setAttribute("data-sel", "1");
    } else {
      ref.row.removeAttribute("data-sel");
      ref.wrap.removeAttribute("data-sel");
    }
    ref.row.setAttribute("aria-selected", selected ? "true" : "false");
    // 焦点保留在 listbox，通过 aria-activedescendant 表达当前项，避免轮询时焦点跳动。
    ref.row.tabIndex = -1;

    // 展开箭头
    const canExpand = a.helpers.length > 0;
    ref.caret.style.cursor = canExpand ? "pointer" : "default";
    ref.caret.setAttribute("aria-expanded", expanded ? "true" : "false");
    ref.caret.disabled = !canExpand;
    ref.caret.replaceChildren();
    if (canExpand) {
      ref.caret.appendChild(icon(expanded ? "chevron-down" : "chevron-right", 13, { color: "var(--fg-3)" } as any));
    }

    // 图标：仅在视觉相关字段变化时重建，平时复用避免重画。
    const iconSig = `${a.id}|${a.sys ? 1 : 0}|${a.systemOwned ? 1 : 0}|${a.iconUrl || ""}`;
    if (!ref.iconHolder.firstChild || ref.iconHolder.getAttribute("data-icon-sig") !== iconSig) {
      ref.iconHolder.replaceChildren(appIcon(a, a.sys ? 18 : 18, a.sys ? 5 : 5));
      ref.iconHolder.setAttribute("data-icon-sig", iconSig);
    }

    const lay = layoutForCat(s.cat);
    ref.nameLine.replaceChildren(highlight(a.name, q));
    const portsText = portsVisibleOnPage(s.showPorts, s.cat) ? formatListenPorts(a.ports) : "";
    ref.portsLine.replaceChildren(document.createTextNode(portsText));
    ref.portsLine.hidden = !portsText;
    ref.pathLine.replaceChildren(document.createTextNode(s.showPid ? String(a.pid) : ""));
    ref.pathLine.hidden = !s.showPid;
    this.fillMetricCells(ref, a, lay.metrics);

    // 展开的 Helper 行
    if (expanded && a.helpers.length) {
      ref.helperBox.replaceChildren(...a.helpers.map((hp) => this.buildHelperRow(hp, q)));
    } else {
      ref.helperBox.replaceChildren();
    }
  }

  private buildHelperRow(hp: AppRow["helpers"][number], q: string): HTMLElement {
    const hr = h("div", {
      className: "pk-helper-row",
      style: {
        display: "grid", gridTemplateColumns: layoutForCat(this.s.cat).gridTemplate, alignItems: "center", gap: "4px",
        padding: "0 6px 0 12px", height: "24px", background: "var(--bg-helper-row)",
      },
    });
    hr.appendChild(h("span"));
    const cell = h("div", {
      style: { display: "flex", alignItems: "center", gap: "8px", minWidth: "0", paddingLeft: "16px", position: "relative" },
    });
    cell.appendChild(h("span", { style: { position: "absolute", left: "5px", top: "-12px", width: "1px", height: "24px", background: "var(--border-2)" } }));
    cell.appendChild(h("span", { style: { position: "absolute", left: "5px", top: "12px", width: "9px", height: "1px", background: "var(--border-2)" } }));
    const hName = h("span", { style: { font: "var(--t-mono-sm)", color: "var(--fg-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } });
    hName.appendChild(highlight(hp.name, q));
    cell.appendChild(hName);
    cell.appendChild(h("span", { style: { font: "var(--t-xs)", color: "var(--fg-3)", padding: "0 5px", borderRadius: "4px", background: "var(--bg-elev)", whiteSpace: "nowrap", flex: "none" }, text: hp.role }));
    const helperPorts = portsVisibleOnPage(this.s.showPorts, this.s.cat) ? formatListenPorts(hp.ports) : "";
    if (helperPorts) {
      cell.appendChild(h("span", { className: "pk-row-ports", style: { whiteSpace: "nowrap", flex: "none" }, text: helperPorts }));
    }
    if (this.s.showPid) {
      cell.appendChild(h("span", { className: "pk-row-pid", style: { font: "400 12px/16px var(--font-mono)", color: "var(--fg-3)", whiteSpace: "nowrap", flex: "none" }, text: String(hp.pid) }));
    }
    hr.appendChild(cell);
    for (const m of layoutForCat(this.s.cat).metrics) {
      if (m === "cpu") {
        hr.appendChild(h("span", { className: "t-mono", style: { fontSize: "11px", color: "var(--fg-3)", textAlign: "right" }, text: fmtCpu(hp.cpu) }));
      } else if (m === "mem") {
        hr.appendChild(h("span", { className: "t-mono", style: { fontSize: "11px", color: "var(--fg-3)", textAlign: "right" }, text: fmtMem(hp.mem) }));
      } else {
        hr.appendChild(h("span"));
      }
    }
    return hr;
  }

  async start(): Promise<void> {
    const [gui, network] = await Promise.all([
      this.bridge.getGuiCapability(),
      this.bridge.getNetworkCapability(),
    ]);
    this.categories = visibleCategories(gui.status === "supported", network.status === "supported");
    this.s.cat = restoreCategory(this.savedCategory, this.categories);
    if (this.s.cat !== this.savedCategory) this.bridge.setPref(CATEGORY_PREF_KEY, "all");
    // 可见分类就绪后，按最终分类再校正一次排序偏好。
    const prefs = this.readSortPrefs(this.s.cat);
    const sort = restoreSort(prefs.key, prefs.dir, this.s.cat);
    this.s.sortKey = sort.key;
    this.s.sortDir = sort.dir;
    this.mount();
    this.installKeys();
    this.installUtoolsHooks();
    this.installThemeWatch();
    this.update();
    this.load(true);
  }
}

const rootEl = document.getElementById("app")!;
detectBridge().then((bridge) => {
  const app = new ProcKillApp(rootEl, bridge);
  void app.start();
  (window as any).__prockill = app;
}).catch((error) => {
  const message = error instanceof Error ? error.message : "插件初始化失败，进程数据不可用。";
  console.error("[ProcKill] bootstrap failed", error);
  rootEl.replaceChildren(h("main", {
    attrs: { role: "alert" },
    style: {
      minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px",
      background: "var(--bg-panel)", color: "var(--fg-1)", textAlign: "center",
    },
    children: [h("div", { children: [
      h("div", { style: { font: "var(--t-lg)", marginBottom: "8px" }, text: "插件暂不可用" }),
      h("div", { style: { font: "var(--t-sm)", color: "var(--fg-2)" }, text: message }),
    ] })],
  }));
});
