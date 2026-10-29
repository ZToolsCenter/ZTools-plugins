import { reactive, readonly } from 'vue';

/** 全局 UI 状态：当前分区、抽屉、搜索与筛选、选中项 */
export const ui = reactive({
  tab: 'overview',
  drawer: null,          // { type, id?, name?, mode? }
  query: '',
  filterStatus: '',
  filterCat: '',
  filterDateFrom: '',
  filterDateTo: '',
  selId: '',             // 列表键盘选中项
  selectedIds: [],       // R5：多选态（与导航 selId 解耦，内存态不进主键）
  bookMenu: false,
  payFilter: '',
  analysisTab: 'cat',
});

export const TABS = [
  { key: 'overview', label: '概览' },
  { key: 'items', label: '费用项' },
  { key: 'pay', label: '付款' },
  { key: 'budget', label: '预算' },
  { key: 'analysis', label: '分析' },
  { key: 'settings', label: '设置' },
];

export function go(tab) {
  if (!TABS.some((t) => t.key === tab)) return;
  ui.tab = tab;
  ui.drawer = null;
  ui.selId = '';
}

/**
 * 清空列表页全部筛选条件（状态 / 品类 / 关键词 / 日期区间）。
 * Esc 一次清干净；`filters.js` 的 `hasFilter()` 与本函数覆盖同一组字段。
 */
export function clearListFilters() {
  ui.query = '';
  ui.filterStatus = '';
  ui.filterCat = '';
  ui.filterDateFrom = '';
  ui.filterDateTo = '';
}

export function openDrawer(payload) {
  ui.drawer = payload;
}

export function closeDrawer() {
  ui.drawer = null;
}

/* ---------------- Toast ---------------- */
let seq = 0;
export const toasts = reactive([]);

export function toast(msg, opts = {}) {
  const id = ++seq;
  const item = { id, msg, undo: !!opts.undo };
  toasts.push(item);
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, opts.duration || (opts.undo ? 5200 : 2200));
  return id;
}

export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

/** 统一的「执行 + 提示」出口，避免各视图重复写 */
export function run(result, opts = {}) {
  if (!result) return false;
  if (result.ok === false) {
    toast(result.msg || '操作失败');
    return false;
  }
  if (result.msg) toast(result.msg, opts);
  return true;
}

export const uiReadonly = readonly(ui);
