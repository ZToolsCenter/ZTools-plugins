/* 股票管家 · 主界面逻辑 (index.js)
 * 支持持仓管理、自选行情、分时大屏、监控设置与桌面悬浮球控制
 */
(function () {
  'use strict';
  var S = window.services || {};
  var $ = function (id) { return document.getElementById(id); };

  var settings = {};
  var watchlist = [];
  var quoteMap = {};
  var idxList = [];
  var expanded = null;
  var trendCache = {};
  var detailCache = {};
  var lastUpdate = 0;
  var failCount = 0;
  var refreshTimer = null;
  var activeTab = 'positions'; // positions | closed | watchlist | settings
  var searchTimer = null;
  var txSearchTimer = null;
  var txType = 1; // 1: 买入, 2: 卖出
  var currentDtCode = null;
  // K线弹窗状态（当日K线 klt=5 / 历史K线 klt=101），数据按 代码|klt 缓存
  var kChartState = { code: null, name: '', klt: 5 };
  var klineCache = {};
  var kChartInst = null;
  var echartsLoad = 0;   // 0未加载 1加载中 2就绪 3失败
  var echartsWait = [];
  // 已清仓列表（本地计算，无网络）
  var closedData = [];

  /* ---------------- 基础工具函数 ---------------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function timeStr(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function fmtPct(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return (v > 0 ? '+' : (v < 0 ? '-' : '')) + Math.abs(v).toFixed(2) + '%';
  }
  function fmtChg(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    return (v > 0 ? '+' : (v < 0 ? '-' : '')) + Math.abs(v).toFixed(2);
  }
  function fmtPrice(v) {

    if (v === null || v === undefined || isNaN(v)) return '--';
    return v < 10 ? Number(v).toFixed(3) : Number(v).toFixed(2);
  }
  function fmtBig(v) {
    if (v === null || v === undefined || isNaN(v)) return '--';
    if (Math.abs(v) >= 1e8) return (v / 1e8).toFixed(2) + '亿';
    if (Math.abs(v) >= 1e4) return (v / 1e4).toFixed(2) + '万';
    return String(Math.round(v));
  }
  function cls(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return 'flat';
    if (pct > 0) return 'up';
    if (pct < 0) return 'down';
    return 'flat';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function rethrow(p) { return Promise.resolve(p); }
  function safeCall(fn) {
    try { return fn(); } catch (e) { return Promise.reject(e); }
  }

  /*
   * 性能：只有内容真的变了才碰 DOM。
   * 行情每几秒刷新一次，但价格往往没变；无条件重写 innerHTML 会丢掉 canvas、事件监听和
   * hover/展开状态，并触发整块重排重绘，窗口多开时会让整个 ZTools 发卡。
   * 返回 true 表示本次确实重建了 DOM（需要重新绑定事件）。
   */
  function setHtml(el, html) {
    if (!el || el.__sbHtml === html) return false;
    el.__sbHtml = html;
    el.innerHTML = html;
    return true;
  }

  /* ---------------- 数据拉取与更新（解耦独立更新，互不阻塞） ---------------- */
  function refresh(force) {
    // force === true（手动刷新按钮）：连非交易时段也强制重拉，透传给 preload 的 force 通道
    var fOpts = (force === true) ? { force: true } : undefined;
    // 1. 持仓实时行情（只请求持仓个股，拿到立刻更新持仓看板和悬浮球）
    var posP = safeCall(function () { return S.positions ? S.positions.get(fOpts) : Promise.resolve(null); })
      .then(function (summary) {
        if (summary) {
          renderPositions(summary);
          updateBallBtnState();
        }
        return summary;
      }).catch(function () { return null; });

    // 2. 自选股行情（拿到立刻更新自选股列表）
    var qP = safeCall(function () { return S.quotes ? S.quotes(fOpts) : Promise.resolve([]); })
      .then(function (list) {
        if (list && list.length) {
          quoteMap = {};
          list.forEach(function (x) { if (x && x.code) quoteMap[x.code] = x; });
          renderWatchlist();
        }
        return list;
      }).catch(function () { return []; });

    // 3. 大盘四大指数（拿到立刻更新顶部指数横幅）
    var ixP = safeCall(function () { return S.indexes ? S.indexes(fOpts) : Promise.resolve([]); })
      .then(function (indexes) {
        if (indexes && indexes.length) {
          idxList = indexes;
          renderIndexes();
        }
        return indexes;
      }).catch(function () { return []; });

    // 已清仓列表：纯本地计算（不发网络请求），跟着每轮刷新一起更新
    var clP = Promise.resolve().then(function () {
      return (S.positions && S.positions.getClosed) ? S.positions.getClosed() : [];
    }).then(function (list) {
      renderClosed(list || []);
      return list;
    }).catch(function () { return []; });

    return Promise.all([posP, qP, ixP, clP]).then(function () {
      failCount = 0;
      lastUpdate = Date.now();
      renderStatus();
    }).catch(function (err) {
      failCount += 1;
      renderStatus();
      setTimeout(refresh, Math.min(30000, 4000 * failCount));
    });
  }

  function loopRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refresh().catch(function () {}).then(loopRefresh);
    }, Math.max(2, settings.refreshSec || 5) * 1000);
  }

  function loadTrend(code, force) {
    var hit = trendCache[code];
    if (!force && hit && Date.now() - hit.at < 20000) return Promise.resolve(hit.data);
    return rethrow(safeCall(function () { return S.trend(code); })).then(function (data) {
      trendCache[code] = { at: Date.now(), data: data };
      return data;
    });
  }

  function loadDetail(code, force) {
    var hit = detailCache[code];
    if (!force && hit && Date.now() - hit.at < 20000) return Promise.resolve(hit.data);
    return rethrow(safeCall(function () { return S.detail(code); })).then(function (data) {
      detailCache[code] = { at: Date.now(), data: data };
      return data;
    });
  }

  /* ---------------- 状态与四大指数 ---------------- */
  function renderStatus() {
    var st = {};
    try { st = S.marketStatus ? S.marketStatus() : { label: '--' }; } catch (e) { st = { label: '--' }; }
    var chip = $('statusChip');
    if (chip) {
      chip.textContent = st.label || '--';
      chip.className = 'chip' + (st.open ? '' : ' closed');
    }
    var t = $('updateAt');
    if (t) {
      if (!lastUpdate) t.textContent = failCount ? '行情获取失败，自动重试中…' : '加载中…';
      else t.textContent = '更新于 ' + timeStr(lastUpdate) + (failCount ? '（最近一次失败）' : '');
    }
  }

  function renderIndexes() {
    var box = $('indexes');
    if (!box) return;
    if (!idxList.length) { setHtml(box, ''); return; }
    setHtml(box, idxList.map(function (i) {
      return '<div class="idx"><span class="nm">' + esc(i.name) + '</span>' +
        '<span class="px ' + cls(i.pct) + '">' + fmtPrice(i.price) + '</span>' +
        '<span class="pc ' + cls(i.pct) + '">' + fmtPct(i.pct) + '</span></div>';
    }).join(''));
  }

  /* ---------------- 股票预警提醒 ---------------- */
  var alertsMap = {};
  function reloadAlerts() {
    alertsMap = {};
    if (S.alerts && S.alerts.get) {
      var list = S.alerts.get();
      (list || []).forEach(function (a) {
        if (a && a.stock_code) alertsMap[a.stock_code] = a;
      });
    }
  }

  /* ---------------- 持仓列表渲染与排序 ---------------- */
  var posSortField = 'none'; // 'none' | 'qty' | 'price' | 'cost' | 'mv' | 'todayPl' | 'pl'
  var posSortOrder = 'none'; // 'none' | 'desc' | 'asc'
  var currentPosSummary = null;

  var ALL_POS_COLS = ['qty', 'priceCost', 'todayPl', 'pl'];
  var POS_COL_DEFS = {
    qty: { min: '75px', fr: '0.85fr', thId: 'sortPosQty' },
    priceCost: { min: '80px', fr: '0.9fr', thId: 'colHeaderPriceCost' },
    todayPl: { min: '85px', fr: '0.95fr', thId: 'sortPosTodayPl' },
    pl: { min: '90px', fr: '1.0fr', thId: 'sortPosPl' }
  };

  function updatePosSortUI() {
    var sortMap = {
      qty: { btn: $('sortPosQty'), icon: $('sortPosQtyIcon') },
      todayPl: { btn: $('sortPosTodayPl'), icon: $('sortPosTodayPlIcon') },
      pl: { btn: $('sortPosPl'), icon: $('sortPosPlIcon') }
    };
    Object.keys(sortMap).forEach(function (f) {
      var item = sortMap[f];
      var isActive = (posSortField === f);
      if (item.btn) item.btn.classList.toggle('active', isActive);
      if (item.icon) {
        if (isActive) {
          item.icon.textContent = (posSortOrder === 'desc' ? '▼' : '▲');
        } else {
          item.icon.textContent = '↕';
        }
      }
    });
  }

  function togglePosSort(field) {
    if (posSortField !== field) {
      posSortField = field;
      posSortOrder = 'desc'; // 默认降序：大值排在前面
    } else if (posSortOrder === 'desc') {
      posSortOrder = 'asc';  // 切换为升序：小值排在前面
    } else {
      posSortField = 'none';
      posSortOrder = 'none'; // 恢复默认录入顺序
    }
    updatePosSortUI();
    if (currentPosSummary) {
      renderPositions(currentPosSummary);
    } else if (S.positions && typeof S.positions.getLocal === 'function') {
      renderPositions(S.positions.getLocal());
    }
  }

  function renderPositions(posSummary) {
    var summary = posSummary || { count: 0, totalMarketValue: 0, totalCost: 0, totalProfitLoss: 0, totalProfitLossRate: 0, todayProfitLoss: 0, positions: [] };
    currentPosSummary = summary;
    var positions = summary.positions || [];

    // 资产总览卡片
    if ($('ovTotalMv')) $('ovTotalMv').textContent = '¥' + (summary.totalMarketValue || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if ($('ovTotalCost')) $('ovTotalCost').textContent = '¥' + (summary.totalCost || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    var pl = summary.totalProfitLoss || 0;
    var plRate = summary.totalProfitLossRate || 0;
    var elPl = $('ovTotalPl');
    var elPlRate = $('ovTotalPlRate');
    if (elPl) {
      elPl.textContent = (pl > 0 ? '+' : '') + pl.toFixed(2);
      elPl.className = 'ovValue ' + cls(pl);
    }
    if (elPlRate) {
      elPlRate.textContent = '(' + (plRate > 0 ? '+' : '') + plRate.toFixed(2) + '%)';
      elPlRate.className = 'ovSub ' + cls(pl);
    }

    var tdPl = summary.todayProfitLoss || 0;
    var elTodayPl = $('ovTodayPl');
    if (elTodayPl) {
      elTodayPl.textContent = (tdPl > 0 ? '+' : '') + tdPl.toFixed(2);
      elTodayPl.className = 'ovValue ' + cls(tdPl);
    }

    if ($('posCountBadge')) $('posCountBadge').textContent = String(summary.count || 0);

    var wrap = $('posList');
    var empty = $('posEmpty');
    var header = $('posTableHeader');
    if (!wrap) return;

    var activePositions = positions.filter(function (p) { return p.quantity > 0; });
    if (empty) empty.hidden = activePositions.length > 0;
    if (header) header.hidden = activePositions.length === 0;
    if ($('posHeaderWrap')) $('posHeaderWrap').hidden = activePositions.length === 0;

    // 自定义显示列与表格列排版
    var visibleCols = Array.isArray(settings.posColumns) ? settings.posColumns.slice() : ALL_POS_COLS.slice();
    visibleCols = visibleCols.filter(function (c) {
      return ALL_POS_COLS.indexOf(c) >= 0;
    });
    if (settings.posColumns && settings.posColumns.length > 0 && visibleCols.length === 0) {
      visibleCols = ALL_POS_COLS.slice();
    }

    var colCssParts = ['minmax(105px, 1.2fr)'];
    ALL_POS_COLS.forEach(function (col) {
      var isVis = visibleCols.indexOf(col) >= 0;
      var th = $(POS_COL_DEFS[col].thId);
      if (th) th.style.display = isVis ? 'flex' : 'none';
      if (isVis) {
        colCssParts.push('minmax(' + POS_COL_DEFS[col].min + ', ' + POS_COL_DEFS[col].fr + ')');
      }
    });
    colCssParts.push('150px'); // 买/卖 + 流水 + 预警 + 📈K线 四按钮
    var gridCss = colCssParts.join(' ');
    if (header) header.style.gridTemplateColumns = gridCss;

    // 表头排序逻辑
    if (posSortField !== 'none' && posSortOrder !== 'none') {
      activePositions.sort(function (a, b) {
        var va = 0;
        var vb = 0;
        if (posSortField === 'qty') {
          va = (a.market_value !== undefined && a.market_value !== null) ? Number(a.market_value) : ((a.quantity || 0) * (a.current_price || 0));
          vb = (b.market_value !== undefined && b.market_value !== null) ? Number(b.market_value) : ((b.quantity || 0) * (b.current_price || 0));
        } else if (posSortField === 'todayPl') {
          va = (a.change_percent !== undefined && a.change_percent !== null && !isNaN(a.change_percent)) ? Number(a.change_percent) : -Infinity;
          vb = (b.change_percent !== undefined && b.change_percent !== null && !isNaN(b.change_percent)) ? Number(b.change_percent) : -Infinity;
        } else if (posSortField === 'pl') {
          va = (a.profit_loss_rate !== undefined && a.profit_loss_rate !== null && !isNaN(a.profit_loss_rate)) ? Number(a.profit_loss_rate) : -Infinity;
          vb = (b.profit_loss_rate !== undefined && b.profit_loss_rate !== null && !isNaN(b.profit_loss_rate)) ? Number(b.profit_loss_rate) : -Infinity;
        }
        return posSortOrder === 'asc' ? va - vb : vb - va;
      });
    }

    var rowsHtml = activePositions.map(function (p) {
      var plCls = cls(p.profit_loss);
      var todayCls = cls(p.today_profit_loss);
      var chgCls = cls(p.change_percent);
      var hasAlert = !!(alertsMap[p.stock_code] && alertsMap[p.stock_code].enabled !== false);

      var colsHtml = '';
      if (visibleCols.indexOf('qty') >= 0) {
        var mv = (p.market_value !== undefined && p.market_value !== null) ? Number(p.market_value) : ((p.quantity || 0) * (p.current_price || 0));
        colsHtml += '<div class="tdCol tdQty"><span class="val">' + (p.quantity || 0).toLocaleString() + '</span><span class="sub">¥' + mv.toFixed(2) + '</span></div>';
      }
      if (visibleCols.indexOf('priceCost') >= 0) {
        colsHtml += '<div class="tdCol tdPriceCost"><span class="val ' + chgCls + '">' + fmtPrice(p.current_price) + '</span><span class="sub costVal">¥' + fmtPrice(p.cost_price) + '</span></div>';
      }
      if (visibleCols.indexOf('todayPl') >= 0) {
        colsHtml += '<div class="tdCol tdTodayPl"><span class="val ' + chgCls + '">' + fmtPct(p.change_percent) + '</span><span class="sub ' + todayCls + '">' + (p.today_profit_loss > 0 ? '+' : '') + (p.today_profit_loss || 0).toFixed(2) + '</span></div>';
      }
      if (visibleCols.indexOf('pl') >= 0) {
        colsHtml += '<div class="tdCol tdPl"><span class="val ' + plCls + '">' + fmtPct(p.profit_loss_rate) + '</span><span class="sub ' + plCls + '">' + (p.profit_loss > 0 ? '+' : '') + (p.profit_loss || 0).toFixed(2) + '</span></div>';
      }

      return '<div class="posTableRow" style="grid-template-columns:' + gridCss + ';" data-code="' + esc(p.stock_code) + '" data-name="' + esc(p.stock_name) + '" data-price="' + (p.current_price || 0) + '" data-qty="' + p.quantity + '" data-pct="' + (p.change_percent || 0) + '">' +
        '<div class="tdCol tdName" title="' + esc(p.stock_name) + ' (' + esc(p.stock_code) + ')">' +
          '<span class="posStockName">' + esc(p.stock_name) + '</span>' +
          '<span class="posStockCode">' + esc(p.stock_code) + '</span>' +
        '</div>' +
        colsHtml +
        '<div class="tdCol tdOps">' +
          '<button class="btnSm txBtn" data-act="tx" title="记录买入或卖出交易">买/卖</button>' +
          '<button class="btnSm" data-act="detail" title="交易流水明细与T操作盈亏">流水</button>' +
          '<button class="btnSm btnAlert' + (hasAlert ? ' active' : '') + '" data-act="alert" title="' + (hasAlert ? '已设置预警提醒（点击修改）' : '设置股价/涨跌预警提醒') + '">🔔</button>' +
          '<button class="btnSm kBtn" data-act="kline" title="查看当日/历史K线">📈</button>' +
        '</div>' +
      '</div>';
    }).join('');

    // 内容没变就直接返回：不重建表格、不重新绑定事件
    if (!setHtml(wrap, rowsHtml)) return;

    Array.prototype.forEach.call(wrap.querySelectorAll('.posTableRow'), function (card) {
      var code = card.getAttribute('data-code');
      var name = card.getAttribute('data-name');
      var price = Number(card.getAttribute('data-price')) || 0;
      var qty = Number(card.getAttribute('data-qty')) || 100;
      var pct = Number(card.getAttribute('data-pct')) || 0;

      var txBtn = card.querySelector('[data-act="tx"]');
      if (txBtn) {
        txBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openTxModal({ type: 1, code: code, name: name, price: price, qty: 100 });
        });
      }

      var dtBtn = card.querySelector('[data-act="detail"]');
      if (dtBtn) {
        dtBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openDtModal(code, name);
        });
      }

      var alertBtn = card.querySelector('[data-act="alert"]');
      if (alertBtn) {
        alertBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openAlertModal(code, name, price, pct);
        });
      }

      var kBtn = card.querySelector('[data-act="kline"]');
      if (kBtn) {
        kBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          openKChart(code, name);
        });
      }
    });
  }

  /* ---------------- 自选分组管理 ---------------- */
  var activeGroup = 'all';
  var groupModalMode = 'create'; // 'create' | 'move' | 'edit'
  var groupModalStockCode = null;
  var groupModalOldName = null;

  function renderGroupTabs() {
    var tabsBox = $('groupTabs');
    if (!tabsBox) return;
    watchlist = (S.watchlist && S.watchlist.get()) || [];
    var groups = (S.watchlist && S.watchlist.getGroups) ? S.watchlist.getGroups() : ['默认'];
    if (!groups.includes('默认')) groups.unshift('默认');

    var counts = { all: watchlist.length };
    watchlist.forEach(function (w) {
      var g = w.group || '默认';
      counts[g] = (counts[g] || 0) + 1;
    });

    var html = '<div class="groupTab' + (activeGroup === 'all' ? ' active' : '') + '" data-group="all">全部<span class="tabCount">' + (counts.all || 0) + '</span></div>';
    groups.forEach(function (g) {
      var cnt = counts[g] || 0;
      html += '<div class="groupTab' + (activeGroup === g ? ' active' : '') + '" data-group="' + esc(g) + '" title="右键可重命名或删除分组">' +
        esc(g) + '<span class="tabCount">' + cnt + '</span>' +
      '</div>';
    });
    if (!setHtml(tabsBox, html)) return;

    Array.prototype.forEach.call(tabsBox.querySelectorAll('.groupTab'), function (el) {
      var g = el.getAttribute('data-group');
      el.addEventListener('click', function () {
        activeGroup = g;
        renderGroupTabs();
        renderWatchlist();
      });
      el.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        if (g === 'all' || g === '默认') return;
        openGroupModal('edit', null, g);
      });
    });
  }

  function openGroupModal(mode, stockCode, groupName) {
    groupModalMode = mode;
    groupModalStockCode = stockCode;
    groupModalOldName = groupName;
    var modal = $('groupModal');
    if (!modal) return;
    $('groupModalError').hidden = true;
    $('groupModalError').textContent = '';

    var groups = (S.watchlist && S.watchlist.getGroups) ? S.watchlist.getGroups() : ['默认'];

    if (mode === 'create') {
      $('groupModalTitle').textContent = '新建自选分组';
      $('groupModalLabel').textContent = '分组名称';
      $('groupInputWrap').hidden = false;
      $('groupInputName').value = '';
      $('groupModalSelectWrap').hidden = true;
      $('btnGroupDelete').hidden = true;
    } else if (mode === 'edit') {
      $('groupModalTitle').textContent = '分组管理: ' + groupName;
      $('groupModalLabel').textContent = '修改分组名称';
      $('groupInputWrap').hidden = false;
      $('groupInputName').value = groupName;
      $('groupModalSelectWrap').hidden = true;
      $('btnGroupDelete').hidden = false;
    } else if (mode === 'move') {
      var item = watchlist.find(function (x) { return x.code === stockCode; });
      var stockName = (item && item.name) || stockCode;
      $('groupModalTitle').textContent = '移动股票分组: ' + stockName;
      $('groupInputWrap').hidden = true;
      $('groupModalSelectWrap').hidden = false;
      $('btnGroupDelete').hidden = true;

      var sel = $('groupSelectTarget');
      sel.innerHTML = groups.map(function (g) {
        var cur = item && (item.group || '默认');
        return '<option value="' + esc(g) + '"' + (g === cur ? ' selected' : '') + '>' + esc(g) + '</option>';
      }).join('');
    }
    modal.hidden = false;
    if (!modal.querySelector('#groupInputWrap').hidden) {
      setTimeout(function () { $('groupInputName').focus(); }, 100);
    }
  }

  function closeGroupModal() {
    if ($('groupModal')) $('groupModal').hidden = true;
    groupModalStockCode = null;
    groupModalOldName = null;
  }

  function submitGroupModal() {
    if (groupModalMode === 'create') {
      var name = $('groupInputName').value.trim();
      if (!name) {
        $('groupModalError').textContent = '分组名称不能为空';
        $('groupModalError').hidden = false;
        return;
      }
      if (name.length > 12) {
        $('groupModalError').textContent = '分组名称不能超过12个字';
        $('groupModalError').hidden = false;
        return;
      }
      if (S.watchlist && S.watchlist.addGroup) {
        S.watchlist.addGroup(name);
      }
      activeGroup = name;
      closeGroupModal();
      renderGroupTabs();
      renderWatchlist();
    } else if (groupModalMode === 'edit') {
      var newName = $('groupInputName').value.trim();
      if (!newName) {
        $('groupModalError').textContent = '分组名称不能为空';
        $('groupModalError').hidden = false;
        return;
      }
      if (newName !== groupModalOldName && S.watchlist && S.watchlist.renameGroup) {
        S.watchlist.renameGroup(groupModalOldName, newName);
        if (activeGroup === groupModalOldName) activeGroup = newName;
      }
      closeGroupModal();
      renderGroupTabs();
      renderWatchlist();
    } else if (groupModalMode === 'move') {
      var targetG = $('groupSelectTarget').value;
      if (groupModalStockCode && S.watchlist && S.watchlist.setStockGroup) {
        S.watchlist.setStockGroup(groupModalStockCode, targetG);
      }
      closeGroupModal();
      renderGroupTabs();
      renderWatchlist();
    }
  }

  function deleteCurrentGroup() {
    if (groupModalMode === 'edit' && groupModalOldName && groupModalOldName !== '默认') {
      if (S.watchlist && S.watchlist.removeGroup) {
        S.watchlist.removeGroup(groupModalOldName);
      }
      if (activeGroup === groupModalOldName) activeGroup = 'all';
      closeGroupModal();
      renderGroupTabs();
      renderWatchlist();
    }
  }

  /* ---------------- 自选股列表渲染与排序 ---------------- */
  var sortField = 'none'; // 'none' | 'price' | 'pct'
  var sortOrder = 'none'; // 'none' | 'desc' | 'asc'

  function updateSortUI() {
    var elPx = $('sortWatchlistPx');
    var elPct = $('sortWatchlistPct');
    var iconPx = $('sortPxIcon');
    var iconPct = $('sortPctIcon');

    if (elPx) elPx.classList.toggle('active', sortField === 'price');
    if (elPct) elPct.classList.toggle('active', sortField === 'pct');

    if (iconPx) {
      if (sortField === 'price') {
        iconPx.textContent = sortOrder === 'desc' ? '▼' : '▲';
      } else {
        iconPx.textContent = '↕';
      }
    }
    if (iconPct) {
      if (sortField === 'pct') {
        iconPct.textContent = sortOrder === 'desc' ? '▼' : '▲';
      } else {
        iconPct.textContent = '↕';
      }
    }
  }

  function toggleSort(field) {
    if (sortField !== field) {
      sortField = field;
      sortOrder = 'desc'; // 默认降序：高价/高涨幅排在前面
    } else if (sortOrder === 'desc') {
      sortOrder = 'asc';  // 切换为升序：低价/高跌幅排在前面
    } else {
      sortField = 'none';
      sortOrder = 'none'; // 还原默认手动排序
    }
    updateSortUI();
    renderWatchlist();
  }

  function renderWatchlist() {
    var box = $('stockList');
    if (!box) return;
    watchlist = (S.watchlist && S.watchlist.get()) || [];

    var displayList = activeGroup === 'all'
      ? watchlist.slice()
      : watchlist.filter(function (w) { return (w.group || '默认') === activeGroup; });

    if (sortField === 'price') {
      displayList.sort(function (a, b) {
        var qa = quoteMap[a.code] || {};
        var qb = quoteMap[b.code] || {};
        var pa = (qa.price !== undefined && qa.price !== null && !isNaN(qa.price)) ? Number(qa.price) : -Infinity;
        var pb = (qb.price !== undefined && qb.price !== null && !isNaN(qb.price)) ? Number(qb.price) : -Infinity;
        return sortOrder === 'asc' ? pa - pb : pb - pa;
      });
    } else if (sortField === 'pct') {
      displayList.sort(function (a, b) {
        var qa = quoteMap[a.code] || {};
        var qb = quoteMap[b.code] || {};
        var pa = (qa.pct !== undefined && qa.pct !== null && !isNaN(qa.pct)) ? Number(qa.pct) : -Infinity;
        var pb = (qb.pct !== undefined && qb.pct !== null && !isNaN(qb.pct)) ? Number(qb.pct) : -Infinity;
        return sortOrder === 'asc' ? pa - pb : pb - pa;
      });
    }

    if ($('wlEmpty')) $('wlEmpty').hidden = displayList.length > 0;
    if ($('stockListHeader')) $('stockListHeader').hidden = displayList.length === 0;

    var watchlistHtml = displayList.map(function (w) {
      var q = quoteMap[w.code] || {};
      var pct = q.pct === undefined ? null : q.pct;
      var price = q.price === undefined ? null : q.price;
      var chg = q.chg !== undefined && q.chg !== null ? q.chg : (price !== null && q.prevClose ? price - q.prevClose : null);
      var name = w.name || q.name || w.code;
      var grp = w.group || '默认';
      var isOpen = expanded === w.code;
      var hasAlert = !!(alertsMap[w.code] && alertsMap[w.code].enabled !== false);
      var row = '<div class="stock' + (isOpen ? ' open' : '') + '" data-code="' + esc(w.code) + '">' +
        '<div class="line">' +
          '<div class="nm">' +
            esc(name) +
            '<span class="code">' + esc(w.code) + '</span>' +
            '<span class="groupTag" data-op="grp" title="点击更改分组">' + esc(grp) + '</span>' +
          '</div>' +
          '<div class="px ' + cls(pct) + '">' + fmtPrice(price) + '</div>' +
          '<div class="pcCol ' + cls(pct) + '">' +
            '<span class="pct">' + fmtPct(pct) + '</span>' +
            '<span class="chg">' + fmtChg(chg) + '</span>' +
          '</div>' +
          '<div class="ops">' +
            '<button data-op="buy" title="直接买入" style="color:#ff7b76;font-weight:bold;">买</button>' +
            '<button data-op="alert" class="btnAlert' + (hasAlert ? ' active' : '') + '" title="' + (hasAlert ? '已设置预警提醒（点击修改）' : '设置股价/涨跌预警提醒') + '">🔔</button>' +
            '<button data-op="grp" title="移动到分组" style="color:#8ab4f8;">组</button>' +
            '<button data-op="k" title="查看当日/历史K线" style="color:#fbbf24;">📈</button>' +
            '<button data-op="del" title="删除自选">✕</button>' +
          '</div>' +
        '</div>';

      if (isOpen) {
        row += '<div class="detail" data-detail="' + esc(w.code) + '">' +
          '<canvas></canvas>' +
          '<div class="grid" data-stats></div>' +
          '</div>';
      }
      row += '</div>';
      return row;
    }).join('');

    // 列表内容没变就只刷新展开的详情（不重建 DOM，保住 canvas 与事件监听）
    var rebuilt = setHtml(box, watchlistHtml);
    if (rebuilt) Array.prototype.forEach.call(box.querySelectorAll('.stock'), function (el) {
      var code = el.getAttribute('data-code');
      el.querySelector('.line').addEventListener('click', function (ev) {
        var opBtn = ev.target && ev.target.closest ? ev.target.closest('[data-op]') : null;
        if (opBtn) {
          ev.stopPropagation();
          var op = opBtn.getAttribute('data-op');
          if (op === 'buy') {
            var q = quoteMap[code] || {};
            openTxModal({ type: 1, code: code, name: q.name || code, price: q.price || 0, qty: 100 });
            return;
          }
          if (op === 'alert') {
            var q = quoteMap[code] || {};
            var item = watchlist.find(function (x) { return x.code === code; });
            var sName = (item && item.name) || q.name || code;
            openAlertModal(code, sName, q.price, q.pct);
            return;
          }
          if (op === 'grp') {
            openGroupModal('move', code, null);
            return;
          }
          if (op === 'k') {
            var itemK = watchlist.find(function (x) { return x.code === code; });
            var qK = quoteMap[code] || {};
            openKChart(code, (itemK && itemK.name) || qK.name || code);
            return;
          }
          if (op === 'del') {
            var q = quoteMap[code] || {};
            var item = watchlist.find(function (x) { return x.code === code; });
            var sName = (item && item.name) || q.name || code;
            showConfirm('确定将「' + sName + ' (' + code + ')」从自选股中删除吗？（它的预警提醒也会一并取消）', function () {
              if (S.watchlist && S.watchlist.remove) S.watchlist.remove(code);   // 同时会取消它的预警提醒
              if (expanded === code) expanded = null;
              reloadAlerts();
              renderGroupTabs();
              renderWatchlist();
              if (currentPosSummary) renderPositions(currentPosSummary);
            }, '删除自选', '确定删除');
            return;
          }
          return;
        }
        expanded = (expanded === code) ? null : code;
        renderWatchlist();
        if (expanded) hydrateDetail(code);
      });

      el.querySelector('.line').addEventListener('dblclick', function () {
        var mkt = /^[659]/.test(code) ? 'sh' : 'sz';
        if (S.host && S.host.openUrl) S.host.openUrl('https://quote.eastmoney.com/' + mkt + code + '.html');
      });
    });

    if (expanded) hydrateDetail(expanded);
  }

  function hydrateDetail(code) {
    var el = document.querySelector('.detail[data-detail="' + code + '"]');
    if (!el) return;
    var canvas = el.querySelector('canvas');
    var stats = el.querySelector('[data-stats]');
    var q = quoteMap[code] || {};
    loadTrend(code).then(function (data) {
      drawTrend(canvas, data, q);
      if (stats && !stats.getAttribute('data-filled')) {
        stats.setAttribute('data-filled', '1');
        renderStats(stats, q, data);
      }
    }).catch(function () {
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#93a4bd';
      ctx.font = '12px Microsoft YaHei';
      ctx.textAlign = 'center';
      ctx.fillText('分时数据获取失败，稍后自动重试', canvas.clientWidth / 2, 54);
    });
    loadDetail(code).then(function (d) {
      if (stats) { stats.removeAttribute('data-filled'); renderStats(stats, Object.assign({}, q, d), trendCache[code] && trendCache[code].data); }
    }).catch(function () {});
  }

  function renderStats(box, q, trend) {
    var prev = (trend && trend.prevClose) || q.prevClose;
    var items = [
      ['今开', fmtPrice(q.open)], ['最高', fmtPrice(q.high)], ['最低', fmtPrice(q.low)],
      ['昨收', fmtPrice(prev)], ['成交量', q.volume === null || q.volume === undefined ? '--' : fmtBig(q.volume * 100) + '股'],
      ['成交额', fmtBig(q.amount)], ['换手率', q.turnover === null || q.turnover === undefined ? '--' : q.turnover + '%'],
      ['量比', q.volumeRatio === null || q.volumeRatio === undefined ? '--' : q.volumeRatio],
      ['市盈率', q.pe === null || q.pe === undefined ? '--' : q.pe]
    ];
    box.innerHTML = items.map(function (it) {
      return '<div><span>' + it[0] + '</span> <b>' + esc(it[1]) + '</b></div>';
    }).join('');
  }

  function drawTrend(canvas, data, q) {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 380;
    var h = canvas.clientHeight || 108;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var items = (data && data.items) || [];
    if (items.length < 2) {
      ctx.fillStyle = '#93a4bd';
      ctx.font = '12px Microsoft YaHei';
      ctx.textAlign = 'center';
      ctx.fillText(items.length ? '暂无足够分时数据' : '暂无分时数据（可能未开盘）', w / 2, h / 2);
      return;
    }
    var prev = (data && data.prevClose) || (q && q.prevClose) || items[0].price;
    var prices = items.map(function (x) { return x.price; });
    var min = Math.min.apply(null, prices.concat([prev]));
    var max = Math.max.apply(null, prices.concat([prev]));
    if (max - min < 1e-6) { max += 0.01; min -= 0.01; }
    var padY = (max - min) * 0.12;
    min -= padY; max += padY;
    var y = function (v) { return h - ((v - min) / (max - min)) * h; };
    var x = function (i) { return (i / (items.length - 1)) * w; };

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    var prevY = Math.round(y(prev)) + 0.5;
    ctx.moveTo(0, prevY); ctx.lineTo(w, prevY);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = '#4facfe';
    ctx.lineWidth = 1.5;
    items.forEach(function (it, i) {
      var px = x(i), py = y(it.price);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    var grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(79,172,254,0.3)');
    grad.addColorStop(1, 'rgba(79,172,254,0.0)');
    ctx.fillStyle = grad;
    ctx.fill();
  }

  /* ---------------- Tab 切换 ---------------- */
  function switchTab(tab) {
    expandWindow();
    activeTab = tab;
    var tabs = ['positions', 'closed', 'watchlist', 'settings'];
    tabs.forEach(function (t) {
      var btn = $('tab' + t.charAt(0).toUpperCase() + t.slice(1));
      var view = $('view' + t.charAt(0).toUpperCase() + t.slice(1));
      if (btn) btn.classList.toggle('active', t === tab);
      if (view) view.hidden = (t !== tab);
    });

    if (tab === 'settings') {
      fillSettings();
    } else {
      if (tab === 'positions' && S.positions && typeof S.positions.getLocal === 'function') {
        try {
          var lp = S.positions.getLocal();
          if (lp) renderPositions(lp);
        } catch (e) {}
      } else if (tab === 'closed') {
        renderClosed(closedData);
      } else if (tab === 'watchlist') {
        renderWatchlist();
      }
      refresh().catch(function () {});
    }
  }

  /* ---------------- 悬浮球控制 ---------------- */
  function isBallAlive() {
    if (S.host && typeof S.host.isBallAlive === 'function') {
      return S.host.isBallAlive();
    }
    var hb = null;
    try { hb = S.store && S.store.getHeartbeat(); } catch (e) { hb = null; }
    return !!(hb && hb.id && !hb.closed && Date.now() - hb.t < 15000);
  }

  function updateBallBtnState() {
    var btn = $('btnToggleBall');
    if (!btn) return;
    if (isBallAlive()) {
      btn.textContent = '🔴 关闭悬浮球';
      btn.classList.add('active');
    } else {
      btn.textContent = '🟢 桌面悬浮球';
      btn.classList.remove('active');
    }
  }

  function toggleBall() {
    if (isBallAlive()) {
      if (S.host && S.host.ball) S.host.ball('hide');
    } else {
      if (S.host && S.host.ball) {
        S.host.ball('show');
        setTimeout(function () { updateBallBtnState(); }, 500);
      }
    }
    setTimeout(updateBallBtnState, 600);
  }

  /* ---------------- 通用确认对话框 (替代系统 confirm) ---------------- */
  var confirmCallback = null;
  function showConfirm(msg, onOk, title, okText) {
    confirmCallback = onOk;
    if ($('confirmTitle')) $('confirmTitle').textContent = title || '确认操作';
    if ($('confirmMsg')) $('confirmMsg').textContent = msg || '确定要执行此操作吗？';
    if ($('btnConfirmOk')) $('btnConfirmOk').textContent = okText || '确定删除';
    $('confirmModal').hidden = false;
  }
  function closeConfirm() {
    $('confirmModal').hidden = true;
    confirmCallback = null;
  }

  /* ---- 数量规则：100 整数倍 + 卖出不超过可卖（T+1） ---- */
  function txSellableNow() {
    if (txType !== 2) return null;
    try {
      var c = ($('txCode') ? $('txCode').value : '').replace(/[^\d]/g, '');
      if (!c || c.length < 6) return null;
      if (S.transactions && typeof S.transactions.sellable === 'function') {
        var v = Number(S.transactions.sellable(c));
        return isFinite(v) ? v : null;
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  /* 失焦/提交前把数量规范成 100 整数倍并压到可卖上限；输入过程中不打扰 */
  function snapTxQty() {
    var el = $('txQty');
    if (!el) return;
    var v = parseInt(el.value, 10);
    if (!v || v <= 0) return;
    var s = txSellableNow();
    var exactOdd = (s !== null && v === s && s % 100 !== 0); // 零股一次性清仓
    if (v % 100 !== 0 && !exactOdd) v = Math.floor(v / 100) * 100 || 100;
    if (s !== null && v > s) {
      var f = Math.floor(s / 100) * 100;
      v = f >= 100 ? f : s; // 可卖不足 100 时只能整笔清掉零股（s 可为 0）
    }
    el.value = String(v);
  }

  /* ---------------- 买卖交易弹窗 ---------------- */
  function openTxModal(opts) {
    var o = opts || {};
    txType = o.type || 1;

    var codeInput = $('txCode');
    var nameInput = $('txName');
    var priceInput = $('txPrice');
    var qtyInput = $('txQty');
    var dateInput = $('txDate');
    var errorBox = $('txError');
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }

    codeInput.value = o.code || '';
    nameInput.value = o.name || '';
    priceInput.value = (o.price !== undefined && o.price !== null && o.price !== '') ? Number(o.price).toFixed(2) : '';
    if (qtyInput) {
      qtyInput.step = '100';
      qtyInput.min = '100';
      qtyInput.value = (o.qty && Number(o.qty) > 0) ? String(o.qty) : '100';
    }

    dateInput.value = new Date().toISOString();

    var hasStock = !!o.code;
    if ($('txTypeSwitch')) $('txTypeSwitch').style.display = 'flex';
    if ($('txCodeRow')) $('txCodeRow').style.display = hasStock ? 'none' : 'flex';

    updateTxTypeUI(hasStock ? (o.name || o.code) : null, o.code);
    calcTxTotal();

    if ($('txSuggest')) $('txSuggest').hidden = true;
    $('txModal').hidden = false;

    if (!hasStock) {
      setTimeout(function () { codeInput.focus(); }, 50);
    } else if (!o.price) {
      setTimeout(function () { priceInput.focus(); }, 50);
    } else {
      setTimeout(function () { qtyInput.focus(); }, 50);
    }
  }

  function closeTxModal() {
    $('txModal').hidden = true;
    if ($('txSuggest')) $('txSuggest').hidden = true;
    if ($('txError')) $('txError').hidden = true;
  }

  function updateTxTypeUI(stockName, stockCode) {
    var sName = stockName || ($('txName') ? $('txName').value : '');
    var sCode = stockCode || ($('txCode') ? $('txCode').value : '');
    var isBuy = txType === 1;
    if ($('txTypeBuy')) $('txTypeBuy').classList.toggle('active', isBuy);
    if ($('txTypeSell')) $('txTypeSell').classList.toggle('active', !isBuy);

    var titleEl = $('txModalTitle');
    if (titleEl) {
      titleEl.className = 'modalTitle ' + (isBuy ? 'text-up' : 'text-down');
      if (sName) {
        titleEl.innerHTML = (isBuy ? '买入 ' : '卖出 ') + esc(sName) + (sCode ? ' <small style="font-size:12px;color:#a0aec0;font-weight:normal;">(' + esc(sCode) + ')</small>' : '');
      } else {
        titleEl.textContent = isBuy ? '买入股票' : '卖出股票';
      }
    }

    var submitBtn = $('btnTxSubmit');
    if (submitBtn) {
      submitBtn.className = isBuy ? 'btn-buy' : 'btn-sell';
      submitBtn.textContent = '确定';
    }
    // 卖出上限：100 整数倍 且不超过可卖（store.getSellable，含 T+1）
    var qtyEl = $('txQty');
    var hintEl = $('txSellable');
    var sellable = null;
    if (!isBuy && String(sCode || '').replace(/[^\d]/g, '').length >= 6) {
      try {
        if (S.transactions && typeof S.transactions.sellable === 'function') sellable = Number(S.transactions.sellable(sCode));
      } catch (e) { sellable = null; }
    }
    if (qtyEl) {
      if (sellable !== null && isFinite(sellable)) qtyEl.max = String(sellable);
      else delete qtyEl.max;
    }
    if (hintEl) {
      if (sellable !== null && isFinite(sellable)) {
        hintEl.hidden = false;
        hintEl.textContent = '可卖 ' + sellable + ' 股（100股整数倍，今日买入次日可卖）';
      } else {
        hintEl.hidden = true;
      }
    }
    if (sellable !== null && isFinite(sellable)) snapTxQty();
    calcTxTotal();
  }

  function calcTxTotal() {
    var p = parseFloat($('txPrice').value) || 0;
    var q = parseInt($('txQty').value, 10) || 0;
    var code = ($('txCode').value || '').trim();
    var amount = p * q;

    var feeRes = null;
    if (typeof S.calculateFees === 'function') {
      feeRes = S.calculateFees({ stock_code: code, type: txType, price: p, quantity: q });
    } else {
      feeRes = {
        amount: Math.round(amount * 100) / 100,
        commission: 0,
        transfer_fee: 0,
        stamp_tax: 0,
        total_fees: 0,
        total_price: Math.round(amount * 100) / 100
      };
    }

    if ($('txTradeAmount')) $('txTradeAmount').textContent = '¥' + (amount > 0 ? amount.toFixed(2) : '0.00');
    if ($('txFeeAmount')) $('txFeeAmount').textContent = '¥' + (feeRes.total_fees > 0 ? feeRes.total_fees.toFixed(2) : '0.00');
    if ($('txFeeDetail')) {
      $('txFeeDetail').textContent = '佣金 ¥' + feeRes.commission.toFixed(2) + ' · 过户费 ¥' + feeRes.transfer_fee.toFixed(2) + ' · 印花税 ¥' + feeRes.stamp_tax.toFixed(2);
    }
    if ($('txTotalLabel')) {
      $('txTotalLabel').textContent = (txType === 1 ? '实付金额' : '实得金额');
    }
    if ($('txTotalVal')) {
      $('txTotalVal').textContent = '¥' + (feeRes.total_price > 0 ? feeRes.total_price.toFixed(2) : '0.00');
    }
    if ($('txTotal')) {
      $('txTotal').value = feeRes.total_price > 0 ? feeRes.total_price.toFixed(2) : '';
    }
  }

  function showTxError(msg) {
    var errorBox = $('txError');
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    }
  }

  function submitTx() {
    var code = $('txCode').value.trim().replace(/[^\d]/g, '');
    var name = $('txName').value.trim() || code;
    var price = parseFloat($('txPrice').value);
    var qty = parseInt($('txQty').value, 10);
    var dt = $('txDate').value;

    if (!code || code.length < 6) {
      showTxError('请输入有效的6位股票代码');
      if ($('txCodeRow') && $('txCodeRow').style.display !== 'none') $('txCode').focus();
      return;
    }
    if (!price || price <= 0) {
      showTxError('请输入有效的成交单价');
      $('txPrice').focus();
      return;
    }
    if (!qty || qty <= 0) {
      showTxError('请输入有效的成交股数');
      $('txQty').focus();
      return;
    }
    // 卖出不得超过可卖（含 T+1：今天买入的明天才能卖），且买卖必须是 100 整数倍（零股一次性清仓除外）
    var sellable = null;
    if (txType === 2) {
      try {
        if (S.transactions && typeof S.transactions.sellable === 'function') sellable = Number(S.transactions.sellable(code));
      } catch (e) { sellable = null; }
    }
    if (sellable !== null && isFinite(sellable) && qty > sellable) {
      showTxError('卖出 ' + qty + ' 股超过可卖 ' + sellable + ' 股' + (sellable === 0 ? '（今天买入的要到下一个交易日才能卖）' : ''));
      $('txQty').focus();
      return;
    }
    if (qty % 100 !== 0 && qty !== sellable) {
      showTxError('买卖股数必须是 100 的整数倍');
      $('txQty').focus();
      return;
    }

    var feeRes = (typeof S.calculateFees === 'function') ? S.calculateFees({
      stock_code: code,
      type: txType,
      price: price,
      quantity: qty
    }) : { amount: price * qty, commission: 0, transfer_fee: 0, stamp_tax: 0, total_price: price * qty };

    var item = {
      stock_code: code,
      stock_name: name,
      type: txType,
      price: price,
      quantity: qty,
      amount: feeRes.amount,
      commission: feeRes.commission,
      transfer_fee: feeRes.transfer_fee,
      stamp_tax: feeRes.stamp_tax,
      total_price: feeRes.total_price,
      created_at: dt ? new Date(dt).toISOString() : new Date().toISOString()
    };

    if (S.transactions && typeof S.transactions.add === 'function') {
      try {
        S.transactions.add(item);
      } catch (err) {
        showTxError((err && err.message) || '保存失败');
        return;
      }
    }
    closeTxModal();
    refresh().catch(function () {});
  }

  /* ---------------- 股票交易流水时间线与做T核算 ---------------- */
  var DT_MAX_VISIBLE_DAYS = 10;
  var activeTimelineDate = null;
  var dtChartScrollOffset = null;
  var dtChartTimeline = null;
  var dtChartOnSelectDate = null;
  var dtChartIsDragging = false;
  var dtChartDragStartX = 0;
  var dtChartDragStartOffset = 0;
  var dtChartHasMoved = false;
  var dtChartEventsBound = false;
  var dtChartBarRects = [];

  function computeStockDailyTimeline(list) {
    if (!list || !list.length) return [];
    var sorted = list.slice().sort(function (a, b) {
      return new Date(a.created_at) - new Date(b.created_at);
    });

    var dateMap = new Map();
    sorted.forEach(function (t) {
      var d = String(t.created_at || '').slice(0, 10);
      if (!dateMap.has(d)) dateMap.set(d, []);
      dateMap.get(d).push(t);
    });

    var timeline = [];
    var runningQty = 0;
    var totalBuyCost = 0;
    var totalSellAmt = 0;
    var prevCostPrice = 0;

    dateMap.forEach(function (dayTxs, d) {
      var dayBuyQty = 0, dayBuyAmt = 0, dayBuyFees = 0;
      var daySellQty = 0, daySellAmt = 0, daySellFees = 0;

      dayTxs.forEach(function (t) {
        var q = Number(t.quantity) || 0;
        var p = Number(t.price) || 0;
        var amt = p * q; // 成交金额（不含手续费）
        var fee = (Number(t.commission || 0) + Number(t.transfer_fee || 0) + Number(t.stamp_tax || 0));
        if (Number(t.type) === 1) {
          dayBuyQty += q;
          dayBuyAmt += amt;
          dayBuyFees += fee;
        } else {
          daySellQty += q;
          daySellAmt += amt;
          daySellFees += fee;
        }
      });

      var dayFees = dayBuyFees + daySellFees;
      var tQty = Math.min(dayBuyQty, daySellQty);
      var excessSellQty = Math.max(0, daySellQty - tQty);
      var dayBuyAvg = dayBuyQty > 0 ? (dayBuyAmt / dayBuyQty) : 0;
      var daySellAvg = daySellQty > 0 ? (daySellAmt / daySellQty) : 0;
      // 手续费按股数摊入：买入含费均价 = 买入均价 + 买入费/股；卖出净均价 = 卖出均价 - 卖出费/股
      // 这样价差中已经恰好扣减一次手续费，不能再额外减 dayFees（否则重复扣费）
      var costBuyAvg = dayBuyQty > 0 ? (dayBuyAvg + dayBuyFees / dayBuyQty) : 0;
      var netSellAvg = daySellQty > 0 ? (daySellAvg - daySellFees / daySellQty) : 0;

      // ① 日内做T盈亏：只统计当日买卖对倒的 tQty 股（与同花顺口径一致）
      //    不含税费 = (卖出均价 - 买入均价) * tQty；扣税费 = 不含税费 - 对倒双边手续费
      var dayTPnLGross = tQty > 0 ? (daySellAvg - dayBuyAvg) * tQty : 0;
      var dayTPnL = tQty > 0 ? (netSellAvg - costBuyAvg) * tQty : 0;

      // ② 超出对倒部分的卖出 = 纯减仓，按持仓成本核算已实现盈亏（净卖出价已含税费）
      //    不能混进做T盈亏，否则会和同花顺的T盈亏差很多
      var daySellPnL = 0;
      var reduceQty = tQty > 0 ? excessSellQty : daySellQty;
      if (reduceQty > 0) {
        daySellPnL = (netSellAvg - prevCostPrice) * reduceQty;
      }
      // 当日已实现总盈亏（做T + 减仓），仅用于图表配色
      var dayRealizedPnL = dayTPnL + daySellPnL;

      runningQty = runningQty + dayBuyQty - daySellQty;
      // 摊薄成本基础：买入含手续费、卖出扣手续费（与持仓成本口径保持一致）
      totalBuyCost += dayBuyAmt + dayBuyFees;
      totalSellAmt += daySellAmt - daySellFees;
      var netCost = totalBuyCost - totalSellAmt;
      var currentCostPrice = runningQty > 0 ? Math.max(0, netCost / runningQty) : 0;
      prevCostPrice = currentCostPrice;

      timeline.push({
        date: d,
        displayDate: d.slice(5),
        holdingQty: runningQty,
        costPrice: Number(currentCostPrice.toFixed(3)),
        dayBuyQty: dayBuyQty,
        dayBuyAmt: Number((dayBuyAmt + dayBuyFees).toFixed(2)),
        daySellQty: daySellQty,
        daySellAmt: Number((daySellAmt - daySellFees).toFixed(2)),
        tQty: tQty,
        excessSellQty: excessSellQty,
        dayTPnL: Number(dayTPnL.toFixed(2)),
        dayTPnLGross: Number(dayTPnLGross.toFixed(2)),
        daySellPnL: Number(daySellPnL.toFixed(2)),
        dayRealizedPnL: Number(dayRealizedPnL.toFixed(2)),
        dayFees: Number(dayFees.toFixed(2)),
        hasT: tQty > 0,
        hasSell: daySellQty > 0,
        isPureBuy: dayBuyQty > 0 && daySellQty === 0,
        txCount: dayTxs.length
      });
    });

    return timeline;
  }

  function bindDtChartEvents() {
    if (dtChartEventsBound) return;
    dtChartEventsBound = true;

    var canvas = $('dtChartCanvas');
    var tooltip = $('dtChartTooltip');
    if (!canvas || !tooltip) return;

    function getMetrics() {
      var w = canvas.clientWidth || 700;
      var padL = 20, padR = 48;
      var availW = Math.max(10, w - padL - padR);
      var N = dtChartTimeline ? dtChartTimeline.length : 0;
      var step = (N <= DT_MAX_VISIBLE_DAYS) ? (availW / Math.max(1, N)) : (availW / DT_MAX_VISIBLE_DAYS);
      var contentW = N * step;
      var maxScroll = Math.max(0, contentW - availW);
      return { w: w, padL: padL, padR: padR, availW: availW, N: N, step: step, maxScroll: maxScroll };
    }

    function handleHover(e, rect) {
      if (!dtChartTimeline || !dtChartTimeline.length || !dtChartBarRects || !dtChartBarRects.length) {
        if (tooltip) tooltip.hidden = true;
        return;
      }
      var m = getMetrics();
      var mx = e.clientX - rect.left;
      var my = e.clientY - rect.top;
      if (mx < m.padL || mx > m.w - m.padR) {
        if (tooltip) tooltip.hidden = true;
        return;
      }

      // 只有当鼠标真正落在某根柱子的柱体矩形内时才显示当天详情。
      // 柱子上方的空白、柱体下方的坐标区、柱子之间的空隙、以及成本均价折线（含圆点）都不触发。
      var hit = null;
      for (var i = 0; i < dtChartBarRects.length; i++) {
        var b = dtChartBarRects[i];
        var inBar = (mx >= b.x - 1 && mx <= b.x + b.w + 1 && my >= b.y - 1 && my <= b.y + b.h + 1);
        if (inBar) {
          hit = b;
          break;
        }
      }

      if (hit) {
        var item = hit.item;
        var rows = '';
        if (item.hasT) {
          var tCls = item.dayTPnL > 0 ? 'up' : (item.dayTPnL < 0 ? 'down' : 'flat');
          rows += '<div class="ttRow"><span>当日T操作盈亏:</span> <b class="' + tCls + '">' +
            (item.dayTPnL > 0 ? '+' : '') + item.dayTPnL.toFixed(2) + ' 元</b></div>' +
            '<div class="ttSub">不含税费 ' + (item.dayTPnLGross > 0 ? '+' : '') + item.dayTPnLGross.toFixed(2) +
            ' 元 · 对倒 ' + item.tQty + ' 股（已扣双边手续费）</div>';
        }
        if (item.daySellQty > 0 && (!item.hasT || item.excessSellQty > 0)) {
          var sCls = item.daySellPnL > 0 ? 'up' : (item.daySellPnL < 0 ? 'down' : 'flat');
          var sLabel = item.hasT ? ('当日减仓已实现 (' + item.excessSellQty + '股):') : '当日卖出盈亏:';
          rows += '<div class="ttRow"><span>' + sLabel + '</span> <b class="' + sCls + '">' +
            (item.daySellPnL > 0 ? '+' : '') + item.daySellPnL.toFixed(2) + ' 元</b></div>';
        }
        if (item.daySellQty === 0) {
          rows += '<div class="ttRow"><span>当日盈亏:</span> <b class="flat">¥0.00 (纯买入加仓)</b></div>';
        }

        tooltip.innerHTML =
          '<div class="ttDate">📅 ' + item.date + '</div>' +
          '<div class="ttRow"><span>当天持仓数量:</span> <b>' + item.holdingQty.toLocaleString() + ' 股</b></div>' +
          '<div class="ttRow"><span style="color:#fbbf24;">● 当天成本均价:</span> <b style="color:#fbbf24;">¥' + fmtPrice(item.costPrice) + '</b></div>' +
          rows +
          '<div class="ttSub">当日买入 ' + item.dayBuyQty + '股 · 卖出 ' + item.daySellQty + '股 · 手续费 ¥' + item.dayFees.toFixed(2) + '</div>';

        tooltip.hidden = false;
        var tipW = tooltip.offsetWidth || 180;
        var tipLeft = Math.max(tipW / 2 + 4, Math.min(m.w - tipW / 2 - 4, hit.cx));
        tooltip.style.left = tipLeft + 'px';
        tooltip.style.top = Math.max(16, Math.min(hit.y - 6, 70)) + 'px';

        if (!dtChartIsDragging) {
          canvas.style.cursor = 'pointer';
        }
      } else {
        tooltip.hidden = true;
        if (!dtChartIsDragging) {
          canvas.style.cursor = (dtChartTimeline.length > DT_MAX_VISIBLE_DAYS) ? 'grab' : 'default';
        }
      }
    }

    canvas.addEventListener('mousedown', function (e) {
      if (!dtChartTimeline || dtChartTimeline.length <= DT_MAX_VISIBLE_DAYS) return;
      dtChartIsDragging = true;
      dtChartDragStartX = e.clientX;
      dtChartDragStartOffset = dtChartScrollOffset || 0;
      dtChartHasMoved = false;
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', function (e) {
      if (dtChartIsDragging) {
        var dx = e.clientX - dtChartDragStartX;
        if (Math.abs(dx) > 3) dtChartHasMoved = true;
        var m = getMetrics();
        dtChartScrollOffset = Math.max(0, Math.min(m.maxScroll, dtChartDragStartOffset - dx));
        if (tooltip) tooltip.hidden = true;
        renderDtTimelineChart(dtChartTimeline, dtChartOnSelectDate);
        return;
      }

      if (!dtChartTimeline || !dtChartTimeline.length) return;
      var rect = canvas.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        // 鼠标已经离开图表区域：确保详情浮层立刻消失（不依赖 mouseleave，避免残留）
        if (tooltip) tooltip.hidden = true;
        return;
      }
      handleHover(e, rect);
    });

    window.addEventListener('mouseup', function () {
      if (dtChartIsDragging) {
        dtChartIsDragging = false;
        canvas.style.cursor = (dtChartTimeline && dtChartTimeline.length > DT_MAX_VISIBLE_DAYS) ? 'grab' : 'pointer';
      }
    });

    canvas.addEventListener('mouseleave', function () {
      if (!dtChartIsDragging && tooltip) {
        tooltip.hidden = true;
      }
    });

    canvas.addEventListener('wheel', function (e) {
      if (!dtChartTimeline || dtChartTimeline.length <= DT_MAX_VISIBLE_DAYS) return;
      e.preventDefault();
      var m = getMetrics();
      var delta = e.deltaX !== 0 ? e.deltaX : e.deltaY;
      dtChartScrollOffset = Math.max(0, Math.min(m.maxScroll, (dtChartScrollOffset || 0) + delta * 0.85));
      if (tooltip) tooltip.hidden = true;
      renderDtTimelineChart(dtChartTimeline, dtChartOnSelectDate);
    }, { passive: false });

    canvas.addEventListener('click', function (e) {
      if (dtChartHasMoved) {
        dtChartHasMoved = false;
        return;
      }
      if (!dtChartTimeline || !dtChartTimeline.length) return;
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var m = getMetrics();
      if (mx < m.padL || mx > m.w - m.padR) return;
      var virtualX = mx - m.padL + (dtChartScrollOffset || 0);
      var idx = Math.floor(virtualX / m.step);
      if (idx >= 0 && idx < m.N) {
        var hitItem = dtChartTimeline[idx];
        if (activeTimelineDate === hitItem.date) {
          activeTimelineDate = null;
        } else {
          activeTimelineDate = hitItem.date;
        }
        renderDtTimelineChart(dtChartTimeline, dtChartOnSelectDate);
        if (typeof dtChartOnSelectDate === 'function') {
          dtChartOnSelectDate(activeTimelineDate);
        }
      }
    });

    canvas.addEventListener('touchstart', function (e) {
      if (!dtChartTimeline || dtChartTimeline.length <= DT_MAX_VISIBLE_DAYS) return;
      if (e.touches.length === 1) {
        dtChartIsDragging = true;
        dtChartDragStartX = e.touches[0].clientX;
        dtChartDragStartOffset = dtChartScrollOffset || 0;
        dtChartHasMoved = false;
      }
    }, { passive: true });

    window.addEventListener('touchmove', function (e) {
      if (dtChartIsDragging && e.touches.length === 1) {
        var dx = e.touches[0].clientX - dtChartDragStartX;
        if (Math.abs(dx) > 3) dtChartHasMoved = true;
        var m = getMetrics();
        dtChartScrollOffset = Math.max(0, Math.min(m.maxScroll, dtChartDragStartOffset - dx));
        if (tooltip) tooltip.hidden = true;
        renderDtTimelineChart(dtChartTimeline, dtChartOnSelectDate);
      }
    }, { passive: true });

    window.addEventListener('touchend', function () {
      dtChartIsDragging = false;
    });
  }

  function renderDtTimelineChart(timeline, onSelectDate) {
    var chartBox = $('dtChartContainer');
    var canvas = $('dtChartCanvas');
    var tooltip = $('dtChartTooltip');
    if (!chartBox || !canvas || !tooltip) return;

    if (!timeline || !timeline.length) {
      chartBox.hidden = true;
      return;
    }
    chartBox.hidden = false;

    dtChartTimeline = timeline;
    dtChartOnSelectDate = onSelectDate;

    var MAX_VISIBLE_DAYS = DT_MAX_VISIBLE_DAYS;
    var N = timeline.length;
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 700;
    var h = canvas.clientHeight || 168;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var padL = 20, padR = 48, padT = 20, padB = 22;
    var availW = Math.max(10, w - padL - padR);
    var availH = Math.max(10, h - padT - padB);

    var step = (N <= MAX_VISIBLE_DAYS) ? (availW / Math.max(1, N)) : (availW / MAX_VISIBLE_DAYS);
    var contentW = N * step;
    var maxScroll = Math.max(0, contentW - availW);

    if (dtChartScrollOffset === null || dtChartScrollOffset === undefined) {
      dtChartScrollOffset = maxScroll; // 默认展示最新的 10 天
    }
    dtChartScrollOffset = Math.max(0, Math.min(maxScroll, dtChartScrollOffset));

    var hintEl = $('dtChartHint');
    if (hintEl) {
      if (N > MAX_VISIBLE_DAYS) {
        hintEl.textContent = '（共 ' + N + ' 天，当前显示 ' + MAX_VISIBLE_DAYS + ' 天，可按住左右拖动）';
      } else {
        hintEl.textContent = '（共 ' + N + ' 天）';
      }
    }

    canvas.style.cursor = (N > MAX_VISIBLE_DAYS) ? (dtChartIsDragging ? 'grabbing' : 'grab') : 'pointer';

    // 持仓股数最大值
    var maxQty = 0;
    timeline.forEach(function (d) { if (d.holdingQty > maxQty) maxQty = d.holdingQty; });
    if (maxQty <= 0) maxQty = 100;

    // 成本价范围（折线图双轴标尺）
    var validCosts = [];
    timeline.forEach(function (d) {
      if (d.costPrice > 0 && d.holdingQty > 0) validCosts.push(d.costPrice);
    });
    var minCost = validCosts.length ? Math.min.apply(null, validCosts) : 0;
    var maxCost = validCosts.length ? Math.max.apply(null, validCosts) : 10;
    var spanCost = maxCost - minCost;
    if (spanCost <= 0) spanCost = maxCost * 0.2 || 1;
    var pMin = Math.max(0, minCost - spanCost * 0.25);
    var pMax = maxCost + spanCost * 0.25;

    // 1. 顶部拖动滚动指示条（仅当交易日超过 10 天时显示）
    if (N > MAX_VISIBLE_DAYS) {
      var trackY = 4, trackH = 3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(padL, trackY, availW, trackH, 2);
      } else {
        ctx.rect(padL, trackY, availW, trackH);
      }
      ctx.fill();

      var thumbW = Math.max(22, Math.round((MAX_VISIBLE_DAYS / N) * availW));
      var thumbX = padL + (maxScroll > 0 ? (dtChartScrollOffset / maxScroll) * (availW - thumbW) : 0);
      ctx.fillStyle = 'rgba(79, 172, 254, 0.65)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(thumbX, trackY, thumbW, trackH, 2);
      } else {
        ctx.rect(thumbX, trackY, thumbW, trackH);
      }
      ctx.fill();
    }

    // 2. 底部基线
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, h - padB + 0.5);
    ctx.lineTo(w - padR, h - padB + 0.5);
    ctx.stroke();

    // 3. 右侧 Y 轴成本均价标尺
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px Microsoft YaHei';
    ctx.textAlign = 'left';
    ctx.fillText('成本', w - padR + 5, padT - 5);

    ctx.fillStyle = '#fbbf24';
    ctx.font = '9.5px tabular-nums Microsoft YaHei';
    ctx.fillText('¥' + pMax.toFixed(2), w - padR + 5, padT + 8);
    ctx.fillText('¥' + pMin.toFixed(2), w - padR + 5, h - padB - 2);

    // 4. 计算柱体与折线节点坐标
    var barW = Math.min(36, Math.max(10, step * 0.55));
    var barRects = [];
    var linePoints = [];

    timeline.forEach(function (item, i) {
      var cx = padL + i * step + step / 2 - dtChartScrollOffset;
      var bx = Math.round(cx - barW / 2);
      var ratio = Math.max(0, item.holdingQty / maxQty);
      var bh = Math.max(4, Math.round(ratio * availH));
      var by = h - padB - bh;

      var costRatio = (pMax === pMin) ? 0.5 : (item.costPrice - pMin) / (pMax - pMin);
      costRatio = Math.max(0, Math.min(1, costRatio));
      var costY = padT + (1 - costRatio) * availH;

      barRects.push({
        index: i,
        item: item,
        x: bx,
        y: by,
        w: barW,
        h: bh,
        cx: cx,
        costY: costY
      });

      if (item.costPrice > 0 && item.holdingQty > 0) {
        linePoints.push({
          index: i,
          cx: cx,
          cy: costY,
          item: item
        });
      }
    });

    dtChartBarRects = barRects;

    // 5. 限制在图表区域内部绘制（裁切越界柱状图与折线）
    ctx.save();
    ctx.beginPath();
    ctx.rect(padL, 0, availW, h);
    ctx.clip();

    // 5.1 绘制持仓数量柱状图
    barRects.forEach(function (b) {
      if (b.cx < padL - step || b.cx > w - padR + step) return;
      var item = b.item;
      var grad = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
      if (item.hasT) {
        if (item.dayTPnL > 0) {
          grad.addColorStop(0, '#ff5252');
          grad.addColorStop(1, '#b71c1c');
        } else {
          grad.addColorStop(0, '#20e0aa');
          grad.addColorStop(1, '#00796b');
        }
      } else if (item.hasSell) {
        grad.addColorStop(0, '#f6ad55');
        grad.addColorStop(1, '#c05621');
      } else {
        grad.addColorStop(0, '#4facfe');
        grad.addColorStop(1, '#0072ff');
      }

      ctx.fillStyle = grad;
      var r = Math.min(3, b.w / 2);
      ctx.beginPath();
      ctx.moveTo(b.x + r, b.y);
      ctx.lineTo(b.x + b.w - r, b.y);
      ctx.quadraticCurveTo(b.x + b.w, b.y, b.x + b.w, b.y + r);
      ctx.lineTo(b.x + b.w, b.y + b.h);
      ctx.lineTo(b.x, b.y + b.h);
      ctx.lineTo(b.x, b.y + r);
      ctx.quadraticCurveTo(b.x, b.y, b.x + r, b.y);
      ctx.closePath();
      ctx.fill();

      if (activeTimelineDate === item.date) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      var showLabel = (step >= 30) || (b.index % 2 === 0) || (activeTimelineDate === item.date);
      if (showLabel) {
        ctx.fillStyle = (activeTimelineDate === item.date) ? '#fff' : '#718096';
        ctx.font = '10px tabular-nums Microsoft YaHei';
        ctx.textAlign = 'center';
        ctx.fillText(item.displayDate, b.cx, h - 7);
      }
    });

    // 5.2 绘制成本均价折线图
    if (linePoints.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.shadowColor = 'rgba(251, 191, 36, 0.45)';
      ctx.shadowBlur = 5;
      for (var k = 0; k < linePoints.length; k++) {
        var lp = linePoints[k];
        if (k === 0) ctx.moveTo(lp.cx, lp.cy);
        else ctx.lineTo(lp.cx, lp.cy);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // 5.3 绘制成本均价数据节点
    linePoints.forEach(function (lp) {
      if (lp.cx < padL - 10 || lp.cx > w - padR + 10) return;
      var isActive = (activeTimelineDate === lp.item.date);
      var nodeR = isActive ? 5 : 3.5;

      ctx.beginPath();
      ctx.arc(lp.cx, lp.cy, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? '#ffffff' : '#1a202c';
      ctx.fill();
      ctx.strokeStyle = isActive ? '#f59e0b' : '#fbbf24';
      ctx.lineWidth = isActive ? 2.5 : 2;
      ctx.stroke();
    });

    ctx.restore();

    bindDtChartEvents();
  }

  /* ---------------- 交易明细弹窗 ---------------- */
  function openDtModal(code, name) {
    currentDtCode = code;
    activeTimelineDate = null;
    dtChartScrollOffset = null;
    dtChartIsDragging = false;
    dtChartBarRects = [];
    if ($('dtChartTooltip')) $('dtChartTooltip').hidden = true;

    $('dtModalTitle').textContent = (name || code) + ' (' + code + ') 交易明细流水';
    var list = (S.transactions && S.transactions.list(code)) || [];
    var totalBuyQty = 0, totalBuyAmt = 0, totalSellQty = 0, totalSellAmt = 0;
    list.forEach(function (t) {
      var q = Number(t.quantity) || 0;
      var amt = Number(t.total_price || (t.price * q)) || 0;
      if (Number(t.type) === 1) { totalBuyQty += q; totalBuyAmt += amt; }
      else { totalSellQty += q; totalSellAmt += amt; }
    });
    var remainQty = totalBuyQty - totalSellQty;
    $('dtSummary').innerHTML = '<span>买入总计: ' + totalBuyQty.toLocaleString() + '股 / ¥' + totalBuyAmt.toFixed(2) + '</span>' +
      '<span>卖出总计: ' + totalSellQty.toLocaleString() + '股 / ¥' + totalSellAmt.toFixed(2) + '</span>' +
      '<span style="font-weight:700;color:var(--text);">当前持仓: ' + remainQty.toLocaleString() + '股</span>';

    var timeline = computeStockDailyTimeline(list);

    function renderListItems(filteredDate) {
      var dtBox = $('dtList');
      var displayList = list.slice();
      if (filteredDate) {
        displayList = displayList.filter(function (t) {
          return String(t.created_at || '').slice(0, 10) === filteredDate;
        });
      }

      if (!displayList.length) {
        dtBox.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">' +
          (filteredDate ? '日期 ' + filteredDate + ' 无交易流水' : '暂无交易记录') +
        '</div>';
      } else {
        var sorted = displayList.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
        dtBox.innerHTML = sorted.map(function (t) {
          var isBuy = Number(t.type) === 1;
          var dateStr = (t.created_at || '').replace('T', ' ').slice(0, 16);
          var fees = (Number(t.commission || 0) + Number(t.transfer_fee || 0) + Number(t.stamp_tax || 0));
          var feeTag = fees > 0 ? (' <span style="font-size:11px;color:#f6ad55;">(手续费 ¥' + fees.toFixed(2) + ')</span>') : '';
          return '<div class="dtItem">' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span class="dtType ' + (isBuy ? 'buy' : 'sell') + '">' + (isBuy ? '买入' : '卖出') + '</span>' +
              '<span style="font-size:12px;color:var(--muted);">' + dateStr + '</span>' +
              feeTag +
            '</div>' +
            '<div style="font-variant-numeric:tabular-nums;font-size:13px;">' +
              '¥' + Number(t.price).toFixed(2) + ' × ' + t.quantity + '股 = <b>¥' + Number(t.total_price || (t.price * t.quantity)).toFixed(2) + '</b>' +
            '</div>' +
            '<button class="dtDel" data-id="' + t.id + '" title="删除此记录">删除</button>' +
          '</div>';
        }).join('');

        Array.prototype.forEach.call(dtBox.querySelectorAll('.dtDel'), function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            showConfirm('确定删除此条交易记录吗？删除后将重新核算持仓成本与盈亏。', function () {
              if (S.transactions && S.transactions.delete) S.transactions.delete(id);
              openDtModal(code, name);
              refresh().catch(function () {});
            });
          });
        });
      }
    }

    renderListItems(null);

    $('dtModal').hidden = false;
    setTimeout(function () {
      renderDtTimelineChart(timeline, function (selectedDate) {
        renderListItems(selectedDate);
      });
    }, 40);
  }

  function closeDtModal() {
    $('dtModal').hidden = true;
    currentDtCode = null;
    activeTimelineDate = null;
    dtChartScrollOffset = null;
    dtChartIsDragging = false;
    dtChartBarRects = [];
    if ($('dtChartTooltip')) $('dtChartTooltip').hidden = true;
  }

  /* ---------------- 股票搜索联想 ---------------- */
  function onInput(e) {
    var kw = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!kw) { $('suggest').hidden = true; $('suggest').innerHTML = ''; return; }
    searchTimer = setTimeout(function () {
      safeCall(function () { return S.search ? S.search(kw) : Promise.resolve([]); }).then(function (rows) {
        renderSuggest($('suggest'), rows, function (r) {
          if (S.watchlist && S.watchlist.add) {
            S.watchlist.add({
              code: r.code,
              secid: r.secid,
              name: r.name,
              group: activeGroup === 'all' ? '默认' : activeGroup
            });
          }
          $('kw').value = '';
          $('suggest').hidden = true;
          renderGroupTabs();
          refresh().catch(function () {});
        });
      }).catch(function () {});
    }, 220);
  }

  function onTxCodeInput(e) {
    var kw = e.target.value.trim();
    clearTimeout(txSearchTimer);
    if (!kw || kw.length < 2) { $('txSuggest').hidden = true; $('txSuggest').innerHTML = ''; return; }
    txSearchTimer = setTimeout(function () {
      safeCall(function () { return S.search ? S.search(kw) : Promise.resolve([]); }).then(function (rows) {
        renderSuggest($('txSuggest'), rows, function (r) {
          $('txCode').value = r.code;
          $('txName').value = r.name;
          $('txSuggest').hidden = true;
          safeCall(function () { return S.detail ? S.detail(r.code) : Promise.resolve(null); }).then(function (d) {
            if (d && d.price) { $('txPrice').value = Number(d.price).toFixed(2); calcTxTotal(); }
          }).catch(function () {});
        });
      }).catch(function () {});
    }, 220);
  }

  function renderSuggest(box, rows, onSelect) {
    if (!box) return;
    if (!rows || !rows.length) {
      box.innerHTML = '<div class="none">未找到匹配股票</div>';
      box.hidden = false;
      return;
    }
    box.innerHTML = rows.map(function (r, i) {
      return '<div class="item" data-i="' + i + '"><span><b>' + esc(r.name) + '</b> <span class="t">' + esc(r.code) + '</span></span><span class="t">' + esc(r.market || '') + '</span></div>';
    }).join('');
    box.hidden = false;
    Array.prototype.forEach.call(box.querySelectorAll('.item'), function (el) {
      el.addEventListener('click', function () {
        var idx = Number(el.getAttribute('data-i'));
        if (rows[idx]) onSelect(rows[idx]);
      });
    });
  }

  /* ---------------- 交易费率二次界面 ---------------- */
  function updateRateSummaryUI() {
    var isFreeFive = settings.freeFive !== false;
    var badge = $('rateBadgeFreeFive');
    if (badge) {
      badge.textContent = isFreeFive ? '免五' : '不免五';
      badge.className = 'rateBadge' + (isFreeFive ? '' : ' warn');
    }
    var desc = $('rateSummaryDesc');
    if (desc) {
      var sComm = settings.stockCommissionRate !== undefined ? settings.stockCommissionRate : 0.854;
      var eComm = settings.etfCommissionRate !== undefined ? settings.etfCommissionRate : 0.6;
      var tax = settings.stampTaxRate !== undefined ? settings.stampTaxRate : 5;
      var shFee = settings.shanghaiTransferFee !== undefined ? settings.shanghaiTransferFee : 0.1;
      desc.textContent = '股票万' + sComm + ' · ETF万' + eComm + ' · 印花税万' + tax + ' · 沪市过户万' + shFee;
    }
  }

  function openRateModal() {
    var modal = $('rateModal');
    if (!modal) return;
    var isFreeFive = settings.freeFive !== false;
    if ($('setFreeFive')) $('setFreeFive').checked = isFreeFive;
    if ($('txtFreeFive')) $('txtFreeFive').textContent = isFreeFive ? '免五' : '不免五';
    if ($('setStockComm')) $('setStockComm').value = String(settings.stockCommissionRate !== undefined ? settings.stockCommissionRate : 0.854);
    if ($('setEtfComm')) $('setEtfComm').value = String(settings.etfCommissionRate !== undefined ? settings.etfCommissionRate : 0.6);
    if ($('setShenzhenTransfer')) $('setShenzhenTransfer').value = String(settings.shenzhenTransferFee !== undefined ? settings.shenzhenTransferFee : 0);
    if ($('setShanghaiTransfer')) $('setShanghaiTransfer').value = String(settings.shanghaiTransferFee !== undefined ? settings.shanghaiTransferFee : 0.1);
    if ($('setStampTax')) $('setStampTax').value = String(settings.stampTaxRate !== undefined ? settings.stampTaxRate : 5);
    modal.hidden = false;
  }

  function closeRateModal() {
    var modal = $('rateModal');
    if (modal) modal.hidden = true;
  }

  function saveRateModal() {
    var freeFiveVal = $('setFreeFive') ? $('setFreeFive').checked : true;
    var stockCommVal = $('setStockComm') ? parseFloat($('setStockComm').value) || 0.854 : 0.854;
    var etfCommVal = $('setEtfComm') ? parseFloat($('setEtfComm').value) || 0.6 : 0.6;
    var szFeeVal = $('setShenzhenTransfer') ? parseFloat($('setShenzhenTransfer').value) || 0 : 0;
    var shFeeVal = $('setShanghaiTransfer') ? parseFloat($('setShanghaiTransfer').value) || 0.1 : 0.1;
    var taxVal = $('setStampTax') ? parseFloat($('setStampTax').value) || 5 : 5;

    if (S.settings && S.settings.patch) {
      S.settings.patch({
        freeFive: freeFiveVal,
        stockCommissionRate: stockCommVal,
        etfCommissionRate: etfCommVal,
        shenzhenTransferFee: szFeeVal,
        shanghaiTransferFee: shFeeVal,
        stampTaxRate: taxVal
      });
      settings = S.settings.get();
    }
    updateRateSummaryUI();
    closeRateModal();
    refresh().catch(function () {});
  }

  function resetRateModal() {
    if ($('setFreeFive')) $('setFreeFive').checked = true;
    if ($('txtFreeFive')) $('txtFreeFive').textContent = '免五';
    if ($('setStockComm')) $('setStockComm').value = '0.854';
    if ($('setEtfComm')) $('setEtfComm').value = '0.6';
    if ($('setShenzhenTransfer')) $('setShenzhenTransfer').value = '0';
    if ($('setShanghaiTransfer')) $('setShanghaiTransfer').value = '0.1';
    if ($('setStampTax')) $('setStampTax').value = '5';
  }

  /* ---------------- K线弹窗（当日K线 / 历史K线） ---------------- */
  function localDayStr(d) {
    var x = d || new Date();
    var m = x.getMonth() + 1;
    var day = x.getDate();
    return x.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }

  /* echarts 按需懒加载（插件根目录的 echarts.min.js），避免拖慢插件启动 */
  function flushEchartsWait() {
    var w = echartsWait;
    echartsWait = [];
    w.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
  }
  function ensureEcharts(cb) {
    if (typeof window.echarts !== 'undefined') { cb(); return; }
    echartsWait.push(cb);
    if (echartsLoad === 1) return;
    if (echartsLoad === 3) { flushEchartsWait(); return; }
    echartsLoad = 1;
    try {
      var s = document.createElement('script');
      s.src = 'echarts.min.js';
      s.onload = function () { echartsLoad = (typeof window.echarts !== 'undefined') ? 2 : 3; flushEchartsWait(); };
      s.onerror = function () { echartsLoad = 3; flushEchartsWait(); };
      (document.head || document.body).appendChild(s);
    } catch (e) { echartsLoad = 3; flushEchartsWait(); }
  }

  /* K线数据：按 代码|klt 缓存（当日60秒、历史5分钟），点开才拉，不进非交易时段闸门 */
  function loadKline(code, klt) {
    var key = code + '|' + klt;
    var hit = klineCache[key];
    var ttl = (klt === 101) ? 300000 : 60000;
    if (hit && Date.now() - hit.at < ttl) return Promise.resolve(hit.data);
    return rethrow(safeCall(function () {
      return S.kline ? S.kline(code, { klt: klt, lmt: (klt === 101 ? 500 : 400) }) : [];
    })).then(function (data) {
      var list = data || [];
      if (klt !== 101) {
        // 分钟K接口会带多天：只留今天的，周末/休市自然是空 → 界面给提示
        var today = localDayStr();
        list = list.filter(function (d) { return d && String(d.date).slice(0, 10) === today; });
      }
      klineCache[key] = { at: Date.now(), data: list };
      return list;
    });
  }

  function syncKTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kline-tab]'), function (t) {
      t.classList.toggle('active', Number(t.getAttribute('data-kline-tab')) === kChartState.klt);
    });
    if ($('kChartSub')) {
      $('kChartSub').textContent = (kChartState.klt === 101)
        ? '历史日K线 · 前复权 · 滚轮/拖动缩放'
        : '当日5分钟K线 · 前复权';
    }
  }

  function openKChart(code, name, klt) {
    if (!code) return;
    var modal = $('kChartModal');
    if (!modal) return;
    kChartState = { code: String(code), name: name || code, klt: Number(klt) || 5 };
    if ($('kChartTitle')) $('kChartTitle').textContent = (name || code) + ' (' + code + ')';
    syncKTabs();
    modal.hidden = false;
    renderKChart();
  }

  function closeKChart() {
    if (kChartInst) { try { kChartInst.dispose(); } catch (e) { /* ignore */ } kChartInst = null; }
    kChartState.code = null;
    var m = $('kChartModal');
    if (m) m.hidden = true;
  }

  function renderKChart() {
    var box = $('kChartBox');
    if (!box || !kChartState.code) return;
    var want = { code: kChartState.code, klt: kChartState.klt };
    box.innerHTML = '<div class="kEmpty">加载中…</div>';
    ensureEcharts(function () {
      if (typeof window.echarts === 'undefined') { box.innerHTML = '<div class="kEmpty">图表组件加载失败（echarts.min.js），请重进插件</div>'; return; }
      loadKline(want.code, want.klt).then(function (list) {
        if (!kChartState || kChartState.code !== want.code || kChartState.klt !== want.klt) return; // 用户已切走
        if (kChartInst) { try { kChartInst.dispose(); } catch (e) { /* ignore */ } kChartInst = null; }
        if (!list || !list.length) {
          box.innerHTML = '<div class="kEmpty">' + (want.klt === 101
            ? '历史K线数据获取失败，请稍后重试'
            : '当日暂无K线数据（非交易日或未开盘）') + '</div>';
          return;
        }
        box.innerHTML = '';
        var isDay = want.klt === 101;
        var cats = list.map(function (d) { return String(d.date); });
        var vals = list.map(function (d) { return [d.open, d.close, d.low, d.high]; });
        var startPct = Math.max(0, Math.round(100 - 120 / cats.length * 100));
        kChartInst = window.echarts.init(box);
        kChartInst.setOption({
          backgroundColor: 'transparent',
          tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'cross' },
            backgroundColor: 'rgba(14, 22, 38, 0.95)',
            borderColor: 'rgba(79, 172, 254, 0.45)',
            textStyle: { color: '#eaf1fb', fontSize: 12 },
            formatter: function (ps) {
              if (!ps || !ps.length) return '';
              var d = list[ps[0].dataIndex];
              if (!d) return '';
              var diff = d.close - d.open;
              var pv = d.open ? (diff / d.open * 100) : 0;
              var col = diff >= 0 ? '#ff5b56' : '#17c593';
              return '<b>' + esc(d.date) + '</b><br/>开 ' + fmtPrice(d.open) + ' · 收 ' + fmtPrice(d.close) +
                '<br/>高 ' + fmtPrice(d.high) + ' · 低 ' + fmtPrice(d.low) +
                '<br/><span style="color:' + col + '">' + (diff >= 0 ? '+' : '') + diff.toFixed(3) + '  ' + (pv >= 0 ? '+' : '') + pv.toFixed(2) + '%</span>';
            }
          },
          grid: { left: '6%', right: '3%', top: '6%', bottom: isDay ? '16%' : '8%' },
          xAxis: {
            type: 'category', data: cats, boundaryGap: true,
            axisLine: { lineStyle: { color: '#3a465c' } },
            axisTick: { show: false },
            axisLabel: { color: '#93a4bd', fontSize: 11, hideOverlap: true, formatter: function (v) { return isDay ? v.slice(5) : v.slice(11); } }
          },
          yAxis: {
            scale: true, position: 'right',
            axisLabel: { color: '#93a4bd', fontSize: 11 },
            splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } }
          },
          dataZoom: isDay ? [
            { type: 'inside', start: startPct, end: 100 },
            { show: true, type: 'slider', bottom: 2, height: 16, start: startPct, end: 100,
              backgroundColor: 'rgba(255, 255, 255, 0.04)', borderColor: 'rgba(255, 255, 255, 0.12)',
              fillerColor: 'rgba(79, 172, 254, 0.14)', textStyle: { color: '#93a4bd', fontSize: 10 } }
          ] : [{ type: 'inside', start: 0, end: 100 }],
          series: [{
            type: 'candlestick',
            data: vals,
            itemStyle: { color: '#ef232a', color0: '#14b143', borderColor: '#ef232a', borderColor0: '#14b143' }
          }]
        });
        setTimeout(function () { if (kChartInst) { try { kChartInst.resize(); } catch (e) { /* ignore */ } } }, 60);
      }).catch(function () {
        if (kChartState && kChartState.code === want.code) {
          box.innerHTML = '<div class="kEmpty">K线数据获取失败，请稍后重试</div>';
        }
      });
    });
  }

  /* ---------------- 已清仓（第三个视图：顶栏徽标 + 概览卡 + 表格列表，与我的持仓同款） ---------------- */
  function renderClosed(list) {
    var arr = (list || []).slice().sort(function (a, b) {
      return String(b.closed_at || '').localeCompare(String(a.closed_at || ''));
    });
    closedData = arr;
    var n = arr.length;
    // 顶栏徽标（按钮常驻，0 也显示）
    if ($('closedCountBadge')) $('closedCountBadge').textContent = String(n);
    // 概览三张卡（与持仓页同款）
    var sum = arr.reduce(function (s, p) { return s + (Number(p.profit_loss) || 0); }, 0);
    if ($('ovClosedCount')) $('ovClosedCount').textContent = n + ' 只';
    if ($('ovClosedPl')) {
      $('ovClosedPl').textContent = n ? ((sum > 0 ? '+' : '') + sum.toFixed(2)) : '¥ 0.00';
      $('ovClosedPl').className = 'ovValue ' + (n ? cls(sum) : 'flat');
    }
    if ($('ovClosedLast')) {
      $('ovClosedLast').textContent = n ? (arr[0].closed_at || '--') : '--';
      $('ovClosedLast').className = 'ovValue flat';
    }
    // 表头与空态（与持仓页一致：没数据就不显示表头）
    if ($('closedHeaderWrap')) $('closedHeaderWrap').hidden = (n === 0);
    if ($('closedEmpty')) $('closedEmpty').hidden = (n > 0);
    var box = $('closedList');
    if (!box) return;
    if (!n) { setHtml(box, ''); return; }
    var html = arr.map(function (p) {
      var v = Number(p.profit_loss) || 0;
      var vr = Number(p.profit_loss_rate) || 0;
      var c = v > 0 ? 'up' : (v < 0 ? 'down' : '');
      return '<div class="closedRow" data-code="' + esc(p.stock_code) + '" data-name="' + esc(p.stock_name) + '">' +
        '<div class="crName">' + esc(p.stock_name) + '<span class="posStockCode">' + esc(p.stock_code) + '</span></div>' +
        '<div class="crDate">' + esc(p.closed_at || '--') + '</div>' +
        '<div class="crPl ' + c + '">' + (v > 0 ? '+' : '') + v.toFixed(2) + ' <span>(' + (vr > 0 ? '+' : '') + vr.toFixed(2) + '%)</span></div>' +
        '<div class="crOps"><button class="btnSm" data-kact="k" title="查看当日/历史K线">📈 K线</button></div>' +
      '</div>';
    }).join('');
    if (setHtml(box, html)) {
      Array.prototype.forEach.call(box.querySelectorAll('.closedRow'), function (row) {
        var code = row.getAttribute('data-code');
        var nm = row.getAttribute('data-name');
        var kb = row.querySelector('[data-kact="k"]');
        if (kb) {
          kb.addEventListener('click', function (e) {
            e.stopPropagation();
            openKChart(code, nm);
          });
        }
      });
    }
  }

  /* ---------------- 股票预警提醒弹窗 ---------------- */
  function openAlertModal(code, name, price, pct) {
    var modal = $('alertModal');
    if (!modal) return;
    reloadAlerts();
    var a = alertsMap[code] || null;

    if ($('alertStockCode')) $('alertStockCode').value = code || '';
    if ($('alertStockName')) $('alertStockName').value = name || code || '';
    if ($('alertStockTitle')) $('alertStockTitle').textContent = (name || code) + ' (' + code + ') 预警';

    var pStr = (price !== undefined && price !== null && !isNaN(price) && Number(price) > 0) ? '¥' + Number(price).toFixed(2) : '--';
    var pctStr = (pct !== undefined && pct !== null && !isNaN(pct)) ? fmtPct(pct) : '--';
    if ($('alertStockSub')) $('alertStockSub').textContent = '最新价: ' + pStr + ' · 今日涨幅: ' + pctStr;

    if ($('alertHighPrice')) $('alertHighPrice').value = (a && a.high_price > 0) ? String(a.high_price) : '';
    if ($('alertLowPrice')) $('alertLowPrice').value = (a && a.low_price > 0) ? String(a.low_price) : '';
    if ($('alertHighChange')) $('alertHighChange').value = (a && a.high_change > 0) ? String(a.high_change) : '';
    if ($('alertLowChange')) $('alertLowChange').value = (a && a.low_change < 0) ? String(a.low_change) : '';
    if ($('alertInterval')) $('alertInterval').value = String((a && a.notification_interval) || 5);

    if ($('btnAlertDelete')) $('btnAlertDelete').hidden = !a;
    modal.hidden = false;
  }

  function closeAlertModal() {
    var modal = $('alertModal');
    if (modal) modal.hidden = true;
  }

  function saveAlertModal() {
    var code = $('alertStockCode') ? $('alertStockCode').value : '';
    var name = $('alertStockName') ? $('alertStockName').value : '';
    if (!code) return;

    var highPrice = $('alertHighPrice') ? parseFloat($('alertHighPrice').value) || 0 : 0;
    var lowPrice = $('alertLowPrice') ? parseFloat($('alertLowPrice').value) || 0 : 0;
    var highChange = $('alertHighChange') ? parseFloat($('alertHighChange').value) || 0 : 0;
    var lowChange = $('alertLowChange') ? parseFloat($('alertLowChange').value) || 0 : 0;
    var interval = $('alertInterval') ? parseInt($('alertInterval').value, 10) || 5 : 5;

    if (S.alerts && S.alerts.save) {
      S.alerts.save({
        stock_code: code,
        stock_name: name,
        high_price: highPrice,
        low_price: lowPrice,
        high_change: highChange,
        low_change: lowChange,
        notification_interval: interval,
        enabled: true
      });
    }
    reloadAlerts();
    closeAlertModal();
    renderWatchlist();
    if (currentPosSummary) renderPositions(currentPosSummary);
  }

  function deleteAlertModal() {
    var code = $('alertStockCode') ? $('alertStockCode').value : '';
    if (code && S.alerts && S.alerts.delete) {
      S.alerts.delete(code);
    }
    reloadAlerts();
    closeAlertModal();
    renderWatchlist();
    if (currentPosSummary) renderPositions(currentPosSummary);
  }

  /* ---------------- 设置面板 ---------------- */
  function fillSettings() {
    settings = (S.settings && S.settings.get()) || {};
    if ($('setRefresh')) $('setRefresh').value = String(settings.refreshSec || 5);
    var bSize = Math.round(settings.ballSize || 72);
    if ($('setBallSize')) $('setBallSize').value = String(bSize);
    if ($('valBallSize')) $('valBallSize').textContent = bSize + 'px';
    var op = Math.round((settings.ballOpacity !== undefined ? settings.ballOpacity : 0.95) * 100);
    if ($('setOpacity')) $('setOpacity').value = String(op);
    if ($('valOpacity')) $('valOpacity').textContent = op + '%';

    // 开机自动启动：状态来自主机 db（异步填充）
    if ($('setBootAutoStart')) {
      $('setBootAutoStart').checked = false;
      if (S.autostart && typeof S.autostart.isEnabled === 'function') {
        S.autostart.isEnabled().then(function (on) {
          if ($('setBootAutoStart')) $('setBootAutoStart').checked = !!on;
        }).catch(function () { /* ignore */ });
      }
    }

    // 填充持仓表格显示列配置
    var visCols = Array.isArray(settings.posColumns) ? settings.posColumns : ALL_POS_COLS;
    if ($('colCfgQty')) $('colCfgQty').checked = visCols.indexOf('qty') >= 0;
    if ($('colCfgPriceCost')) $('colCfgPriceCost').checked = visCols.indexOf('priceCost') >= 0;
    if ($('colCfgTodayPl')) $('colCfgTodayPl').checked = visCols.indexOf('todayPl') >= 0;
    if ($('colCfgPl')) $('colCfgPl').checked = visCols.indexOf('pl') >= 0;

    updateRateSummaryUI();
  }

  function saveSettings() {
    var bSizeVal = $('setBallSize') ? Number($('setBallSize').value) || 72 : 72;
    var opVal = $('setOpacity') ? Number($('setOpacity').value) / 100 : 0.95;

    var checkedCols = [];
    if ($('colCfgQty') && $('colCfgQty').checked) checkedCols.push('qty');
    if ($('colCfgPriceCost') && $('colCfgPriceCost').checked) checkedCols.push('priceCost');
    if ($('colCfgTodayPl') && $('colCfgTodayPl').checked) checkedCols.push('todayPl');
    if ($('colCfgPl') && $('colCfgPl').checked) checkedCols.push('pl');

    if (S.settings && S.settings.patch) {
      S.settings.patch({
        refreshSec: $('setRefresh') ? Number($('setRefresh').value) : 5,
        ballSize: bSizeVal,
        ballOpacity: opVal,
        posColumns: checkedCols
      });
      settings = S.settings.get();
    }
    // 开机自动启动随「保存设置」生效：写宿主官方名单 + 打开宿主开机启动（对称关闭）
    if ($('setBootAutoStart') && S.autostart && typeof S.autostart.set === 'function') {
      S.autostart.set($('setBootAutoStart').checked).catch(function () { /* ignore */ });
    }
    if (S.host && typeof S.host.setBallSize === 'function') {
      S.host.setBallSize(bSizeVal);
    }
    if (S.host && typeof S.host.setBallOpacity === 'function') {
      S.host.setBallOpacity(opVal);
    }
    var tip = $('saveTip');
    if (tip) {
      tip.hidden = false;
      setTimeout(function () { tip.hidden = true; }, 2600);
    }
    trendCache = {}; detailCache = {};
    if (currentPosSummary) {
      renderPositions(currentPosSummary);
    }
    refresh().catch(function () {});
    loopRefresh();
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 导航 Tab
    if ($('tabPositions')) $('tabPositions').addEventListener('click', function () { switchTab('positions'); });
    if ($('tabWatchlist')) $('tabWatchlist').addEventListener('click', function () { switchTab('watchlist'); });
    if ($('tabSettings')) $('tabSettings').addEventListener('click', function () { switchTab('settings'); });

    // 顶部工具栏
    if ($('btnToggleBall')) $('btnToggleBall').addEventListener('click', toggleBall);
    if ($('btnRefresh')) $('btnRefresh').addEventListener('click', function () { trendCache = {}; detailCache = {}; refresh(true).catch(function () {}); });

    // K线弹窗：关闭 / 点遮罩关闭 / 切换 当日K线-历史K线
    if ($('btnKClose')) $('btnKClose').addEventListener('click', closeKChart);
    if ($('kChartModal')) $('kChartModal').addEventListener('click', function (e) { if (e.target === $('kChartModal')) closeKChart(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-kline-tab]'), function (t) {
      t.addEventListener('click', function () {
        kChartState.klt = Number(t.getAttribute('data-kline-tab')) || 5;
        syncKTabs();
        renderKChart();
      });
    });

    // 已清仓：独立视图（和我的持仓/自选行情同款表格式展示）
    if ($('tabClosed')) $('tabClosed').addEventListener('click', function () { switchTab('closed'); });

    // 持仓交易按钮
    if ($('btnNewTxBuy')) $('btnNewTxBuy').addEventListener('click', function () { openTxModal({ type: 1, qty: 100 }); });
    if ($('btnNewTxSell')) $('btnNewTxSell').addEventListener('click', function () { openTxModal({ type: 2, qty: 100 }); });

    // 自选股搜索
    if ($('kw')) {
      $('kw').addEventListener('input', onInput);
      $('kw').addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { $('suggest').hidden = true; $('kw').blur(); }
      });
    }

    if ($('setBallSize')) {
      $('setBallSize').addEventListener('input', function () {
        var v = Number(this.value);
        if ($('valBallSize')) $('valBallSize').textContent = v + 'px';
        if (S.host && typeof S.host.setBallSize === 'function') {
          S.host.setBallSize(v);
        }
      });
    }

    if ($('setOpacity')) {
      $('setOpacity').addEventListener('input', function () {
        var v = Number(this.value);
        if ($('valOpacity')) $('valOpacity').textContent = v + '%';
        if (S.host && typeof S.host.setBallOpacity === 'function') {
          S.host.setBallOpacity(v / 100);
        }
      });
    }

    // 设置页面
    if ($('setFreeFive')) {
      $('setFreeFive').addEventListener('change', function () {
        if ($('txtFreeFive')) $('txtFreeFive').textContent = this.checked ? '免五' : '不免五';
      });
    }

    // 持仓显示列选择即时联动
    ['colCfgQty', 'colCfgPriceCost', 'colCfgTodayPl', 'colCfgPl'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('change', function () {
          var checkedCols = [];
          if ($('colCfgQty') && $('colCfgQty').checked) checkedCols.push('qty');
          if ($('colCfgPriceCost') && $('colCfgPriceCost').checked) checkedCols.push('priceCost');
          if ($('colCfgTodayPl') && $('colCfgTodayPl').checked) checkedCols.push('todayPl');
          if ($('colCfgPl') && $('colCfgPl').checked) checkedCols.push('pl');

          if (S.settings && S.settings.patch) {
            S.settings.patch({ posColumns: checkedCols });
            settings = S.settings.get();
          }
          if (currentPosSummary) {
            renderPositions(currentPosSummary);
          }
        });
      }
    });

    // 持仓表头自定义列菜单开关与交互
    function togglePosColMenu(e) {
      if (e) e.stopPropagation();
      var menu = $('posColDropdown');
      var btn = $('btnPosColMenu');
      if (!menu) return;
      var willOpen = menu.hidden;
      menu.hidden = !willOpen;
      if (btn) btn.classList.toggle('active', willOpen);
    }

    if ($('btnPosColMenu')) {
      $('btnPosColMenu').addEventListener('click', togglePosColMenu);
    }
    if ($('thOpsHeader')) {
      $('thOpsHeader').addEventListener('click', function (e) {
        if (e.target === $('btnPosColMenu') || ($('btnPosColMenu') && $('btnPosColMenu').contains(e.target))) {
          return;
        }
        togglePosColMenu(e);
      });
    }

    if ($('btnPosColClose')) {
      $('btnPosColClose').addEventListener('click', function (e) {
        e.stopPropagation();
        if ($('posColDropdown')) $('posColDropdown').hidden = true;
        if ($('btnPosColMenu')) $('btnPosColMenu').classList.remove('active');
      });
    }

    if ($('posColDropdown')) {
      $('posColDropdown').addEventListener('click', function (e) {
        e.stopPropagation();
      });
    }

    // 点击页面其他位置关闭自定义列菜单
    document.addEventListener('click', function (e) {
      var menu = $('posColDropdown');
      var btn = $('btnPosColMenu');
      var thOps = $('thOpsHeader');
      if (menu && !menu.hidden) {
        if (!menu.contains(e.target) &&
            e.target !== btn && !(btn && btn.contains(e.target)) &&
            e.target !== thOps && !(thOps && thOps.contains(e.target))) {
          menu.hidden = true;
          if (btn) btn.classList.remove('active');
        }
      }
    });

    if ($('btnPosColReset')) {
      $('btnPosColReset').addEventListener('click', function (e) {
        e.stopPropagation();
        ['colCfgQty', 'colCfgPriceCost', 'colCfgTodayPl', 'colCfgPl'].forEach(function (id) {
          if ($(id)) $(id).checked = true;
        });
        if (S.settings && S.settings.patch) {
          S.settings.patch({ posColumns: ALL_POS_COLS.slice() });
          settings = S.settings.get();
        }
        if (currentPosSummary) {
          renderPositions(currentPosSummary);
        }
      });
    }

    // 费率二次界面弹窗触发与关闭
    if ($('btnOpenRateModal')) $('btnOpenRateModal').addEventListener('click', openRateModal);
    if ($('btnOpenRateModalSub')) $('btnOpenRateModalSub').addEventListener('click', function (e) {
      e.stopPropagation();
      openRateModal();
    });
    if ($('btnRateClose')) $('btnRateClose').addEventListener('click', closeRateModal);
    if ($('btnRateCancel')) $('btnRateCancel').addEventListener('click', closeRateModal);
    if ($('btnRateDone')) $('btnRateDone').addEventListener('click', saveRateModal);
    if ($('btnRateReset')) $('btnRateReset').addEventListener('click', resetRateModal);

    if ($('btnSave')) $('btnSave').addEventListener('click', saveSettings);
    if ($('btnReset')) {
      $('btnReset').addEventListener('click', function () {
        if (S.settings && S.settings.patch) {
          S.settings.patch({
            defaultView: 'positions',
            refreshSec: 5,
            ballSize: 72,
            ballOpacity: 0.95,
            freeFive: true,
            stockCommissionRate: 0.854,
            etfCommissionRate: 0.6,
            shenzhenTransferFee: 0,
            shanghaiTransferFee: 0.1,
            stampTaxRate: 5,
            posColumns: ALL_POS_COLS.slice()
          });
          if (S.host && typeof S.host.setBallSize === 'function') {
            S.host.setBallSize(72);
          }
          if (S.host && typeof S.host.setBallOpacity === 'function') {
            S.host.setBallOpacity(0.95);
          }
          fillSettings();
          saveSettings();
        }
      });
    }

    // 录入弹窗
    if ($('btnTxClose')) $('btnTxClose').addEventListener('click', closeTxModal);
    if ($('btnTxCancel')) $('btnTxCancel').addEventListener('click', closeTxModal);
    if ($('txTypeBuy')) $('txTypeBuy').addEventListener('click', function () {
      txType = 1;
      if (!$('txQty').value || parseInt($('txQty').value, 10) <= 0) $('txQty').value = '100';
      updateTxTypeUI();
    });
    if ($('txTypeSell')) $('txTypeSell').addEventListener('click', function () {
      txType = 2;
      if (!$('txQty').value || parseInt($('txQty').value, 10) <= 0) $('txQty').value = '100';
      updateTxTypeUI();
    });
    if ($('txCode')) $('txCode').addEventListener('input', onTxCodeInput);
    if ($('txCode')) $('txCode').addEventListener('change', function () { updateTxTypeUI(); }); // 换代码后刷新可卖提示
    if ($('txPrice')) {
      $('txPrice').addEventListener('input', calcTxTotal);
      $('txPrice').addEventListener('change', calcTxTotal);
    }
    if ($('txQty')) {
      $('txQty').addEventListener('input', calcTxTotal);
      $('txQty').addEventListener('change', function () { snapTxQty(); calcTxTotal(); });
      $('txQty').addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          var cur = parseInt($('txQty').value, 10) || 0;
          $('txQty').value = Math.max(100, cur + 100);
          snapTxQty();
          calcTxTotal();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          var cur = parseInt($('txQty').value, 10) || 100;
          $('txQty').value = Math.max(100, cur - 100);
          snapTxQty();
          calcTxTotal();
        }
      });
    }
    if ($('btnQtyPlus')) {
      $('btnQtyPlus').addEventListener('click', function (e) {
        e.preventDefault();
        var cur = parseInt($('txQty').value, 10) || 0;
        $('txQty').value = Math.max(100, cur + 100);
        snapTxQty();
        calcTxTotal();
      });
    }
    if ($('btnQtyMinus')) {
      $('btnQtyMinus').addEventListener('click', function (e) {
        e.preventDefault();
        var cur = parseInt($('txQty').value, 10) || 100;
        $('txQty').value = Math.max(100, cur - 100);
        snapTxQty();
        calcTxTotal();
      });
    }
    if ($('btnTxSubmit')) $('btnTxSubmit').addEventListener('click', submitTx);

    // 交易明细流水弹窗
    if ($('btnDtClose')) $('btnDtClose').addEventListener('click', closeDtModal);
    if ($('btnDtDone')) $('btnDtDone').addEventListener('click', closeDtModal);

    // 股票预警提醒弹窗
    if ($('btnAlertClose')) $('btnAlertClose').addEventListener('click', closeAlertModal);
    if ($('btnAlertCancel')) $('btnAlertCancel').addEventListener('click', closeAlertModal);
    if ($('btnAlertSave')) $('btnAlertSave').addEventListener('click', saveAlertModal);
    if ($('btnAlertDelete')) $('btnAlertDelete').addEventListener('click', deleteAlertModal);
    if ($('alertModal')) {
      $('alertModal').addEventListener('click', function (e) {
        if (e.target === $('alertModal')) closeAlertModal();
      });
    }

    // 通用确认对话框
    if ($('btnConfirmClose')) $('btnConfirmClose').addEventListener('click', closeConfirm);
    if ($('btnConfirmCancel')) $('btnConfirmCancel').addEventListener('click', closeConfirm);
    if ($('btnConfirmOk')) $('btnConfirmOk').addEventListener('click', function () {
      var cb = confirmCallback;
      closeConfirm();
      if (typeof cb === 'function') cb();
    });

    // 自选股分组弹窗
    if ($('btnAddGroup')) $('btnAddGroup').addEventListener('click', function () { openGroupModal('create', null, null); });
    if ($('btnGroupModalClose')) $('btnGroupModalClose').addEventListener('click', closeGroupModal);
    if ($('btnGroupCancel')) $('btnGroupCancel').addEventListener('click', closeGroupModal);
    if ($('btnGroupSubmit')) $('btnGroupSubmit').addEventListener('click', submitGroupModal);
    if ($('btnGroupDelete')) $('btnGroupDelete').addEventListener('click', deleteCurrentGroup);
    if ($('groupInputName')) {
      $('groupInputName').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitGroupModal();
      });
    }

    // 持仓列表表头排序
    var posSortBtns = [
      { id: 'sortPosQty', field: 'qty' },
      { id: 'sortPosTodayPl', field: 'todayPl' },
      { id: 'sortPosPl', field: 'pl' }
    ];
    posSortBtns.forEach(function (item) {
      var el = $(item.id);
      if (el) {
        el.addEventListener('click', function () {
          togglePosSort(item.field);
        });
      }
    });

    // 自选行情列表表头排序
    if ($('sortWatchlistPx')) {
      $('sortWatchlistPx').addEventListener('click', function () { toggleSort('price'); });
    }
    if ($('sortWatchlistPct')) {
      $('sortWatchlistPct').addEventListener('click', function () { toggleSort('pct'); });
    }

    // 全局快捷键
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if ($('alertModal') && !$('alertModal').hidden) { closeAlertModal(); return; }
        if ($('rateModal') && !$('rateModal').hidden) { closeRateModal(); return; }
        if ($('groupModal') && !$('groupModal').hidden) { closeGroupModal(); return; }
        if ($('confirmModal') && !$('confirmModal').hidden) { closeConfirm(); return; }
        if ($('txModal') && !$('txModal').hidden) { closeTxModal(); return; }
        if ($('dtModal') && !$('dtModal').hidden) { closeDtModal(); return; }
        if ($('suggest') && !$('suggest').hidden) { $('suggest').hidden = true; return; }
        if ($('txSuggest') && !$('txSuggest').hidden) { $('txSuggest').hidden = true; return; }
      }
    });

    function handleCtlMsg(c) {
      if (!c) return;
      if (c.t === 'cmd' && c.cmd === 'open-settings') switchTab('settings');
      else if (c.t === 'cmd' && c.cmd === 'open-tx-modal') openTxModal({ type: 1 });
      else if (c.t === 'cmd' && c.cmd === 'switch-tab') {
        expandWindow();
        switchTab(c.tab || 'positions');
      }
      else if (c.t === 'alerts') {
        reloadAlerts();
        renderWatchlist();
        if (currentPosSummary) renderPositions(currentPosSummary);
      }
      else if (c.t === 'refresh') { refresh().catch(function () {}); }
    }
    if (typeof S.onCtl === 'function') {
      S.onCtl(handleCtlMsg);
    }
    window.addEventListener('sb-ctl', function (e) {
      if (e && e.detail) handleCtlMsg(e.detail);
    });
  }

  function expandWindow() {
    try {
      if (S.host && typeof S.host.setExpendHeight === 'function') {
        S.host.setExpendHeight(600);
      } else if (typeof utools !== 'undefined' && typeof utools.setExpendHeight === 'function') {
        utools.setExpendHeight(600);
      } else if (typeof ztools !== 'undefined' && typeof ztools.setExpendHeight === 'function') {
        ztools.setExpendHeight(600);
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    expandWindow();
    settings = (S.settings && S.settings.get()) || {};
    var initTab = settings.defaultView || 'positions';
    bindEvents();

    // 启动时检查：若持仓记录为 0，自动尝试从本地文件同步一次
    var syncFn = (S.syncFromFile) || (S.host && S.host.syncFromFile);
    if (syncFn) {
      try {
        var curTxs = (S.transactions && S.transactions.list && S.transactions.list().length) || 0;
        if (curTxs === 0) {
          syncFn();
        }
      } catch (e) {}
    }

    // 1. 【0毫秒即时呈现本地信息】绝不等待远程网络，秒开展示当前持仓与自选
    reloadAlerts();
    renderStatus();

    // 立即提取本地持仓并渲染
    try {
      if (S.positions && typeof S.positions.getLocal === 'function') {
        var localPos = S.positions.getLocal();
        if (localPos) renderPositions(localPos);
      } else {
        renderPositions({ count: 0, positions: [] });
      }
    } catch (e) {
      renderPositions({ count: 0, positions: [] });
    }

    // 立即提取本地自选股缓存并渲染
    try {
      if (S.quotes && typeof S.quotes.getLocal === 'function') {
        var localQuotes = S.quotes.getLocal();
        if (localQuotes && localQuotes.length) {
          quoteMap = {};
          localQuotes.forEach(function (x) { if (x && x.code) quoteMap[x.code] = x; });
        }
      }
    } catch (e) {}

    renderGroupTabs();
    renderWatchlist();
    switchTab(initTab);
    updateBallBtnState();

    // 延迟 500ms 唤起桌面悬浮球，确保主窗口完全撑开且稳定持有焦点
    setTimeout(function () {
      if (!isBallAlive() && S.host && typeof S.host.ball === 'function') {
        S.host.ball('show');
      }
    }, 500);

    // 2. 远程实时最新行情在后台异步静默拉取，互不等待，获取到哪个就更新哪个
    refresh().catch(function () {});
    loopRefresh();
    setInterval(renderStatus, 30000);
    setInterval(updateBallBtnState, 3000);
    // 延迟 300ms 再次确保窗口高度已撑开
    setTimeout(expandWindow, 300);
  }

  expandWindow();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

