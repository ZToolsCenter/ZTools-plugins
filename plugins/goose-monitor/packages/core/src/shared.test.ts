import { describe, expect, test } from "bun:test";
import {
  CATEGORIES,
  visibleCategories,
  CATEGORY_PREF_KEY,
  QUERY_PREF_KEY,
  SELECTION_PREF_KEY,
  SORT_KEY_PREF_KEY,
  SORT_DIR_PREF_KEY,
  fmtCpu,
  fmtMem,
  fmtRate,
  formatListenPorts,
  fuzzyMatch,
  fuzzyMatchRanges,
  fuzzyMatchScore,
  parsePortQuery,
  rowMatchesQuery,
  searchHaystack,
  isInteractiveKeyboardTag,
  moveSelection,
  normalizeSearchText,
  processSelectionKey,
  reconcileSelectionKey,
  restoreCategory,
  restoreQuery,
  restoreSort,
  cycleCategoryIndex,
  rowsForGuiSnapshot,
  searchInputKeyAction,
  sortProcessRows,
  shouldTriggerKill,
  centeredSelectionScroll,
} from "./shared";
import type { AppRow } from "./types";

const row = (overrides: Partial<AppRow>): AppRow => ({
  id: "app", identity: "app", snapshotToken: "snapshot", name: "App",
  monogram: "A", procs: 1, cpu: 0, mem: 0, pid: 10,
  path: "/Applications/App.app", helpers: [], allPids: [10], ...overrides,
});

describe("一级分类", () => {
  test("两项能力都可用时显示六项", () => {
    expect(CATEGORIES.map(({ id, label, key }) => ({ id, label, key }))).toEqual([
      { id: "all", label: "全部", key: "1" },
      { id: "gui", label: "界面", key: "2" },
      { id: "cpu", label: "CPU", key: "3" },
      { id: "mem", label: "内存", key: "4" },
      { id: "net", label: "网络", key: "5" },
      { id: "bg", label: "后台", key: "6" },
    ]);
  });

  test("能力隐藏后快捷键按可见顺序连续重排", () => {
    expect(visibleCategories(true, false).map(({ id, key }) => [id, key])).toEqual([
      ["all", "1"], ["gui", "2"], ["cpu", "3"], ["mem", "4"], ["bg", "5"],
    ]);
    expect(visibleCategories(false, false).map(({ id, key }) => [id, key])).toEqual([
      ["all", "1"], ["cpu", "2"], ["mem", "3"], ["bg", "4"],
    ]);
  });
});

describe("界面状态恢复", () => {
  test("分类仅恢复有效值，非法或旧值回到全部", () => {
    expect(CATEGORY_PREF_KEY).toBe("pk_category");
    expect(restoreCategory("gpu")).toBe("all");
    expect(restoreCategory("gui")).toBe("gui");
    expect(restoreCategory("gui", visibleCategories(false, true))).toBe("all");
    expect(restoreCategory("net", visibleCategories(true, false))).toBe("all");
    expect(restoreCategory(null)).toBe("all");
  });

  test("可见窗口按组内任一 PID 命中，采集失败不冒充空列表", () => {
    const app = row({ id: "multi", pid: 10, allPids: [10, 11] });
    expect(rowsForGuiSnapshot([app], { status: "supported", sampledAt: 1, pids: [11] })).toEqual([app]);
    expect(rowsForGuiSnapshot([app], { status: "supported", sampledAt: 1, pids: [] })).toEqual([]);
    expect(rowsForGuiSnapshot([app], { status: "error", sampledAt: 1, pids: [], error: "failed" })).toBeNull();
  });

  test("筛选词可恢复并限制持久化长度", () => {
    expect(QUERY_PREF_KEY).toBe("pk_query");
    expect(restoreQuery("chrome")).toBe("chrome");
    expect(restoreQuery("x".repeat(201))).toHaveLength(200);
  });

  test("排序偏好按分类校验，非法值回落默认", () => {
    expect(SORT_KEY_PREF_KEY).toBe("pk_sort_key");
    expect(SORT_DIR_PREF_KEY).toBe("pk_sort_dir");
    expect(restoreSort("cpu", "asc", "all")).toEqual({ key: "cpu", dir: "asc" });
    expect(restoreSort("download", "desc", "net")).toEqual({ key: "download", dir: "desc" });
    expect(restoreSort("download", "desc", "all")).toEqual({ key: "mem", dir: "desc" });
    expect(restoreSort("bogus", null, "cpu")).toEqual({ key: "cpu", dir: "desc" });
    expect(restoreSort("name", "nope", "all")).toEqual({ key: "name", dir: "asc" });
    expect(restoreSort(null, null, "net")).toEqual({ key: "network", dir: "desc" });
  });

  test("Tab 在可见分类间循环，Shift 反向", () => {
    expect(cycleCategoryIndex(0, 1, 5)).toBe(1);
    expect(cycleCategoryIndex(4, 1, 5)).toBe(0);
    expect(cycleCategoryIndex(0, -1, 5)).toBe(4);
    expect(cycleCategoryIndex(2, -1, 5)).toBe(1);
    expect(cycleCategoryIndex(-1, 1, 5)).toBe(0);
    expect(cycleCategoryIndex(99, -1, 5)).toBe(4);
    expect(cycleCategoryIndex(0, 1, 0)).toBe(0);
  });

  test("无选中项默认进入首行；同 id 快照轮转时粘留选中", () => {
    expect(SELECTION_PREF_KEY).toBe("pk_selected_process");
    const rows = [row({ id: "first" }), row({ id: "second" })];
    expect(reconcileSelectionKey(null, rows)).toBe(processSelectionKey(rows[0]));
    const selected = processSelectionKey(row({ id: "chrome", snapshotToken: "pid:10:start:old" }));
    expect(reconcileSelectionKey(selected, [row({ id: "chrome", snapshotToken: "pid:10:start:old" })]))
      .toBe(selected);
    expect(reconcileSelectionKey(selected, [row({ id: "chrome", snapshotToken: "pid:10:start:new" })]))
      .toBe(processSelectionKey(row({ id: "chrome", snapshotToken: "pid:10:start:new" })));
  });

  test("快照轮转时不因排序位移跳到其他进程", () => {
    const alpha = row({ id: "alpha", snapshotToken: "old", mem: 10 });
    const beta = row({ id: "beta", snapshotToken: "b", mem: 50 });
    const selected = processSelectionKey(alpha);
    // alpha 仍在列表但位置变了且 snapshot 更新
    const reordered = [
      row({ id: "beta", snapshotToken: "b", mem: 50 }),
      row({ id: "alpha", snapshotToken: "new", mem: 10 }),
    ];
    expect(reconcileSelectionKey(selected, reordered, 0))
      .toBe(processSelectionKey(row({ id: "alpha", snapshotToken: "new" })));
  });
});

describe("进程搜索", () => {
  test("忽略常见路径分隔符和大小写", () => {
    expect(normalizeSearchText("Google.Chrome / Helper_GPU")).toBe("googlechromehelpergpu");
    expect(fuzzyMatch("Google Chrome Helper GPU", "chrome gpu")).toBe(true);
  });

  test("拉丁字母和数字不做跨字符误匹配", () => {
    expect(fuzzyMatch("Google Chrome", "gch")).toBe(false);
    expect(fuzzyMatch("PID 12345", "135")).toBe(false);
  });

  test("中文支持按顺序缩写匹配", () => {
    expect(fuzzyMatch("企业微信", "企微")).toBe(true);
    expect(fuzzyMatchRanges("企业微信", "企微")).toEqual([[0, 1], [2, 3]]);
  });

  test("名称命中比路径命中分数更高", () => {
    expect(fuzzyMatchScore("Chrome", "chrome")).toBeLessThan(
      40 + fuzzyMatchScore("/Applications/Chrome.app", "chrome"),
    );
  });

  test("8101 与 :8101 命中已挂端口的 java", () => {
    const java = row({
      name: "java", path: "/usr/bin/java", pid: 1700, ports: [8101],
    });
    expect(parsePortQuery("8101")).toBe(8101);
    expect(parsePortQuery(":8101")).toBe(8101);
    expect(rowMatchesQuery(java, "8101")).toBe(true);
    expect(rowMatchesQuery(java, ":8101")).toBe(true);
    expect(searchHaystack(java)).toContain("8101");
  });

  test(":8101 能命中仅命令行声明端口、ports 为空的行", () => {
    const java = row({
      name: "diteng-im-server",
      path: "/usr/bin/java",
      pid: 1700,
      ports: [],
      commandLine: "/usr/bin/java -jar /opt/diteng-im-server-202409.01.jar --server.port=8101",
    });
    expect(rowMatchesQuery(java, ":8101")).toBe(true);
    expect(rowMatchesQuery(java, "8101")).toBe(true);
    const dashD = row({
      ...java,
      commandLine: "/usr/bin/java -Dserver.port=8101 -jar /opt/app.jar",
    });
    expect(rowMatchesQuery(dashD, "8101")).toBe(true);
  });

  test("810 不误伤 8101", () => {
    const java = row({
      name: "java", path: "/usr/bin/java", pid: 1700, ports: [8101],
      commandLine: "java -jar app.jar --server.port=8101",
    });
    expect(parsePortQuery("810")).toBe(810);
    expect(rowMatchesQuery(java, "810")).toBe(false);
    expect(rowMatchesQuery(java, ":810")).toBe(false);
  });

  test("普通名字搜索仍可用，空 query 全通过", () => {
    const java = row({
      name: "diteng-im-server", path: "/usr/bin/java", pid: 1700, ports: [8101],
      commandLine: "java -jar diteng-im-server-202409.01.jar --server.port=8101",
    });
    expect(rowMatchesQuery(java, "")).toBe(true);
    expect(rowMatchesQuery(java, "diteng")).toBe(true);
    expect(rowMatchesQuery(java, "java")).toBe(true);
    expect(rowMatchesQuery(java, "chrome")).toBe(false);
    expect(parsePortQuery("0")).toBeNull();
    expect(parsePortQuery("65536")).toBeNull();
    expect(parsePortQuery("java")).toBeNull();
  });
});

describe("指标格式化", () => {
  test("内存单位边界稳定", () => {
    expect(fmtMem(1023.6)).toBe("1024 MB");
    expect(fmtMem(1024)).toBe("1.00 GB");
  });

  test("CPU 固定一位小数", () => {
    expect(fmtCpu(3)).toBe("3.0%");
  });

  test("网络速率区分真实 0 与未知", () => {
    expect(fmtRate(0)).toBe("0 B/s");
    expect(fmtRate(1536)).toBe("1.5 KB/s");
    expect(fmtRate(2 * 1024 * 1024)).toBe("2.0 MB/s");
    expect(fmtRate(Number.NaN)).toBe("—");
  });
});

describe("列表交互纯逻辑", () => {
  test("默认无选中，方向键首次进入首项或末项", () => {
    expect(moveSelection(-1, 1, 3)).toBe(0);
    expect(moveSelection(-1, -1, 3)).toBe(2);
    expect(moveSelection(-1, 1, 0)).toBe(-1);
  });

  test("选择不会越过列表边界", () => {
    expect(moveSelection(2, 1, 3)).toBe(2);
    expect(moveSelection(0, -1, 3)).toBe(0);
  });

  test("数值列默认可按降序排列，名称可按升序排列", () => {
    const rows = [row({ id: "a", name: "Beta", mem: 20 }), row({ id: "b", name: "Alpha", mem: 40 })];
    expect(sortProcessRows(rows, "mem", "desc").map((item) => item.id)).toEqual(["b", "a"]);
    expect(sortProcessRows(rows, "name", "asc").map((item) => item.id)).toEqual(["b", "a"]);
  });

  test("排序和轮询重排不会让选择漂移到另一进程", () => {
    const alpha = row({ id: "alpha", snapshotToken: "snapshot-a", mem: 10 });
    const beta = row({ id: "beta", snapshotToken: "snapshot-b", mem: 20 });
    const selected = processSelectionKey(alpha);
    const reordered = sortProcessRows([alpha, beta], "mem", "desc");
    expect(reconcileSelectionKey(selected, reordered)).toBe(selected);
    expect(reordered.find((item) => processSelectionKey(item) === selected)?.id).toBe("alpha");
    expect(reconcileSelectionKey(selected, reordered.filter((item) => item.id === "alpha"))).toBe(selected);
  });

  test("选中组消失时按原索引附近回退", () => {
    const selected = processSelectionKey(row({ id: "alpha", snapshotToken: "old" }));
    expect(reconcileSelectionKey(selected, [row({ id: "beta", snapshotToken: "b" })])).toBe(processSelectionKey(row({ id: "beta", snapshotToken: "b" })));
    const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    expect(reconcileSelectionKey("missing", rows, 2)).toBe(processSelectionKey(rows[2]));
    expect(reconcileSelectionKey("missing", rows, 9)).toBe(processSelectionKey(rows[2]));
    expect(reconcileSelectionKey("missing", [], 0)).toBeNull();
  });

  test("端口只显示数字，空列表不占位", () => {
    expect(formatListenPorts([5173, 24678])).toBe("5173 24678");
    expect(formatListenPorts([])).toBe("");
  });

  test("Enter 只从列表或开发搜索框直接结束，交互控件不误触", () => {
    expect(shouldTriggerKill("Enter", "list")).toBe(true);
    expect(shouldTriggerKill("Enter", "search")).toBe(true);
    expect(shouldTriggerKill("Enter", "interactive")).toBe(false);
    expect(shouldTriggerKill(" ", "list")).toBe(false);
  });

  test("选中行越过中线才滚动，并在上下边界 clamp", () => {
    const base = { scrollTop: 0, clientHeight: 200, scrollHeight: 1000, rowHeight: 44 };
    expect(centeredSelectionScroll({ ...base, rowTop: 44, direction: 1 })).toBe(0);
    expect(centeredSelectionScroll({ ...base, rowTop: 132, direction: 1 })).toBe(54);
    expect(centeredSelectionScroll({ ...base, scrollTop: 300, rowTop: 320, direction: -1 })).toBe(242);
    expect(centeredSelectionScroll({ ...base, scrollTop: 800, rowTop: 990, direction: 1 })).toBe(800);
    expect(centeredSelectionScroll({ ...base, scrollTop: 20, rowTop: 0, direction: -1 })).toBe(0);
  });

  test("交互控件和可编辑目标不参与列表全局快捷键", () => {
    for (const tag of ["input", "textarea", "select", "button", "a"]) {
      expect(isInteractiveKeyboardTag(tag)).toBe(true);
    }
    expect(isInteractiveKeyboardTag("div", true)).toBe(true);
    expect(isInteractiveKeyboardTag("div", false)).toBe(false);
  });

  test("搜索框仅将 Esc 和上下键交给列表", () => {
    expect(searchInputKeyAction("Escape")).toBe("clear");
    expect(searchInputKeyAction("ArrowDown")).toBe("navigate");
    expect(searchInputKeyAction("ArrowUp")).toBe("navigate");
    expect(searchInputKeyAction("ArrowLeft")).toBe("native");
    expect(searchInputKeyAction("ArrowRight")).toBe("native");
    expect(searchInputKeyAction("a")).toBe("native");
  });
});
