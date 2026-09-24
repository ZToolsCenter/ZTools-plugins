/*
 * 安全护栏测试：任何测试都不得读写用户真实的 ~/.ztools-stock-ball.json。
 *
 * 背景（真实事故）：早期有测试 `createStore()` 不传 dbStorage，在 node 下
 * pickDb() 会退化成 `db = fileStore`，`setWatchlist([...])` 直接把用户本机自选股
 * 写坏；tests/test-preload-vm.js 也曾是「假 dbStorage + 真 fileStore」，
 * 把测试数据镜像进了真实文件。（肇事的 test-webserver.js 已随 Web 服务一并删除）
 *
 * 规则：测试里每次 createStore(...) 都必须带 `isolated: true`（不建 fileStore），
 * 或者显式给 `dataFilePath`（写到临时副本）。
 *
 *   node tests/test-safety-no-real-data-writes.js
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

const TESTS_DIR = __dirname;
const files = fs.readdirSync(TESTS_DIR).filter((f) => /\.js$/.test(f));

console.log('== 1. 扫描每个测试文件里的 createStore(...) 调用 ==');
const SELF = 'test-safety-no-real-data-writes.js';
let totalCalls = 0;
files.filter((f) => f !== SELF).forEach((f) => {
  const src = fs.readFileSync(path.join(TESTS_DIR, f), 'utf8');
  const lines = src.split('\n');
  // 有的测试用 shim 把 createStore 包成 isolated（createStore: (db) => createStore(db, {isolated:true}))，
  // 那样文件内所有调用都是安全的
  const hasShim = /createStore\s*:\s*\([^)]*\)\s*=>[\s\S]{0,200}?isolated\s*:\s*true/.test(src);
  if (hasShim) {
    ok(true, f + ' 用 store shim 把 createStore 包成 isolated，整文件安全');
  }
  lines.forEach((line, i) => {
    let idx = line.indexOf('createStore(');
    while (idx >= 0) {
      const comment = line.indexOf('//');
      if (comment >= 0 && comment < idx) { idx = line.indexOf('createStore(', idx + 1); continue; }   // 注释里的不算
      totalCalls++;
      // 取该调用往后 400 字符（跨行参数）作为判断窗口
      const win = src.slice(src.indexOf(line) + idx, src.indexOf(line) + idx + 400);
      const safe = hasShim || /isolated\s*:\s*true/.test(win) || /dataFilePath/.test(win);
      ok(safe, f + ':' + (i + 1) + ' 的 createStore 调用不会碰真实文件', win.slice(0, 90).replace(/\s+/g, ' '));
      idx = line.indexOf('createStore(', idx + 1);
    }
  });
});
ok(totalCalls > 0, '确实扫描到了 createStore 调用（' + totalCalls + ' 处）');

console.log('== 2. 关键文件必须用 isolated / dataFilePath ==');
const vmTest = fs.readFileSync(path.join(TESTS_DIR, 'test-preload-vm.js'), 'utf8');
ok(/createStore:\s*\(db\)\s*=>\s*storeReal\.createStore\(db,\s*\{\s*isolated:\s*true\s*\}\)/.test(vmTest),
  'test-preload-vm.js 用 isolated 包住 createStore');
const syncTest = fs.readFileSync(path.join(TESTS_DIR, 'test-file-sync.js'), 'utf8');
ok(/dataFilePath/.test(syncTest), 'test-file-sync.js 写的是临时副本而不是真实文件');

console.log('== 3. 真实数据文件当前状态（只读检查，不做任何写入） ==');
const realFile = path.join(os.homedir(), '.ztools-stock-ball.json');
if (fs.existsSync(realFile)) {
  const before = fs.readFileSync(realFile);
  const parsed = JSON.parse(before.toString('utf8'));
  ok(true, '真实数据文件可读：' + realFile + '（' + before.length + ' 字节，' +
    (parsed['sb.transactions'] || []).length + ' 条交易，' +
    (parsed['sb.watchlist'] || []).length + ' 只自选，' +
    (parsed['sb.alerts'] || []).length + ' 条预警）');
  const after = fs.readFileSync(realFile);
  ok(Buffer.compare(before, after) === 0, '本测试只读，没有改动真实数据文件');
} else {
  ok(true, '本机没有真实数据文件（跳过只读检查）');
}

console.log('');
if (fail === 0) {
  console.log('✓ 测试数据安全护栏全部通过（' + pass + ' 项）');
  process.exit(0);
} else {
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
