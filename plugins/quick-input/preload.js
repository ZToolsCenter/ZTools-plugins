'use strict';

const { createQuickInput, FEATURE_PREFIX } = require('./commands.js');

try {
  window.quickInput = createQuickInput(window.ztools);
} catch (error) {
  window.quickInputError = error.message;
}

window.ztools.onPluginEnter(async ({ code }) => {
  try {
    if (!window.quickInput) throw new Error(window.quickInputError || '快捷输入初始化失败。');
    window.quickInput.refresh();
    if (code?.startsWith(FEATURE_PREFIX)) {
      await window.quickInput.type(code.slice(FEATURE_PREFIX.length));
    } else {
      window.ztools.setExpendHeight(620);
      window.dispatchEvent(new CustomEvent('quick-input-refresh'));
    }
  } catch (error) {
    window.dispatchEvent(new CustomEvent('quick-input-error', { detail: error.message }));
    window.ztools.showNotification('快捷输入：' + error.message);
  }
});
