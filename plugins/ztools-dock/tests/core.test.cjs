const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateConfig, geometry, resolveEntry } = require('../public/runtime/core.cjs');

test('旧版配置搜索默认关闭，新配置保存开关并拒绝错误类型', () => {
  const c=defaults(); delete c.settings.searchEnabled;
  assert.equal(validateConfig(c).settings.searchEnabled,false);
  c.settings.searchEnabled=true; assert.equal(validateConfig(c).settings.searchEnabled,true);
  c.settings.searchEnabled='yes'; assert.throws(()=>validateConfig(c),/搜索设置/);
});

test('默认配置可序列化回读且所有入口属于存在的分类', () => {
  const config = defaults();
  assert.deepEqual(validateConfig(JSON.parse(JSON.stringify(config))), config);
  assert.equal(config.settings.openDelay, 180);
  assert.equal(config.settings.closeDelay, 450);
  assert.ok(config.entries.every(e => config.categories.some(c => c.id === e.categoryId)));
});
test('损坏或重复 ID 的导入不可覆盖当前数据', () => {
  const original = defaults();
  assert.throws(() => validateConfig({ ...original, version: 999 }), /版本/);
  assert.throws(() => validateConfig({ ...original, categories: [original.categories[0], original.categories[0]] }), /重复/);
  assert.throws(() => validateConfig({ ...original, entries: [{ id: 'bad', categoryId: 'missing' }] }));
  assert.deepEqual(original, defaults());
});
test('拒绝可执行 URL 和畸形配置，正常 HTTPS 与中文路径保真', () => {
  const config = defaults();
  const e = { id: 'u', categoryId: 'folders', name: '网址', type: 'url', target: 'javascript:alert(1)', icon: 'Globe', color: '#087fe7' };
  assert.throws(() => validateConfig({ ...config, entries: [e] }), /网址/);
  assert.equal(resolveEntry({ ...e, target: 'https://example.com/a?q=中文' }, {}).kind, 'url');
  assert.throws(() => validateConfig({ ...config, settings: { ...config.settings, columns: -100 } }), /列数/);
  assert.equal(resolveEntry({ ...e, type: 'file', target: 'D:\\资料\\测试 文档.txt' }, {}).target, 'D:\\资料\\测试 文档.txt');
});
test('布局支持负坐标并限制面板，失去副屏回退主屏', () => {
  const ds = [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }, { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 720 }, workArea: { x: -1280, y: 0, width: 1280, height: 680 } }];
  const config = defaults(); config.settings.displayId = '2';
  const g = geometry(config.settings, ds, ds[0]);
  assert.ok(g.panel.x >= -1280 && g.panel.x + g.panel.width <= 0);
  assert.ok(g.panel.height <= 680);
  assert.equal(geometry(config.settings, [ds[0]], ds[0]).displayId, '1');
});

test('横向分类栏预留两侧下拉空间，并限制在小屏幕工作区', () => {
  const settings = defaults().settings;
  const display = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const normal = geometry(settings, [display], display, 7);
  assert.ok(normal.panel.width >= 1000, '7 个分类和首尾分类下拉需要足够横向空间');
  const small = { id: 2, bounds: { x: -640, y: 0, width: 640, height: 480 } };
  const limited = geometry(settings, [small], small, 40);
  assert.ok(limited.panel.width <= 640 && limited.panel.height <= 475);
  assert.ok(limited.panel.x >= -640 && limited.panel.x + limited.panel.width <= 0);
});
test('插件跳转保留标题限定，系统目录只支持白名单', () => {
  assert.deepEqual(resolveEntry({ type: 'plugin', plugin: '示例插件', target: '开始' }, {}).target, ['示例插件', '开始']);
  assert.equal(resolveEntry({ type: 'system', target: 'downloads' }, { downloads: 'D:\\下载' }).target, 'D:\\下载');
  assert.throws(() => resolveEntry({ type: 'system', target: '../x' }, {}), /目录/);
});
test('所有可保存配置的格式化导出都在导入大小限制内', () => {
  const config = defaults();
  const entry = { id: 'large', categoryId: 'folders', name: '图标', type: 'url', target: 'https://example.com', icon: 'Globe', color: '#087fe7', image: 'data:image/png;base64,' + 'A'.repeat(373332) };
  config.entries = Array.from({ length: 23 }, (_, i) => ({ ...entry, id: `large-${i}` }));
  assert.throws(() => validateConfig(config), /8 MB/);
  config.entries = config.entries.slice(0, 20);
  const exportText = JSON.stringify(validateConfig(config), null, 2);
  assert.ok(Buffer.byteLength(exportText, 'utf8') <= 8 * 1024 * 1024);
  assert.deepEqual(validateConfig(JSON.parse(exportText)), validateConfig(config));
});
