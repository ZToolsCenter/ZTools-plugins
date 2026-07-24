import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import App from "./App.vue";
import "virtual:uno.css";
import i18n from "./i18n";

// Disable right-click context menu
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

const app = createApp(App);
app.use(createPinia());
app.use(ElementPlus);
app.use(i18n);
app.mount("#app");
