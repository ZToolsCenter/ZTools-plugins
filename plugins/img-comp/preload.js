'use strict';

const service = require('./runtime-service');

// 插件前端只访问这一处命名空间，内部服务可独立测试和替换。
window.imgCompRuntime = Object.freeze({
  addDataUris: service.addDataUris,
  cancel: service.cancelBatch,
  clearHistory: service.clearHistory,
  copyOne: service.copyPath,
  copyMany: service.copyPaths,
  create: service.createBatch,
  execute: service.executeBatch,
  formatBytes: service.formatBytes,
  fromHistory: service.fromHistoryRecord,
  history: service.readHistory,
  removeHistory: service.removeHistory,
  replaceInputs: service.replaceInputs,
  toHistory: service.toHistoryRecord,
  writeHistory: service.writeHistory
});
