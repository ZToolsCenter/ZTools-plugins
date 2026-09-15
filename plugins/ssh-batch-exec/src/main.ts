import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { installDevMock } from "./devMock";

installDevMock();

createApp(App).mount("#app");
