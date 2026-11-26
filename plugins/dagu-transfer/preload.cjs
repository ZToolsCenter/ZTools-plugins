// 大古快传 preload：向页面暴露受限的 Node 能力（拷贝文件、调用系统 scp、读写交接文件）。
// 页面不能直接使用 Node；文件名与参数怎么定都由页面侧决定，这里只负责执行。
try {
  const services = require('./node/transfer-services.cjs');
  window.__daguTransfer = services.createTransferServices();
} catch (error) {
  // 普通浏览器开发环境没有 Node 能力：页面会提示需要在 ZTools 中运行。
  console.warn('[transfer] preload 初始化失败:', error);
}
