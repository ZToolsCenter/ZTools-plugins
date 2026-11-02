'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { PluginStore } = require('../lib/store');
const { fixture, createDatabase, seed } = require('./fixture');

function setup(t) {
  const parent = path.resolve('.test-data');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'fixture-'));
  fixture(root);
  const store = new PluginStore({ root });
  store.connect();
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { store, root };
}

const edit = (store, key, content, kind = 'value') => {
  const record = store.read('notes', key);
  return store.save({ plugin: 'notes', key, content, kind, token: record.token });
};

function externalWrite(root, operation) {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'external-writer.js'), root, operation], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('enumerates installed plugins, nested keys and exact namespace boundaries', t => {
  const { store } = setup(t);
  assert.equal(store.plugins().length, 3);
  assert.equal(store.plugins().find(p => p.name === 'empty').count, 0);
  assert.deepEqual(store.records('notes').map(r => r.key).sort(), ['note/one', 'settings']);
  assert.equal(store.read('notes-extra', 'settings').content, false);
  assert.throws(() => store.read('notes/../ZTOOLS', 'plugins'), /标识/);
  assert.throws(() => store.read('unknown', 'settings'), /不存在/);
});

test('save backs up original and atomically updates revision, metadata and changelog', t => {
  const { store } = setup(t);
  const original = store.read('notes', 'settings');
  const result = edit(store, 'settings', { fontSize: 18, theme: 'dark' });
  assert.equal(result.document._id, 'PLUGIN/notes/settings');
  assert.match(result.rev, /^2-[a-f0-9]{32}$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.backup.file)).document, original.document);
  assert.deepEqual(result.content, { fontSize: 18, theme: 'dark' });
  assert.equal(JSON.parse(store.account.meta.get(result.document._id))._winningRev, result.rev);
  const revision = store.account.db('revision');
  assert.equal(JSON.parse(revision.get(`rev:${result.document._id}:${original.rev}`)).isLeaf, false);
  assert.equal(JSON.parse(revision.get(`rev:${result.document._id}:${result.rev}`)).parentRev, original.rev);
  const changelog = store.account.db('changelog');
  assert.equal(JSON.parse(changelog.get('0000000001')).rev, result.rev);
  assert.equal(store.read('notes-extra', 'settings').content, false);
});

test('backup can be restored as a new revision, including falsy values', t => {
  const { store } = setup(t);
  const old = store.read('notes', 'settings').content;
  const result = edit(store, 'settings', null);
  assert.equal(result.content, null);
  assert.equal(store.history('notes', 'settings').length, 1);
  const backup = store.backupContent('notes', 'settings', result.backup.id);
  const restored = edit(store, 'settings', backup.content, backup.kind);
  assert.deepEqual(restored.content, old);
  assert.match(restored.rev, /^3-/);
  assert.equal(store.history('notes', 'settings').length, 2);
});

test('rejects stale edits after another writer changes document', t => {
  const { store, root } = setup(t);
  const original = store.read('notes', 'settings');
  externalWrite(root, 'edit');
  assert.throws(() => store.save({ plugin: 'notes', key: 'settings', content: true, kind: 'value', token: original.token }), /其他插件修改/);
  assert.equal(store.read('notes', 'settings').content, false);
});

test('backup failure prevents all database changes', t => {
  const { store, root } = setup(t);
  const original = store.read('notes', 'settings');
  const blocked = path.join(root, 'backup-blocked');
  fs.writeFileSync(blocked, 'not a directory');
  store.backupRoot = blocked;
  assert.throws(() => edit(store, 'settings', true));
  assert.equal(store.read('notes', 'settings').token, original.token);
  assert.equal(store.account.meta.get('_changelog_seq'), undefined);
});

test('database exception rolls back all changes after a successful backup', t => {
  const { store } = setup(t);
  const original = store.read('notes', 'settings');
  const createBackup = store.backup.bind(store);
  store.backup = (...args) => {
    const backup = createBackup(...args);
    store.account.main.putSync = () => { throw new Error('simulated database failure'); };
    return backup;
  };
  assert.throws(() => edit(store, 'settings', true), /simulated database failure/);
  assert.equal(store.read('notes', 'settings').token, original.token);
  assert.equal(store.account.meta.get('_changelog_seq'), undefined);
  const revision = store.account.db('revision');
  assert.equal(JSON.parse(revision.get(`rev:PLUGIN/notes/settings:${original.rev}`)).isLeaf, true);
  assert.equal(store.history('notes', 'settings').length, 1);
});

test('document edits preserve attachment metadata and binary contents', t => {
  const { store } = setup(t);
  const original = store.read('notes', 'note/one').document;
  const result = edit(store, 'note/one', { title: '更新', content: '新正文' }, 'document');
  assert.deepEqual(result.document._attachments, original._attachments);
  const attachment = store.account.env.openDB({ name: 'attachment', encoding: 'binary', create: false });
  assert.equal(Buffer.from(attachment.get('attachment:PLUGIN/notes/note/one')).toString(), 'demo');
  assert.throws(() => edit(store, 'note/one', { _id: 'ZTOOLS/plugins' }, 'document'), /系统字段/);
});

test('rejects sync conflicts and incompatible metadata without writing', t => {
  const { store, root } = setup(t);
  const original = store.read('notes', 'settings');
  store.close();
  const db = createDatabase(path.join(root, 'lmdb', 'accounts', 'default'));
  const id = 'PLUGIN/notes/settings';
  const meta = JSON.parse(db.meta.get(id));
  db.meta.putSync(id, JSON.stringify({ ...meta, _hasConflicts: true, _conflictCount: 1 }));
  db.env.close(); store.connect();
  assert.throws(() => edit(store, 'settings', true), /同步冲突/);
  assert.equal(store.read('notes', 'settings').token, original.token);
  assert.equal(store.history('notes', 'settings').length, 0);
});

test('account switch is detected and reconnect selects the correct hashed account', t => {
  const { store, root } = setup(t);
  store.close();
  const accountName = require('crypto').createHash('sha256').update('test-user').digest('hex').slice(0, 16);
  const second = createDatabase(path.join(root, 'lmdb', 'accounts', accountName));
  seed(second, 'PLUGIN/notes/settings', { value: 'second account' }); second.env.close();
  store.connect();
  // Simulate a host process changing its current-account record.
  externalWrite(root, 'account');
  assert.throws(() => store.records('notes'), /账号已切换/);
  const info = store.connect();
  assert.equal(info.account, accountName);
  assert.equal(store.read('notes', 'settings').content, 'second account');
});

test('oversized edits and invalid document bodies cannot alter data', t => {
  const { store } = setup(t);
  const original = store.read('notes', 'settings');
  assert.throws(() => edit(store, 'settings', 'x'.repeat(1024 * 1024)), /大小限制/);
  assert.throws(() => edit(store, 'settings', [], 'document'), /JSON 对象/);
  assert.equal(store.read('notes', 'settings').token, original.token);
});

test('export and backup lookup remain within selected plugin and account', t => {
  const { store } = setup(t);
  const result = edit(store, 'settings', 0);
  assert.equal(store.exportPlugin('notes').documents.length, 2);
  assert.throws(() => store.backupContent('notes-extra', 'settings', result.backup.id), /备份不存在/);
  assert.throws(() => store.backupContent('notes', 'settings', '../../version'), /备份不存在/);
});
