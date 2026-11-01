/* 轻影 · 贴图板 / 历史记录
   数据都在 preload 里（PINS 注册表 + 本地历史索引），这里只负责显示与派发动作。 */

(function () {
  'use strict';

  const S = window.SNAP;
  const B = window.zsnap || {};

  const el = {
    topSub: document.getElementById('topSub'),
    pinCount: document.getElementById('pinCount'),
    pinGrid: document.getElementById('pinGrid'),
    pinEmpty: document.getElementById('pinEmpty'),
    historyGrid: document.getElementById('historyGrid'),
    historyEmpty: document.getElementById('historyEmpty'),
    panePins: document.getElementById('panePins'),
    paneHistory: document.getElementById('paneHistory'),
    historyTools: document.getElementById('historyTools'),
    pinShowAll: document.getElementById('pinShowAll'),
    pinHideAll: document.getElementById('pinHideAll'),
    pinCloseAll: document.getElementById('pinCloseAll'),
    search: document.getElementById('search'),
    btnClear: document.getElementById('btnClear'),
    btnFolder: document.getElementById('btnFolder'),
    btnClose: document.getElementById('btnClose'),
    toast: document.getElementById('toast')
  };

  const thumbCache = new Map();
  let tab = new URLSearchParams(location.search).get('tab') === 'history' ? 'history' : 'pins';
  let pins = [];
  let history = [];
  let historyLoaded = false;

  const SOURCE_LABEL = {
    capture: '截图',
    edit: '标注',
    copy: '复制',
    save: '保存',
    pin: '悬浮',
    ocr: '抠字',
    translate: '翻译',
    crop: '裁剪'
  };

  document.body.classList.toggle('light', !S.isDarkTheme());

  let toastTimer = null;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  function clock(ts) {
    const date = new Date(Number(ts) || Date.now());
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return `今天 ${hm}`;
    const yesterday = new Date(now.getTime() - 86400000);
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
    return `${date.getMonth() + 1}月${date.getDate()}日 ${hm}`;
  }

  function sizeText(w, h) {
    return w && h ? `${w}×${h}` : '';
  }

  // 缩略图走 nativeImage 缩放，避免把几百张原图塞进渲染层
  function fillThumb(node, filePath, fallbackText) {
    if (!filePath || !B.historyThumb) {
      node.innerHTML = `<span class="ph">${S.escapeHtml(fallbackText || '无预览')}</span>`;
      return;
    }
    const hit = thumbCache.get(filePath);
    if (hit) {
      paint(hit);
      return;
    }
    setTimeout(() => {
      let result = null;
      try {
        result = B.historyThumb(filePath, 320);
      } catch {
        result = null;
      }
      if (result && result.ok && result.dataUrl) {
        thumbCache.set(filePath, result.dataUrl);
        paint(result.dataUrl);
      } else {
        node.innerHTML = `<span class="ph">${S.escapeHtml(fallbackText || '预览不可用')}</span>`;
      }
    }, 0);

    function paint(url) {
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      node.innerHTML = '';
      node.appendChild(image);
    }
  }

  // ─────────────── 贴图板 ───────────────

  function renderPins() {
    el.pinCount.textContent = String(pins.length);
    el.pinGrid.innerHTML = '';
    el.pinEmpty.hidden = pins.length > 0;
    el.pinShowAll.disabled = pins.length === 0;
    el.pinHideAll.disabled = pins.length === 0;
    el.pinCloseAll.disabled = pins.length === 0;

    pins.forEach((pin, index) => {
      const card = document.createElement('div');
      card.className = 'card' + (pin.hidden ? ' hidden-pin' : '');
      card.innerHTML = `
        <div class="thumb" data-act="focus" title="点一下把这张贴图提到最前"><span class="ph">载入中…</span></div>
        <div class="card-body">
          <div class="meta">
            <span class="t">${pin.hidden ? '已收起' : '屏幕贴图'} ${index + 1}</span>
            <span class="s">${sizeText(pin.width, pin.height)}${pin.cropped ? ' · 已裁剪' : ''}</span>
          </div>
          <div class="row-actions">
            <button class="icon-btn" data-act="toggle" title="${pin.hidden ? '显示' : '收起'}">${pin.hidden ? '◱' : '◧'}</button>
            <button class="icon-btn danger" data-act="close" title="关闭">✕</button>
          </div>
        </div>`;

      fillThumb(card.querySelector('.thumb'), pin.path, '无预览');

      card.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === 'focus') {
          const result = B.focusPin ? B.focusPin(pin.id) : { ok: false };
          toast(result && result.ok ? '已提到最前' : '这张贴图已经关掉了');
          return;
        }
        if (act === 'toggle') {
          const next = Boolean(pin.hidden);
          const result = B.setPinVisible ? B.setPinVisible(pin.id, next) : { ok: false };
          toast(result && result.ok ? (next ? '已显示' : '已收起') : '这张贴图已经关掉了');
          refreshPins();
          return;
        }
        if (act === 'close') {
          const result = B.closePinById ? B.closePinById(pin.id) : { ok: false };
          toast(result && result.ok ? '已关闭' : '这张贴图已经关掉了');
        }
      });

      el.pinGrid.appendChild(card);
    });
  }

  function refreshPins() {
    try {
      pins = B.pinList ? B.pinList() : [];
    } catch {
      pins = [];
    }
    renderPins();
  }

  // ─────────────── 历史 ───────────────

  // 用户可以把上限调到几百上千张，一次性铺出来会卡，
  // 所以按批渲染：先 60 张，滚到底再续 60 张。
  const HISTORY_PAGE = 60;
  let historyShown = HISTORY_PAGE;

  function makeHistoryCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
        <div class="thumb" data-act="copy" title="点一下复制这张图"><span class="ph">载入中…</span></div>
        <div class="card-body">
          <div class="meta">
            <span class="t">${clock(item.ts)}</span>
            <span class="s">${sizeText(item.w, item.h)} · ${SOURCE_LABEL[item.source] || '截图'}</span>
          </div>
          <div class="row-actions">
            <button class="icon-btn" data-act="pin" title="悬浮到屏幕上">◱</button>
            <button class="icon-btn" data-act="reveal" title="在文件夹中显示">▤</button>
            <button class="icon-btn danger" data-act="remove" title="删除">✕</button>
          </div>
        </div>`;

    fillThumb(card.querySelector('.thumb'), item.path, '无预览');

    card.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'copy') {
        const shot = B.readShot ? B.readShot(item.path) : { ok: false };
        if (!shot || !shot.ok) {
          toast('这张图已经不在了');
          return;
        }
        const copied = B.copyImage ? B.copyImage(shot.dataUrl) : { ok: false };
        toast(copied && copied.ok ? '已复制到剪贴板' : '复制失败');
        return;
      }

      if (act === 'pin') {
        const shot = B.readShot ? B.readShot(item.path) : { ok: false };
        if (!shot || !shot.ok) {
          toast('这张图已经不在了');
          return;
        }
        const opened = B.openPin ? B.openPin(shot.dataUrl) : { ok: false };
        toast(opened && opened.ok ? '已悬浮到屏幕上' : '悬浮失败');
        return;
      }

      if (act === 'reveal') {
        B.historyReveal && B.historyReveal(item.path);
        return;
      }

      if (act === 'remove') {
        const result = B.historyRemove ? B.historyRemove(item.path) : { ok: false };
        if (result && result.ok) {
          history = history.filter((entry) => entry.path !== item.path);
          thumbCache.delete(item.path);
          renderHistory(true);
          toast('已删除');
        } else {
          toast('删除失败');
        }
      }
    });

    return card;
  }

  function renderHistory(keepScroll) {
    const keepTop = keepScroll ? el.paneHistory.scrollTop : 0;
    historyShown = Math.min(Math.max(historyShown, HISTORY_PAGE), Math.max(history.length, HISTORY_PAGE));
    el.historyGrid.innerHTML = '';
    el.historyEmpty.hidden = history.length > 0;

    history.slice(0, historyShown).forEach((item) => {
      el.historyGrid.appendChild(makeHistoryCard(item));
    });

    if (keepScroll) el.paneHistory.scrollTop = keepTop;
  }

  // 滚到接近底部就续一批，几百张也不会一次铺满 DOM
  function maybeLoadMoreHistory() {
    if (tab !== 'history') return;
    if (historyShown >= history.length) return;
    const pane = el.paneHistory;
    if (pane.scrollTop + pane.clientHeight < pane.scrollHeight - 220) return;
    const from = historyShown;
    historyShown = Math.min(history.length, historyShown + HISTORY_PAGE);
    for (const item of history.slice(from, historyShown)) {
      el.historyGrid.appendChild(makeHistoryCard(item));
    }
  }

  function loadHistory() {
    try {
      history = B.historyList ? B.historyList(el.search.value) : [];
    } catch {
      history = [];
    }
    historyLoaded = true;
    historyShown = HISTORY_PAGE;
    renderHistory();
    el.paneHistory.scrollTop = 0;
  }

  // ─────────────── 标签与工具 ───────────────

  function setTab(next) {
    tab = next === 'history' ? 'history' : 'pins';
    document.querySelectorAll('.tab').forEach((node) => {
      node.classList.toggle('active', node.dataset.tab === tab);
    });
    el.panePins.hidden = tab !== 'pins';
    el.paneHistory.hidden = tab !== 'history';
    el.topSub.textContent = tab === 'pins' ? '贴图板' : '历史记录';
    document.querySelectorAll('.tab-tools:not(#historyTools)').forEach((node) => {
      node.hidden = tab !== 'pins';
    });
    el.historyTools.hidden = tab !== 'history';
    el.btnFolder.hidden = tab !== 'history';

    if (tab === 'pins') refreshPins();
    else if (!historyLoaded) loadHistory();
    else renderHistory();
  }

  document.querySelectorAll('.tab').forEach((node) => {
    node.addEventListener('click', () => setTab(node.dataset.tab));
  });

  el.pinShowAll.addEventListener('click', () => {
    B.showAllPins && B.showAllPins();
    toast('全部显示');
    refreshPins();
  });

  el.pinHideAll.addEventListener('click', () => {
    B.hideOtherPins && B.hideOtherPins('');
    toast('全部收起');
    refreshPins();
  });

  el.pinCloseAll.addEventListener('click', () => {
    if (pins.length === 0) return;
    B.closeAllPins && B.closeAllPins();
    toast('贴图都关了');
    refreshPins();
  });

  let searchTimer = null;
  el.search.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(loadHistory, 180);
  });

  el.paneHistory.addEventListener('scroll', maybeLoadMoreHistory, { passive: true });

  el.btnClear.addEventListener('click', () => {
    if (!history.length) {
      toast('本来就是空的');
      return;
    }
    B.historyClear && B.historyClear();
    history = [];
    thumbCache.clear();
    renderHistory();
    toast('历史已清空');
  });

  el.btnFolder.addEventListener('click', () => {
    const result = B.historyOpenDir ? B.historyOpenDir() : { ok: false };
    if (!result || !result.ok) toast('打不开文件夹');
  });

  el.btnClose.addEventListener('click', () => window.close());

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.close();
    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      setTab(tab === 'pins' ? 'history' : 'pins');
    }
  });

  // 父窗口推送：贴图增减、历史变化
  S.onChildMessage((payload) => {
    if (!payload) return;
    if (payload.event === 'pinsChanged') {
      pins = Array.isArray(payload.pins) ? payload.pins : [];
      if (tab === 'pins') renderPins();
      else el.pinCount.textContent = String(pins.length);
    }
    if (payload.event === 'boardTab') setTab(payload.tab);
  });

  S.sendToParent('boardReady');

  setTab(tab);
})();
