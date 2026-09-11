'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { Worker } = require('node:worker_threads');
const test = require('node:test');
const assert = require('node:assert/strict');

test('压缩工作线程会返回单张图片的压缩结果', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-worker-'));
  const inputPath = path.join(root, 'input.svg');
  const resultPath = path.join(root, 'result.svg');
  const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><!-- comment --><rect width="100" height="100" fill="#ff0000"/></svg>';
  fs.writeFileSync(inputPath, input);

  const worker = new Worker(path.join(__dirname, '..', 'compression-worker.js'));
  try {
    worker.postMessage({ id: 'task-1', inputPath, filename: 'input.svg', resultPath });
    const [response] = await once(worker, 'message');
    assert.equal(response.id, 'task-1');
    assert.equal(response.ok, true);
    assert.equal(response.result.resultPath, resultPath);
    assert.ok(response.result.resultBytes < Buffer.byteLength(input));
    assert.equal(fs.existsSync(resultPath), true);
  } finally {
    await worker.terminate();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('压缩子进程会通过 IPC 返回单张图片的压缩结果', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'img-comp-process-'));
  const inputPath = path.join(root, 'input.svg');
  const resultPath = path.join(root, 'result.svg');
  const input = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><!-- comment --><rect width="100" height="100" fill="#00ff00"/></svg>';
  fs.writeFileSync(inputPath, input);

  const child = fork(path.join(__dirname, '..', 'compression-worker.js'), [], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  try {
    child.send({ id: 'task-process-1', inputPath, filename: 'input.svg', resultPath });
    const [response] = await once(child, 'message');
    assert.equal(response.id, 'task-process-1');
    assert.equal(response.ok, true);
    assert.equal(response.executorMode, 'child-process');
    assert.equal(response.processId, child.pid);
    assert.notEqual(response.processId, process.pid);
    assert.equal(response.result.resultPath, resultPath);
    assert.equal(fs.existsSync(resultPath), true);
  } finally {
    child.kill();
    if (child.exitCode === null) await once(child, 'exit');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
