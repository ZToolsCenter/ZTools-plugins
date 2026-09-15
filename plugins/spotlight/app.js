/**
 * 聚光灯插件 - 主页面逻辑（设置页 + 聚光灯激活控制）
 *
 * 两个功能入口（plugin.json features）：
 *  - spotlight          → 直接开启聚光灯（隐藏主窗口，创建全屏遮罩窗口）
 *  - spotlight-settings → 打开本设置页
 */

(function () {
  'use strict';

  var SETTINGS_KEY = 'spotlight-settings';

  var DEFAULTS = {
    radius: 180,       // 光圈半径 px
    opacity: 75,       // 背景暗度 %
    softness: 60,      // 边缘柔化 px
    clickExit: true,   // 点击退出
    allScreens: true   // 多屏覆盖（每块屏幕一个遮罩窗口）
  };

  var spotWins = [];         // 当前聚光灯遮罩窗口（多屏时每块屏幕一个）
  var monitorTimer = null;   // 遮罩窗口存活监视器
  var lastActivateAt = 0;    // 上次激活时间（用于去重，onPluginEnter/onPluginReady 可能重复触发）

  /* ---------------- 设置存取 ---------------- */

  function loadSettings() {
    var saved = null;
    try {
      saved = window.ztools && window.ztools.dbStorage.getItem(SETTINGS_KEY);
    } catch (e) { /* ignore */ }
    var s = {};
    for (var k in DEFAULTS) s[k] = DEFAULTS[k];
    if (saved && typeof saved === 'object') {
      for (var k2 in DEFAULTS) {
        if (saved[k2] !== undefined) s[k2] = saved[k2];
      }
    }
    return s;
  }

  function saveSettings(s) {
    try {
      window.ztools && window.ztools.dbStorage.setItem(SETTINGS_KEY, s);
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 开启聚光灯 ---------------- */

  function activateSpotlight() {
    if (!window.ztools) return;

    // 去重：onPluginEnter / onPluginReady 可能先后触发同一进入事件
    var now = Date.now();
    if (now - lastActivateAt < 800) return;
    lastActivateAt = now;

    var s = loadSettings();

    // 已开启则先关闭旧的（重复按快捷键 = 重新开启/刷新）
    if (spotWins.length) {
      destroyAllOverlays();
    }

    // 取鼠标当前位置，找到所在显示器
    var point = null;
    try { point = window.ztools.getCursorScreenPoint(); } catch (e) {}
    var display = null;
    try {
      display = point
        ? window.ztools.getDisplayNearestPoint(point)
        : window.ztools.getPrimaryDisplay();
    } catch (e) {}
    var primaryBounds = (display && display.bounds) || { x: 0, y: 0, width: screen.width, height: screen.height };

    // 确定要覆盖的显示器列表：
    //  - 多屏覆盖开启 → 所有显示器（每块屏幕一个独立遮罩窗口，各自精确覆盖自身 bounds，
    //    避免混合 DPI / 不同分辨率下单个大窗口被系统裁剪的问题）
    //  - 关闭 → 仅鼠标所在显示器
    var boundsList = [];
    if (s.allScreens) {
      try {
        var displays = window.ztools.getAllDisplays();
        if (displays && displays.length) {
          displays.forEach(function (d) { if (d && d.bounds) boundsList.push(d.bounds); });
        }
      } catch (e) { /* 获取失败时退回单屏 */ }
    }
    if (!boundsList.length) boundsList.push(primaryBounds);

    // 本次会话 ID：多窗口之间通过 localStorage 令牌联动退出
    var sid = 's' + Date.now();

    function createOverlays() {
      var cursorWin = null;
      var failCount = 0;

      boundsList.forEach(function (b) {
        // 通过 URL query 把初始参数交给遮罩窗口（窗口坐标原点 + 设置项 + 会话 ID）
        var isCursorScreen = point &&
          point.x >= b.x && point.x < b.x + b.width &&
          point.y >= b.y && point.y < b.y + b.height;
        var q = 'ox=' + b.x + '&oy=' + b.y +
          '&r=' + s.radius + '&o=' + s.opacity + '&soft=' + s.softness +
          '&ce=' + (s.clickExit ? 1 : 0) +
          '&sid=' + sid +
          (isCursorScreen ? '&tip=1' : '') +
          (point ? '&cx=' + point.x + '&cy=' + point.y : '');

        var win = null;
        try {
          win = window.ztools.createBrowserWindow('overlay.html?' + q, {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            alwaysOnTop: true,
            skipTaskbar: true,
            show: false,
            backgroundColor: '#00000000',
            webPreferences: {
              preload: 'preload.js',
              backgroundThrottling: false
            }
          });
        } catch (e) { win = null; }

        // createBrowserWindow 失败时可能返回 null 或 Error 对象
        if (!win || typeof win.show !== 'function') {
          failCount++;
          return;
        }
        spotWins.push(win);

        // 注意：不使用创建回调来显示窗口。
        // ZTools 主进程通过 window.ztools.__event__.createBrowserWindowCallback 单一全局槽位
        // 触发回调，连续创建多个窗口时回调会相互覆盖，只有最后一个生效。
        // 窗口背景是透明的，立即显示不会有视觉闪烁。
        try {
          if (typeof win.showInactive === 'function') win.showInactive();
          else win.show();
        } catch (e) { try { win.show(); } catch (e2) {} }
        try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {}
        // macOS：让遮罩在所有桌面 Space 及全屏 App 之上可见（Windows 下为无操作）
        try {
          if (typeof win.setVisibleOnAllWorkspaces === 'function') {
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
          }
        } catch (e) {}

        if (isCursorScreen) cursorWin = win;
      });

      // 最后统一聚焦鼠标所在屏幕的窗口，确保 Esc 退出立即可用
      if (cursorWin) {
        try { cursorWin.focus(); } catch (e) {}
      }

      if (!spotWins.length) {
        try { window.ztools.showNotification('聚光灯窗口创建失败'); } catch (e) {}
        return;
      }
      if (failCount > 0) {
        try {
          window.ztools.showNotification('有 ' + failCount + ' 块屏幕的遮罩创建失败（共 ' + boundsList.length + ' 块）');
        } catch (e) {}
      }

      // 监视遮罩窗口：任何一个被外部关闭时，兜底销毁其余窗口；
      // 全部关闭后退出插件到后台——下次打开 ZTools 回到搜索页，而不是停留在本插件页面
      monitorTimer = setInterval(function () {
        if (!spotWins.length) { clearInterval(monitorTimer); return; }
        var alive = 0;
        var anyGone = false;
        spotWins.forEach(function (w) {
          try {
            if (w.isDestroyed()) anyGone = true;
            else alive++;
          } catch (e) { alive++; /* 代理不支持时视为存活 */ }
        });
        if (anyGone && alive > 0) destroyAllOverlays();
        if (alive === 0 || anyGone) {
          spotWins = [];
          clearInterval(monitorTimer);
          try { window.ztools.outPlugin(); } catch (e) {}
        }
      }, 500);
    }

    // 关键顺序：先隐藏主窗口，再创建遮罩窗口。
    // 避免遮罩加载期间 ZTools 主窗口停留在屏幕上造成"先弹出再关闭"的闪烁感。
    var hideResult = null;
    try { hideResult = window.ztools.hideMainWindow(); } catch (e) {}
    if (hideResult && typeof hideResult.then === 'function') {
      hideResult.then(createOverlays, createOverlays);
    } else {
      createOverlays();
    }
  }

  function destroyAllOverlays() {
    spotWins.forEach(function (w) {
      try { w.destroy(); } catch (e) { try { w.close(); } catch (e2) {} }
    });
    spotWins = [];
  }

  /* ---------------- 进入插件 ---------------- */

  function handleEnter(param) {
    var code = param && param.code;
    if (code === 'spotlight') {
      document.body.classList.add('activating');
      activateSpotlight();
    } else {
      // 设置页：务必移除 activating 隐藏类——
      // 插件页面在开启聚光灯后仍在后台存活，类名会残留导致设置页显示为空白
      document.body.classList.remove('activating');
      refreshDisplayInfo(); // 每次进入设置页刷新显示器诊断（函数声明会提升，此处可安全调用）
    }
  }

  if (window.ztools) {
    window.ztools.onPluginEnter(handleEnter);
    if (window.ztools.onPluginReady) window.ztools.onPluginReady(handleEnter);
  } else {
    // 非 ZTools 环境（如直接浏览器打开调试）也保证设置页可见
    document.body.classList.remove('activating');
  }

  // 聚光灯开启后插件页在后台存活，activating 隐藏类会残留；
  // 当 ZTools 主窗口重新显示、本页面重新获得焦点/可见时，恢复设置页显示
  function restorePage() {
    document.body.classList.remove('activating');
  }
  window.addEventListener('focus', restorePage);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) restorePage();
  });

  /* ---------------- 设置页 UI ---------------- */

  var settings = loadSettings();

  var $ = function (id) { return document.getElementById(id); };
  var toastTimer = null;
  function toast() {
    var el = $('toast');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 900);
  }
  function persist() {
    saveSettings(settings);
    toast();
  }

  function paintRange(input) {
    var p = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--p', p + '%');
  }

  // --- 滑杆 ---
  function bindSlider(id, valId, key, fmt) {
    var input = $(id), val = $(valId);
    input.value = settings[key];
    val.textContent = fmt(settings[key]);
    paintRange(input);
    input.addEventListener('input', function () {
      settings[key] = parseInt(input.value, 10);
      val.textContent = fmt(settings[key]);
      paintRange(input);
      persist();
    });
  }
  bindSlider('radius', 'radiusVal', 'radius', function (v) { return v + ' px'; });
  bindSlider('opacity', 'opacityVal', 'opacity', function (v) { return v + '%'; });
  bindSlider('softness', 'softnessVal', 'softness', function (v) { return v + ' px'; });

  // --- 开关 ---
  function bindSwitch(id, key) {
    var el = $(id);
    el.checked = !!settings[key];
    el.addEventListener('change', function () {
      settings[key] = el.checked;
      persist();
    });
  }
  bindSwitch('clickExit', 'clickExit');
  bindSwitch('allScreens', 'allScreens');

  // --- 立即开启 ---
  $('testBtn').addEventListener('click', activateSpotlight);

  // --- 跳转 ZTools 全局快捷键设置 ---
  $('bindBtn').addEventListener('click', function () {
    try {
      if (window.ztools && window.ztools.redirectHotKeySetting) {
        window.ztools.redirectHotKeySetting('聚光灯', true);
      } else {
        window.ztools && window.ztools.showNotification('当前 ZTools 版本不支持自动跳转，请手动到 设置 → 全局快捷键 绑定');
      }
    } catch (e) {}
  });

  // --- 显示器诊断 ---
  function refreshDisplayInfo() {
    var el = $('displayInfo');
    if (!el) return;
    if (!window.ztools || !window.ztools.getAllDisplays) {
      el.textContent = '当前环境不支持显示器检测';
      return;
    }
    try {
      var displays = window.ztools.getAllDisplays() || [];
      if (!displays.length) {
        el.textContent = '未检测到任何显示器（getAllDisplays 返回空）';
        return;
      }
      var lines = displays.map(function (d, i) {
        var b = d.bounds || {};
        return '屏 ' + (i + 1) + '：' + b.width + '×' + b.height +
          ' @ (' + b.x + ', ' + b.y + ')' +
          (d.scaleFactor ? ' · 缩放 ' + d.scaleFactor + 'x' : '');
      });
      el.textContent = '共检测到 ' + displays.length + ' 块显示器 — ' + lines.join(' ｜ ');
    } catch (e) {
      el.textContent = '显示器检测出错：' + e.message;
    }
  }
  refreshDisplayInfo();

  /* ---------------- 实时预览 ---------------- */

  var preview = $('preview');
  var pSpot = $('pSpot');
  var pTarget = { x: 160, y: 120 };
  var pPos = { x: 160, y: 120 };

  function applyPreviewSpot() {
    var r = settings.radius;
    var op = settings.opacity / 100;
    var soft = settings.softness;
    pSpot.style.width = r * 2 + 'px';
    pSpot.style.height = r * 2 + 'px';
    // 大扩散 box-shadow 形成“圆形亮区 + 四周变暗”，blur 提供柔化边缘
    pSpot.style.boxShadow = '0 0 ' + soft + 'px 3000px rgba(0, 0, 0, ' + op + ')';
  }

  preview.addEventListener('mousemove', function (e) {
    var rect = preview.getBoundingClientRect();
    pTarget.x = e.clientX - rect.left;
    pTarget.y = e.clientY - rect.top;
  });

  // 鼠标进入预览区时，重播“黑幕从四角向鼠标收拢”的入场动画
  var OPEN_MS = 300;
  var pOpenStart = null;
  preview.addEventListener('mouseenter', function (e) {
    var rect = preview.getBoundingClientRect();
    pTarget.x = e.clientX - rect.left;
    pTarget.y = e.clientY - rect.top;
    pPos.x = pTarget.x;
    pPos.y = pTarget.y;
    pOpenStart = performance.now();
  });

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function farthestCornerDist(x, y, w, h) {
    return Math.max(
      Math.sqrt(x * x + y * y),
      Math.sqrt((w - x) * (w - x) + y * y),
      Math.sqrt(x * x + (h - y) * (h - y)),
      Math.sqrt((w - x) * (w - x) + (h - y) * (h - y))
    );
  }

  (function previewLoop() {
    // 与真实遮罩相同的平滑跟随算法（线性插值）
    pPos.x += (pTarget.x - pPos.x) * 0.28;
    pPos.y += (pTarget.y - pPos.y) * 0.28;

    // 入场收拢：亮洞半径从“覆盖整个预览区”收缩到设定半径
    var rEff = settings.radius;
    if (pOpenStart !== null) {
      var t = (performance.now() - pOpenStart) / OPEN_MS;
      if (t >= 1) {
        pOpenStart = null;
      } else {
        var rect = preview.getBoundingClientRect();
        var extra = farthestCornerDist(pPos.x, pPos.y, rect.width, rect.height) + settings.softness;
        rEff = settings.radius + (1 - easeOutCubic(t)) * extra;
      }
    }

    pSpot.style.width = rEff * 2 + 'px';
    pSpot.style.height = rEff * 2 + 'px';
    pSpot.style.transform = 'translate3d(' + (pPos.x - rEff) + 'px, ' + (pPos.y - rEff) + 'px, 0)';
    requestAnimationFrame(previewLoop);
  })();

  applyPreviewSpot();
  ['radius', 'opacity', 'softness'].forEach(function (id) {
    $(id).addEventListener('input', applyPreviewSpot);
  });

  // 兜底：若 600ms 内未收到任何进入事件（非常规打开方式），恢复设置页可见
  setTimeout(function () {
    if (Date.now() - lastActivateAt > 800) {
      document.body.classList.remove('activating');
    }
  }, 600);

  // 主窗口高度适配
  if (window.ztools) {
    try { window.ztools.setExpendHeight(770); } catch (e) {}
  }
})();
