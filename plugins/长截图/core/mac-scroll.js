/**
 * macOS 滚轮控制模块
 * 使用原生 Objective-C 程序实现真正的鼠标滚轮事件
 */

const { execFile } = require('child_process');
const path = require('path');

// 获取 mac-cg-scroll 可执行文件的路径
const SCROLL_BIN_PATH = path.join(__dirname, 'mac-cg-scroll');

/**
 * 执行鼠标滚轮事件
 * @param {number} deltaY - 滚动量，正值向下滚动，负值向上滚动
 * @returns {void}
 */
function performScroll(deltaY) {
  // 执行原生程序，直接传递滚动量参数
  execFile(SCROLL_BIN_PATH, [deltaY.toString()], (error) => {
    if (error) {
      console.error('鼠标滚轮模拟错误:', error);
    }
  });
}

// 导出与 node-win-mouse 兼容的接口
module.exports = {
  // 基本滚动方法，兼容 node-win-mouse 接口
  scroll: function(deltaY) {
    performScroll(deltaY);
  }
}; 