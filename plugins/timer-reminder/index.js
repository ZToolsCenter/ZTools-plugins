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
    rowRefs: {} // id -> { countdown, human }
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

  function describeItem(item, now) {
    if (item.mode === 'repeat') {
      return Fmt.formatRepeat(item.repeat);
    }
    return Fmt.formatHuman(item.at || item.nextRunAt, now);
  }

  /* ------------------------------------------------------------------ *
   * 列表渲染
   * ------------------------------------------------------------------ */
  function refresh() {
    state.items = api.list();
    renderLists();
    renderStatus();
  }

  function renderLists() {
    var now = Date.now();
    var active = state.items.filter(function (i) {
      return i.enabled !== false;
    });
    var done = state.items.filter(function (i) {
      return i.enabled === false;
    });

    $('countActive').textContent = active.length || '';
    $('countDone').textContent = done.length || '';
    $('emptyActive').style.display = active.length ? 'none' : '';
    $('emptyDone').style.display = done.length ? 'none' : '';

    var listActive = $('listActive');
    var listDone = $('listDone');
    listActive.textContent = '';
    listDone.textContent = '';
    state.rowRefs = {};

    active.forEach(function (item) {
      listActive.appendChild(buildRow(item, now, true));
    });
    done.forEach(function (item) {
      listDone.appendChild(buildRow(item, now, false));
    });
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
      state.rowRefs[item._id] = { human: human, countdown: countdown };
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
      actions.appendChild(actionBtn('稍后', function () {
        api.snooze(item._id);
        toast('已推迟 ' + api.settings.get().snoozeMinutes + ' 分钟', 'ok');
        refresh();
      }));
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
  function tickUI() {
    var now = Date.now();
    Object.keys(state.rowRefs).forEach(function (id) {
      var ref = state.rowRefs[id];
      var item = api.get(id);
      if (!item || item.nextRunAt == null) return;
      ref.countdown.textContent = Fmt.formatCountdown(item.nextRunAt - now);
      ref.human.textContent = Fmt.formatHuman(item.nextRunAt, now);
    });
    renderStatus();
  }

  function renderStatus() {
    var st = api.status();
    var line = $('statusLine');
    var next = state.items.filter(function (i) {
      return i.enabled !== false && i.nextRunAt;
    })[0];

    var dot = el('span', 'dot' + (st.running && st.owner ? '' : ' off'));
    line.textContent = '';
    line.appendChild(dot);

    if (!st.running) {
      line.appendChild(document.createTextNode('调度器未运行'));
    } else if (!st.owner) {
      line.appendChild(document.createTextNode('调度由另一窗口持有'));
    } else if (next) {
      line.appendChild(
        document.createTextNode(
          '运行中 · 下一条「' + next.title + '」' + Fmt.formatRelative(next.nextRunAt, Date.now())
        )
      );
    } else {
      line.appendChild(document.createTextNode('运行中 · 暂无待提醒'));
    }

    var setStatus = $('setStatus');
    if (setStatus) {
      setStatus.textContent =
        (st.running ? '已启动' : '未启动') + (st.owner ? '（本窗口持锁）' : '（锁在其它窗口）');
    }
  }

  /* ------------------------------------------------------------------ *
   * 快速创建（规则解析 + AI 兜底）
   * ------------------------------------------------------------------ */
  var parseState = { text: '', rule: null, ai: null, pending: false, error: '' };

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
      repeat = Sched.normalizeRepeat(repeat);
      var next = Sched.computeNextRun({ mode: 'repeat', repeat: repeat, anchorAt: Date.now() }, Date.now());
      if (next == null) return { error: '无法计算下次时间' };
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
      });
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
    ['fTitle', 'fDate', 'fTime', 'fEvery', 'fRepeatTime', 'fMonthDay', 'fNote'].forEach(function (id) {
      $(id).addEventListener('input', updateFormPreview);
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

    // 调度事件 -> 刷新
    api.onEvent(function () {
      refresh();
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
