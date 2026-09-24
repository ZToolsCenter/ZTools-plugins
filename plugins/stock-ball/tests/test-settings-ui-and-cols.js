'use strict';
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { createStore, DEFAULT_SETTINGS } = require('../lib/store.js');

console.log('== 开始测试：设置界面持仓自定义显示列、交易费率二次界面与表单排版 ==');

// 1. 测试 store 对 posColumns 的默认值与规范化
assert.ok(Array.isArray(DEFAULT_SETTINGS.posColumns), 'DEFAULT_SETTINGS 包含 posColumns 数组');
assert.deepStrictEqual(DEFAULT_SETTINGS.posColumns, ['qty', 'priceCost', 'todayPl', 'pl']);
console.log('✓ store DEFAULT_SETTINGS posColumns 测试通过');

const db = new Map();
const mockStorage = {
  getItem: (k) => (db.has(k) ? db.get(k) : null),
  setItem: (k, v) => db.set(k, v),
  removeItem: (k) => db.delete(k)
};
const store = createStore(mockStorage, { isolated: true });
let s = store.getSettings();
assert.deepStrictEqual(s.posColumns, ['qty', 'priceCost', 'todayPl', 'pl']);

// 测试 patchSettings 自定义列
store.patchSettings({ posColumns: ['qty', 'todayPl', 'pl'] });
s = store.getSettings();
assert.deepStrictEqual(s.posColumns, ['qty', 'todayPl', 'pl']);

// 测试全部取消勾选：保存为空数组 [] 时应保持空数组，不能错误回退到全部列
store.patchSettings({ posColumns: [] });
s = store.getSettings();
assert.deepStrictEqual(s.posColumns, [], '全部取消勾选时 posColumns 应能持久化为空数组 []');
console.log('✓ store patchSettings 自定义列及全空数组持久化测试通过');

// 2. 静态检查 index.html
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// 持仓显示列复选框（已移至持仓表头操作列下拉浮层）
assert.ok(html.includes('id="btnPosColMenu"'), 'index.html 表头包含显示列菜单按钮 btnPosColMenu');
assert.ok(html.includes('id="posColDropdown"'), 'index.html 表头包含显示列下拉菜单 posColDropdown');

const settingsSection = html.slice(html.indexOf('id="viewSettings"'), html.indexOf('id="txModal"'));
assert.ok(!settingsSection.includes('持仓表格显示列'), '设置页不再展示「持仓表格显示列」');

const colIds = ['colCfgQty', 'colCfgPriceCost', 'colCfgTodayPl', 'colCfgPl'];
colIds.forEach(id => {
  assert.ok(html.includes(`id="${id}"`), `index.html 包含持仓显示列复选框 ${id}`);
});
assert.ok(!html.includes('id="colCfgCost"'), 'index.html 不再包含独立的成本价复选框 colCfgCost');
assert.ok(!html.includes('id="colCfgPrice"'), 'index.html 不再包含独立的现价复选框 colCfgPrice');
assert.ok(!html.includes('id="colCfgMv"'), 'index.html 不再包含独立的市值复选框 colCfgMv');
assert.ok(!html.includes('id="setDefaultView"'), 'index.html 设置中已移除「默认启动展示页面」setDefaultView');
console.log('✓ index.html 持仓显示列 4 个精简配置项均存在且已移至持仓表头');

// 交易费率二次界面及触发卡片
assert.ok(html.includes('id="btnOpenRateModal"'), 'index.html 包含费率二次界面触发卡片 btnOpenRateModal');
assert.ok(html.includes('id="rateModal"'), 'index.html 包含交易费率二次界面弹窗 rateModal');
assert.ok(html.includes('id="rateBadgeFreeFive"'), 'index.html 包含免五状态徽章 rateBadgeFreeFive');
assert.ok(html.includes('id="rateSummaryDesc"'), 'index.html 包含费率摘要文本 rateSummaryDesc');
assert.ok(html.includes('id="btnRateDone"'), 'index.html 包含费率弹窗保存按钮 btnRateDone');
assert.ok(html.includes('id="btnRateReset"'), 'index.html 包含费率弹窗恢复默认按钮 btnRateReset');
console.log('✓ index.html 交易费率二次界面结构完整');

// 3. 静态检查 index.css
const css = fs.readFileSync(path.join(__dirname, '..', 'index.css'), 'utf8');
assert.ok(css.includes('.posColDropdown') && css.includes('.thColMenuBtn'), 'index.css 包含表头自定义列下拉菜单样式');
assert.ok(css.includes('.colCheckItem'), 'index.css 包含自定义列样式');
assert.ok(css.includes('.rateEntryCard') && css.includes('.rateBadge'), 'index.css 包含费率入口卡片样式');
assert.ok(css.includes('text-align-last: right') || css.includes('text-align: right'), 'index.css 下拉框文本右对齐');
assert.ok(css.includes('max-width: 760px') || css.includes('width: 100%'), 'index.css 设置表单已拓宽避免下拉框靠左');
console.log('✓ index.css 样式校验通过');

// 4. 静态检查 index.js
const js = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
assert.ok(js.includes('ALL_POS_COLS') && js.includes('POS_COL_DEFS'), 'index.js 包含持仓列常数配置');
assert.ok(js.includes('btnPosColMenu'), 'index.js 包含表头列设置按钮交互');
assert.ok(js.includes('openRateModal') && js.includes('closeRateModal') && js.includes('saveRateModal'), 'index.js 包含二次界面弹窗方法');
assert.ok(js.includes('updateRateSummaryUI'), 'index.js 包含费率摘要同步方法');
assert.ok(js.includes('colCfgQty'), 'index.js 绑定了显示列选项变更逻辑');
console.log('✓ index.js 控制逻辑校验通过');

console.log('\n🎉 所有持仓显示列、费率二次界面与下拉框右对齐测试通过！');
