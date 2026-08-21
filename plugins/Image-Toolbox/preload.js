const { initPlatformPreload } = require('./core/src/preloadHelpers.js');

// ═══════════════════════════════════════════════════════════════
// ZTools 平台特定配置
// ═══════════════════════════════════════════════════════════════

if (typeof window !== 'undefined') {
  initPlatformPreload({
    name: 'ZTools',
    apiKeys: ['hostTools', 'ztools', 'utools'],
    userFnName: 'getZtoolsUser',
    contactUrl: 'https://qm.qq.com/q/xdx9hstuGA',
  });
}
