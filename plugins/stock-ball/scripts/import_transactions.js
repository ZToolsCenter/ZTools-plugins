'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const SOURCE_PATH = 'C:/Users/pc/Downloads/stock_transactions.json';
const TARGET_PATH = path.join(os.homedir(), '.ztools-stock-ball.json');

console.log('读取来源文件:', SOURCE_PATH);
if (!fs.existsSync(SOURCE_PATH)) {
  console.error('错误: 文件不存在:', SOURCE_PATH);
  process.exit(1);
}

const rawList = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8'));
console.log('读取到原始交易记录条数:', rawList.length);

// 1. 规范化交易记录
const stockNameMap = {};
const formattedTransactions = rawList.map((t) => {
  const code = String(t.stock_code || '').replace(/[^\d]/g, '').slice(0, 6);
  const name = String(t.stock_name || code).trim();
  stockNameMap[code] = name;

  const isBuy = Number(t.type) === 1;
  const price = Number(t.price);
  const qty = Number(t.quantity);
  const amt = price * qty;
  const totalPrice = Number(t.total_price != null ? t.total_price : amt);

  return {
    id: t.id,
    created_at: new Date(t.created_at).toISOString(),
    stock_code: code,
    stock_name: name,
    price: price,
    quantity: qty,
    type: isBuy ? 1 : 2, // 1: 买入, 2: 卖出
    amount: Math.round(amt * 100) / 100,
    total_price: Math.round(totalPrice * 100) / 100,
    commission: Number(t.commission || 0),
    transfer_fee: Number(t.transfer_fee || 0),
    stamp_tax: Number(t.stamp_tax || 0),
    remark: t.remark || null
  };
});

// 按时间正序排序
formattedTransactions.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

// 2. 读取或初始化目标数据文件
let targetData = {};
if (fs.existsSync(TARGET_PATH)) {
  try {
    targetData = JSON.parse(fs.readFileSync(TARGET_PATH, 'utf8')) || {};
  } catch (e) {
    targetData = {};
  }
}

// 3. 更新交易记录
targetData['sb.transactions'] = formattedTransactions;

// 4. 同步更新自选股列表，确保所有交易个股在自选行情中可见
const existingWatchlist = targetData['sb.watchlist'] || [];
const existingCodes = new Set(existingWatchlist.map((x) => x.code));

const newWatchlist = existingWatchlist.slice();
for (const [code, name] of Object.entries(stockNameMap)) {
  if (!existingCodes.has(code)) {
    const secid = (/^[659]/.test(code) ? '1.' : '0.') + code;
    newWatchlist.push({
      code,
      secid,
      name,
      group: '默认'
    });
    existingCodes.add(code);
  }
}
targetData['sb.watchlist'] = newWatchlist;

if (!targetData['sb.watchlistGroups']) {
  targetData['sb.watchlistGroups'] = ['默认', '核心持仓', '观察池'];
}

// 5. 写入目标文件
fs.writeFileSync(TARGET_PATH, JSON.stringify(targetData, null, 2), 'utf8');
console.log('✓ 成功写入插件数据文件:', TARGET_PATH);

// 6. 核算当前有效持仓与盈亏
const posMap = {};
for (const t of formattedTransactions) {
  if (!posMap[t.stock_code]) {
    posMap[t.stock_code] = {
      code: t.stock_code,
      name: t.stock_name,
      qty: 0,
      totalBuy: 0,
      totalSell: 0,
      txCount: 0
    };
  }
  const s = posMap[t.stock_code];
  s.txCount++;
  if (t.type === 1) {
    s.qty += t.quantity;
    s.totalBuy += t.total_price;
  } else {
    s.qty -= t.quantity;
    s.totalSell += t.total_price;
  }
}

console.log('\n================ 持仓统计核算报告 ================');
let totalHoldingValueEst = 0;
let totalCostAll = 0;
for (const [code, s] of Object.entries(posMap)) {
  const netCost = s.totalBuy - s.totalSell;
  if (s.qty > 0) {
    const costPerShare = netCost / s.qty;
    totalCostAll += netCost;
    console.log(
      `💼 ${s.name} (${code}): 持仓 ${s.qty} 股 | 摊薄成本单价 ¥${costPerShare.toFixed(3)} | 净投入成本 ¥${netCost.toFixed(2)} | 交易次数 ${s.txCount} 笔`
    );
  } else {
    console.log(`⚪ ${s.name} (${code}): 已清仓 (0 股) | 已实现累计差额收益 ¥${(s.totalSell - s.totalBuy).toFixed(2)} | 交易次数 ${s.txCount} 笔`);
  }
}
console.log('--------------------------------------------------');
console.log('累计买入笔数:', formattedTransactions.filter((x) => x.type === 1).length);
console.log('累计卖出笔数:', formattedTransactions.filter((x) => x.type === 2).length);
console.log('总交易记录数:', formattedTransactions.length);
console.log('==================================================');
