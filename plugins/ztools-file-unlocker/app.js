/* 文件解锁器 - app.js */
(function () {
  'use strict';

  const services = (window.services) || {};
  const ztools = window.ztools || window.utools || {};

  /* ---------- DOM ---------- */
  const els = {
    fileCountBadge: document.getElementById('fileCountBadge'),
    btnAdd: document.getElementById('btnAdd'),
    btnSyncSelected: document.getElementById('btnSyncSelected'),
    btnRefreshAll: document.getElementById('btnRefreshAll'),
    btnUnlockAll: document.getElementById('btnUnlockAll'),
    btnDeleteAll: document.getElementById('btnDeleteAll'),
    fileList: document.getElementById('fileList'),
    fileEmpty: document.getElementById('fileEmpty'),
    holderPanel: document.getElementById('holderPanel'),
    holderHint: document.getElementById('holderHint'),
    holderList: document.getElementById('holderList'),
    holderEmpty: document.getElementById('holderEmpty'),
    actionBar: document.getElementById('actionBar'),
    actionFileLabel: document.getElementById('actionFileLabel'),
    btnRefreshSel: document.getElementById('btnRefreshSel'),
    btnUnlock: document.getElementById('btnUnlock'),
    btnLocate: document.getElementById('btnLocate'),
    btnUnlockDelete: document.getElementById('btnUnlockDelete'),
    btnUnlockRename: document.getElementById('btnUnlockRename'),
    btnUnlockMove: document.getElementById('btnUnlockMove'),
    dropOverlay: document.getElementById('dropOverlay'),
    dropText: document.getElementById('dropText'),
    contextMenu: document.getElementById('contextMenu'),
    processDetailModal: document.getElementById('processDetailModal'),
    processDetailBody: document.getElementById('processDetailBody'),
    btnDetailClose: document.getElementById('btnDetailClose'),
    btnDetailOpenExe: document.getElementById('btnDetailOpenExe'),
    btnDetailKill: document.getElementById('btnDetailKill'),
    renameModal: document.getElementById('renameModal'),
    renameCur: document.getElementById('renameCur'),
    renameInput: document.getElementById('renameInput'),
    btnRenameCancel: document.getElementById('btnRenameCancel'),
    btnRenameOk: document.getElementById('btnRenameOk'),
    confirmModal: document.getElementById('confirmModal'),
    confirmTitle: document.getElementById('confirmTitle'),
    confirmBody: document.getElementById('confirmBody'),
    btnConfirmCancel: document.getElementById('btnConfirmCancel'),
    btnConfirmOk: document.getElementById('btnConfirmOk'),
    toastContainer: document.getElementById('toastContainer')
  };

  /* ---------- State ---------- */
  let files = [];          // { path, name, dir, isDir, sizeStr, status, holders, scanning, scanErr }
  let selectedIndex = -1;
  const checked = new Set();
  let ctxHolder = null;

  /* ---------- Helpers ---------- */
  function toast(msg, type = 'info', ms = 2800) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML = (type === 'success' ? '✓ ' : type === 'error' ? '✕ ' : '') + escapeHtml(msg);
    els.toastContainer.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, ms);
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function adjustHeight(h = 560) {
    if (services.expandWindow) {
      try { services.expandWindow(h); } catch (e) {}
    }
    try {
      if (typeof utools !== 'undefined' && utools.setExpendHeight) utools.setExpendHeight(h);
      if (window.utools && window.utools.setExpendHeight) window.utools.setExpendHeight(h);
      if (window.ztools && window.ztools.setExpendHeight) window.ztools.setExpendHeight(h);
      if (ztools && ztools.setExpendHeight) ztools.setExpendHeight(h);
    } catch (e) {}
  }
  function pathName(p) { return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }
  function pathDir(p) { return String(p || '').replace(/[\\/]+[^\\/]+$/, '') || p; }
  function isExplorer(s) {
    if (!s) return false;
    const l = String(s).toLowerCase();
    return l.includes('explorer.exe') || l === 'explorer' || l.includes('资源管理器');
  }

  /* ---------- Scanning ---------- */
  async function scanFile(idx) {
    const f = files[idx];
    if (!f) return;
    f.scanning = true;
    f.status = 'checking';
    renderFiles();

    try {
      const [res, probeRes] = await Promise.all([
        services.listHolders(f.path),
        (!f.isDir && services.probeLock) ? services.probeLock(f.path) : Promise.resolve(null)
      ]);
      f.holders = (res && res.holders) || [];
      f.scanErr = res && res.error ? res.error : '';
      const probeLocked = probeRes && probeRes.locked;
      f.status = (f.holders.length > 0 || probeLocked === true) ? 'locked' : 'normal';
    } catch (e) {
      f.scanErr = e.message;
      f.status = 'normal';
    } finally {
      f.scanning = false;
      renderFiles();
      if (idx === selectedIndex) renderHolderPanel();
    }
  }

  async function refreshAll() {
    if (files.length === 0) {
      els.fileCountBadge.textContent = '未添加文件';
      renderFiles();
      return;
    }
    els.fileCountBadge.textContent = '扫描中 ' + files.length + ' 项';
    files.forEach(f => { f.scanning = true; f.status = 'checking'; });
    renderFiles();

    try {
      if (services.listHoldersBatch && files.length > 1) {
        const batchRes = await services.listHoldersBatch(files.map(f => f.path));
        await Promise.all(files.map(async (f, i) => {
          const rawHolders = batchRes[f.path] || [];
          f.holders = rawHolders.filter(h => h && h.pid > 0);
          f.scanErr = '';
          let probeLocked = false;
          if (!f.isDir && services.probeLock) {
            try {
              const pr = await services.probeLock(f.path);
              probeLocked = pr && pr.locked;
            } catch (e) {}
          }
          f.status = (f.holders.length > 0 || probeLocked === true) ? 'locked' : 'normal';
          f.scanning = false;
        }));
      } else {
        await Promise.all(files.map((_, i) => scanFile(i)));
      }
    } catch (e) {
      files.forEach(f => { f.scanning = false; f.status = 'normal'; });
    } finally {
      renderFiles();
      renderHolderPanel();
      els.fileCountBadge.textContent = files.length + ' 项';
      toast('占用状态已刷新', 'info', 1800);
    }
  }

  /* ---------- Render ---------- */
  function renderFiles() {
    els.fileEmpty.style.display = files.length ? 'none' : 'flex';
    els.fileList.querySelectorAll('.file-row').forEach(n => n.remove());

    files.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'file-row' + (i === selectedIndex ? ' selected' : '') + (f.status === 'locked' ? ' locked' : '');
      row.dataset.idx = i;

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'file-check';
      cb.checked = checked.has(i);
      cb.addEventListener('click', e => { e.stopPropagation(); toggleCheck(i); });

      const main = document.createElement('div');
      main.className = 'file-main';
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = (f.isDir ? '📁 ' : '📄 ') + f.name;
      const dir = document.createElement('div');
      dir.className = 'file-dir';
      dir.textContent = pathDir(f.path);
      main.appendChild(name); main.appendChild(dir);

      const meta = document.createElement('div');
      meta.className = 'file-meta';

      const status = document.createElement('span');
      status.className = 'status-dot ' + (f.status === 'locked' ? 'status-locked' : f.status === 'normal' ? 'status-normal' : 'status-checking');
      status.textContent = f.status === 'locked' ? '被占用' : f.status === 'normal' ? '正常' : '检测中';
      meta.appendChild(status);

      if (f.isDir) {
        const size = document.createElement('span');
        size.className = 'holders-count';
        size.textContent = '文件夹';
        meta.appendChild(size);
      } else if (f.sizeStr) {
        const size = document.createElement('span');
        size.className = 'holders-count';
        size.textContent = f.sizeStr;
        meta.appendChild(size);
      }
      if (f.holders && f.holders.length) {
        const cnt = document.createElement('span');
        cnt.className = 'holders-count';
        cnt.style.color = '#f87171';
        cnt.style.borderColor = 'rgba(248,113,113,.4)';
        cnt.textContent = f.holders.length + ' 个进程';
        meta.appendChild(cnt);
      }

      const rm = document.createElement('button');
      rm.className = 'file-remove';
      rm.title = '移除';
      rm.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      rm.addEventListener('click', e => { e.stopPropagation(); removeFile(i); });

      row.appendChild(cb); row.appendChild(main); row.appendChild(meta); row.appendChild(rm);
      row.addEventListener('click', () => selectFile(i));
      els.fileList.appendChild(row);
    });

    els.fileCountBadge.textContent = files.length + ' 项';
  }

  function renderHolderPanel() {
    const f = files[selectedIndex];
    els.holderList.querySelectorAll('.holder-row').forEach(n => n.remove());
    if (!f) {
      els.actionBar.style.display = 'none';
      els.holderHint.textContent = '选择文件后显示占用程序';
      els.holderEmpty.textContent = '选择上方文件以查看占用程序';
      els.holderEmpty.style.display = 'block';
      return;
    }
    els.actionBar.style.display = 'flex';
    els.actionFileLabel.textContent = f.name + '  —  ' + f.path;
    els.holderHint.textContent = f.status === 'locked' ? (`被 ${f.holders.length || 1} 个程序占用（💡 右键进程可定位/结束）`) : (f.status === 'normal' ? '未被占用 ✅' : '检测中...');

    if (f.scanErr) {
      els.holderEmpty.style.display = 'block';
      els.holderEmpty.textContent = '占用检测异常：' + f.scanErr;
      return;
    }
    if (!f.holders || f.holders.length === 0) {
      els.holderEmpty.style.display = 'block';
      els.holderEmpty.textContent = f.status === 'locked' ? '独占锁定（无可见句柄，可能是内核驱动锁）' : '没有检测到占用进程';
      return;
    }
    els.holderEmpty.style.display = 'none';

    f.holders.forEach(h => {
      const row = document.createElement('div');
      row.className = 'holder-row';

      const n = document.createElement('div');
      n.className = 'holder-name';
      n.textContent = h.name || ('PID-' + h.pid);
      n.title = (h.exe ? '路径: ' + h.exe + '\n' : '') + (h.matchedPath ? '匹配: ' + h.matchedPath : '');

      const pid = document.createElement('div');
      pid.className = 'holder-pid';
      pid.textContent = h.pid;

      const st = document.createElement('div');
      st.className = 'hstatus';
      const reasonMap = {
        'DirectoryHandle': '目录占用',
        'FileHandle': '文件句柄',
        'LoadedModule': '模块加载',
        'RestartManager': '系统进程'
      };
      st.textContent = reasonMap[h.reason] || '正在占用';

      row.appendChild(n); row.appendChild(pid); row.appendChild(st);
      row.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, h);
      });
      row.addEventListener('dblclick', () => {
        if (h.exe) services.showInExplorer(h.exe);
        else showProcessDetail(h);
      });
      els.holderList.appendChild(row);
    });
  }

  /* ---------- Selection / check ---------- */
  function selectFile(i) {
    selectedIndex = i;
    renderFiles();
    renderHolderPanel();
  }
  function toggleCheck(i) {
    checked.has(i) ? checked.delete(i) : checked.add(i);
    renderFiles();
  }
  function removeFile(i) {
    files.splice(i, 1);
    const newChecked = new Set();
    checked.forEach(c => newChecked.add(c > i ? c - 1 : c < i ? c : c));
    checked.clear(); newChecked.forEach(c => checked.add(c));
    if (selectedIndex === i) { selectedIndex = -1; renderHolderPanel(); }
    else if (selectedIndex > i) selectedIndex--;
    renderFiles();
    if (!files.length) { selectedIndex = -1; renderHolderPanel(); }
  }

  /* ---------- Add Paths ---------- */
  async function addPaths(paths, replace = false) {
    if (!paths || !paths.length) return;
    if (replace) {
      files = [];
      checked.clear();
      selectedIndex = -1;
    }
    const targetsToScan = [];

    for (const p of paths) {
      if (!p) continue;
      const cleanPath = String(p).trim();
      if (!cleanPath) continue;

      const existingIndex = files.findIndex(f => f.path.toLowerCase() === cleanPath.toLowerCase());
      if (existingIndex >= 0) {
        targetsToScan.push(existingIndex);
      } else {
        const idx = files.length;
        files.push({
          path: cleanPath,
          name: pathName(cleanPath),
          isDir: false,
          sizeStr: '',
          status: 'checking',
          holders: [],
          scanErr: ''
        });
        targetsToScan.push(idx);
      }
    }
    if (!targetsToScan.length) return;

    adjustHeight(560);
    selectedIndex = targetsToScan[0];
    renderFiles();
    renderHolderPanel();

    // 并行获取文件/目录信息
    await Promise.all(targetsToScan.map(async (i) => {
      const f = files[i];
      if (!f) return;
      try {
        const info = await services.getPathInfo(f.path);
        if (info && info.ok) { f.isDir = info.isDirectory; f.sizeStr = info.sizeStr; }
      } catch (e) {}
    }));

    // 若添加多个文件，采用批量扫描引擎
    if (services.listHoldersBatch && targetsToScan.length > 1) {
      try {
        const targetPaths = targetsToScan.map(i => files[i].path);
        const batchRes = await services.listHoldersBatch(targetPaths);
        await Promise.all(targetsToScan.map(async (i) => {
          const f = files[i];
          if (!f) return;
          const rawHolders = batchRes[f.path] || [];
          f.holders = rawHolders.filter(h => h && h.pid > 0);
          f.scanErr = '';
          let probeLocked = false;
          if (!f.isDir && services.probeLock) {
            try {
              const pr = await services.probeLock(f.path);
              probeLocked = pr && pr.locked;
            } catch (e) {}
          }
          f.status = (f.holders.length > 0 || probeLocked === true) ? 'locked' : 'normal';
          f.scanning = false;
        }));
      } catch (e) {
        await Promise.all(targetsToScan.map(i => scanFile(i)));
      } finally {
        renderFiles();
        if (selectedIndex >= 0) renderHolderPanel();
      }
    } else {
      for (const i of targetsToScan) {
        await scanFile(i);
      }
    }
  }

  async function onAdd() {
    try {
      const paths = await services.selectPaths();
      if (paths && paths.length) {
        addPaths(paths, false);
      }
    } catch (e) {
      toast('打开选择对话框失败: ' + e.message, 'error');
    }
  }

  /* ---------- Plugin Enter Handler (Ztools / uTools) ---------- */
  function extractPathsFromAction(action) {
    if (!action) return [];
    const extracted = [];

    function addIfValid(p) {
      if (!p) return;
      const clean = String(p).trim().replace(/^["']|["']$/g, '');
      if (clean && (clean.includes(':\\') || clean.includes(':/') || clean.startsWith('\\\\'))) {
        extracted.push(clean);
      }
    }

    if (action.type === 'files' && Array.isArray(action.payload)) {
      action.payload.forEach(item => {
        if (typeof item === 'string') addIfValid(item);
        else if (item && item.path) addIfValid(item.path);
      });
    } else if (action.type === 'window' && action.payload) {
      if (typeof action.payload === 'string') addIfValid(action.payload);
      else if (action.payload.path) addIfValid(action.payload.path);
    } else if (typeof action.payload === 'string') {
      addIfValid(action.payload);
    } else if (action.payload && typeof action.payload === 'object') {
      if (action.payload.path) addIfValid(action.payload.path);
    }

    return extracted;
  }

  window.onPluginEnter = async function (action) {
    adjustHeight(560);
    setTimeout(() => adjustHeight(560), 50);
    setTimeout(() => adjustHeight(560), 150);
    setTimeout(() => adjustHeight(560), 300);

    let paths = extractPathsFromAction(action);
    // 如果 action 没能提取到路径（例如 Ztools 唤醒时未传参数），自动从系统 Shell / 剪贴板中检测当前选中的文件
    if (paths.length === 0 && services.getSelectedFiles) {
      try {
        const autoPaths = await services.getSelectedFiles();
        if (autoPaths && autoPaths.length) paths = autoPaths;
      } catch (e) {}
    }
    if (paths.length > 0) {
      addPaths(paths, true); // 每次进入插件时只保留本次选中的文件
      toast(`已载入选中的 ${paths.length} 项，正在检测占用...`, 'info', 2200);
    }
  };

  /* ---------- Unlock / file ops ---------- */
  async function unlockForFile(idx) {
    const f = files[idx];
    if (!f) return;
    toast('正在结束占用进程并解锁：' + f.name + ' ...', 'info');
    const res = await services.unlockPath(f.path);
    await scanFile(idx);
    if (res.ok) {
      if (res.restartedExplorer) {
        toast('已解除占用（已自动重启资源管理器）：' + f.name, 'success', 3200);
      } else {
        toast('已结束占用进程，成功解锁：' + f.name, 'success');
      }
    } else {
      toast('未能完全解锁：' + f.name + (res.message ? '（' + res.message + '）' : ''), 'error');
    }
  }

  async function doUnlockRename(idx) {
    const f = files[idx];
    if (!f) return;
    els.renameCur.textContent = f.name;
    els.renameInput.value = f.name;
    els.renameModal.classList.add('show');
    setTimeout(() => { els.renameInput.focus(); els.renameInput.select(); }, 60);
    const newName = await new Promise(res => {
      const ok = () => { els.renameModal.classList.remove('show'); res(els.renameInput.value.trim()); };
      const cancel = () => { els.renameModal.classList.remove('show'); res(null); };
      els.btnRenameOk.onclick = ok;
      els.btnRenameCancel.onclick = cancel;
      els.renameInput.onkeydown = e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') cancel(); };
    });
    if (!newName) return;
    toast('正在解锁并重命名为 ' + newName + ' ...', 'info');
    await services.unlockPath(f.path);
    const rn = await services.renamePath(f.path, newName);
    if (rn.ok) {
      f.path = rn.dest; f.name = pathName(rn.dest);
      await scanFile(idx);
      renderHolderPanel();
      toast('已重命名为：' + newName, 'success');
    } else {
      await scanFile(idx);
      toast('重命名失败：' + (rn.message || ''), 'error');
    }
  }

  async function doUnlockMove(idx) {
    const f = files[idx];
    if (!f) return;
    const destDir = await services.pickFolder();
    if (!destDir) return;
    toast('正在解锁并移动到 ' + destDir + ' ...', 'info');
    await services.unlockPath(f.path);
    const mv = await services.movePath(f.path, destDir);
    if (mv.ok) {
      f.path = mv.dest; f.name = pathName(mv.dest);
      await scanFile(idx);
      renderHolderPanel();
      toast('已移动到：' + mv.dest, 'success');
    } else {
      await scanFile(idx);
      toast('移动失败：' + (mv.message || ''), 'error');
    }
  }

  async function doUnlockDelete(idx) {
    const f = files[idx];
    if (!f) return;
    const ok = await confirmDialog('确认移至回收站？', '将先解除占用，然后移至回收站：<br><b style="color:var(--text-primary)">' + escapeHtml(f.path) + '</b><br><span style="color:var(--text-secondary);font-size:12px">文件将放入回收站，可随时还原。</span>');
    if (!ok) return;
    toast('正在解锁并移至回收站：' + f.name + ' ...', 'info');
    await services.unlockPath(f.path);
    const res = await services.deletePath(f.path);
    if (res.ok) {
      removeFile(idx);
      toast('已移至回收站：' + f.name, 'success');
    } else {
      await scanFile(idx);
      const codeMsg = res.code === 'EBUSY' ? '文件仍被占用' : res.code === 'EACCES' || res.code === 'EPERM' ? '权限不足（可能需要管理员权限）' : (res.message || '');
      toast('无法删除：' + codeMsg, 'error');
    }
  }

  async function batchUnlock() {
    if (!files.length) return toast('没有已添加的文件', 'error');
    toast('正在批量解锁 ' + files.length + ' 项...', 'info');
    let fail = 0;
    let hadExplorer = false;
    for (let i = 0; i < files.length; i++) {
      const res = await services.unlockPath(files[i].path);
      if (!res.ok) fail++;
      if (res.restartedExplorer) hadExplorer = true;
    }
    await refreshAll();
    const successMsg = hadExplorer ? '已全部解锁（已自动重启资源管理器）' : '已全部解锁';
    toast(fail ? ('完成，' + fail + ' 项未能解锁') : successMsg, fail ? 'error' : 'success', 3200);
  }

  async function batchDelete() {
    if (!files.length) return toast('没有已添加的文件', 'error');
    const list = files.map((f, i) => escapeHtml(f.name)).join('<br>');
    const ok = await confirmDialog('确认批量移至回收站？', '将先解除占用，然后将以下 ' + files.length + ' 项移至回收站：<br>' + list + '<br><span style="color:var(--text-secondary);font-size:12px">文件将放入回收站，可随时还原。</span>');
    if (!ok) return;
    toast('正在批量移至回收站...', 'info');
    let fail = 0;
    const targets = files.slice();
    for (const f of targets) {
      await services.unlockPath(f.path);
      const res = await services.deletePath(f.path);
      if (!res.ok) fail++;
      const i = files.indexOf(f);
      if (i >= 0) removeFile(i);
    }
    toast(fail ? ('完成，' + fail + ' 项未能移至回收站') : '已全部移至回收站', fail ? 'error' : 'success');
  }

  /* ---------- Confirm dialog ---------- */
  function confirmDialog(title, bodyHtml) {
    return new Promise(res => {
      els.confirmTitle.textContent = title;
      els.confirmBody.innerHTML = bodyHtml;
      els.confirmModal.classList.add('show');
      const done = (v) => { els.confirmModal.classList.remove('show'); res(v); };
      els.btnConfirmOk.onclick = () => done(true);
      els.btnConfirmCancel.onclick = () => done(false);
      const esc = e => { if (e.key === 'Escape') done(false); };
      document.addEventListener('keydown', esc, { once: true });
    });
  }

  /* ---------- Context menu & Process Detail ---------- */
  function showContextMenu(x, y, h) {
    ctxHolder = h;
    const openItem = document.querySelector('#contextMenu .ctx-item[data-act="open"]');
    const handleItem = document.querySelector('#contextMenu .ctx-item[data-act="close-handle"]');

    if (openItem) {
      if (h && h.exe) openItem.classList.remove('disabled');
      else openItem.classList.add('disabled');
    }
    if (handleItem) {
      if (h && h.handles && h.handles.length > 0) handleItem.classList.remove('disabled');
      else handleItem.classList.add('disabled');
    }

    els.contextMenu.style.display = 'block';
    const mw = els.contextMenu.offsetWidth || 180;
    const mh = els.contextMenu.offsetHeight || 160;
    const posX = Math.max(8, Math.min(x, window.innerWidth - mw - 8));
    const posY = Math.max(8, Math.min(y, window.innerHeight - mh - 8));
    els.contextMenu.style.left = posX + 'px';
    els.contextMenu.style.top = posY + 'px';
  }

  function hideContextMenu() { els.contextMenu.style.display = 'none'; }

  function showProcessDetail(h) {
    if (!h) return;
    const reasonMap = {
      'DirectoryHandle': '目录占用 (该进程打开了此目录)',
      'FileHandle': '文件句柄 (该进程打开了此文件)',
      'LoadedModule': '模块/程序加载 (该进程或其加载的 DLL 位于此路径)',
      'RestartManager': '系统登记占用 (Restart Manager)'
    };
    const handlesHtml = (h.handles && h.handles.length)
      ? h.handles.map(v => `<code style="background:var(--bg-dark);padding:2px 4px;border-radius:3px;margin-right:4px;">${escapeHtml(v)}</code>`).join('')
      : '<span style="color:var(--text-muted)">无显式句柄</span>';

    els.processDetailBody.innerHTML = `
      <div class="detail-item">
        <div class="detail-label">进程名称</div>
        <div class="detail-value" style="font-size:13px;font-weight:700;color:var(--accent-blue);">${escapeHtml(h.name || ('PID ' + h.pid))}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">进程 ID (PID)</div>
        <div class="detail-value">${h.pid}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">可执行文件完整路径</div>
        <div class="detail-value">${escapeHtml(h.exe || '未获取到路径 (可能需要管理员权限)')}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">占用类型</div>
        <div class="detail-value">${escapeHtml(reasonMap[h.reason] || h.reason || '正在占用')}</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">占用句柄列表 (${h.handles ? h.handles.length : 0} 个)</div>
        <div class="detail-value" style="margin-top:4px;">${handlesHtml}</div>
      </div>
    `;

    els.btnDetailOpenExe.style.display = h.exe ? 'inline-flex' : 'none';
    els.btnDetailOpenExe.onclick = () => {
      if (h.exe) services.showInExplorer(h.exe);
    };

    els.btnDetailKill.onclick = async () => {
      els.processDetailModal.classList.remove('show');
      const isExp = isExplorer(h.name) || isExplorer(h.exe);
      const promptTip = isExp 
        ? '<br><span style="color:var(--accent-orange);font-size:12px">💡 提示：该进程为 Windows 资源管理器/桌面，结束后将自动为您重启桌面以防电脑异常。</span>'
        : '<br><span style="color:var(--accent-red)">将强制终止该进程并释放文件占用。</span>';
      const ok = await confirmDialog('结束进程？', '确认结束进程 <b style="color:var(--text-primary)">' + escapeHtml(h.name || h.pid) + '</b> (PID ' + h.pid + ') ？' + promptTip);
      if (!ok) return;
      const res = await services.killProcess(h.pid, true, h.name || h.exe);
      const msg = res.ok 
        ? (res.restartedExplorer ? ('已结束资源管理器，正在自动重启桌面...') : ('已结束进程：' + h.name))
        : ('结束失败：' + (res.message || ''));
      toast(msg, res.ok ? 'success' : 'error', 3000);
      if (selectedIndex >= 0) await scanFile(selectedIndex);
    };

    els.processDetailModal.classList.add('show');
  }

  els.btnDetailClose.onclick = () => {
    els.processDetailModal.classList.remove('show');
  };

  document.querySelectorAll('#contextMenu .ctx-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (item.classList.contains('disabled')) return;
      const act = item.dataset.act;
      const h = ctxHolder;
      hideContextMenu();
      if (!h) return;

      if (act === 'view') {
        showProcessDetail(h);
      } else if (act === 'open') {
        if (h.exe) services.showInExplorer(h.exe);
        else toast('未获取到该进程的可执行文件路径', 'error');
      } else if (act === 'close-handle') {
        if (!h.handles || !h.handles.length) {
          return toast('该进程无可用独立句柄，请使用强制结束进程', 'error');
        }
        let allOk = true;
        for (const handleVal of h.handles) {
          const res = await services.closeHandle(h.pid, handleVal);
          if (!res.ok) allOk = false;
        }
        toast(allOk ? '已关闭占用句柄' : '部分句柄关闭失败', allOk ? 'success' : 'error');
        if (selectedIndex >= 0) await scanFile(selectedIndex);
      } else if (act === 'kill') {
        const isExp = isExplorer(h.name) || isExplorer(h.exe);
        const promptTip = isExp 
          ? '<br><span style="color:var(--accent-orange);font-size:12px">💡 提示：该进程为 Windows 资源管理器/桌面，结束后将自动为您重启桌面以防电脑异常。</span>'
          : '<br><span style="color:var(--accent-red)">将强制终止该进程并释放文件占用。</span>';
        const ok = await confirmDialog('结束进程？', '确认结束进程 <b style="color:var(--text-primary)">' + escapeHtml(h.name || h.pid) + '</b> (PID ' + h.pid + ') ？' + promptTip);
        if (!ok) return;
        const res = await services.killProcess(h.pid, true, h.name || h.exe);
        const msg = res.ok 
          ? (res.restartedExplorer ? ('已结束资源管理器，正在自动重启桌面...') : ('已结束进程：' + h.name))
          : ('结束失败：' + (res.message || ''));
        toast(msg, res.ok ? 'success' : 'error', 3000);
        if (selectedIndex >= 0) await scanFile(selectedIndex);
      }
    });
  });

  /* ---------- Drag & drop ---------- */
  let dragDepth = 0;
  document.addEventListener('dragenter', e => {
    e.preventDefault();
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) {
      dragDepth++;
      els.dropOverlay.classList.add('show');
      els.dropText.textContent = '松开以添加文件 / 文件夹';
    }
  });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('dragleave', e => {
    e.preventDefault();
    dragDepth--;
    if (dragDepth <= 0) { dragDepth = 0; els.dropOverlay.classList.remove('show'); }
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    els.dropOverlay.classList.remove('show');
    const files_ = e.dataTransfer && e.dataTransfer.files;
    if (!files_ || !files_.length) return;
    const paths = [];
    for (const f of files_) {
      const realPath = (services.getPathForFile && services.getPathForFile(f)) || f.path || f.webkitRelativePath || f.name;
      if (realPath) paths.push(realPath);
    }
    addPaths(paths);
  });

  /* ---------- Paste path support ---------- */
  document.addEventListener('paste', e => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (text && (text.includes('\\') || text.includes('/'))) {
      const lines = text.split(/[\r\n]+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      if (lines.length) addPaths(lines);
    }
  });

  /* ---------- Wire up buttons ---------- */
  els.btnAdd.addEventListener('click', onAdd);
  if (els.btnSyncSelected) {
    els.btnSyncSelected.addEventListener('click', async () => {
      if (services.getSelectedFiles) {
        try {
          const autoPaths = await services.getSelectedFiles();
          if (autoPaths && autoPaths.length > 0) {
            addPaths(autoPaths, true);
            toast(`已刷新载入选中的 ${autoPaths.length} 项，正在检测占用...`, 'info', 2200);
          } else {
            toast('未检测到资源管理器或桌面上选中的文件', 'info', 2000);
          }
        } catch (e) {
          toast('获取选中项失败: ' + e.message, 'error');
        }
      }
    });
  }
  els.btnRefreshAll.addEventListener('click', () => refreshAll());
  els.btnRefreshSel.addEventListener('click', () => { if (selectedIndex >= 0) scanFile(selectedIndex); });
  els.btnUnlock.addEventListener('click', () => { if (selectedIndex >= 0) unlockForFile(selectedIndex); });
  els.btnLocate.addEventListener('click', () => { if (selectedIndex >= 0) services.showInExplorer(files[selectedIndex].path); });
  els.btnUnlockDelete.addEventListener('click', () => { if (selectedIndex >= 0) doUnlockDelete(selectedIndex); });
  els.btnUnlockRename.addEventListener('click', () => { if (selectedIndex >= 0) doUnlockRename(selectedIndex); });
  els.btnUnlockMove.addEventListener('click', () => { if (selectedIndex >= 0) doUnlockMove(selectedIndex); });
  els.btnUnlockAll.addEventListener('click', batchUnlock);
  els.btnDeleteAll.addEventListener('click', batchDelete);

  document.addEventListener('click', e => {
    if (!els.contextMenu.contains(e.target)) hideContextMenu();
  });
  document.addEventListener('contextmenu', e => {
    if (!e.target.closest('.holder-row')) hideContextMenu();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideContextMenu();
      els.renameModal.classList.remove('show');
      els.confirmModal.classList.remove('show');
      els.processDetailModal.classList.remove('show');
    }
  });

  /* ---------- Init ---------- */
  adjustHeight(560);
  setTimeout(() => adjustHeight(560), 80);
  setTimeout(() => adjustHeight(560), 250);
  renderFiles();
  renderHolderPanel();

  // 监听窗口聚焦与可见性变化，自动维持 560px
  window.addEventListener('focus', () => {
    adjustHeight(560);
    setTimeout(() => adjustHeight(560), 80);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      adjustHeight(560);
      setTimeout(() => adjustHeight(560), 80);
    }
  });

  // 消费所有挂起的 action 队列
  if (services.getPendingActions) {
    const pending = services.getPendingActions();
    if (pending && pending.length) {
      pending.forEach(act => window.onPluginEnter(act));
    }
  }

  // 双保险：直接尝试挂接全局 utools / ztools 监听
  try {
    const ut = (typeof utools !== 'undefined' ? utools : null) || window.utools || window.ztools;
    if (ut && typeof ut.onPluginEnter === 'function') {
      ut.onPluginEnter((action) => {
        adjustHeight(560);
        setTimeout(() => adjustHeight(560), 50);
        setTimeout(() => adjustHeight(560), 150);
        window.onPluginEnter(action);
      });
    }
  } catch (e) {}

  // 延迟 120ms 兜底：若列表仍为空，自动探测系统活动资源管理器/剪贴板选中的项
  setTimeout(async () => {
    if (files.length === 0 && services.getSelectedFiles) {
      try {
        const autoPaths = await services.getSelectedFiles();
        if (autoPaths && autoPaths.length > 0) {
          addPaths(autoPaths, true);
          toast(`已自动检测并载入选中项（${autoPaths.length} 项）`, 'info', 2200);
        }
      } catch (e) {}
    }
  }, 120);
})();