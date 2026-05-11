import {createApp} from 'vue';
import Antd from 'ant-design-vue';
import App from './App.vue';
import 'ant-design-vue/dist/reset.css';
import './style.css';
import {createPinia} from "pinia";
import mitt from 'mitt';
import router from './router';





// import eruda from 'eruda';
// eruda.init();

const emitter = mitt()
const app = createApp(App);
app.config.globalProperties.$eventBus = emitter;
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(Antd).mount('#app');