(function () {
  'use strict';
  // The browser preview exercises the same core, with storage isolated from ZTools.
  if (window.ztools || window.quickInput) return;
  window.quickInputPreview = true;
  const features = new Map();
  function requireZTools() {
    throw new Error('请在 ZTools 中打开插件，再使用模拟输入或绑定快捷键。');
  }
  try {
    window.quickInput = window.QuickInput.createQuickInput({
      dbStorage: {
        getItem: key => JSON.parse(localStorage.getItem('preview.' + key)),
        setItem: (key, value) => localStorage.setItem('preview.' + key, JSON.stringify(value)),
      },
      getFeatures: () => [...features.values()],
      setFeature: feature => { features.set(feature.code, feature); return true; },
      removeFeature: code => features.delete(code),
      hideMainWindowTypeString: requireZTools,
      hideMainWindow: requireZTools,
      outPlugin: requireZTools,
      redirectHotKeySetting: requireZTools,
      copyText: requireZTools,
    });
  } catch (error) {
    window.quickInputError = error.message;
  }
})();
