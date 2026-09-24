/* 悬浮球页面逻辑：整体持仓盈亏显示 + 数据轮播 + 拖动 + 右键菜单 */
(function () {
  'use strict';
  var S = window.services || {};
  var root = document.getElementById('root');
  var ball = document.getElementById('ball');
  var elMain = document.getElementById('main');
  var elSub = document.getElementById('sub');
  var elMenu = document.getElementById('menu');
  var elBadge = document.getElementById('badge');

  var settings = { ballSize: 72, ballOpacity: 0.95, ballMode: 'profit', showName: true, refreshSec: 5, rotateSec: 4 };
  var posSummary = null;
  var quotes = [];
  var cursor = 0;
  var profitSubMode = 0; // 0: 盈亏率 (如 +3.45%), 1: 今日盈亏 (如 今 +120), 2: 总市值 (如 市 4.5万)
  var failCount = 0;
  var menuOpen = false;
  var isDragging = false;   // 指针按下期间为 true：抑制重排（fitText 是同步布局，正是卡顿感来源之一）
  var needRender = false;   // 拖动期间来的刷新挂起，松手后补一次
  var refreshTimer = null;
  var rotateTimer = null;
  var lastOkAt = 0;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function color(val) {
    if (val === null || val === undefined || isNaN(val)) return getComputedStyle(document.documentElement).getPropertyValue('--c-flat').trim() || '#7c8ba1';
    if (val > 0) return getComputedStyle(document.documentElement).getPropertyValue('--c-up').trim() || '#ff4b4b';
    if (val < 0) return getComputedStyle(document.documentElement).getPropertyValue('--c-down').trim() || '#12c48b';
    return getComputedStyle(document.documentElement).getPropertyValue('--c-flat').trim() || '#7c8ba1';
  }
  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return Math.abs(v).toFixed(2) + '%';
  }
  function fmtPrice(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return v < 10 ? Number(v).toFixed(3) : Number(v).toFixed(2);
  }
  function fmtProfit(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    var abs = Math.abs(v);
    if (abs >= 1e8) {
      var yi = abs / 1e8;
      return (yi >= 10 ? yi.toFixed(1) : yi.toFixed(2)).replace(/\.0$/, '') + '亿';
    }
    if (abs >= 1e4) {
      var wan = abs / 1e4;
      return (wan >= 10 ? wan.toFixed(1) : (Math.round(wan * 10) / 10).toFixed(1)).replace(/\.0$/, '') + '万';
    }
    if (abs >= 1000) {
      var k = abs / 1000;
      return (k >= 10 ? k.toFixed(1) : (Math.round(k * 10) / 10).toFixed(1)).replace(/\.0$/, '') + 'k';
    }
    if (abs >= 100) return String(Math.round(abs));
    if (abs >= 1) return (Math.round(abs * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return (Math.round(abs * 100) / 100).toFixed(2).replace(/\.00$/, '');
  }
  function shortName(name) {
    var n = String(name || '').replace(/ETF|基金|股份|集团|科技|国泰|指数/g, '');
    return n.length > 6 ? n.slice(0, 6) : (n || '--');
  }
  function current() { return quotes.length ? quotes[((cursor % quotes.length) + quotes.length) % quotes.length] : null; }

  function applyOpacity(val) {
    var op = Number(val);
    if (!isFinite(op) || op <= 0 || op > 1) op = 0.95;
    settings.ballOpacity = op;
    document.documentElement.style.setProperty('--opacity', String(op));
    if (root) root.style.opacity = String(op);
    if (ball) ball.style.opacity = String(op);
  }

  function applySettings(s) {
    settings = Object.assign(settings, s || {});
    if (!settings.ballSize || settings.ballSize <= 56) settings.ballSize = 72;
    document.documentElement.style.setProperty('--ball-size', settings.ballSize + 'px');
    applyOpacity(settings.ballOpacity);
    fitText();
  }

  function fitSingle(el, targetWidth, startSize, minSize) {
    if (!el || !el.textContent) return;
    var fs = startSize;
    el.style.fontSize = fs + 'px';
    while (el.scrollWidth > targetWidth && fs > minSize) {
      fs -= 1;
      el.style.fontSize = fs + 'px';
    }
  }

  function fitText() {
    if (!elMain || !elSub) return;
    var bSize = settings.ballSize || 72;
    // 内容+球径没变就跳过：fitSingle 每次测量都是强制同步布局（scrollWidth 读取），
    // 以前每5秒的数据刷新会空转两三轮测量，现在未变化时零布局
    var key = bSize + '|' + elMain.textContent + '|' + elSub.textContent;
    if (elMain.__fitKey === key) return;
    elMain.__fitKey = key;
    fitSingle(elMain, bSize * 0.82, Math.round(bSize * 0.26), 11);
    fitSingle(elSub, bSize * 0.76, Math.round(bSize * 0.18), 9);
  }

  function setText(el, v) { if (el && el.textContent !== v) el.textContent = v; }
  function setBallClass(c) { if (ball && ball.className !== c) ball.className = c; }
  function setBadgeH(flag) { if (elBadge && elBadge.hidden !== flag) elBadge.hidden = flag; }

  function render() {
    if (isDragging) { needRender = true; return; } // 拖动中不重建 DOM，松手再补
    var hasPositions = posSummary && posSummary.count > 0;

    if (hasPositions) {
      // 用户核心需求：悬浮球里面只显示今天的涨跌，盈利为红，亏损为绿
      var todayPl = posSummary.todayProfitLoss || 0;
      var todayRate = posSummary.todayProfitLossRate;
      if (todayRate === undefined || todayRate === null || isNaN(todayRate)) {
        var prevMv = (posSummary.totalMarketValue || 0) - todayPl;
        todayRate = prevMv > 0 ? (todayPl / prevMv) * 100 : null;
      }

      // 幂等渲染：数据没变化时一个 DOM 都不碰（textContent 赋值本身就会弄脏布局）
      setBallClass(todayPl > 0 ? 'profit' : (todayPl < 0 ? 'loss' : 'flat'));
      setText(elMain, fmtProfit(todayPl));
      setText(elSub, (todayRate !== null && !isNaN(todayRate)) ? fmtPct(todayRate) : '今日盈亏');
      setBadgeH(failCount < 2);
      fitText();
      return;
    }

    // 备用：无持仓时显示自选股当天涨跌
    var q = current() || (quotes && quotes[0]);
    if (!q) {
      setBallClass('flat');
      setText(elMain, '0');
      setText(elSub, '今日盈亏');
      setBadgeH(failCount < 2);
      fitText();
      return;
    }
    var chg = q.chg !== undefined && q.chg !== null ? q.chg : (q.price !== null && q.prevClose ? q.price - q.prevClose : 0);
    setBallClass(chg > 0 ? 'profit' : (chg < 0 ? 'loss' : 'flat'));
    setText(elMain, fmtProfit(chg));
    setText(elSub, fmtPct(q.pct));
    setBadgeH(failCount < 2);
    fitText();
  }


  var refreshPending = null;
  function refresh() {
    // 同窗口合并：定时刷新/唤醒/广播重叠触发时复用进行中的一轮
    if (refreshPending) return refreshPending;
    refreshPending = refreshImpl().finally(function () { refreshPending = null; });
    return refreshPending;
  }
  function refreshImpl() {
    var pPos = Promise.resolve().then(function () {
      return (S.positions && S.positions.get) ? S.positions.get() : null;
    }).then(function (pos) {
      if (pos) {
        posSummary = pos;
        render();
      }
      return pos;
    }).catch(function () { return null; });

    var pQuotes = Promise.resolve().then(function () {
      return S.quotes ? S.quotes() : [];
    }).then(function (list) {
      if (list && list.length) {
        quotes = list.filter(function (x) { return x && x.code; });
        if (cursor >= quotes.length) cursor = 0;
        render();
      }
      return list;
    }).catch(function () { return []; });

    return Promise.all([pPos, pQuotes]).then(function (res) {
      failCount = 0;
      lastOkAt = Date.now();
      return res;
    }).catch(function (err) {
      failCount += 1;
      render();
      setTimeout(refresh, Math.min(20000, 3000 * failCount));
    });
  }

  function loopRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refresh().catch(function () {}).then(loopRefresh);
    }, Math.max(2, settings.refreshSec || 5) * 1000);
  }

  function loopRotate() {
    // 悬浮球固定只显示今天的涨跌，绝不轮播切换其他内容
    clearTimeout(rotateTimer);
  }

  function nextStock(delta) {
    if (posSummary && posSummary.count > 0 && settings.ballMode !== 'watchlist') {
      // 保持固定显示今日涨跌
      refresh().catch(function () {});
      return;
    }
    if (!quotes.length) return;
    cursor = (cursor + delta + quotes.length) % quotes.length;
    render();
  }

  /* ---------------- 拖动 / 双击 ---------------- */
  var drag = null;
  var lastClickTime = 0;
  var lastOpenPluginTime = 0;

  /*
   * 拖动两条路径（老实现的卡顿有两个来源，这里各治一个）：
   *  1) 快速路径：宿主允许 electron.remote 时，球窗口直接 setBounds 移动自己，零 IPC，
   *     跟手度等同系统原生拖动。老实现每帧要走「球→IPC→主窗口→setBounds」，
   *     而主窗口此时多半是隐藏的（进插件就 hideMainWindow），渲染进程被节流，越拖越滞。
   *  2) IPC 路径：起手先等主窗口 ack（它要异步取一次窗口基准 bounds），ack 之前
   *     的位移只记账不发送，ack 到达立刻冲刷最新一帧。老实现是直接丢弃这段位移 ——
   *     起手几十毫秒的移动凭空消失，球要等你多拖一段才动，就是那句「拖着有点卡」。
   */
  var nativeWin = null;
  try {
    var electronMod = (typeof require === 'function') ? require('electron') : null;
    if (electronMod && electronMod.remote && typeof electronMod.remote.getCurrentWindow === 'function') {
      nativeWin = electronMod.remote.getCurrentWindow();
    }
  } catch (e) { nativeWin = null; }

  function readNativeBounds() {
    if (!nativeWin) return null;
    try {
      var b = nativeWin.getBounds();
      if (b && typeof b.then === 'function') return null; // 异步句柄走不了快速路径
      if (b && typeof b.x === 'number' && typeof b.y === 'number') {
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      }
    } catch (e) { nativeWin = null; }
    return null;
  }

  function startDrag(d) {
    if (d.startBounds) {
      // 快速路径：起手 bounds 是按下瞬间同步读到的，一并交给主窗口，它无需再异步取
      d.ready = true;
      if (S.host && S.host.drag) S.host.drag('start', 0, 0, d.startBounds);
      return;
    }
    // 立即开火：主窗口侧有 pendingDragMove/end 缓冲，start 先到后到都能接住，
    // 没必要等 ack —— 以前等 ack 时，主窗口隐藏被节流会让起手「死」掉几百毫秒到几秒，
    // 表现就是「有时候拖不动」。ack 只作确认，不再参与门控
    d.ready = true;
    if (S.host && typeof S.host.dragStart === 'function') {
      S.host.dragStart(); // 起手+ack，返回值不再 gating
    } else if (S.host && S.host.drag) {
      S.host.drag('start', 0, 0);
    }
  }

  function moveDrag(d) {
    if (d.startBounds) {
      try {
        nativeWin.setBounds({
          x: Math.round(d.startBounds.x + d.lastDx),
          y: Math.round(d.startBounds.y + d.lastDy),
          width: d.startBounds.width, height: d.startBounds.height
        });
        return;
      } catch (e) { nativeWin = null; d.startBounds = null; } // 快速路径失效就退回 IPC
    }
    if (d.ready && S.host && S.host.drag) S.host.drag('move', d.lastDx, d.lastDy);
    // 未 ready：位移记在 lastDx/lastDy，ack 到达后由 startDrag 冲刷，一个像素都不丢
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    drag = { sx: e.screenX, sy: e.screenY, moved: false, id: e.pointerId, lastDx: 0, lastDy: 0, raf: 0, ready: false, startBounds: null };
    drag.startBounds = readNativeBounds();
    isDragging = true;
    needRender = false;
    try { ball.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    ball.classList.add('dragging');
  }
  function onPointerMove(e) {
    if (!drag || (drag.id !== undefined && e.pointerId !== drag.id)) return;
    var dx = e.screenX - drag.sx;
    var dy = e.screenY - drag.sy;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      lastClickTime = 0;
      startDrag(drag);
    }
    drag.lastDx = dx;
    drag.lastDy = dy;
    if (!drag.raf) {
      drag.raf = requestAnimationFrame(function () {
        if (!drag) return;
        drag.raf = 0;
        moveDrag(drag);
      });
    }
  }
  function onPointerUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;
    ball.classList.remove('dragging');
    isDragging = false;
    try { ball.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (d.moved) {
      if (S.host && S.host.drag) S.host.drag('end', d.lastDx, d.lastDy, d.startBounds);
    } else {
      var now = Date.now();
      if (now - lastClickTime < 450) {
        lastClickTime = 0;
        openZToolsPlugin();
      } else {
        lastClickTime = now;
      }
    }
    if (needRender) { needRender = false; render(); }
  }

  function openZToolsPlugin() {
    var now = Date.now();
    if (now - lastOpenPluginTime < 400) return;
    lastOpenPluginTime = now;
    if (S.host && typeof S.host.openPlugin === 'function') {
      S.host.openPlugin('stock');
    } else if (S.host && typeof S.host.openMain === 'function') {
      S.host.openMain('stock');
    }
  }

  function closeMenu() {
    if (elMenu && !elMenu.hidden) {
      elMenu.hidden = true;
      elMenu.innerHTML = '';
      S.host && S.host.menu(false);
    }
  }

  ball.addEventListener('pointerdown', onPointerDown);
  ball.addEventListener('pointermove', onPointerMove);
  ball.addEventListener('pointerup', onPointerUp);
  ball.addEventListener('pointercancel', onPointerUp);
  ball.addEventListener('dblclick', function (e) {
    e.preventDefault();
    e.stopPropagation();
    openZToolsPlugin();
  });
  window.addEventListener('dblclick', function (e) {
    e.preventDefault();
    e.stopPropagation();
    openZToolsPlugin();
  });
  document.addEventListener('pointermove', function (e) { if (drag && !e.screenX && !e.screenY) onPointerMove(e); });

  window.addEventListener('wheel', function (e) {
    nextStock(e.deltaY > 0 ? 1 : -1);
  });

  // 彻底移除右键菜单
  window.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      (S.closeSelf || function () {})();
    }
    if (e.key === 'ArrowRight') nextStock(1);
    if (e.key === 'ArrowLeft') nextStock(-1);
  });

  /* ---------------- 主窗口（管家）来的指令 ---------------- */
  if (typeof S.onCtl === 'function') {
    S.onCtl(function (c) {
      if (!c) return;
      if (c.t === 'opacity') {
        applyOpacity(c.opacity);
      } else if (c.t === 'size') {
        if (c.ballSize) {
          settings.ballSize = c.ballSize;
          document.documentElement.style.setProperty('--ball-size', c.ballSize + 'px');
          fitText();
        }
      } else if (c.t === 'settings') {
        applySettings(c.settings || (S.settings && S.settings.get()));
      } else if (c.t === 'menu') {
        menuOpen = !!c.open;
        root.classList.remove('side-left', 'side-right', 'vside-top', 'vside-bottom');
        if (menuOpen) {
          root.classList.add(c.side === 'left' ? 'side-left' : 'side-right');
          root.classList.add(c.vside === 'bottom' ? 'vside-bottom' : 'vside-top');
        }
      } else if (c.t === 'wake') {
        ball.classList.remove('flash');
        void ball.offsetWidth;
        ball.classList.add('flash');
        refresh().catch(function () {});
      } else if (c.t === 'refresh' || (c.t === 'cmd' && c.cmd === 'refresh')) {
        refresh().catch(function () {});
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    var s = {};
    try { s = (S.settings && S.settings.get()) || {}; } catch (e) { s = {}; }
    applySettings(s);

    // 0毫秒即时呈现本地持仓与自选股缓存，绝不等待远程网络
    try {
      if (S.positions && typeof S.positions.getLocal === 'function') {
        posSummary = S.positions.getLocal();
      }
    } catch (e) {}

    try {
      if (S.quotes && typeof S.quotes.getLocal === 'function') {
        var localQuotes = S.quotes.getLocal();
        if (localQuotes && localQuotes.length) quotes = localQuotes.filter(function (x) { return x && x.code; });
      }
    } catch (e) {}

    render();
    refresh().catch(function () {});
    loopRefresh();
    loopRotate();

    setInterval(function () {
      try {
        var now = (S.settings && S.settings.get()) || {};
        if (now.ballSize !== settings.ballSize || now.ballOpacity !== settings.ballOpacity ||
            now.ballMode !== settings.ballMode || now.refreshSec !== settings.refreshSec ||
            now.rotateSec !== settings.rotateSec || now.showName !== settings.showName) {
          applySettings(now);
          render();
          loopRefresh();
          loopRotate();
          refresh().catch(function () {});
        }
      } catch (e) { /* ignore */ }
    }, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
