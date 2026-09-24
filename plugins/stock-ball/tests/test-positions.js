'use strict';
/**
 * 持仓股票与悬浮球整体盈利计算测试
 */
const assert = require('assert');
const { createStore } = require('../lib/store.js');

async function runTests() {
  console.log('== 1. 测试虚拟内存 Store 的持仓与交易记录 ==');
  const db = new Map();
  const mockStorage = {
    getItem: (k) => (db.has(k) ? db.get(k) : null),
    setItem: (k, v) => db.set(k, v),
    removeItem: (k) => db.delete(k)
  };

  const store = createStore(mockStorage, { isolated: true });

  // 初始应无持仓
  let summary = store.getPositionsSummary();
  assert.strictEqual(summary.count, 0, '初始持仓应为0');
  assert.strictEqual(summary.totalMarketValue, 0, '初始市值为0');
  assert.strictEqual(summary.totalProfitLoss, 0, '初始浮盈为0');

  console.log('== 2. 录入两笔买入交易 ==');
  // 买入 1000 股 600961 株冶集团，单价 20.00，金额 20000
  store.addTransaction({
    stock_code: '600961',
    stock_name: '株冶集团',
    type: 1, // 买入
    price: 20.00,
    quantity: 1000,
    total_price: 20000.00,
    created_at: '2026-08-01T10:00:00.000Z'
  });

  // 买入 500 股 300547 川环科技，单价 24.00，金额 12000
  store.addTransaction({
    stock_code: '300547',
    stock_name: '川环科技',
    type: 1, // 买入
    price: 24.00,
    quantity: 500,
    total_price: 12000.00,
    created_at: '2026-08-01T10:00:00.000Z'
  });

  const txs = store.getTransactions();
  assert.strictEqual(txs.length, 2, '应有2条交易记录');

  console.log('== 3. 模拟实时行情注入，验证整体股票持仓盈利计算 ==');
  // 假定 600961 当前涨到 25.00 (+5.00，涨25%)，今日涨 1.20
  // 假定 300547 当前跌到 22.00 (-2.00，跌8.33%)，今日跌 0.50
  const mockQuotes = {
    '600961': { price: 25.00, change: 1.20, pct: 5.04 },
    '300547': { price: 22.00, change: -0.50, pct: -2.22 }
  };

  summary = store.getPositionsSummary(mockQuotes);
  console.log('整体盈利汇总:', JSON.stringify(summary, null, 2));

  // 600961 市值 = 1000 * 25 = 25000, 成本 = 20000, 浮盈 = +5000, 今日盈亏 = 1000 * 1.2 = +1200
  // 300547 市值 = 500 * 22 = 11000, 成本 = 12000, 浮盈 = -1000, 今日盈亏 = 500 * (-0.5) = -250
  // 总体市值 = 25000 + 11000 = 36000
  // 总体成本 = 20000 + 12000 = 32000
  // 总体浮盈 = 5000 - 1000 = +4000
  // 总体浮盈率 = 4000 / 32000 = 12.5%
  // 总体今日盈亏 = 1200 - 250 = +950

  assert.strictEqual(summary.count, 2, '持仓股票数应为2');
  assert.strictEqual(summary.totalMarketValue, 36000.00, '持仓总市值应为36000');
  assert.strictEqual(summary.totalCost, 32000.00, '总成本应为32000');
  assert.strictEqual(summary.totalProfitLoss, 4000.00, '总浮盈应为+4000');
  assert.strictEqual(summary.totalProfitLossRate, 12.50, '总浮盈率应为12.5%');
  assert.strictEqual(summary.todayProfitLoss, 950.00, '今日总盈亏应为+950');

  console.log('== 4. 录入卖出减仓交易 ==');
  // 卖出 500 股 600961，单价 25.00，发生额 12500
  store.addTransaction({
    stock_code: '600961',
    stock_name: '株冶集团',
    type: 2, // 卖出
    price: 25.00,
    quantity: 500,
    total_price: 12500.00,
    created_at: new Date().toISOString()
  });

  const pAfterSell = store.getAllPositions(mockQuotes);
  const zy = pAfterSell.find((p) => p.stock_code === '600961');
  assert.strictEqual(zy.quantity, 500, '剩余持仓应为500股');

  console.log('== 5. 删除交易记录 ==');
  const firstTxId = txs[0].id;
  store.deleteTransaction(firstTxId);
  const txsAfterDel = store.getTransactions();
  assert.strictEqual(txsAfterDel.length, 2, '删除一条后剩余2条');

  console.log('\n✓ 持仓股票与悬浮球整体盈利计算测试全部通过！\n');
}

runTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
