/* 行情面板页面逻辑：持仓管理 + 自选股行情 + 买卖交易录入 */
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
  var activeTab = 'positions'; // positions | watchlist | settings
  var searchTimer = null;
  var txSearchTimer = null;
  var txType = 1; // 1: 买入, 2: 卖出
  var currentDtCode = null;

  /* ---------------- 小工具 ---------------- */
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
   * 行情每几秒刷新一次，但价格往往没变；无条件重写 innerHTML 会丢掉 canvas、拖拽状态和
   * 事件监听，并触发整块重排重绘，面板悬浮在桌面上时尤其明显。
   * 返回 true 表示本次确实重建了 DOM（需要重新绑定事件）。
   */
  function setHtml(el, html) {
    if (!el || el.__sbHtml === html) return false;
    el.__sbHtml = html;
    el.innerHTML = html;
    return true;
  }

  /* ---------------- 数据刷新（解耦独立更新，互不阻塞） ---------------- */
  function refresh(force) {
    // force === true（手动刷新按钮）：连非交易时段也强制重拉，透传给 preload 的 force 通道
    var fOpts = (force === true) ? { force: true } : undefined;
    // 1. 持仓实时行情（只请求持仓个股，拿到立刻更新持仓看板）
    var posP = safeCall(function () { return S.positions ? S.positions.get(fOpts) : Promise.resolve(null); })
      .then(function (summary) {
        if (summary) {
          renderPositions(summary);
        }
        return summary;
      }).catch(function () { return null; });

    // 2. 自选股行情（拿到立刻更新自选列表）
    var qP = safeCall(function () { return S.quotes ? S.quotes(fOpts) : Promise.resolve([]); })
      .then(function (list) {
        if (list && list.length) {
          quoteMap = {};
          list.forEach(function (x) { if (x && x.code) quoteMap[x.code] = x; });
          renderGroupTabs();
          renderList();
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

    return Promise.all([posP, qP, ixP]).then(function () {
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

  /* ---------------- 状态与指数 ---------------- */
  function renderStatus() {
    var st = {};
    try { st = S.marketStatus ? S.marketStatus() : { label: '--' }; } catch (e) { st = { label: '--' }; }
    var chip = $('statusChip');
    chip.textContent = st.label || '--';
    chip.className = 'chip' + (st.open ? '' : ' closed');
    var t = $('updateAt');
    if (!lastUpdate) t.textContent = failCount ? '行情获取失败，自动重试中…' : '加载中…';
    else t.textContent = '更新于 ' + timeStr(lastUpdate) + (failCount ? '（最近一次失败）' : '');
  }

  function renderIndexes() {
    var box = $('indexes');
    if (!idxList.length) { setHtml(box, ''); return; }
    setHtml(box, idxList.map(function (i) {
      return '<div class="idx"><span class="nm">' + esc(i.name) + '</span>' +
        '<span class="px ' + cls(i.pct) + '">' + fmtPrice(i.price) + '</span>' +
        '<span class="pc ' + cls(i.pct) + '">' + fmtPct(i.pct) + '</span></div>';
    }).join(''));
  }

  /* ---------------- 持仓股票渲染 ---------------- */
  function renderPositions(posSummary) {
    var summary = posSummary || { count: 0, totalMarketValue: 0, totalCost: 0, totalProfitLoss: 0, totalProfitLossRate: 0, todayProfitLoss: 0, positions: [] };
    var positions = summary.positions || [];

    // 总览卡片
    if ($('ovTotalMv')) $('ovTotalMv').textContent = '¥' + (summary.totalMarketValue || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if ($('ovTotalCost')) $('ovTotalCost').textContent = '¥' + (summary.totalCost || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    var pl = summary.totalProfitLoss || 0;
    var plRate = summary.totalProfitLossRate || 0;
    var elPl = $('ovTotalPl');
    var elPlRate = $('ovTotalPlRate');
    elPl.textContent = (pl > 0 ? '+' : '') + pl.toFixed(2);
    elPl.className = 'ovValue ' + cls(pl);
    elPlRate.textContent = '(' + (plRate > 0 ? '+' : '') + plRate.toFixed(2) + '%)';
    elPlRate.className = 'ovSub ' + cls(pl);

    var tdPl = summary.todayProfitLoss || 0;
    var elTodayPl = $('ovTodayPl');
    elTodayPl.textContent = (tdPl > 0 ? '+' : '') + tdPl.toFixed(2);
    elTodayPl.className = 'ovValue ' + cls(tdPl);

    $('posCountBadge').textContent = String(summary.count || 0);

    var wrap = $('posList');
    var empty = $('posEmpty');
    var activePositions = positions.filter(function (p) { return p.quantity > 0; });
    empty.hidden = activePositions.length > 0;

    var posHtml = activePositions.map(function (p) {
      var plCls = cls(p.profit_loss);
      var todayCls = cls(p.today_profit_loss);
      var chgCls = cls(p.change_percent);
      return '<div class="posCard" data-code="' + esc(p.stock_code) + '" data-name="' + esc(p.stock_name) + '" data-price="' + (p.current_price || 0) + '" data-qty="' + p.quantity + '">' +
        '<div class="posHead">' +
          '<div class="posTitle">' +
            esc(p.stock_name) +
            '<span class="posCode">' + esc(p.stock_code) + '</span>' +
          '</div>' +
          '<div class="posRight">' +
            '<span class="posPrice ' + chgCls + '">' + fmtPrice(p.current_price) + '</span>' +
            '<span class="posPct ' + chgCls + '">' + fmtPct(p.change_percent) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="posGrid">' +
          '<div class="pgItem"><span class="pgLabel">持仓股数</span><span class="pgVal">' + p.quantity.toLocaleString() + '</span></div>' +
          '<div class="pgItem"><span class="pgLabel">持仓市值</span><span class="pgVal">¥' + (p.market_value || 0).toFixed(2) + '</span></div>' +
          '<div class="pgItem"><span class="pgLabel">成本均价</span><span class="pgVal">¥' + fmtPrice(p.cost_price) + '</span></div>' +
          '<div class="pgItem"><span class="pgLabel">浮动盈亏</span><span class="pgVal ' + plCls + '">' + (p.profit_loss > 0 ? '+' : '') + p.profit_loss.toFixed(2) + '</span></div>' +
          '<div class="pgItem"><span class="pgLabel">盈亏比例</span><span class="pgVal ' + plCls + '">' + (p.profit_loss_rate > 0 ? '+' : '') + p.profit_loss_rate.toFixed(2) + '%</span></div>' +
          '<div class="pgItem"><span class="pgLabel">今日盈亏</span><span class="pgVal ' + todayCls + '">' + (p.today_profit_loss > 0 ? '+' : '') + p.today_profit_loss.toFixed(2) + '</span></div>' +
        '</div>' +
        '<div class="posFoot">' +
          '<span class="muted" style="font-size:11px;">总投入: ¥' + (p.total_cost || 0).toFixed(2) + '</span>' +
          '<div class="posActions">' +
            '<button class="btnSm buy" data-act="buy">+ 买入</button>' +
            '<button class="btnSm sell" data-act="sell">- 卖出</button>' +
            '<button class="btnSm" data-act="detail">流水</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // 内容没变就直接返回：不重建卡片、不重新绑定事件
    if (!setHtml(wrap, posHtml)) return;

    Array.prototype.forEach.call(wrap.querySelectorAll('.posCard'), function (card) {
      var code = card.getAttribute('data-code');
      var name = card.getAttribute('data-name');
      var price = Number(card.getAttribute('data-price')) || 0;
      var qty = Number(card.getAttribute('data-qty')) || 100;

      card.querySelector('[data-act="buy"]').addEventListener('click', function (e) {
        e.stopPropagation();
        openTxModal({ type: 1, code: code, name: name, price: price, qty: 100 });
      });
      card.querySelector('[data-act="sell"]').addEventListener('click', function (e) {
        e.stopPropagation();
        openTxModal({ type: 2, code: code, name: name, price: price, qty: 100 });
      });
      card.querySelector('[data-act="detail"]').addEventListener('click', function (e) {
        e.stopPropagation();
        openDtModal(code, name);
      });
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
        renderList();
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
      renderList();
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
      renderList();
    } else if (groupModalMode === 'move') {
      var targetG = $('groupSelectTarget').value;
      if (groupModalStockCode && S.watchlist && S.watchlist.setStockGroup) {
        S.watchlist.setStockGroup(groupModalStockCode, targetG);
      }
      closeGroupModal();
      renderGroupTabs();
      renderList();
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
      renderList();
    }
  }

  /* ---------------- 自选股列表渲染 ---------------- */
  var sortMode = 'none'; // 'none' | 'pct-desc' | 'pct-asc' | 'price-desc' | 'price-asc'
  var dragState = null;

  function getDisplayList() {
    watchlist = (S.watchlist && S.watchlist.get()) || [];
    var displayList = activeGroup === 'all'
      ? watchlist.slice()
      : watchlist.filter(function (w) { return (w.group || '默认') === activeGroup; });

    if (sortMode === 'pct-desc' || sortMode === 'pct-asc') {
      displayList.sort(function (a, b) {
        var qa = quoteMap[a.code] || {};
        var qb = quoteMap[b.code] || {};
        var pa = (qa.pct !== undefined && qa.pct !== null && !isNaN(qa.pct)) ? Number(qa.pct) : -Infinity;
        var pb = (qb.pct !== undefined && qb.pct !== null && !isNaN(qb.pct)) ? Number(qb.pct) : -Infinity;
        return sortMode === 'pct-desc' ? pb - pa : pa - pb;
      });
    } else if (sortMode === 'price-desc' || sortMode === 'price-asc') {
      displayList.sort(function (a, b) {
        var qa = quoteMap[a.code] || {};
        var qb = quoteMap[b.code] || {};
        var pa = (qa.price !== undefined && qa.price !== null && !isNaN(qa.price)) ? Number(qa.price) : -Infinity;
        var pb = (qb.price !== undefined && qb.price !== null && !isNaN(qb.price)) ? Number(qb.price) : -Infinity;
        return sortMode === 'price-desc' ? pb - pa : pa - pb;
      });
    }
    return displayList;
  }

  function updateSortIcon() {
    var iconPct = $('sortPctIcon');
    var colPct = $('sortPct');
    var iconPx = $('sortPriceIcon');
    var colPx = $('sortPrice');

    if (colPct) {
      if (sortMode === 'pct-desc') {
        if (iconPct) iconPct.textContent = '↓';
        colPct.classList.add('sorted-desc');
        colPct.classList.remove('sorted-asc');
      } else if (sortMode === 'pct-asc') {
        if (iconPct) iconPct.textContent = '↑';
        colPct.classList.add('sorted-asc');
        colPct.classList.remove('sorted-desc');
      } else {
        if (iconPct) iconPct.textContent = '⇅';
        colPct.classList.remove('sorted-desc', 'sorted-asc');
      }
    }

    if (colPx) {
      if (sortMode === 'price-desc') {
        if (iconPx) iconPx.textContent = '↓';
        colPx.classList.add('sorted-desc');
        colPx.classList.remove('sorted-asc');
      } else if (sortMode === 'price-asc') {
        if (iconPx) iconPx.textContent = '↑';
        colPx.classList.add('sorted-asc');
        colPx.classList.remove('sorted-desc');
      } else {
        if (iconPx) iconPx.textContent = '⇅';
        colPx.classList.remove('sorted-desc', 'sorted-asc');
      }
    }
  }

  function toggleSort(field) {
    if (field === 'pct') {
      if (sortMode === 'pct-desc') sortMode = 'pct-asc';
      else if (sortMode === 'pct-asc') sortMode = 'none';
      else sortMode = 'pct-desc';
    } else if (field === 'price') {
      if (sortMode === 'price-desc') sortMode = 'price-asc';
      else if (sortMode === 'price-asc') sortMode = 'none';
      else sortMode = 'price-desc';
    }
    updateSortIcon();
    renderList();
  }

  function renderList() {
    var box = $('list');
    var displayList = getDisplayList();

    $('empty').hidden = displayList.length > 0;

    var listHtml = displayList.map(function (w) {
      var q = quoteMap[w.code] || {};
      var pct = q.pct === undefined ? null : q.pct;
      var price = q.price === undefined ? null : q.price;
      var chg = q.chg !== undefined && q.chg !== null ? q.chg : (price !== null && q.prevClose ? price - q.prevClose : null);
      var name = w.name || q.name || w.code;
      var isOpen = expanded === w.code;
      var row = '<div class="stock' + (isOpen ? ' open' : '') + '" data-code="' + esc(w.code) + '" draggable="true">' +
        '<div class="line">' +
          '<div class="dragHandle" title="拖动排序">⠿</div>' +
          '<div class="nm">' +
            esc(name) +
            '<span class="code">' + esc(w.code) + '</span>' +
          '</div>' +
          '<div class="px ' + cls(pct) + '">' + fmtPrice(price) + '</div>' +
          '<div class="pcCol ' + cls(pct) + '">' +
            '<span class="pct">' + fmtPct(pct) + '</span>' +
            '<span class="chg">' + fmtChg(chg) + '</span>' +
          '</div>' +
          '<div class="ops">' +
            '<button data-op="buy" title="直接买入" style="color:#ff7b76;font-weight:bold;">买</button>' +
            '<button data-op="grp" title="移动到分组" style="color:#8ab4f8;">组</button>' +
            '<button data-op="del" title="删除">✕</button>' +
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

    // 列表内容没变就只刷新展开的详情；拖拽过程中不重建（否则会把正在拖的元素删掉）
    var rebuilt = !dragState && setHtml(box, listHtml);
    if (rebuilt) Array.prototype.forEach.call(box.querySelectorAll('.stock'), function (el) {
      var code = el.getAttribute('data-code');

      // 拖动排序事件
      el.addEventListener('dragstart', function (ev) {
        dragState = { code: code, el: el };
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', code); } catch (e) {}
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', function () {
        el.classList.remove('dragging');
        Array.prototype.forEach.call(box.querySelectorAll('.stock'), function (s) {
          s.classList.remove('drag-over');
        });
        dragState = null;
      });
      el.addEventListener('dragover', function (ev) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        if (dragState && dragState.code !== code) {
          el.classList.add('drag-over');
        }
      });
      el.addEventListener('dragleave', function () {
        el.classList.remove('drag-over');
      });
      el.addEventListener('drop', function (ev) {
        ev.preventDefault();
        el.classList.remove('drag-over');
        if (dragState && dragState.code !== code) {
          if (sortMode !== 'none') {
            sortMode = 'none';
            updateSortIcon();
          }
          if (S.watchlist && S.watchlist.reorder) {
            S.watchlist.reorder(dragState.code, code);
          }
          renderGroupTabs();
          renderList();
        }
      });

      el.querySelector('.line').addEventListener('click', function (ev) {
        // 点击拖动手柄不触发展开
        if (ev.target && ev.target.classList && ev.target.classList.contains('dragHandle')) return;
        var opBtn = ev.target && ev.target.closest ? ev.target.closest('[data-op]') : null;
        if (opBtn) {
          ev.stopPropagation();
          var op = opBtn.getAttribute('data-op');
          if (op === 'buy') {
            var q = quoteMap[code] || {};
            openTxModal({ type: 1, code: code, name: q.name || code, price: q.price || 0, qty: 100 });
            return;
          }
          if (op === 'grp') {
            openGroupModal('move', code, null);
            return;
          }
          if (op === 'del') {
            var itemName = (watchlist.find(function (x) { return x.code === code; }) || {}).name || code;
            showConfirm('确定要删除「' + itemName + '（' + code + '）」吗？（它的预警提醒也会一并取消）', function () {
              S.watchlist.remove(code);
              if (expanded === code) expanded = null;
              renderGroupTabs();
              renderList();
            }, '删除自选股', '确定删除');
            return;
          }
          return;
        }
        expanded = (expanded === code) ? null : code;
        renderList();
        if (expanded) hydrateDetail(code);
      });
      el.querySelector('.line').addEventListener('dblclick', function () {
        var mkt = /^[659]/.test(code) ? 'sh' : 'sz';
        S.host && S.host.openUrl('https://quote.eastmoney.com/' + mkt + code + '.html');
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
    activeTab = tab;
    $('tabPositions').classList.toggle('active', tab === 'positions');
    $('tabWatchlist').classList.toggle('active', tab === 'watchlist');

    $('viewPositions').hidden = tab !== 'positions';
    $('viewList').hidden = tab !== 'watchlist';
    $('viewSettings').hidden = tab !== 'settings';

    if (tab === 'settings') fillSettings();
    else refresh().catch(function () {});
  }

  /* ---------------- 辅助函数 ---------------- */
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    if ($('txTypeSwitch')) $('txTypeSwitch').style.display = hasStock ? 'none' : 'flex';
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
    var isBuy = txType === 1;
    if ($('txTypeBuy')) $('txTypeBuy').classList.toggle('active', isBuy);
    if ($('txTypeSell')) $('txTypeSell').classList.toggle('active', !isBuy);

    var titleEl = $('txModalTitle');
    if (titleEl) {
      titleEl.className = 'modalTitle ' + (isBuy ? 'text-up' : 'text-down');
      if (stockName) {
        titleEl.innerHTML = (isBuy ? '买入 ' : '卖出 ') + escapeHtml(stockName) + (stockCode ? ' <small style="font-size:12px;color:#a0aec0;font-weight:normal;">(' + escapeHtml(stockCode) + ')</small>' : '');
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
    var codeForLimit = stockCode || ($('txCode') ? $('txCode').value : '');
    var qtyEl = $('txQty');
    var hintEl = $('txSellable');
    var sellable = null;
    if (!isBuy && String(codeForLimit || '').replace(/[^\d]/g, '').length >= 6) {
      try {
        if (S.transactions && typeof S.transactions.sellable === 'function') sellable = Number(S.transactions.sellable(codeForLimit));
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
    if (typeof calcTxTotal === 'function') calcTxTotal();
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

  /* ---------------- 交易明细弹窗 ---------------- */
  function openDtModal(code, name) {
    currentDtCode = code;
    $('dtModalTitle').textContent = (name || code) + ' (' + code + ') 交易明细';
    var list = (S.transactions && S.transactions.list(code)) || [];
    var totalBuyQty = 0, totalBuyAmt = 0, totalSellQty = 0, totalSellAmt = 0;
    list.forEach(function (t) {
      var q = Number(t.quantity) || 0;
      var amt = Number(t.total_price || (t.price * q)) || 0;
      if (Number(t.type) === 1) { totalBuyQty += q; totalBuyAmt += amt; }
      else { totalSellQty += q; totalSellAmt += amt; }
    });
    var remainQty = totalBuyQty - totalSellQty;
    $('dtSummary').innerHTML = '<span>买入: ' + totalBuyQty + '股 / ¥' + totalBuyAmt.toFixed(2) + '</span>' +
      '<span>卖出: ' + totalSellQty + '股 / ¥' + totalSellAmt.toFixed(2) + '</span>' +
      '<span style="font-weight:700;">现余: ' + remainQty + '股</span>';

    var dtBox = $('dtList');
    if (!list.length) {
      dtBox.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">暂无交易记录</div>';
    } else {
      var sorted = list.slice().sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      dtBox.innerHTML = sorted.map(function (t) {
        var isBuy = Number(t.type) === 1;
        var dateStr = (t.created_at || '').replace('T', ' ').slice(0, 16);
        var fees = (Number(t.commission || 0) + Number(t.transfer_fee || 0) + Number(t.stamp_tax || 0));
        var feeTag = fees > 0 ? (' <span style="font-size:11px;color:#f6ad55;">(手续费 ¥' + fees.toFixed(2) + ')</span>') : '';
        return '<div class="dtItem">' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span class="dtType ' + (isBuy ? 'buy' : 'sell') + '">' + (isBuy ? '买入' : '卖出') + '</span>' +
            '<span style="font-size:11px;color:var(--muted);">' + dateStr + '</span>' +
            feeTag +
          '</div>' +
          '<div style="font-variant-numeric:tabular-nums;">' +
            '¥' + Number(t.price).toFixed(2) + ' × ' + t.quantity + '股 = <b>¥' + Number(t.total_price || (t.price * t.quantity)).toFixed(2) + '</b>' +
          '</div>' +
          '<button class="dtDel" data-id="' + t.id + '" title="删除此记录">删除</button>' +
        '</div>';
      }).join('');

      Array.prototype.forEach.call(dtBox.querySelectorAll('.dtDel'), function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-id');
          showConfirm('确定删除此条交易记录吗？删除后持仓成本和盈亏将会重新计算。', function () {
            if (S.transactions && S.transactions.delete) S.transactions.delete(id);
            openDtModal(code, name);
            refresh().catch(function () {});
          });
        });
      });
    }

    $('dtModal').hidden = false;
  }

  function closeDtModal() {
    $('dtModal').hidden = true;
    currentDtCode = null;
  }

  /* ---------------- 股票搜索联想 ---------------- */
  function onInput(e) {
    var kw = e.target.value.trim();
    clearTimeout(searchTimer);
    if (!kw) { $('suggest').hidden = true; $('suggest').innerHTML = ''; return; }
    searchTimer = setTimeout(function () {
      safeCall(function () { return S.search(kw); }).then(function (rows) {
        renderSuggest($('suggest'), rows, function (r) {
          var targetGrp = activeGroup === 'all' ? '默认' : activeGroup;
          S.watchlist.add({ code: r.code, secid: r.secid, name: r.name, group: targetGrp });
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
      safeCall(function () { return S.search(kw); }).then(function (rows) {
        renderSuggest($('txSuggest'), rows, function (r) {
          $('txCode').value = r.code;
          $('txName').value = r.name;
          $('txSuggest').hidden = true;
          safeCall(function () { return S.detail(r.code); }).then(function (d) {
            if (d && d.price) { $('txPrice').value = Number(d.price).toFixed(2); calcTxTotal(); }
          }).catch(function () {});
        });
      }).catch(function () {});
    }, 220);
  }

  function renderSuggest(box, rows, onSelect) {
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
    if ($('setOnTop')) $('setOnTop').checked = !!settings.panelOnTop;

    var isFreeFive = settings.freeFive !== false;
    if ($('setFreeFive')) $('setFreeFive').checked = isFreeFive;
    if ($('txtFreeFive')) $('txtFreeFive').textContent = isFreeFive ? '免五' : '不免五';
    if ($('setStockComm')) $('setStockComm').value = String(settings.stockCommissionRate !== undefined ? settings.stockCommissionRate : 0.854);
    if ($('setEtfComm')) $('setEtfComm').value = String(settings.etfCommissionRate !== undefined ? settings.etfCommissionRate : 0.6);
    if ($('setShenzhenTransfer')) $('setShenzhenTransfer').value = String(settings.shenzhenTransferFee !== undefined ? settings.shenzhenTransferFee : 0);
    if ($('setShanghaiTransfer')) $('setShanghaiTransfer').value = String(settings.shanghaiTransferFee !== undefined ? settings.shanghaiTransferFee : 0.1);
    if ($('setStampTax')) $('setStampTax').value = String(settings.stampTaxRate !== undefined ? settings.stampTaxRate : 5);
  }

  function saveSettings() {
    var bSizeVal = $('setBallSize') ? Number($('setBallSize').value) || 72 : 72;
    var opVal = $('setOpacity') ? Number($('setOpacity').value) / 100 : 0.95;
    S.settings.patch({
      refreshSec: $('setRefresh') ? Number($('setRefresh').value) : 5,
      ballSize: bSizeVal,
      ballOpacity: opVal,
      panelOnTop: $('setOnTop') ? $('setOnTop').checked : true,
      freeFive: $('setFreeFive') ? $('setFreeFive').checked : true,
      stockCommissionRate: $('setStockComm') ? parseFloat($('setStockComm').value) || 0.854 : 0.854,
      etfCommissionRate: $('setEtfComm') ? parseFloat($('setEtfComm').value) || 0.6 : 0.6,
      shenzhenTransferFee: $('setShenzhenTransfer') ? parseFloat($('setShenzhenTransfer').value) || 0 : 0,
      shanghaiTransferFee: $('setShanghaiTransfer') ? parseFloat($('setShanghaiTransfer').value) || 0.1 : 0.1,
      stampTaxRate: $('setStampTax') ? parseFloat($('setStampTax').value) || 5 : 5
    });
    if (S.host && typeof S.host.setBallSize === 'function') {
      S.host.setBallSize(bSizeVal);
    }
    if (S.host && typeof S.host.setBallOpacity === 'function') {
      S.host.setBallOpacity(opVal);
    }
    settings = S.settings.get();
    var tip = $('saveTip');
    tip.hidden = false;
    setTimeout(function () { tip.hidden = true; }, 2600);
    trendCache = {}; detailCache = {};
    refresh().catch(function () {});
    loopRefresh();
  }

  /* ---------------- 事件绑定 ---------------- */
  $('tabPositions').addEventListener('click', function () { switchTab('positions'); });
  $('tabWatchlist').addEventListener('click', function () { switchTab('watchlist'); });

  // 涨跌幅/价格表头排序由下方 toggleSort 绑定统一处理（此处不再重复绑定，避免一次点击触发两次切换）

  $('btnNewTxBuy').addEventListener('click', function () { openTxModal({ type: 1, qty: 100 }); });
  $('btnNewTxSell').addEventListener('click', function () { openTxModal({ type: 2, qty: 100 }); });
  $('btnBallFromPos').addEventListener('click', function () {
    var hb = null;
    try { hb = S.store && S.store.getHeartbeat(); } catch (e) { hb = null; }
    var alive = !!(hb && hb.id && Date.now() - hb.t < 15000);
    if (alive) S.host.ball('hide');
    else { S.host.ball('show'); setTimeout(function () { refresh().catch(function () {}); }, 800); }
  });

  $('btnRefresh').addEventListener('click', function () { trendCache = {}; detailCache = {}; refresh(true).catch(function () {}); });
  $('btnSettings').addEventListener('click', function () { switchTab(activeTab === 'settings' ? 'positions' : 'settings'); });
  $('btnClose').addEventListener('click', function () { (S.closeSelf || function () {})(); });
  $('btnBack').addEventListener('click', function () { switchTab('positions'); });
  if ($('setFreeFive')) {
    $('setFreeFive').addEventListener('change', function () {
      if ($('txtFreeFive')) $('txtFreeFive').textContent = this.checked ? '免五' : '不免五';
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
  $('btnSave').addEventListener('click', saveSettings);
  $('btnReset').addEventListener('click', function () {
    S.settings.patch({
      defaultView: 'positions',
      refreshSec: 5,
      ballSize: 72,
      ballOpacity: 0.95,
      panelOnTop: true,
      freeFive: true,
      stockCommissionRate: 0.854,
      etfCommissionRate: 0.6,
      shenzhenTransferFee: 0,
      shanghaiTransferFee: 0.1,
      stampTaxRate: 5
    });
    if (S.host && typeof S.host.setBallSize === 'function') {
      S.host.setBallSize(72);
    }
    if (S.host && typeof S.host.setBallOpacity === 'function') {
      S.host.setBallOpacity(0.95);
    }
    fillSettings();
    saveSettings();
  });
  if ($('sortPct')) $('sortPct').addEventListener('click', function () { toggleSort('pct'); });
  if ($('sortPrice')) $('sortPrice').addEventListener('click', function () { toggleSort('price'); });

  $('kw').addEventListener('input', onInput);
  $('kw').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { $('suggest').hidden = true; $('kw').blur(); }
  });
  $('btnBall').addEventListener('click', function () {
    var hb = null;
    try { hb = S.store && S.store.getHeartbeat(); } catch (e) { hb = null; }
    var alive = !!(hb && hb.id && Date.now() - hb.t < 15000);
    if (alive) S.host.ball('hide');
    else { S.host.ball('show'); setTimeout(function () { refresh().catch(function () {}); }, 800); }
  });

  // 弹窗相关
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

  $('btnTxClose').addEventListener('click', closeTxModal);
  $('btnTxCancel').addEventListener('click', closeTxModal);
  $('txTypeBuy').addEventListener('click', function () { txType = 1; updateTxTypeUI(); });
  $('txTypeSell').addEventListener('click', function () { txType = 2; updateTxTypeUI(); });
  $('txCode').addEventListener('input', onTxCodeInput);
  $('txCode').addEventListener('change', function () { updateTxTypeUI($('txName').value, $('txCode').value); }); // 换代码刷新可卖提示
  $('txPrice').addEventListener('input', calcTxTotal);
  $('txQty').addEventListener('input', calcTxTotal);
  $('txQty').addEventListener('change', function () { snapTxQty(); calcTxTotal(); }); // 失焦：取整100 + 压可卖上限
  $('btnTxSubmit').addEventListener('click', submitTx);

  $('btnDtClose').addEventListener('click', closeDtModal);
  if ($('btnDtDone')) $('btnDtDone').addEventListener('click', closeDtModal);

  if ($('btnConfirmClose')) $('btnConfirmClose').addEventListener('click', closeConfirm);
  if ($('btnConfirmCancel')) $('btnConfirmCancel').addEventListener('click', closeConfirm);
  if ($('btnConfirmOk')) $('btnConfirmOk').addEventListener('click', function () {
    var cb = confirmCallback;
    closeConfirm();
    if (typeof cb === 'function') cb();
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if ($('confirmModal') && !$('confirmModal').hidden) { closeConfirm(); return; }
      if ($('groupModal') && !$('groupModal').hidden) { closeGroupModal(); return; }
      if (!$('txModal').hidden) { closeTxModal(); return; }
      if (!$('dtModal').hidden) { closeDtModal(); return; }
      if (!$('suggest').hidden) { $('suggest').hidden = true; return; }
      if (!$('txSuggest').hidden) { $('txSuggest').hidden = true; return; }
      if (activeTab === 'settings') { switchTab('positions'); return; }
      (S.closeSelf || function () {})();
    }
  });

  if (typeof S.onCtl === 'function') {
    S.onCtl(function (c) {
      if (!c) return;
      if (c.t === 'cmd' && c.cmd === 'open-settings') switchTab('settings');
      else if (c.t === 'cmd' && c.cmd === 'open-tx-modal') openTxModal({ type: 1 });
      else if (c.t === 'refresh') { refresh().catch(function () {}); }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    settings = (S.settings && S.settings.get()) || {};
    var initTab = settings.defaultView || 'positions';

    // 1. 【0毫秒即时呈现本地信息】绝不等待远程网络，秒开展示当前持仓与自选
    renderStatus();
    renderGroupTabs();

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
          renderList();
        }
      }
    } catch (e) {}

    switchTab(initTab);

    // 2. 远程实时最新行情在后台异步静默拉取
    refresh().catch(function () {});
    loopRefresh();
    setInterval(renderStatus, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
