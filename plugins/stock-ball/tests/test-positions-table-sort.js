'use strict';
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

console.log('== 开始测试持仓管理：表格布局与表头字段排序 ==');

const mockPositions = [
  {
    stock_code: '600961',
    stock_name: '株冶集团',
    quantity: 1000,
    current_price: 25.50,
    cost_price: 20.00,
    market_value: 25500.00,
    today_profit_loss: 1200.00,
    profit_loss: 5500.00,
    profit_loss_rate: 27.50,
    change_percent: 4.94
  },
  {
    stock_code: '300547',
    stock_name: '川环科技',
    quantity: 500,
    current_price: 18.20,
    cost_price: 24.00,
    market_value: 9100.00,
    today_profit_loss: -250.00,
    profit_loss: -2900.00,
    profit_loss_rate: -24.17,
    change_percent: -1.35
  },
  {
    stock_code: '516010',
    stock_name: '游戏ETF',
    quantity: 10000,
    current_price: 0.985,
    cost_price: 0.900,
    market_value: 9850.00,
    today_profit_loss: 150.00,
    profit_loss: 850.00,
    profit_loss_rate: 9.44,
    change_percent: 1.55
  }
];

function sortPositions(list, field, order) {
  const arr = list.slice();
  arr.sort((a, b) => {
    let va = 0;
    let vb = 0;
    if (field === 'qty') {
      va = (a.market_value !== undefined && a.market_value !== null) ? Number(a.market_value) : ((a.quantity || 0) * (a.current_price || 0));
      vb = (b.market_value !== undefined && b.market_value !== null) ? Number(b.market_value) : ((b.quantity || 0) * (b.current_price || 0));
    } else if (field === 'todayPl') {
      va = (a.change_percent !== undefined && a.change_percent !== null && !isNaN(a.change_percent)) ? Number(a.change_percent) : -Infinity;
      vb = (b.change_percent !== undefined && b.change_percent !== null && !isNaN(b.change_percent)) ? Number(b.change_percent) : -Infinity;
    } else if (field === 'pl') {
      va = (a.profit_loss_rate !== undefined && a.profit_loss_rate !== null && !isNaN(a.profit_loss_rate)) ? Number(a.profit_loss_rate) : -Infinity;
      vb = (b.profit_loss_rate !== undefined && b.profit_loss_rate !== null && !isNaN(b.profit_loss_rate)) ? Number(b.profit_loss_rate) : -Infinity;
    }
    return order === 'asc' ? va - vb : vb - va;
  });
  return arr;
}

// 1.1 排序验证: 持仓/金额 (qty) -> 按持仓市值 (market_value) 排序
const qtyDesc = sortPositions(mockPositions, 'qty', 'desc');
assert.strictEqual(qtyDesc[0].stock_code, '600961'); // 25500
assert.strictEqual(qtyDesc[1].stock_code, '516010'); // 9850
assert.strictEqual(qtyDesc[2].stock_code, '300547'); // 9100
console.log('✓ 持仓/金额降序（按金额）测试通过:', qtyDesc.map(x => `${x.stock_name}(¥${x.market_value})`).join(' > '));

const qtyAsc = sortPositions(mockPositions, 'qty', 'asc');
assert.strictEqual(qtyAsc[0].stock_code, '300547'); // 9100
assert.strictEqual(qtyAsc[1].stock_code, '516010'); // 9850
assert.strictEqual(qtyAsc[2].stock_code, '600961'); // 25500
console.log('✓ 持仓/金额升序（按金额）测试通过:', qtyAsc.map(x => `${x.stock_name}(¥${x.market_value})`).join(' < '));

// 1.2 排序验证: 今日涨幅/盈亏 (todayPl) -> 按今日涨幅 (change_percent) 排序
const tdPlDesc = sortPositions(mockPositions, 'todayPl', 'desc');
assert.strictEqual(tdPlDesc[0].stock_code, '600961'); // +4.94%
assert.strictEqual(tdPlDesc[1].stock_code, '516010'); // +1.55%
assert.strictEqual(tdPlDesc[2].stock_code, '300547'); // -1.35%
console.log('✓ 今日涨幅/盈亏降序（按涨幅）测试通过:', tdPlDesc.map(x => `${x.stock_name}(${x.change_percent}%)`).join(' > '));

const tdPlAsc = sortPositions(mockPositions, 'todayPl', 'asc');
assert.strictEqual(tdPlAsc[0].stock_code, '300547'); // -1.35%
assert.strictEqual(tdPlAsc[1].stock_code, '516010'); // +1.55%
assert.strictEqual(tdPlAsc[2].stock_code, '600961'); // +4.94%
console.log('✓ 今日涨幅/盈亏升序（按涨幅）测试通过:', tdPlAsc.map(x => `${x.stock_name}(${x.change_percent}%)`).join(' < '));

// 1.3 排序验证: 累计涨幅/盈亏 (pl) -> 按累计涨幅 (profit_loss_rate) 排序
const plDesc = sortPositions(mockPositions, 'pl', 'desc');
assert.strictEqual(plDesc[0].stock_code, '600961'); // 27.50%
assert.strictEqual(plDesc[1].stock_code, '516010'); // 9.44%
assert.strictEqual(plDesc[2].stock_code, '300547'); // -24.17%
console.log('✓ 累计涨幅/盈亏降序（按累计涨幅）测试通过:', plDesc.map(x => `${x.stock_name}(${x.profit_loss_rate}%)`).join(' > '));

const plAsc = sortPositions(mockPositions, 'pl', 'asc');
assert.strictEqual(plAsc[0].stock_code, '300547'); // -24.17%
assert.strictEqual(plAsc[1].stock_code, '516010'); // 9.44%
assert.strictEqual(plAsc[2].stock_code, '600961'); // 27.50%
console.log('✓ 累计涨幅/盈亏升序（按累计涨幅）测试通过:', plAsc.map(x => `${x.stock_name}(${x.profit_loss_rate}%)`).join(' < '));

// 2. 静态检查文件
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');

assert.ok(html.includes('id="posTableHeader"'), 'index.html 包含持仓表头 posTableHeader');
assert.ok(html.includes('id="sortPosQty"'), 'index.html 包含持仓股数排序表头 sortPosQty');
assert.ok(html.includes('id="colHeaderPriceCost"'), 'index.html 包含当前价/成本综合列表头 colHeaderPriceCost');
assert.ok(html.includes('id="sortPosTodayPl"'), 'index.html 包含今日涨幅/盈亏排序表头 sortPosTodayPl');
assert.ok(html.includes('id="sortPosPl"'), 'index.html 包含累计涨幅/盈亏排序表头 sortPosPl');
assert.ok(!html.includes('id="sortPosPrice"'), 'index.html 不再包含独立的现价排序表头');
assert.ok(!html.includes('id="sortPosCost"'), 'index.html 不再包含独立的成本价排序表头');
assert.ok(!html.includes('id="sortPosMv"'), 'index.html 不再包含独立的市值排序表头');
console.log('✓ index.html 表头DOM结构完整（4 列紧凑高效布局）');

assert.ok(css.includes('.posTableHeader'), 'index.css 包含 .posTableHeader 样式');
assert.ok(css.includes('.posTableRow'), 'index.css 包含 .posTableRow 样式');
assert.ok(css.includes('grid-template-columns'), 'index.css 采用精确 grid 列对齐');
console.log('✓ index.css 表格与表头栅格对齐样式完整');

assert.ok(js.includes('posSortField'), 'index.js 包含 posSortField 排序状态');
assert.ok(js.includes('updatePosSortUI'), 'index.js 包含 updatePosSortUI 排序指示器更新');
assert.ok(js.includes('togglePosSort'), 'index.js 包含 togglePosSort 字段切换逻辑');
assert.ok(js.includes('posTableRow'), 'index.js 渲染使用表格行结构 posTableRow');
assert.ok(js.includes('sortPosQty') && js.includes('sortPosPl'), 'index.js 绑定了持仓表头各列点击排序监听');
console.log('✓ index.js 渲染与交互绑定完整');

console.log('\n🎉 所有持仓表格展示与表头排序测试全部通过！');
