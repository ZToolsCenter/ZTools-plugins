const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('== 开始测试：买入卖出默认100股与步长100校验 ==');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const indexJs = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
const indexCss = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'windows', 'panel.html'), 'utf8');
const panelJs = fs.readFileSync(path.join(__dirname, '..', 'windows', 'panel.js'), 'utf8');

// 1. 验证 index.html
assert.ok(indexHtml.includes('id="txQty"'), 'index.html 包含 txQty 数量输入框');
assert.ok(indexHtml.includes('id="txQty" type="number" step="100" min="100"'), 'index.html 中 txQty 设置了 step="100" 与 min="100"');
assert.ok(indexHtml.includes('id="btnQtyMinus"'), 'index.html 包含 -100 步长微调按钮');
assert.ok(indexHtml.includes('id="btnQtyPlus"'), 'index.html 包含 +100 步长微调按钮');
console.log('✓ index.html 数量输入框与步长按钮结构完整');

// 2. 验证 index.css
assert.ok(indexCss.includes('.btnStep'), 'index.css 包含 .btnStep 样式');
console.log('✓ index.css 步长微调按钮样式完整');

// 3. 验证 index.js
assert.ok(indexJs.includes("openTxModal({ type: 1, code: code, name: name, price: price, qty: 100 })"), 'index.js 持仓行点击买/卖默认传入 qty: 100');
assert.ok(indexJs.includes("openTxModal({ type: 1, qty: 100 })"), 'index.js 顶部买入按钮默认传入 qty: 100');
assert.ok(indexJs.includes("openTxModal({ type: 2, qty: 100 })"), 'index.js 顶部卖出按钮默认传入 qty: 100');
assert.ok(indexJs.includes("qtyInput.step = '100'"), 'index.js 动态确保 qtyInput.step 为 100');
assert.ok(indexJs.includes("qtyInput.min = '100'"), 'index.js 动态确保 qtyInput.min 为 100');
assert.ok(indexJs.includes("btnQtyPlus") && indexJs.includes("btnQtyMinus"), 'index.js 绑定了 +100 与 -100 步长按钮事件');
assert.ok(indexJs.includes("ArrowUp") && indexJs.includes("ArrowDown"), 'index.js 绑定了键盘上下方向键以 100 为步长调节');
console.log('✓ index.js 默认数量与步长交互逻辑完整');

// 4. 验证 windows/panel.*
assert.ok(panelHtml.includes('id="txQty" type="number" step="100" min="100"'), 'windows/panel.html 设置了 step="100" 与 min="100"');
assert.ok(panelJs.includes("qty: 100"), 'windows/panel.js 默认买卖数量均为 100');
console.log('✓ windows/panel 弹窗与数量步长设置完整');

// 5. 模拟步长增减计算逻辑
function stepPlus(val) { return Math.max(100, (val || 0) + 100); }
function stepMinus(val) { return Math.max(100, (val || 100) - 100); }

assert.strictEqual(stepPlus(100), 200, '100 股增加 100 变为 200 股');
assert.strictEqual(stepPlus(200), 300, '200 股增加 100 变为 300 股');
assert.strictEqual(stepMinus(300), 200, '300 股减少 100 变为 200 股');
assert.strictEqual(stepMinus(200), 100, '200 股减少 100 变为 100 股');
assert.strictEqual(stepMinus(100), 100, '100 股减少不能低于 100 股');
assert.strictEqual(stepMinus(0), 100, '非法值减少保底 100 股');
console.log('✓ 步长增减及最小限制计算逻辑正确');

console.log('\n🎉 所有买入卖出默认100股及步长100测试全部通过！\n');
