/* 结果面板：微信 OCR 取字 + 在线翻译 + 图片上覆盖译文 */

(function () {
  'use strict';

  const S = window.SNAP;
  const params = new URLSearchParams(window.location.search);
  const initialMode = params.get('mode') === 'translate' ? 'translate' : 'ocr';

  const el = {
    title: document.getElementById('title'),
    preview: document.getElementById('preview'),
    wrap: document.getElementById('canvas-wrap'),
    shot: document.getElementById('shot'),
    overlay: document.getElementById('overlay'),
    text: document.getElementById('text'),
    status: document.getElementById('status'),
    dstLang: document.getElementById('dstLang'),
    btnCopy: document.getElementById('btn-copy'),
    btnTranslate: document.getElementById('btn-translate'),
    btnRetry: document.getElementById('btn-retry'),
    btnClose: document.getElementById('btn-close'),
    toast: document.getElementById('toast'),
    tabs: Array.from(document.querySelectorAll('.tabs button'))
  };

  const state = {
    dataUrl: '',
    natural: { width: 0, height: 0 },
    lines: [],
    groups: [],
    original: '',
    translated: '',
    tab: 'text',
    busy: false
  };

  const settings = S.getSettings();

  // ── 提示 ──
  let toastTimer = null;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
  }

  function setStatus(text) {
    el.status.textContent = text;
  }

  // ── 标题栏拖动区（无边框窗口） ──
  el.tabs.forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

  // ── 语言 ──
  function initLanguages() {
    el.dstLang.innerHTML = S.LANGUAGES
      .map((item) => `<option value="${item.code}">${item.label}</option>`)
      .join('');
    el.dstLang.value = settings.targetLang || 'auto';
  }

  function targetLanguage() {
    const picked = el.dstLang.value;
    if (picked && picked !== 'auto') return picked;
    return S.detectTarget(state.original || '');
  }

  // ── 取图 ──
  function requestImage() {
    S.sendToParent('resultReady');
  }

  S.onChildMessage((payload) => {
    if (!payload) return;
    if (payload.event === 'image' && payload.dataUrl) {
      loadImage(payload.dataUrl);
    }
  });

  // 主路径：preload 把截图写成临时文件，路径在 ?shot=
  const SHOT_PATH = new URLSearchParams(window.location.search).get('shot') || '';
  if (SHOT_PATH && window.zsnap && typeof window.zsnap.readShot === 'function') {
    try {
      const hit = window.zsnap.readShot(SHOT_PATH);
      if (hit && hit.ok && hit.dataUrl) loadImage(hit.dataUrl);
    } catch (error) {
      console.warn('[snap] 读取截图失败', error);
    }
  }

  // 消息通道兜底：主页面把待识别图片写进同一 partition 的 localStorage
  const RESULT_IMAGE_KEY = 'snap-result-img';
  setTimeout(() => {
    if (state.dataUrl) return;
    const stashed = S.takeImage(RESULT_IMAGE_KEY);
    if (stashed) loadImage(stashed);
  }, 350);

  function loadImage(dataUrl) {
    if (state.dataUrl === dataUrl) return;
    state.dataUrl = dataUrl;
    el.shot.onload = () => {
      state.natural = {
        width: el.shot.naturalWidth,
        height: el.shot.naturalHeight
      };
      runOcr();
    };
    el.shot.src = dataUrl;
  }

  // ── OCR ──
  async function runOcr() {
    if (state.busy) return;
    state.busy = true;
    let shouldTranslate = false;
    setStatus('识别中…');
    el.text.value = '';
    el.overlay.hidden = true;
    el.overlay.innerHTML = '';

    try {
      if (!window.zsnap || typeof window.zsnap.ocr !== 'function') {
        throw new Error('当前环境不支持 OCR');
      }
      const dir = (S.getSettings().ocrDir || '').trim();
      const result = await window.zsnap.ocr(state.dataUrl, { dir });
      state.lines = result.lines || [];
      state.original = result.text || '';
      el.text.value = state.original || '';
      if (!state.lines.length) {
        setStatus('没有识别到文字');
        return;
      }
      state.groups = groupLines(state.lines);
      setStatus(`识别到 ${state.lines.length} 行 · ${state.groups.length} 段`);
      shouldTranslate = initialMode === 'translate';
    } catch (error) {
      shouldTranslate = false;
      const message = String(error && error.message || error || '识别失败');
      setStatus('识别失败');
      el.text.value = [
        'OCR 没能跑起来。',
        '',
        '原因：' + message,
        '',
        '常见处理：',
        '1. 确认本机装过 f-provider 插件，它的 native 目录里有微信 OCR 引擎；',
        '2. 打开「轻影截图设置」，在「OCR 引擎」里填上该 native 目录后点检测。'
      ].join('\n');
    } finally {
      state.busy = false;
      syncCopyLabel();
    }

    if (shouldTranslate) {
      setTab('trans');
      void translateAll();
    }
  }

  // 把逐行结果按位置聚成段落：同一段里行的左边界接近、行距连续
  function groupLines(lines) {
    const sorted = [...lines].sort((a, b) => (a.top - b.top) || (a.left - b.left));
    const groups = [];
    for (const line of sorted) {
      const height = Math.max(6, line.bottom - line.top);
      const last = groups[groups.length - 1];
      const closeY = last && (line.top - last.bottom) < height * 0.85 && line.top >= last.top - height * 0.3;
      const aligned = last && line.left > last.left - height * 2 && line.left < last.right + height * 2;
      if (last && closeY && aligned) {
        last.lines.push(line);
        last.text = joinText(last.text, line.text);
        last.right = Math.max(last.right, line.right);
        last.bottom = Math.max(last.bottom, line.bottom);
        last.left = Math.min(last.left, line.left);
      } else {
        groups.push({
          lines: [line],
          text: line.text,
          left: line.left,
          top: line.top,
          right: line.right,
          bottom: line.bottom
        });
      }
    }
    return groups;
  }

  function joinText(left, right) {
    const a = String(left || '');
    const b = String(right || '');
    if (!a) return b;
    if (!b) return a;
    const cjk = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]$/;
    return cjk.test(a) ? a + b : `${a} ${b}`;
  }

  // ── 翻译 ──
  async function translateAll() {
    if (state.busy) return;
    if (!state.groups.length) {
      toast('还没有识别到文字');
      return;
    }
    state.busy = true;
    setStatus('翻译中…');
    const to = targetLanguage();
    const translator = S.getSettings().translator || 'microsoft';
    const baidu = {
      appId: S.getSettings().baiduAppId || '',
      appKey: S.getSettings().baiduKey || ''
    };

    const total = state.groups.length;
    let done = 0;
    const queue = state.groups.slice();
    const results = new Array(total).fill('');
    let failed = '';

    async function worker() {
      while (queue.length) {
        const index = state.groups.indexOf(queue.shift());
        const group = state.groups[index];
        try {
          const response = await window.zsnap.translate({
            text: group.text,
            from: 'auto',
            to,
            translator,
            appId: baidu.appId,
            appKey: baidu.appKey
          });
          results[index] = response.text || '';
        } catch (error) {
          failed = String(error && error.message || error);
          results[index] = '';
        }
        done += 1;
        setStatus(`翻译中… ${done}/${total}`);
      }
    }

    try {
      const workers = Array.from({ length: Math.min(3, total) }, () => worker());
      await Promise.all(workers);

      state.translated = results.join('\n');
      el.overlay.innerHTML = '';
      state.groups.forEach((group, index) => {
        group.translated = results[index];
      });
      renderOverlay();
      setTab('trans');
      if (failed) {
        setStatus('部分段落未译出');
        toast('翻译失败：' + failed);
      } else {
        setStatus(`已翻译 ${total} 段`);
      }
    } finally {
      state.busy = false;
      syncCopyLabel();
    }
  }

  // ── 译文覆盖层 ──
  const measure = document.createElement('canvas').getContext('2d');

  function fitFont(text, maxWidth, maxHeight, base) {
    let size = Math.round(base);
    // 不要为了塞进一行把字号压到看不清：最多缩到 10px，宁可折成两行
    const floor = Math.min(size, 10);
    while (size > floor) {
      measure.font = `${size}px -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif`;
      const width = measure.measureText(text).width;
      const lines = Math.max(1, Math.ceil(width / Math.max(10, maxWidth)));
      if (lines * size * 1.26 <= Math.max(maxHeight * 1.7, size * 1.5)) break;
      size -= 1;
    }
    return size;
  }

  // 白块往外带 2px，盖掉 OCR 包围盒边缘漏出的标点
  const BLEED = 2;

  // 译文和原文一样的行（网址、数字、代码）没必要盖白块
  function isSameText(a, b) {
    const norm = (value) => String(value || '').replace(/[\s·,.:;!?/\\()[\]{}<>"'，。：；！？、（）《》]/g, '').toLowerCase();
    const left = norm(a);
    return !!left && left === norm(b);
  }

  function renderOverlay() {
    if (!state.groups.length) {
      el.overlay.hidden = true;
      return;
    }
    // 缩放系数必须用「始终可见」的元素来量，不能用 el.overlay.clientWidth：
    // 切到「原文」时 #overlay 是 hidden(display:none)，clientWidth 变 0，
    // 算出来的 k=0 会让所有译文块坐标全部塌成 0、挤到图片左上角（切一次标签就乱）。
    // img / wrap 永远可见，量它们才稳。
    if (!state.natural.width) {
      el.overlay.hidden = true;
      return;
    }
    const base = el.shot.clientWidth || el.wrap.clientWidth || 0;
    if (!base) {
      el.overlay.hidden = true;
      return;
    }
    const k = base / state.natural.width;
    el.overlay.innerHTML = '';
    let painted = 0;
    for (const group of state.groups) {
      if (!group.translated) continue;
      if (isSameText(group.translated, group.text)) continue;
      const left = group.left * k;
      const top = group.top * k;
      const width = Math.max(18, (group.right - group.left) * k);
      const boxHeight = Math.max(10, (group.bottom - group.top) * k);
      const lineHeight = boxHeight / Math.max(1, group.lines.length);
      const base2 = Math.max(10, Math.min(30, lineHeight * 0.9));
      const node = document.createElement('div');
      node.className = 'trans';
      const size = fitFont(group.translated, width + BLEED * 2 - 6, boxHeight, base2);
      node.style.left = `${left - BLEED}px`;
      node.style.top = `${top - BLEED * 0.5}px`;
      node.style.width = `${width + BLEED * 2}px`;
      node.style.fontSize = `${size}px`;
      node.textContent = group.translated;
      el.overlay.appendChild(node);
      painted += 1;
    }
    el.overlay.hidden = painted === 0;
  }

  // ── 视图切换 ──
  function setTab(tab) {
    state.tab = tab;
    el.tabs.forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
    if (tab === 'trans') {
      el.title.textContent = '图片翻译';
      el.dstLang.hidden = false;
      el.text.value = state.translated || (state.groups.length ? '还没有译文，点右上角「翻译」。' : '');
      if (state.groups.some((group) => group.translated)) renderOverlay();
      else el.overlay.hidden = true;
    } else {
      el.title.textContent = '文字识别';
      el.dstLang.hidden = true;
      el.text.value = state.original || '';
      el.overlay.hidden = true;
    }
    syncCopyLabel();
  }

  function syncCopyLabel() {
    el.btnCopy.textContent = state.tab === 'trans' ? '复制译文' : '复制原文';
  }

  // ── 按钮 ──
  el.btnCopy.addEventListener('click', async () => {
    const text = el.text.value;
    if (!text) {
      toast('没有可复制的内容');
      return;
    }
    try {
      if (window.zsnap && window.zsnap.copyText) window.zsnap.copyText(text);
      else await navigator.clipboard.writeText(text);
      toast('已复制');
    } catch {
      toast('复制失败');
    }
  });

  el.btnTranslate.addEventListener('click', () => {
    if (!state.groups.length) {
      toast('先识别一次');
      return;
    }
    if (state.translated) {
      setTab('trans');
      return;
    }
    void translateAll();
  });

  el.btnRetry.addEventListener('click', () => {
    state.translated = '';
    state.groups.forEach((group) => { group.translated = ''; });
    void runOcr();
  });

  el.btnClose.addEventListener('click', () => {
    S.sendToParent('resultClosed');
    setTimeout(() => {
      try {
        window.close();
      } catch {
        // 忽略
      }
    }, 60);
  });

  el.dstLang.addEventListener('change', () => {
    if (!state.translated) return;
    state.translated = '';
    state.groups.forEach((group) => { group.translated = ''; });
    void translateAll();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') el.btnClose.click();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && document.activeElement !== el.text) {
      el.btnCopy.click();
    }
  });

  window.addEventListener('resize', () => {
    if (state.tab === 'trans') renderOverlay();
  });

  // ── 启动 ──
  initLanguages();
  document.body.classList.toggle('light', !S.isDarkTheme());
  setTab(initialMode === 'translate' ? 'trans' : 'text');
  setStatus('等待图片…');
  requestImage();
  setTimeout(() => {
    if (!state.dataUrl) setStatus('没有收到图片');
  }, 4000);
})();
