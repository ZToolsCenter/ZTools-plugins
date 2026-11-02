'use strict';
// Browser preview uses fictional in-memory data. ZTools loads the real bridge first.
if (!window.dataEditor && window.ztools) {
  window.dataEditor = {
    connect() { throw new Error('插件预加载未成功，请使用完整安装包安装，或在开发目录执行 npm install 后重启插件'); },
    openBackups() { throw new Error('数据服务未加载，请重新安装插件'); }
  };
}
if (!window.dataEditor) {
  const demo = {
    'quick-notes': { title: '便签笔记', docs: { settings: { value: { theme: 'light', fontSize: 14, autoSave: true, defaultFolder: '工作笔记' } }, 'note/welcome': { title: '新的一天', content: '整理思路，从这里开始。', tags: ['工作', '灵感'], pinned: false } } },
    'clipboard-history': { title: '剪贴板历史', docs: { preferences: { value: { maxItems: 200, keepImages: true, excludedApps: [] } } } },
    'bookmark-manager': { title: '书签管理', docs: { categories: { value: ['常用', '设计', '开发工具'] } } },
    'calculator': { title: '计算器', docs: {} }
  };
  const snapshots = [];
  let sequence = 1;
  const clone = value => JSON.parse(JSON.stringify(value));
  const body = doc => Object.fromEntries(Object.entries(doc).filter(([key]) => key !== '_id' && key !== '_rev'));
  for (const [plugin, item] of Object.entries(demo)) for (const [key, doc] of Object.entries(item.docs)) Object.assign(doc, { _id: `PLUGIN/${plugin}/${key}`, _rev: '1-demo' });
  window.dataEditor = {
    isDemo: true,
    connect: () => ({ root: '浏览器预览 · 虚构示例数据', account: 'default', accountLabel: '演示模式', backupRoot: '演示备份' }),
    plugins: () => Object.entries(demo).map(([name, item]) => ({ name, title: item.title, count: Object.keys(item.docs).length, installed: true })),
    records: plugin => Object.entries(demo[plugin].docs).map(([key, doc]) => { const content = body(doc); const kind = Object.keys(content).length === 1 && Object.hasOwn(content, 'value') ? 'value' : 'document'; return { key, kind, preview: JSON.stringify(kind === 'value' ? content.value : content), bytes: JSON.stringify(doc).length }; }),
    read(plugin, key) { const document = clone(demo[plugin].docs[key]); const content = body(document); const kind = Object.keys(content).length === 1 && Object.hasOwn(content, 'value') ? 'value' : 'document'; return { plugin, key, document, kind, content: kind === 'value' ? content.value : content, token: JSON.stringify(document), rev: document._rev }; },
    save({ plugin, key, content, kind, token }) { const previous = demo[plugin].docs[key]; if (JSON.stringify(previous) !== token) throw new Error('数据已修改，请重新读取'); const id = String(sequence++); snapshots.unshift({ id, plugin, key, savedAt: new Date().toISOString(), document: clone(previous), rev: previous._rev }); demo[plugin].docs[key] = { ...(kind === 'value' ? { value: content } : content), _id: previous._id, _rev: `${sequence}-demo` }; return { ...this.read(plugin, key), backup: { id, file: '演示备份' } }; },
    history: (plugin, key) => snapshots.filter(s => s.plugin === plugin && s.key === key),
    backupContent(plugin, key, id) { const snapshot = snapshots.find(s => s.id === id && s.plugin === plugin && s.key === key); const content = body(snapshot.document); const kind = Object.keys(content).length === 1 && Object.hasOwn(content, 'value') ? 'value' : 'document'; return { kind, content: kind === 'value' ? content.value : content }; },
    openBackups: () => '演示模式：备份保存在内存中',
    export(plugin) { const blob = new Blob([JSON.stringify({ plugin, documents: Object.values(demo[plugin].docs) }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${plugin}-data.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return '已下载演示 JSON'; }
  };
}
