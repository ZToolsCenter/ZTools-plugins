const { transform, MODES } = require('./lib/char-transform.cjs');

/**
 * preload 脚本：向渲染进程暴露 Node 侧能力
 * 规范：代码清晰可读，禁止打包/压缩/混淆
 */
window.charTransformApi = {
  modes: MODES,
  transform(text, mode) {
    return transform(text, mode);
  },
};
