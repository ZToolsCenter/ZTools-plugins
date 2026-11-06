'use strict';
// Read-only compatibility check; never prints values, account IDs or credentials.
const { PluginStore } = require('../lib/store');
const store = new PluginStore();
try {
  store.connect();
  const plugins = store.plugins();
  let documents = 0;
  let compatible = 0;
  for (const plugin of plugins) {
    for (const row of store.records(plugin.name)) {
      if (row.kind === 'invalid') continue;
      documents++;
      const record = store.read(plugin.name, row.key);
      const id = record.document._id;
      const raw = store.account.meta.get(id);
      if (raw?.startsWith('{')) {
        const meta = JSON.parse(raw);
        const revision = store.account.db('revision');
        if ((meta._winningRev || meta._rev) === record.rev && revision.get(`rev:${id}:${record.rev}`)) compatible++;
      }
    }
  }
  console.log(JSON.stringify({ connected: true, installedPlugins: plugins.filter(p => p.installed).length, dataNamespaces: plugins.length, documents, compatibleDocuments: compatible, writesPerformed: false }));
} finally { store.close(); }
