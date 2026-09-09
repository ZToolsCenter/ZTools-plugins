/**
 * 聚光灯遮罩窗口逻辑（多屏版：每块屏幕一个独立遮罩窗口）
 *
 * 本窗口由插件主页面通过 ztools.createBrowserWindow 创建，
 * 初始参数经 URL query 传入：
 *   ox, oy  - 窗口左上角在屏幕中的 DIP 坐标（用于把全局鼠标坐标换算为窗口内坐标）
 *   r       - 光圈半径 px
 *   o       - 背景暗度 0-100
 *   soft    - 边缘柔化 px
 *   ce      - 1/0 是否允许点击退出
 *   cx, cy  - 开启瞬间的鼠标屏幕坐标（可选）
 *   sid     - 本次聚光灯会话 ID（多窗口联动退出用）
 *   tip     - 1 时在本窗口显示底部提示条（仅鼠标所在屏幕）
 *
 * 多窗口联动（localStorage 令牌）：
 *   - 任意窗口退出时写入 spotlight-close:{sid}，其余窗口轮询到后跟随关闭
 *   - 聚焦窗口持续写焦点心跳 spotlight-fhb:{sid}；某窗口失焦 300ms 后
 *     若全局焦点心跳已停（用户 Alt+Tab 离开），则触发整体退出。
 *     窗口间焦点转移时心跳不断，不会误退出。
 */

(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  function num(key, def) {
    var v = parseFloat(params.get(key));
    return isNaN(v) ? def : v;
  }

  var ORIGIN = { x: num('ox', 0), y: num('oy', 0) };
  var RADIUS = Math.max(20, num('r', 180));
  var OPACITY = Math.min(0.98, Math.max(0, num('o', 75) / 100));
  var SOFTNESS = Math.max(0, num('soft', 60));
  var CLICK_EXIT = params.get('ce') !== '0';
  var SID = params.get('sid') || 'default';
  var SHOW_TIP = params.get('tip') === '1';

  var CLOSE_KEY = 'spotlight-close:' + SID;
  var FOCUS_KEY = 'spotlight-fhb:' + SID;

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  var spot = document.getElementById('spot');
  var tip = document.getElementById('tip');

  /* ---------- 光圈外观 ---------- */

  spot.style.width = RADIUS * 2 + 'px';
  spot.style.height = RADIUS * 2 + 'px';
  // 300vmax 的扩散足以覆盖任意尺寸的屏幕
  spot.style.boxShadow = '0 0 ' + SOFTNESS + 'px 300vmax rgba(0, 0, 0, ' + OPACITY + ')';

  /* ---------- 位置跟踪（全局坐标轮询为主，鼠标事件为辅） ---------- */

  // target 是本窗口内的坐标；鼠标不在本屏时为负值或超出窗口尺寸，
  // 光圈会平滑地从边缘滑出，本屏保持全暗
  var target = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  var pos = { x: target.x, y: target.y };

  // 初始位置：优先使用父窗口传来的开启瞬间鼠标坐标
  if (params.get('cx') !== null && params.get('cy') !== null) {
    target.x = num('cx', target.x) - ORIGIN.x;
    target.y = num('cy', target.y) - ORIGIN.y;
    pos.x = target.x;
    pos.y = target.y;
  }

  // 通道一：轮询全局鼠标坐标（跨屏跟踪的关键，ZTools 会向创建的窗口注入 ztools）
  var canPoll = !!(window.ztools && window.ztools.getCursorScreenPoint);
  function pollCursor() {
    if (!canPoll) return;
    try {
      var p = window.ztools.getCursorScreenPoint();
      if (p && typeof p.x === 'number') {
        target.x = p.x - ORIGIN.x;
        target.y = p.y - ORIGIN.y;

        // 焦点跟随鼠标：光标进入本屏且聚光灯仍持有焦点（焦点心跳新鲜）时，
        // 让本窗口获得焦点，保证 Esc 在任意屏幕都能退出；
        // 心跳已停说明用户切走了，不抢焦点（由失焦逻辑统一退出）
        var inside =
          target.x >= 0 && target.x < window.innerWidth &&
          target.y >= 0 && target.y < window.innerHeight;
        if (inside && !(document.hasFocus && document.hasFocus())) {
          var lastBeat = parseInt(lsGet(FOCUS_KEY) || '0', 10);
          if (Date.now() - lastBeat < 600) {
            try { window.focus(); } catch (e) {}
          }
        }
      }
    } catch (e) { /* 忽略单次失败 */ }
  }

  // 通道二：本窗口捕获的鼠标事件（事件驱动，更顺滑；仅光标在本屏时触发）
  document.addEventListener('mousemove', function (e) {
    target.x = e.clientX;
    target.y = e.clientY;
  });

  /* ---------- 平滑跟随渲染循环 ---------- */

  var LERP = 0.3; // 每帧向目标靠近 30%，形成顺滑的跟随感

  /*
   * 入场动画：黑幕从四角向鼠标位置收拢。
   * 原理：亮洞（光斑 div）的半径从“足以覆盖全屏”收缩到设定半径，
   * box-shadow 的暗色边缘便从屏幕四角向光标处收拢。
   * 鼠标不在本屏的窗口：亮洞收缩到屏幕外，最终整屏变暗。
   */
  var OPEN_MS = 300;
  var openStart = null;

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  // 当前光斑中心到窗口四角的距离最大值（保证动画开始时阴影完全在屏幕外）
  function farthestCornerDist(x, y) {
    var w = window.innerWidth, h = window.innerHeight;
    return Math.max(
      Math.sqrt(x * x + y * y),
      Math.sqrt((w - x) * (w - x) + y * y),
      Math.sqrt(x * x + (h - y) * (h - y)),
      Math.sqrt((w - x) * (w - x) + (h - y) * (h - y))
    );
  }

  function frame() {
    pollCursor();
    pos.x += (target.x - pos.x) * LERP;
    pos.y += (target.y - pos.y) * LERP;

    var rEff = RADIUS;
    if (openStart !== null) {
      var t = (performance.now() - openStart) / OPEN_MS;
      if (t >= 1) {
        openStart = null;
        spot.style.width = RADIUS * 2 + 'px';
        spot.style.height = RADIUS * 2 + 'px';
      } else {
        var extra = farthestCornerDist(pos.x, pos.y) + SOFTNESS + 20;
        rEff = RADIUS + (1 - easeOutCubic(t)) * extra;
        spot.style.width = rEff * 2 + 'px';
        spot.style.height = rEff * 2 + 'px';
      }
    }

    spot.style.transform =
      'translate3d(' + (pos.x - rEff) + 'px, ' + (pos.y - rEff) + 'px, 0)';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 入场：启动收拢动画 + 短暂显示提示条（仅鼠标所在屏幕）
  requestAnimationFrame(function () {
    openStart = performance.now();
    if (SHOW_TIP) {
      tip.classList.add('show');
      setTimeout(function () { tip.classList.remove('show'); }, 2600);
    }
  });

  /* ---------- 多窗口联动与退出 ---------- */

  var closed = false;
  var bornAt = Date.now();

  function closeSpotlight(broadcast) {
    if (closed) return;
    closed = true;
    if (broadcast) lsSet(CLOSE_KEY, String(Date.now())); // 通知其余遮罩窗口一起退出
    // 通知父窗口（若环境支持）
    try {
      if (window.ztools && window.ztools.sendToParent) {
        window.ztools.sendToParent('spotlight:close');
      }
    } catch (e) {}
    // 黑幕淡出后关闭窗口
    spot.style.transition = 'opacity 120ms ease';
    spot.style.opacity = '0';
    tip.classList.remove('show');
    clearInterval(cascadeTimer);
    clearInterval(focusBeatTimer);
    setTimeout(function () { window.close(); }, 120);
  }

  // 联动：其余窗口关闭时跟随关闭
  var cascadeTimer = setInterval(function () {
    if (lsGet(CLOSE_KEY) !== null) closeSpotlight(false);
  }, 200);

  // 焦点心跳：聚焦窗口每 200ms 上报一次；失焦窗口据此判断用户是否已离开聚光灯
  var focusBeatTimer = setInterval(function () {
    if (document.hasFocus && document.hasFocus()) {
      lsSet(FOCUS_KEY, String(Date.now()));
    }
  }, 200);

  window.addEventListener('blur', function () {
    // 启动初期窗口间焦点交接属正常，宽限 800ms
    if (Date.now() - bornAt < 800) return;
    setTimeout(function () {
      if (closed) return;
      var lastBeat = parseInt(lsGet(FOCUS_KEY) || '0', 10);
      // 没有任何遮罩窗口持有焦点（用户 Alt+Tab 离开）→ 整体退出
      if (Date.now() - lastBeat > 500) closeSpotlight(true);
    }, 300);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeSpotlight(true);
  });

  if (CLICK_EXIT) {
    document.addEventListener('mousedown', function () { closeSpotlight(true); });
  }
})();
