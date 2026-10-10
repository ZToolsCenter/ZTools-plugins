/**
 * Scoop 包管理器 · 页面逻辑（无 Node 环境，只调 window.services = preload.js 暴露的接口）
 * 结构：顶部动作条 + 五个页签 + 底部任务日志抽屉。
 * 约定：所有写操作（安装/更新/卸载/bucket/清理）走 runOp()：互斥、进抽屉、行内日志、结束自动刷新。
 */
(function () {
  'use strict';
  const S = window.services;
  const $ = (sel) => document.querySelector(sel);

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtTime(ts) {
    if (!ts) return '--';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '--';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  /** 表格里只显示日期（时分秒挤操作列的宽度），完整时间放 title 悬停 */
  function fmtDate(ts) {
    if (!ts) return '--';
    const d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '--';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Number(n) || 0, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
  }
  function setStatus(text, busy) {
    $('#status-text').textContent = text;
    $('#statusbar').classList.toggle('busy', !!busy);
  }
  /** 两步确认：第一次点变成"确认?"，3 秒内再点才真的执行 */
  function armConfirm(btn) {
    if (btn.dataset.armed === '1') { delete btn.dataset.armed; btn.textContent = btn.dataset.label; return true; }
    btn.dataset.label = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = '确认?';
    // 6 秒：要留给用户读状态栏提示 + 按 Alt 的时间，3 秒经常不够
    setTimeout(() => {
      if (btn.dataset.armed === '1') { delete btn.dataset.armed; btn.textContent = btn.dataset.label; }
    }, 6000);
    return false;
  }

  // ---------- 主题 ----------
  function applyTheme() {
    try { document.body.classList.toggle('dark', !!(S.theme() && S.theme().isDark)); } catch (e) {}
  }
  applyTheme();
  try { S.onThemeChange(applyTheme); } catch (e) {}

  // ---------- 任务运行（互斥 + 日志抽屉） ----------
  const drawer = $('#drawer'), drawerLog = $('#drawer-log'), drawerTitle = $('#drawer-title');
  $('#btn-drawer-close').onclick = () => { drawer.hidden = true; };
  $('#btn-drawer-toggle').onclick = () => { drawer.hidden = false; };
  $('#btn-op-stop').onclick = () => {
    try { S.stopOp(); } catch (e) {}
    appendLog('⏹ 已请求终止', 'err');
    setStatus('任务已终止');
    setBusy(false);
  };

  let busy = false;
  function setBusy(b) {
    busy = b;
    document.querySelectorAll('#main .btn, #topbar .btn, #setup .btn').forEach((x) => { x.disabled = b; });
    $('#btn-drawer-toggle').disabled = false;
    $('#btn-drawer-close').disabled = false;
    $('#btn-op-stop').disabled = !b;
    $('#statusbar').classList.toggle('busy', b);
  }
  function appendLog(line, cls) {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = line;
    drawerLog.appendChild(div);
    drawerLog.scrollTop = drawerLog.scrollHeight;
  }

  /**
   * 运行一个写操作：抢互斥锁 → 开抽屉 → 流式收日志 → 结束刷新当前页签。
   * @param label 任务名（抽屉标题/状态栏）
   * @param fn(preload 里带 onLine 参数的服务函数) 调用时传入行回调
   * @param refresh 完成后的刷新函数（可空）
   */
  async function runOp(label, fn, refresh) {
    if (busy) { S.notify('已有任务在执行，请先等它结束或终止'); return; }
    drawer.hidden = false;
    drawerLog.innerHTML = '';
    drawerTitle.textContent = label;
    appendLog('$ scoop ' + label);
    setBusy(true);
    setStatus(label + ' …', true);
    const t0 = Date.now();
    try {
      await fn((line) => appendLog(line));
      const secs = Math.round((Date.now() - t0) / 1000);
      appendLog('✅ 完成，用时 ' + secs + 's');
      setStatus(label + ' 完成（' + secs + 's）');
      try { S.notify(label + ' 完成'); } catch (e) {}
      if (refresh) refresh();
    } catch (e) {
      appendLog('❌ ' + (e && e.message ? e.message : e), 'err');
      setStatus(label + ' 失败');
    } finally {
      setBusy(false);
    }
  }

  // ---------- 页签 ----------
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((t) => {
    t.onclick = () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      document.querySelectorAll('.pane').forEach((p) => p.classList.remove('active'));
      $('#pane-' + t.dataset.tab).classList.add('active');
      if (t.dataset.tab === 'installed') loadInstalled();
      if (t.dataset.tab === 'bucket') loadBuckets();
      if (t.dataset.tab === 'cache') loadCache();
    };
  });

  // ---------- 已安装 ----------
  let installedApps = [];
  async function loadInstalled() {
    const tbody = $('#tbl-installed tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="dim">加载中…</td></tr>';
    setStatus('读取已安装列表 …', true);
    try {
      const r = await S.installed();
      installedApps = r.apps;
      $('#cnt-installed').textContent = installedApps.length;
      $('#installed-meta').textContent = '共 ' + installedApps.length + ' 个应用';
      renderInstalled();
      showWarnings('#installed-warnings', r.warnings);
      setStatus('就绪');
    } catch (e) {
      tbody.innerHTML = '';
      $('#tbl-installed').closest('.table-wrap').querySelector('.empty').hidden = false;
      $('#tbl-installed').closest('.table-wrap').querySelector('.empty').textContent =
        '读取失败：' + (e && e.message ? e.message : e);
      showWarnings('#installed-warnings', [String(e && e.message || e)]);
      setStatus('读取失败');
    } finally { setBusy(false); }
  }
  /** Info 列 → 彩色标签：锁定=黄，安装失败/清单移除=红，全局安装=灰，其余原样灰 */
  function infoTag(info) {
    if (!info) return '';
    if (/held/i.test(info)) return '<span class="tag held">已锁定</span>';
    if (/install failed|manifest removed/i.test(info)) return '<span class="tag bad">' + esc(info) + '</span>';
    if (/global install/i.test(info)) return '<span class="tag info">全局</span>';
    return '<span class="tag info">' + esc(info) + '</span>';
  }
  function renderInstalled() {
    const kw = ($('#filter-installed').value || '').trim().toLowerCase();
    const list = installedApps.filter((a) => !kw || a.name.toLowerCase().indexOf(kw) >= 0);
    const tbody = $('#tbl-installed tbody');
    // 列结构：名称(副行带 bucket 与状态标签) / 版本 / 更新时间(仅日期) / 操作。
    // 之前 来源、状态 各占一列，窄面板下把最右侧的操作按钮挤出可视区——
    // 并入副行后整表至少省 ~180px，操作列在 ~640px 宽的宿主面板里也能完整显示。
    tbody.innerHTML = list.map((a) => {
      const held = /held/i.test(a.info);
      const tag = infoTag(a.info);
      const sub = [
        a.source ? esc(a.source) : '<span class="dim">来源未知</span>',
        tag
      ].filter(Boolean).join(' ');
      return '<tr>' +
        '<td class="name-cell"><div class="name">' + esc(a.name) + '</div><div class="sub">' + sub + '</div></td>' +
        '<td>' + esc(a.version || '--') + '</td>' +
        '<td class="dim" title="完整时间 ' + esc(fmtTime(a.updated)) + '">' + fmtDate(a.updated) + '</td>' +
        '<td class="td-ops">' +
          '<button class="btn small ghost" data-act="update" data-name="' + esc(a.name) + '">更新</button>' +
          '<button class="btn small ghost" data-act="home" data-name="' + esc(a.name) + '">主页</button>' +
          '<button class="btn small ghost" data-act="folder" data-name="' + esc(a.name) + '">目录</button>' +
          '<button class="btn small ghost" data-act="hold" data-name="' + esc(a.name) + '" data-held="' + (held ? 1 : '') + '" title="锁定后 scoop update 会跳过它">' + (held ? '解锁' : '锁定') + '</button>' +
          '<button class="btn small danger" data-act="uninstall" data-name="' + esc(a.name) + '" title="两步确认：点一次变「确认?」，再点执行（保留数据）；Alt+点击确认 = 彻底卸载（-p，连持久化数据一起删）">卸载</button>' +
        '</td></tr>';
    }).join('');
    const empty = $('#pane-installed .empty');
    empty.hidden = list.length > 0;
    empty.textContent = '没有匹配的应用';
  }
  $('#filter-installed').oninput = renderInstalled;

  // ---------- 可更新 ----------
  async function loadStatus() {
    const tbody = $('#tbl-outdated tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="dim">检查中…（要联网对比各 bucket，可能要十几秒）</td></tr>';
    setStatus('检查更新 …', true);
    try {
      const r = await S.status();
      $('#cnt-outdated').textContent = r.outdated.length;
      $('#status-meta').textContent = '可更新 ' + r.outdated.length + ' 个 · 异常 ' + r.broken.length + ' 个';
      tbody.innerHTML = r.outdated.map((a) => {
        const held = /held/i.test(a.info);
        return '<tr>' +
          '<td class="name">' + esc(a.name) + '</td>' +
          '<td class="dim">' + esc(a.installed) + '</td>' +
          '<td>' + esc(a.latest) + '</td>' +
          '<td>' + (held ? '<span class="tag held">已锁定</span>' : '') + '</td>' +
          '<td class="td-ops">' +
            (held ? '' : '<button class="btn small ghost" data-act="update" data-name="' + esc(a.name) + '">更新</button>') +
          '</td></tr>';
      }).join('');
      $('#pane-status .empty').hidden = r.outdated.length > 0;

      const brokenBox = $('#broken-box');
      brokenBox.hidden = r.broken.length === 0;
      $('#tbl-broken tbody').innerHTML = r.broken.map((a) =>
        '<tr><td class="name">' + esc(a.name) + '</td><td class="dim">' + esc(a.installed || '--') + '</td>' +
        '<td><span class="tag bad">' + esc(a.info || '异常') + '</span></td>' +
        '<td class="td-ops"><button class="btn small danger" data-act="uninstall" data-name="' + esc(a.name) + '" title="两步确认；Alt+点击确认 = 彻底卸载（-p）">卸载</button></td></tr>'
      ).join('');
      showWarnings('#status-warnings', r.warnings);
      setStatus('就绪');
    } catch (e) {
      tbody.innerHTML = '';
      $('#pane-status .empty').hidden = false;
      $('#pane-status .empty').textContent = '检查失败：' + (e && e.message ? e.message : e);
      setStatus('检查失败');
    } finally { setBusy(false); }
  }

  // ---------- 搜索安装 ----------
  async function doSearch() {
    const kw = $('#search-input').value.trim();
    if (!kw) return;
    const tbody = $('#tbl-search tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="dim">搜索中…</td></tr>';
    $('#pane-search .empty').hidden = true;
    setStatus('搜索 ' + kw + ' …', true);
    try {
      const r = await S.searchApps(kw);
      const have = {};
      installedApps.forEach((a) => { have[a.name.toLowerCase()] = true; });
      tbody.innerHTML = r.results.map((x) => {
        const owned = have[x.name.toLowerCase()];
        return '<tr>' +
          '<td class="name">' + esc(x.name) + '</td>' +
          '<td class="dim">' + esc(x.version) + '</td>' +
          '<td class="dim">' + esc(x.source) + '</td>' +
          '<td class="td-ops">' +
            (owned ? '<span class="tag ok">已安装</span>'
                   : '<button class="btn small primary" data-act="install" data-name="' + esc(x.name) + '">安装</button>') +
          '</td></tr>';
      }).join('');
      $('#pane-search .empty').hidden = r.results.length > 0;
      $('#pane-search .empty').textContent = '没搜到，试试别的关键词（只搜本地已添加的 bucket）';
      showWarnings('#search-warnings', r.warnings);
      setStatus('搜索完成，' + r.results.length + ' 条结果');
    } catch (e) {
      tbody.innerHTML = '';
      $('#pane-search .empty').hidden = false;
      $('#pane-search .empty').textContent = '搜索失败：' + (e && e.message ? e.message : e);
    } finally { setBusy(false); }
  }
  $('#btn-search').onclick = doSearch;
  $('#search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

  // ---------- Bucket ----------
  // 快捷添加的 bucket 全部用国内可直连源（Gitee / GitHub 反代），面向没有代理的
  // 机器——scoop bucket add <名字> 不带来源时默认走官方 GitHub，没梯子必挂。
  // 源已用 git ls-remote 逐一实测可用（2026-10）。
  const M = S.MIRROR_PREFIX || 'https://scoop.201704.xyz/';
  const KNOWN_BUCKETS = [
    { name: 'main', source: 'https://gitee.com/scoop-bucket/main.git', desc: '官方主仓库 · Gitee 镜像' },
    { name: 'extras', source: M + 'https://github.com/ScoopInstaller/Extras', desc: '官方扩展包' },
    { name: 'versions', source: M + 'https://github.com/ScoopInstaller/Versions', desc: '旧版本/多版本' },
    { name: 'apps', source: M + 'https://github.com/kkzzhizhou/scoop-apps', desc: '社区大合集（聚合主流 bucket）' }
  ];
  async function loadBuckets() {
    const tbody = $('#tbl-bucket tbody');
    tbody.innerHTML = '<tr><td colspan="5" class="dim">加载中…</td></tr>';
    try {
      const r = await S.listBuckets();
      $('#cnt-bucket').textContent = r.buckets.length;
      tbody.innerHTML = r.buckets.map((b) =>
        '<tr><td class="name">' + esc(b.name) + '</td>' +
        '<td class="dim"><span class="truncate" title="' + esc(b.source) + '">' + esc(b.source) + '</span></td>' +
        '<td>' + (b.manifests || '--') + '</td>' +
        '<td class="dim" title="完整时间 ' + esc(fmtTime(b.updated)) + '">' + fmtDate(b.updated) + '</td>' +
        '<td class="td-ops"><button class="btn small danger" data-act="bucket-rm" data-name="' + esc(b.name) + '">移除</button></td></tr>'
      ).join('');
      // tooltip 里展示真实来源，让用户知道加的是什么
      $('#known-buckets').innerHTML = KNOWN_BUCKETS.map((b) =>
        '<button class="btn ghost" data-act="bucket-add" data-name="' + b.name + '" data-source="' + esc(b.source) + '" title="' + esc(b.desc) + '\n来源：' + esc(b.source) + '">+ ' + b.name + '</button>'
      ).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="5" class="dim">读取失败：' + esc(e && e.message) + '</td></tr>';
    }
  }
  /** 输入支持三种形态：`extras`（已知名）/ git 地址（自动取名）/ `名称 地址` 两个词 */
  function addBucketByInput() {
    const v = $('#bucket-input').value.trim();
    if (!v) return;
    const parts = v.split(/\s+/);
    let name = '', source = '';
    if (parts.length >= 2) {
      name = parts[0];
      source = parts[1];
    } else if (/^https?:\/\//i.test(v)) {
      source = v;
      name = (v.split('/').pop() || '').replace(/\.git$/i, '').toLowerCase() || 'bucket';
    } else {
      name = v;
    }
    runOp('bucket add ' + name, (onLine) => S.addBucket(name, source, onLine), () => { loadBuckets(); $('#bucket-input').value = ''; });
  }
  $('#btn-bucket-add').onclick = addBucketByInput;
  $('#bucket-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addBucketByInput(); });

  // ---------- 缓存 ----------
  async function loadCache() {
    const tbody = $('#tbl-cache tbody');
    tbody.innerHTML = '<tr><td colspan="3" class="dim">加载中…</td></tr>';
    try {
      const r = await S.cacheInfo();
      $('#cnt-cache').textContent = r.total.sizeText || '';
      $('#cache-total').textContent = '共 ' + r.total.files + ' 个文件，占用 ' + (r.total.sizeText || '0 B');
      tbody.innerHTML = r.apps.map((a) =>
        '<tr><td class="name">' + esc(a.name) + '</td><td>' + a.files + '</td><td>' + fmtBytes(a.bytes) + '</td></tr>'
      ).join('');
      $('#pane-cache .empty').hidden = r.apps.length > 0;
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="3" class="dim">读取失败：' + esc(e && e.message) + '</td></tr>';
    }
  }

  // ---------- 行内动作（事件委托） ----------
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    const name = btn.dataset.name || '';

    if (act === 'update') {
      runOp('update ' + name, (onLine) => S.updateApp(name, onLine), () => { loadInstalled(); if ($('#pane-status').classList.contains('active')) loadStatus(); });
    } else if (act === 'install') {
      runOp('install ' + name, (onLine) => S.install(name, onLine), () => { loadInstalled(); });
    } else if (act === 'uninstall') {
      if (!armConfirm(btn)) {
        // 第一次点击：进入待确认态。把玩法讲清楚，尤其 Alt=彻底卸载这个隐藏档位
        setStatus('再点一次「确认?」执行卸载（保留持久化数据）；Alt+点击「确认?」= 彻底卸载，连数据一起删');
        return;
      }
      const purge = !!e.altKey;
      runOp((purge ? 'uninstall -p ' : 'uninstall ') + name,
        (onLine) => S.uninstall(name, purge, onLine),
        () => { loadInstalled(); loadStatus(); });
    } else if (act === 'hold') {
      const held = btn.dataset.held === '1';
      runOp((held ? 'unhold ' : 'hold ') + name, (onLine) => S.holdApp(name, !held, onLine), loadInstalled);
    } else if (act === 'bucket-rm') {
      if (!armConfirm(btn)) return;
      runOp('bucket rm ' + name, (onLine) => S.removeBucket(name, onLine), loadBuckets);
    } else if (act === 'bucket-add') {
      // 快捷 chips 自带国内直连源。⚠ 名字和源都要传给 scoop：
      // `bucket add <name> <repo>`，只传源会被 scoop 当已知 bucket 别名查（实测踩坑）
      const source = btn.dataset.source || '';
      runOp('bucket add ' + name, (onLine) => S.addBucket(name, source, onLine), loadBuckets);
    } else if (act === 'home') {
      openHome(name);
    } else if (act === 'folder') {
      openFolder(name);
    }
  });

  async function openHome(name) {
    try {
      const r = await S.infoApp(name);
      const url = r.info.Website || r.info.Homepage || '';
      if (url) { S.openUrl(url); setStatus('已打开 ' + name + ' 主页'); }
      else setStatus('这个包没有主页信息');
    } catch (e) { setStatus('打开主页失败：' + (e && e.message)); }
  }
  async function openFolder(name) {
    try {
      const p = await S.prefixOf(name);
      if (p) { S.openPath(p); setStatus('已打开 ' + name + ' 目录'); }
      else setStatus('取不到 ' + name + ' 的安装目录');
    } catch (e) { setStatus('打开目录失败：' + (e && e.message)); }
  }

  // ---------- 顶部动作 ----------
  $('#btn-check-update').onclick = () => {
    document.querySelector('.tab[data-tab="status"]').click();
    loadStatus();
  };
  $('#btn-refresh-status').onclick = loadStatus;
  $('#btn-update-outdated').onclick = () => {
    runOp('update *', (onLine) => S.updateApp('*', onLine), () => { loadInstalled(); loadStatus(); });
  };
  $('#btn-update-all').onclick = $('#btn-update-outdated').onclick;
  $('#btn-cache-clear').onclick = () => {
    runOp('cache rm *', (onLine) => S.clearCache(onLine), loadCache);
  };
  $('#btn-cleanup').onclick = () => {
    runOp('cleanup *', (onLine) => S.cleanup(onLine), () => { loadCache(); loadInstalled(); });
  };

  function showWarnings(sel, warnings) {
    const box = $(sel);
    const list = (warnings || []).filter((w) => w && w.length < 300);
    box.hidden = list.length === 0;
    box.textContent = list.join('\n');
  }

  // ---------- 启动分流：有 scoop 进主界面，没有进配置页 ----------
  function enterMain(d) {
    document.body.classList.remove('setup-mode');
    $('#setup').hidden = true;
    const chip = $('#scoop-chip');
    chip.textContent = 'scoop v' + d.version;
    chip.classList.add('ok');
    chip.classList.remove('bad');
    if (d.shims) chip.title = 'shims: ' + d.shims;
    (d.warnings || []).forEach((w) => appendLog(w));
    loadInstalled();
  }

  function enterSetup(info, reason) {
    document.body.classList.add('setup-mode');
    $('#setup').hidden = false;
    const chip = $('#scoop-chip');
    chip.textContent = '未检测到 scoop';
    chip.classList.remove('ok');
    chip.classList.add('bad');
    chip.title = (info && info.autoFound) ? '扫描到：' + info.autoFound : '';

    // 提示要按事实说：配置的目录现在到底还有没有效，不能只看"配置过"就断言无效
    const scan = [];
    if (info && info.configuredRaw && !info.configured) {
      scan.push('之前配置的位置「' + info.configuredRaw + '」现在无效了，请重新选择');
    } else if (info && info.configured) {
      scan.push('已配置的位置「' + info.configured + '」仍然有效，但 scoop 检测没通过——原因见下');
    } else if (info && info.autoFound) {
      scan.push('扫描到疑似安装位置「' + info.autoFound + '」——可以点「选择已有的 scoop 位置…」手动指定它的 shims 目录');
    }
    if (reason) scan.push('最近一次检测失败的原因：' + reason);
    const box = $('#setup-scan');
    box.hidden = scan.length === 0;
    box.textContent = scan.join('\n');
  }

  function wireSetup() {
    $('#btn-scoop-install').onclick = () => {
      runOp('安装 Scoop', (onLine) => S.installScoop(onLine), async () => {
        const d = await S.detect();
        if (d.ok) {
          try { S.notify('Scoop ' + d.version + ' 安装成功'); } catch (e) {}
          enterMain(d);
        } else {
          setStatus('安装流程结束但 scoop 仍不可用，可尝试手动选择安装位置');
        }
      });
    };
    $('#btn-scoop-pick').onclick = async () => {
      try {
        const dir = await S.pickShimsDir();
        if (!dir) return;   // 取消
        const d = await S.detect();
        if (d.ok) {
          try { S.notify('已定位 scoop ' + d.version); } catch (e) {}
          enterMain(d);
        } else {
          setStatus('已记录位置但检测仍失败：' + d.reason);
        }
      } catch (e) {
        const msg = (e && e.message) || String(e);
        setStatus(msg);
        try { S.notify(msg); } catch (err) {}
      }
    };
    $('#btn-scoop-redetect').onclick = () => boot();
  }

  async function boot() {
    let d;
    try {
      d = await S.detect();
    } catch (e) {
      d = { ok: false, reason: String(e && e.message || e) };
    }
    wireSetup();
    if (d.ok) return enterMain(d);
    let info = {};
    try { info = S.getSetupInfo(); } catch (e) {}
    enterSetup(info, d.reason);
  }
  boot();
})();
