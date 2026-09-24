import './assets/style.css';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index';
import { setupDynamicCommands } from './setup';

async function bootstrap() {
  // 浏览器开发模式：仅当显式声明 VITE_DEV_TARGET=browser（pnpm dev:browser）时注入 mock API
  // dev:all（ztools 目标）即使被普通浏览器打开也不会走 /api，避免误发请求
  const browserTarget = import.meta.env.VITE_DEV_TARGET === 'browser';
  if (import.meta.env.DEV && browserTarget) {
    const { isZtoolsEnv, createBrowserApi } = await import('./utils/browser-adapter');
    if (!isZtoolsEnv()) {
      console.log('🌐 Running in browser mode - using dev API server');
      (window as any).ztoolsCctoggle = createBrowserApi();
      (window as any).ztools = {
        dbStorage: {
          getItem: (key: string) => {
            try {
              return JSON.parse(localStorage.getItem(key) || 'null');
            } catch {
              return null;
            }
          },
          setItem: (key: string, value: any) => localStorage.setItem(key, JSON.stringify(value)),
          removeItem: (key: string) => localStorage.removeItem(key)
        },
        copyText: (text: string) => navigator.clipboard.writeText(text),
        showSaveDialog: () => null,
        getPath: () => ''
      };
    }
  }

  const app = createApp(App);
  app.use(router);
  setupDynamicCommands();
  app.mount('#app');
}

bootstrap().then(r => {});
