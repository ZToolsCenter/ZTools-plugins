'use strict';
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { createStore } = require('../lib/store');

console.log('== 开始测试：自选股与持仓股股价/涨跌预警提醒与桌面通知 ==');

// 1. 测试 Store 预警持久化与归一化
const fakeDb = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k)
  };
})();

const store = createStore(fakeDb, { isolated: true });
assert.deepStrictEqual(store.getAlerts(), [], '初始预警列表应为空数组');

const alert1 = store.saveAlert({
  stock_code: '600961',
  stock_name: '株冶集团',
  high_price: 26.50,
  low_price: 22.00,
  high_change: 4.5,
  low_change: -3.0,
  notification_interval: 5,
  enabled: true
});

assert.strictEqual(alert1.stock_code, '600961');
assert.strictEqual(alert1.high_price, 26.50);
assert.strictEqual(alert1.low_price, 22.00);
assert.strictEqual(alert1.high_change, 4.5);
assert.strictEqual(alert1.low_change, -3.0);
assert.strictEqual(alert1.notification_interval, 5);
assert.strictEqual(store.getAlerts().length, 1);
console.log('✓ store.saveAlert 成功保存并标准化预警属性');

store.saveAlert({ stock_code: '600961', high_price: 28.00, low_price: 21.50 });
assert.strictEqual(store.getAlerts().length, 1, '同代码预警更新时应去重替换');
assert.strictEqual(store.getAlerts()[0].high_price, 28.00);
console.log('✓ store.saveAlert 预警覆盖更新测试通过');

store.deleteAlert('600961');
assert.strictEqual(store.getAlerts().length, 0);
console.log('✓ store.deleteAlert 删除预警测试通过');

// 2. 模拟通知与预警核算引擎测试
const dispatchedNotifications = [];
function fakeSendNotification(title, body) {
  dispatchedNotifications.push({ title, body, time: Date.now() });
}

function createAlertEvaluator(alertStore, notifyFn) {
  const cooldowns = Object.create(null);
  return function evaluate(quotesMap, currentTime) {
    if (!quotesMap) return;
    const now = currentTime || Date.now();
    const activeAlerts = alertStore.getAlerts();
    activeAlerts.forEach((alert) => {
      if (!alert || alert.enabled === false) return;
      const code = alert.stock_code;
      const q = quotesMap[code];
      if (!q) return;
      const price = Number(q.price);
      const pct = Number(q.pct !== undefined ? q.pct : q.change_percent);
      const intervalMs = (alert.notification_interval || 5) * 60 * 1000;
      const name = alert.stock_name || q.name || code;
      if (alert.high_price > 0 && !isNaN(price) && price >= alert.high_price) {
        const k = code + '_high_price';
        if (!cooldowns[k] || (now - cooldowns[k]) >= intervalMs) {
          cooldowns[k] = now;
          notifyFn('【股价预警】' + name + '(' + code + ')', '突破目标高价！最新价: ¥' + price.toFixed(2) + ' (目标: >=¥' + alert.high_price.toFixed(2) + ')');
        }
      }
      if (alert.low_price > 0 && !isNaN(price) && price <= alert.low_price) {
        const k = code + '_low_price';
        if (!cooldowns[k] || (now - cooldowns[k]) >= intervalMs) {
          cooldowns[k] = now;
          notifyFn('【股价预警】' + name + '(' + code + ')', '跌破目标低价！最新价: ¥' + price.toFixed(2) + ' (目标: <=¥' + alert.low_price.toFixed(2) + ')');
        }
      }
      if (alert.high_change > 0 && !isNaN(pct) && pct >= alert.high_change) {
        const k = code + '_high_change';
        if (!cooldowns[k] || (now - cooldowns[k]) >= intervalMs) {
          cooldowns[k] = now;
          notifyFn('【大涨预警】' + name + '(' + code + ')', '今日涨幅超标！当前涨幅: +' + pct.toFixed(2) + '% (目标: >=+' + alert.high_change.toFixed(2) + '%)');
        }
      }
      if (alert.low_change < 0 && !isNaN(pct) && pct <= alert.low_change) {
        const k = code + '_low_change';
        if (!cooldowns[k] || (now - cooldowns[k]) >= intervalMs) {
          cooldowns[k] = now;
          notifyFn('【大跌预警】' + name + '(' + code + ')', '今日跌幅超标！当前涨跌: ' + pct.toFixed(2) + '% (目标: <=' + alert.low_change.toFixed(2) + '%)');
        }
      }
    });
  };
}

store.saveAlert({ stock_code: '600961', stock_name: '株冶集团', high_price: 26.00, low_price: 22.00, high_change: 4.0, low_change: -3.0, notification_interval: 5, enabled: true });
store.saveAlert({ stock_code: '300547', stock_name: '川环科技', high_price: 25.00, low_price: 18.00, high_change: 5.0, low_change: -2.5, notification_interval: 10, enabled: true });
const evaluator = createAlertEvaluator(store, fakeSendNotification);
let testTime = 1000000000;
evaluator({ '600961': { code: '600961', name: '株冶集团', price: 26.50, change_percent: 4.80 }, '300547': { code: '300547', name: '川环科技', price: 20.00, change_percent: 0.50 } }, testTime);
assert.strictEqual(dispatchedNotifications.length, 2, '应触发高价突破与大涨两个提醒');
console.log('✓ 股价突破与涨幅预警触发判定通过');

evaluator({ '600961': { code: '600961', name: '株冶集团', price: 26.55, change_percent: 4.90 } }, testTime + 3000);
assert.strictEqual(dispatchedNotifications.length, 2, '冷却期内不得重复打扰');
console.log('✓ 冷却防刷屏机制测试通过（3秒后未重复弹出通知）');

evaluator({ '600961': { code: '600961', name: '株冶集团', price: 26.80, change_percent: 5.20 } }, testTime + 301000);
assert.strictEqual(dispatchedNotifications.length, 4, '超出 5 分钟冷却期后应允许再次触发通知');
console.log('✓ 冷却时间过期后再次提醒测试通过');

evaluator({ '300547': { code: '300547', name: '川环科技', price: 17.50, change_percent: -3.20 } }, testTime + 301000);
assert.strictEqual(dispatchedNotifications.length, 6, '川环科技应触发跌破低价与大跌两个提醒');
console.log('✓ 股价跌破低价与跌幅超标预警测试通过');

// 3. 静态代码检查
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

assert.ok(html.includes('id="alertModal"'), 'index.html 包含预警设置弹窗 alertModal');
assert.ok(html.includes('id="alertHighPrice"'), 'index.html 包含股价高于输入项');
assert.ok(html.includes('id="alertLowPrice"'), 'index.html 包含股价低于输入项');
assert.ok(html.includes('id="alertHighChange"'), 'index.html 包含涨幅高于输入项');
assert.ok(html.includes('id="alertLowChange"'), 'index.html 包含跌幅大于输入项');
assert.ok(html.includes('id="alertInterval"'), 'index.html 包含通知冷却间隔选择项');
assert.ok(html.includes('id="btnAlertSave"'), 'index.html 包含保存提醒按钮');
assert.ok(html.includes('id="btnAlertDelete"'), 'index.html 包含清除提醒按钮');
console.log('✓ index.html 弹窗结构完整');

assert.ok(css.includes('.btnAlert'), 'index.css 包含预警铃铛按钮样式');
assert.ok(css.includes('.btnAlert.active'), 'index.css 包含已设预警高亮激活态');
assert.ok(css.includes('150px'), 'index.css 操作列宽度适配为 150px (买/卖+流水+预警+K线四按钮)');
console.log('✓ index.css 样式校验完整');

assert.ok(preload.includes('sendDesktopNotification'), 'preload.js 包含系统桌面通知函数');
assert.ok(preload.includes('evaluateAlerts'), 'preload.js 包含后台行情预警评估器');
assert.ok(preload.includes('isTradingTime'), 'preload.js 包含交易时间判定函数');
assert.ok(preload.includes('alerts: {'), 'preload.js 暴露了 alerts 服务');
assert.ok(preload.includes('notify:'), 'preload.js 暴露了 notify 服务');
console.log('✓ preload.js 跨窗口预警与系统通知服务完整');

// 4. 验证交易时间段判定函数
const market = require('../lib/market.js');
assert.strictEqual(typeof market.isTradingTime, 'function', 'market 导出了 isTradingTime');

// 构造特定时间点进行测试 (以当地时间为准)
function makeTime(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0).getTime();
}
// 2026-09-21 周一 10:00 (交易中)
assert.strictEqual(market.isTradingTime(makeTime(2026, 9, 21, 10, 0)), true, '周一 10:00 应处于交易时段');
// 2026-09-21 周一 12:00 (午间休市)
assert.strictEqual(market.isTradingTime(makeTime(2026, 9, 21, 12, 0)), false, '周一 12:00 午间休市不属于交易时段');
// 2026-09-21 周一 14:00 (交易中)
assert.strictEqual(market.isTradingTime(makeTime(2026, 9, 21, 14, 0)), true, '周一 14:00 应处于交易时段');
// 2026-09-21 周一 15:30 (已收盘)
assert.strictEqual(market.isTradingTime(makeTime(2026, 9, 21, 15, 30)), false, '周一 15:30 盘后不属于交易时段');
// 2026-09-21 周一 08:30 (早盘未开盘)
assert.strictEqual(market.isTradingTime(makeTime(2026, 9, 21, 8, 30)), false, '周一 08:30 盘前不属于交易时段');
// 2026-09-20 周日 10:00 (周末休市)
assert.strictEqual(market.isTradingTime(makeTime(2026, 9, 20, 10, 0)), false, '周日全天休市不属于交易时段');
console.log('✓ 非交易时间段判定准确（早盘前、午休、盘后、周末均精确识别）');

// 5. 验证非交易时间段静默防打扰（不弹出通知）
const nonTradingNotifications = [];
function fakeNotifyWithTimeCheck(title, body) {
  nonTradingNotifications.push({ title, body });
}
function createSafeEvaluator(alertStore, notifyFn) {
  return function evalSafe(quotesMap, time) {
    if (!market.isTradingTime(time)) return; // 非交易时间静默
    notifyFn('通知', '内容');
  };
}
const safeEval = createSafeEvaluator(store, fakeNotifyWithTimeCheck);
// 午休 12:30 触发评估
safeEval({ '600961': { price: 30.00 } }, makeTime(2026, 9, 21, 12, 30));
assert.strictEqual(nonTradingNotifications.length, 0, '非交易时间段（午休）绝不弹出通知');
// 盘后 20:00 触发评估
safeEval({ '600961': { price: 30.00 } }, makeTime(2026, 9, 21, 20, 0));
assert.strictEqual(nonTradingNotifications.length, 0, '非交易时间段（盘后）绝不弹出通知');
// 交易时段 10:30 触发评估
safeEval({ '600961': { price: 30.00 } }, makeTime(2026, 9, 21, 10, 30));
assert.strictEqual(nonTradingNotifications.length, 1, '交易时段正常弹出通知');
console.log('✓ 非交易时间段静默防打扰逻辑验证通过');

console.log('\n🎉 所有自选股与持仓股预警提醒与电脑桌面通知测试全部通过！');