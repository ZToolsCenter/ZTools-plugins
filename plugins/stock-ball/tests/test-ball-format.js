const assert = require('assert');
function fmtProfit(v) {
  if (v === null || v === undefined || isNaN(v)) return '--';
  var abs = Math.abs(v);
  if (abs >= 1e8) {
    var yi = abs / 1e8;
    return (yi >= 10 ? yi.toFixed(1) : yi.toFixed(2)).replace(/\.0$/, '') + '亿';
  }
  if (abs >= 1e4) {
    var wan = abs / 1e4;
    return (wan >= 10 ? wan.toFixed(1) : (Math.round(wan * 10) / 10).toFixed(1)).replace(/\.0$/, '') + '万';
  }
  if (abs >= 1000) {
    var k = abs / 1000;
    return (k >= 10 ? k.toFixed(1) : (Math.round(k * 10) / 10).toFixed(1)).replace(/\.0$/, '') + 'k';
  }
  if (abs >= 100) return String(Math.round(abs));
  if (abs >= 1) return (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
  return (Math.round(abs * 100) / 100).toFixed(2).replace(/\.00$/, '');
}
function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '--';
  return Math.abs(v).toFixed(2) + '%';
}
assert.strictEqual(fmtProfit(1500), '1.5k');
assert.strictEqual(fmtProfit(-1500), '1.5k');
assert.strictEqual(fmtProfit(1280), '1.3k');
assert.strictEqual(fmtProfit(1000), '1k');
assert.strictEqual(fmtProfit(380), '380');
assert.strictEqual(fmtProfit(-10000), '1万');
assert.strictEqual(fmtProfit(128000), '12.8万');
assert.strictEqual(fmtProfit(8), '8');
assert.strictEqual(fmtProfit(8.2), '8.2');
assert.strictEqual(fmtProfit(0), '0');
assert.strictEqual(fmtPct(2.35), '2.35%');
assert.strictEqual(fmtPct(-1.48), '1.48%');
console.log('✓ 悬浮球新格式化测试全部通过！');
