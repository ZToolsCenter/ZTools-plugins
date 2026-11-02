/**
 * 文本解析（纯函数，无 vue / window / localStorage 依赖，可 node 单测）。
 *
 * 提供两类能力：
 *  1. `parseDelimited(text)`：把 TSV / CSV 文本切成二维数组，供 R1 批量粘贴与 X1 CSV 导入共用。
 *  2. `TABLE_COLS` / `mapRow(table, cells)`：X1 三表回读的列规格与「按列映射 + 基础校验」。
 *
 * CSV 切分带双引号转义，与 `export.js` 的 `csvCell` 对称（导出用双引号转义，导入也要能解回）。
 */
import { payPidOf } from './core';

/**
 * 解析一行 CSV（带双引号转义）。与 `export.js::csvCell` 对称的逆运算。
 * @param {string} line 单行文本
 * @returns {string[]} 单元格数组
 */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inq = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inq) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i += 1; } else { inq = false; }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inq = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 把 TSV / CSV 文本解析为二维数组。
 * 规则：
 *  ① 按 \n / \r\n / \r 切行，丢弃纯空白行；
 *  ② 自动探测主分隔符：首个非空行含 \t 则按 \t 切，否则按 CSV（带引号转义）；
 *  ③ 每个单元格 trim；
 *  ④ 返回二维数组（调用方按列映射）。
 * @param {string} text 原始粘贴 / 文件文本
 * @returns {string[][]}
 */
export function parseDelimited(text) {
  if (!text) return [];
  const rawLines = String(text).split(/\r\n|\r|\n/);
  const lines = [];
  for (const ln of rawLines) {
    if (!ln.trim()) continue; // 丢弃纯空白行
    lines.push(ln);
  }
  if (!lines.length) return [];
  const useTab = lines[0].includes('\t');
  return lines.map((ln) => {
    const parts = useTab ? ln.split('\t') : parseCsvLine(ln);
    return parts.map((c) => c.trim());
  });
}

/** X1 三表的列规格（中文表头，与导出 `export.js::HEADS` 顺序一致） */
export const TABLE_COLS = {
  project: ['项目号', '项目分类', '费用类型', '费用备注', '日期', '到期日', '总计', '优惠', '支付对象'],
  detail: ['项目号', '品名', '单位', '数量', '单价', '金额', '工艺', '备注', '预估'],
  // v1.6：付款表追加「付款编号」「作废」；这两列可缺省（用户自建表没填也能导）
  pay: ['项目号', '付款日期', '付款方式', '金额', '备注', '凭证号', '付款编号', '作废'],
};

/** 中文列名 → 内部字段名 */
const FIELDS = {
  project: [
    ['项目号', 'no'], ['项目分类', 'cat'], ['费用类型', 'sub'], ['费用备注', 'remark'],
    ['日期', 'date'], ['到期日', 'due'], ['总计', 'total'], ['优惠', 'discount'], ['支付对象', 'object'],
  ],
  detail: [
    ['项目号', 'no'], ['品名', 'name'], ['单位', 'unit'], ['数量', 'qty'], ['单价', 'price'],
    ['金额', 'amount'], ['工艺', 'craft'], ['备注', 'note'], ['预估', 'est'],
  ],
  pay: [
    ['项目号', 'no'], ['付款日期', 'date'], ['付款方式', 'method'], ['金额', 'amount'], ['备注', 'note'],
    ['凭证号', 'ref'], ['付款编号', 'pid'], ['作废', 'voidFlag'],
  ],
};

/**
 * 把「已切分的一行单元格数组」映射为内部对象，并做基础校验。
 * @param {'project'|'detail'|'pay'} table 表类型
 * @param {string[]} cells 该行的单元格（按列顺序）
 * @returns {object} 成功返回字段对象（字符串/数字原样），失败返回 `{ error: string }`
 */
export function mapRow(table, cells) {
  const fields = FIELDS[table];
  if (!fields) return { error: '未知表类型' };
  const obj = {};
  fields.forEach(([, field], i) => {
    obj[field] = (cells[i] ?? '').trim();
  });

  const num = (v) => {
    if (v === '' || v == null) return NaN;
    return parseFloat(String(v).replace(/,/g, ''));
  };

  if (table === 'project') {
    if (!obj.no) return { error: '缺少项目号' };
    if (!obj.remark) return { error: '缺少费用备注' };
    if (obj.total && Number.isNaN(num(obj.total))) return { error: '总计非数字' };
    if (obj.discount && Number.isNaN(num(obj.discount))) return { error: '优惠非数字' };
    obj.total = obj.total === '' ? 0 : num(obj.total);
    obj.discount = obj.discount === '' ? 0 : num(obj.discount);
    return obj;
  }
  if (table === 'detail') {
    if (!obj.no) return { error: '缺少项目号' };
    if (!obj.name) return { error: '缺少品名' };
    if (obj.qty && Number.isNaN(num(obj.qty))) return { error: '数量非数字' };
    if (obj.price && Number.isNaN(num(obj.price))) return { error: '单价非数字' };
    if (obj.amount && Number.isNaN(num(obj.amount))) return { error: '金额非数字' };
    obj.qty = obj.qty === '' ? null : num(obj.qty);
    obj.price = obj.price === '' ? null : num(obj.price);
    obj.amount = obj.amount === '' ? 0 : num(obj.amount);
    obj.est = obj.est === '是' ? '是' : '否';
    return obj;
  }
  if (table === 'pay') {
    if (!obj.no) return { error: '缺少项目号' };
    /**
     * C6（v1.7）：付款编号列在导出文件里写的是**付款全号**（`ZX0024-P0001`），
     * 入库前必须先剥掉项目号前缀，只留 `P0001`。
     *
     * 三种输入的处理（顺序不能反）：
     *   ① `ZX0024-P0001` → 剥前缀取 group1 → `P0001`；
     *   ② `P0001`        → 正则直通，原样保留；
     *   ③ 其它（`X1` / `abc` / 空）→ 返回 `''`，交给 `store` 按老规则补号。
     * **绝不把前缀写进库**：库里出现 `ZX0024-P0001` 会让 v1.6 的「原样导回 pid 集合不变」护栏失效。
     */
    obj.pid = payPidOf(obj.pid);
    // v1.6：有付款编号时日期可留空 —— 历史台账本来就有一批无日期付款（C1 §P0），
    // 强行要求日期会让「导出 → 原样导回」在这些行上丢数据。无编号的新行仍必须填日期。
    if (!obj.date && !obj.pid) return { error: '缺少付款日期' };
    if (obj.amount === '' || obj.amount == null || Number.isNaN(num(obj.amount))) return { error: '缺少或非法金额' };
    obj.amount = num(obj.amount);
    obj.voidFlag = obj.voidFlag === '是' || obj.voidFlag === 'true' || obj.voidFlag === '1';
    return obj;
  }
  return { error: '未知表类型' };
}

/**
 * C1（v1.7）表头别名：v1.7 起**界面**把「支付对象」改叫「收款方」、「事项」改叫「费用备注」，
 * 但 `HEADS` / `TABLE_COLS` 的导出列名与历史 CSV 仍是旧名（PRD 红线：导出表头一个字不改）。
 *
 * 因此这里做**单向兼容**：新名 → 规范（旧）名。用户拿 v1.7 界面的叫法自建表 / 手改表头，
 * 也照样能导入；反过来不需要（导出永远吐旧名）。
 *
 * K13（v1.8）别名扩展：在原有两条（收款方→支付对象、事项→费用备注）基础上，再覆盖
 * 收款方/费用备注的常见口语别名，提升手建表的导入鲁棒性。映射规则：
 *   - 收款方的口语别名（付款对象 / 收款人 / 往来单位 / 对方 …）→ 规范列「支付对象」；
 *   - 费用备注的口语别名后续可按需补充，目前仍只认「事项」。
 * 这些键**全部映射到导出/导入共用的规范中文列名**，因此别名表头导入后，导出→导回护栏
 * （HEADS 仍是规范名）完全不受影响 —— 别名只在「用户非规范表头」这一侧生效。
 */
export const COL_ALIAS = {
  收款方: '支付对象',
  事项: '费用备注',
  // K13：收款方常见别名 —— 统一收敛到规范列「支付对象」
  付款对象: '支付对象',
  收款人: '支付对象',
  往来单位: '支付对象',
  对方: '支付对象',
};

/**
 * 把一个表头单元格归一为规范列名（未登记的列原样返回，不影响位置兜底）。
 * @param {string} cell 表头单元格
 * @returns {string} 规范列名
 */
export function normalizeHeader(cell) {
  const s = String(cell ?? '').trim();
  return COL_ALIAS[s] || s;
}

/** 归一化整行表头（内部用；`isHeaderRow` 与 `alignByHeader` 必须共用，否则一张表两种判定） */
const normalizeHeaderRow = (cells) => (Array.isArray(cells) ? cells.map(normalizeHeader) : cells);

/**
 * 判断一行是否是该表的表头行（至少命中 2 个中文列名）。
 * 导出文件自带表头（且列比 `TABLE_COLS` 更多，例如明细表前置了品类/费用类型），
 * 直接按位置映射会错列，所以导入前必须先按表头对齐。
 *
 * C1（v1.7）：判定前先过 `normalizeHeader`。**只改 `alignByHeader` 不改这里是个真坑** ——
 * 一张表头只写「收款方」的表会因命中数 < 2 被判成数据行，随后整表按位置错位。
 * @param {'project'|'detail'|'pay'} table 表类型
 * @param {string[]} cells 该行单元格
 * @returns {boolean}
 */
export function isHeaderRow(table, cells) {
  const cols = TABLE_COLS[table];
  if (!cols || !Array.isArray(cells)) return false;
  return normalizeHeaderRow(cells).filter((c) => cols.includes(c)).length >= 2;
}

/**
 * 按表头把一行单元格重排成 `TABLE_COLS` 的顺序，供 `mapRow` 按位置映射。
 *
 * 兼容两种来源：
 *  ① `export.js` 导出的 CSV（列更多、顺序不同，靠中文表头名对齐）；
 *  ② 用户按 `TABLE_COLS` 顺序自建的表（无表头或表头对不上时原样返回，位置兜底）。
 *
 * C1（v1.7）：表头先过 `normalizeHeader`（与 `isHeaderRow` 同一份归一规则）。
 * @param {'project'|'detail'|'pay'} table 表类型
 * @param {string[]} header 表头行
 * @param {string[]} cells 数据行
 * @returns {string[]} 与 `TABLE_COLS[table]` 同序的单元格
 */
export function alignByHeader(table, header, cells) {
  const cols = TABLE_COLS[table];
  if (!cols || !Array.isArray(header) || !Array.isArray(cells)) return cells || [];
  const head = normalizeHeaderRow(header);
  const idx = cols.map((c) => head.indexOf(c));
  const hits = idx.filter((i) => i >= 0).length;
  if (hits < 2) return cells; // 表头对不上：按位置兜底，不破坏自建表
  return idx.map((i) => (i >= 0 ? (cells[i] ?? '') : ''));
}
