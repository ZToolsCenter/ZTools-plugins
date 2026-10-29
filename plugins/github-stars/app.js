/**
 * GitHub 星标管理 · 页面逻辑
 * 数据与系统能力全部来自 preload 挂载的 window.services（页面里没有 Node）。
 */
(function () {
  'use strict';

  var SVC = null;          // window.services
  var state = { accounts: [], current: null, cache: null, notes: {}, groups: [] };
  var activeGroup = '';
  var query = '';
  var focusRepo = '';      // 由主搜索框跳转过来时高亮/预填
  var indexedGroups = null;
  var membershipsByRepo = new Map();

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 模糊匹配（与桌面版清单页同一套策略） ---------------- */
  function subMatch(hay, q) {
    hay = (hay || '').toLowerCase();
    q = (q || '').toLowerCase();
    if (!q) return { score: 0, idx: [] };
    var at = hay.indexOf(q);
    if (at < 0) return null;
    var idx = [];
    for (var k = 0; k < q.length; k++) idx.push(at + k);
    return { score: 1000 - Math.min(at, 120) + q.length * 4, idx: idx };
  }
  function nameMatch(hay, q) {
    hay = (hay || '').toLowerCase();
    q = (q || '').toLowerCase();
    if (!q) return { score: 0, idx: [] };
    var sub = subMatch(hay, q);
    if (sub) return sub;
    var i = 0, idx = [], score = 0;
    for (var j = 0; j < hay.length && i < q.length; j++) if (hay[j] === q[i]) { idx.push(j); i++; }
    if (i < q.length) return null;
    var span = idx[idx.length - 1] - idx[0] + 1;
    var gaps = span - q.length;
    if (gaps > Math.max(2, Math.floor(q.length / 2))) return null;
    for (var k = 1; k < idx.length; k++) score += (idx[k] === idx[k - 1] + 1 ? 12 : 4);
    return { score: 200 + score - gaps * 3, idx: idx };
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function hl(name, idx) {
    if (!idx || !idx.length) return esc(name);
    var set = {};
    idx.forEach(function (i) { set[i] = 1; });
    var out = '';
    for (var i = 0; i < name.length; i++) out += set[i] ? '<mark>' + esc(name[i]) + '</mark>' : esc(name[i]);
    return out;
  }
  function kfmt(n) { return n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + 'k' : String(n); }
  function items() { return (state.cache && state.cache.items) || []; }
  function noteOf(name) { var n = state.notes && state.notes[name]; return (n && n.t) ? n.t : ''; }
  function noteTime(name) { var n = state.notes && state.notes[name]; return (n && n.u) ? n.u : 0; }
  function repoGroups(name) {
    if (indexedGroups !== state.groups) {
      membershipsByRepo = new Map();
      state.groups.forEach(function (g) {
        (g.repos || []).forEach(function (repo) {
          if (!membershipsByRepo.has(repo)) membershipsByRepo.set(repo, []);
          membershipsByRepo.get(repo).push(g);
        });
      });
      indexedGroups = state.groups;
    }
    return membershipsByRepo.get(name) || [];
  }

  /* ---------------- 筛选 + 排序 ---------------- */
  function currentRows() {
    var all = items();
    var q = query.trim();
    var onlyNotes = $('onlynotes').checked;
    var rows = [];
    all.forEach(function (it, index) {
      var memberships = repoGroups(it.n);
      if (activeGroup === 'ungrouped' && memberships.length) return;
      if (activeGroup && activeGroup !== 'ungrouped' && !memberships.some(function (g) { return g.id === activeGroup; })) return;
      var note = noteOf(it.n);
      if (onlyNotes && !note) return;
      if (q) {
        var nm = nameMatch(it.n, q);
        var nt = nm ? null : subMatch(note, q);          // 备注优先级仅次于仓库名
        var dm = (nm || nt) ? null : subMatch([it.d || '', (it.t || []).join(' ')].join(' \n '), q);
        if (!nm && !nt && !dm) return;
        rows.push({
          it: it, note: note, index: index,
          nameIdx: nm ? nm.idx : [], noteIdx: nt ? nt.idx : [],
          score: nm ? 500 + nm.score : (nt ? 400 + nt.score : dm.score)
        });
      } else {
        rows.push({ it: it, note: note, index: index, nameIdx: [], noteIdx: [], score: 0 });
      }
    });
    var s = $('sort').value;
    var byName = function (a, b) { return a.it.n.toLowerCase().localeCompare(b.it.n.toLowerCase()); };
    var order;
    if (s === 'starred-desc' || s === 'starred-asc') {
      // 旧缓存没有时间戳，但 API 原始顺序已是收藏时间新→旧，按原始位置兼容。
      var hasTimes = all.every(function (it) { return !!it.starredAt && Number.isFinite(Date.parse(it.starredAt)); });
      order = function (a, b) {
        var diff = hasTimes ? Date.parse(b.it.starredAt) - Date.parse(a.it.starredAt) : a.index - b.index;
        return (s === 'starred-asc' ? -diff : diff) || a.index - b.index;
      };
    } else if (s === 'star-asc') order = function (a, b) { return a.it.s - b.it.s || byName(a, b); };
    else if (s === 'name') order = byName;
    else if (s === 'note') order = function (a, b) {
      var ta = noteTime(a.it.n), tb = noteTime(b.it.n);
      if (tb !== ta) return tb - ta;                     // 有备注的先、按备注时间新→旧
      return (b.it.p || '').localeCompare(a.it.p || '');
    };
    else if (s === 'pushed') order = function (a, b) { return (b.it.p || '').localeCompare(a.it.p || '') || b.it.s - a.it.s; };
    else order = function (a, b) { return b.it.s - a.it.s || byName(a, b); };
    rows.sort(function (a, b) { return (q ? b.score - a.score : 0) || order(a, b); });
    return rows;
  }

  /* ---------------- 渲染 ---------------- */
  function render() {
    var rows = currentRows();
    var html = '';
    rows.forEach(function (r) {
      var it = r.it;
      var tags = [];
      if (it.l) tags.push('<span class="tag">' + esc(it.l) + '</span>');
      if (it.a) tags.push('<span class="badge arch">已归档</span>');
      var sel = (focusRepo && it.n === focusRepo) ? ' sel' : '';
      var note = r.note || '';
      html += '<li class="item' + sel + '" data-url="' + esc(it.u) + '" data-name="' + esc(it.n) + '">'
        + '<div class="top"><a class="repo" href="' + esc(it.u) + '" data-url="' + esc(it.u) + '">' + hl(it.n, r.nameIdx) + '</a>'
        + '<span class="tag star">⭐ ' + kfmt(it.s) + '</span>' + tags.join('') + '</div>'
        + (it.d ? '<div class="desc">' + esc(it.d) + '</div>' : '')
        + (it.p ? '<div class="en">最近推送 ' + esc(it.p) + '</div>' : '')
        + (it.starredAt ? '<div class="en">Star 时间 ' + esc(new Date(it.starredAt).toLocaleString()) + '</div>' : '')
        + '<div class="repo-groups">'
        + repoGroups(it.n).map(function (g) { return '<span class="tag group-tag">' + esc(g.name) + '</span>'; }).join('')
        + '<button class="group-set" data-name="' + esc(it.n) + '">设置分组</button></div>'
        + '<div class="notebox"><span class="notetag">备注</span>'
        + '<input class="note-input' + (note ? ' has-note' : '') + '" type="text" data-name="' + esc(it.n) + '"'
        + ' placeholder="写点备注（回车或失焦自动保存）" value="' + esc(note) + '" autocomplete="off" spellcheck="false">'
        + '</div></li>';
    });
    $('list').innerHTML = rows.length ? '<ul>' + html + '</ul>'
      : '<div class="empty">' + (items().length ? '没有匹配的仓库，试试更短的关键词' : '这个账号还没有缓存数据，点右上角「⟳ 刷新」拉取') + '</div>';

    $('count').textContent = items().length ? ('显示 ' + rows.length + ' / ' + items().length) : '';

    var counts = {}, ungrouped = 0;
    items().forEach(function (it) {
      var memberships = repoGroups(it.n);
      if (!memberships.length) ungrouped++;
      memberships.forEach(function (g) { counts[g.id] = (counts[g.id] || 0) + 1; });
    });
    function chip(id, name, count) {
      return '<button class="chip' + (activeGroup === id ? ' on' : '') + '" data-group="' + esc(id)
        + '" aria-pressed="' + (activeGroup === id) + '">' + esc(name) + ' ' + count + '</button>';
    }
    $('chips').innerHTML = chip('', '全部', items().length) + chip('ungrouped', '未分组', ungrouped)
      + state.groups.map(function (g) { return chip(g.id, g.name, counts[g.id] || 0); }).join('');
    $('groups-manage').disabled = !state.current;

    var acc = state.accounts.filter(function (a) { return a.id === state.current; })[0];
    if (acc) {
      var mode = state.cache ? 'Token 模式' : '未拉取';
      $('acct-info').textContent = (acc.login || acc.user || acc.label) + ' · ' + mode + (state.cache ? ' · ' + items().length + ' 个' : '');
    } else {
      $('acct-info').textContent = '未添加账号';
    }
    var noteCount = Object.keys(state.notes || {}).length;
    $('foot').textContent = state.cache
      ? ('数据时间 ' + new Date(state.cache.fetchedAt).toLocaleString()
         + ' · 备注 ' + noteCount + ' 条 · 分组 ' + state.groups.length + ' 个 · 数据只存本机')
      : '需要 GitHub Token（插件通过 /user/starred 拉取，含私有星标）；Token 只存本机 dbStorage。';
  }

  function renderAccounts() {
    var sel = $('acct');
    var html = '';
    state.accounts.forEach(function (a) {
      html += '<option value="' + esc(a.id) + '"' + (a.id === state.current ? ' selected' : '') + '>'
        + esc(a.label || a.user) + (a.hasToken ? ' 🔑' : '') + '</option>';
    });
    sel.innerHTML = html || '<option value="">（无账号）</option>';
    var has = state.accounts.length > 0;
    $('acct-edit').disabled = !has;
    $('acct-del').disabled = !has;
    $('refresh').disabled = !has;
    $('export').disabled = !has || !state.cache;
    $('open-star').disabled = !has;
    $('acct-add').classList.toggle('primary', !has);
  }

  function say(text, cls) {
    var el = $('msg');
    el.className = 'msg' + (cls ? ' ' + cls : '') + (text ? '' : ' hidden');
    el.textContent = text || '';
  }

  /* ---------------- 数据流 ---------------- */
  function loadState(keepFocus) {
    var r = SVC.listAccounts();
    if (state.current !== r.current) activeGroup = '';
    state.accounts = r.accounts || [];
    state.current = r.current || null;
    state.cache = SVC.getCache ? SVC.getCache(state.current) : null;
    try { state.notes = (SVC.notes && SVC.notes()) || {}; } catch (e) { state.notes = {}; }
    state.groups = SVC.groups(state.current);
    if (activeGroup && activeGroup !== 'ungrouped' && !state.groups.some(function (g) { return g.id === activeGroup; })) activeGroup = '';
    if (!keepFocus) focusRepo = '';
    renderAccounts();
    render();
  }

  function selectAccount(id) {
    try {
      SVC.setCurrent(id);
      loadState();
      var acc = state.accounts.filter(function (a) { return a.id === id; })[0];
      if (!state.cache) {
        say('已切换到「' + (acc ? acc.label : id) + '」，这个账号还没有缓存，正在拉取…');
        doRefresh();
      } else {
        say('已切换到「' + (acc ? acc.label : id) + '」：' + items().length + ' 个星标仓库（数据时间 ' + new Date(state.cache.fetchedAt).toLocaleString() + '）');
      }
    } catch (e) { say('切换账号失败：' + e.message, 'err'); }
  }

  function doRefresh() {
    if (!state.current) { openModal('add'); return; }
    $('refresh').disabled = true;
    $('refresh').textContent = '⟳ 拉取中…';
    say('正在从 GitHub 拉取星标…');
    Promise.resolve(SVC.fetchStars(state.current)).then(function (r) {
      state.cache = SVC.getCache(state.current);
      render();
      say('拉取完成：' + r.total + ' 个星标仓库（含私有星标，账号 ' + (r.account.login || r.account.user) + '）');
    }).catch(function (e) {
      say('拉取失败：' + (e && e.message ? e.message : e), 'err');
    }).then(function () {
      $('refresh').disabled = false;
      $('refresh').textContent = '⟳ 刷新';
    });
  }

  /* ---------------- 账号弹窗 ---------------- */
  var editingId = null;
  function openModal(mode, acc) {
    editingId = mode === 'edit' ? acc.id : null;
    $('modal-title').textContent = mode === 'edit' ? '编辑账号' : '添加账号';
    $('f-user').value = mode === 'edit' ? (acc.user || '') : '';
    $('f-label').value = mode === 'edit' ? (acc.label || '') : '';
    $('f-token').value = '';
    $('f-token').placeholder = mode === 'edit' && acc.hasToken
      ? '当前已保存 Token（' + acc.tokenMask + '），留空表示不修改' : '';
    $('modal').classList.remove('hidden');
    $('f-user').focus();
  }
  function closeModal() { $('modal').classList.add('hidden'); editingId = null; }
  function saveModal() {
    var user = $('f-user').value.trim();
    var label = $('f-label').value.trim();
    var token = $('f-token').value.trim();
    try {
      if (editingId) {
        var patch = { user: user, label: label };
        if (token) patch.token = token;
        SVC.updateAccount(editingId, patch);
      } else {
        if (!token) { say('必须填写 GitHub Token（插件用 Token 访问 /user/starred，才能可靠拿到你的星标）', 'warn'); $('f-token').focus(); return; }
        SVC.addAccount({ user: user, token: token, label: label });
      }
      closeModal();
      loadState();
      say(editingId ? '账号已更新' : '账号已添加，正在拉取星标…');
      if (!state.cache) doRefresh();
    } catch (e) { say('保存失败：' + e.message, 'err'); }
  }

  /* ---------------- 备注保存 ---------------- */
  function saveNote(name, text, inputEl) {
    var trimmed = String(text == null ? '' : text).trim();
    var currentText = noteOf(name);
    if (trimmed === currentText) return;
    try {
      var r = SVC.setNote(name, trimmed);
      state.notes = r.notes || {};
      if (inputEl) {
        inputEl.value = trimmed;
        inputEl.classList.toggle('has-note', !!trimmed);
      }
      say(trimmed ? ('已保存备注：' + name + ' —— ' + trimmed) : ('已清空备注：' + name));
      var s = $('sort').value;
      if (s === 'note' || $('onlynotes').checked) {
        render();
      }
    } catch (e) { say('保存备注失败：' + e.message, 'err'); }
  }

  /* ---------------- 自定义分组 ---------------- */
  var groupTarget = null;
  var draftGroups = new Set();
  var groupReturnFocus = null;
  function groupError(message) {
    $('groups-error').textContent = message || '';
    $('groups-error').classList.toggle('hidden', !message);
  }
  function renderGroupDialog() {
    var assigning = groupTarget !== null;
    $('groups-title').textContent = assigning ? '设置仓库分组' : '管理分组';
    $('groups-hint').textContent = assigning ? groupTarget + ' · 可选择多个分组，取消全部勾选即移至未分组。' : '分组仅保存在本机，当前账号独立使用。删除分组会保留仓库和备注。';
    $('groups-cancel').textContent = assigning ? '取消' : '关闭';
    $('groups-save').classList.toggle('hidden', !assigning);
    $('groups-list').innerHTML = state.groups.length ? state.groups.map(function (g) {
      if (assigning) {
        return '<label class="group-choice"><input type="checkbox" data-group="' + esc(g.id) + '"'
          + (draftGroups.has(g.id) ? ' checked' : '') + '> <span>' + esc(g.name) + '</span></label>';
      }
      return '<div class="group-row" data-group="' + esc(g.id) + '">'
        + '<input class="group-rename" type="text" maxlength="40" aria-label="分组名称" value="' + esc(g.name) + '">'
        + '<button data-action="rename">重命名</button><button data-action="delete">删除</button></div>';
    }).join('') : '<p class="muted">还没有分组，在上方输入名称即可新建。</p>';
  }
  function openGroups(name, trigger) {
    groupTarget = name == null ? null : name;
    draftGroups = new Set(name == null ? [] : repoGroups(name).map(function (g) { return g.id; }));
    groupReturnFocus = trigger || document.activeElement;
    $('group-name').value = '';
    groupError('');
    renderGroupDialog();
    $('groups-modal').classList.remove('hidden');
    $('group-name').focus();
  }
  function closeGroups() {
    $('groups-modal').classList.add('hidden');
    groupTarget = null;
    if (groupReturnFocus && groupReturnFocus.isConnected) groupReturnFocus.focus();
    else $('groups-manage').focus();
  }
  function updateGroups(result) {
    state.groups = result.groups || [];
    indexedGroups = null;
    if (activeGroup && activeGroup !== 'ungrouped' && !state.groups.some(function (g) { return g.id === activeGroup; })) activeGroup = '';
    groupError('');
    render();
    renderGroupDialog();
  }
  function saveRepoGroups() {
    if (groupTarget === null) return;
    try {
      var name = groupTarget;
      updateGroups(SVC.setRepoGroups(name, Array.from(draftGroups)));
      closeGroups();
      say('已保存分组：' + name);
    } catch (e) { groupError(e.message); }
  }

  /* ---------------- 确认弹窗 ---------------- */
  var confirmResolver = null;
  function showConfirm(opts) {
    return new Promise(function (resolve) {
      confirmResolver = resolve;
      $('confirm-title').textContent = opts.title || '确认删除';
      $('confirm-sub').textContent = opts.sub || '此操作无法撤销';
      $('confirm-msg').textContent = opts.msg || '';
      var okBtn = $('confirm-ok');
      okBtn.textContent = opts.okText || '确认删除';
      if (opts.danger === false) {
        okBtn.className = 'primary';
      } else {
        okBtn.className = 'btn-danger';
      }
      $('confirm-modal').classList.remove('hidden');
      $('confirm-cancel').focus();
    });
  }
  function closeConfirm(result) {
    $('confirm-modal').classList.add('hidden');
    if (confirmResolver) {
      var r = confirmResolver;
      confirmResolver = null;
      r(!!result);
    }
  }

  /* ---------------- 交互绑定 ---------------- */
  function bind() {
    $('q').addEventListener('input', function (e) { query = e.target.value; focusRepo = ''; render(); });
    $('sort').addEventListener('change', render);
    $('onlynotes').addEventListener('change', render);
    $('acct').addEventListener('change', function (e) { selectAccount(e.target.value); });
    $('acct-add').addEventListener('click', function () { openModal('add'); });
    $('acct-edit').addEventListener('click', function () {
      var acc = state.accounts.filter(function (a) { return a.id === state.current; })[0];
      if (acc) openModal('edit', acc);
    });
    $('acct-del').addEventListener('click', function () {
      var acc = state.accounts.filter(function (a) { return a.id === state.current; })[0];
      if (!acc) return;
      var name = acc.label || acc.user || acc.login || '该账号';
      showConfirm({
        title: '删除账号',
        sub: '将从本机移除该账号信息与本地缓存',
        msg: '确定要删除账号「' + name + '」及其本地缓存吗？',
        okText: '删除账号'
      }).then(function (ok) {
        if (!ok) return;
        SVC.removeAccount(acc.id);
        loadState();
        say('已删除账号');
      });
    });
    $('refresh').addEventListener('click', doRefresh);
    $('open-star').addEventListener('click', function () {
      var acc = state.accounts.filter(function (a) { return a.id === state.current; })[0];
      if (!acc) return;
      SVC.openExternal('https://github.com/' + (acc.login || acc.user) + '?tab=stars');
    });
    $('export').addEventListener('click', function () {
      try {
        var r = SVC.exportJson();
        say('已导出 ' + r.total + ' 条到：' + r.path);
      } catch (e) { say('导出失败：' + e.message, 'err'); }
    });
    $('groups-manage').addEventListener('click', function () { openGroups(null, this); });
    $('group-create').addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        var result = SVC.createGroup($('group-name').value);
        if (groupTarget !== null) draftGroups.add(result.group.id);
        updateGroups(result);
        $('group-name').value = '';
        $('group-name').focus();
      } catch (err) { groupError(err.message); }
    });
    $('groups-list').addEventListener('change', function (e) {
      if (!e.target.matches('input[type="checkbox"]')) return;
      if (e.target.checked) draftGroups.add(e.target.dataset.group);
      else draftGroups.delete(e.target.dataset.group);
    });
    $('groups-list').addEventListener('click', function (e) {
      var button = e.target.closest('button[data-action]');
      if (!button) return;
      var row = button.closest('.group-row');
      var id = row.dataset.group;
      if (button.dataset.action === 'rename') {
        try { updateGroups(SVC.renameGroup(id, row.querySelector('input').value)); }
        catch (err) { groupError(err.message); }
      } else {
        var group = state.groups.filter(function (g) { return g.id === id; })[0];
        if (!group) return;
        showConfirm({ title: '删除分组', sub: '仅删除分组，仓库和备注会保留', msg: '确定删除分组「' + group.name + '」吗？', okText: '删除分组' }).then(function (ok) {
          if (!ok) return;
          try { updateGroups(SVC.deleteGroup(id)); }
          catch (err) { groupError(err.message); }
        });
      }
    });
    $('groups-save').addEventListener('click', saveRepoGroups);
    $('groups-cancel').addEventListener('click', closeGroups);
    $('groups-modal').addEventListener('click', function (e) { if (e.target === this) closeGroups(); });
    $('groups-modal').addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var controls = Array.from(this.querySelectorAll('button, input')).filter(function (el) { return !el.disabled && !el.classList.contains('hidden'); });
      var first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    $('chips').addEventListener('click', function (e) {
      var c = e.target.closest ? e.target.closest('.chip') : null;
      if (!c) return;
      activeGroup = c.dataset.group;
      render();
    });
    $('list').addEventListener('click', function (e) {
      var button = e.target.closest ? e.target.closest('.group-set') : null;
      if (button) { openGroups(button.dataset.name, button); return; }
      var a = e.target.closest ? e.target.closest('a.repo') : null;
      if (a) { e.preventDefault(); SVC.openExternal(a.dataset.url); }
    });
    $('list').addEventListener('change', function (e) {
      if (e.target && e.target.classList.contains('note-input')) {
        saveNote(e.target.dataset.name, e.target.value, e.target);
      }
    });
    $('list').addEventListener('keydown', function (e) {
      var input = e.target;
      if (!input || !input.classList.contains('note-input')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNote(input.dataset.name, input.value, input);
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        input.value = noteOf(input.dataset.name);
        input.blur();
      }
    });
    $('modal-cancel').addEventListener('click', closeModal);
    $('modal-ok').addEventListener('click', saveModal);
    $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });
    $('confirm-cancel').addEventListener('click', function () { closeConfirm(false); });
    $('confirm-ok').addEventListener('click', function () { closeConfirm(true); });
    $('confirm-modal').addEventListener('click', function (e) { if (e.target === $('confirm-modal')) closeConfirm(false); });
    $('f-token').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveModal(); } });
    document.addEventListener('keydown', function (e) {
      var active = document.activeElement;
      var isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      if (e.key === '/' && !isInput && $('confirm-modal').classList.contains('hidden') && $('modal').classList.contains('hidden') && $('groups-modal').classList.contains('hidden')) {
        e.preventDefault(); $('q').focus();
      } else if (e.key === 'Escape') {
        if (!$('confirm-modal').classList.contains('hidden')) closeConfirm(false);
        else if (!$('groups-modal').classList.contains('hidden')) closeGroups();
        else if (!$('modal').classList.contains('hidden')) closeModal();
        else { $('q').value = ''; query = ''; render(); }
      }
    });
  }

  /* ---------------- ZTools / uTools 集成 ---------------- */
  function ztools() { return (typeof window !== 'undefined' && (window.ztools || window.utools)) || null; }

  function handleLaunch(param) {
    if (!param) return;
    var payload = param.payload;
    if (payload == null) return;
    var p = String(payload);
    if (/^https?:\/\//i.test(p)) {                  // 主搜索框选中某仓库 → 直接打开
      SVC.openExternal(p);
      var hit = items().filter(function (x) { return x.u === p; })[0];
      if (hit) { $('q').value = hit.n; query = hit.n; focusRepo = hit.n; render(); }
    } else {                                        // 关键字搜过 → 预填搜索框
      $('q').value = p; query = p; render();
    }
  }

  function setupMainPush() {
    var z = ztools();
    if (!z || typeof z.onMainPush !== 'function') return;
    z.onMainPush(function (q) {
      if (!q) return [];
      var rows = [];
      items().forEach(function (it) {
        var note = noteOf(it.n);
        var nm = nameMatch(it.n, q);
        var nt = nm ? null : subMatch(note, q);
        var dm = (nm || nt) ? null : subMatch([it.d || '', (it.t || []).join(' ')].join(' \n '), q);
        if (!nm && !nt && !dm) return;
        rows.push({ it: it, note: note, score: (nm ? 500 + nm.score : (nt ? 400 + nt.score : dm.score)) });
      });
      rows.sort(function (a, b) { return b.score - a.score || b.it.s - a.it.s; });
      return rows.slice(0, 12).map(function (r) {
        var note = r.note ? ('📝' + r.note.slice(0, 40) + ' · ') : '';
        return {
          title: r.it.n,
          description: note + '⭐' + r.it.s + (r.it.l ? ' · ' + r.it.l : '') + (r.it.d ? ' · ' + r.it.d.slice(0, 70) : ''),
          payload: r.it.u
        };
      });
    }, function () { return items().length > 0; });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    SVC = (typeof window !== 'undefined' && window.services) || null;
    var z = ztools();
    // 主题：优先问 ztools，拿不到就跟系统；两者都写进 body class，CSS 里优先级高于 :root
    var dark = null;
    try { if (z && typeof z.isDarkColors === 'function') dark = !!z.isDarkColors(); } catch (e) { dark = null; }
    if (dark === null && window.matchMedia) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark === null) dark = false;
    document.body.classList.toggle('dark', dark);
    document.body.classList.toggle('light', !dark);
    if (!SVC) {
      say('没有检测到插件运行环境（window.services）。请通过 ZTools 打开本插件，而不是直接用浏览器打开 index.html。', 'err');
      document.querySelectorAll('button, select, input').forEach(function (b) { b.disabled = true; });
      return;
    }
    bind();
    loadState();
    var z2 = ztools();
    if (z2 && typeof z2.onPluginEnter === 'function') z2.onPluginEnter(handleLaunch);
    if (typeof window.launchParam !== 'undefined' && window.launchParam) handleLaunch(window.launchParam);
    setupMainPush();
    if (!state.accounts.length) { say('第一次使用：点「＋ 添加账号」，填入 GitHub Token（必需）。'); openModal('add'); }
    else if (!state.cache) doRefresh();
    else say('');
  }

  window.__boot = boot;                       // 供自动化测试重复调用
  window.__ghstar = {                          // 供自动化测试读取内部状态
    state: state,
    rows: currentRows,
    setQuery: function (q) { $('q').value = q; query = q; render(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
