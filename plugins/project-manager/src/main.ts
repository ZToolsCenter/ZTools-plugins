import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus, { ElMessage } from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from "./App.vue";
import QuickSearchWindow from './QuickSearchWindow.vue';
import "./styles/theme.css";
import "./styles/git-ui.css";
import "virtual:uno.css";
import i18n from "./i18n";
import { applyUiSizeToRoot, normalizeUiSize } from './utils/uiSize';
import { getSafeErrorMessage } from './utils/errorDetails';
import { installGlobalErrorCapture } from './utils/globalErrorCapture';

function applyInitialUiSize(): void {
  let storedUiSize: unknown;
  try {
    const storedSettings = localStorage.getItem('settings');
    if (storedSettings) storedUiSize = JSON.parse(storedSettings).uiSize;
  } catch {
    storedUiSize = undefined;
  }
  applyUiSizeToRoot(normalizeUiSize(storedUiSize));
}

applyInitialUiSize();

// Disable right-click context menu
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

const isQuickSearchWindow = new URLSearchParams(window.location.search).get('window') === 'quick-search';
const app = createApp(isQuickSearchWindow ? QuickSearchWindow : App);
app.use(createPinia());
app.use(ElementPlus);
app.use(i18n);
const globalErrorCapture = installGlobalErrorCapture((error, source) => {
  ElMessage.warning({
    message: `应用遇到非阻塞错误（${source}）：${getSafeErrorMessage(error)}`,
    duration: 4500,
  });
});
app.config.errorHandler = (error, _instance, info) => {
  void info;
  globalErrorCapture.capture(error, 'vue');
};
app.mount("#app");
