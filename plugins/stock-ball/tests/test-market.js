/* 数据层真实网络测试：node tests/test-market.js [--proxy=auto|direct|url] */
'use strict';
const path = require('node:path');
const market = require(path.join(__dirname, '..', 'lib', 'market.js'));
const { getLearnedProxy } = require(path.join(__dirname, '..', 'lib', 'httpclient.js'));

const arg = process.argv.find((a) => a.indexOf('--proxy=') === 0);
const proxy = arg ? arg.split('=')[1] : 'auto';
const opt = () => ({ proxy });

function line(s) { console.log(s); }

(async () => {
  let fail = 0;
  const t0 = Date.now();

  try {
    const qs = await market.quotes(['1.600961', '0.300547', '1.516010'], opt());
    line('【批量行情】' + qs.length + ' 条');
    qs.forEach((q) => line('  ' + q.code + ' ' + q.name + ' 价=' + q.price + ' 涨幅=' + q.pct + '% 昨收=' + q.prevClose + ' 最高=' + q.high + ' 最低=' + q.low));
    if (!qs.length || qs[0].price === null) { fail++; line('  ✗ 行情为空'); }
  } catch (e) { fail++; line('✗ 批量行情失败: ' + e.message); }

  try {
    const ix = await market.indexes(opt());
    line('【大盘指数】' + ix.length + ' 条');
    ix.forEach((i) => line('  ' + i.name + ' ' + i.price + ' ' + i.pct + '%'));
    if (ix.length < 3) { fail++; line('  ✗ 指数不足'); }
  } catch (e) { fail++; line('✗ 指数失败: ' + e.message); }

  try {
    const t = await market.trend('1.600961', opt());
    line('【分时】' + t.code + ' 昨收=' + t.prevClose + ' 点数=' + t.items.length + ' 首=' + (t.items[0] && t.items[0].time + '@' + t.items[0].price) + ' 末=' + (t.items[t.items.length - 1] && t.items[t.items.length - 1].time + '@' + t.items[t.items.length - 1].price));
    if (t.items.length < 10) { fail++; line('  ✗ 分时点数太少'); }
  } catch (e) { fail++; line('✗ 分时失败: ' + e.message); }

  try {
    const d = await market.detail('0.300547', opt());
    line('【个股详情】' + d.code + ' ' + d.name + ' 价=' + d.price + ' 换手=' + d.turnover + ' 量比=' + d.volumeRatio + ' 流通市值=' + d.floatCap + ' 行业=' + d.industry);
    if (!d.name) { fail++; line('  ✗ 详情为空'); }
  } catch (e) { fail++; line('✗ 详情失败: ' + e.message); }

  try {
    const r = await market.search('川环', opt());
    line('【搜索】' + r.length + ' 条 -> ' + r.slice(0, 4).map((x) => x.name + '(' + x.secid + ')').join(', '));
    if (!r.length) { fail++; line('  ✗ 搜索为空'); }
  } catch (e) { fail++; line('✗ 搜索失败: ' + e.message); }

  try {
    const rZhuye = await market.search('zhuye', opt());
    line('【拼音搜索 zhuye】' + rZhuye.slice(0, 3).map((x) => x.name + '(' + x.secid + ')').join(', '));
    if (!rZhuye.length || !rZhuye.some((x) => x.code === '600961')) {
      fail++; line('  ✗ 拼音 zhuye 未查找到株冶集团');
    }
  } catch (e) { fail++; line('✗ 拼音搜索 zhuye 失败: ' + e.message); }

  try {
    const r2 = await market.search('600961', opt());
    line('【按代码搜索】' + r2.slice(0, 3).map((x) => x.name + '(' + x.secid + ')').join(', '));
  } catch (e) { fail++; line('✗ 按代码搜索失败: ' + e.message); }

  line('市场状态: ' + JSON.stringify(market.marketStatus()));
  line('secid 归一化: 600961→' + market.toSecid('600961') + ' sh600961→' + market.toSecid('sh600961') + ' 300547→' + market.toSecid('300547') + ' 516010→' + market.toSecid('516010'));
  line('学到的代理: ' + (getLearnedProxy() || '直连'));
  line('耗时 ' + ((Date.now() - t0) / 1000).toFixed(2) + 's，失败项 ' + fail);
  process.exit(fail ? 1 : 0);
})();
