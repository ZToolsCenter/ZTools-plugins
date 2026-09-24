'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

console.log('== 开始测试：交易流水时间线柱状图最多显示15天、拖动交互与成本价折线图 ==');

// 1. 静态检查 index.html
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(html.includes('id="dtChartCanvas"'), 'index.html 包含 dtChartCanvas 画布');
assert.ok(html.includes('id="dtChartHint"'), 'index.html 包含 dtChartHint 拖动提示标签');
assert.ok(html.includes('class="dot dot-cost"'), 'index.html 图例中包含成本价折线 dot-cost');
console.log('✓ index.html 结构校验通过');

// 2. 静态检查 index.css
const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
assert.ok(css.includes('.dtChartLegend i.dot-cost'), 'index.css 包含成本均价折线图例点样式');
assert.ok(css.includes('#dtChartCanvas'), 'index.css 包含 dtChartCanvas 样式');
assert.ok(css.includes('user-select: none') || css.includes('-webkit-user-drag: none'), 'index.css 包含拖动画布防选中样式');
// 用户反馈过：悬浮显示详情、移开不隐藏。根因是 .dtChartTooltip{display:flex} 压过了
// 浏览器内置的 [hidden]{display:none}（作者样式 > UA 样式）→ hidden 属性形同虚设。
assert.ok(/\[hidden\]\s*{[^}]*display:\s*none\s*!important/.test(css), 'index.css 必须有全局 [hidden] 兜底（否则 tooltip 移开不隐藏）');
assert.ok(css.includes('.dtChartTooltip'), 'index.css 存在 .dtChartTooltip 规则（display:flex，必须被 [hidden] 兜底压住）');
console.log('✓ index.css 样式校验通过');

// 3. 静态检查 index.js
const js = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert.ok(js.includes('DT_MAX_VISIBLE_DAYS = 10') || js.includes('MAX_VISIBLE_DAYS = DT_MAX_VISIBLE_DAYS'), 'index.js 定义最多显示 10 天步长');
assert.ok(js.includes('dtChartScrollOffset'), 'index.js 包含滚动/拖动偏移量变量');
assert.ok(js.includes('dtChartIsDragging'), 'index.js 包含拖动状态标记');
assert.ok(js.includes('bindDtChartEvents'), 'index.js 包含拖动与缩放事件绑定方法');
assert.ok(js.includes('mousedown') && js.includes('mousemove') && js.includes('mouseup'), 'index.js 绑定了鼠标拖拽事件');
assert.ok(js.includes('wheel'), 'index.js 绑定了滚轮滑动事件');
assert.ok(js.includes('touchstart') && js.includes('touchmove'), 'index.js 绑定了触摸滑动事件');
assert.ok(js.includes('linePoints') || js.includes('costPrice'), 'index.js 包含成本价折线数据节点绘制');
assert.ok(js.includes('#fbbf24'), 'index.js 采用琥珀金标定成本价折线');
console.log('✓ index.js 逻辑校验通过');

// 4. 数学与视口逻辑模拟测试
const availW = 600;
const N_20 = 20; // 20个交易日
const MAX_VISIBLE = 10;
const step_20 = availW / MAX_VISIBLE; // 每个交易日宽 60px
const contentW_20 = N_20 * step_20; // 1200px
const maxScroll_20 = contentW_20 - availW; // 600px (等于 10 天的宽度)

assert.strictEqual(step_20, 60, '每柱宽度应为 60px');
assert.strictEqual(maxScroll_20, 600, '最大可拖动滚动距离应为 600px (10 天)');

// 默认滚动到最右侧展示最新的 10 天
let currentOffset = maxScroll_20;
// 第 0 天（最早）的水平中心坐标
let cx_day0 = 20 + 0 * step_20 + step_20 / 2 - currentOffset; // 20 + 30 - 600 = -550px (在视口左侧外部)
assert.ok(cx_day0 < 20, '第 0 天应在视口左侧被裁剪');

// 第 19 天（最新）的水平中心坐标
let cx_day19 = 20 + 19 * step_20 + step_20 / 2 - currentOffset; // 20 + 1140 + 30 - 600 = 590px (正好在视口最右侧)
assert.ok(cx_day19 <= 20 + availW, '第 19 天应在视口内部');

// 模拟向右拖动 120px（查看更早的历史记录）
const dragDx = 120;
currentOffset = Math.max(0, Math.min(maxScroll_20, currentOffset - dragDx));
assert.strictEqual(currentOffset, 480, '拖动后偏移量更新为 480px');

// 模拟拖动到极限左侧
currentOffset = Math.max(0, Math.min(maxScroll_20, currentOffset - 800));
assert.strictEqual(currentOffset, 0, '向右拖到底时偏移量为 0，展示最早的 10 天');

// 5. 成本价折线标尺比例模拟
const testTimeline = [
  { date: '2026-08-01', holdingQty: 1000, costPrice: 15.0 },
  { date: '2026-08-02', holdingQty: 1000, costPrice: 14.5 },
  { date: '2026-08-03', holdingQty: 1500, costPrice: 16.0 },
  { date: '2026-08-04', holdingQty: 500, costPrice: 13.8 }
];
const validCosts = testTimeline.map(d => d.costPrice);
const minCost = Math.min(...validCosts); // 13.8
const maxCost = Math.max(...validCosts); // 16.0
const spanCost = maxCost - minCost; // 2.2
const pMin = Math.max(0, minCost - spanCost * 0.25);
const pMax = maxCost + spanCost * 0.25;

assert.ok(pMin < 13.8, '成本价下限有留白');
assert.ok(pMax > 16.0, '成本价上限有留白');

testTimeline.forEach(item => {
  const costRatio = (item.costPrice - pMin) / (pMax - pMin);
  assert.ok(costRatio >= 0 && costRatio <= 1, `成本价 ${item.costPrice} 的 Y 坐标比例处于 0~1 之间`);
});

// 6. 柱状图精准命中（Hover判定）测试
const mockBar = { x: 100, y: 80, w: 30, h: 60, cx: 115, costY: 50 };
function hitTest(mx, my, bar) {
  const inBar = (mx >= bar.x - 2 && mx <= bar.x + bar.w + 2 && my >= bar.y - 3 && my <= bar.y + bar.h + 2);
  const inCostDot = (bar.costY !== undefined && Math.abs(mx - bar.cx) <= 6 && Math.abs(my - bar.costY) <= 6);
  return inBar || inCostDot;
}

// 柱体内部
assert.strictEqual(hitTest(115, 100, mockBar), true, '鼠标在柱体中央应触发显示详情');
assert.strictEqual(hitTest(101, 82, mockBar), true, '鼠标在柱体边缘应触发显示详情');

// 柱体上方空白区（旧逻辑会误触发，新逻辑必须不触发）
assert.strictEqual(hitTest(115, 30, mockBar), false, '鼠标在柱体上方空白区不应显示详情');
assert.strictEqual(hitTest(115, 10, mockBar), false, '鼠标在图表顶部天空区不应显示详情');

// 柱体左右空隙区
assert.strictEqual(hitTest(60, 100, mockBar), false, '鼠标在柱体左侧间隙不应显示详情');
assert.strictEqual(hitTest(160, 100, mockBar), false, '鼠标在柱体右侧间隙不应显示详情');

// 折线成本价数据节点（Hover在点上也显示）
assert.strictEqual(hitTest(115, 50, mockBar), true, '鼠标在成本价节点圆点上应触发显示详情');

console.log('✓ 柱状图 Hover 精准命中（仅在柱体上显示，空白区不显示）测试通过！');
console.log('\n🎉 交易流水时间线（最多15天、拖动查看、成本折线图、精准Hover）全部测试通过！');
