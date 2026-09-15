// 区域框选窗口的 preload，只负责把选区结果发回主插件窗口
window.gifRegionApi = {
  // 选择完成，payload 为相对当前显示器的矩形
  done(rect) {
    window.ztools.sendToParent('gif-region-selected', rect)
  },
  // 用户取消选择
  cancel() {
    window.ztools.sendToParent('gif-region-cancel')
  }
}
