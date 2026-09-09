'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 加载运行时服务并提供最小 ZTools 宿主桩。
 * @param {{disableWorkers?:boolean}} options 加载选项
 */
function loadRuntime(options = {}) {
  const storage = new Map();
  const copiedFiles = [];
  global.window = {
    ztools: {
      copyFile(value) {
        copiedFiles.splice(0, copiedFiles.length, ...(Array.isArray(value) ? value : [value]));
        return true;
      },
      getCopyedFiles() {
        return copiedFiles.map(filePath => ({ path: filePath, isFile: true }));
      },
      dbStorage: {
        setItem(key, value) { storage.set(key, value); },
        getItem(key) { return storage.get(key) || null; },
        removeItem(key) { storage.delete(key); }
      }
    }
  };
  const workerThreads = require('node:worker_threads');
  const OriginalWorker = workerThreads.Worker;
  if (options.disableWorkers) {
    /** 模拟 ZTools 宿主禁用工作线程。 */
    workerThreads.Worker = function DisabledWorker() {
      throw new Error('当前 V8 平台不支持创建工作线程');
    };
  }
  delete require.cache[require.resolve('../runtime-service')];
  try {
    return { service: require('../runtime-service'), copiedFiles, storage };
  } finally {
    workerThreads.Worker = OriginalWorker;
  }
}

test('目录输入只创建一个批次并收集全部图片', async () => {
  const { service } = loadRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-batch-'));
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'a.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  fs.writeFileSync(path.join(root, 'b.png'), Buffer.from('png'));
  fs.writeFileSync(path.join(root, 'sub', 'c.jpg'), Buffer.from('jpg'));
  fs.writeFileSync(path.join(root, 'note.txt'), 'ignored');
  const batch = await service.createBatch({ kind: 'files', payload: [{
    path: root,
    name: path.basename(root),
    isDirectory: true,
    isFile: false
  }] });
  assert.equal(batch.entries.length, 3);
  assert.equal(batch.rootPath, root);
  assert.equal(batch.progress.total, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('同一批剪贴板图片会合并为一个批次', async () => {
  const { service } = loadRuntime();
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const batch = await service.createBatch({ kind: 'clipboard', payload: [png, png, png] });
  assert.equal(batch.entries.length, 3);
  assert.equal(batch.progress.total, 3);
});

test('SVG Data URI 会映射为 svg 扩展名', async () => {
  const { service } = loadRuntime();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>').toString('base64');
  const batch = await service.createBatch({ kind: 'clipboard', payload: [`data:image/svg+xml;base64,${svg}`] });
  assert.equal(batch.entries.length, 1);
  assert.match(batch.entries[0].filename, /\.svg$/);
});

test('不同目录的同名文件使用不同结果路径且可分别覆盖', async () => {
  const { service } = loadRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-collision-'));
  const firstDir = path.join(root, 'first');
  const secondDir = path.join(root, 'second');
  fs.mkdirSync(firstDir);
  fs.mkdirSync(secondDir);
  const first = path.join(firstDir, 'same.svg');
  const second = path.join(secondDir, 'same.svg');
  fs.writeFileSync(first, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- first --><rect width="10" height="10" fill="#ff0000"/></svg>');
  fs.writeFileSync(second, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- second --><rect width="10" height="10" fill="#0000ff"/></svg>');
  const batch = await service.createBatch({ kind: 'files', payload: [
    { path: first, name: 'same.svg', isFile: true },
    { path: second, name: 'same.svg', isFile: true }
  ] });
  assert.notEqual(batch.entries[0].outputName, batch.entries[1].outputName);
  await service.executeBatch(batch);
  assert.notEqual(batch.entries[0].resultPath, batch.entries[1].resultPath);
  assert.equal(await service.replaceInputs(batch), true);
  assert.match(fs.readFileSync(first, 'utf8'), /fill="red"/);
  assert.match(fs.readFileSync(second, 'utf8'), /fill="#00f"/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('单张图片失败不会中断同批其他压缩任务', async () => {
  const { service } = loadRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-isolation-'));
  const validPath = path.join(root, 'valid.svg');
  const invalidPath = path.join(root, 'invalid.png');
  fs.writeFileSync(validPath, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><!-- comment --><rect width="10" height="10" fill="#ff0000"/></svg>');
  fs.writeFileSync(invalidPath, 'not-a-png');
  const batch = await service.createBatch({ kind: 'files', payload: [
    { path: validPath, name: 'valid.svg', isFile: true },
    { path: invalidPath, name: 'invalid.png', isFile: true }
  ] });

  await service.executeBatch(batch);

  assert.equal(batch.phase, 'complete');
  assert.equal(batch.progress.succeeded, 1);
  assert.equal(batch.progress.failed, 1);
  assert.equal(batch.progress.completed, 2);
  assert.equal(batch.progress.percent, 100);
  assert.ok(batch.entries.find(entry => entry.filename === 'valid.svg').resultPath);
  assert.ok(batch.entries.find(entry => entry.filename === 'invalid.png').error);
  fs.rmSync(root, { recursive: true, force: true });
});

test('工作线程被宿主禁用时会改用多个压缩子进程', async () => {
  const { service } = loadRuntime({ disableWorkers: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-process-pool-'));
  const payload = Array.from({ length: 4 }, (_, index) => {
    const filePath = path.join(root, `${index}.svg`);
    fs.writeFileSync(filePath, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><!-- ${index} --><rect width="100" height="100" fill="#ff0000"/></svg>`);
    return { path: filePath, name: `${index}.svg`, isFile: true };
  });
  const batch = await service.createBatch({ kind: 'files', payload });

  await service.executeBatch(batch);

  const logPath = path.join(os.tmpdir(), 'ztools.image.compression', 'compression-debug.log');
  const records = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const poolRecord = records.find(record => record.event === '执行器池已创建');
  const completed = records.filter(record => record.event === '任务完成');
  assert.deepEqual(poolRecord.modes, [
    'child-process', 'child-process', 'child-process', 'child-process'
  ]);
  assert.equal(new Set(completed.map(record => record.processId)).size, 4);
  assert.equal(batch.progress.succeeded, 4);
  assert.equal(batch.progress.failed, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('历史记录从旧到新排列且最多保留八条', () => {
  const { service } = loadRuntime();
  const history = Array.from({ length: 10 }, (_, index) => ({ id: `batch-${index + 1}`, createdAt: index + 1 }));
  service.writeHistory(history.reverse());
  assert.deepEqual(service.readHistory().map(item => item.id), [
    'batch-3', 'batch-4', 'batch-5', 'batch-6', 'batch-7', 'batch-8', 'batch-9', 'batch-10'
  ]);
});

test('批量复制一次性写入全部结果路径', async () => {
  const { service, copiedFiles } = loadRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-copy-'));
  const files = Array.from({ length: 3 }, (_, index) => {
    const filePath = path.join(root, `${index}.png`);
    fs.writeFileSync(filePath, Buffer.from([index]));
    return filePath;
  });
  const result = await service.copyPaths(files);
  assert.deepEqual(result, { success: true, count: 3, expected: 3 });
  assert.equal(copiedFiles.length, 3);
  fs.rmSync(root, { recursive: true, force: true });
});

test('批次历史摘要不包含运行时控制字段', async () => {
  const { service } = loadRuntime();
  const batch = await service.createBatch({ kind: 'files', payload: [] });
  const record = service.toHistoryRecord(batch);
  assert.equal(record.id, batch.id);
  assert.equal('phase' in record, false);
  assert.equal('cancelled' in record, false);
  const restored = service.fromHistoryRecord(record);
  assert.equal(restored.phase, 'complete');
  assert.equal(restored.historical, true);
});

test('历史中的临时结果失效后回退到输入文件', () => {
  const { service } = loadRuntime();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-stale-'));
  const inputPath = path.join(root, 'input.png');
  fs.writeFileSync(inputPath, Buffer.from('input'));
  const batch = service.fromHistoryRecord({
    id: 'stale', createdAt: Date.now(), entries: [{
      inputPath, inputBytes: 5, filename: 'input.png', relativeName: 'input.png',
      resultPath: path.join(root, 'missing.png'), resultBytes: 2, savedPercent: 60, error: null
    }]
  });
  assert.equal(batch.entries[0].resultPath, null);
  assert.equal(batch.entries[0].resultBytes, 5);
  assert.equal(batch.entries[0].savedPercent, 0);
  fs.rmSync(root, { recursive: true, force: true });
});
