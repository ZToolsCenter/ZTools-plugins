'use strict';
const assert = require('assert');
const { createStore } = require('../lib/store.js');

async function testSync() {
  console.log('== 1. 测试从 ~/.ztools-stock-ball.json 自动同步到空 dbStorage ==');
  const db = new Map();
  const mockStorage = {
    getItem: (k) => (db.has(k) ? db.get(k) : null),
    setItem: (k, v) => db.set(k, v),
    removeItem: (k) => db.delete(k)
  };

  // 重要：这个测试要读真实的 ~/.ztools-stock-ball.json 作为数据源，
  // 但它后面的 importFromFile / syncFromFile 会写文件。为了不弄坏用户的数据，
  // 先在临时目录复制一份，读写真文件都用这份副本。
  const fs = require('node:fs');
  const os = require('node:os');
  const pathMod = require('node:path');
  const realFile = pathMod.join(os.homedir(), '.ztools-stock-ball.json');
  const tmpFile = pathMod.join(os.tmpdir(), 'ztools-stock-ball.test-copy.json');
  let dataFilePath = tmpFile;
  if (fs.existsSync(realFile)) {
    fs.copyFileSync(realFile, tmpFile);
  } else {
    dataFilePath = realFile;
  }
  console.log('（使用数据副本:', dataFilePath, '）');

  const store = createStore(mockStorage, { dataFilePath });
  const txs = store.getTransactions();
  console.log('自动同步后交易记录数量:', txs.length);
  assert.ok(txs.length >= 130, '应自动从本地文件载入130条记录');

  const positions = store.getAllPositions();
  console.log('自动核算持仓股票数:', positions.length);
  assert.strictEqual(positions.length, 10, '应有10只当前持仓股票');

  const wl = store.getWatchlist();
  console.log('自选股数量:', wl.length);
  assert.ok(wl.length >= 11, '自选股应包含所有持仓股票');

  console.log('== 2. 测试 importFromFile 直接读取 Downloads 文件 ==');
  const res = store.importFromFile('C:/Users/pc/Downloads/stock_transactions.json');
  console.log('导入结果:', res);
  assert.strictEqual(res.ok, true, '导入应当成功');
  assert.strictEqual(res.count, 130, '应导入130条记录');

  console.log('== 3. 测试 syncFromFile 强制全量同步 ==');
  const syncRes = store.syncFromFile();
  console.log('强制同步结果:', syncRes);
  assert.ok(syncRes.transactions >= 130, '强制同步应同步130条交易');

  console.log('\n✓ 本地文件与 dbStorage 双向同步及导入测试全部通过！\n');
}

testSync().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
