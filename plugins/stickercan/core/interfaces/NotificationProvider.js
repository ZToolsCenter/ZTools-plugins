/**
 * NotificationProvider - 通知抽象接口
 *
 * 定义跨平台的消息通知能力。
 */

class NotificationProvider {
  /**
   * 显示消息通知
   * @param {string} message - 消息内容
   * @param {'info'|'success'|'error'|'warning'} type - 消息类型
   */
  showMessage(message, type = 'info') {
    throw new Error('NotificationProvider.showMessage() 未实现');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = NotificationProvider;
}
