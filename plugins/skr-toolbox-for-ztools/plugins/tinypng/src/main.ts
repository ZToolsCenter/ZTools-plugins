import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn.js';
import { createApp } from 'vue';
import { ElNotification } from 'element-plus';

import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import relativeTime from 'dayjs/plugin/relativeTime';

import './style.css';
import App from './App.vue';
import './assets/iconfont.js';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

function handleError(error: any) {
  console.error('error: ', error);
  ElNotification({
    title: 'Error',
    message: String(error),
    type: 'error'
  });
}

const app = createApp(App);

app.config.errorHandler = handleError;
window.addEventListener('error', handleError);

app.mount('#app');
