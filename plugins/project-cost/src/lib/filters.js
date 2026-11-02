/**
 * 筛选口径的**唯一真源**。
 *
 * 视图（列表页）与导出（按当前筛选导出）都只能调这里的 `filterProjects`：
 * 两边各写一套是「三张表数字对不上」的根因，靠「只有一套」来结构性消灭它。
 *
 * 这里的过滤条件逐字搬自 v1.1.0 `ItemsView.vue` 的 `rows` computed（字段集合、比较方式、
 * 大小写处理完全一致），不做"优化"，以免与既有行为产生差异。
 *
 * v1.7 B1：搜索的**字段覆盖**从「费用项 5 个字段」扩到「+ 明细 4 个字段」，并额外产出「命中提示」。
 * 为避免出现第二套 haystack，扩字段这件事只在这里做一次：
 * `filterProjectsWithHits()` 是唯一实现，`filterProjects()` 退化成它的薄包装（只取 rows）。
 * 导出路径继续走 `filterProjects`，行为与 v1.6 完全一致（多出来的只是「命中提示」，不影响行集合）。
 */
import { round2, statusOf, payableOf, dueOf } from './core';

/**
 * 参与搜索的**费用项自身**字段（5 个）。
 * 刻意不含金额（`total / discount / amount`）与付款编号 `pid`：
 *  - 金额是数字，「搜索 2000」把 2000 / 12000 / 200.05 一起搜出来不是用户要的；
 *  - `pid` 是内部唯一键，用户不会拿它找人，命中反而制造噪音。
 */
const ROW_FIELDS = ['remark', 'object', 'cat', 'no', 'date'];

/** 参与搜索的**明细**字段（4 个）。`name` 是命中提示的信息源，其余三个只让行命中。 */
const DETAIL_FIELDS = ['name', 'unit', 'craft', 'note'];

/** 命中提示的长度纪律：品名 > 12 字截成 11 + `…`；整段 ≤ 24 字。 */
const HIT_NAME_MAX = 12;
const HIT_TEXT_MAX = 24;

/** 把品名压到 `max` 字以内（超出用省略号；`max` 含省略号位） */
const shortName = (s, max = HIT_NAME_MAX) => {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** 整段提示兜底截断（`命中：xxx ×999` 这类极端长度不会撑破行宽） */
const clampText = (s, max = HIT_TEXT_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * 只做「非关键词」条件（品类 / 状态 / 日期区间），与 v1.6 逐条一致。
 * @param {object} p 费用项
 * @param {object} f 筛选条件
 * @returns {boolean} 是否通过
 */
function passNonQuery(p, f) {
  if (f.cat && p.cat !== f.cat) return false;
  if (f.status && statusOf(p) !== f.status) return false;
  if (f.from && (p.date || '') < f.from) return false;
  if (f.to && (p.date || '') > f.to) return false;
  return true;
}

/**
 * 扫描某费用项的明细命中情况。
 * @param {object} p 费用项
 * @param {string} q 已小写化的关键词
 * @returns {{any: boolean, byName: Map<string, {count: number, amount: number}>}}
 *   `any` = 有任一明细命中；
 *   `byName` 只统计**品名命中**的明细（单位/工艺/备注命中不进这里，见下方注释）
 */
function scanDetails(p, q) {
  const byName = new Map();
  let any = false;
  (p?.details || []).forEach((d) => {
    const name = String(d.name || '').trim();
    const nameHit = name.toLowerCase().includes(q);
    // 其余三个字段任一命中即算「这条明细命中」，但**不产生提示**：
    // 基线里 158 条明细的单位是「个」，若单位命中就出提示，搜「个」会满屏「命中：个 ×3」。
    const otherHit = DETAIL_FIELDS.slice(1).some((k) => String(d[k] || '').toLowerCase().includes(q));
    if (!nameHit && !otherHit) return;
    any = true;
    if (!nameHit) return;
    const cur = byName.get(name) || { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount = round2(cur.amount + (+d.amount || 0));
    byName.set(name, cur);
  });
  return { any, byName };
}

/**
 * 命中提示文案。没有可展示的品名命中时返回空串（该行仍然算命中，只是不显示提示）。
 *   单个品名：`命中：砂子 ×2`（×2 = 该品名命中的明细条数）
 *   多个品名：`命中：砂子 等 3 种`（领头的是**金额最大**的那个品名 —— 用户最可能想找的是它）
 * @param {Map<string, {count: number, amount: number}>} byName 品名 → 命中统计
 * @returns {string} 提示文案（空串 = 不显示提示）
 */
export function hitHint(byName) {
  const list = [...(byName || new Map()).entries()];
  if (!list.length) return '';
  if (list.length === 1) {
    const [name, meta] = list[0];
    return clampText(`命中：${shortName(name)} ×${meta.count}`);
  }
  const sorted = list.slice().sort((a, b) => b[1].amount - a[1].amount);
  return clampText(`命中：${shortName(sorted[0][0])} 等 ${list.length} 种`);
}

/**
 * 带命中信息的筛选（B1）。
 *
 * @param {Array} projects 费用项数组
 * @param {{query?: string, cat?: string, status?: string, from?: string, to?: string}} f 筛选条件
 * @returns {{rows: Array, hits: Map<string, {text: string, name: string}>}}
 *   `rows`：命中的费用项（新数组，不改入参）；
 *   `hits`：`费用项 id → { text, name }`；`text` 是行内提示文案，`name` 是点提示时要定位的品名
 *           （只命中单位/工艺/备注的行走不到这里，所以 `name` 恒非空）。
 */
export function filterProjectsWithHits(projects, f = {}) {
  const q = (f.query || '').trim().toLowerCase();
  const base = (projects || []).filter((p) => passNonQuery(p, f));
  if (!q) return { rows: base, hits: new Map(), fieldHits: new Map() };

  const rows = [];
  const hits = new Map();
  const fieldHits = new Map();
  base.forEach((p) => {
    const ownFields = {};
    ROW_FIELDS.forEach((k) => {
      if (String(p[k] || '').toLowerCase().includes(q)) ownFields[k] = true;
    });
    const ownHit = Object.keys(ownFields).length > 0;
    const detail = scanDetails(p, q);
    if (!ownHit && !detail.any) return;
    rows.push(p);
    // K8 字段级命中：与 `hits` 解耦——单位/工艺/备注等无品名命中的行也会记到这里，供行内高亮使用。
    // 不改动 `hits` 结构，避免破坏既有「命中提示」行为（verify-v17 B1）。
    fieldHits.set(p.id, { ...ownFields, detail: detail.any });
    const text = hitHint(detail.byName);
    if (text) {
      const names = [...detail.byName.entries()];
      // 与 hitHint 同一套「取金额最大的品名」规则，保证「提示里写的」就是「点进去定位的」
      const pick = names.length === 1
        ? names[0][0]
        : names.slice().sort((a, b) => b[1].amount - a[1].amount)[0][0];
      hits.set(p.id, { text, name: pick });
    }
  });
  return { rows, hits, fieldHits };
}

/**
 * @param {Array} projects 费用项数组
 * @param {{query?: string, cat?: string, status?: string, from?: string, to?: string}} f 筛选条件
 * @returns {Array} 命中的费用项（新数组，不改入参）
 */
export function filterProjects(projects, f = {}) {
  return filterProjectsWithHits(projects, f).rows;
}

/**
 * 列表排序（K8）。唯一真源，列表页直接调用，自测可复用。
 * 各档口径与 v1.7 既有三档完全一致，并新增 待付 / 到期日 / 收款方 三档：
 *   date    按下单日期降序（同日期按项目号降序兜底）—— 与 v1.6/1.7 默认档一致
 *   no      按项目号升序
 *   amount  按应付降序
 *   due     按待付降序（K8 验收：首行 = 待付最大的费用项）
 *   duedate 按到期日升序
 *   payee   按收款方（支付对象）升序
 * @param {Array} list 费用项数组
 * @param {string} sortKey 见上
 * @returns {Array} 新数组（不改入参）
 */
export function sortProjects(list, sortKey = 'date') {
  const arr = (list || []).slice();
  arr.sort((a, b) => {
    if (sortKey === 'amount') return payableOf(b) - payableOf(a);
    if (sortKey === 'due') return dueOf(b) - dueOf(a);
    if (sortKey === 'duedate') return (a.due || '').localeCompare(b.due || '');
    if (sortKey === 'payee') return (a.object || '').localeCompare(b.object || '');
    if (sortKey === 'no') return (b.no || '').localeCompare(a.no || '');
    return (b.date || '').localeCompare(a.date || '') || (b.no || '').localeCompare(a.no || '');
  });
  return arr;
}

/** 是否存在任一筛选条件（决定「导出」还是「导出筛选」） */
export function hasFilter(f = {}) {
  return !!(f.query?.trim() || f.cat || f.status || f.from || f.to);
}

export const FILTER_TEXT = { unpaid: '未付', part: '部分付', paid: '已付' };

/**
 * 生成文件名摘要，例如 `未付_防水工程_3-6月`。
 * 空筛选返回 ''（不往文件名里加空段）。
 */
export function filterTag(f = {}) {
  const parts = [];
  if (f.status) parts.push(FILTER_TEXT[f.status] || f.status);
  if (f.cat) parts.push(f.cat);
  if (f.from || f.to) {
    if (f.from && f.to && f.from.slice(0, 4) === f.to.slice(0, 4)) {
      parts.push(`${+f.from.slice(5, 7)}-${+f.to.slice(5, 7)}月`);
    } else if (f.from && f.to) {
      parts.push(`${f.from}_${f.to}`);
    } else if (f.from) {
      parts.push(`${f.from}起`);
    } else {
      parts.push(`至${f.to}`);
    }
  }
  if (f.query?.trim()) parts.push(`含${f.query.trim()}`);
  return parts.join('_').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 40);
}
