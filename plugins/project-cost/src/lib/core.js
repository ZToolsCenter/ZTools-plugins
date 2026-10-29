/**
 * 纯业务逻辑：金额链、汇总、预警、现金流。
 * 金额链（与网页版一致，唯一真源是明细）：
 *   明细金额合计 → 项目总计 → 应付(=总计−优惠) → 已付(=Σ付款) → 待付(=应付−已付)
 */

export const PALETTE = [
  '#A8624C', '#D9A566', '#5B7553', '#4C7B8A', '#C25B6B', '#8A6FB0',
  '#7A9E9F', '#B0A08C', '#C8743B', '#6B8E9E', '#9E7B5B', '#7E9E6B',
  '#A85B7E', '#5B8EA8', '#B0915B', '#8C8C8C',
];

export const SUBS = ['材料费', '人工费', '包工包料', '其他'];
export const SUB_COLOR = {
  材料费: '#A8624C',
  人工费: '#5B7553',
  包工包料: '#D9A566',
  其他: '#8A6FB0',
};

export const round2 = (n) => Math.round((+n || 0) * 100) / 100;

/**
 * S05（v1.7）：明细合计 与「总计」的**对账容差**（半分钱）。
 *
 * 用途：抽屉里「明细合计与总计相差 X」这条提示只在真不一致时才该出现。
 * 判据是「差 > 容差」（而不是 v1.6 的 `Math.abs(diff) < 0.5` 才显示 ✓）——
 * 前者在一致时**什么都不渲染**，后者会多出一句和「合计」重复的话，让用户误以为有两个数。
 * 与 `checkup()` 的 `CHECK_TOL` 同为 0.005，保证「抽屉说一致」与「体检说没问题」不会打架。
 */
export const TOTAL_DRIFT_TOL = 0.005;

/**
 * K10（v1.8.2）**全站唯一金额精度**：元 + 千分位 + 2 位小数，不再有任何第二精度。
 *
 * 三个出口（本文件是它们的唯一实现），全站金额文本只允许经此三者产出：
 *   · `fmt`    —— 带 ¥ 与符号（`¥246,055.97` / `-¥394.88`）；
 *   · `fmtNum` —— 无 ¥、带符号（`246,055.97` / `-394.88`）；
 *   · `fmtAbs` —— 无 ¥、取绝对值（方向已由文字 / `+` 前缀 / 颜色表达的位置）。
 *
 * 共同纪律：一律先 `round2(n) || 0` 再判符号 / 走 `toLocaleString`。
 *   · `round2(-0.001) === -0`，而 `-0 < 0 === false` → `fmt(-0.001) === '¥0.00'`（修掉 `-¥0.00`）；
 *   · `(-0).toLocaleString('zh-CN', …)` 会返回 `'-0.00'`，故 `|| 0` 把 `-0` 归一为 `0` 是必须的；
 *   · `n` 为 `undefined / null / '' / 'abc'` 时 `+n || 0` → `0`，输出 `¥0.00 / 0.00`，不抛错。
 *
 * 负号形态固定为 `-¥394.88`（符号在币种之前），**禁止** `¥-394.88`。
 *
 * ★ 万位出口已删除：v1.7 曾另有第二个金额出口（≥1 万时变 `¥24.6 万`）作为「窄位白名单」第二精度，
 *   v1.8.2 起**彻底废除**——同一笔 8,000 在不同视图里长得必须一样，窄位宁可溢出/缩字号也不换单位。
 *   新增任何「万位 / 缩写金额」出口都视为回退，会被 `scripts/verify-k-ui.mjs` 的源码级反向钉拦下
 *   （该钉子连注释里出现这个出口名都不放过，故本文件通篇不再提它的标识符）。
 */
export const fmt = (n) => {
  const v = round2(n) || 0;
  return (v < 0 ? '-¥' : '¥') +
    Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * 无 ¥、**带符号**的千分位数字，用于列表主数字。
 * A1 的核心变更：v1.6 及以前是「取绝对值」，导致 63 条负数明细在屏幕上伪装成正数；
 * v1.7 起改为「保留符号」（`-394.88`），方向不再丢失。
 * K10（v1.8.2）：与 `fmt` 同为全站唯一精度（元 + 千分位 + 2 位小数），不存在万位变体。
 */
export const fmtNum = (n) => {
  const v = round2(n) || 0;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * 无 ¥、**取绝对值**的千分位数字。
 * 只给「文字 / 显式 `+` 前缀 / 颜色 已经表达方向」的位置用（共 12 处，清单见设计文档 §2.2），
 * 否则会出现 `余 -1,234`、`超 -800`、`多付 -300`、`+-800` 这类双信号。
 * K10（v1.8.2）：与 `fmt` 同为全站唯一精度（元 + 千分位 + 2 位小数），不存在万位变体。
 */
export const fmtAbs = (n) => {
  const v = round2(n) || 0;
  return Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * K10（v1.8.2）环形图中心金额的字号档位：按「字符数 × 环径」分档，
 * 保证文字外接框**不压到色环**上（万位出口废除后中心值变长，必须缩字号而不是换单位）。
 *
 * 判据与实测标定（headless Chrome / PingFang SC）：文字基线固定在 `y = cx + 11`，
 * 内圈半径 = `size / 2 − 9 − 5.5`（环心半径 `size/2 − 9`，描边 11 宽），
 * 取「文字外接框下缘角落到圆心的距离 < 内圈半径」为通过：
 *
 *   size=112（内圈半径 41.5）
 *     ≤8  字符 → 13.5（更长的 `¥8,000.00` 在 13.5 下角落也仅 38.87 ✓，故该档安全）
 *     ≤11 字符 → 11   （`¥8,000.00` 32.97 · `¥57,526.86` 35.41 · `¥246,055.97` 39.19 ✓）
 *     ≤13 字符 → 10   （`-¥246,055.97` 38.65 · `¥1,234,567.89` 40.49 ✓）
 *     >13 字符 → 9    （`-¥1,234,567.89` 39.40 ✓）
 *   对照组：若沿用旧两档（>8 → 11），`-¥246,055.97` 角落 41.76 会压环、`¥1,234,567.89` 43.78 更糟。
 *
 *   size=96（内圈半径仅 33.5，概览两枚小环）
 *     ≤8  字符 → 13.5（`77%` / `—` 这类短文本保持观感不变）
 *     >8  字符 → 9    （长金额才降档；该分支当前不触发，但由 `verify-k-ui.mjs` 逐档钉住）
 *
 * @param {number} len  中心值文本的字符数
 * @param {number} size 环形图边长（px），如 112 / 96
 * @param {number} [min] 字号下限（默认 9，K10 既有口径）。K16 大字档传 12，
 *   让中心值至少 12px —— 极端长金额（≥12 字符的负数百万位）在 12px 下可能轻微触环，
 *   属大字档「可读性优先」的既定取舍（完整值仍可看图例与 title）。
 * @returns {number} 字号（px）
 */
export function donutValSize(len, size, min = 9) {
  const n = +len || 0;
  let fs = 13.5;
  if (n > 13) fs = 9;
  else if (n > 11) fs = 10;
  else if (n > 8) fs = 11;
  if (size < 104 && n > 8) fs = 9;
  return Math.max(fs, +min || 9);
}

export const pct = (a, b) => (b > 0 ? (a / b) * 100 : 0);

/* ---------------- 日期 ---------------- */
export function normDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(s, n) {
  if (!s) return '';
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function daysBetween(a, b) {
  if (!a || !b) return NaN;
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return NaN;
  return Math.round((db - da) / 86400000);
}
/** M3：未填到期日时的默认推算天数（可在设置页按项目改，工时口径不同：7 天结 / 月结 45 天） */
export const DEFAULT_DUE_DAYS = 30;
const clampDays = (n) => {
  const v = Math.round(+n || 0);
  return v > 0 ? Math.min(365, Math.max(1, v)) : DEFAULT_DUE_DAYS;
};
/** 从账本取「到期日推算天数」，非法值一律回落 30 */
export const bookDueDays = (book) => clampDays(book?.dueDays);

/**
 * 到期日生效规则：优先「到期日」，否则「下单日 + dueDays 天」。
 * dueDays 由调用方从 `bookDueDays(book)` 传入；缺省 30，保持与历史行为一致。
 */
export function effectiveDue(p, dueDays = DEFAULT_DUE_DAYS) {
  return p?.due ? normDate(p.due) : addDays(normDate(p?.date), clampDays(dueDays));
}

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------------- 单条金额 ---------------- */
export const detailSum = (p) => (p?.details || []).reduce((s, d) => s + (+d.amount || 0), 0);

/** 有明细时总计恒等于明细合计（明细为唯一真源） */
export function projectTotal(p) {
  if (!p) return 0;
  return p.details && p.details.length ? round2(detailSum(p)) : round2(p.total);
}
export function syncTotalFromDetails(p) {
  if (p && p.details && p.details.length) p.total = round2(detailSum(p));
}
export const payableOf = (p) => round2(projectTotal(p) - (+p.discount || 0));
/**
 * C5：**有效付款** = 未作废的付款。作废（`void === true`）只是留痕，不再计入已付。
 * 这是全站唯一一处「把 void 过滤掉」的地方 —— 其余函数一律经 `paidOf` / `activePayments`
 * 取数，避免各页各算一套口径。
 */
export const activePayments = (p) => (p?.payments || []).filter((x) => !x.void);
export const voidPayments = (p) => (p?.payments || []).filter((x) => !!x.void);
export const paidOf = (p) => round2(activePayments(p).reduce((s, x) => s + (+x.amount || 0), 0));
export const dueOf = (p) => round2(payableOf(p) - paidOf(p));

/* ---------------- B1 双口径（v1.3） ----------------
 * 预估明细（d.est === '是'）金额计入「应付」（真源），但同时派生「确定应付 = 应付 − 预估合计」，
 * 仅用于预算预警 / 占用率 / 概览小字展示。**绝不**写回任何真源字段、绝不替换导出/待付里的应付。
 */
/** 某费用项的预估合计：Σ(est==='是' 的明细金额) */
export const estAmountOf = (p) =>
  round2((p?.details || []).reduce((s, d) => s + (d.est === '是' ? (+d.amount || 0) : 0), 0));
/** 某费用项的确定应付 = 应付 − 预估合计（B1 派生量，无副作用） */
export const confirmedPayableOf = (p) => round2(payableOf(p) - estAmountOf(p));

export function statusOf(p) {
  const py = payableOf(p);
  const pd = paidOf(p);
  const d = py - pd;
  if (py <= 0) return 'none';
  if (pd <= 0) return 'unpaid';
  if (d <= 0) return 'paid';
  return 'part';
}
export const STATUS_TEXT = { paid: '已付', part: '部分付', none: '无应付', unpaid: '未付' };
export const statusText = (s) => STATUS_TEXT[s] || '未付';

/** 一次性取出派生值，供列表/抽屉复用，避免重复计算 */
export function statOf(p) {
  const total = projectTotal(p);
  const payable = round2(total - (+p.discount || 0));
  const paid = paidOf(p);
  const due = round2(payable - paid);
  let status = 'unpaid';
  if (payable <= 0) status = 'none';
  else if (paid <= 0) status = 'unpaid';
  else if (due <= 0) status = 'paid';
  else status = 'part';
  return { total, payable, paid, due, status, statusText: STATUS_TEXT[status] };
}

/* ---------------- 账套汇总 ---------------- */
export function calc(book) {
  const projects = book?.projects || [];
  const budget = book?.budget || {};
  let payable = 0;
  let paid = 0;
  let estTotal = 0; // B1 派生：预估合计 = Σ 各费用项预估合计
  const byCat = {};
  const byPayee = {};
  const bySub = { 材料费: 0, 人工费: 0, 包工包料: 0, 其他: 0 };

  projects.forEach((p) => {
    const py = payableOf(p);
    const pd = paidOf(p);
    const est = estAmountOf(p); // B1 派生：该费用项预估合计
    payable += py;
    paid += pd;
    estTotal += est;
    const ck = p.cat || '未分类';
    byCat[ck] = byCat[ck] || { budget: 0, amount: 0, paid: 0, count: 0, confirmed: 0, est: 0 };
    byCat[ck].amount += py;
    // B1 双口径：占用率/预警按「确定应付」计（与 catBudgetHint 同口径，详见下方注释）
    byCat[ck].confirmed += confirmedPayableOf(p);
    byCat[ck].est += est;
    byCat[ck].paid += pd;
    byCat[ck].count += 1;
    const pk = p.object || '未指定';
    byPayee[pk] = byPayee[pk] || { amount: 0, paid: 0, count: 0 };
    byPayee[pk].amount += py;
    byPayee[pk].paid += pd;
    byPayee[pk].count += 1;
    const sk = p.sub || '其他';
    bySub[sk] = (bySub[sk] || 0) + py;
  });

  Object.keys(budget).forEach((c) => {
    // 只有预算、没有支出记录的品类也要补齐 confirmed/est，否则下游拿到 undefined
    byCat[c] = byCat[c] || { budget: 0, amount: 0, paid: 0, count: 0, confirmed: 0, est: 0 };
    byCat[c].budget = +budget[c] || 0;
  });

  const totalBudget = Object.values(budget).reduce((a, b) => a + (+b || 0), 0);
  // B1 双口径：超支品类数按「确定应付」计，与 buildAlerts / catRows.rate 同口径
  const overCount = Object.keys(byCat)
    .filter((k) => byCat[k].budget > 0 && (byCat[k].confirmed || 0) > byCat[k].budget).length;

  return {
    payable: round2(payable),
    paid: round2(paid),
    remain: round2(payable - paid),
    balance: round2(totalBudget - payable),
    totalBudget: round2(totalBudget),
    // B1 派生（不写回真源，仅用于预警/占用率/概览小字）：确定应付 = 应付 − 预估合计
    estTotal: round2(estTotal),
    confirmedPayable: round2(payable - estTotal),
    byCat,
    byPayee,
    bySub,
    count: projects.length,
    detailCount: projects.reduce((s, p) => s + (p.details || []).length, 0),
    payCount: projects.reduce((s, p) => s + activePayments(p).length, 0),
    // C5：作废笔数单独计数（不进金额链，只用于界面提示「含作废 N 笔」）
    voidCount: projects.reduce((s, p) => s + voidPayments(p).length, 0),
    overCount,
    payRate: payable > 0 ? (paid / payable) * 100 : 0,
  };
}

/* ---------------- 预算合计（派生缓存） ---------------- */
/**
 * 品类预算加总。真源永远是 `book.budget`，本函数只做求和。
 * 与 `calc().totalBudget` 口径一致（同一份 `book.budget`），因此恒等。
 */
export const sumBudget = (book) =>
  round2(Object.values(book?.budget || {}).reduce((a, b) => a + (+b || 0), 0));

/**
 * 把 Σ 品类预算回写到 `book.totalBudget`。
 * 该字段是**派生缓存**（历史上无读取方），回写只是让它不再长期漂移；
 * 不构成第二真源：任何时刻都能从 `book.budget` 重建。
 */
export function syncTotalBudget(book) {
  if (book) book.totalBudget = sumBudget(book);
  return book?.totalBudget || 0;
}

/** 品类行：预算 / 应付 / 已付 / 差额 / 关联数 */
export function catRows(book) {
  const c = calc(book);
  const cats = book?.categories || [];
  const names = [...new Set([...cats.map((x) => x.name), ...Object.keys(book?.budget || {})])];
  return names.map((name) => {
    const meta = cats.find((x) => x.name === name);
    const st = c.byCat[name] || { budget: 0, amount: 0, paid: 0, count: 0, confirmed: 0, est: 0 };
    const budget = st.budget || 0;
    // B1 双口径：占用率与差额按「确定应付」(confirmed) 计，与 catBudgetHint / buildAlerts 同口径
    return {
      name,
      color: meta?.color || '#B0A08C',
      note: meta?.note || '',
      budget,
      amount: round2(st.amount),
      confirmed: round2(st.confirmed),
      est: round2(st.est),
      paid: round2(st.paid),
      count: st.count || 0,
      diff: budget > 0 ? round2(budget - st.confirmed) : null,
      rate: budget > 0 ? (st.confirmed / budget) * 100 : null,
    };
  }).sort((a, b) => (b.amount || 0) - (a.amount || 0));
}

/**
 * A2（v1.7）：统一的「该品类有没有设预算」判定 —— 全站只此一套语义。
 *
 * 语义：**有该键**且 **金额 > 0** 才算「已设预算」。
 *   · 缺键（从未填过）与显式 `0`（用户清空）同属「未设预算」；
 *   · 负数预算视为非法输入，同样按「未设预算」处理。
 *
 * 用 `Object.prototype.hasOwnProperty.call` 而非 `Object.hasOwn`：与 `cashflow()` 内既有写法一致，
 * 也不必担心构建 target 的兼容性。
 *
 * @param {object} book 账套
 * @param {string} name 品类名
 * @returns {boolean} 是否已设预算
 */
export function hasBudget(book, name) {
  const b = book?.budget || {};
  return Object.prototype.hasOwnProperty.call(b, name) && +b[name] > 0;
}

/**
 * A2（v1.7）：品类覆盖情况 —— 「N 个品类 · M 个已设预算」文案的**唯一来源**。
 *
 * 概览页、预算页汇总行、分析页「预算 vs 实际」标题三处都必须调它，
 * 禁止任何视图再写 `Object.keys(book.budget).length`（那是「13 个品类」这个错数的来源）。
 *
 * 刻意不调 `calc()`：报表要的是「有哪些品类、其中几个有预算」，不涉及金额，
 * 放进 computed 里也不必跑 71 项 × 384 明细。
 *
 * 绝对纪律：本函数**只读**，不补键、不写 0（`Object.keys(book.budget).length` 必须仍为 13）。
 *
 * @param {object} book 账套
 * @returns {{total: number, withBudget: number, missing: number, text: string}}
 *   基线：`{ total: 14, withBudget: 13, missing: 1, text: '14 个品类 · 13 个已设预算' }`
 */
export function catCoverage(book) {
  const names = [...new Set([
    ...((book?.categories || []).map((x) => x.name)),
    ...Object.keys(book?.budget || {}),
  ])];
  const withBudget = names.filter((n) => hasBudget(book, n)).length;
  return {
    total: names.length,
    withBudget,
    missing: names.length - withBudget,
    text: `${names.length} 个品类 · ${withBudget} 个已设预算`,
  };
}

/**
 * A2（v1.7）：预算页 / 概览页共用的两类分组。
 *
 *   · `over`     —— 有预算且确定应付 > 预算，按**超出额降序**（首屏先看最超的）；
 *   · `noBudget` —— 未设预算且确定应付 > 0（有钱花出去但没法比），按确定应付降序。
 *
 * 口径说明：`confirmed` 是「确定应付 = 应付 − 预估合计」（B1 双口径），
 * 与 `catRows().rate/diff`、`buildAlerts`、`catBudgetHint` 完全同口径 —— 勾了「预估」的明细
 * 不该把品类顶成超支。真源「应付」（`amount`）保持不变，仅作展示。
 *
 * 复用 `catRows()` 构造行集合，不另造一套品类名单（避免「预算页有 14 行、这里 13 行」）。
 * 只读，不 mutate。
 *
 * @param {object} book 账套
 * @returns {{over: {rows: Array, count: number, sum: number}, noBudget: {rows: Array, count: number, sum: number}}}
 *   基线：`over.count = 6, over.sum = 12266.75`；`noBudget.count = 1, noBudget.sum = 9514.00`
 */
export function overCatGroups(book) {
  const rows = catRows(book);
  const over = rows
    .filter((r) => r.budget > 0 && r.confirmed > r.budget)
    .map((r) => ({ ...r, over: round2(r.confirmed - r.budget) }))
    .sort((a, b) => b.over - a.over || b.confirmed - a.confirmed);
  const noBudget = rows
    .filter((r) => !(r.budget > 0) && r.confirmed > 0)
    .sort((a, b) => b.confirmed - a.confirmed);
  const sumOf = (arr, key) => round2(arr.reduce((s, x) => s + (+x[key] || 0), 0));
  return {
    over: { rows: over, count: over.length, sum: sumOf(over, 'over') },
    noBudget: { rows: noBudget, count: noBudget.length, sum: sumOf(noBudget, 'confirmed') },
  };
}

/**
 * 单品类预算提示（抽屉内实时剩余）。
 * 口径与 `calc().byCat` 严格一致：**B1 双口径下 `used` 按「确定应付」(`confirmedPayableOf`) 计**，
 * 即预算占用率/预警按确定应付，不含预估明细金额；真源「应付」保持不变（详见设计红线）。
 *
 * 刻意不复用 `catRows()`：那条路径要跑全量 `calc()`（71 项 × 384 明细）+ 排序 + 构造 14 行，
 * 放进「每敲一个数字就重算」的 computed 里没必要。
 *
 * @param {object} book 账套
 * @param {string} catName 品类名
 * @param {number|string} amount 本笔「确定应付」金额（调用方先自行 `(total − discount) − estAmountOf(project)`）
 * @param {string} excludeId 编辑既有费用项时传其 id，把自身从「已用」里排除
 * @returns {{state: string, budget: number, used: number, remain: number, after: number, over: number}}
 *   state: 'ok' | 'near' | 'over' | 'no-cat' | 'no-budget'
 */
export function catBudgetHint(book, catName, amount, excludeId = '') {
  const budget = round2(+((book?.budget || {})[catName]) || 0);
  let used = 0;
  (book?.projects || []).forEach((p) => {
    if (p.cat !== catName) return;
    if (excludeId && p.id === excludeId) return; // 编辑既有费用项时排除自身，否则会算两遍
    used += confirmedPayableOf(p); // B1 双口径：与 calc().byCat[k].confirmed 同口径（确定应付）
  });
  used = round2(used);
  const after = round2(used + (+amount || 0));
  const remain = round2(budget - used);
  const over = round2(Math.max(after - budget, 0));
  const thr = book?.warnThreshold || 0.8;
  let state = 'ok';
  if (!catName) state = 'no-cat';
  else if (budget <= 0) state = 'no-budget';
  else if (over > 0) state = 'over';
  else if (after / budget >= thr) state = 'near';
  return { state, budget, used, remain, after, over };
}

export function payeeRows(book) {
  const c = calc(book);
  const list = book?.payees || [];
  return list.map((p) => {
    const st = c.byPayee[p.name] || { amount: 0, paid: 0, count: 0 };
    return {
      name: p.name,
      contact: p.contact || '',
      note: p.note || '',
      amount: round2(st.amount),
      paid: round2(st.paid),
      owe: round2(st.amount - st.paid),
      count: st.count || 0,
    };
  }).sort((a, b) => b.amount - a.amount);
}

/* ---------------- A1 账龄分桶（v1.4） ----------------
 * 账龄 = 今天 − 到期日（`effectiveDue`：优先「到期日」，否则「下单日 + 30 天」）。
 * 未到期（账龄 ≤ 0）与 0–30 天同桶，保证「四桶金额之和 === 待付合计」恒成立。
 * 只统计仍有欠款（dueOf > 0）的费用项；多付项不计负值，故本函数**不与** stats.remain 的
 * 负数项相抵——基线台账无多付项，两者字面相等（见 verify-v14 断言）。
 */
export const AGE_BUCKETS = [
  { key: 'b0', label: '0–30 天', min: 0, max: 30 },
  { key: 'b1', label: '31–60 天', min: 31, max: 60 },
  { key: 'b2', label: '61–90 天', min: 61, max: 90 },
  { key: 'b3', label: '90 天以上', min: 91, max: Infinity },
];

const bucketIdxOf = (days) => (days > 90 ? 3 : days > 60 ? 2 : days > 30 ? 1 : 0);

/** 账龄分桶：{ buckets, items, total, maxDays, worst, payees }
 *  收款方字段是 `project.object`（与 `calc().byPayee` / 导出「收款方」列同源），不是 `payee`。 */
export function agingRows(book, today = todayLocal(), payee = '') {
  const buckets = AGE_BUCKETS.map((b) => ({ ...b, amount: 0, count: 0 }));
  const items = [];
  const dueDays = bookDueDays(book);                    // M3：推算天数按项目配置
  (book?.projects || []).forEach((p) => {
    const due = dueOf(p);
    if (due <= 0.005) return;                        // 只看欠款
    const who = p.object || '未指定';
    if (payee && who !== payee) return;              // 按收款方下钻
    const dd = effectiveDue(p, dueDays);
    const raw = daysBetween(dd, today);
    const overdue = Number.isFinite(raw) ? Math.max(0, raw) : 0; // 未到期 / 日期缺失 → 0
    const i = bucketIdxOf(overdue);
    buckets[i].amount = round2(buckets[i].amount + due);
    buckets[i].count += 1;
    items.push({
      id: p.id, no: p.no || '', name: p.name || '', payee: who,
      due: dd, overdue, amount: due, bucket: AGE_BUCKETS[i].key,
    });
  });
  items.sort((a, b) => b.overdue - a.overdue || b.amount - a.amount);
  const total = round2(buckets.reduce((s, b) => s + b.amount, 0));
  return {
    buckets, items, total,
    maxDays: items.length ? items[0].overdue : 0,
    worst: items[0] || null,
    payees: agingPayees(book, today),
    payee: payee || '',
    today,
  };
}

/** 可下钻的收款方：只列仍有欠款的对象，按欠款降序 */
export function agingPayees(book, today = todayLocal()) {
  const m = new Map();
  const dueDays = bookDueDays(book);
  (book?.projects || []).forEach((p) => {
    const due = dueOf(p);
    if (due <= 0.005) return;
    const who = p.object || '未指定';
    const raw = daysBetween(effectiveDue(p, dueDays), today);
    const overdue = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    const cur = m.get(who) || { name: who, owe: 0, count: 0, maxDays: 0 };
    cur.owe = round2(cur.owe + due);
    cur.count += 1;
    cur.maxDays = Math.max(cur.maxDays, overdue);
    m.set(who, cur);
  });
  return [...m.values()].sort((a, b) => b.owe - a.owe);
}

/* ---------------- A2 材料（明细品名）支出排行 ---------------- */
const nameKey = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

/**
 * A2：明细按「品名」合并后的支出排行。
 * - 同名判定：去首尾空白 + 去内部全部空白 + 英文小写（「瓷砖 胶」与「瓷砖胶」视为同名）
 * - 排序：金额降序，同额按条数降序
 * - **可对账**：`rows` 金额合计 + `others` 恒等于 `total`（= 全部明细金额合计）
 * - `itemId` 指向该品名金额最大的那条明细所属费用项，供「点条目跳到费用项」
 * 仅读取，不 mutate 任何明细。
 */
export function materialRows(book, limit = 10) {
  const m = new Map();
  let total = 0;
  (book?.projects || []).forEach((p) => {
    (p.details || []).forEach((d) => {
      const raw = String(d.name || '').trim();
      const amount = +d.amount || 0;
      total = round2(total + amount);
      if (!raw) return;                                  // 无名明细不计入排行，但仍进 total
      const key = nameKey(raw);
      const cur = m.get(key) || {
        key, name: raw, amount: 0, count: 0, unit: '', price: 0, itemId: '', itemNo: '', cat: '',
      };
      cur.amount = round2(cur.amount + amount);
      cur.count += 1;
      // 代表行：取金额最大的一条（同等金额取先出现的），单位/单价/品类随之
      if (amount >= (cur._max || -1)) {
        cur._max = amount;
        cur.unit = d.unit || cur.unit;
        cur.price = +d.price || cur.price;
        cur.itemId = p.id;
        cur.itemNo = p.no || '';
        cur.cat = p.cat || cur.cat;
      }
      m.set(key, cur);
    });
  });
  const all = [...m.values()]
    .map(({ _max, ...rest }) => rest)
    .sort((a, b) => b.amount - a.amount || b.count - a.count);
  const top = all.slice(0, Math.max(1, limit));
  const topTotal = round2(top.reduce((s, x) => s + x.amount, 0));
  return {
    rows: top,
    total,
    topTotal,
    others: round2(total - topTotal),
    othersCount: Math.max(0, all.length - top.length),
    names: all.length,
    max: all.length ? all[0].amount : 0,
  };
}

/* ---------------- A3 月度环比 ---------------- */
const prevMonth = (ym) => {
  const [y, mo] = String(ym || '').split('-').map(Number);
  if (!y || !mo) return '';
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * A3：本月 vs 上月。
 * - 应付：按「费用项下单日期」归属月份（与列表日期筛选同口径）
 * - 已付：按「付款日期」归属（6 笔无日期付款不计入任何月份，与 `monthlyPayments` 一致）
 * - 新增费用项：按下单日期计数
 * - `topCat`：应付环比增幅最大的品类（可能为负，取最大者）
 */
export function monthCompare(book, today = todayLocal()) {
  const cur = String(today).slice(0, 7);
  const prev = prevMonth(cur);
  const zero = () => ({ cur: 0, prev: 0, diff: 0, pct: 0, prevPct: 0 });
  const payable = zero();
  const paid = zero();
  const count = zero();
  const catDiff = new Map();

  (book?.projects || []).forEach((p) => {
    const ym = String(normDate(p.date) || '').slice(0, 7);
    const amt = payableOf(p);
    if (ym === cur) {
      payable.cur = round2(payable.cur + amt);
      count.cur += 1;
      const k = p.cat || '未分类';
      catDiff.set(k, round2((catDiff.get(k) || 0) + amt));
    } else if (ym === prev) {
      payable.prev = round2(payable.prev + amt);
      count.prev += 1;
      const k = p.cat || '未分类';
      catDiff.set(k, round2((catDiff.get(k) || 0) - amt));
    }
    activePayments(p).forEach((py) => {
      const pym = String(normDate(py.date) || '').slice(0, 7);
      if (pym === cur) paid.cur = round2(paid.cur + (+py.amount || 0));
      else if (pym === prev) paid.prev = round2(paid.prev + (+py.amount || 0));
    });
  });

  ['payable', 'paid', 'count'].forEach((k) => {
    const o = k === 'payable' ? payable : k === 'paid' ? paid : count;
    o.diff = round2(o.cur - o.prev);
    o.pct = o.prev > 0 ? (o.diff / o.prev) * 100 : (o.cur > 0 ? 100 : 0);
  });

  const cats = [...catDiff.entries()].map(([name, diff]) => ({ name, diff })).sort((a, b) => b.diff - a.diff);
  return {
    cur,
    prev,
    payable,
    paid,
    count,
    topCat: cats.length ? cats[0] : null,
    hasData: payable.cur !== 0 || payable.prev !== 0 || paid.cur !== 0 || paid.prev !== 0,
  };
}

/* ---------------- A4 单方造价 ---------------- */
/**
 * A4：单方造价 = 应付合计 ÷ 面积（元/㎡）。
 * 面积未填（≤0）返回 null —— 调用方不显示该指标，绝不显示 ¥0/㎡ 误导。
 */
export function costPerArea(book) {
  const area = +book?.area || 0;
  if (!(area > 0)) return null;
  const payable = round2((book?.projects || []).reduce((s, p) => s + payableOf(p), 0));
  const confirmed = round2((book?.projects || []).reduce((s, p) => s + confirmedPayableOf(p), 0));
  return {
    area: round2(area),
    payable,
    confirmed,
    perArea: Math.round(payable / area),
    perAreaConfirmed: Math.round(confirmed / area),
  };
}

/* ---------------- 数据体检 ---------------- */
/**
 * 问题码。
 * level='fix'  → 有自动修复动作（`fix` 非 null）
 * level='warn' → 只提示，不提供修复（自动修改会伪造账目事实）
 */
export const CHECK_CODE = {
  CAT_MISSING: 'cat-missing',
  ORPHAN_CAT: 'orphan-cat',
  ORPHAN_PAYEE: 'orphan-payee',
  TOTAL_DRIFT: 'total-drift',
  PAY_NO_DATE: 'pay-no-date',
  OVERPAID: 'overpaid',
  DUP_NO: 'dup-no',
  BUDGET_ORPHAN_CAT: 'budget-orphan-cat',
  BUDGET_TOTAL_DRIFT: 'budget-total-drift',
  PAYEE_NAME_SUSPECT: 'payee-name-suspect',
};

/**
 * C4（v1.7）：收款方名「疑似残缺」判定。
 *
 * 三种形态（都是录入时手滑留下的尾巴）：
 *  ① 以 `-` / `·` / `_` 结尾 —— 例如「泥工-」「木工-」，本意是「泥工-张三」，后半截没打完；
 *  ② 长度 ≤ 3 且含非中文字符 —— 例如「A」「1号」，几乎不可能是完整主体名；
 *  ③ 全是符号 / 空白 —— 例如「—」「·」。
 *
 * **只判定、不改名**：自动把「泥工-」改成「泥工」会篡改用户账上的既有事实
 * （那份合同上写的可能真是「泥工-」），所以这条规则 `fix: null`。
 */
const PAYEE_BAD_TAIL_RE = /[-·_\u2010-\u2015]$/;
const PAYEE_ALL_SYMBOL_RE = /^[^\p{L}\p{N}]+$/u;
export function isPayeeNameSuspect(name) {
  const s = String(name ?? '').trim();
  if (!s) return false;
  if (PAYEE_BAD_TAIL_RE.test(s)) return true;
  if (PAYEE_ALL_SYMBOL_RE.test(s)) return true;
  // 按字符（码点）数长度，避免 emoji / 生僻字按 UTF-16 双位计数
  return [...s].length <= 3 && /[^\u4e00-\u9fa5]/.test(s);
}

/** 金额比较容差，与 ItemSheet 的超付校验保持一致 */
const CHECK_TOL = 0.005;

/**
 * 数据体检：只读诊断，**绝不 mutate** 传入的 book。
 *
 * 不变量：本批所有 `level === 'fix'` 的修复动作都不会改变 payable / paid / due，
 * 因此 `amount` 的口径是「涉及金额的规模」，不是「修复后金额的变化量」。
 *
 * @param {object} book 账套
 * @returns {{issues: Array, fixable: number, warnable: number, stat: object}}
 */
export function checkup(book) {
  const projects = Array.isArray(book?.projects) ? book.projects : [];
  const cats = Array.isArray(book?.categories) ? book.categories : [];
  const payees = Array.isArray(book?.payees) ? book.payees : [];
  const budget = book?.budget && typeof book.budget === 'object' ? book.budget : {};

  const catSet = new Set(cats.map((c) => c.name));
  const payeeSet = new Set(payees.map((x) => x.name));
  const issues = [];

  const sample = (p, text) => ({
    id: p.id,
    no: p.no || '',
    remark: p.remark || '',
    text: text || '',
  });

  // ① cat-missing：费用项未填品类 → 钱进了总额，但 catRows() 里没有「未分类」这一行，预算页看不见。
  //    判定必须带上「档案里没有未分类兜底行」这个前提：修复动作就是补建该档案，
  //    否则补完档案问题还在报（fixable 永远归不了 0）。
  const UNCAT = '未分类';
  const catMissing = catSet.has(UNCAT) ? [] : projects.filter((p) => !p.cat);
  if (catMissing.length) {
    issues.push({
      code: CHECK_CODE.CAT_MISSING,
      level: 'fix',
      title: '费用项未填品类',
      count: catMissing.length,
      unit: '项',
      amount: round2(catMissing.reduce((s, p) => s + payableOf(p), 0)),
      samples: catMissing.slice(0, 3).map((p) => sample(p, `${p.remark || '未命名'} · ${fmt(payableOf(p))}`)),
      fix: 'ensure-cat',
      fixLabel: '一键补建档案',
      note: '补建「未分类」档案后，这笔钱才会出现在预算页',
    });
  }

  // ② orphan-cat：引用了已不存在的品类
  const orphanCat = projects.filter((p) => p.cat && !catSet.has(p.cat));
  if (orphanCat.length) {
    issues.push({
      code: CHECK_CODE.ORPHAN_CAT,
      level: 'fix',
      title: '品类档案缺失',
      count: orphanCat.length,
      unit: '项',
      amount: round2(orphanCat.reduce((s, p) => s + payableOf(p), 0)),
      samples: orphanCat.slice(0, 3).map((p) => sample(p, `${p.cat} · ${fmt(payableOf(p))}`)),
      fix: 'ensure-cat',
      fixLabel: '一键补建档案',
      note: '按费用项里写的品类名补建档案，金额不变',
    });
  }

  // ③ orphan-payee：引用了已不存在的收款方
  const orphanPayee = projects.filter((p) => p.object && !payeeSet.has(p.object));
  if (orphanPayee.length) {
    issues.push({
      code: CHECK_CODE.ORPHAN_PAYEE,
      level: 'fix',
      title: '收款方档案缺失',
      count: orphanPayee.length,
      unit: '项',
      amount: round2(orphanPayee.reduce((s, p) => s + payableOf(p), 0)),
      samples: orphanPayee.slice(0, 3).map((p) => sample(p, `${p.object} · ${fmt(payableOf(p))}`)),
      fix: 'ensure-payee',
      fixLabel: '一键补建档案',
      note: '按费用项里写的收款方名补建档案，金额不变',
    });
  }

  // ④ total-drift：有明细但 p.total 缓存与明细合计不一致（应付一直取明细，故金额无差）
  const totalDrift = projects.filter((p) => {
    if (!(p.details || []).length) return false;
    return Math.abs(round2(detailSum(p)) - round2(+p.total || 0)) > CHECK_TOL;
  });
  if (totalDrift.length) {
    issues.push({
      code: CHECK_CODE.TOTAL_DRIFT,
      level: 'fix',
      title: '明细合计与总计不一致',
      count: totalDrift.length,
      unit: '项',
      amount: round2(totalDrift.reduce((s, p) => s + (detailSum(p) - (+p.total || 0)), 0)),
      samples: totalDrift.slice(0, 3).map((p) => sample(p, `${p.remark || '未命名'} ${fmt(+p.total || 0)} → ${fmt(detailSum(p))}`)),
      fix: 'sync-total',
      fixLabel: '一键对齐总计',
      note: '应付本来就取明细合计，对齐只让「总计」字段显示值一致',
    });
  }

  // ⑤ pay-no-date：付款缺日期。只提示 —— 自动填今日会伪造对账事实
  //    作废付款不参与体检：它本来就不进金额链，再要求补日期只会制造噪音。
  const noDatePays = [];
  projects.forEach((p) => {
    activePayments(p).forEach((py) => {
      if (py.date) return;
      noDatePays.push({ p, py });
    });
  });
  if (noDatePays.length) {
    issues.push({
      code: CHECK_CODE.PAY_NO_DATE,
      level: 'warn',
      title: '付款缺少日期',
      count: noDatePays.length,
      unit: '笔',
      amount: round2(noDatePays.reduce((s, x) => s + (+x.py.amount || 0), 0)),
      samples: noDatePays.slice(0, 3).map((x) => sample(x.p, `${x.py.method || '—'} · ${fmt(+x.py.amount || 0)}`)),
      fix: null,
      fixLabel: '',
      note: '仅提示，不改日期以免伪造对账事实',
    });
  }

  // ⑥ overpaid：已付超过应付（可能是预付款/退款安排，不能动）
  const overpaid = projects.filter((p) => paidOf(p) > payableOf(p) + CHECK_TOL);
  if (overpaid.length) {
    issues.push({
      code: CHECK_CODE.OVERPAID,
      level: 'warn',
      title: '付款超过应付',
      count: overpaid.length,
      unit: '项',
      amount: round2(overpaid.reduce((s, p) => s + (paidOf(p) - payableOf(p)), 0)),
      samples: overpaid.slice(0, 3).map((p) => sample(p, `已付 ${fmt(paidOf(p))} / 应付 ${fmt(payableOf(p))}`)),
      fix: null,
      fixLabel: '',
      note: '仅提示，可能是预付或退款安排，不建议自动调整',
    });
  }

  // ⑦ dup-no：项目号重复（编号是用户与外部对账单对齐的业务语义）
  const noCount = {};
  projects.forEach((p) => {
    const n = (p.no || '').trim();
    if (!n) return;
    noCount[n] = (noCount[n] || 0) + 1;
  });
  const dupProjects = projects.filter((p) => {
    const n = (p.no || '').trim();
    return n && noCount[n] > 1;
  });
  if (dupProjects.length) {
    issues.push({
      code: CHECK_CODE.DUP_NO,
      level: 'warn',
      title: '项目号重复',
      count: dupProjects.length,
      unit: '项',
      amount: 0,
      samples: dupProjects.slice(0, 3).map((p) => sample(p, `${p.no} · ${p.remark || '未命名'}`)),
      fix: null,
      fixLabel: '',
      note: '仅提示，自动重编号会破坏与外部对账单的对应关系',
    });
  }

  // ⑧ budget-orphan-cat：预算键在 categories 里没有对应档案（预算页的「幽灵品类」行）
  const orphanBudgetKeys = Object.keys(budget).filter((k) => !catSet.has(k));
  if (orphanBudgetKeys.length) {
    issues.push({
      code: CHECK_CODE.BUDGET_ORPHAN_CAT,
      level: 'fix',
      title: '预算对应品类已删除',
      count: orphanBudgetKeys.length,
      unit: '个',
      amount: round2(orphanBudgetKeys.reduce((s, k) => s + (+budget[k] || 0), 0)),
      samples: orphanBudgetKeys.slice(0, 3).map((k) => ({ id: '', no: '', remark: k, text: `${k} · ${fmt(+budget[k] || 0)}` })),
      fix: 'ensure-cat',
      fixLabel: '一键补建档案',
      note: '补建档案即可保住这笔预算，不用重填',
    });
  }

  // ⑨ budget-total-drift：book.totalBudget（派生缓存）与 Σ 品类预算不一致
  const budgetSum = sumBudget(book);
  if (Math.abs(round2(book?.totalBudget) - budgetSum) > CHECK_TOL) {
    issues.push({
      code: CHECK_CODE.BUDGET_TOTAL_DRIFT,
      level: 'fix',
      title: '预算合计字段不一致',
      count: 1,
      unit: '处',
      amount: round2(round2(book?.totalBudget) - budgetSum),
      samples: [{ id: '', no: '', remark: '', text: `${fmt(+book?.totalBudget || 0)} → ${fmt(budgetSum)}` }],
      fix: 'sync-totalBudget',
      fixLabel: '一键对齐',
      note: '界面一直按 Σ 品类预算显示，对齐后字段与显示一致',
    });
  }

  /**
   * ⑩ payee-name-suspect（C4 / v1.7）：收款方名疑似残缺。
   * 与 orphan-payee 的区别：那种是「档案里根本没有这个名字」（可一键补建），
   * 这种是「名字本身就像没打完」—— 补建档案只会把错名钉进档案，所以只报不改。
   */
  const suspectPayee = projects.filter((p) => isPayeeNameSuspect(p.object));
  if (suspectPayee.length) {
    issues.push({
      code: CHECK_CODE.PAYEE_NAME_SUSPECT,
      level: 'warn',
      title: '收款方名疑似残缺',
      count: suspectPayee.length,
      unit: '项',
      amount: round2(suspectPayee.reduce((s, p) => s + payableOf(p), 0)),
      samples: suspectPayee.slice(0, 3).map((p) => sample(p, `${p.object} · ${fmt(payableOf(p))}`)),
      fix: null,
      fixLabel: '',
      note: '仅提示。名字可能是「泥工-张三」只打了一半，请手动核对后改名，金额不变',
    });
  }

  const c = calc(book);
  const fixable = issues.filter((i) => !!i.fix).length;
  return {
    issues,
    fixable,
    warnable: issues.length - fixable,
    stat: {
      payable: c.payable,
      paid: c.paid,
      due: c.remain,
      totalBudget: c.totalBudget,
      count: c.count,
      detailCount: c.detailCount,
      payCount: c.payCount,
    },
  };
}

/* ---------------- 预警 ---------------- */
/** M2：逾期超过该天数算「超 30 天」，单独用 danger 色并在付款页置顶 */
export const SEVERE_DAYS = 30;

/**
 * C3（v1.7）/ K11（v1.8）：催收门槛（元）。
 *
 * 「超 30 天 · 优先催收」这张卡是给**催款动作**用的：金额小于 100 的逾期去催，
 * 电话费都比欠款贵，用户反而会漏掉真正该催的那几笔（基线里 ZX0016 逾期 145 天，
 * 金额 0.46 元 —— 挂在第一位会把 4 笔真欠款挤下去）。
 *
 * 因此主列表只放 ≥ 本门槛的，小额项折叠成一行「另有 N 笔小额逾期（合计 X）· 展开」。
 * **只影响展示分组**：`severe` / `severeAmount` 仍是全量，顶部预警条与统计口径一个字不变。
 *
 * K11：门槛从账套 `book.remindThreshold` 读取（可在设置页配置），本常量作为**缺省回退值**
 * （未配置 / 非法值时回落 100），保证历史行为不变。常量本身保持导出，测试仍可断言 =100。
 */
export const OVERDUE_MIN_AMOUNT = 100;

/**
 * 逾期清单（含分级）：{ severe, severeMain, smallList, smallSum, normal, all, count }
 * - severe：逾期 > 30 天，催款优先级最高（**全量**，口径不变）
 * - severeMain：其中金额 ≥ `OVERDUE_MIN_AMOUNT` 的（置顶卡主列表用）
 * - smallList：其中金额 < `OVERDUE_MIN_AMOUNT` 的（折叠行用），`smallSum` 是其合计
 * - normal：逾期 1–30 天
 * 与 `buildAlerts` 同口径（都走 `effectiveDue` + 账本推算天数），但按费用项给出完整字段，
 * 供付款页「超 30 天」置顶区直接渲染，不必再回溯 projects。
 *
 * C3：分组只发生在这里（唯一真源），视图不许再筛一遍 —— 否则「卡片上 5 笔、列表 4 行」
 * 这种对不上的账会立刻回来。
 */
export function overdueGroups(book, today = todayLocal()) {
  const dueDays = bookDueDays(book);
  const all = [];
  (book?.projects || []).forEach((p) => {
    const due = dueOf(p);
    if (due <= 0.005) return;
    const dd = effectiveDue(p, dueDays);
    const d = daysBetween(dd, today);               // = 今天 − 到期日，> 0 才是逾期
    if (!Number.isFinite(d) || d <= 0) return;      // 未到期 / 日期缺失
    const days = d;
    all.push({
      id: p.id,
      no: p.no || '',
      name: p.name || '',
      payee: p.object || '',
      remark: p.remark || '',
      due: dd,
      days,
      severe: days > SEVERE_DAYS,
      amount: due,
    });
  });
  all.sort((a, b) => b.days - a.days || b.amount - a.amount);
  const severe = all.filter((x) => x.severe);
  const normal = all.filter((x) => !x.severe);
  // K11（v1.8）：催收门槛可配。优先取账套 `book.remindThreshold`，非法 / 缺省回落
  // `OVERDUE_MIN_AMOUNT`（=100），保证未配置时行为与历史完全一致。
  const minAmt = (book && +book.remindThreshold > 0) ? +book.remindThreshold : OVERDUE_MIN_AMOUNT;
  // C3：按催收门槛拆两组（顺序沿用上面的「天数降序」，两组内部都还是最急的在前）
  const severeMain = severe.filter((x) => x.amount >= minAmt);
  const smallList = severe.filter((x) => x.amount < minAmt);
  return {
    all,
    severe,
    severeMain,
    smallList,
    smallSum: round2(smallList.reduce((s, x) => s + x.amount, 0)),
    normal,
    count: all.length,
    amount: round2(all.reduce((s, x) => s + x.amount, 0)),
    severeAmount: round2(severe.reduce((s, x) => s + x.amount, 0)),
  };
}

/**
 * 预警项：超支 > 临界(≥阈值未超) > 逾期 > 临期(≤7天)
 * 超过 8 条时收敛为一条汇总，避免窄窗口横幅溢出。
 */
export function buildAlerts(book, today = todayLocal()) {
  const c = calc(book);
  const thr = book?.warnThreshold || 0.8;
  const projects = book?.projects || [];
  const dueDays = bookDueDays(book);               // M3：推算天数按项目配置

  // B1 双口径：超支/临界判断按「确定应付」(confirmed) 计，使勾选预估的明细不再触发预警
  const over = Object.keys(c.byCat)
    .filter((k) => c.byCat[k].budget > 0 && c.byCat[k].confirmed > c.byCat[k].budget)
    .map((k) => ({ cat: k, diff: round2(c.byCat[k].confirmed - c.byCat[k].budget) }))
    .sort((a, b) => b.diff - a.diff);

  const near = Object.keys(c.byCat)
    .filter((k) => {
      const x = c.byCat[k];
      return x.budget > 0 && x.confirmed < x.budget && x.confirmed / x.budget >= thr;
    })
    .map((k) => ({ cat: k, rate: c.byCat[k].confirmed / c.byCat[k].budget }))
    .sort((a, b) => b.rate - a.rate);

  const overdue = [];
  const soon = [];
  projects.forEach((p) => {
    const due = dueOf(p);
    if (due <= 0) return;
    const dd = effectiveDue(p, dueDays);
    if (!dd) return;
    const d = daysBetween(today, dd);
    if (Number.isNaN(d)) return;
    const item = { id: p.id, label: p.remark || p.no || '未命名', amount: due, days: d, no: p.no };
    if (d < 0) overdue.push({ ...item, days: -d, severe: -d > SEVERE_DAYS });
    else if (d <= 7) soon.push(item);
  });
  overdue.sort((a, b) => b.days - a.days);
  soon.sort((a, b) => a.days - b.days);

  const items = [
    ...over.map((o) => ({ type: 'over', text: `超支 ${o.cat} +${fmt(o.diff)}`, target: { kind: 'budget' } })),
    ...near.map((n) => ({ type: 'soon', text: `临界 ${n.cat} ${Math.round(n.rate * 100)}%`, target: { kind: 'budget' } })),
    ...overdue.map((o) => ({
      type: 'overdue',
      severe: o.severe,
      text: o.severe
        ? `超30天 ${o.label} ${o.days}天 · ${fmt(o.amount)}`
        : `逾期 ${o.label} ${o.days}天 · ${fmt(o.amount)}`,
      target: { kind: 'item', id: o.id },
    })),
    ...soon.map((o) => ({ type: 'soon', text: `临期 ${o.label} ${o.days}天 · ${fmt(o.amount)}`, target: { kind: 'item', id: o.id } })),
  ];

  const severeCount = overdue.filter((o) => o.severe).length;

  // 超过 8 条时收敛为分类计数，窄窗口不会撑爆横幅
  const summary = [
    over.length ? { type: 'over', text: `超支 ${over.length} 项`, target: { kind: 'budget' } } : null,
    near.length ? { type: 'soon', text: `临界 ${near.length} 项`, target: { kind: 'budget' } } : null,
    severeCount ? { type: 'overdue', severe: true, text: `超30天 ${severeCount} 笔`, target: { kind: 'pay' } } : null,
    overdue.length ? { type: 'overdue', text: `逾期 ${overdue.length} 笔`, target: { kind: 'pay' } } : null,
    soon.length ? { type: 'soon', text: `临期 ${soon.length} 笔`, target: { kind: 'pay' } } : null,
  ].filter(Boolean);

  return {
    items: items.length > 8 ? summary : items,
    total: items.length,
    over,
    near,
    overdue,
    severeCount,
    soon,
    truncated: items.length > 8,
  };
}

/* ---------------- 现金流量 ---------------- */
export function cashflow(book, monthsAhead = 6, today = todayLocal()) {
  const base = new Date(`${today}T00:00:00`);
  const months = [];
  const buckets = {};
  for (let i = 0; i < monthsAhead; i += 1) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(key);
    buckets[key] = 0;
  }
  let overdue = 0;
  const dueDays = bookDueDays(book);
  (book?.projects || []).forEach((p) => {
    const due = dueOf(p);
    if (due <= 0) return;
    const dd = effectiveDue(p, dueDays);
    if (!dd) return;
    if (dd < today) {
      overdue += due;
      return;
    }
    const mk = dd.slice(0, 7);
    if (Object.prototype.hasOwnProperty.call(buckets, mk)) buckets[mk] += due;
  });
  const values = months.map((m) => round2(buckets[m]));
  let peak = 0;
  let peakMonth = '';
  months.forEach((m, i) => {
    if (values[i] > peak) {
      peak = values[i];
      peakMonth = m;
    }
  });
  return { months, values, overdue: round2(overdue), peak, peakMonth, total: round2(overdue + values.reduce((s, v) => s + v, 0)) };
}

/** 付款月度趋势（全历史，按付款日期；作废付款不计入） */
export function monthlyPayments(book) {
  const byMonth = {};
  let noDate = 0;
  (book?.projects || []).forEach((p) => {
    activePayments(p).forEach((py) => {
      if (py.date) {
        const m = normDate(py.date).slice(0, 7);
        byMonth[m] = (byMonth[m] || 0) + (+py.amount || 0);
      } else noDate += 1;
    });
  });
  const months = Object.keys(byMonth).sort();
  return { months, values: months.map((m) => round2(byMonth[m])), noDate };
}

/* ---------------- C6 编号契约（见文件上方「编号契约」小节的 `nextNo` / `payNo`） ----------------
 * v1.6 及以前这里是 `export function nextNo(projects)`：只认 `(\d+)`、永远发 `ZX` 前缀的号。
 * v1.7 起统一由上方 `nextNo(projects, prefix)` 承担（支持自定义前缀、只取同前缀最大序号），
 * 旧实现已删除，避免出现两套发号逻辑。
 */

/* ---------------- C6（v1.7）编号契约 ----------------
 * 三层编号，各司其职，**谁也不许兼任**：
 *   · 项目号 `no`（如 `WX0007`）= 账套内的项目序号，前缀可配置（`book.noPrefix`）；
 *   · 付款编号 `pid`（如 `P0001`）= 项目内付款序号，**唯一键**（v1.6 K1，导回靠它定位）；
 *   · 付款全号（如 `WX0007-P0001`）= 只用于「看一眼能报出来」的展示与导出，**不入库**。
 *
 * 关键纪律：库里只存 `pid`。若把全号写进 `pid`，v1.6 的「导出 → 原样导回 pid 集合不变」
 * 立刻失效（正则不认、二次导入会当成新付款重复插入）。所以导入时必须先剥前缀。
 */

/** 编号前缀白名单：1–4 位大写字母（`ZX` / `WX` / `A` 都合法；`zx` 会被归一成大写） */
export const NO_PREFIX_RE = /^[A-Z]{1,4}$/;
/** 默认前缀：与 v1.0–v1.6 的历史数据完全一致，保证老账套不改也照旧 */
export const DEFAULT_NO_PREFIX = 'ZX';
/** 付款全号：`<可选的项目号>-<P + 至少 4 位>`，项目号部分允许 `WX0007` / `ZX24` / 空 */
export const PAY_NO_RE = /^(?:[A-Za-z]{1,8}\d{2,})?-(P\d{4,})$/;

/**
 * 归一化编号前缀：非法值（空、小写、超长、含数字/符号）一律回落 `ZX`。
 * 空串按「未配置」处理 → `ZX`（与 v1.6 行为字面一致，历史数据零迁移）。
 * @param {string} v 用户输入或账本里的 `noPrefix`
 * @returns {string} 1–4 位大写字母
 */
export function normNoPrefix(v) {
  const s = String(v ?? '').trim().toUpperCase();
  return NO_PREFIX_RE.test(s) ? s : DEFAULT_NO_PREFIX;
}

/**
 * 账套的编号前缀（`book.noPrefix` 缺省 = `ZX`）。视图一律走这里，不要自己读字段。
 * @param {object} book 账套
 * @returns {string} 1–4 位大写字母
 */
export const bookNoPrefix = (book) => normNoPrefix(book?.noPrefix);

/**
 * 下一个项目号：**只取同前缀**的最大序号 + 1。
 * 混前缀的账套（历史 `ZX` + 新 `WX`）不会互相把序号顶飞；也绝不会因为别的前缀里有 `ZX9999`
 * 就给新前缀发 `WX10000`。
 * @param {Array} projects 费用项数组
 * @param {string} [prefix] 编号前缀，缺省 `''` → `ZX`
 * @returns {string} 如 `ZX0072` / `WX0001`
 */
export function nextNo(projects, prefix = '') {
  const pfx = normNoPrefix(prefix);
  const re = new RegExp(`^${pfx}(\\d+)$`);
  let max = 0;
  (projects || []).forEach((p) => {
    const m = re.exec(String(p?.no || '').trim());
    if (m) max = Math.max(max, +m[1]);
  });
  return `${pfx}${String(max + 1).padStart(4, '0')}`;
}

/**
 * 付款全号：`payNo('ZX0024', 'P0001') === 'ZX0024-P0001'`。
 * 缺项目号时退化为单段 `P0001`（不产出 `-P0001` 这种怪号）；缺 pid 返回空串。
 * @param {string} projectNo 项目号
 * @param {string} pid 付款唯一键
 * @returns {string} 展示/导出用的全号
 */
export function payNo(projectNo, pid) {
  const p = String(pid ?? '').trim();
  if (!p) return '';
  const no = String(projectNo ?? '').trim();
  return no ? `${no}-${p}` : p;
}

/**
 * 从「付款全号」里取回**纯净 pid**（导入用）。
 *   · `ZX0024-P0001` → `P0001`（剥前缀）
 *   · `P0001` → `P0001`（本来就纯，直通）
 *   · 其它任意内容 → `''`（交给 `store` 走旧规则补号，**绝不把脏串写进库**）
 * @param {string} raw 单元格原文
 * @returns {string} 纯净 pid 或空串
 */
export function payPidOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (PID_RE.test(s)) return s;
  const m = PAY_NO_RE.exec(s);
  return m ? m[1] : '';
}

/* ---------------- K1 付款唯一键（v1.6） ----------------
 * 付款流水此前只能靠「同日期 + 同金额」定位，同日多笔只导回单行时会永远命中第 1 笔
 * （导出→改值→导回无法区分）。给每笔付款一个**项目内稳定**的 `P0001` 编号：
 *  · 生成规则：项目内取现有最大序号 + 1，与导出顺序（payments 原顺序）一致；
 *  · 作废不回收编号 —— 编号是身份，不是序号，回收会让历史导出文件串账。
 */
export const PID_RE = /^P\d{4,}$/;
export const nextPid = (payments) => {
  let max = 0;
  (payments || []).forEach((py) => {
    const m = /^P(\d{4,})$/.exec(String(py?.pid || ''));
    if (m) max = Math.max(max, +m[1]);
  });
  return `P${String(max + 1).padStart(4, '0')}`;
};

/**
 * 就地为付款数组补齐唯一键（幂等）。规则：
 *  · 合法且项目内唯一的编号**原样保留**（历史导出文件仍能对上）；
 *  · 缺失 / 格式非法 → 取现有最大序号 +1 重发；
 *  · 重复 → 第一次出现的保留原号，其余重发（否则导回时两行会抢同一条记录）。
 * 抽成纯函数是为了让「加载时回填」与「测试 / 迁移脚本」共用同一份规则，不出现第二套编号逻辑。
 * @param {Array} payments 付款数组（会被就地修改）
 * @returns {Array} 同一个数组
 */
export function ensurePayIds(payments) {
  const list = payments || [];
  const count = new Map();
  const claimed = new Set();
  let max = 0;
  list.forEach((py) => {
    const v = String(py?.pid || '');
    if (!PID_RE.test(v)) return;
    count.set(v, (count.get(v) || 0) + 1);
    max = Math.max(max, +v.slice(1));
  });
  list.forEach((py) => {
    const v = String(py?.pid || '');
    if (PID_RE.test(v)) {
      if (count.get(v) === 1) return;
      if (!claimed.has(v)) { claimed.add(v); return; }
    }
    max += 1;
    py.pid = `P${String(max).padStart(4, '0')}`;
  });
  return list;
}

export const percentText = (a, b) => {
  const v = pct(a, b);
  return `${Math.round(v)}%`;
};
