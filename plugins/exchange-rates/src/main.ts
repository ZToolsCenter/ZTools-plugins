import { createApp } from "vue";
import App from "./App.vue";
import { installBrowserFx } from "./browser-fx";
import { messages, resolveLocale } from "./i18n";
import "./style.css";

if (import.meta.env.DEV) {
  document.documentElement.classList.add("dev-host");
  void import("./dev-preview.css");
}

if (!window.fx) installBrowserFx();

const locale = resolveLocale(navigator.language || "en");
document.documentElement.lang = locale;
document.title = messages(locale).select === "選擇貨幣" ? "匯率換算" : "Exchange rates";

createApp(App).mount("#app");
