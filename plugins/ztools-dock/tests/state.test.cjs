const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeState } = require('../public/runtime/state.cjs');
const { defaults } = require('../public/runtime/core.cjs');

test('增量状态保留配置引用，分类切换不重建入口和图片数据', () => {
  const initial = { config: defaults(), expanded: false, pinned: false, error: '' };
  const expanded = mergeState(initial, { expanded: true, pinned: true });
  assert.equal(expanded.config, initial.config);
  assert.equal(initial.expanded, false);
  const selected = mergeState(expanded, { settings: { ...initial.config.settings, lastCategoryId: 'tools' } });
  assert.equal(selected.config.entries, initial.config.entries);
  assert.equal(selected.config.categories, initial.config.categories);
  assert.equal(selected.config.settings.lastCategoryId, 'tools');
  assert.equal(initial.config.settings.lastCategoryId, 'folders');
  assert.equal(selected.expanded, true);
});

test('首次快照前的增量不会生成残缺配置；完整保存替换旧配置', () => {
  assert.equal(mergeState(undefined, { expanded: true }), undefined);
  const snapshot = { config: defaults(), expanded: false };
  assert.equal(mergeState(undefined, snapshot), snapshot);
  const replacement = { config: { ...defaults(), entries: [] }, expanded: false };
  assert.equal(mergeState(snapshot, replacement), replacement);
  assert.equal(mergeState(snapshot, replacement).config.entries.length, 0);
});
