/* index.js —— 主界面逻辑（运行在渲染进程，通过 window.reminder 调用 preload 能力） */
(function () {
  'use strict';

  var api = window.reminder;
  var Fmt = window.ZRTimeFormat;
  var Sched = window.ZRSchedule;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var state = {
    items: [],
    editingId: null,
    formMode: 'once',
    formKind: 'daily',
    rowRefs: {}, // id -> { countdown, human, nextRunAt }
    fingerprint: '', // 数据指纹：跨窗口变更检测
    query: '', // 搜索关键词
    focusId: null, // 键盘焦点条目
    visibleIds: [], // 当前页签可见条目顺序（键盘导航用）
    lastPoll: 0, // 上次跨窗口数据轮询时间
    doneRendered: false, // 已完成列表是否已渲染（懒加载，首屏只渲染待提醒）
    historyLoaded: false, // 「记录」页签是否已加载（懒加载）
    statusDot: null, // 状态栏圆点元素缓存（避免每秒重建 DOM）
    statusDotCls: '',
    statusNode: null, // 状态栏文本节点缓存
    statusText: ''
  };

  /* ------------------------------------------------------------------ *
   * 主题
   * ------------------------------------------------------------------ */
  function applyTheme(info) {
    var dark = !!(info && info.isDark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }
  function initTheme() {
    try {
      applyTheme(window.ztools.getThemeInfo());
      window.ztools.onThemeChange(applyTheme);
    } catch (e) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme({ isDark: mq.matches });
      mq.addEventListener && mq.addEventListener('change', function (ev) {
        applyTheme({ isDark: ev.matches });
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 工具
   * ------------------------------------------------------------------ */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function toast(msg, kind) {
    var box = $('quickPreview');
    box.hidden = false;
    box.textContent = msg;
    box.className = 'quick-preview ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      box.hidden = true;
      box.className = 'quick-preview';
    }, 2600);
  }

  /* ------------------------------------------------------------------ *
   * 列表渲染
   * ------------------------------------------------------------------ */
  function refresh(items) {
    applyItems(items || api.list());
  }

  /** 用给定的条目集合重建界面（items 已由调用方读取，避免重复访问数据库） */
  function applyItems(items) {
    state.items = items;
    state.fingerprint = fingerprintOf(items);
    renderLists();
    renderStatus();
  }

  /** 由 id+_rev+updatedAt+关键字段拼出的指纹，用于检测其它窗口（分离窗口等）的数据变更 */
  function fingerprintOf(items) {
    return items
      .map(function (i) {
        return i._id + ':' + (i._rev || '') + ':' + (i.updatedAt || 0) + ':' + i.enabled + ':' + i.nextRunAt;
      })
      .join('|');
  }

  function matchQuery(item) {
    if (!state.query) return true;
    var q = state.query.toLowerCase();
    return (
      String(item.title || '').toLowerCase().indexOf(q) !== -1 ||
      String(item.note || '').toLowerCase().indexOf(q) !== -1
    );
  }

  var GROUP_LABELS = { due: '马上 / 已到期', today: '今天', tomorrow: '明天', week: '本周', later: '更晚' };
  var GROUP_ORDER = ['due', 'today', 'tomorrow', 'week', 'later'];

  function groupOf(item, now) {
    if (item.nextRunAt == null) return 'later';
    if (item.nextRunAt <= now) return 'due';
    var diff = Fmt.dayDiff(item.nextRunAt, now);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    if (diff > 1 && diff < 7) return 'week';
    return 'later';
  }

  function groupHeader(label, count) {
    var li = el('li', 'group-header');
    li.appendChild(document.createTextNode(label));
    li.appendChild(el('span', 'group-count', String(count)));
    return li;
  }

  function renderLists() {
    var now = Date.now();
    var active = state.items.filter(function (i) {
      return i.enabled !== false && matchQuery(i);
    });
    var done = state.items.filter(function (i) {
      return i.enabled === false && matchQuery(i);
    });

    // 角标显示全量（不受搜索影响）
    var totalActive = state.items.filter(function (i) {
      return i.enabled !== false;
    }).length;
    $('countActive').textContent = totalActive || '';
    $('countDone').textContent = (state.items.length - totalActive) || '';
    $('emptyActive').style.display = active.length ? 'none' : '';
    $('emptyDone').style.display = done.length ? 'none' : '';

    var listActive = $('listActive');
    var listDone = $('listDone');
    listActive.textContent = '';
    listDone.textContent = '';
    state.rowRefs = {};

    // 待提醒按时间分组（今天 / 明天 / 本周 / 更晚）
    var buckets = {};
    active.forEach(function (item) {
      var g = groupOf(item, now);
      (buckets[g] = buckets[g] || []).push(item);
    });
    var fragActive = document.createDocumentFragment();
    GROUP_ORDER.forEach(function (g) {
      var list = buckets[g];
      if (!list || !list.length) return;
      fragActive.appendChild(groupHeader(GROUP_LABELS[g], list.length));
      list.forEach(function (item) {
        fragActive.appendChild(buildRow(item, now, true));
      });
    });
    listActive.appendChild(fragActive);

    // 已完成列表懒加载：首次切到「已完成」页签后才渲染，首屏只渲染待提醒，提醒多时打开更快
    if (state.doneRendered) {
      var fragDone = document.createDocumentFragment();
      done.forEach(function (item) {
        fragDone.appendChild(buildRow(item, now, false));
      });
      listDone.appendChild(fragDone);
    }

    // 触发记录（懒加载）：首次切到「记录」页签后渲染
    if (state.historyLoaded) renderHistory();

    // 键盘导航顺序 = 当前页签的可见条目（记录页签无操作，不参与导航）
    var currentPane = document.querySelector('.pane.active');
    var paneId = currentPane ? currentPane.id : 'pane-active';
    if (paneId === 'pane-active') {
      state.visibleIds = active.map(function (i) {
        return i._id;
      });
    } else if (paneId === 'pane-done') {
      state.visibleIds = (state.doneRendered ? done : []).map(function (i) {
        return i._id;
      });
    } else {
      state.visibleIds = [];
    }
    if (state.focusId && state.visibleIds.indexOf(state.focusId) === -1) state.focusId = null;
    if (state.focusId) {
      var focused = document.querySelector('.item[data-id="' + state.focusId + '"]');
      if (focused) focused.classList.add('focused');
    }
  }

  /** 渲染「记录」页签：最近触发历史（最新在前，最多 100 条） */
  function renderHistory() {
    var hist = api.history && api.history.list ? api.history.list() : [];
    $('countHistory').textContent = hist.length || '';
    var ul = $('listHistory');
    ul.textContent = '';
    $('emptyHistory').style.display = hist.length ? 'none' : '';
    var frag = document.createDocumentFragment();
    hist.forEach(function (h) {
      var li = el('li', 'item');
      var main = el('div', 'item-main');
      main.appendChild(el('div', 'item-title', h.title));
      var meta = el('div', 'item-meta');
      meta.appendChild(el('span', 'chip time', Fmt.formatHuman(h.at, Date.now())));
      if (h.note) meta.appendChild(el('span', 'chip', h.note));
      if (h.late > 60 * 1000) {
        meta.appendChild(el('span', 'chip', '迟到 ' + Math.round(h.late / 60000) + ' 分'));
      }
      main.appendChild(meta);
      li.appendChild(main);
      frag.appendChild(li);
    });
    ul.appendChild(frag);
  }

  function buildRow(item, now, isActive) {
    var li = el('li', 'item' + (isActive ? '' : ' disabled'));
    li.dataset.id = item._id;

    // 开关
    var sw = el('label', 'switch');
    var swInput = document.createElement('input');
    swInput.type = 'checkbox';
    swInput.checked = isActive;
    swInput.addEventListener('change', function () {
      onToggle(item, swInput.checked);
    });
    sw.appendChild(swInput);
    sw.appendChild(el('i'));
    li.appendChild(sw);

    // 主体
    var main = el('div', 'item-main');
    main.appendChild(el('div', 'item-title', item.title));
    var meta = el('div', 'item-meta');

    if (isActive && item.nextRunAt) {
      var human = el('span', 'chip time', Fmt.formatHuman(item.nextRunAt, now));
      var countdown = el('span', 'chip countdown', Fmt.formatCountdown(item.nextRunAt - now));
      meta.appendChild(human);
      meta.appendChild(countdown);
      state.rowRefs[item._id] = { human: human, countdown: countdown, nextRunAt: item.nextRunAt };
    } else if (item.lastFiredAt) {
      meta.appendChild(el('span', 'chip', '上次 ' + Fmt.formatHuman(item.lastFiredAt, now)));
    }

    if (item.mode === 'repeat') {
      meta.appendChild(el('span', 'chip repeat', Fmt.formatRepeat(item.repeat)));
    }
    if (item.sound) meta.appendChild(el('span', 'chip', '🔔'));
    if (item.popup) meta.appendChild(el('span', 'chip', '弹窗'));
    if (item.note) meta.appendChild(el('span', 'chip', item.note));
    main.appendChild(meta);
    li.appendChild(main);

    // 操作
    var actions = el('div', 'item-actions');
    if (isActive) {
      // 「稍后」快捷推迟下拉：默认/5/10/30/60 分钟，收拢操作按钮避免排满整行
      var snoozeSel = document.createElement('select');
      snoozeSel.className = 'mini snooze-mini';
      snoozeSel.title = '稍后提醒';
      [['default', '稍后（默认）'], ['5', '稍后5分'], ['10', '稍后10分'], ['30', '稍后30分'], ['60', '稍后60分']].forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        snoozeSel.appendChild(opt);
      });
      snoozeSel.addEventListener('change', function () {
        var v = snoozeSel.value;
        var minutes = v === 'default' ? null : parseInt(v, 10);
        api.snooze(item._id, minutes == null ? undefined : minutes);
        toast('已推迟 ' + (minutes == null ? api.settings.get().snoozeMinutes : minutes) + ' 分钟', 'ok');
        refresh();
      });
      actions.appendChild(snoozeSel);
      actions.appendChild(actionBtn('完成', function () {
        api.complete(item._id);
        refresh();
      }));
    }
    actions.appendChild(actionBtn('编辑', function () {
      openModal(item);
    }));
    actions.appendChild(actionBtn('删除', function () {
      api.remove(item._id);
      refresh();
    }, 'danger'));
    li.appendChild(actions);

    return li;
  }

  function actionBtn(text, onClick, extra) {
    var b = el('button', 'mini' + (extra ? ' ' + extra : ''), text);
    b.addEventListener('click', onClick);
    return b;
  }

  function onToggle(item, checked) {
    if (checked) {
      if (item.nextRunAt == null) {
        // 已完成 / 无下次时间：重新启用需要重算或编辑
        if (item.mode === 'repeat') {
          var next = Sched.computeNextRun(
            { mode: 'repeat', repeat: item.repeat, anchorAt: Date.now() },
            Date.now()
          );
          if (next != null) {
            api.update(item._id, { enabled: true, nextRunAt: next });
            refresh();
            return;
          }
        }
        openModal(item);
        return;
      }
      api.setEnabled(item._id, true);
    } else {
      api.setEnabled(item._id, false);
    }
    refresh();
  }

  /* ------------------------------------------------------------------ *
   * 每秒刷新倒计时 / 状态
   * ------------------------------------------------------------------ */
  // 跨窗口数据变更的轮询间隔：倒计时靠本地缓存计算，无需每秒读库；
  // 仅低频轮询指纹，检测到其它窗口改动时才重建列表。
  var POLL_MS = 5000;

  function tickUI() {
    var now = Date.now();
    var hidden = !!document.hidden;

    // 倒计时：基于 buildRow 时缓存的 nextRunAt 本地计算，避免每秒同步读库阻塞主线程；
    // 页面不可见时跳过每秒倒计时与状态渲染（Chromium 不一定会节流 ZTools 内的隐藏页面）
    if (!hidden) {
      var ids = Object.keys(state.rowRefs);
      for (var i = 0; i < ids.length; i++) {
        var ref = state.rowRefs[ids[i]];
        if (ref.nextRunAt == null) continue;
        var cd = Fmt.formatCountdown(ref.nextRunAt - now);
        if (ref.countdown.textContent !== cd) ref.countdown.textContent = cd;
      }
    }

    // 调度事件只在触发窗口内传播，其它窗口靠低频轮询指纹检测数据变化后重建列表
    if (now - state.lastPoll >= POLL_MS) {
      state.lastPoll = now;
      var items = api.list();
      if (fingerprintOf(items) !== state.fingerprint) {
        applyItems(items);
        return;
      }
    }

    if (!hidden) renderStatus();
  }

  function renderStatus() {
    var st = api.status();
    var next = null;
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (it.enabled !== false && it.nextRunAt) { next = it; break; }
    }

    var text;
    if (!st.running) text = '调度器未运行';
    else if (!st.owner) text = '调度由另一窗口持有';
    else if (next) text = '运行中 · 下一条「' + next.title + '」' + Fmt.formatRelative(next.nextRunAt, Date.now());
    else text = '运行中 · 暂无待提醒';

    var line = $('statusLine');
    var dotCls = 'dot' + (st.running && st.owner ? '' : ' off');

    // 圆点状态变化时才重建节点；否则仅按需更新文本，避免每秒重排状态栏
    if (!state.statusDot || state.statusDot.parentNode !== line || state.statusDotCls !== dotCls) {
      line.textContent = '';
      state.statusDot = el('span', dotCls);
      line.appendChild(state.statusDot);
      state.statusDotCls = dotCls;
      state.statusNode = document.createTextNode(text);
      line.appendChild(state.statusNode);
      state.statusText = text;
    } else if (text !== state.statusText) {
      state.statusNode.nodeValue = text;
      state.statusText = text;
    }

    var setStatus = $('setStatus');
    if (setStatus) {
      var s = (st.running ? '已启动' : '未启动') + (st.owner ? '（本窗口持锁）' : '（锁在其它窗口）');
      if (setStatus.textContent !== s) setStatus.textContent = s;
    }
  }

  /* ------------------------------------------------------------------ *
   * 快速创建（规则解析 + AI 兜底）
   * ------------------------------------------------------------------ */
  var parseState = { text: '', rule: null, ai: null, pending: false, error: '', aiTimer: null };

  function describeParse(r) {
    return (
      '将创建：' + r.title + ' · ' +
      (r.mode === 'repeat'
        ? Fmt.formatRepeat(r.repeat) + '，下次 ' + Fmt.formatHuman(r.nextRunAt, Date.now())
        : Fmt.formatHuman(r.nextRunAt, Date.now()) + '（' + Fmt.formatRelative(r.nextRunAt, Date.now()) + '）')
    );
  }

  function currentParse() {
    if (parseState.rule && parseState.rule.ok) return parseState.rule;
    if (parseState.ai && parseState.ai.ok) return parseState.ai;
    return null;
  }

  function updateQuickPreview() {
    // 取消待触发的 toast 隐藏定时器，避免预览刚显示就被藏起来
    clearTimeout(toast._t);
    var text = $('quickInput').value.trim();
    var box = $('quickPreview');
    parseState.text = text;
    parseState.ai = null;
    parseState.pending = false;
    if (!text) {
      box.hidden = true;
      box.className = 'quick-preview';
      return;
    }
    var r = api.parse(text);
    parseState.rule = r;
    box.hidden = false;
    if (r.ok) {
      box.className = 'quick-preview ok';
      box.textContent = describeParse(r);
      return;
    }
    parseState.error = r.error;
    var llmCfg = api.llm.get();
    if (llmCfg.enabled && llmCfg.useWhenRuleFails !== false) {
      box.className = 'quick-preview';
      box.textContent = '规则未识别，AI 解析中…';
      parseState.pending = true;
      // 防抖：停止输入 350ms 后再请求，避免每次按键都调用大模型
      clearTimeout(parseState.aiTimer);
      parseState.aiTimer = setTimeout(function () {
        parseState.aiTimer = null;
        api.llm.parse(text).then(function (ai) {
          if (parseState.text !== text) return;
          parseState.pending = false;
          parseState.ai = ai;
          if (ai.ok) {
            box.className = 'quick-preview ok';
            box.textContent = '🤖 ' + describeParse(ai);
          } else {
            box.className = 'quick-preview err';
            box.textContent = r.error + '（AI：' + (ai.error || '解析失败') + '）';
          }
        });
      }, 350);
    } else {
      box.className = 'quick-preview err';
      box.textContent = r.error;
    }
  }

  function quickAdd() {
    if (parseState.pending) {
      toast('AI 解析中，请稍候…', 'err');
      return;
    }
    var r = currentParse();
    if (!r) {
      toast(parseState.error || '无法识别', 'err');
      return;
    }
    api.create({
      title: r.title,
      mode: r.mode,
      at: r.mode === 'once' ? r.at : null,
      repeat: r.mode === 'repeat' ? r.repeat : null,
      nextRunAt: r.nextRunAt
    });
    $('quickInput').value = '';
    $('quickPreview').hidden = true;
    toast('已添加：' + r.title + (r.source === 'ai' ? '（AI 解析）' : ''), 'ok');
    refresh();
  }

  /* ------------------------------------------------------------------ *
   * 新建 / 编辑弹窗
   * ------------------------------------------------------------------ */
  function setSegActive(container, attr, value) {
    Array.prototype.forEach.call(container.querySelectorAll('button'), function (b) {
      b.classList.toggle('active', b.dataset[attr] === value);
    });
  }

  function syncRepeatFields() {
    var kind = state.formKind;
    $('rfInterval').style.display = kind === 'interval' ? '' : 'none';
    $('rfTime').style.display = kind === 'interval' || kind === 'hourly' ? 'none' : '';
    $('rfMonthDay').style.display = kind === 'monthly' ? '' : 'none';
    $('rfWeekdays').style.display = kind === 'weekly' ? '' : 'none';
    $('rfActiveWrap').style.display = kind === 'interval' || kind === 'hourly' ? '' : 'none';
    syncEndFields();
  }

  function syncEndFields() {
    var endKind = $('fEndKind').value;
    $('rfEndDate').hidden = endKind !== 'date';
    $('rfEndCount').hidden = endKind !== 'count';
  }

  function collectForm() {
    var title = $('fTitle').value.trim();
    var data = {
      title: title,
      note: $('fNote').value.trim(),
      sound: $('fSound').checked,
      popup: $('fPopup').checked,
      mode: state.formMode
    };

    if (state.formMode === 'once') {
      var dateStr = $('fDate').value;
      var timeStr = $('fTime').value || '09:00';
      var ts = dateStr ? new Date(dateStr + 'T' + timeStr).getTime() : NaN;
      if (!isFinite(ts)) return { error: '请选择日期' };
      data.at = ts;
      data.nextRunAt = ts;
      data.repeat = null;
    } else {
      var repeat = { kind: state.formKind };
      if (state.formKind === 'interval') {
        repeat.everyMinutes = parseInt($('fEvery').value, 10) || 30;
      } else if (state.formKind === 'monthly') {
        repeat.dayOfMonth = parseInt($('fMonthDay').value, 10) || 1;
        repeat.timeOfDay = $('fRepeatTime').value || '09:00';
      } else if (state.formKind !== 'hourly') {
        repeat.timeOfDay = $('fRepeatTime').value || '09:00';
        if (state.formKind === 'weekly') {
          repeat.weekdays = Array.prototype.slice
            .call($('rfWeekdays').querySelectorAll('input:checked'))
            .map(function (i) {
              return Number(i.value);
            });
          if (!repeat.weekdays.length) return { error: '请至少选择一个星期' };
        }
      }
      // 生效时段（interval / hourly）：避免半夜打扰
      if (state.formKind === 'interval' || state.formKind === 'hourly') {
        var af = $('fActiveFrom').value;
        var ato = $('fActiveTo').value;
        if (af && ato) {
          repeat.activeFrom = af;
          repeat.activeTo = ato;
        } else if (af || ato) {
          return { error: '生效时段需同时填写开始与结束' };
        }
      }
      // 结束条件：到日期为止 / 按触发次数
      var endKind = $('fEndKind').value;
      if (endKind === 'date') {
        var untilStr = $('fUntil').value;
        if (!untilStr) return { error: '请选择截止日期' };
        repeat.until = new Date(untilStr + 'T23:59:59').getTime();
      } else if (endKind === 'count') {
        var mc = parseInt($('fMaxCount').value, 10);
        if (!mc || mc < 1) return { error: '触发次数需大于 0' };
        repeat.maxCount = mc;
      }
      repeat = Sched.normalizeRepeat(repeat);
      var next = Sched.computeNextRun({ mode: 'repeat', repeat: repeat, anchorAt: Date.now() }, Date.now());
      if (next == null) return { error: '无法计算下次时间（请检查结束条件是否已过、时段是否合理）' };
      data.repeat = repeat;
      data.at = null;
      data.nextRunAt = next;
    }
    return data;
  }

  function updateFormPreview() {
    var box = $('formPreview');
    var d = collectForm();
    if (d.error) {
      box.textContent = d.error;
      return;
    }
    if (!d.title) {
      box.textContent = '请填写提醒内容';
      return;
    }
    if (d.mode === 'repeat') {
      box.textContent = Fmt.formatRepeat(d.repeat) + ' · 下次 ' + Fmt.formatHuman(d.nextRunAt, Date.now());
    } else {
      box.textContent = Fmt.formatHuman(d.nextRunAt, Date.now()) + '（' + Fmt.formatRelative(d.nextRunAt, Date.now()) + '）';
    }
  }

  function openModal(item) {
    state.editingId = item ? item._id : null;
    $('modalTitle').textContent = item ? '编辑提醒' : '新建提醒';

    var settings = api.settings.get();
    if (item) {
      $('fTitle').value = item.title;
      $('fNote').value = item.note || '';
      $('fSound').checked = item.sound !== false;
      $('fPopup').checked = !!item.popup;
      state.formMode = item.mode === 'repeat' ? 'repeat' : 'once';
      if (item.mode === 'repeat') {
        state.formKind = item.repeat.kind;
        $('fEvery').value = item.repeat.everyMinutes || 30;
        $('fRepeatTime').value = item.repeat.timeOfDay || '09:00';
        $('fMonthDay').value = item.repeat.dayOfMonth || 1;
        Array.prototype.forEach.call($('rfWeekdays').querySelectorAll('input'), function (i) {
          i.checked = (item.repeat.weekdays || []).indexOf(Number(i.value)) !== -1;
        });
        $('fActiveFrom').value = item.repeat.activeFrom || '';
        $('fActiveTo').value = item.repeat.activeTo || '';
        var hasCount = parseInt(item.repeat.maxCount, 10) > 0;
        $('fEndKind').value = hasCount ? 'count' : item.repeat.until ? 'date' : 'never';
        $('fUntil').value = item.repeat.until ? Fmt.formatDate(item.repeat.until) : '';
        $('fMaxCount').value = hasCount ? item.repeat.maxCount : 10;
      } else {
        var d = new Date(item.at || item.nextRunAt || Date.now());
        $('fDate').value = Fmt.formatDate(d.getTime());
        $('fTime').value = Fmt.formatClock(d.getTime());
      }
    } else {
      $('fTitle').value = '';
      $('fNote').value = '';
      $('fSound').checked = !!settings.sound;
      $('fPopup').checked = !!settings.popup;
      state.formMode = 'once';
      state.formKind = 'daily';
      var base = new Date(Date.now() + 3600 * 1000);
      base.setMinutes(0, 0, 0);
      $('fDate').value = Fmt.formatDate(base.getTime());
      $('fTime').value = Fmt.formatClock(base.getTime());
      $('fEvery').value = 30;
      $('fRepeatTime').value = '09:00';
      $('fMonthDay').value = 1;
      $('fActiveFrom').value = '';
      $('fActiveTo').value = '';
      $('fEndKind').value = 'never';
      $('fUntil').value = '';
      $('fMaxCount').value = 10;
      Array.prototype.forEach.call($('rfWeekdays').querySelectorAll('input'), function (i) {
        i.checked = false;
      });
    }

    setSegActive($('fModeSeg'), 'mode', state.formMode);
    setSegActive($('fKindSeg'), 'kind', state.formKind);
    $('onceFields').hidden = state.formMode !== 'once';
    $('repeatFields').hidden = state.formMode !== 'repeat';
    syncRepeatFields();
    updateFormPreview();
    $('modal').hidden = false;
    setTimeout(function () {
      $('fTitle').focus();
    }, 30);
  }

  function closeModal() {
    $('modal').hidden = true;
    state.editingId = null;
  }

  function submitForm(ev) {
    ev.preventDefault();
    var d = collectForm();
    if (d.error) {
      toast(d.error, 'err');
      return;
    }
    if (state.editingId) {
      api.update(state.editingId, {
        title: d.title,
        note: d.note,
        mode: d.mode,
        at: d.at,
        repeat: d.repeat,
        nextRunAt: d.nextRunAt,
        sound: d.sound,
        popup: d.popup,
        enabled: true
      });
      toast('已保存', 'ok');
    } else {
      api.create(d);
      toast('已添加：' + d.title, 'ok');
    }
    closeModal();
    refresh();
  }

  /* ------------------------------------------------------------------ *
   * 设置
   * ------------------------------------------------------------------ */
  function loadSettings() {
    var s = api.settings.get();
    $('setSound').checked = !!s.sound;
    $('setPopup').checked = !!s.popup;
    $('setBeep').value = s.beepTimes;
    $('setSnooze').value = s.snoozeMinutes;
    var hy = $('setHolidayYears');
    if (hy) {
      try {
        hy.textContent = api.holidays ? api.holidays.coveredYears().join('、') + ' 年' : '—';
      } catch (e) {
        hy.textContent = '—';
      }
    }
    loadChannels();
    loadLlm();
  }

  function bindSettings() {
    $('setSound').addEventListener('change', function () {
      api.settings.set({ sound: this.checked });
    });
    $('setPopup').addEventListener('change', function () {
      api.settings.set({ popup: this.checked });
    });
    $('setBeep').addEventListener('change', function () {
      api.settings.set({ beepTimes: Math.min(10, Math.max(1, parseInt(this.value, 10) || 3)) });
      loadSettings();
    });
    $('setSnooze').addEventListener('change', function () {
      api.settings.set({ snoozeMinutes: Math.min(720, Math.max(1, parseInt(this.value, 10) || 10)) });
      loadSettings();
    });
    $('btnTestNotify').addEventListener('click', function () {
      api.testNotify();
    });
    $('btnTick').addEventListener('click', function () {
      api.tickNow();
      refresh();
      toast('已扫描一次', 'ok');
    });
  }

  /* ------------------------------------------------------------------ *
   * 数据导入 / 导出（Excel）
   * ------------------------------------------------------------------ */
  function bindData() {
    $('btnImport').addEventListener('click', function () {
      var r = api.data.importFromFile();
      if (r.cancelled) return;
      if (!r.ok) {
        toast(r.error, 'err');
        return;
      }
      var rep = r.report;
      toast(
        '导入完成：新增 ' + rep.added + ' 条' +
          (rep.skippedExpired ? '，过期归入已完成 ' + rep.skippedExpired + ' 条' : '') +
          (rep.skippedInvalid ? '，无效跳过 ' + rep.skippedInvalid + ' 条' : ''),
        'ok'
      );
      refresh();
    });
    $('btnExportDone').addEventListener('click', function () {
      var r = api.data.exportToFile('done');
      if (r.cancelled) return;
      if (!r.ok) {
        toast(r.error, 'err');
        return;
      }
      toast('已完成：已导出 ' + r.count + ' 条', 'ok');
    });
    $('btnImportIcs').addEventListener('click', function () {
      var r = api.data.importIcsFile();
      if (r.cancelled) return;
      if (!r.ok) {
        toast(r.error, 'err');
        return;
      }
      var rep = r.report;
      toast(
        'ICS 导入完成：新增 ' + rep.added + ' 条' +
          (rep.skippedExpired ? '，过期归入已完成 ' + rep.skippedExpired + ' 条' : '') +
          (rep.skippedInvalid ? '，无效跳过 ' + rep.skippedInvalid + ' 条' : ''),
        'ok'
      );
      refresh();
    });
    $('btnExportIcs').addEventListener('click', function () {
      var r = api.data.exportIcsToFile('all');
      if (r.cancelled) return;
      if (!r.ok) {
        toast(r.error, 'err');
        return;
      }
      toast('已导出 ' + r.count + ' 条到 ICS', 'ok');
    });
  }

  /* ------------------------------------------------------------------ *
   * 提醒通道（邮件 / 短信 / Webhook）
   * ------------------------------------------------------------------ */
  function loadChannels() {
    var ch = api.channels.get();
    var sec = api.secrets.has();
    $('chEnabled').checked = !!ch.enabled;

    var s = ch.smtp || {};
    $('smtpEnabled').checked = !!s.enabled;
    $('smtpHost').value = s.host || '';
    $('smtpPort').value = s.port != null ? s.port : 465;
    $('smtpSecure').value = s.secure === false ? '0' : '1';
    $('smtpUser').value = s.user || '';
    $('smtpFrom').value = s.from || '';
    $('smtpTo').value = s.to || '';
    $('smtpPass').value = '';
    $('smtpPassState').textContent = sec.smtpPass ? '已保存' : '未保存';

    var m = ch.smsbao || {};
    $('smsEnabled').checked = !!m.enabled;
    $('smsUser').value = m.user || '';
    $('smsPhone').value = m.phone || '';
    $('smsKey').value = '';
    $('smsKeyState').textContent = sec.smsbaoKey ? '已保存' : '未保存';

    var w = ch.webhook || {};
    $('webhookEnabled').checked = !!w.enabled;
    $('webhookUrl').value = w.url || '';
    $('webhookMethod').value = w.method || 'POST';
    $('webhookCt').value = w.contentType || 'json';
    $('webhookTemplate').value = w.template || '';

    // 常用服务预设：首次填充选项；根据已存模板反推选中项
    var psel = $('webhookPreset');
    var presets = api.channels.presets || [];
    if (psel) {
      if (!psel.options.length) {
        presets.forEach(function (p) {
          var opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.label;
          psel.appendChild(opt);
        });
      }
      psel.value = 'custom';
      presets.forEach(function (p) {
        if (p.template && w.template && p.template === w.template) psel.value = p.id;
      });
      var cur = null;
      presets.forEach(function (p) {
        if (p.id === psel.value) cur = p;
      });
      $('webhookUrl').placeholder = (cur && cur.urlHint) || 'https://…';
    }
  }

  function saveChannels() {
    api.channels.set({
      enabled: $('chEnabled').checked,
      smtp: {
        enabled: $('smtpEnabled').checked,
        host: $('smtpHost').value.trim(),
        port: parseInt($('smtpPort').value, 10) || 465,
        secure: $('smtpSecure').value === '1',
        user: $('smtpUser').value.trim(),
        from: $('smtpFrom').value.trim(),
        to: $('smtpTo').value.trim()
      },
      smsbao: {
        enabled: $('smsEnabled').checked,
        user: $('smsUser').value.trim(),
        phone: $('smsPhone').value.trim()
      },
      webhook: {
        enabled: $('webhookEnabled').checked,
        url: $('webhookUrl').value.trim(),
        method: $('webhookMethod').value,
        contentType: $('webhookCt').value,
        template: $('webhookTemplate').value
      }
    });
  }

  function bindChannels() {
    // 通道卡片折叠交互：点头部（除测试按钮外）展开/收起表单
    Array.prototype.forEach.call(document.querySelectorAll('.channel'), function (card) {
      var head = card.querySelector('.channel-head');
      if (!head) return;
      head.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('button')) return; // 测试按钮不触发折叠
        card.classList.toggle('open');
      });
    });

    [
      'chEnabled', 'smtpEnabled', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFrom', 'smtpTo',
      'smsEnabled', 'smsUser', 'smsPhone',
      'webhookEnabled', 'webhookUrl', 'webhookMethod', 'webhookCt', 'webhookTemplate'
    ].forEach(function (id) {
      $(id).addEventListener('change', saveChannels);
    });

    $('smtpPass').addEventListener('change', function () {
      if (!this.value) return;
      var has = api.secrets.set({ smtpPass: this.value });
      this.value = '';
      $('smtpPassState').textContent = has.smtpPass ? '已保存' : '未保存';
      toast('SMTP 密码已加密保存', 'ok');
    });
    $('smsKey').addEventListener('change', function () {
      if (!this.value) return;
      var has = api.secrets.set({ smsbaoKey: this.value });
      this.value = '';
      $('smsKeyState').textContent = has.smsbaoKey ? '已保存' : '未保存';
      toast('短信宝密钥已加密保存', 'ok');
    });

    function test(kind, btn) {
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '发送中…';
      api.channels.test(kind).then(function (r) {
        btn.disabled = false;
        btn.textContent = old;
        toast(r.ok ? '测试发送成功' : '测试失败：' + r.error, r.ok ? 'ok' : 'err');
      });
    }
    $('btnTestSmtp').addEventListener('click', function () {
      saveChannels();
      test('smtp', this);
    });
    $('btnTestSms').addEventListener('click', function () {
      saveChannels();
      test('smsbao', this);
    });
    $('btnTestWebhook').addEventListener('click', function () {
      saveChannels();
      test('webhook', this);
    });
    $('webhookPreset').addEventListener('change', function () {
      var value = this.value;
      var preset = null;
      (api.channels.presets || []).forEach(function (x) {
        if (x.id === value) preset = x;
      });
      if (preset && preset.id !== 'custom') {
        $('webhookCt').value = preset.contentType;
        $('webhookTemplate').value = preset.template;
        $('webhookUrl').placeholder = preset.urlHint || 'https://…';
      } else {
        $('webhookUrl').placeholder = 'https://…';
      }
      saveChannels();
    });
  }

  /* ------------------------------------------------------------------ *
   * 大语言模型
   * ------------------------------------------------------------------ */
  function loadLlm() {
    var cfg = api.llm.get();
    var sec = api.secrets.has();
    $('llmEnabled').checked = !!cfg.enabled;
    $('llmFallback').checked = cfg.useWhenRuleFails !== false;
    $('llmBaseUrl').value = cfg.baseUrl || '';
    $('llmModel').value = cfg.model || '';
    $('llmTemp').value = cfg.temperature != null ? cfg.temperature : 0.2;
    $('llmKey').value = '';
    $('llmKeyState').textContent = sec.llmApiKey ? '已保存' : '未保存';

    var sel = $('llmPreset');
    sel.textContent = '';
    api.llm.presets.forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
    sel.value = 'custom';
    api.llm.presets.forEach(function (p) {
      if (p.baseUrl && p.baseUrl === cfg.baseUrl) sel.value = p.id;
    });
  }

  function saveLlm() {
    api.llm.set({
      enabled: $('llmEnabled').checked,
      useWhenRuleFails: $('llmFallback').checked,
      baseUrl: $('llmBaseUrl').value.trim(),
      model: $('llmModel').value.trim(),
      temperature: parseFloat($('llmTemp').value) || 0.2
    });
  }

  function bindLlm() {
    ['llmEnabled', 'llmFallback', 'llmBaseUrl', 'llmModel', 'llmTemp'].forEach(function (id) {
      $(id).addEventListener('change', saveLlm);
    });
    $('llmPreset').addEventListener('change', function () {
      var value = this.value;
      var preset = null;
      api.llm.presets.forEach(function (x) {
        if (x.id === value) preset = x;
      });
      if (preset && preset.id !== 'custom') {
        $('llmBaseUrl').value = preset.baseUrl;
        $('llmModel').value = preset.model;
      }
      saveLlm();
    });
    $('llmKey').addEventListener('change', function () {
      if (!this.value) return;
      var has = api.secrets.set({ llmApiKey: this.value });
      this.value = '';
      $('llmKeyState').textContent = has.llmApiKey ? '已保存' : '未保存';
      toast('API Key 已加密保存', 'ok');
    });
    $('btnTestLlm').addEventListener('click', function () {
      saveLlm();
      var btn = this;
      btn.disabled = true;
      var old = btn.textContent;
      btn.textContent = '测试中…';
      api.llm.test().then(function (r) {
        btn.disabled = false;
        btn.textContent = old;
        toast(r.ok ? '连接成功：' + r.reply : '连接失败：' + r.error, r.ok ? 'ok' : 'err');
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 事件绑定
   * ------------------------------------------------------------------ */
  function bind() {
    // 页签
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
          t.classList.toggle('active', t === tab);
        });
        Array.prototype.forEach.call(document.querySelectorAll('.pane'), function (p) {
          p.classList.toggle('active', p.id === 'pane-' + tab.dataset.tab);
        });
        // 懒加载：首次切到「已完成」/「记录」页签时再渲染
        if (tab.dataset.tab === 'done') state.doneRendered = true;
        if (tab.dataset.tab === 'history') state.historyLoaded = true;
        renderLists(); // 刷新键盘导航的可见条目
      });
    });

    // 搜索过滤
    $('searchInput').addEventListener('input', function () {
      state.query = this.value.trim();
      renderLists();
    });

    // 快速创建
    $('quickInput').addEventListener('input', updateQuickPreview);
    $('quickInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        quickAdd();
      }
    });
    $('quickAdd').addEventListener('click', quickAdd);

    // 顶栏
    $('btnNew').addEventListener('click', function () {
      openModal(null);
    });
    $('btnTest').addEventListener('click', function () {
      api.testNotify();
    });

    // 已完成
    $('btnClearDone').addEventListener('click', function () {
      var done = state.items.filter(function (i) {
        return i.enabled === false;
      });
      done.forEach(function (i) {
        api.remove(i._id);
      });
      refresh();
      toast('已清空 ' + done.length + ' 条', 'ok');
    });

    // 触发记录
    $('btnClearHistory').addEventListener('click', function () {
      api.history.clear();
      renderHistory();
      toast('已清空触发记录', 'ok');
    });

    // 弹窗：模式 / 重复类型切换
    Array.prototype.forEach.call($('fModeSeg').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        state.formMode = b.dataset.mode;
        setSegActive($('fModeSeg'), 'mode', state.formMode);
        $('onceFields').hidden = state.formMode !== 'once';
        $('repeatFields').hidden = state.formMode !== 'repeat';
        updateFormPreview();
      });
    });
    Array.prototype.forEach.call($('fKindSeg').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        state.formKind = b.dataset.kind;
        setSegActive($('fKindSeg'), 'kind', state.formKind);
        syncRepeatFields();
        updateFormPreview();
      });
    });

    // 表单实时预览
    ['fTitle', 'fDate', 'fTime', 'fEvery', 'fRepeatTime', 'fMonthDay', 'fNote', 'fActiveFrom', 'fActiveTo', 'fUntil', 'fMaxCount'].forEach(function (id) {
      $(id).addEventListener('input', updateFormPreview);
    });
    $('fEndKind').addEventListener('change', function () {
      syncEndFields();
      updateFormPreview();
    });
    $('fSound').addEventListener('change', updateFormPreview);
    $('fPopup').addEventListener('change', updateFormPreview);
    Array.prototype.forEach.call($('rfWeekdays').querySelectorAll('input'), function (i) {
      i.addEventListener('change', updateFormPreview);
    });

    $('form').addEventListener('submit', submitForm);
    $('btnCancel').addEventListener('click', closeModal);
    $('modal').addEventListener('click', function (e) {
      if (e.target === $('modal')) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('modal').hidden) closeModal();
    });

    bindSettings();
    bindData();
    bindChannels();
    bindLlm();
    bindKeyboard();

    // 调度事件 -> 刷新
    api.onEvent(function () {
      refresh();
    });
  }

  /* ------------------------------------------------------------------ *
   * 键盘导航：↑↓ 选择、Enter 完成、Delete 删除
   * ------------------------------------------------------------------ */
  function setFocus(id) {
    state.focusId = id;
    Array.prototype.forEach.call(document.querySelectorAll('.item.focused'), function (li) {
      li.classList.remove('focused');
    });
    if (!id) return;
    var li = document.querySelector('.item[data-id="' + id + '"]');
    if (li) {
      li.classList.add('focused');
      if (li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
    }
  }

  function bindKeyboard() {
    document.addEventListener('keydown', function (e) {
      if (!$('modal').hidden) return; // 弹窗打开时不拦截（Esc 已单独处理）
      var tag = ((e.target && e.target.tagName) || '').toLowerCase();
      var inField = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (inField) {
        // 搜索框内 Esc 清空搜索
        if (e.key === 'Escape' && e.target === $('searchInput')) {
          $('searchInput').value = '';
          state.query = '';
          renderLists();
        }
        return;
      }
      var ids = state.visibleIds || [];
      if (!ids.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var idx = ids.indexOf(state.focusId);
        idx = e.key === 'ArrowDown' ? Math.min(ids.length - 1, idx + 1) : Math.max(0, idx <= 0 ? 0 : idx - 1);
        setFocus(ids[idx]);
      } else if (e.key === 'Enter') {
        if (!state.focusId) return;
        e.preventDefault();
        api.complete(state.focusId);
        refresh();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!state.focusId) return;
        e.preventDefault();
        if (window.confirm('确定删除这条提醒？')) {
          api.remove(state.focusId);
          state.focusId = null;
          refresh();
        }
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function handleLaunch(param) {
    if (param && param.code === 'quick-add' && param.payload) {
      $('quickInput').value = String(param.payload);
      updateQuickPreview();
      $('quickInput').focus();
    }
  }

  function init() {
    initTheme();
    try {
      window.ztools.setExpendHeight(620);
    } catch (e) {
      /* 忽略 */
    }
    bind();
    loadSettings();
    refresh();
    setInterval(tickUI, 1000);

    try {
      window.ztools.onPluginEnter(handleLaunch);
    } catch (e) {
      /* 忽略 */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
