'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'app.js', 'editor-layout.js', 'demo.js', 'styles.css', 'logo.png']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
http.createServer((request, response) => {
  const name = new URL(request.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(name)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': types[path.extname(name)], 'Cache-Control': 'no-store' });
  response.end(fs.readFileSync(path.join(root, name)));
}).listen(4173, '127.0.0.1', () => console.log('演示预览：http://127.0.0.1:4173'));
