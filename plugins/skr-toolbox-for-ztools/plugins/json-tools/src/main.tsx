import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import App from "./App.tsx";
import { Provider } from "./provider.tsx";

import {
  initMonacoGlobally,
  registerGlobalBase64Provider,
} from "@/components/monacoEditor/decorations/decorationInit.ts";

import "@/styles/globals.css";
import DefaultLayout from "@/layouts/default";
import { FontSizeManager } from "@/components/FontSizeManager";
import UtoolsListener from "@/services/utoolsListener";
import { PWAUpdateManager } from "@/components/pwa/PWAUpdateManager";
import registerServiceWorker from "@/utils/registerSW";
import { isPWA } from "@/utils/pwa";

// 全局初始化Monaco编辑器
initMonacoGlobally().then(() => {
  // 注册全局提供者
  registerGlobalBase64Provider();
});

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
  window.addEventListener("load", () => {
    initializeUtoolsListener();
    initializePWA();
  });
} else {
  // 在开发环境中直接初始化
  initializeUtoolsListener();
  initializePWA();
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
