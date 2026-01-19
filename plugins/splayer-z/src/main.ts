import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { createApp } from 'vue';

// 引用主项目
import router from '@/router';
import '@/style/animate.scss';
import '@/style/main.scss';
import App from '@plugin/App.vue';

// 引用插件适配层
import { setupAdapters } from '@plugin/adapters';

// 初始化适配层
setupAdapters();

// 创建应用
const app = createApp(App);

// Pinia
const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);
app.use(pinia);

// Router
app.use(router);

// 自定义指令
import { debounceDirective, throttleDirective, visibleDirective } from '@/utils/instruction';
app.directive('debounce', debounceDirective);
app.directive('throttle', throttleDirective);
app.directive('visible', visibleDirective);

// 挂载
app.mount('#app');

console.log('🎵 SPlayer ZTools Plugin started');
console.log('Environment:', {
  __ZTOOLS__: (window as any).__ZTOOLS__,
  __ELECTRON__: (window as any).__ELECTRON__,
  hasZToolsAPI: typeof (window as any).ztools !== 'undefined',
});
