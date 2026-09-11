// 停止控制条窗口的 preload，把停止指令发回主插件窗口
window.gifControlsApi = {
  // 点击停止按钮时调用
  stop() {
    window.ztools.sendToParent('gif-recorder-stop')
  }
}
