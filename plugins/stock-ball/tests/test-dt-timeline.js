'use strict';
const assert = require('assert');

function computeStockDailyTimeline(list) {
  if (!list || !list.length) return [];
  var sorted = list.slice().sort(function (a, b) {
    return new Date(a.created_at) - new Date(b.created_at);
  });

  var dateMap = new Map();
  sorted.forEach(function (t) {
    var d = String(t.created_at || '').slice(0, 10);
    if (!dateMap.has(d)) dateMap.set(d, []);
    dateMap.get(d).push(t);
  });

  var timeline = [];
  var runningQty = 0;
  var totalBuyCost = 0;
  var totalSellAmt = 0;
  var prevCostPrice = 0;

  dateMap.forEach(function (dayTxs, d) {
    var dayBuyQty = 0, dayBuyAmt = 0, dayBuyFees = 0;
    var daySellQty = 0, daySellAmt = 0, daySellFees = 0;

    dayTxs.forEach(function (t) {
      var q = Number(t.quantity) || 0;
      var p = Number(t.price) || 0;
      var amt = p * q;
      var fee = (Number(t.commission || 0) + Number(t.transfer_fee || 0) + Number(t.stamp_tax || 0));
      if (Number(t.type) === 1) {
        dayBuyQty += q;
        dayBuyAmt += amt;
        dayBuyFees += fee;
      } else {
        daySellQty += q;
        daySellAmt += amt;
        daySellFees += fee;
      }
    });

    var dayFees = dayBuyFees + daySellFees;
    var tQty = Math.min(dayBuyQty, daySellQty);
    var excessSellQty = Math.max(0, daySellQty - tQty);
    var dayBuyAvg = dayBuyQty > 0 ? (dayBuyAmt / dayBuyQty) : 0;
    var daySellAvg = daySellQty > 0 ? (daySellAmt / daySellQty) : 0;
    var costBuyAvg = dayBuyQty > 0 ? (dayBuyAvg + dayBuyFees / dayBuyQty) : 0;
    var netSellAvg = daySellQty > 0 ? (daySellAvg - daySellFees / daySellQty) : 0;

    var dayTPnLGross = tQty > 0 ? (daySellAvg - dayBuyAvg) * tQty : 0;
    var dayTPnL = tQty > 0 ? (netSellAvg - costBuyAvg) * tQty : 0;
    var daySellPnL = 0;
    var reduceQty = tQty > 0 ? excessSellQty : daySellQty;
    if (reduceQty > 0) {
      daySellPnL = (netSellAvg - prevCostPrice) * reduceQty;
    }
    var dayRealizedPnL = dayTPnL + daySellPnL;

    runningQty = runningQty + dayBuyQty - daySellQty;
    totalBuyCost += dayBuyAmt + dayBuyFees;
    totalSellAmt += daySellAmt - daySellFees;
    var netCost = totalBuyCost - totalSellAmt;
    var currentCostPrice = runningQty > 0 ? Math.max(0, netCost / runningQty) : 0;
    prevCostPrice = currentCostPrice;

    timeline.push({
      date: d,
      displayDate: d.slice(5),
      holdingQty: runningQty,
      costPrice: Number(currentCostPrice.toFixed(3)),
      dayBuyQty: dayBuyQty,
      dayBuyAmt: Number((dayBuyAmt + dayBuyFees).toFixed(2)),
      daySellQty: daySellQty,
      daySellAmt: Number((daySellAmt - daySellFees).toFixed(2)),
      tQty: tQty,
      excessSellQty: excessSellQty,
      dayTPnL: Number(dayTPnL.toFixed(2)),
      dayTPnLGross: Number(dayTPnLGross.toFixed(2)),
      daySellPnL: Number(daySellPnL.toFixed(2)),
      dayRealizedPnL: Number(dayRealizedPnL.toFixed(2)),
      dayFees: Number(dayFees.toFixed(2)),
      hasT: tQty > 0,
      hasSell: daySellQty > 0,
      isPureBuy: dayBuyQty > 0 && daySellQty === 0,
      txCount: dayTxs.length
    });
  });

  return timeline;
}

console.log('== 1. 测试买入加仓 -> 日内做T -> 减仓场景 ==');
const txs = [
  // Day 1: 买入 1000 股 @ 20.00
  { stock_code: '300547', type: 1, price: 20.00, quantity: 1000, total_price: 20000, created_at: '2026-08-01T10:00:00.000Z' },
  // Day 2: 早盘买入 500 股 @ 19.50，尾盘卖出 500 股 @ 20.50 (日内T赚500差价)
  { stock_code: '300547', type: 1, price: 19.50, quantity: 500, total_price: 9750, created_at: '2026-08-02T09:45:00.000Z' },
  { stock_code: '300547', type: 2, price: 20.50, quantity: 500, total_price: 10250, created_at: '2026-08-02T14:30:00.000Z' },
  // Day 3: 卖出 500 股 @ 22.00
  { stock_code: '300547', type: 2, price: 22.00, quantity: 500, total_price: 11000, created_at: '2026-08-03T10:15:00.000Z' }
];

const tl = computeStockDailyTimeline(txs);
console.log('时间线统计结果:', JSON.stringify(tl, null, 2));

assert.strictEqual(tl.length, 3, '应有3个交易日');
// Day 1
assert.strictEqual(tl[0].date, '2026-08-01');
assert.strictEqual(tl[0].holdingQty, 1000, 'Day 1 持仓应为 1000');
assert.strictEqual(tl[0].costPrice, 20.00, 'Day 1 成本应为 20.00');
assert.strictEqual(tl[0].dayTPnL, 0, 'Day 1 纯买入无T盈亏');

// Day 2
assert.strictEqual(tl[1].date, '2026-08-02');
assert.strictEqual(tl[1].holdingQty, 1000, 'Day 2 持仓仍为 1000');
assert.strictEqual(tl[1].costPrice, 19.50, 'Day 2 做T后摊薄成本应降为 19.50');
assert.strictEqual(tl[1].hasT, true, 'Day 2 有做T操作');
assert.strictEqual(tl[1].dayTPnL, 500.00, 'Day 2 做T盈利应为 +500.00');

// Day 3
assert.strictEqual(tl[2].date, '2026-08-03');
assert.strictEqual(tl[2].holdingQty, 500, 'Day 3 减仓后持仓应为 500');
// 纯卖出日没有日内对倒，T盈亏为0；卖出差价收益归入“减仓已实现”
assert.strictEqual(tl[2].hasT, false, 'Day 3 无日内T');
assert.strictEqual(tl[2].dayTPnL, 0, 'Day 3 无T对倒，T盈亏应为0');
assert.strictEqual(tl[2].daySellPnL, 1250.00, 'Day 3 减仓已实现收益应为 (22 - 19.5) * 500 = 1250');
assert.strictEqual(tl[2].dayRealizedPnL, 1250.00, 'Day 3 当日已实现总盈亏应为 1250');

console.log('\n✓ 历史时间线每日持仓、成本价与做T盈亏核算测试全部通过！\n');

console.log('== 2. 测试做T盈亏已计入手续费（且只计一次） ==');
// Day1 建仓 1000 股 @20（含费）
const feeTxs = [
  { stock_code: '600519', type: 1, price: 20.00, quantity: 1000, commission: 5, transfer_fee: 0.2, stamp_tax: 0, created_at: '2026-09-01T10:00:00.000Z' },
  // Day2 日内T：买500@19.5，卖500@20.5
  { stock_code: '600519', type: 1, price: 19.50, quantity: 500, commission: 5, transfer_fee: 0.1, stamp_tax: 0, created_at: '2026-09-02T09:45:00.000Z' },
  { stock_code: '600519', type: 2, price: 20.50, quantity: 500, commission: 5, transfer_fee: 0.1, stamp_tax: 5.13, created_at: '2026-09-02T14:30:00.000Z' }
];

const feeTl = computeStockDailyTimeline(feeTxs);
const day2 = feeTl[1];
// 毛差价 = (20.5 - 19.5) * 500 = 500
// 当日手续费 = 买(5+0.1) + 卖(5+0.1+5.13) = 15.33
const expectedNet = 500 - (5 + 0.1) - (5 + 0.1 + 5.13);
console.log('Day2 做T盈亏(含费一次):', day2.dayTPnL, ' 期望:', Number(expectedNet.toFixed(2)));
assert.strictEqual(day2.dayTPnL, Number(expectedNet.toFixed(2)), '做T盈亏应已扣减手续费且只扣一次');
assert.strictEqual(day2.dayFees, Number((5 + 0.1 + 5 + 0.1 + 5.13).toFixed(2)), '当日手续费合计应正确');
// 展宽成本应包含买卖双向手续费：Day1 成本 = (20000+5.2)/1000
assert.strictEqual(feeTl[0].costPrice, Number(((20000 + 5.2) / 1000).toFixed(3)), 'Day1 展宽成本应含买入手续费');
console.log('\n✓ 做T手续费核算（只计一次）测试通过！\n');

console.log('== 3. 真实场景：川环科技(300547) 2026-09-22 反T ==');
// 当日：卖 100@25.69、卖 100@26.73、买回 100@25.94
// 同花顺口径毛T盈亏 = (卖出均价26.21 - 买入均价25.94) * 100 = 27.00
const realTxs = [
  { stock_code: '300547', type: 2, price: 25.69, quantity: 100, commission: 0.22, transfer_fee: 0, stamp_tax: 1.28, created_at: '2026-09-22T01:32:11.954Z' },
  { stock_code: '300547', type: 2, price: 26.73, quantity: 100, commission: 0.23, transfer_fee: 0, stamp_tax: 1.34, created_at: '2026-09-22T01:52:14.529Z' },
  { stock_code: '300547', type: 1, price: 25.94, quantity: 100, commission: 0.22, transfer_fee: 0, stamp_tax: 0, created_at: '2026-09-22T05:01:52.626Z' }
];
const realTl = computeStockDailyTimeline(realTxs);
const td = realTl[0];
// 对倒100股：买费0.22，卖费摊销 = (0.22+1.28+0.23+1.34)/200*100 = 1.535
const expectedRealNet = 27 - 0.22 - ((0.22 + 1.28 + 0.23 + 1.34) / 200 * 100);
console.log('毛T盈亏:', td.dayTPnLGross, '(同花顺 27.00)');
console.log('净T盈亏:', td.dayTPnL, ' 期望:', Number(expectedRealNet.toFixed(2)));
assert.strictEqual(td.tQty, 100, '对倒数量应为 100 股');
assert.strictEqual(td.excessSellQty, 100, '超出对倒的 100 股为减仓');
assert.strictEqual(td.dayTPnLGross, 27.00, '毛T盈亏应与同花顺一致 = 27.00');
assert.ok(Math.abs(td.dayTPnL - expectedRealNet) < 0.01, '净T盈亏应扣除对倒双边手续费');
assert.strictEqual(td.dayTPnL > 0, true, '净T盈亏应为正');
console.log('\n✓ 川环科技反T核算与同花顺口径一致测试通过！\n');
