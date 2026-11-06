'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const { unzipSync } = require('fflate');
const { fixture } = require('../tests/fixture');
const config = require('../plugin.json');
const parent = path.resolve(__dirname, '..', '.test-data');
fs.mkdirSync(parent, { recursive: true });
const directory = fs.mkdtempSync(path.join(parent, 'package-'));
try {
  const archive = unzipSync(fs.readFileSync(path.resolve(__dirname, '..', 'dist', `ztools-modify-data-${config.version}-win-x64.zip`)));
  const pluginRoot = path.join(directory, 'plugin');
  for (const [name, data] of Object.entries(archive)) {
    const destination = path.resolve(pluginRoot, name);
    assert.ok(destination.startsWith(pluginRoot + path.sep), 'Archive path must remain inside extraction directory');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
  }
  const dataRoot = fixture(path.join(directory, 'fixture'));
  const code = `const assert=require('assert/strict');global.document={currentScript:null,baseURI:require('url').pathToFileURL(require('path').resolve('index.html')).href};const {PluginStore}=require('./lib/store');const s=new PluginStore({root:process.argv[1]});try{s.connect();const row=s.read('notes','settings');const saved=s.save({plugin:'notes',key:'settings',kind:'value',content:{fontSize:20},token:row.token});assert.equal(saved.content.fontSize,20);assert.equal(s.history('notes','settings').length,1);console.log('Packaged native dependencies in shared page context: load, read, save and backup passed');}finally{s.close();}`;
  const result = spawnSync(process.execPath, ['-e', code, dataRoot], { cwd: pluginRoot, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  console.log(result.stdout.trim());
} finally {
  assert.equal(path.dirname(directory), parent);
  fs.rmSync(directory, { recursive: true, force: true });
}
