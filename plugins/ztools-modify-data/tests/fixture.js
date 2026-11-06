'use strict';
const fs = require('fs');
const path = require('path');
const { open } = require('lmdb');

function createDatabase(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const env = open({ path: directory, maxDbs: 6, compression: false, encoding: 'binary' });
  const dbs = Object.fromEntries(['main', 'meta', 'attachment', 'changelog', 'revision', 'syncTask'].map(name => [name, env.openDB({ name, encoding: name === 'attachment' ? 'binary' : 'string' })]));
  return { env, ...dbs };
}

function seed(db, id, content, rev = '1-aaaa') {
  const doc = { _id: id, _rev: rev, ...content };
  db.env.transactionSync(() => {
    db.main.putSync(id, JSON.stringify(doc));
    if (id.startsWith('PLUGIN/')) {
      db.meta.putSync(id, JSON.stringify({ _rev: rev, _winningRev: rev, _lastModified: Date.now(), _deleted: false, _hasConflicts: false, _conflictCount: 0 }));
      db.revision.putSync(`rev:${id}:${rev}`, JSON.stringify({ docId: id, rev, parentRev: null, deleted: false, timestamp: Date.now(), doc, isLeaf: true }));
    } else db.meta.putSync(id, rev);
  });
  return doc;
}

function fixture(root) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ version: '3.0.0' }));
  const device = createDatabase(path.join(root, 'lmdb', 'device'));
  seed(device, 'ZTOOLS/plugins', { data: [{ name: 'notes', title: '便签笔记' }, { name: 'notes-extra', title: '另一插件' }, { name: 'empty', title: '空插件' }] });
  seed(device, 'SYNC/current-account', { data: { uid: null } });
  const account = createDatabase(path.join(root, 'lmdb', 'accounts', 'default'));
  seed(account, 'PLUGIN/notes/settings', { value: { fontSize: 14, theme: 'light' } });
  seed(account, 'PLUGIN/notes/note/one', { title: '原文', content: '第一行', _attachments: { default: { stub: true, digest: 'md5-demo', content_type: 'text/plain', length: 4 } } });
  seed(account, 'PLUGIN/notes-extra/settings', { value: false });
  account.attachment.putSync('attachment:PLUGIN/notes/note/one', Buffer.from('demo'));
  device.env.close(); account.env.close();
  return root;
}

module.exports = { fixture, createDatabase, seed };
