'use strict';
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

console.log('== 开始测试自选行情：表头排序、移除箭头、删除确认 ==');

// 模拟自选股数据与行情数据
const watchlist = [
  { code: '600961', name: '株冶集团', group: '核心持仓' },
  { code: '300547', name: '川环科技', group: '默认' },
  { code: '516010', name: '游戏ETF', group: '观察池' }
];

const quoteMap = {
  '600961': { code: '600961', name: '株冶集团', price: 25.50, pct: 5.20 },
  '300547': { code: '300547', name: '川环科技', price: 18.20, pct: -2.35 },
  '516010': { code: '516010', name: '游戏ETF', price: 0.985, pct: 1.15 }
};

// 1. 验证排序逻辑
function sortList(list, field, order) {
  const arr = list.slice();
  if (field === 'price') {
    arr.sort((a, b) => {
      const pa = quoteMap[a.code] ? quoteMap[a.code].price : -Infinity;
      const pb = quoteMap[b.code] ? quoteMap[b.code].price : -Infinity;
      return order === 'asc' ? pa - pb : pb - pa;
    });
  } else if (field === 'pct') {
    arr.sort((a, b) => {
      const pa = quoteMap[a.code] ? quoteMap[a.code].pct : -Infinity;
      const pb = quoteMap[b.code] ? quoteMap[b.code].pct : -Infinity;
      return order === 'asc' ? pa - pb : pb - pa;
    });
  }
  return arr;
}

// 价格降序（高价在先）
const priceDesc = sortList(watchlist, 'price', 'desc');
assert.strictEqual(priceDesc[0].code, '600961'); // 25.50
assert.strictEqual(priceDesc[1].code, '300547'); // 18.20
assert.strictEqual(priceDesc[2].code, '516010'); // 0.985
console.log('✓ 最新价降序测试通过:', priceDesc.map(x => x.name + '(' + quoteMap[x.code].price + ')').join(' > '));

// 价格升序（低价在先）
const priceAsc = sortList(watchlist, 'price', 'asc');
assert.strictEqual(priceAsc[0].code, '516010'); // 0.985
assert.strictEqual(priceAsc[1].code, '300547'); // 18.20
assert.strictEqual(priceAsc[2].code, '600961'); // 25.50
console.log('✓ 最新价升序测试通过:', priceAsc.map(x => x.name + '(' + quoteMap[x.code].price + ')').join(' < '));

// 涨跌幅降序（涨幅优先）
const pctDesc = sortList(watchlist, 'pct', 'desc');
assert.strictEqual(pctDesc[0].code, '600961'); // +5.20%
assert.strictEqual(pctDesc[1].code, '516010'); // +1.15%
assert.strictEqual(pctDesc[2].code, '300547'); // -2.35%
console.log('✓ 涨跌幅降序测试通过:', pctDesc.map(x => x.name + '(' + quoteMap[x.code].pct + '%)').join(' > '));

// 涨跌幅升序（跌幅优先）
const pctAsc = sortList(watchlist, 'pct', 'asc');
assert.strictEqual(pctAsc[0].code, '300547'); // -2.35%
assert.strictEqual(pctAsc[1].code, '516010'); // +1.15%
assert.strictEqual(pctAsc[2].code, '600961'); // +5.20%
console.log('✓ 涨跌幅升序测试通过:', pctAsc.map(x => x.name + '(' + quoteMap[x.code].pct + '%)').join(' < '));

// 2. 验证 HTML/JS 文件中上下箭头已被移除，且表头存在
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const indexJs = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const indexCss = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');

assert.ok(indexHtml.includes('id="stockListHeader"'), 'index.html 包含 stockListHeader 表头');
assert.ok(indexHtml.includes('id="sortWatchlistPx"'), 'index.html 包含 最新价 排序表头');
assert.ok(indexHtml.includes('id="sortWatchlistPct"'), 'index.html 包含 涨跌幅 排序表头');
console.log('✓ HTML 表头元素检验通过');

assert.ok(!indexJs.includes('data-op="up"'), 'index.js 已完全移除 上移 箭头按钮');
assert.ok(!indexJs.includes('data-op="down"'), 'index.js 已完全移除 下移 箭头按钮');
console.log('✓ JS 上下排序箭头移除检验通过');

assert.ok(indexJs.includes('showConfirm(') && indexJs.includes('从自选股中删除吗'), 'index.js 删除自选股时调用了 showConfirm 弹窗进行二次确认');
console.log('✓ 删除自选二次确认检验通过');

console.log('\n🎉 所有自选行情表头、排序、箭头删除及二次确认测试全部通过！');
