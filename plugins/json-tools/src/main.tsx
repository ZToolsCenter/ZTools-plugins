import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import App from "./App.tsx";
import { Provider } from "./provider.tsx";

import { WALManager } from "@/lib/storage/WALManager";
import { getLockManager } from "@/lib/storage/DistributedLockManager";

import "@/styles/globals.css";
import DefaultLayout from "@/layouts/default";
import { FontSizeManager } from "@/components/FontSizeManager";
import UtoolsListener from "@/services/utoolsListener";
import { PWAUpdateManager } from "@/components/pwa/PWAUpdateManager";
import registerServiceWorker from "@/utils/registerSW";
import { isPWA } from "@/utils/pwa";

// 初始化存储系统
const initializeStorage = async () => {
  try {
    console.log("初始化存储系统...");

    // 1. 恢复 WAL（写前日志）
    const walManager = new WALManager();

    await walManager.recover();

    // 2. 清理过期的分布式锁
    const lockManager = getLockManager();

    await lockManager.cleanupExpiredLocks();

    console.log("存储系统初始化完成");
  } catch (error) {
    console.error("存储系统初始化失败:", error);
  }
};

// 初始化 Utools 监听器
const initializeUtoolsListener = () => {
  setTimeout(() => {
    UtoolsListener.getInstance().initialize();
  }, 0);
};

// 初始化 PWA Service Worker（仅在 PWA 环境下）
const initializePWA = async () => {
  // 只在 PWA 环境下注册 Service Worker
  if (isPWA() && "serviceWorker" in navigator) {
    await registerServiceWorker();
  }
};

// 监听应用加载完成事件
if (typeof window !== "undefined") {
  window.addEventListener("load", async () => {
    // 首先初始化存储系统
    await initializeStorage();

    // 然后初始化其他系统
    initializeUtoolsListener();
    initializePWA();
  });

  // 页面关闭前保存数据
  window.addEventListener("beforeunload", async () => {
    // 这里会被各个 store 的 beforeunload 处理器覆盖
    // 但作为一个额外的保险措施
    console.log("应用即将关闭，确保数据已保存");
  });
} else {
  // 在开发环境中直接初始化
  (async () => {
    await initializeStorage();
    initializeUtoolsListener();
    initializePWA();
  })();
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Provider>
        <FontSizeManager />
        <DefaultLayout>
          <App />
        </DefaultLayout>
        {/* PWA 更新管理组件 */}
        <PWAUpdateManager />
      </Provider>
    </HashRouter>
  </React.StrictMode>,
);
