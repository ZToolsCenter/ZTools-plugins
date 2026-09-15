/**
 * ZToolsNotificationProvider - ZTools 通知适配器
 *
 * 实现 NotificationProvider 接口。
 * 使用 DOM 创建消息提示条。
 */

// [browser] 上述模块已通过 <script> 标签全局加载
class ZToolsNotificationProvider extends NotificationProvider {
  constructor(deps = {}) {
    super();
    this.themeManager = deps.themeManager;
  }

  showMessage(message, type = 'info') {
    const messageEl = document.createElement('div');
    messageEl.className = `message message-${type}`;
    messageEl.textContent = message;

    const isLightMode = this.themeManager ? this.themeManager.isLightMode : false;
    const bgColor = isLightMode ? '#ffffff' : '#1a1a1a';
    const textColor = isLightMode ? '#000000' : '#ffffff';
    const borderColor = isLightMode ? '#e0e0e0' : '#333333';

    messageEl.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      border-radius: 10px;
      color: white;
      font-weight: 500;
      z-index: 10000;
      animation: slideInRight 0.3s ease;
      max-width: 300px;
      word-wrap: break-word;
      background: ${bgColor};
      color: ${textColor};
      border: 2px solid ${borderColor};
    `;

    document.body.appendChild(messageEl);

    setTimeout(() => {
      messageEl.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => {
        if (messageEl.parentNode) {
          messageEl.parentNode.removeChild(messageEl);
        }
      }, 300);
    }, 3000);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ZToolsNotificationProvider;
}
