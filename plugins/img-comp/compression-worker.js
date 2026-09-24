'use strict';

const fsp = require('node:fs/promises');
const path = require('node:path');
const { isMainThread, parentPort, threadId } = require('node:worker_threads');
const { compressByName } = require('./compression-engine');

/**
 * 压缩单张图片，并仅在结果更小时写入临时目录。
 * @param {{inputPath:string,filename:string,resultPath:string}} task 压缩任务
 * @returns {Promise<{resultPath:string,resultBytes:number,savedPercent:number}>} 压缩结果
 */
async function compressImage(task) {
  const original = await fsp.readFile(task.inputPath);
  if (original.length === 0) throw new Error('文件内容为空');

  const compressed = await compressByName(task.filename, original);
  if (compressed.length >= original.length) {
    return {
      resultPath: task.inputPath,
      resultBytes: original.length,
      savedPercent: 0
    };
  }

  await fsp.mkdir(path.dirname(task.resultPath), { recursive: true });
  await fsp.writeFile(task.resultPath, compressed);
  return {
    resultPath: task.resultPath,
    resultBytes: compressed.length,
    savedPercent: Number((100 * (1 - compressed.length / original.length)).toFixed(1))
  };
}

/**
 * 将任务结果发送回线程或进程池主控端。
 * @param {object} message 任务结果
 */
function sendResponse(message) {
  if (parentPort) {
    parentPort.postMessage(message);
  } else if (typeof process.send === 'function') {
    process.send(message);
  }
}

/**
 * 处理主控端发来的单个压缩任务。
 * @param {{id:string,inputPath:string,filename:string,resultPath:string}} task 压缩任务
 * @returns {Promise<void>} 完成信号
 */
async function handleTask(task) {
  const startedAt = Date.now();
  try {
    const result = await compressImage(task);
    sendResponse({
      id: task.id,
      ok: true,
      result,
      threadId,
      processId: process.pid,
      executorMode: parentPort ? 'worker-thread' : 'child-process',
      startedAt,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    sendResponse({
      id: task.id,
      ok: false,
      error: error && error.message ? error.message : '处理失败',
      threadId,
      processId: process.pid,
      executorMode: parentPort ? 'worker-thread' : 'child-process',
      startedAt,
      durationMs: Date.now() - startedAt
    });
  }
}

if (!isMainThread && parentPort) {
  parentPort.on('message', task => {
    void handleTask(task);
  });
} else if (typeof process.send === 'function') {
  process.on('message', task => {
    void handleTask(task);
  });
}

module.exports = { compressImage };
