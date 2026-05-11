// ZTools Preload Script  window.ztools
// 运行在 Node.js 环境，可以使用 Node.js API
const features = require("./service/features")

// 监听插件进入事件
window.ztools.onPluginEnter(({ code, type, payload }) => {
  console.info('Plugin entered:', code, type, payload)
});

// ztools 选项列表
window.exports = {
    ...features.features
}
