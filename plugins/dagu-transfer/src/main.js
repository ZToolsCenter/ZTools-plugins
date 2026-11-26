import { createApp, reactive } from 'vue';
import App from './App.vue';
import './styles.css';
import { createZtoolsThemeSync } from './shared/theme.js';
import { createKvStore } from './shared/kv.js';
import { createConfigStore } from './core/config-store.js';
import { createShareFlow } from './flows/share-flow.js';
import { createDownloadFlow } from './flows/download-flow.js';

const win = globalThis.window;
const host = win.ztools || win.utools || null;
// Node 侧能力由 preload 注入；普通浏览器里没有，列表会提示需要在 ZTools 中运行。
const services = win.__daguTransfer || null;

const LIST_CODES = new Set(['share', 'download']);
const SETUP_HEIGHT = 600;

const view = reactive({ route: '' });
const configStore = createConfigStore({ kv: createKvStore({ win }) });
const show = (route) => {
  view.route = route;
  // 配置页没有可筛选的列表，不能留着上一步的搜索框。
  if (!LIST_CODES.has(route)) host?.removeSubInput?.();
};
const flows = {
  share: createShareFlow({ services, host, configStore, openSetup: () => show('setup') }),
  download: createDownloadFlow({ services, host, configStore, openSetup: () => show('setup') })
};

async function enter(param = {}) {
  if (LIST_CODES.has(param.code)) {
    show(param.code);
    // 先清掉上一次留下的搜索框回调，流程进入时会重新设置。
    await host?.removeSubInput?.();
    await flows[param.code].enter(param);
    return;
  }
  show('setup');
  host?.setExpendHeight?.(SETUP_HEIGHT);
}

function leave() {
  Object.values(flows).forEach((flow) => flow.reset());
  view.route = '';
}

// 主色与深浅色都跟随 ZTools（宿主设置默认跟随系统），与大古截图共用同一份实现。
createZtoolsThemeSync({ win, doc: win.document });

createApp(App, { view, flows, host, configStore }).mount('#app');

host?.onPluginOut?.(leave);
host?.onPluginEnter?.((param) => enter(param));

// index.html 的内联脚本接住了页面脚本执行前到达的进入事件，这里补上。
const earlyParam = win.__ztoolsEnterParam;
if (earlyParam) {
  win.__ztoolsEnterParam = null;
  void enter(earlyParam);
}
