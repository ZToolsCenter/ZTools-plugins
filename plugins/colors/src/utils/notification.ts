/**
 * ZTools 通知工具
 * 使用 ZTools 提供的 showNotification API 显示系统通知
 */

// 导入类型声明（ztools 是全局变量）
import { showNotification as zShowNotification } from "@ztools-center/ztools-api-types";

/**
 * 显示系统通知
 * @param message 通知内容
 */
export function showNotification(message: string): void {
  // 在 ZTools 环境中，ztools 是全局可用的
  // 在开发环境中，ztools 可能未定义
  if (typeof window !== "undefined" && (window as any).ztools) {
    zShowNotification(message);
  } else {
    // 开发环境降级处理：使用浏览器原生通知或 console
    console.log("[Notification]", message);

    // 如果浏览器支持 Notification API，尝试使用
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("颜色助手", { body: message });
    }
  }
}

/**
 * 显示成功通知
 * @param message 通知内容
 */
export function showSuccess(message: string): void {
  showNotification(`✓ ${message}`);
}

/**
 * 显示错误通知
 * @param message 通知内容
 */
export function showError(message: string): void {
  showNotification(`✗ ${message}`);
}
