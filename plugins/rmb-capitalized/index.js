/* 人民币大写 - 前端逻辑 */

(function () {
  'use strict';

  var $input = document.getElementById('number-input');
  var $results = document.getElementById('results');
  var $hint = document.getElementById('hint');

  // ---- 主题：localStorage 记住用户上次选择，'system' 跟随 OS ----
  var THEME_KEY = 'rmb-capitalized:theme';
  var THEME_LIGHT = 'light';
  var THEME_DARK = 'dark';

  function loadSavedTheme() {
    try {
      var saved = localStorage.getItem(THEME_KEY);
      if (saved === THEME_LIGHT || saved === THEME_DARK) return saved;
    } catch (e) { /* 忽略 */ }
    return null; // 未手动设置过 -> 跟随系统
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === THEME_LIGHT) {
      root.setAttribute('data-theme', 'light');
    } else if (theme === THEME_DARK) {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
  }

  function saveTheme(theme) {
    try {
      if (theme === THEME_LIGHT || theme === THEME_DARK) {
        localStorage.setItem(THEME_KEY, theme);
      } else {
        localStorage.removeItem(THEME_KEY);
      }
    } catch (e) { /* 忽略 */ }
  }

  function currentEffectiveTheme() {
    var attr = document.documentElement.getAttribute('data-theme');
    if (attr === THEME_LIGHT || attr === THEME_DARK) return attr;
    // 跟随系统
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? THEME_LIGHT
      : THEME_DARK;
  }

  // 启动时立即应用已记住的主题（避免闪烁）
  applyTheme(loadSavedTheme());

  var $themeToggle = document.getElementById('theme-toggle');
  if ($themeToggle) {
    $themeToggle.addEventListener('click', function () {
      var next = currentEffectiveTheme() === THEME_LIGHT ? THEME_DARK : THEME_LIGHT;
      applyTheme(next);
      saveTheme(next);
    });
  }

  // ---- 工具：转义 HTML ----
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var state = {
    lastCapital: '',
    lastThousand: '',
    altText: '',
    altLabel: '',
    hasValidInput: false,
  };

  // ---- 复制到剪贴板 ----
  function copyText(text) {
    var ok = false;
    try {
      if (window.ztools && typeof window.ztools.copyText === 'function') {
        ok = !!window.ztools.copyText(text);
      }
    } catch (e) { /* ignore */ }
    if (!ok) {
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text);
          ok = true;
        }
      } catch (e) { /* ignore */ }
    }
    return ok;
  }

  // ---- 行内"复制成功"气泡：从下往上滑入，2 秒后淡出移除 ----
  // 仅在主界面点击/快捷键复制时使用（不弹系统通知、不关窗口）
  var TOAST_TTL = 2000;       // 停留时长
  var TOAST_FADE = 250;       // 淡出时长（需与 CSS transition 一致）
  function showCopyToast(row) {
    if (!row) return;
    // 同一行只保留一个气泡（连续点击时移除旧的）
    var existing = row.querySelector('.copy-toast');
    if (existing) {
      existing.parentNode && existing.parentNode.removeChild(existing);
    }

    var toast = document.createElement('span');
    toast.className = 'copy-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = '✅️复制成功';
    row.appendChild(toast);

    // 下一帧加 .show 触发 CSS 过渡（从下往上滑入 + 淡入）
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    // TTL 到期淡出，再移除节点
    setTimeout(function () {
      toast.classList.add('fade-out');
      setTimeout(function () {
        toast.parentNode && toast.parentNode.removeChild(toast);
      }, TOAST_FADE);
    }, TOAST_TTL);
  }

  // ---- 动态高度：结果行数变化时同步给宿主窗口 ----
  function syncHeight() {
    try {
      if (window.ztools && typeof window.ztools.setExpendHeight === 'function') {
        window.ztools.setExpendHeight(Math.ceil(document.documentElement.scrollHeight));
      }
    } catch (e) { /* 忽略 */ }
  }

  // ---- 渲染 ----
  function render() {
    var raw = ($input.value || '').trim();
    if (!raw) {
      $results.innerHTML = '';
      state.lastCapital = '';
      state.lastThousand = '';
      state.altText = '';
      state.altLabel = '';
      state.hasValidInput = false;
      syncHeight();
      return;
    }

    if (!window.RMBConverter || typeof window.RMBConverter.isValidNumber !== 'function') {
      $results.innerHTML = '<div class="error danger">converter.js 未加载</div>';
      syncHeight();
      return;
    }

    if (!window.RMBConverter.isValidNumber(raw)) {
      $results.innerHTML = '<div class="error">格式不正确，请输入最多 2 位小数的阿拉伯数字（含千分位逗号）</div>';
      state.lastCapital = '';
      state.lastThousand = '';
      state.altText = '';
      state.altLabel = '';
      state.hasValidInput = false;
      syncHeight();
      return;
    }

    var out = window.RMBConverter.numberToCapital(raw);
    state.lastCapital = out.result || '';
    state.lastThousand = out.thousandSeparated || '';
    state.hasValidInput = !!state.lastCapital;

    // 第二行：根据输入格式反向输出另一种格式
    //  - 输入是数字格式（无逗号）→ 输出千分位格式（仅 >= 1000 时）
    //  - 输入是千分位格式（有逗号）→ 输出数字格式（去逗号）
    var cleaned = raw.replace(/,/g, '');
    var hasComma = raw.indexOf(',') !== -1;
    state.altText = '';
    state.altLabel = '';
    if (hasComma) {
      state.altText = cleaned;
      state.altLabel = '数字格式';
    } else if (out.thousandSeparated) {
      state.altText = out.thousandSeparated;
      state.altLabel = '千分位格式';
    }

    var html = '';

    // Row 1 - 大写人民币
    html += ''
      + '<div class="row" data-action="capital" tabindex="0" role="button" aria-label="复制大写人民币">'
      +   '<div class="row-icon" aria-hidden="true">壹</div>'
      +   '<div class="row-main">'
      +     '<div class="row-title">' + escapeHtml(state.lastCapital) + '</div>'
      +     '<div class="row-sub">复制 · 大写人民币</div>'
      +   '</div>'
      +   '<div class="row-shortcut">Alt+1</div>'
      + '</div>';

    // Row 2 - 另一种格式（千分位 / 数字）
    if (state.altText) {
      var altIcon = state.altLabel === '千分位格式' ? ',' : '0';
      var altIconCls = state.altLabel === '千分位格式' ? 'thousand' : 'plain';
      html += ''
        + '<div class="row" data-action="alt" tabindex="0" role="button" aria-label="复制' + state.altLabel + '">'
        +   '<div class="row-icon ' + altIconCls + '" aria-hidden="true">' + altIcon + '</div>'
        +   '<div class="row-main">'
        +     '<div class="row-title">' + escapeHtml(state.altText) + '</div>'
        +     '<div class="row-sub">复制 · ' + state.altLabel + '</div>'
        +   '</div>'
        +   '<div class="row-shortcut">Alt+2</div>'
        + '</div>';
    }

    $results.innerHTML = html;
    bindRowEvents();
    syncHeight();
  }

  // ---- 行点击 / 键盘激活 ----
  function bindRowEvents() {
    var rows = $results.querySelectorAll('.row');
    for (var i = 0; i < rows.length; i++) {
      (function (row) {
        function activate() {
          handleAction(row.dataset.action, row);
        }
        row.addEventListener('click', activate);
        row.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activate();
          }
        });
      })(rows[i]);
    }
  }

  function handleAction(action, row) {
    if (action === 'capital') {
      if (state.lastCapital) {
        copyText(state.lastCapital);
        showCopyToast(row);
      }
    } else if (action === 'alt') {
      if (state.altText) {
        copyText(state.altText);
        showCopyToast(row);
      }
    }
  }

  // ---- Alt+N 快捷键 ----
  document.addEventListener('keydown', function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === '1') {
      e.preventDefault();
      handleAction('capital', $results.querySelector('[data-action="capital"]'));
    } else if (e.key === '2') {
      e.preventDefault();
      handleAction('alt', $results.querySelector('[data-action="alt"]'));
    }
  });

  // ---- 清空按钮 ----
  var $clearBtn = document.getElementById('clear-btn');
  if ($clearBtn) {
    $clearBtn.addEventListener('click', function () {
      $input.value = '';
      render();
      try { $input.focus({ preventScroll: true }); } catch (e) { $input.focus(); }
    });
  }

  // ---- 输入事件 ----
  $input.addEventListener('input', render);
  $input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAction('capital', $results.querySelector('[data-action="capital"]'));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      $input.value = '';
      render();
    }
  });

  // 启动时聚焦
  setTimeout(function () {
    try { $input.focus({ preventScroll: true }); } catch (e) { $input.focus(); }
  }, 0);

  render();
})();
