const assert = require('assert');
const { createStore } = require('../lib/store.js');

console.log('== 开始测试：券商标准当日盈亏计算（含底仓变动、今日买入、今日卖出与做T） ==');

// 1. 测试场景：用户真实场景（川环科技 300547）
// 昨日持有 1500 股，昨收价 25.35
// 今日卖出 2 笔：100股 @ 25.69 (实得 2567.50), 100股 @ 26.73 (实得 2671.44)
// 当前剩余 1300 股，现价 25.96
{
  const store = createStore(null, { isolated: true });
  // 昨日买入 1500 股
  store.addTransaction({
    stock_code: '300547',
    stock_name: '川环科技',
    type: 1,
    price: 25.00,
    quantity: 1500,
    total_price: 37500.00,
    created_at: '2026-09-20T10:00:00.000Z'
  });

  // 今日卖出第1笔 100股
  store.addTransaction({
    stock_code: '300547',
    stock_name: '川环科技',
    type: 2,
    price: 25.69,
    quantity: 100,
    total_price: 2567.50,
    created_at: new Date().toISOString()
  });

  // 今日卖出第2笔 100股
  store.addTransaction({
    stock_code: '300547',
    stock_name: '川环科技',
    type: 2,
    price: 26.73,
    quantity: 100,
    total_price: 2671.44,
    created_at: new Date().toISOString()
  });

  const mockQuotes = {
    '300547': { price: 25.96, change: 0.61, prevClose: 25.35 }
  };

  const positions = store.getAllPositions(mockQuotes);
  const ch = positions.find(p => p.stock_code === '300547');

  assert.strictEqual(ch.quantity, 1300, '剩余持仓应为1300股');
  assert.strictEqual(ch.today_sell_quantity, 200, '今日卖出股数应为200股');
  
  // (1300 * 25.96 + 2567.50 + 2671.44) - (1500 * 25.35) = (33748 + 5238.94) - 38025 = 961.94
  const expectedPl = Number(((1300 * 25.96 + 2567.50 + 2671.44) - (1500 * 25.35)).toFixed(2));
  assert.strictEqual(ch.today_profit_loss, expectedPl, '川环科技今日盈亏应为 961.94');
  console.log(`✓ 场景1（川环科技上午卖两手）测试通过：今日盈亏 = ${ch.today_profit_loss} 元（与券商收益一致）`);
}

// 2. 测试场景：单纯持股不动（无今日买卖）
{
  const store = createStore(null, { isolated: true });
  store.addTransaction({
    stock_code: '600961',
    stock_name: '株冶集团',
    type: 1,
    price: 20.00,
    quantity: 1000,
    total_price: 20000.00,
    created_at: '2026-08-01T10:00:00.000Z'
  });
  const mockQuotes = {
    '600961': { price: 25.00, change: 1.20, prevClose: 23.80 }
  };
  const p = store.getAllPositions(mockQuotes)[0];
  assert.strictEqual(p.today_profit_loss, 1200.00, '无买卖时今日盈亏应为 1000 * 1.2 = 1200');
  console.log('✓ 场景2（单纯持股无交易）测试通过：今日盈亏 = +1200 元');
}

// 3. 测试场景：今日日内做T
// 底仓1000股，昨收20.00；今日20.20买入200股(4040)，21.20卖出200股(4240)；现价21.00
// 盈亏 = (1000*21 + 4240) - (1000*20 + 4040) = 25240 - 24040 = +1200
{
  const store = createStore(null, { isolated: true });
  store.addTransaction({
    stock_code: '600000',
    type: 1,
    price: 20.00,
    quantity: 1000,
    total_price: 20000.00,
    created_at: '2026-08-01T10:00:00.000Z'
  });
  store.addTransaction({
    stock_code: '600000',
    type: 1,
    price: 20.20,
    quantity: 200,
    total_price: 4040.00,
    created_at: new Date().toISOString()
  });
  store.addTransaction({
    stock_code: '600000',
    type: 2,
    price: 21.20,
    quantity: 200,
    total_price: 4240.00,
    created_at: new Date().toISOString()
  });
  const mockQuotes = {
    '600000': { price: 21.00, change: 1.00, prevClose: 20.00 }
  };
  const p = store.getAllPositions(mockQuotes)[0];
  assert.strictEqual(p.today_profit_loss, 1200.00, '做T后今日盈亏应为 1200');
  console.log('✓ 场景3（日内做T）测试通过：今日盈亏 = +1200 元');
}

// 4. 测试场景：今日清仓卖出
// 昨日持仓 200 股，昨收 20.00；今日 22.00 全部卖出(实得 4400)
// 现价 22.00，持仓 0 股；今日盈亏 = 4400 - 200*20 = +400
{
  const store = createStore(null, { isolated: true });
  store.addTransaction({
    stock_code: '000001',
    type: 1,
    price: 20.00,
    quantity: 200,
    total_price: 4000.00,
    created_at: '2026-08-01T10:00:00.000Z'
  });
  store.addTransaction({
    stock_code: '000001',
    type: 2,
    price: 22.00,
    quantity: 200,
    total_price: 4400.00,
    created_at: new Date().toISOString()
  });
  const mockQuotes = {
    '000001': { price: 22.00, change: 2.00, prevClose: 20.00 }
  };
  const summary = store.getPositionsSummary(mockQuotes);
  assert.strictEqual(summary.todayProfitLoss, 400.00, '清仓后今日总盈亏应包含今日卖出收益 +400');
  console.log('✓ 场景4（今日清仓卖出）测试通过：今日盈亏 = +400 元');
}

console.log('\n🎉 所有券商标准当日盈亏计算测试全部通过！\n');
