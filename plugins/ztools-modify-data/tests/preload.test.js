'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { fixture } = require('./fixture');

test('Electron shared page/preload world resolves LMDB native binaries from the dependency directory', t => {
  const parent = path.resolve('.test-data');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'preload-'));
  fixture(root);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const code = `
    const assert = require('assert/strict');
    const { pathToFileURL } = require('url');
    const path = require('path');
    process.env.ZTOOLS_DATA_ROOT = process.argv[1];
    global.document = { currentScript: null, baseURI: pathToFileURL(path.resolve('index.html')).href };
    const handlers = {};
    global.window = { ztools: {}, addEventListener(name, callback) { handlers[name] = callback; } };
    require('./preload');
    assert.equal(typeof window.dataEditor.connect, 'function');
    window.dataEditor.connect();
    assert.equal(window.dataEditor.plugins().filter(p => p.installed).length, 3);
    const row = window.dataEditor.read('notes', 'settings');
    const result = window.dataEditor.save({ plugin: 'notes', key: 'settings', content: { fontSize: 22 }, kind: 'value', token: row.token });
    assert.equal(result.content.fontSize, 22);
    assert.equal(window.dataEditor.history('notes', 'settings').length, 1);
    handlers.unload();
  `;
  const result = spawnSync(process.execPath, ['-e', code, root], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
