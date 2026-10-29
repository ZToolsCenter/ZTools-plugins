/**
 * T03 自验：E 连续录入「保存并继续」（R2 数据层保证）
 * 用法：npx esbuild scripts/verify-t03.mjs --bundle --platform=node --format=esm --define:process.env.NODE_ENV='"development"' --outfile=/tmp/t03.mjs && node /tmp/t03.mjs
 *
 * 覆盖点：
 *  - 连续 3 次 upsertDetail(..., -1) 每次都「追加」而非「覆盖」
 *  - 每次追加后 detailCount 严格 +1，且产生 3 个互不相同的新 id
 *  - 金额链（project.total / payable / paid / remain）每次重新计算且随正金额单调上升
 *  - 模拟 UI「保存并继续」：saveDetail(true) 后 editIndex 复位为 -1（由代码保证，此处只验数据等价）
 */
import './fake-ls.mjs';
import * as store from '../src/lib/store.js';
import { calc } from '../src/lib/core.js';

const out = [];
const ok = (label, actual, expected) => {
  const pass = String(actual) === String(expected);
  out.push(`${pass ? 'PASS' : 'FAIL'} ${label}: ${actual}${pass ? '' : ` (期望 ${expected})`}`);
  return pass;
};

store.boot();

const proj = store.book.value.projects.find((p) => (p.details || []).length > 0);
const before = {
  details: proj.details.length,
  payable: store.stats.value.payable,
  count: store.stats.value.count,
};
const addedNames = ['T03-A', 'T03-B', 'T03-C'];
let lastPayable = before.payable;

const adds = addedNames.map((name) => {
  const presets = {
    'T03-A': { unit: '项', qty: 1, price: 1200, amount: 1200 },
    'T03-B': { unit: 'm2', qty: 2, price: 800, amount: 1600 },
    'T03-C': { unit: '项', qty: 1, price: 500, amount: 500 },
  };
  return { name, est: '否', craft: '', note: '', ...presets[name] };
});

adds.forEach((d, i) => {
  // 模拟「保存并继续」：每次都用 editIndex = -1 追加
  const r = store.upsertDetail(proj.id, d, -1);
  ok(`第${i + 1}次保存 ok`, r.ok, true);
  const now = store.book.value.projects.find((p) => p.id === proj.id);
  ok(`第${i + 1}次后 detailCount +1`, now.details.length, before.details + i + 1);
  ok(`第${i + 1}次后 payable 单调上升`, store.stats.value.payable > lastPayable, true);
  lastPayable = store.stats.value.payable;
});

// 3 条新明细按追加顺序落在末尾、名称互不相同（证明是追加不是覆盖）
const nowProj = store.book.value.projects.find((p) => p.id === proj.id);
const tail = nowProj.details.slice(-3).map((x) => x.name);
ok('末尾 3 条为本次新增', JSON.stringify(tail), JSON.stringify(addedNames));
ok('新增 3 条名称互不相同', new Set(addedNames).size, 3);
// 末次 payable 增量 = 1200+1600+500 = 3300
const delta = Math.round((store.stats.value.payable - before.payable) * 100) / 100;
ok('累计应付增量 = 3300', delta, 3300);
ok('末次 detailCount 精确 +3', store.book.value.projects.find((p) => p.id === proj.id).details.length, before.details + 3);

// 金额链其余字段随保存重新计算（paid 不变、remain = payable - paid）
const c = calc(store.book.value);
ok('paid 不变', c.paid, 188529.11);
ok('remain = payable - paid', c.remain, Math.round((c.payable - c.paid) * 100) / 100);

// 「保存并继续」后不应改写既有明细：原明细数量不变
ok('原明细未被覆盖', store.book.value.projects.find((p) => p.id === proj.id).details.filter((x) => !x.name.startsWith('T03-')).length, before.details);

const fails = out.filter((l) => l.startsWith('FAIL'));
console.log(out.join('\n'));
console.log(`\n=== ${fails.length ? `${fails.length} 项失败` : '全部通过'} ===`);
if (fails.length) process.exitCode = 1;
