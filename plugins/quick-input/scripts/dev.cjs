'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'styles.css', 'app.js', 'commands.js', 'preview.js', 'logo.png']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png' };
const port = Number(process.env.QUICK_INPUT_PORT || 4173);
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!files.has(filename) || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Type', mime[path.extname(filename)]);
  if (request.method === 'HEAD') { response.end(); return; }
  fs.createReadStream(path.join(root, filename)).pipe(response);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`界面预览：http://127.0.0.1:${port}（真实输入请在 ZTools 中测试）`));
