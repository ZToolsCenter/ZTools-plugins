'use strict';
const path = require('path');
const { PluginStore } = require('../lib/store');
const { createDatabase } = require('./fixture');
const [root, operation] = process.argv.slice(2);
if (operation === 'account') {
  const device = createDatabase(path.join(root, 'lmdb', 'device'));
  try { device.main.putSync('SYNC/current-account', JSON.stringify({ _id: 'SYNC/current-account', _rev: '2-bbbb', data: { uid: 'test-user' } })); }
  finally { device.env.close(); }
} else {
  const store = new PluginStore({ root });
  try {
    store.connect();
    const original = store.read('notes', 'settings');
    store.save({ plugin: 'notes', key: 'settings', content: false, kind: 'value', token: original.token });
  } finally { store.close(); }
}
