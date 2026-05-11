// Service Worker 注册

import { PWAUpdateManager } from "./pwa-updates";
import { isPWA } from "./pwa";

let updateManager: PWAUpdateManager | null = null;
let isRegistered = false;

export async function registerServiceWorker() {
  // 只在 PWA 环境下注册 Service Worker
  if (!isPWA() || !("serviceWorker" in navigator) || isRegistered) {
    return;
  }

  try {
    // 检查是否在开发环境
    const isDev = process.env.NODE_ENV === "development";

    // 注册 Service Worker
    const registration = await navigator.serviceWorker.register(
      isDev ? "/dev-sw.js?dev-sw" : "/sw.js",
      {
        type: isDev ? "module" : undefined,
      },
    );

    // 初始化 PWA 更新管理器
    updateManager = new PWAUpdateManager({
      checkInterval: 30 * 60 * 1000, // 30 分钟检查一次
      autoUpdate: false,
    });

    // 手动初始化更新管理器（因为不使用Hook）
    await updateManager.init();

    // 立即检查是否有待处理的更新
    if (registration.waiting) {
      window.dispatchEvent(
        new CustomEvent("pwa-update-available", {
          detail: {
            isUpdateAvailable: true,
            isOfflineReady: true,
          },
        }),
      );
    }

    isRegistered = true;
  } catch {
    // 静默处理注册错误
  }
}

// 导出供其他地方使用
export { registerServiceWorker as default };
