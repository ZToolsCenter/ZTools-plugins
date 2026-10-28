'use strict';
// Layout changes never reload the document or replace the current draft.
window.editorLayout = (() => {
  const byId = id => document.getElementById(id);
  const editor = byId('editor');
  const main = byId('main-layout');
  const layout = { focus: false, plugins: true, records: true, wrap: false, fontSize: 14, pluginWidth: 200, recordWidth: 230 };
  const find = { matches: [], current: -1, timer: null };
  let lineCount = 0;
  try {
    const preferences = JSON.parse(localStorage.getItem('data-editor-layout-v2') || '{}');
    for (const field of ['wrap', 'fontSize', 'pluginWidth', 'recordWidth']) if (typeof preferences[field] === typeof layout[field]) layout[field] = preferences[field];
  } catch {}
  layout.fontSize = [12, 14, 16, 18, 20].includes(layout.fontSize) ? layout.fontSize : 14;
  layout.pluginWidth = Math.max(160, Math.min(340, layout.pluginWidth));
  layout.recordWidth = Math.max(160, Math.min(380, layout.recordWidth));
  function remember() { try { localStorage.setItem('data-editor-layout-v2', JSON.stringify(layout)); } catch {} }
  function apply() {
    document.body.classList.toggle('focus-editor', layout.focus);
    document.body.classList.toggle('hide-plugins', !layout.plugins || layout.focus);
    document.body.classList.toggle('hide-records', !layout.records || layout.focus);
    document.body.classList.toggle('wrap-lines', layout.wrap);
    byId('toggle-plugins').setAttribute('aria-pressed', String(layout.plugins && !layout.focus));
    byId('toggle-records').setAttribute('aria-pressed', String(layout.records && !layout.focus));
    byId('focus-mode').setAttribute('aria-pressed', String(layout.focus));
    byId('focus-mode').textContent = layout.focus ? '退出专注编辑' : '专注编辑';
    byId('layout-hint').textContent = layout.focus ? '编辑区已铺满窗口 · Ctrl+Shift+F 退出' : document.body.classList.contains('has-record') ? '二级编辑页面 · 列表可按需展开' : '选择插件，再点击一条记录进入编辑页面';
    byId('wrap-toggle').setAttribute('aria-pressed', String(layout.wrap));
    editor.wrap = layout.wrap ? 'soft' : 'off';
    main.style.setProperty('--plugin-width', `${layout.pluginWidth}px`);
    main.style.setProperty('--record-width', `${layout.recordWidth}px`);
    document.body.style.setProperty('--editor-font-size', `${layout.fontSize}px`);
    byId('font-size').value = String(layout.fontSize);
    remember();
  }
  byId('toggle-plugins').onclick = () => { layout.focus = false; layout.plugins = !layout.plugins; if (innerWidth < 900 && layout.plugins) layout.records = false; apply(); };
  byId('toggle-records').onclick = () => { layout.focus = false; layout.records = !layout.records; if (innerWidth < 900 && layout.records) layout.plugins = false; apply(); };
  byId('focus-mode').onclick = () => { layout.focus = !layout.focus; apply(); };
  byId('wrap-toggle').onclick = () => { layout.wrap = !layout.wrap; apply(); };
  byId('font-size').onchange = () => { layout.fontSize = Number(byId('font-size').value); apply(); update(); };
  function resizeDivider(id, field, min, max) {
    const handle = byId(id);
    const set = value => { layout[field] = Math.max(min, Math.min(max, value, innerWidth - 340)); apply(); };
    handle.onpointerdown = event => {
      if (event.button !== 0) return;
      event.preventDefault(); handle.setPointerCapture(event.pointerId);
      const start = event.clientX, width = layout[field];
      document.body.classList.add('resizing');
      handle.onpointermove = move => set(width + move.clientX - start);
      const finish = () => { handle.onpointermove = null; document.body.classList.remove('resizing'); };
      handle.onpointerup = handle.onpointercancel = finish;
    };
    handle.onkeydown = event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); set(layout[field] + (event.key === 'ArrowRight' ? 16 : -16)); } };
  }
  resizeDivider('plugin-divider', 'pluginWidth', 160, 340);
  resizeDivider('record-divider', 'recordWidth', 160, 380);
  function caret() {
    const start = editor.selectionStart;
    const prefix = editor.value.slice(0, start);
    const row = (prefix.match(/\n/g) || []).length + 1;
    const column = start - prefix.lastIndexOf('\n');
    byId('caret-status').textContent = `行 ${row}，列 ${column}`;
  }
  function update() {
    const count = editor.value.split('\n').length;
    document.body.style.setProperty('--gutter-width', `${Math.ceil(Math.max(2, String(count).length) * layout.fontSize * .65 + 18)}px`);
    if (count !== lineCount) { lineCount = count; byId('line-numbers').textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n'); }
    caret();
    if (!byId('find-bar').hidden) refreshMatches();
  }
  editor.addEventListener('scroll', () => { byId('line-numbers').style.transform = `translateY(${-editor.scrollTop}px)`; });
  for (const event of ['click', 'keyup', 'select']) editor.addEventListener(event, caret);
  function refreshMatches() {
    const term = byId('find-input').value;
    const value = editor.value;
    find.matches = []; find.current = -1;
    if (term) for (let offset = 0; offset <= value.length;) {
      const index = value.indexOf(term, offset);
      if (index < 0) break;
      find.matches.push(index); offset = index + Math.max(1, term.length);
    }
    byId('find-count').textContent = term ? `${find.matches.length} 处匹配` : '';
  }
  function jump(direction) {
    if (!find.matches.length) return;
    find.current = find.current < 0 ? (direction > 0 ? 0 : find.matches.length - 1) : (find.current + direction + find.matches.length) % find.matches.length;
    const index = find.matches[find.current];
    editor.focus(); editor.setSelectionRange(index, index + byId('find-input').value.length);
    const lines = editor.value.slice(0, index).split('\n');
    const columns = Math.max(1, Math.floor((editor.clientWidth - 32) / (layout.fontSize * .6)));
    const visualRows = layout.wrap ? lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)), 0) - 1 : lines.length - 1;
    editor.scrollTop = Math.max(0, visualRows * layout.fontSize * 1.65 - editor.clientHeight / 3);
    if (!layout.wrap) editor.scrollLeft = Math.max(0, (lines.at(-1).length * layout.fontSize * .6) - editor.clientWidth / 2);
    byId('find-count').textContent = `${find.current + 1} / ${find.matches.length}`;
    caret();
  }
  function showFind() { byId('find-bar').hidden = false; byId('find-input').focus(); byId('find-input').select(); refreshMatches(); }
  byId('find-toggle').onclick = showFind;
  byId('find-input').oninput = () => { clearTimeout(find.timer); find.timer = setTimeout(() => { refreshMatches(); find.timer = null; }, 100); };
  byId('find-prev').onclick = () => { clearTimeout(find.timer); if (find.timer) { refreshMatches(); find.timer = null; } jump(-1); };
  byId('find-next').onclick = () => { clearTimeout(find.timer); if (find.timer) { refreshMatches(); find.timer = null; } jump(1); };
  byId('find-close').onclick = () => { byId('find-bar').hidden = true; editor.focus(); };
  byId('find-input').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); clearTimeout(find.timer); if (find.timer) { refreshMatches(); find.timer = null; } jump(event.shiftKey ? -1 : 1); } };
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !byId('editor-pane').hidden && !byId('modal').open) {
      event.preventDefault(); if (event.shiftKey) { layout.focus = !layout.focus; apply(); } else showFind();
    }
    if (event.key === 'Escape' && !byId('find-bar').hidden) { event.preventDefault(); byId('find-bar').hidden = true; editor.focus(); }
  });
  apply();
  return {
    update,
    recordOpened() { document.body.classList.add('has-record'); document.body.classList.remove('browse-records'); layout.plugins = false; layout.records = false; byId('back-to-list').hidden = false; byId('focus-mode').hidden = false; apply(); update(); },
    recordClosed() { document.body.classList.remove('has-record'); document.body.classList.add('browse-records'); layout.focus = false; layout.plugins = true; layout.records = true; byId('back-to-list').hidden = true; byId('focus-mode').hidden = true; apply(); },
    snapshot: () => ({ ...layout, selectionStart: editor.selectionStart, selectionEnd: editor.selectionEnd, scrollTop: editor.scrollTop, scrollLeft: editor.scrollLeft }),
    restore(saved) {
      if (!saved) return;
      for (const field of ['wrap', 'fontSize', 'pluginWidth', 'recordWidth']) if (typeof saved[field] === typeof layout[field]) layout[field] = saved[field];
      apply(); update(); editor.setSelectionRange(saved.selectionStart || 0, saved.selectionEnd || 0);
      editor.scrollTop = saved.scrollTop || 0; editor.scrollLeft = saved.scrollLeft || 0;
    }
  };
})();
