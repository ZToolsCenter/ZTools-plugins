/**
 * 导出：JSON 备份 / CSV / .xlsx（零依赖 OOXML + store-only ZIP）
 * 数值列以 number 写入，Excel 中可直接参与公式计算。
 */
import { fmt, round2, payNo } from './core';
/** K20（v1.9.x）：JSON 备份搭载界面偏好（目前只有密度）—— 偏好是备份的「搭载物」，不进账本 state。 */
import { getDensity } from './prefs';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
const colLetter = (n) => {
  let s = '';
  let x = n + 1;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
};
const escXml = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cellXml(ref, v) {
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
}
function sheetXml(head, rows) {
  let body = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  const row = (idx, vals) => `<row r="${idx}">${vals.map((v, j) => cellXml(colLetter(j) + idx, v)).join('')}</row>`;
  body += row(1, head);
  rows.forEach((r, i) => { body += row(i + 2, r); });
  return `${body}</sheetData></worksheet>`;
}

/** store 模式 ZIP（不压缩），UTF-8 文件名 */
function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  files.forEach((f) => {
    const nameBytes = enc.encode(f.name);
    const { data } = f;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(lh.buffer), nameBytes, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push({ head: new Uint8Array(cd.buffer), name: nameBytes });
    offset += 30 + nameBytes.length + data.length;
  });
  const cdSize = central.reduce((s, c) => s + 46 + c.name.length, 0);
  const cdOut = [];
  central.forEach((c) => { cdOut.push(c.head, c.name); });
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true);
  eo.setUint16(8, files.length, true);
  eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true);
  eo.setUint32(16, offset, true);
  parts.push(...cdOut, new Uint8Array(eo.buffer));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  parts.forEach((p) => { out.set(p, pos); pos += p.length; });
  return out;
}

/**
 * 三张表的表头（CSV / XLSX 共用本常量）。
 *
 * K15（v1.9）术语统一：**「支付对象」列改叫「收款方」**，与界面用词收敛一致。
 * 这条推翻了 v1.7 C1「导出表头保留原词（支付对象）」的旧决定 —— 那是当时为了减少改动面
 * 做的保守选择；现在客户明确反馈：导出的表要发给会计看，表头写「支付对象」、界面写
 * 「收款方」，会被追问「这俩是不是两回事」。故按客户要求统一为界面用词「收款方」。
 *
 * 兼容性（已实测，见 scripts/verify-k-export.mjs）：`parse.js::COL_ALIAS` 里
 * 「收款方 → 支付对象」这条别名**早就存在**，而 `parse.js::TABLE_COLS` / `FIELDS` 的
 * 规范列名仍是「支付对象」，所以：
 *   ① 新表头导出 → 导回：`normalizeHeader('收款方') === '支付对象'`，对齐命中，88 行 0 坏行；
 *   ② 老文件（表头写「支付对象」）→ 导入：规范名本就直接命中，不受影响。
 * 因此对 `parse.js` **一个字都不用改**，导出→导回护栏（红线③）完好。
 *
 * 除这一列外，其余列名逐字不动（v1.7 定的「按整体保持一致」口径）。
 */
export const HEADS = {
  proj: ['项目号', '项目分类', '费用类型', '费用备注', '日期', '到期日', '总计', '优惠', '应付', '已付', '待付', '收款方', '状态', '凭证'],
  detail: ['项目号', '项目分类', '费用类型', '费用备注', '品名', '单位', '数量', '单价', '金额', '工艺', '备注', '预估'],
  // v1.2：仅在末尾追加「备注」「凭证号」，前 6 列逐字不变（CSV / XLSX 共用本常量）
  // v1.6：再追加「付款编号」「作废」—— 前者是回读定位用的唯一键（同日多笔不再串账），
  //       后者保证「作废」状态能往返（否则导出→导回会把作废款复活成有效付款）。
  // K15：第 3 列「支付对象」→「收款方」（术语统一；其余 9 列逐字不变）。
  pay: ['项目号', '费用备注', '收款方', '付款日期', '付款方式', '金额', '备注', '凭证号', '付款编号', '作废'],
};

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function projRows(book, statOf, statusText) {
  return (book.projects || []).map((p) => {
    const s = statOf(p);
    return [p.no, p.cat, p.sub, p.remark, p.date, p.due, s.total, +p.discount || 0, s.payable, s.paid, s.due,
      p.object, statusText(s.status), p.img ? '有' : '无'];
  });
}
export function detailRows(book) {
  const rows = [];
  (book.projects || []).forEach((p) => (p.details || []).forEach((d) => rows.push([
    p.no, p.cat, p.sub, p.remark, d.name, d.unit ?? '',
    d.qty == null ? '' : +d.qty, d.price == null ? '' : +d.price, +d.amount || 0,
    d.craft ?? '', d.note ?? '', d.est || '否',
  ])));
  return rows;
}
/**
 * 付款表行。**第 9 列（付款编号）输出「付款全号」**：`ZX0024-P0001`。
 *
 * 为什么导全号：导出的文件是给人对账的，只写 `P0001` 的话，跨项目的两张付款表
 * 会出现同一个 `P0001`，肉眼无法区分（图里那两笔到底哪笔是哪笔）。
 * 而库里仍然只存 `pid`，导入时由 `parse.payPidOf` 把前缀剥掉 —— 结构上保证不回写脏号。
 *
 * `HEADS.pay` 一个字节都没动（列名仍是「付款编号」），只是这一列的值从 `P0001` 变 `ZX0024-P0001`。
 */
export function payRows(book) {
  const rows = [];
  (book.projects || []).forEach((p) => (p.payments || []).forEach((py) => rows.push([
    p.no, p.remark, p.object, py.date, py.method, +py.amount || 0,
    py.note ?? '', py.ref ?? '', payNo(p.no, py.pid), py.void ? '是' : '否',
  ])));
  return rows;
}

/**
 * 作用域对象：给了 `projects`（已按筛选过滤）就用它替换整表，
 * 三张表**只认同一个 `b`** → 明细表 / 付款表结构上不可能与费用表不一致。
 * `{ ...book, projects }` 对 Vue reactive proxy 做 spread 得到普通对象，
 * `projRows` / `detailRows` / `payRows` 只读 `projects`，安全。
 */
const scopeOf = (book, projects) => (projects ? { ...book, projects } : book);

function csvText(head, rows) {
  return `\uFEFF${head.join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { URL.revokeObjectURL(a.href); } catch (_) { /* 忽略 */ }
    a.remove();
  }, 1500);
}

/** 文件名里不能出现的字符（Windows 更严，按最严的一套来），统一换成下划线 */
const unsafeFileChar = /[\\/:*?"<>|\u0000-\u001f]/g;

/** 本地日期 YYYY-MM-DD（**不用 toISOString**：那是 UTC，晚上 8 点后导出会差一天） */
function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * K14（v1.8）本地时间戳 YYYYMMDD-HHmmss（**不用 toISOString**：那是 UTC，会差一天/小时）。
 *
 * K15（v1.9）收窄适用范围：**只用于 JSON 备份文件名**。
 * K14 的需求原意就是防「备份」同名覆盖 —— 备份一天可能做多次，文件留在下载目录里
 * 同名会被浏览器静默改成 `xxx (1).json`，久了分不清哪份是新的。而正常导出（CSV / XLSX）是要
 * 发给会计看的，文件名越干净越好；v1.8 把时间戳也加到了这批文件上，结果出现
 * `项目费用_自宅装修_2026-10-26_20261028-115554.xlsx` 这种又长又难看的名字。
 * 故 CSV / XLSX 恢复为不含时间戳的干净文件名，本函数只在 `exportJson` 里调用。
 *
 * @param {Date} [d] 可选时间，默认 now（便于单测固定取值、验证防撞逻辑）
 * @returns {string} 形如 `20261027-143000`
 */
export function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * K19（v1.9.x）本地时分 `HHmm`：CSV / XLSX 的**防撞后缀**。
 *
 * 背景（第三轮评审 ④）：K15 把时间戳从导出文件名里拿掉后，同一天导两次
 * `费用表_自宅装修_2026-10-28.csv`，浏览器静默改名 `xxx (1).csv`，会计拿到两份
 * 分不清哪份是新的。彻底的时间戳（K14 形态）已被 K15 否决 —— 太丑；这里取折中：
 * **只补 4 位时分**（`_1430`），文件名依旧干净，同日多次导出不再撞名。
 *
 * 与 K15 的张力：K15 的本意是「给会计的文件名干净」，K19 是它之后的明确新决定
 * （评审点④「同日导出撞名」），按时分后缀是两者间最小改动的落点。
 *
 * @param {Date} [d] 可选时间，默认 now；导出函数都接受显式 `hm` 参数便于单测固定取值
 * @returns {string} 形如 `1430`
 */
export function localHM(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * K19（v1.9.x）文件名去重序号表：同一个进程里**每个文件名出现过几次**。
 * 只服务「同一次打开页面期间的连续导出」，不需要持久化 —— 关掉页面重开后，
 * `_HHmm` 通常已经变了，序号从头开始也不会撞。
 */
const nameSeq = new Map();

/**
 * K19（v1.9.x）把已用过的文件名改成不重名的形式。
 *
 * **为什么需要它（补 K19 的漏网场景）**：`localHM()` 精度只到分钟。用户改一下筛选、
 * 30 秒内再导一次，两次的 `hm` 完全相同 → 文件名一字不差 → 浏览器照样把它静默改成
 * `xxx (1).csv`，评审点④的诉求落空。所以再加一级序号：
 *
 *   | 层级 | 形态                                   | 解决什么                     |
 *   |------|----------------------------------------|------------------------------|
 *   | 一级 | `_1430`（4 位时分）                     | 同日**不同时刻**导出不撞名   |
 *   | 二级 | `_1430_2` / `_1430_3`（本函数的序号）   | **同一分钟内**连导不撞名     |
 *
 * **为什么不干脆用完整时间戳**：K15 已经否决了 —— `20261028-115554` 这种尾巴又长又难看，
 * 客户明确说过要给会计的文件名干净。两级方案在「干净」和「不撞名」之间取最小改动，
 * 且 `_1430_2` 不匹配 K15 的 `STAMP_RE = /_\d{8}-\d{6}/`，那条红线断言继续成立。
 *
 * @param {string} name 原始文件名（如 `费用表_自宅装修_2026-10-28_1430.csv`）
 * @returns {string} 首次返回原值；第 n 次（n≥2）返回主名 + `_n` + 扩展名
 */
function uniqueName(name) {
  const key = String(name ?? '');
  const used = nameSeq.get(key) || 0;
  nameSeq.set(key, used + 1);
  if (used === 0) return key;
  // 只认**最后一个** `.`：文件名里还有日期的 `-`，账套名本身也可能带点
  const dot = key.lastIndexOf('.');
  return dot > 0 ? `${key.slice(0, dot)}_${used + 1}${key.slice(dot)}` : `${key}_${used + 1}`;
}

/**
 * K19（v1.9.x）清空去重序号表。供测试在用例之间重置，避免相邻用例互相污染
 * （生产环境不必调用：序号本来就该在一次会话内累加）。
 */
export function resetExportNameSeq() {
  nameSeq.clear();
}

/**
 * B4（v1.7）JSON 备份。
 *
 * 文件名带「项目名 + 日期 + 项数 + 明细数」——用户一年后翻下载目录时，
 * `项目费用备份_老王家_2026-10-27_71项384明细.json` 与 `..._2026-11-02_73项391明细.json`
 * 一眼能看出「哪份更大、哪份更新」，不必逐个双击打开比对。
 *
 * K20（v1.9.x）：内容在账本数据之外**搭载** `prefs: { density }`（界面偏好）。
 * 偏好不进 `state`（v1.7「密度不进账本」不变），只搭备份的车走 —— 导回时
 * `importState` 读到合法值就恢复，读不到（老备份）就维持本机现状。
 *
 * @param {object} state 整个持久化状态（books / activeBookId / templates / warnThreshold）
 * @param {object|null} book 当前账套；不传则按 activeBookId 自行定位
 * @returns {{name: string, items: number, details: number}} 便于调用方提示与测试核对
 */
export function exportJson(state, book = null) {
  const b = book
    || (state?.books || []).find((x) => x.id === state?.activeBookId)
    || (state?.books || [])[0]
    || null;
  const items = (b?.projects || []).length;
  const details = (b?.projects || []).reduce((s, p) => s + (p.details || []).length, 0);
  const rawName = String(b?.name || '未命名账套').trim() || '未命名账套';
  const safeName = rawName.replace(unsafeFileChar, '_');
  // K14（v1.8）：文件名末尾追加时间戳 YYYYMMDD-HHmmss，同日多次备份互不覆盖。
  // K15（v1.9）：**只有备份保留时间戳** —— CSV / XLSX 已移除，本处是唯一残留调用点。
  const name = `项目费用备份_${safeName}_${localDate()}_${localStamp()}_${items}项${details}明细.json`;
  // K20：{ ...state } 对 reactive proxy 做 spread 得到普通对象；prefs 永远排在账本字段之后
  const payload = { ...state, prefs: { density: getDensity() } };
  download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), name);
  return { name, items, details };
}

/**
 * 导出单张费用表 CSV。
 * K12（v1.8）：文件名前缀由「支出表」统一为「费用表」，与界面用词收敛一致。
 * K15（v1.9）：文件名不带完整时间戳；K19（v1.9.x）：追加 4 位时分 `_HHmm` 防同日撞名
 * （评审点④ —— 同日导两次 `xxx (1).csv` 分不清新旧；完整时间戳形态已被 K15 否决）。
 * @param {object} book 账套
 * @param {string} today 文件名日期（YYYY-MM-DD）
 * @param {{statOf: Function, statusText: Function}} helpers
 * @param {Array|null} projects 已筛选的费用项；null = 全量（向后兼容）
 * @param {string} tag 文件名摘要（空串则不加后缀）
 * @param {string} [hm] 时分后缀（HHmm）；缺省取当前时间（测试可注入固定值）
 * @returns {string} 实际落到下载目录的文件名（已过去重）
 */
export function exportCsv(book, today, helpers, projects = null, tag = '', hm = localHM()) {
  const b = scopeOf(book, projects);
  const csv = csvText(HEADS.proj, projRows(b, helpers.statOf, helpers.statusText));
  const suffix = tag ? `_${tag}` : '';
  // K12：前缀「费用表」；K15：不带完整时间戳；K19：带 4 位时分防撞 + 重名自动加序号
  const name = uniqueName(`费用表_${book.name}_${today}_${hm}${suffix}.csv`);
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
  return name;
}

export function exportAllCsv(book, today, helpers, projects = null, tag = '', hm = localHM()) {
  const b = scopeOf(book, projects);
  const suffix = tag ? `_${tag}` : '';
  // K12：项目表文件名前缀「支出表」→「费用表」；K15：不带完整时间戳；K19：4 位时分 + 重名序号
  // 三张表名不同（费用表/明细表/付款表），同一次调用里互不重名 → 都不会被加序号，
  // 只有「第二次调用同种前缀」才会出现 `_2`。
  const files = [
    [`费用表_${book.name}_${today}_${hm}${suffix}.csv`, csvText(HEADS.proj, projRows(b, helpers.statOf, helpers.statusText))],
    [`明细表_${book.name}_${today}_${hm}${suffix}.csv`, csvText(HEADS.detail, detailRows(b))],
    [`付款表_${book.name}_${today}_${hm}${suffix}.csv`, csvText(HEADS.pay, payRows(b))],
  ].map(([raw, text]) => [uniqueName(raw), text]);
  files.forEach(([name, text], i) => {
    setTimeout(() => download(new Blob([text], { type: 'text/csv;charset=utf-8' }), name), i * 350);
  });
  return files.map(([name]) => name);
}

/**
 * 导出三表合一的 .xlsx（零依赖 OOXML + store-only ZIP）。
 * K15（v1.9）：不带完整时间戳；K19（v1.9.x）：带 4 位时分防撞，重名自动加序号。
 * @param {string} [hm] 时分后缀（HHmm）；缺省取当前时间（测试可注入固定值）
 * @returns {{sheets: number, rows: number, name: string}} 表数 / 总行数 / 实际文件名
 */
export function exportXlsx(book, today, helpers, projects = null, tag = '', hm = localHM()) {
  const b = scopeOf(book, projects);
  const sheets = [
    // K12（v1.8）：工作表名「支出表」→「费用表」，与导出文件名用词收敛一致
    { name: '费用表', head: HEADS.proj, rows: projRows(b, helpers.statOf, helpers.statusText) },
    { name: '明细表', head: HEADS.detail, rows: detailRows(b) },
    { name: '付款表', head: HEADS.pay, rows: payRows(b) },
  ];
  const enc = new TextEncoder();
  const wsFiles = sheets.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: enc.encode(sheetXml(s.head, s.rows)),
  }));
  const ctParts = sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const sheetEls = sheets.map((s, i) => `<sheet name="${escXml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const relEls = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const files = [
    { name: '[Content_Types].xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ctParts}</Types>`) },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
    { name: 'xl/workbook.xml', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetEls}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEls}</Relationships>`) },
    ...wsFiles,
  ];
  const bytes = makeZip(files);
  const suffix = tag ? `_${tag}` : '';
  // K15：不带完整时间戳；K19：4 位时分防撞 + 重名自动加序号（时间戳只留给备份）
  const name = uniqueName(`项目费用_${book.name}_${today}_${hm}${suffix}.xlsx`);
  download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
  return { sheets: sheets.length, rows: sheets.reduce((s, x) => s + x.rows.length, 0), name };
}

/**
 * 收款方对账单 CSV（C3）。三段：费用项 / 付款流水 / 小计。
 * 数字全部由调用方按 `payableOf / paidOf / dueOf` 现算传入，本函数只序列化，不重算口径。
 * @param {string} payee 收款方名称
 * @param {Array<{no:string, remark:string, payable:number, paid:number, due:number, dueDate:string}>} items 费用项行
 * @param {Array<{no:string, remark:string, date:string, method:string, amount:number, note:string, ref:string}>} pays 付款流水
 * @param {string} today 生成日期（YYYY-MM-DD，仅用于抬头）
 */
export function exportStatementCsv(payee, items = [], pays = [], today = '') {
  const block = (head, rows) => `${head.map(csvCell).join(',')}\n${rows.map((r) => r.map(csvCell).join(',')).join('\n')}`;
  const sumPayable = round2(items.reduce((s, x) => s + (+x.payable || 0), 0));
  const sumPaid = round2(items.reduce((s, x) => s + (+x.paid || 0), 0));
  const sumDue = round2(items.reduce((s, x) => s + (+x.due || 0), 0));
  const lines = [
    `对账单,${csvCell(payee)},${csvCell(today)}`,
    '',
    '# 费用项',
    block(['项目号', '费用备注', '应付', '已付', '待付', '到期日'], items.map((x) => [
      x.no, x.remark, round2(x.payable), round2(x.paid), round2(x.due), x.dueDate || '',
    ])),
    '',
    '# 付款流水',
    block(['项目号', '费用备注', '付款日期', '付款方式', '金额', '备注', '凭证号'], pays.map((x) => [
      x.no, x.remark, x.date, x.method, round2(x.amount), x.note || '', x.ref || '',
    ])),
    '',
    '# 小计',
    block(['应付合计', '已付合计', '待付合计'], [[sumPayable, sumPaid, sumDue]]),
  ];
  const csv = `\uFEFF${lines.join('\n')}`;
  const safe = String(payee || '收款方').replace(/[\\/:*?"<>|\s]/g, '_');
  download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `对账单_${safe}_${today}.csv`);
  return { items: items.length, pays: pays.length, sumPayable, sumPaid, sumDue };
}

export { fmt };
