import { createPinia } from "pinia";
import { createApp } from "vue";
import "./input.css";
import App from "./App.vue";
import { router } from "./router";
import { useMessage } from "./utils/message";

const pinia = createPinia();
const app = createApp(App);
app.use(router);

// 全局错误处理
app.config.errorHandler = (err, instance, info) => {
  console.error("Vue 全局错误:", err, info);

  // 尝试获取 message store 并显示错误
  try {
    const message = useMessage(pinia);
    message.error(`发生错误: ${err instanceof Error ? err.message : String(err)}`);
  } catch (e) {
    // 如果 Pinia 还未初始化，使用 console 降级处理
    console.error("无法显示消息通知:", e);
  }
};

// 全局未捕获的 Promise 错误
window.addEventListener("unhandledrejection", (event) => {
  console.error("未处理的 Promise 错误:", event.reason);

  try {
    const message = useMessage(pinia);
    message.error(
      `异步错误: ${event.reason instanceof Error ? event.reason.message : String(event.reason)}`,
    );
  } catch (e) {
    console.error("无法显示消息通知:", e);
  }
});

// 全局 JavaScript 错误
window.addEventListener("error", (event) => {
  console.error("全局 JavaScript 错误:", event.error);

  try {
    const message = useMessage(pinia);
    message.error(
      `脚本错误: ${event.error instanceof Error ? event.error.message : event.message}`,
    );
  } catch (e) {
    console.error("无法显示消息通知:", e);
  }
});

app.use(pinia).mount("#app");
