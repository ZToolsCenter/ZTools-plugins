'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'dist');
const files = ['plugin.json', 'index.html', 'styles.css', 'app.js', 'commands.js', 'preload.js', 'preview.js', 'logo.png', 'LICENSE'];

// Plain files are already the runtime format. Keep preload readable for ZTools.
for (const file of files) fs.accessSync(path.join(root, file), fs.constants.R_OK);
fs.mkdirSync(destination, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(destination, file));
console.log(`插件已构建：${path.join(destination, 'plugin.json')}`);
