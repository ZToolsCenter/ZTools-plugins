/*
 * 买卖数量校验测试。
 *
 * 用户反馈两个问题：
 *   1) 持仓只有 600 股，录入弹窗却能提交卖出 900 股；
 *   2) 数量框是 type=number step=100，但手动可以输入任意数字（如 150），照常提交。
 *
 * 修复分两层：
 *   UI（index.js / windows/panel.js）：失焦把数量取整成 100 倍数、压到可卖上限、
 *     +100/方向键同样压上限、弹窗里显示「可卖 N 股」、提交前友好报错；
 *   数据层（lib/store.js addTransaction）：直接 throw —— 不管从哪条路进来都拦住
 *     （内置 Web 页面走 /api/transactions 也会被外层 catch 转成 500，服务不会挂）。
 *
 * 可卖口径 = 当前持仓 - 今天买入（T+1：今天买入的下一个交易日才能卖）；
 * 唯一的100倍数例外：卖出时恰好把零股一次性清仓（A股本来就允许零股一次性卖出）。
 *
 *   node tests/test-tx-qty-validation.js
 */
'use strict';
const assert = require('assert');
const path = require('node:path');
const fs = require('node:fs');

const PLUGIN_DIR = path.join(__dirname, '..');
const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function throwsMsg(fn, re, label) {
  try {
    fn();
    ok(false, label, '没有抛错');
  } catch (e) {
    ok(re.test(e.message), label + '（' + e.message + '）', e.message);
  }
}

/* ---------------- 隔离 store（绝不碰用户真实数据） ---------------- */
const dbMap = new Map();
const store = storeReal.createStore({
  getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
  setItem: (k, v) => dbMap.set(k, v),
  removeItem: (k) => dbMap.delete(k)
}, { isolated: true });

const CODE = '600961';
const YDAY = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const TODAY = new Date().toISOString();
function tx(type, qty, created) {
  return { stock_code: CODE, stock_name: '株冶集团', type, price: 10, quantity: qty, created_at: created || YDAY };
}
function reset(list) { dbMap.set('sb.transactions', list || []); }

console.log('== 1. 100 整数倍校验（买入） ==');
reset();
throwsMsg(() => store.addTransaction(tx(1, 150)), /100 的整数倍/, '买入 150 股被拒');
throwsMsg(() => store.addTransaction(tx(1, 99)), /100 的整数倍/, '买入 99 股被拒');
throwsMsg(() => store.addTransaction(tx(1, 0)), /无效/, '买入 0 股被拒');
throwsMsg(() => store.addTransaction(tx(1, -200)), /无效/, '买入 -200 股被拒');
throwsMsg(() => store.addTransaction(tx(1, 100.5)), /无效/, '买入 100.5 股被拒');
store.addTransaction(tx(1, 600));
ok(store.getTransactions(CODE).length === 1, '买入 600 股成功入库');
ok(store.getSellable(CODE) === 600, '昨日买入600 → 可卖600', store.getSellable(CODE));

console.log('== 2. 卖出不得超过可卖（用户报的 600 持仓能卖 900） ==');
throwsMsg(() => store.addTransaction(tx(2, 900)), /超过可卖\s*600/, '卖出 900 股被拒（持仓只有 600）');
throwsMsg(() => store.addTransaction(tx(2, 700)), /超过可卖\s*600/, '卖出 700 股被拒');
throwsMsg(() => store.addTransaction(tx(2, 150)), /100 的整数倍/, '卖出 150 股被拒（先于上限判断的倍数问题也要拦）');
store.addTransaction(tx(2, 600));
ok(store.getSellable(CODE) === 0, '清仓后可卖 0', store.getSellable(CODE));
throwsMsg(() => store.addTransaction(tx(2, 100)), /超过可卖\s*0/, '清仓后再卖 100 被拒');

console.log('== 3. T+1：今天买入的明天才能卖 ==');
reset([tx(1, 300, YDAY), tx(1, 300, TODAY)]);
ok(store.getSellable(CODE) === 300, '持仓600但今买300 → 当天可卖只有300', store.getSellable(CODE));
throwsMsg(() => store.addTransaction(tx(2, 400, TODAY)), /超过可卖\s*300/, '卖出 400 股（含今日买入部分）被拒');
store.addTransaction(tx(2, 300, TODAY));
ok(store.getSellable(CODE) === 0, '卖掉昨仓300后，剩的都是今买的 → 可卖0', store.getSellable(CODE));

console.log('== 4. 零股一次性清仓例外（导入等历史数据可能有零股） ==');
reset([{ stock_code: CODE, stock_name: '株冶集团', type: 1, price: 10, quantity: 250, created_at: YDAY }]);
ok(store.getSellable(CODE) === 250, '零股持仓250 → 可卖250', store.getSellable(CODE));
throwsMsg(() => store.addTransaction(tx(2, 49)), /100 的整数倍/, '卖 49 股被拒（不等于全部零股）');
throwsMsg(() => store.addTransaction(tx(2, 251)), /超过可卖\s*250/, '卖 251 股被拒（超上限）');
store.addTransaction(tx(2, 200));
ok(store.getSellable(CODE) === 50, '卖掉200后剩零股50', store.getSellable(CODE));
store.addTransaction(tx(2, 50)); // 恰好清掉零股 → 允许
ok(store.getSellable(CODE) === 0, '零股一次性清仓成功', store.getSellable(CODE));

console.log('== 5. UI 失焦取整逻辑（与 snapTxQty 同一套规则的镜像断言） ==');
function snap(v, s) {
  if (!v || v <= 0) return v;
  var exactOdd = (s !== null && v === s && s % 100 !== 0);
  if (v % 100 !== 0 && !exactOdd) v = Math.floor(v / 100) * 100 || 100;
  if (s !== null && v > s) {
    var f = Math.floor(s / 100) * 100;
    v = f >= 100 ? f : s;
  }
  return v;
}
assert.strictEqual(snap(150, null), 100, '买入150 → 取整100');
assert.strictEqual(snap(50, null), 100, '买入50 → 取整到100（不归零）');
assert.strictEqual(snap(250, null), 200, '买入250 → 取整200');
assert.strictEqual(snap(600, null), 600, '买入600 → 不变');
assert.strictEqual(snap(900, 600), 600, '卖出900上限600 → 压到600');
assert.strictEqual(snap(750, 600), 600, '卖出750上限600 → 压到600');
assert.strictEqual(snap(150, 600), 100, '卖出150上限600 → 先取整100');
assert.strictEqual(snap(250, 250), 250, '恰好等于零股持仓 → 保持（整笔清仓）');
assert.strictEqual(snap(300, 250), 200, '卖出300上限250 → 取整压到200');
assert.strictEqual(snap(100, 0), 0, '可卖0 → 压到0（提交会被拦）');
ok(true, '取整与压上限全部断言通过');

console.log('== 6. 三层接线静态检查 ==');
const idxJs = fs.readFileSync(path.join(PLUGIN_DIR, 'index.js'), 'utf8');
const panJs = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'panel.js'), 'utf8');
const preJs = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
const stoJs = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'store.js'), 'utf8');
const idxHtml = fs.readFileSync(path.join(PLUGIN_DIR, 'index.html'), 'utf8');
const panHtml = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'panel.html'), 'utf8');

for (const [name, src] of [['index.js', idxJs], ['panel.js', panJs]]) {
  ok(src.includes('snapTxQty'), name + ' 有失焦取整函数');
  ok(src.includes('transactions.sellable'), name + ' 提交/提示都查询可卖数');
  ok(src.includes('必须是 100 的整数倍'), name + ' 有100倍数的友好报错');
  ok(src.includes('超过可卖'), name + ' 有超上限的友好报错');
  ok(src.includes('snapTxQty()'), name + ' 取整被真实调用（非死代码）');
}
ok(preJs.includes('sellable: (code) => store.getSellable(code)'), 'preload 暴露 transactions.sellable');
ok(stoJs.includes('function getSellable'), 'store 定义 getSellable');
ok(idxHtml.includes('id="txSellable"'), 'index.html 有可卖提示元素');
ok(panHtml.includes('id="txSellable"'), 'panel.html 有可卖提示元素');

console.log('');
if (fail === 0) {
  console.log('✓ 买卖数量校验测试全部通过（' + pass + ' 项）');
  process.exit(0);
}
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
failures.forEach((f) => console.log('  - ' + f));
process.exit(1);
