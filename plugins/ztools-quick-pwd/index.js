// DOM 元素引用
const viewUnlock = document.getElementById('view-unlock');
const viewQuick = document.getElementById('view-quick');
const viewManager = document.getElementById('view-manager');

// 解锁视图
const unlockTitle = document.getElementById('unlock-title');
const unlockDesc = document.getElementById('unlock-desc');
const unlockPin = document.getElementById('unlock-pin');
const unlockPinConfirm = document.getElementById('unlock-pin-confirm');
const unlockPinConfirmWrap = document.getElementById('unlock-pin-confirm-wrap');
const btnToggleUnlockPin = document.getElementById('btn-toggle-unlock-pin');
const btnToggleUnlockConfirm = document.getElementById('btn-toggle-unlock-confirm');
const btnUnlockSubmit = document.getElementById('btn-unlock-submit');
const btnSkipMasterPin = document.getElementById('btn-skip-master-pin');

// 快捷选密视图
const quickFilterInput = document.getElementById('quick-filter-input');
const quickList = document.getElementById('quick-list');
const btnQuickModeToggle = document.getElementById('btn-quick-mode-toggle');
const btnQuickOpenMgr = document.getElementById('btn-quick-open-mgr');
const quickFooterPrimary = document.getElementById('quick-footer-primary');

// 管理视图
const mgrSearchInput = document.getElementById('mgr-search-input');
const mgrTableBody = document.getElementById('mgr-table-body');
const mgrCount = document.getElementById('mgr-count');
const btnAddEntry = document.getElementById('btn-add-entry');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnLockVault = document.getElementById('btn-lock-vault');

// 新增/编辑弹窗
const modalEntry = document.getElementById('modal-entry');
const modalEntryTitle = document.getElementById('modal-entry-title');
const entryId = document.getElementById('entry-id');
const entryLabel = document.getElementById('entry-label');
const entryUsername = document.getElementById('entry-username');
const entryPassword = document.getElementById('entry-password');
const entryNote = document.getElementById('entry-note');
const entryPwdRequired = document.getElementById('entry-pwd-required');
const btnGenEntryPwd = document.getElementById('btn-gen-entry-pwd');
const btnToggleEntryPwd = document.getElementById('btn-toggle-entry-pwd');
const entryPwdStrength = document.getElementById('entry-pwd-strength');
const entryPwdStrengthFill = document.getElementById('entry-pwd-strength-fill');
const entryPwdStrengthText = document.getElementById('entry-pwd-strength-text');
const btnSaveEntry = document.getElementById('btn-save-entry');
const btnCancelEntry = document.getElementById('btn-cancel-entry');
const btnCloseEntryModal = document.getElementById('btn-close-entry-modal');

// 查看详情弹窗
const modalViewPwd = document.getElementById('modal-view-pwd');
const viewLabel = document.getElementById('view-label');
const viewUsername = document.getElementById('view-username');
const viewPlainPwd = document.getElementById('view-plain-pwd');
const viewNoteGroup = document.getElementById('view-note-group');
const viewNote = document.getElementById('view-note');
const btnCopyViewUser = document.getElementById('btn-copy-view-user');
const btnCopyViewPwd = document.getElementById('btn-copy-view-pwd');
const btnCloseViewModal = document.getElementById('btn-close-view-modal');
const btnCloseViewBtn = document.getElementById('btn-close-view-btn');

// 设置弹窗
const modalSettings = document.getElementById('modal-settings');
const settingRequirePin = document.getElementById('setting-require-pin');
const settingsItemAutoLock = document.getElementById('settings-item-auto-lock');
const settingClearClipboard = document.getElementById('setting-clear-clipboard');
const settingFillMode = document.getElementById('setting-fill-mode');
const settingFillDelay = document.getElementById('setting-fill-delay');
const settingTabDelay = document.getElementById('setting-tab-delay');
const settingFillStrategy = document.getElementById('setting-fill-strategy');
const settingAutoLock = document.getElementById('setting-auto-lock');
const settingOpenStandalone = document.getElementById('setting-open-standalone');
const btnOpenChangePin = document.getElementById('btn-open-change-pin');
const btnExportVault = document.getElementById('btn-export-vault');
const btnImportVault = document.getElementById('btn-import-vault');
const inputImportVault = document.getElementById('input-import-vault');
const btnDetachWindow = document.getElementById('btn-detach-window');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');

// 修改/开启主密码弹窗
const modalChangePin = document.getElementById('modal-change-pin');
const changePinTitle = document.getElementById('change-pin-title');
const changeOldPinGroup = document.getElementById('change-old-pin-group');
const changeOldPin = document.getElementById('change-old-pin');
const changeNewPin = document.getElementById('change-new-pin');
const changeConfirmPin = document.getElementById('change-confirm-pin');
const btnSubmitChangePin = document.getElementById('btn-submit-change-pin');
const btnCancelChangePin = document.getElementById('btn-cancel-change-pin');
const btnCloseChangePinModal = document.getElementById('btn-close-change-pin-modal');

// 自定义确认弹窗
const modalConfirm = document.getElementById('modal-confirm');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const btnConfirmOk = document.getElementById('btn-confirm-ok');
const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
const btnCloseConfirmModal = document.getElementById('btn-close-confirm-modal');

// 使用指南弹窗
const btnOpenGuide = document.getElementById('btn-open-guide');
const modalGuide = document.getElementById('modal-guide');
const btnCloseGuideModal = document.getElementById('btn-close-guide-modal');
const btnCloseGuideBtn = document.getElementById('btn-close-guide-btn');

const toastEl = document.getElementById('toast');

// 精致 SVG 图标常量
const ICONS = {
  eyeOpen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z"/></svg>',
  eyeOff: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M11.83,9L15,12.16C15,12.11 15,12.05 15,12A3,3 0 0,0 12,9C11.94,9 11.89,9 11.83,9M7.53,9.8L9.08,11.35C9.03,11.56 9,11.77 9,12A3,3 0 0,0 12,15C12.22,15 12.44,14.97 12.65,14.92L14.2,16.47C13.53,16.8 12.79,17 12,17A5,5 0 0,1 7,12C7,11.21 7.2,10.47 7.53,9.8M2,4.27L4.28,6.55L4.73,7C3.08,8.3 1.78,10 1,12C2.73,16.39 7,19.5 12,19.5C13.55,19.5 15.03,19.2 16.38,18.66L16.81,19.08L19.73,22L21,20.73L3.27,3M12,7A5,5 0 0,1 17,12C17,12.64 16.87,13.26 16.64,13.82L19.57,16.75C21.07,15.5 22.27,13.86 23,12C21.27,7.61 17,4.5 12,4.5C10.6,4.5 9.26,4.75 8,5.2L10.17,7.35C10.74,7.13 11.35,7 12,7Z"/></svg>',
  starFilled: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>',
  starOutline: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12,15.39L8.24,17.66L9.23,13.38L5.91,10.5L10.29,10.13L12,6.09L13.71,10.13L18.09,10.5L14.77,13.38L15.76,17.66M22,9.24L14.81,8.63L12,2L9.19,8.63L2,9.24L7.45,13.97L5.82,21L12,17.27L18.18,21L16.54,13.97L22,9.24Z"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/></svg>',
  dice: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M5,3H19A2,2 0 0,1 21,5V19A2,2 0 0,1 19,21H5A2,2 0 0,1 3,19V5A2,2 0 0,1 5,3M7.5,6A1.5,1.5 0 0,0 6,7.5A1.5,1.5 0 0,0 7.5,9A1.5,1.5 0 0,0 9,7.5A1.5,1.5 0 0,0 7.5,6M16.5,6A1.5,1.5 0 0,0 15,7.5A1.5,1.5 0 0,0 16.5,9A1.5,1.5 0 0,0 18,7.5A1.5,1.5 0 0,0 16.5,6M12,10.5A1.5,1.5 0 0,0 10.5,12A1.5,1.5 0 0,0 12,13.5A1.5,1.5 0 0,0 13.5,12A1.5,1.5 0 0,0 12,10.5M7.5,15A1.5,1.5 0 0,0 6,16.5A1.5,1.5 0 0,0 7.5,18A1.5,1.5 0 0,0 9,16.5A1.5,1.5 0 0,0 7.5,15M16.5,15A1.5,1.5 0 0,0 15,16.5A1.5,1.5 0 0,0 16.5,18A1.5,1.5 0 0,0 18,16.5A1.5,1.5 0 0,0 16.5,15Z"/></svg>'
};

// 初始化固定按钮 SVG 图标
if (btnToggleUnlockPin) btnToggleUnlockPin.innerHTML = ICONS.eyeOpen;
if (btnToggleUnlockConfirm) btnToggleUnlockConfirm.innerHTML = ICONS.eyeOpen;
if (btnGenEntryPwd) btnGenEntryPwd.innerHTML = ICONS.dice;
if (btnToggleEntryPwd) btnToggleEntryPwd.innerHTML = ICONS.eyeOpen;

// 触发关键词（不用于快捷选密搜索词回填）
const QUICK_TRIGGER_CMDS = new Set(['填密码', '快速填充', 'quick pwd', 'pwd-quick-fill']);

// 内部状态
let currentTargetCode = 'pwd-manager';
let quickAllEntries = [];
let filteredQuickItems = [];
let quickSelectedIndex = 0;
let isFillingInProgress = false;
let toastTimer = null;
let confirmResolver = null;
let lastActivityTouchAt = 0;
let pinModalMode = 'change'; // 'change' | 'enable'

// ======================= 工具函数 =======================
const STANDALONE_ALIVE_KEY = 'quick_pwd_standalone_alive_ts';
const bus = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ztools_quick_pwd_bus') : null;

function getWindowMode() {
  const ztoolsObj = window.ztools || window.utools;
  if (ztoolsObj && typeof ztoolsObj.getWindowType === 'function') {
    return ztoolsObj.getWindowType(); // 'main' | 'browser' | 'detach'
  }
  return 'main';
}

function isDetached() {
  const mode = getWindowMode();
  return mode === 'detach' || mode === 'browser';
}

function updateStandaloneHeartbeat() {
  try {
    localStorage.setItem(STANDALONE_ALIVE_KEY, String(Date.now()));
  } catch (e) {}
}

function clearStandaloneHeartbeat() {
  try {
    localStorage.removeItem(STANDALONE_ALIVE_KEY);
  } catch (e) {}
}

function startStandaloneHeartbeat() {
  updateStandaloneHeartbeat();
  if (!window._standaloneHeartbeatTimer) {
    window._standaloneHeartbeatTimer = setInterval(updateStandaloneHeartbeat, 1200);
    window.addEventListener('beforeunload', clearStandaloneHeartbeat);
  }
}

// 节流上报用户活跃状态，驱动空闲自动锁定计时
function notifyActivity() {
  const now = Date.now();
  if (now - lastActivityTouchAt > 5000) {
    lastActivityTouchAt = now;
    if (window.pwdApi && typeof window.pwdApi.touchActivity === 'function') {
      window.pwdApi.touchActivity();
    }
  }
}

['mousedown', 'keydown', 'input'].forEach((evtName) => {
  window.addEventListener(evtName, notifyActivity, { passive: true });
});

// 独立窗口环境初始化心跳与广播监听
if (isDetached()) {
  startStandaloneHeartbeat();
  window.addEventListener('focus', () => {
    if (window.pwdApi && typeof window.pwdApi.bringToFront === 'function') {
      window.pwdApi.bringToFront();
    }
  });
}

if (bus) {
  bus.onmessage = (event) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === 'WAKE_UP') {
      if (window.pwdApi && typeof window.pwdApi.bringToFront === 'function') {
        window.pwdApi.bringToFront();
      } else {
        window.focus();
      }

      if (msg.action) {
        const act = msg.action;
        currentTargetCode = act.code || 'pwd-manager';
        if (act.payload && typeof act.payload === 'string') {
          const q = act.payload.trim();
          if (q && mgrSearchInput) {
            mgrSearchInput.value = q;
          }
        }
        if (window.pwdApi && !window.pwdApi.isUnlocked()) {
          switchView('unlock');
        } else {
          switchView('manager');
        }
      }
    }
  };
}

function safeSetExpendHeight(height) {
  const ztoolsObj = window.ztools || window.utools;
  if (!ztoolsObj || typeof ztoolsObj.setExpendHeight !== 'function') return;
  if (isDetached()) return;
  ztoolsObj.setExpendHeight(height);
}

// 防抖 Toast：连续调用时先清理上一个计时器，避免提前隐藏
function showToast(msg, duration = 2000) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
    toastTimer = null;
  }, duration);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 多关键词分词与匹配
function parseSearchTokens(query) {
  return (query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchEntry(item, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const label = (item.label || '').toLowerCase();
  const username = (item.username || '').toLowerCase();
  const note = (item.note || '').toLowerCase();
  return tokens.every((t) => label.includes(t) || username.includes(t) || note.includes(t));
}

// 先转义 HTML 再包裹高亮标签，确保安全与准确
function highlightText(str, tokens) {
  const safe = escapeHtml(str);
  if (!safe || !tokens || tokens.length === 0) return safe;
  const escapedTokens = tokens.map((t) => escapeRegExp(escapeHtml(t))).filter(Boolean);
  if (escapedTokens.length === 0) return safe;
  // 按长度降序匹配，避免短词截断长词
  escapedTokens.sort((a, b) => b.length - a.length);
  const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
  return safe.replace(regex, '<mark class="quick-match-mark">$1</mark>');
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 统一密码输入框显隐切换绑定
function bindPasswordToggle(inputEl, btnEl) {
  if (!inputEl || !btnEl) return;
  btnEl.addEventListener('click', () => {
    if (inputEl.type === 'password') {
      inputEl.type = 'text';
      btnEl.innerHTML = ICONS.eyeOff;
    } else {
      inputEl.type = 'password';
      btnEl.innerHTML = ICONS.eyeOpen;
    }
    inputEl.focus();
  });
}

bindPasswordToggle(unlockPin, btnToggleUnlockPin);
bindPasswordToggle(unlockPinConfirm, btnToggleUnlockConfirm);
bindPasswordToggle(entryPassword, btnToggleEntryPwd);

// 通用异步复制封装（密码走自动清理，非密码走普通复制）
async function copyTextSafe(text, isSecret) {
  if (!text) return false;
  if (window.pwdApi) {
    if (isSecret && typeof window.pwdApi.copySecret === 'function') {
      return window.pwdApi.copySecret(text);
    }
    if (!isSecret && typeof window.pwdApi.copyPlainText === 'function') {
      return window.pwdApi.copyPlainText(text);
    }
  }
  const ztoolsObj = window.ztools || window.utools;
  if (ztoolsObj && typeof ztoolsObj.copyText === 'function') {
    ztoolsObj.copyText(text);
    return true;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

// 自定义内联确认弹窗（替代 window.confirm，不触发失焦隐藏且适配深浅色）
function showConfirmDialog({ title = '确认操作', message = '', confirmText = '确认', danger = false } = {}) {
  return new Promise((resolve) => {
    if (confirmResolver) {
      confirmResolver(false);
      confirmResolver = null;
    }
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    btnConfirmOk.textContent = confirmText;
    btnConfirmOk.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    modalConfirm.classList.add('active');
    confirmResolver = resolve;
    setTimeout(() => btnConfirmOk.focus(), 30);
  });
}

function closeConfirmDialog(result) {
  modalConfirm.classList.remove('active');
  if (confirmResolver) {
    const fn = confirmResolver;
    confirmResolver = null;
    fn(!!result);
  }
}

btnConfirmOk.addEventListener('click', () => closeConfirmDialog(true));
btnConfirmCancel.addEventListener('click', () => closeConfirmDialog(false));
btnCloseConfirmModal.addEventListener('click', () => closeConfirmDialog(false));

// 密码生成与强度评估
function generateStrongPassword(length = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*_-+=?';
  const all = upper + lower + digits + symbols;

  const getRandInt = (max) => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  };

  const chars = [
    upper[getRandInt(upper.length)],
    lower[getRandInt(lower.length)],
    digits[getRandInt(digits.length)],
    symbols[getRandInt(symbols.length)]
  ];

  for (let i = chars.length; i < length; i++) {
    chars.push(all[getRandInt(all.length)]);
  }

  // Fisher-Yates 洗牌打乱顺序
  for (let i = chars.length - 1; i > 0; i--) {
    const j = getRandInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function evaluatePasswordStrength(pwd) {
  if (!pwd) return null;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (pwd.length >= 12) score += 1;
  if (pwd.length >= 16) score += 1;
  if (/[a-z]/.test(pwd)) score += 1;
  if (/[A-Z]/.test(pwd)) score += 1;
  if (/[0-9]/.test(pwd)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 1;

  if (pwd.length < 6 || score <= 2) {
    return { label: '弱', percent: 33, color: 'var(--danger-color)' };
  }
  if (score <= 5) {
    return { label: '中', percent: 66, color: 'var(--warning-color)' };
  }
  return { label: '强', percent: 100, color: 'var(--success-color)' };
}

function updateEntryPasswordStrength() {
  const val = entryPassword.value;
  const info = evaluatePasswordStrength(val);
  if (!info) {
    entryPwdStrength.style.display = 'none';
    return;
  }
  entryPwdStrength.style.display = 'flex';
  entryPwdStrengthFill.style.width = `${info.percent}%`;
  entryPwdStrengthFill.style.backgroundColor = info.color;
  entryPwdStrengthText.textContent = info.label;
  entryPwdStrengthText.style.color = info.color;
}

// 切换视图（修复：先重置 quickFilterInput 与选中索引再渲染，避免旧过滤词残留）
function switchView(viewName, initialQuery = '') {
  [viewUnlock, viewQuick, viewManager].forEach((v) => v.classList.remove('active'));

  if (viewName === 'unlock') {
    viewUnlock.classList.add('active');
    safeSetExpendHeight(280);
    setupUnlockView();
  } else if (viewName === 'quick') {
    viewQuick.classList.add('active');
    quickFilterInput.value = initialQuery;
    quickSelectedIndex = 0;
    updateQuickModeDisplay();
    renderQuickList(true);
    setTimeout(() => quickFilterInput.focus(), 20);
  } else if (viewName === 'manager') {
    viewManager.classList.add('active');
    safeSetExpendHeight(560);
    if (btnDetachWindow) {
      btnDetachWindow.style.display = isDetached() ? 'none' : 'inline-flex';
    }
    syncMasterPinUiState();
    renderManagerList();
    setTimeout(() => mgrSearchInput.focus(), 20);
  }
}

// 同步主密码保护开关在管理页与设置弹窗中的 UI 状态
function syncMasterPinUiState() {
  if (!window.pwdApi || typeof window.pwdApi.isMasterPinRequired !== 'function') return;
  const required = window.pwdApi.isMasterPinRequired();
  if (btnLockVault) {
    btnLockVault.style.display = required ? 'inline-flex' : 'none';
  }
  if (settingRequirePin) {
    settingRequirePin.checked = required;
  }
  if (settingAutoLock) {
    settingAutoLock.disabled = !required;
  }
  if (settingsItemAutoLock) {
    settingsItemAutoLock.classList.toggle('is-disabled', !required);
  }
  if (btnOpenChangePin) {
    btnOpenChangePin.disabled = !required;
    btnOpenChangePin.title = required ? '修改当前主密码 PIN' : '当前处于免密模式，请先开启主密码保护';
  }
}

// ======================= 解锁 / 初始设置 =======================
function setupUnlockView() {
  unlockPin.value = '';
  unlockPin.type = 'password';
  if (btnToggleUnlockPin) btnToggleUnlockPin.innerHTML = ICONS.eyeOpen;

  unlockPinConfirm.value = '';
  unlockPinConfirm.type = 'password';
  if (btnToggleUnlockConfirm) btnToggleUnlockConfirm.innerHTML = ICONS.eyeOpen;

  const isFirst = window.pwdApi.isFirstRun();
  if (isFirst) {
    unlockTitle.textContent = '初始化主密码';
    unlockDesc.textContent = '请设置一个主密码 PIN (至少4位)，用于加密本地密码库';
    if (unlockPinConfirmWrap) unlockPinConfirmWrap.style.display = 'flex';
    btnUnlockSubmit.textContent = '创建并解锁';
    if (btnSkipMasterPin) btnSkipMasterPin.style.display = 'inline-flex';
    safeSetExpendHeight(370);
  } else {
    unlockTitle.textContent = '快速密码填充';
    unlockDesc.textContent = '请输入您的安全主密码 PIN 解锁';
    if (unlockPinConfirmWrap) unlockPinConfirmWrap.style.display = 'none';
    btnUnlockSubmit.textContent = '解锁保险库';
    if (btnSkipMasterPin) btnSkipMasterPin.style.display = 'none';
    safeSetExpendHeight(260);
  }
  setTimeout(() => unlockPin.focus(), 50);
}

function triggerInputShake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 400);
}

function handleUnlockOrSetup() {
  const pin = unlockPin.value;
  const isFirst = window.pwdApi.isFirstRun();

  if (!pin || pin.length < 4) {
    showToast('主密码长度不能少于 4 位');
    triggerInputShake(unlockPin);
    unlockPin.focus();
    return;
  }

  if (isFirst) {
    const confirmVal = unlockPinConfirm.value;
    if (pin !== confirmVal) {
      showToast('两次输入的密码不一致');
      triggerInputShake(unlockPinConfirm);
      unlockPinConfirm.focus();
      return;
    }
    try {
      window.pwdApi.setupMasterPin(pin);
      showToast('主密码设置成功！');
      proceedAfterUnlock();
    } catch (err) {
      showToast('初始化失败: ' + err.message);
    }
  } else {
    const ok = window.pwdApi.unlock(pin);
    if (ok) {
      proceedAfterUnlock();
    } else {
      showToast('主密码错误，请重试');
      triggerInputShake(unlockPin);
      unlockPin.value = '';
      unlockPin.focus();
    }
  }
}

function proceedAfterUnlock(initialQuickQuery = '') {
  if (currentTargetCode === 'pwd-quick-fill') {
    switchView('quick', initialQuickQuery);
  } else {
    switchView('manager');
  }
}

btnUnlockSubmit.addEventListener('click', handleUnlockOrSetup);
if (btnSkipMasterPin) {
  btnSkipMasterPin.addEventListener('click', () => {
    try {
      window.pwdApi.setupWithoutMasterPin();
      syncMasterPinUiState();
      showToast('已开启免密使用，可随时在设置中开启主密码保护');
      proceedAfterUnlock();
    } catch (err) {
      showToast('初始化失败: ' + err.message);
    }
  });
}
unlockPin.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (window.pwdApi.isFirstRun()) {
      unlockPinConfirm.focus();
    } else {
      handleUnlockOrSetup();
    }
  }
});
unlockPinConfirm.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleUnlockOrSetup();
  }
});

// ======================= 核心功能：填充密码/账号 =======================
/**
 * 执行填充（带渲染层防重入保护）
 * @param {string} id 条目 id
 * @param {'both'|'username'|'password'} target 填充目标
 */
async function fillPassword(id, target = 'both') {
  if (isFillingInProgress) return;
  isFillingInProgress = true;

  try {
    const entry = window.pwdApi.getEntry(id);
    if (!entry) {
      showToast('未检索到该条目');
      return;
    }
    const username = (entry.username || '').trim();
    const needPwd = target !== 'username';

    if (target === 'username' && !username) {
      showToast('该条目未设置账号');
      return;
    }
    if (target === 'both' && !username) {
      target = 'password';
    }

    const plainPwd = needPwd ? window.pwdApi.getPlainPwd(id) : '';
    if (needPwd && !plainPwd) {
      showToast('未检索到密码内容');
      return;
    }

    const config = window.pwdApi.getConfig();
    const fillMode = config.fillMode || 'paste';
    const isDetachedMode = isDetached();

    const ztoolsObj = window.ztools || window.utools;
    if (ztoolsObj) {
      if (window.pwdApi && typeof window.pwdApi.autoFillCredentials === 'function') {
        await window.pwdApi.autoFillCredentials({
          entryId: id,
          username,
          password: plainPwd,
          mode: fillMode,
          fillTarget: target,
          isDetachedMode
        });
      }
    } else {
      await copyTextSafe(needPwd ? plainPwd : username, needPwd);
      showToast('环境不支持快捷填充，已复制到剪贴板');
    }
  } catch (err) {
    showToast('填充失败: ' + err.message);
  } finally {
    isFillingInProgress = false;
  }
}

// ======================= 快捷选密视图逻辑 =======================
function getFillStrategy() {
  try {
    const config = window.pwdApi.getConfig();
    return config.fillStrategy || 'both';
  } catch (e) {
    return 'both';
  }
}

function getDefaultFillTarget(hasUser) {
  if (!hasUser) return 'password';
  return getFillStrategy() === 'password_only' ? 'password' : 'both';
}

function updateQuickModeDisplay() {
  const strategy = getFillStrategy();
  const isPwdOnly = strategy === 'password_only';
  if (btnQuickModeToggle) {
    btnQuickModeToggle.textContent = isPwdOnly ? '回车: 仅密码' : '回车: 双填';
    btnQuickModeToggle.classList.toggle('is-pwd-only', isPwdOnly);
  }
  if (quickFooterPrimary) {
    quickFooterPrimary.innerHTML = isPwdOnly
      ? '<kbd>↵</kbd> 仅填密码(光标放密码框)'
      : '<kbd>↵</kbd> 双填(光标放账号框)';
  }
}

if (btnQuickModeToggle) {
  btnQuickModeToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    const nextStrategy = getFillStrategy() === 'password_only' ? 'both' : 'password_only';
    window.pwdApi.setConfig({ fillStrategy: nextStrategy });
    updateQuickModeDisplay();
    renderQuickList(false);
    quickFilterInput.focus();
    showToast(nextStrategy === 'password_only' ? '默认回车已切换为：仅填密码' : '默认回车已切换为：账号 + 密码');
  });
}

// 仅切换选中行高亮与滚动，避免键盘导航重读磁盘与重建 DOM
function updateQuickSelection() {
  const items = quickList.querySelectorAll('.quick-item');
  items.forEach((el, idx) => {
    el.classList.toggle('selected', idx === quickSelectedIndex);
  });
  const selectedEl = items[quickSelectedIndex];
  if (selectedEl) {
    selectedEl.scrollIntoView({ block: 'nearest' });
  }
}

function renderQuickList(reloadFromDisk = true) {
  if (reloadFromDisk || quickAllEntries.length === 0) {
    quickAllEntries = window.pwdApi.listEntries();
  }

  const rawQuery = (quickFilterInput.value || '').trim();
  const tokens = parseSearchTokens(rawQuery);
  const strategy = getFillStrategy();

  filteredQuickItems = quickAllEntries.filter((item) => matchEntry(item, tokens));

  if (quickSelectedIndex >= filteredQuickItems.length) {
    quickSelectedIndex = Math.max(0, filteredQuickItems.length - 1);
  }

  quickList.innerHTML = '';
  if (filteredQuickItems.length === 0) {
    const emptyWrap = document.createElement('li');
    emptyWrap.className = 'quick-empty-wrap';
    emptyWrap.innerHTML = `
      <span>未匹配到密码条目</span>
      ${rawQuery ? `<button type="button" id="btn-quick-add-missing" class="btn btn-primary">+ 添加 "${escapeHtml(rawQuery)}" 到密码库</button>` : ''}
    `;
    quickList.appendChild(emptyWrap);
    const addBtn = emptyWrap.querySelector('#btn-quick-add-missing');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        switchView('manager');
        openAddModal(rawQuery);
      });
    }
  } else {
    filteredQuickItems.forEach((item, index) => {
      const hasUser = !!(item.username && item.username.trim());
      const defaultTarget = getDefaultFillTarget(hasUser);
      const li = document.createElement('li');
      li.className = 'quick-item' + (index === quickSelectedIndex ? ' selected' : '');

      const indexBadge = index < 9 ? `<span class="quick-item-index" title="Alt+${index + 1} 直选">${index + 1}</span>` : '';
      const pinBadge = item.pinned ? `<span class="quick-pin-icon" title="已置顶">${ICONS.starFilled}</span>` : '';
      const labelHtml = highlightText(item.label, tokens);
      const userHtml = hasUser ? `<span class="quick-item-user">${highlightText(item.username, tokens)}</span>` : '';
      const noteHtml = item.note ? `<span class="quick-item-note" title="${escapeHtml(item.note)}">${highlightText(item.note, tokens)}</span>` : '';

      const isBothDefault = defaultTarget === 'both' && hasUser && strategy !== 'password_only';
      const isPwdDefault = defaultTarget === 'password';

      li.innerHTML = `
        <div class="quick-item-main">
          ${indexBadge}
          ${pinBadge}
          <div class="quick-item-text">
            <span class="quick-item-label">${labelHtml}</span>
            ${userHtml}
            ${noteHtml}
          </div>
        </div>
        <div class="quick-item-action">
          <button type="button" class="quick-action-btn quick-action-both${hasUser ? '' : ' disabled'}${isBothDefault ? ' is-default' : ''}" data-target="both" title="自动输入账号和密码（光标放账号框）">账号+密码</button>
          <button type="button" class="quick-action-btn quick-action-user${hasUser ? '' : ' disabled'}" data-target="username" title="仅输入账号">账号</button>
          <button type="button" class="quick-action-btn quick-action-pwd${isPwdDefault ? ' is-default' : ''}" data-target="password" title="仅输入密码（光标放密码框）">密码</button>
        </div>
      `;

      li.querySelectorAll('.quick-action-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (btn.classList.contains('disabled')) {
            showToast('该条目未设置账号');
            return;
          }
          fillPassword(item.id, btn.dataset.target);
        });
      });

      li.addEventListener('click', () => {
        quickSelectedIndex = index;
        updateQuickSelection();
        fillPassword(item.id, defaultTarget);
      });

      quickList.appendChild(li);
    });
  }

  // 动态调整窗口高度（包含顶栏 48px + 底栏 28px，最小 170，最大 480）仅在主窗口生效
  const rowsHeight = filteredQuickItems.length > 0 ? filteredQuickItems.length * 44 + 8 : 96;
  const calculatedHeight = Math.min(480, Math.max(170, 76 + rowsHeight));
  safeSetExpendHeight(calculatedHeight);
}

quickFilterInput.addEventListener('input', () => {
  quickSelectedIndex = 0;
  renderQuickList(false);
});

quickFilterInput.addEventListener('keydown', async (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredQuickItems.length > 0) {
      quickSelectedIndex = (quickSelectedIndex + 1) % filteredQuickItems.length;
      updateQuickSelection();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredQuickItems.length > 0) {
      quickSelectedIndex = (quickSelectedIndex - 1 + filteredQuickItems.length) % filteredQuickItems.length;
      updateQuickSelection();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const current = filteredQuickItems[quickSelectedIndex];
    if (current) {
      const hasUser = !!(current.username && current.username.trim());
      let target = getDefaultFillTarget(hasUser);
      if (e.shiftKey) target = 'password';
      else if (e.altKey && hasUser) target = 'username';
      fillPassword(current.id, target);
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
    // 仅当搜索框没有选中文本时，Ctrl+C 才快捷复制当前高亮条目密码
    const hasSelection = quickFilterInput.selectionStart !== quickFilterInput.selectionEnd;
    if (!hasSelection) {
      const current = filteredQuickItems[quickSelectedIndex];
      if (current) {
        e.preventDefault();
        try {
          const plainPwd = window.pwdApi.getPlainPwd(current.id);
          await copyTextSafe(plainPwd, true);
          window.pwdApi.recordUsage(current.id);
          const clearSec = window.pwdApi.getConfig().autoClearClipboardSeconds || 10;
          showToast(`已复制 [${current.label}] 密码，${clearSec}s 后自动清空`);
        } catch (err) {
          showToast('复制密码失败: ' + err.message);
        }
      }
    }
  } else if (e.altKey && /^[1-9]$/.test(e.key)) {
    const idx = parseInt(e.key, 10) - 1;
    const item = filteredQuickItems[idx];
    if (item) {
      e.preventDefault();
      quickSelectedIndex = idx;
      updateQuickSelection();
      const hasUser = !!(item.username && item.username.trim());
      fillPassword(item.id, getDefaultFillTarget(hasUser));
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (quickFilterInput.value) {
      quickFilterInput.value = '';
      quickSelectedIndex = 0;
      renderQuickList(false);
    } else if (isDetached()) {
      window.pwdApi.minimizeSelf();
    } else {
      const ztoolsObj = window.ztools || window.utools;
      if (ztoolsObj && typeof ztoolsObj.hideMainWindow === 'function') {
        ztoolsObj.hideMainWindow();
      }
    }
  }
});

// ======================= 管理视图逻辑 =======================
function renderManagerList() {
  const tokens = parseSearchTokens(mgrSearchInput.value);
  const allEntries = window.pwdApi.listEntries();
  const filtered = allEntries.filter((item) => matchEntry(item, tokens));

  if (mgrCount) {
    mgrCount.textContent = tokens.length > 0 ? `${filtered.length} / ${allEntries.length} 条` : `${allEntries.length} 条`;
  }

  mgrTableBody.innerHTML = '';
  if (filtered.length === 0) {
    mgrTableBody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 36px;">
          ${allEntries.length === 0 ? '暂无密码条目，点击右上角「+ 添加新密码」开始使用' : '未匹配到符合条件的密码条目'}
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((item) => {
    const tr = document.createElement('tr');
    const pinIconHtml = item.pinned ? ICONS.starFilled : ICONS.starOutline;
    const hasUser = !!(item.username && item.username.trim());

    tr.innerHTML = `
      <td>
        <div class="mgr-label-cell">
          ${item.pinned ? `<span class="quick-pin-icon" title="已置顶">${ICONS.starFilled}</span>` : ''}
          <span>${escapeHtml(item.label)}</span>
        </div>
        ${item.note ? `<div class="mgr-label-note" title="${escapeHtml(item.note)}">${escapeHtml(item.note)}</div>` : ''}
      </td>
      <td>
        ${hasUser
          ? `<span class="mgr-user-copy" title="点击复制账号"><span class="mgr-user-copy-text">${escapeHtml(item.username)}</span></span>`
          : '<span style="color: var(--text-muted);">-</span>'}
      </td>
      <td style="color: var(--text-secondary); font-size: 12px;">${formatDate(item.updatedAt)}</td>
      <td style="text-align: right;">
        <div class="mgr-item-actions">
          <button type="button" class="icon-btn btn-pin-action${item.pinned ? ' pinned' : ''}" title="${item.pinned ? '取消置顶' : '置顶条目'}">${pinIconHtml}</button>
          <button type="button" class="icon-btn btn-copy-pwd-action" title="复制密码">${ICONS.copy}</button>
          <button type="button" class="icon-btn btn-view-action" title="查看明文与详情">${ICONS.eyeOpen}</button>
          <button type="button" class="icon-btn btn-edit-action" title="编辑">${ICONS.edit}</button>
          <button type="button" class="icon-btn danger btn-del-action" title="删除">${ICONS.trash}</button>
        </div>
      </td>
    `;

    const userCopyEl = tr.querySelector('.mgr-user-copy');
    if (userCopyEl) {
      userCopyEl.addEventListener('click', async () => {
        await copyTextSafe(item.username, false);
        showToast('已复制账号');
      });
    }

    tr.querySelector('.btn-pin-action').addEventListener('click', () => {
      try {
        const pinned = window.pwdApi.togglePin(item.id);
        renderManagerList();
        showToast(pinned ? '已置顶，快捷选密将优先展示' : '已取消置顶');
      } catch (err) {
        showToast('操作失败: ' + err.message);
      }
    });

    tr.querySelector('.btn-copy-pwd-action').addEventListener('click', async () => {
      try {
        const plain = window.pwdApi.getPlainPwd(item.id);
        await copyTextSafe(plain, true);
        window.pwdApi.recordUsage(item.id);
        const clearSec = window.pwdApi.getConfig().autoClearClipboardSeconds || 10;
        showToast(`密码已复制，${clearSec}s 后自动清空`);
      } catch (err) {
        showToast('复制失败: ' + err.message);
      }
    });

    tr.querySelector('.btn-view-action').addEventListener('click', () => openViewModal(item.id));
    tr.querySelector('.btn-edit-action').addEventListener('click', () => openEditModal(item.id));
    tr.querySelector('.btn-del-action').addEventListener('click', () => handleDeleteEntry(item.id, item.label));

    mgrTableBody.appendChild(tr);
  });
}

mgrSearchInput.addEventListener('input', renderManagerList);

// 打开新增密码弹窗
function openAddModal(prefillLabel = '') {
  entryId.value = '';
  modalEntryTitle.textContent = '添加新密码';
  entryLabel.value = prefillLabel;
  entryUsername.value = '';
  entryPassword.value = '';
  entryPassword.type = 'password';
  entryPassword.placeholder = '请输入密码';
  entryNote.value = '';
  entryPwdRequired.style.display = 'inline';
  btnToggleEntryPwd.innerHTML = ICONS.eyeOpen;
  updateEntryPasswordStrength();
  modalEntry.classList.add('active');
  setTimeout(() => {
    if (prefillLabel) {
      entryUsername.focus();
    } else {
      entryLabel.focus();
    }
  }, 30);
}

btnAddEntry.addEventListener('click', () => openAddModal(''));

// 编辑条目
function openEditModal(id) {
  const item = window.pwdApi.getEntry(id);
  if (!item) return;

  entryId.value = item.id;
  modalEntryTitle.textContent = '编辑密码条目';
  entryLabel.value = item.label;
  entryUsername.value = item.username || '';
  entryPassword.value = '';
  entryPassword.type = 'password';
  entryPassword.placeholder = '留空表示不修改原密码';
  entryNote.value = item.note || '';
  entryPwdRequired.style.display = 'none';
  btnToggleEntryPwd.innerHTML = ICONS.eyeOpen;
  updateEntryPasswordStrength();
  modalEntry.classList.add('active');
  setTimeout(() => entryLabel.focus(), 30);
}

if (btnGenEntryPwd) {
  btnGenEntryPwd.addEventListener('click', () => {
    entryPassword.value = generateStrongPassword(16);
    entryPassword.type = 'text';
    btnToggleEntryPwd.innerHTML = ICONS.eyeOff;
    updateEntryPasswordStrength();
    entryPassword.focus();
    showToast('已生成 16 位随机强密码');
  });
}

entryPassword.addEventListener('input', updateEntryPasswordStrength);

function saveEntryForm() {
  const id = entryId.value;
  const label = entryLabel.value.trim();
  const username = entryUsername.value.trim();
  const password = entryPassword.value;
  const note = entryNote.value.trim();

  if (!label) {
    showToast('请输入平台/网站名称');
    entryLabel.focus();
    return;
  }

  try {
    if (!id) {
      if (!password) {
        showToast('请输入密码');
        entryPassword.focus();
        return;
      }
      window.pwdApi.addEntry(label, username, password, { note });
      showToast('条目已添加');
    } else {
      window.pwdApi.updateEntry(id, label, username, password, { note });
      showToast('条目已更新');
    }
    modalEntry.classList.remove('active');
    renderManagerList();
  } catch (err) {
    showToast('保存失败: ' + err.message);
  }
}

btnSaveEntry.addEventListener('click', saveEntryForm);

// 弹窗内键盘流畅流转与快捷保存
entryLabel.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    entryUsername.focus();
  }
});
entryUsername.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    entryPassword.focus();
  }
});
entryPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveEntryForm();
  }
});
entryNote.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveEntryForm();
  }
});

btnCancelEntry.addEventListener('click', () => modalEntry.classList.remove('active'));
btnCloseEntryModal.addEventListener('click', () => modalEntry.classList.remove('active'));

// 查看明文与详情
function openViewModal(id) {
  const item = window.pwdApi.getEntry(id);
  if (!item) return;

  try {
    const plain = window.pwdApi.getPlainPwd(id);
    viewLabel.value = item.label;
    viewUsername.value = item.username || '-';
    viewPlainPwd.value = plain;
    if (item.note) {
      viewNote.value = item.note;
      viewNoteGroup.style.display = 'flex';
    } else {
      viewNote.value = '';
      viewNoteGroup.style.display = 'none';
    }
    modalViewPwd.classList.add('active');
  } catch (err) {
    showToast('获取密码失败: ' + err.message);
  }
}

if (btnCopyViewUser) {
  btnCopyViewUser.addEventListener('click', async () => {
    const user = viewUsername.value;
    if (!user || user === '-') {
      showToast('该条目未设置账号');
      return;
    }
    await copyTextSafe(user, false);
    showToast('账号已复制到剪贴板');
  });
}

btnCopyViewPwd.addEventListener('click', async () => {
  const pwd = viewPlainPwd.value;
  await copyTextSafe(pwd, true);
  const clearSec = window.pwdApi.getConfig().autoClearClipboardSeconds || 10;
  showToast(`密码已复制，${clearSec}s 后自动清空`);
});

btnCloseViewModal.addEventListener('click', () => modalViewPwd.classList.remove('active'));
btnCloseViewBtn.addEventListener('click', () => modalViewPwd.classList.remove('active'));

// 删除条目（使用自定义确认框）
async function handleDeleteEntry(id, label) {
  const confirmed = await showConfirmDialog({
    title: '删除密码条目',
    message: `确定要删除 [${label}] 的密码记录吗？此操作无法撤回。`,
    confirmText: '确认删除',
    danger: true
  });
  if (!confirmed) return;

  try {
    window.pwdApi.deleteEntry(id);
    showToast('已删除');
    renderManagerList();
  } catch (err) {
    showToast('删除失败: ' + err.message);
  }
}

// 锁定保险库
btnLockVault.addEventListener('click', () => {
  window.pwdApi.lock();
  showToast('保险库已锁定');
  switchView('unlock');
});

// ======================= 设置、主密码开关与导入导出 =======================
btnOpenSettings.addEventListener('click', () => {
  const config = window.pwdApi.getConfig();
  settingClearClipboard.value = config.autoClearClipboardSeconds || 10;
  if (settingFillMode) settingFillMode.value = config.fillMode || 'paste';
  if (settingFillDelay) settingFillDelay.value = String(config.fillDelayMs || 450);
  if (settingTabDelay) settingTabDelay.value = String(config.tabDelayMs || 180);
  if (settingFillStrategy) settingFillStrategy.value = config.fillStrategy || 'both';
  if (settingAutoLock) settingAutoLock.value = String(config.autoLockMinutes || 0);
  if (settingOpenStandalone) settingOpenStandalone.checked = config.openStandaloneByDefault === true;
  syncMasterPinUiState();
  modalSettings.classList.add('active');
});

// 实时切换主密码解锁保护开关
if (settingRequirePin) {
  settingRequirePin.addEventListener('change', async () => {
    const wantEnable = settingRequirePin.checked;
    if (!wantEnable) {
      const confirmed = await showConfirmDialog({
        title: '关闭主密码解锁保护',
        message: '关闭后，每次打开插件或重启 ZTools 将不再要求输入主密码 PIN。\n\n本地密码库仍保持加密存储，但能访问本机此账号的用户将可直接查看与填充密码。\n您随时可以在设置中重新开启。',
        confirmText: '确认关闭',
        danger: true
      });
      if (!confirmed) {
        settingRequirePin.checked = true;
        return;
      }
      try {
        window.pwdApi.disableMasterPin();
        syncMasterPinUiState();
        showToast('已关闭主密码解锁保护');
      } catch (err) {
        settingRequirePin.checked = true;
        showToast('关闭失败: ' + err.message);
      }
    } else {
      openPinModal('enable');
    }
  });
}

btnSaveSettings.addEventListener('click', () => {
  const rawClearSec = parseInt(settingClearClipboard.value, 10) || 10;
  const autoClearClipboardSeconds = Math.min(60, Math.max(3, rawClearSec));

  window.pwdApi.setConfig({
    middleClickTrigger: false,
    autoClearClipboardSeconds,
    fillMode: settingFillMode ? settingFillMode.value : 'paste',
    fillDelayMs: settingFillDelay ? (parseInt(settingFillDelay.value, 10) || 450) : 450,
    tabDelayMs: settingTabDelay ? (parseInt(settingTabDelay.value, 10) || 180) : 180,
    fillStrategy: settingFillStrategy ? settingFillStrategy.value : 'both',
    autoLockMinutes: settingAutoLock ? (parseInt(settingAutoLock.value, 10) || 0) : 0,
    openStandaloneByDefault: settingOpenStandalone ? settingOpenStandalone.checked : false
  });

  showToast('设置已保存');
  modalSettings.classList.remove('active');
});

btnCloseSettingsModal.addEventListener('click', () => modalSettings.classList.remove('active'));

// 打开修改/开启主密码弹窗
function openPinModal(mode = 'change') {
  pinModalMode = mode;
  changeOldPin.value = '';
  changeNewPin.value = '';
  changeConfirmPin.value = '';

  if (mode === 'enable') {
    if (changePinTitle) changePinTitle.textContent = '开启主密码解锁保护';
    if (changeOldPinGroup) changeOldPinGroup.style.display = 'none';
    if (btnSubmitChangePin) btnSubmitChangePin.textContent = '开启并加密';
    modalChangePin.classList.add('active');
    setTimeout(() => changeNewPin.focus(), 30);
  } else {
    if (changePinTitle) changePinTitle.textContent = '修改主密码 PIN';
    if (changeOldPinGroup) changeOldPinGroup.style.display = 'flex';
    if (btnSubmitChangePin) btnSubmitChangePin.textContent = '确认修改';
    modalChangePin.classList.add('active');
    setTimeout(() => changeOldPin.focus(), 30);
  }
}

function closePinModal(cancelled = true) {
  modalChangePin.classList.remove('active');
  if (cancelled && pinModalMode === 'enable') {
    syncMasterPinUiState();
  }
}

if (btnOpenChangePin) {
  btnOpenChangePin.addEventListener('click', () => {
    if (!window.pwdApi.isMasterPinRequired()) {
      showToast('当前未开启主密码保护');
      return;
    }
    openPinModal('change');
  });
}

function submitChangePinForm() {
  const oldPin = changeOldPin.value;
  const newPin = changeNewPin.value;
  const confirmPin = changeConfirmPin.value;

  if (pinModalMode === 'change' && !oldPin) {
    showToast('请输入当前主密码');
    changeOldPin.focus();
    return;
  }
  if (!newPin || newPin.length < 4) {
    showToast('新主密码长度不能少于 4 位');
    changeNewPin.focus();
    return;
  }
  if (newPin !== confirmPin) {
    showToast('两次输入的新密码不一致');
    changeConfirmPin.focus();
    return;
  }

  try {
    if (pinModalMode === 'enable') {
      window.pwdApi.enableMasterPin(newPin);
      closePinModal(false);
      syncMasterPinUiState();
      showToast('已开启主密码解锁保护并完成全库加密');
    } else {
      window.pwdApi.changeMasterPin(oldPin, newPin);
      closePinModal(false);
      showToast('主密码已修改并完成全库重加密');
    }
  } catch (err) {
    showToast((pinModalMode === 'enable' ? '开启失败: ' : '修改失败: ') + err.message);
  }
}

if (btnSubmitChangePin) btnSubmitChangePin.addEventListener('click', submitChangePinForm);
if (changeConfirmPin) {
  changeConfirmPin.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitChangePinForm();
  });
}
if (btnCancelChangePin) btnCancelChangePin.addEventListener('click', () => closePinModal(true));
if (btnCloseChangePinModal) btnCloseChangePinModal.addEventListener('click', () => closePinModal(true));

// 导出加密备份
if (btnExportVault) {
  btnExportVault.addEventListener('click', () => {
    try {
      const jsonStr = window.pwdApi.exportVaultJson();
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      a.href = url;
      a.download = `quick-pwd-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const isPinOn = window.pwdApi.isMasterPinRequired();
      showToast(isPinOn ? '已导出加密备份文件' : '已导出备份文件（当前为免密模式，请妥善保管）');
    } catch (err) {
      showToast('导出失败: ' + err.message);
    }
  });
}

// 导入加密备份
if (btnImportVault && inputImportVault) {
  btnImportVault.addEventListener('click', () => {
    inputImportVault.value = '';
    inputImportVault.click();
  });

  inputImportVault.addEventListener('change', async () => {
    const file = inputImportVault.files && inputImportVault.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const confirmed = await showConfirmDialog({
        title: '导入加密备份',
        message: `确定要导入备份文件 "${file.name}" 吗？\n导入将覆盖当前密码库中的所有条目与主密码校验信息，建议导入前先导出当前备份。`,
        confirmText: '确认覆盖导入',
        danger: true
      });
      if (!confirmed) return;

      const result = window.pwdApi.importVaultJson(text);
      syncMasterPinUiState();
      modalSettings.classList.remove('active');
      if (result.unlocked) {
        renderManagerList();
        showToast(`导入成功，共恢复 ${result.count} 条记录`);
      } else {
        showToast(`导入成功 (${result.count} 条)，请用备份文件的主密码解锁`);
        switchView('unlock');
      }
    } catch (err) {
      showToast('导入失败: ' + err.message);
    }
  });
}

// 使用手册对话框
if (btnOpenGuide) {
  btnOpenGuide.addEventListener('click', () => {
    if (modalGuide) modalGuide.classList.add('active');
  });
}
if (btnCloseGuideModal) {
  btnCloseGuideModal.addEventListener('click', () => {
    if (modalGuide) modalGuide.classList.remove('active');
  });
}
if (btnCloseGuideBtn) {
  btnCloseGuideBtn.addEventListener('click', () => {
    if (modalGuide) modalGuide.classList.remove('active');
  });
}

// 点击遮罩空白区域关闭弹窗
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      if (overlay === modalConfirm) {
        closeConfirmDialog(false);
      } else if (overlay === modalChangePin) {
        closePinModal(true);
      } else {
        overlay.classList.remove('active');
      }
    }
  });
});

// 全局 ESC / 弹窗快捷键监听
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modalConfirm.classList.contains('active')) {
      e.preventDefault();
      e.stopPropagation();
      closeConfirmDialog(false);
      return;
    }
    const activeModals = Array.from(document.querySelectorAll('.modal-overlay.active'));
    if (activeModals.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      const topModal = activeModals[activeModals.length - 1];
      if (topModal === modalChangePin) {
        closePinModal(true);
      } else {
        topModal.classList.remove('active');
      }
    }
  } else if (e.key === 'Enter' && modalConfirm.classList.contains('active')) {
    e.preventDefault();
    e.stopPropagation();
    closeConfirmDialog(true);
  } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && modalEntry.classList.contains('active')) {
    e.preventDefault();
    saveEntryForm();
  }
});

// 快捷选密界面点击打开独立管理器按钮
if (btnQuickOpenMgr) {
  btnQuickOpenMgr.addEventListener('click', (e) => {
    e.stopPropagation();
    if (window.pwdApi && typeof window.pwdApi.openManagerWindow === 'function') {
      window.pwdApi.openManagerWindow();
      const ztoolsObj = window.ztools || window.utools;
      if (ztoolsObj && typeof ztoolsObj.outPlugin === 'function') {
        try { ztoolsObj.outPlugin(); } catch (err) {}
      } else if (ztoolsObj && typeof ztoolsObj.hideMainWindow === 'function') {
        try { ztoolsObj.hideMainWindow(false); } catch (err) {}
      }
    }
  });
}

// 主管理界面标题栏“独立窗口打开”按钮
if (btnDetachWindow) {
  btnDetachWindow.addEventListener('click', () => {
    if (window.pwdApi && typeof window.pwdApi.openManagerWindow === 'function') {
      window.pwdApi.openManagerWindow();
      const ztoolsObj = window.ztools || window.utools;
      if (ztoolsObj && typeof ztoolsObj.outPlugin === 'function') {
        try { ztoolsObj.outPlugin(); } catch (err) {}
      } else if (ztoolsObj && typeof ztoolsObj.hideMainWindow === 'function') {
        try { ztoolsObj.hideMainWindow(false); } catch (err) {}
      }
    }
  });
}

// 跨窗口 IPC 消息监听与同步
if (window.pwdApi && typeof window.pwdApi.onWindowMessage === 'function') {
  // 1. 独立窗口接收主窗口指令（携带 payload 快速定位搜索）
  window.pwdApi.onWindowMessage('plugin-action', (action) => {
    if (action && action.payload && typeof action.payload === 'string') {
      const q = action.payload.trim();
      if (q) {
        if (mgrSearchInput) {
          mgrSearchInput.value = q;
        }
        if (viewManager.classList.contains('active')) {
          renderManagerList();
        }
      }
    }
  });

  // 2. 凭据同步（一处解锁，跨窗口同时解锁）
  window.pwdApi.onWindowMessage('sync-auth', () => {
    if (viewUnlock.classList.contains('active')) {
      proceedAfterUnlock();
    }
  });

  // 3. 锁定同步（一处锁定，跨窗口同时锁定）
  window.pwdApi.onWindowMessage('sync-lock', () => {
    switchView('unlock');
  });

  // 4. 数据更新同步（添加/修改/删除/统计更新时自动刷新缓存与列表）
  window.pwdApi.onWindowMessage('data-updated', () => {
    quickAllEntries = window.pwdApi.listEntries();
    if (viewManager.classList.contains('active')) {
      renderManagerList();
    } else if (viewQuick.classList.contains('active')) {
      renderQuickList(false);
    }
  });

  // 5. 配置更新同步（主密码保护状态跨窗口同步）
  window.pwdApi.onWindowMessage('config-updated', () => {
    syncMasterPinUiState();
  });
}

// 提取可作为过滤词的入口 payload（排除插件自身触发指令词）
function extractQuickInitialQuery(action) {
  if (!action || typeof action.payload !== 'string') return '';
  const trimmed = action.payload.trim();
  if (!trimmed || QUICK_TRIGGER_CMDS.has(trimmed.toLowerCase())) {
    return '';
  }
  return trimmed;
}

// ======================= ZTools 入口与生命周期 =======================
if (typeof ztools !== 'undefined' && typeof ztools.onPluginEnter === 'function') {
  ztools.onPluginEnter((action) => {
    // 1. 设置深色模式跟随系统
    if (typeof ztools.isDarkColors === 'function' && ztools.isDarkColors()) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    const winMode = getWindowMode();
    const targetCode = action.code || 'pwd-manager';
    const initialQuickQuery = targetCode === 'pwd-quick-fill' ? extractQuickInitialQuery(action) : '';

    // 2. 如果当前处于独立窗口中（包括 createBrowserWindow 与 Ctrl+D 分离窗口）
    if (winMode === 'detach' || winMode === 'browser') {
      if (window.pwdApi && typeof window.pwdApi.bringToFront === 'function') {
        window.pwdApi.bringToFront();
      } else {
        window.focus();
      }

      currentTargetCode = targetCode;
      if (targetCode !== 'pwd-quick-fill' && action.payload && typeof action.payload === 'string') {
        const q = action.payload.trim();
        if (q && mgrSearchInput) {
          mgrSearchInput.value = q;
        }
      }

      if (!window.pwdApi.isUnlocked()) {
        switchView('unlock');
      } else {
        proceedAfterUnlock(initialQuickQuery);
      }
      return;
    }

    // 3. 只有当用户主动在设置中开启了“默认以独立桌面窗口打开”，才自动弹开独立窗口
    const config = window.pwdApi.getConfig();
    if (winMode === 'main' && targetCode === 'pwd-manager' && config.openStandaloneByDefault === true) {
      if (window.pwdApi && typeof window.pwdApi.openManagerWindow === 'function') {
        const ok = window.pwdApi.openManagerWindow(action);
        if (ok) {
          if (typeof ztools.outPlugin === 'function') {
            try { ztools.outPlugin(); } catch (e) {}
          } else if (typeof ztools.hideMainWindow === 'function') {
            try { ztools.hideMainWindow(false); } catch (e) {}
          }
          return;
        }
      }
    }

    // 4. 常规正常主窗口流程
    currentTargetCode = targetCode;
    if (!window.pwdApi.isUnlocked()) {
      switchView('unlock');
    } else {
      proceedAfterUnlock(initialQuickQuery);
    }
  });

  // 监听插件分离为独立窗口事件
  if (typeof ztools.onPluginDetach === 'function') {
    ztools.onPluginDetach(() => {
      startStandaloneHeartbeat();
      if (window.pwdApi && typeof window.pwdApi.bringToFront === 'function') {
        window.pwdApi.bringToFront();
      }
    });
  }
}

// 独立窗口 (BrowserWindow) 或纯浏览器调试环境的自启动生命周期
window.addEventListener('DOMContentLoaded', () => {
  const winMode = getWindowMode();
  if (winMode === 'browser' || winMode === 'detach') {
    const ztoolsObj = window.ztools || window.utools;
    if (ztoolsObj && typeof ztoolsObj.isDarkColors === 'function' && ztoolsObj.isDarkColors()) {
      document.documentElement.classList.add('dark');
    }
    if (window.pwdApi && !window.pwdApi.isUnlocked()) {
      switchView('unlock');
    } else {
      switchView('manager');
    }
  } else if (typeof ztools === 'undefined') {
    if (window.pwdApi && !window.pwdApi.isUnlocked()) {
      switchView('unlock');
    } else {
      switchView('manager');
    }
  }
});
