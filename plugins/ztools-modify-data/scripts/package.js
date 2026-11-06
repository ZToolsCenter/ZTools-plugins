'use strict';
const fs = require('fs');
const path = require('path');
const { zipSync, unzipSync } = require('fflate');
const root = path.resolve(__dirname, '..');
const files = {};
for (const name of ['plugin.json', 'package.json', 'index.html', 'styles.css', 'app.js', 'editor-layout.js', 'demo.js', 'preload.js', 'logo.png', 'README.md']) {
  files[name] = new Uint8Array(fs.readFileSync(path.join(root, name)));
}
function add(directory, relative) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === '.bin' || entry.name === '.package-lock.json') continue;
    const fullPath = path.join(directory, entry.name);
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) add(fullPath, name);
    else files[name] = new Uint8Array(fs.readFileSync(fullPath));
  }
}
add(path.join(root, 'lib'), 'lib');
// Include only the production dependency tree, including native Node-API binaries.
for (const entry of fs.readdirSync(path.join(root, 'node_modules'), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'fflate' || entry.name === '.bin') continue;
  add(path.join(root, 'node_modules', entry.name), `node_modules/${entry.name}`);
}
const zip = zipSync(files, { level: 6 });
const config = JSON.parse(Buffer.from(unzipSync(zip)['plugin.json']).toString('utf8'));
if (config.name !== 'ztools-modify-data') throw new Error('安装包配置校验失败');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const target = path.join(root, 'dist', `ztools-modify-data-${config.version}-win-x64.zip`);
fs.writeFileSync(target, zip);
console.log(`安装包已生成：${target} (${(zip.length / 1024 / 1024).toFixed(2)} MB)`);
