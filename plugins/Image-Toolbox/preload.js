const { initPlatformPreload } = require('./core/src/preloadHelpers.js');

// ═══════════════════════════════════════════════════════════════
// ZTools 平台特定配置
// ═══════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  initPlatformPreload({
    name: 'ZTools',
    // 仅保留 ZTools 自有 API 键：不得把 uTools 的全局对象当作兜底，
    // 否则会把 ZTools API 别名成 window.utools，导致页面侧平台判定错配。
    apiKeys: ['hostTools', 'ztools'],
    userFnName: 'getZtoolsUser',
    contactUrl: 'https://qm.qq.com/q/xdx9hstuGA',
  });
}
