/* SendGB 上传 —— 页面逻辑。
 * Node 能力全在 preload 的 window.services 里（这里不能 require）。
 */
const getAPI = () => (typeof window !== 'undefined' ? (window.ztools || window.utools || null) : null);
const API = getAPI();
const S = window.services || {};

const $ = (id) => document.getElementById(id);
const dropEl = $('drop'), filesEl = $('files'), linkEl = $('link'), copyBtn = $('btnCopy');
const upBarEl = $('upBar'), upPctEl = $('upPct'), upEtaEl = $('upEta'), upStatusEl = $('upStatus');
const dlBarEl = $('dlBar'), dlPctEl = $('dlPct'), dlEtaEl = $('dlEta'), dlStatusEl = $('dlStatus');
const logEl = $('log'), histEl = $('history'), notReady = $('notReady');

let uploading = false;

/* ---------------- 耗时与格式化工具 ---------------- */

function formatDuration(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  if (sec <= 0) return '即将完成';
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}小时${m}分` + (s > 0 ? `${s}秒` : '');
}

function formatElapsed(sec) {
  if (sec == null || isNaN(sec)) return '';
  sec = Math.round(sec);
  if (sec <= 0) return '1秒内';
  if (sec < 60) return `${sec}秒`;
  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  }
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}小时${m}分` + (s > 0 ? `${s}秒` : '');
}

/* ---------------- 进度与状态（上传与下载各自独立，互不混淆） ---------------- */

function log(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += `[${t}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setUpStatus(msg) {
  if (upStatusEl) upStatusEl.textContent = msg;
}

function setUpProgress(p) {
  const v = Math.max(0, Math.min(100, p | 0));
  if (upBarEl) upBarEl.style.width = v + '%';
  if (upPctEl) upPctEl.textContent = v + '%';
}

function setUpEta(msg) {
  if (upEtaEl) upEtaEl.textContent = msg || '';
}

function setDlStatus(msg) {
  if (dlStatusEl) dlStatusEl.textContent = msg;
}

function setDlProgress(p) {
  const v = Math.max(0, Math.min(100, p | 0));
  if (dlBarEl) dlBarEl.style.width = v + '%';
  if (dlPctEl) dlPctEl.textContent = v + '%';
}

function setDlEta(msg) {
  if (dlEtaEl) dlEtaEl.textContent = msg || '';
}

function setStatus(msg) {
  const isDown = !$('downBox') || !$('downBox').classList.contains('hidden');
  if (isDown) setDlStatus(msg);
  else setUpStatus(msg);
}

function setProgress(p) {
  const isDown = !$('downBox') || !$('downBox').classList.contains('hidden');
  if (isDown) setDlProgress(p);
  else setUpProgress(p);
}

function blob(name, size) {
  return `${name}  ${S && S.human ? S.human(size) : size + ' B'}`;
}

/* ---------------- 环境检查 ---------------- */

function checkEnv(show) {
  const env = S.envReport ? S.envReport() : {};
  $('env').textContent = JSON.stringify(env, null, 2);
  if (!env.ready) {
    notReady.classList.remove('hidden');
    notReady.textContent = !env.browserOk
      ? '未检测到可用浏览器，请安装 Google Chrome 或启用系统自带的 Microsoft Edge。'
      : '插件组件不完整，请重新安装插件。';
  } else {
    notReady.classList.add('hidden');
  }
  const descEl = $('txtAria2Desc');
  if (descEl) {
    if (env.aria2Ok) {
      descEl.textContent = `优先使用 aria2c 多线程极速下载（${env.aria2Info || '16 线程极速并发'}）`;
    } else {
      descEl.textContent = `优先使用 aria2c 多线程极速下载（未检测到 aria2c，使用内置稳定引擎）`;
    }
  }
  if (show) log('环境检查：' + JSON.stringify(env));
  return env;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ---------------- 上传 ---------------- */

let currentUploadingFiles = [];

function startUpload(paths) {
  if (uploading) { setUpStatus('上一个上传还在进行中…'); return; }
  if (!paths || !paths.length) return;

  // 检查文件体积是否超过限制（单次最多 5GB）
  if (S.checkUploadFiles) {
    const check = S.checkUploadFiles(paths);
    if (check && check.exceeded) {
      log(`⚠️ 选择的文件总大小超过 5GB 上限：合计 ${check.totalHuman}（共 ${check.count} 个文件）`);
      let msg = '';
      if (check.count === 1) {
        const f = check.items[0] || { name: '所选文件', human: check.totalHuman };
        msg = `
          <div style="margin-bottom:8px;">您选择的文件 <strong style="color:var(--fg);">${escapeHtml(f.name)}</strong> 体积为 <span style="color:#e5484d;font-weight:600;">${f.human}</span>。</div>
          <div style="margin-bottom:8px;">SendGB 免费单次上传最大限制为 <strong style="color:var(--fg);">5 GB</strong>，当前文件已超出限制。</div>
          <div style="color:var(--muted);font-size:11.5px;background:var(--card);padding:8px 10px;border-radius:6px;border:1px solid var(--bd);">
            💡 <strong>建议方案：</strong><br>
            可使用 7-Zip、WinRAR 等压缩工具将大文件制作成<strong>分卷压缩包</strong>（例如按 4GB 分卷），然后分别上传分享。
          </div>
        `;
      } else {
        const topItems = check.items.slice(0, 4).map(it => `<li>${escapeHtml(it.name)} (${it.human})</li>`).join('');
        const more = check.items.length > 4 ? `<li>...等共 ${check.items.length} 个文件</li>` : '';
        msg = `
          <div style="margin-bottom:8px;">您本次共选择了 <strong style="color:var(--fg);">${check.count}</strong> 个文件，合计大小为 <span style="color:#e5484d;font-weight:600;">${check.totalHuman}</span>。</div>
          <div style="margin-bottom:8px;">SendGB 免费单次上传最大限制为 <strong style="color:var(--fg);">5 GB</strong>，当前总大小已超出限制。</div>
          <ul style="margin:0 0 8px 16px;padding:0;font-size:11.5px;color:var(--muted);max-height:80px;overflow:auto;">${topItems}${more}</ul>
          <div style="color:var(--muted);font-size:11.5px;background:var(--card);padding:8px 10px;border-radius:6px;border:1px solid var(--bd);">
            💡 <strong>建议方案：</strong><br>
            建议分批次选择并上传文件，或先压缩分卷后再上传。
          </div>
        `;
      }
      showAlert(msg, '文件大小超出 5GB 上限');
      setUpStatus(`文件体积超出上限（${check.totalHuman} / 5GB）`);
      return;
    }
  }

  currentUploadingFiles = paths.slice();

  const env = checkEnv(false);
  if (!env.ready) { setUpStatus('上传引擎不可用，见上方提示'); return; }

  filesEl.classList.remove('hidden');
  filesEl.innerHTML = paths.map((p) => {
    const name = p.split(/[\\/]/).pop();
    return `<li><span>${name}</span><span class="sz">${p}</span></li>`;
  }).join('');

let uploadStartTime = 0;

  uploadStartTime = Date.now();
  uploading = true;
  copyBtn.disabled = true;
  linkEl.value = '';
  setUpProgress(0);
  setUpEta('');
  setUpStatus(`准备上传 ${paths.length} 个文件…`);
  log('开始上传：' + paths.join(' ; '));

  const showWin = chkShowBrowser
    ? chkShowBrowser.checked
    : (S.dbGet('sendgb:showBrowser') !== false);
  const ok = S.upload(paths, onEvent, { showBrowser: showWin });
  if (!ok) { uploading = false; setUpEta(''); setUpStatus('启动失败，见日志'); }
}

function onEvent(e) {
  if (!e) return;
  switch (e.t) {
    case 'progress':
      setUpProgress(e.p);
      if (e.eta) {
        setUpEta(e.eta === '即将完成' ? '即将完成' : `剩余 ${e.eta}`);
      } else if (e.p > 0 && e.p < 100 && uploadStartTime > 0) {
        const elapsed = (Date.now() - uploadStartTime) / 1000;
        if (elapsed >= 1) {
          const rem = Math.round((elapsed / e.p) * (100 - e.p));
          const remStr = formatDuration(rem);
          setUpEta(remStr === '即将完成' ? '即将完成' : `剩余 ${remStr}`);
        }
      } else if (e.p >= 100) {
        setUpEta('即将完成');
      }
      setUpStatus(e.m || ('上传中 ' + e.p + '%'));
      break;
    case 'log':
      log(e.m);
      break;
    case 'done': {
      uploading = false;
      setUpProgress(100);
      const dur = e.durationStr || (uploadStartTime > 0 ? formatElapsed((Date.now() - uploadStartTime) / 1000) : '');
      const durMsg = dur ? `（耗时 ${dur}）` : '';
      setUpEta(dur ? `耗时 ${dur}` : '');
      setUpStatus(`上传完成${durMsg}，上传链接已复制`);
      linkEl.value = e.link;
      copyBtn.disabled = false;
      S.copyText(e.link);
      const names = currentUploadingFiles.map((p) => p.split(/[\\/]/).pop()).filter(Boolean);
      const displayName = names.length > 1 ? `${names[0]} 等 ${names.length} 个文件` : (names[0] || '文件');
      const allNames = names.join(', ');
      addHistory(e.link, displayName, allNames, 'upload');
      log(`完成${durMsg}：` + e.link + (displayName ? ` [${displayName}]` : ''));
      break;
    }
    case 'error':
      uploading = false;
      setUpEta('');
      setUpStatus('失败：' + e.m);
      log('错误：' + e.m);
      break;
    case 'exit':
      if (uploading) {
        uploading = false;
        setUpEta('');
        if (e.code !== 0) {
          setUpStatus('上传中断，见下方日志');
          log('执行器退出码 ' + e.code);
        }
      }
      break;
  }
}

/* ---------------- 下载（接收别人发来的 SendGB 链接） ---------------- */

let downloading = false;
let dlCurrentCode = '';
let dlLastDir = '';
let dlZipTouched = false; // 用户手动改过打包勾选，就不再自动设置

function setMode(mode) {
  const isDown = mode === 'down';
  document.querySelectorAll('.mode').forEach((b) =>
    b.classList.toggle('active', b.getAttribute('data-mode') === mode)
  );
  $('upBox').classList.toggle('hidden', isDown);
  $('downBox').classList.toggle('hidden', !isDown);
  $('footText').textContent = isDown
    ? '下载不经过人机验证，内置 aria2c 16 线程极速下载，支持断点续传'
    : '免注册，单次最多 5GB（上传自动调用 Chrome / Edge，默认显示浏览器窗口）';
  if (isDown) {
    syncDlDir();
    $('dlLink').focus();
  }
}

function syncDlDir(code) {
  const el = $('dlDir');
  if (!S.defaultDownloadDir) return;
  const next = S.defaultDownloadDir(code || '');
  // 用户自己改过目录（与上一次默认值不同）就不覆盖
  if (!el.value || el.value === dlLastDir) el.value = next;
  dlLastDir = S.defaultDownloadDir('');
}

function extractSendgbLink(text) {
  const s = String(text || '').trim();
  const m = s.match(/https?:\/\/(?:www\.)?sendgb\.com\/[A-Za-z0-9._~-]{5,}/i);
  if (m) return m[0];
  if (/^[A-Za-z0-9]{8,24}$/.test(s)) return s;
  return '';
}

function renderDlMeta(meta) {
  dlCurrentCode = meta.code || '';
  const files = meta.files || [];
  $('dlInfo').classList.remove('hidden');
  $('dlTitle').textContent = meta.transferName || `共 ${files.length} 个文件`;
  $('dlMeta').textContent =
    `${files.length} 个文件 · ${meta.totalHuman || ''}` +
    (meta.expiresInDays ? ` · ${meta.expiresInDays} 天后过期` : '') +
    (meta.protected ? ' · 有密码' : '');
  $('dlFiles').innerHTML = files
    .map(
      (f) =>
        `<li><span title="${escapeAttr(f.name)}">${escapeHtml(f.name)}</span><span class="sz">${
          S.human ? S.human(f.size) : f.size
        }</span></li>`
    )
    .join('');
  if (!dlZipTouched) $('chkZip').checked = files.length > 1;
  syncDlDir(dlCurrentCode);
  if (downloading) {
    setDlStatus(`已解析 ${files.length} 个文件，正在自动极速下载…`);
  } else {
    setDlStatus(`解析完成：${files.length} 个文件`);
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

let dlPhase = 'idle'; // 'idle' | 'resolve' | 'download'
let dlLinkValue = '';
let downloadStartTime = 0;
let isResolving = false;
let dlResolvedMeta = null;
let dlResolvedLink = '';

function startResolve(link) {
  if (downloading) {
    setDlStatus('当前下载还在进行中，请稍候…');
    return;
  }
  const target = extractSendgbLink(link || $('dlLink').value);
  if (!target) {
    setDlStatus('请先在上方输入或粘贴有效的 SendGB 链接');
    return;
  }

  // 若相同链接已解析成功且未更改，直接准备就绪
  if (target === dlResolvedLink && dlResolvedMeta) {
    const btnDlStart = $('btnDlStart');
    btnDlStart.disabled = false;
    btnDlStart.textContent = '下载';
    return;
  }

  dlPhase = 'resolve';
  dlLinkValue = target;
  isResolving = true;
  dlResolvedMeta = null;
  dlResolvedLink = '';

  const btnDlStart = $('btnDlStart');
  btnDlStart.disabled = true;
  btnDlStart.textContent = '文件解析中…';
  $('btnDlOpen').disabled = true;

  setDlProgress(0);
  setDlEta('');
  setDlStatus('正在连接并解析文件信息…');
  log('正在自动解析链接：' + target);

  const ok = S.download(
    target,
    { resolveOnly: true },
    onDlEvent
  );
  if (!ok) {
    isResolving = false;
    btnDlStart.disabled = false;
    btnDlStart.textContent = '下载';
    setDlStatus('启动解析失败，见日志');
  }
}

function startDownload(link) {
  if (downloading) {
    setDlStatus('上一个下载还在进行中…');
    return;
  }
  if (isResolving) {
    setDlStatus('文件正在解析中，请稍候…');
    return;
  }
  const target = extractSendgbLink(link || $('dlLink').value);
  if (!target) {
    setDlStatus('请先在上方输入或粘贴 SendGB 链接');
    return;
  }

  // 若尚未成功解析，触发解析
  if (target !== dlResolvedLink || !dlResolvedMeta) {
    startResolve(target);
    return;
  }

  dlPhase = 'download';
  dlLinkValue = target;
  downloadStartTime = Date.now();
  downloading = true;

  const btnDlStart = $('btnDlStart');
  btnDlStart.disabled = true;
  btnDlStart.textContent = '下载中…';
  $('btnDlOpen').disabled = true;

  setDlProgress(0);
  setDlEta('');
  setDlStatus('正在启动极速下载…');
  log('开始下载已解析文件：' + target);

  const ok = S.download(
    target,
    { destDir: $('dlDir').value || S.defaultDownloadDir(''), zip: $('chkZip').checked },
    onDlEvent
  );
  if (!ok) {
    downloading = false;
    setDlEta('');
    btnDlStart.disabled = false;
    btnDlStart.textContent = '下载';
    setDlStatus('启动下载失败，见日志');
  }
}

function onDlEvent(e) {
  if (!e) return;
  switch (e.t) {
    case 'meta': {
      dlResolvedMeta = e;
      dlResolvedLink = dlLinkValue;
      renderDlMeta(e);
      const btnDlStart = $('btnDlStart');
      if (dlPhase === 'resolve') {
        isResolving = false;
        btnDlStart.disabled = false;
        btnDlStart.textContent = '下载';
        const fileCnt = e.fileCount || (e.files || []).length;
        setDlStatus(`解析完成：共 ${fileCnt} 个文件（${e.totalHuman || ''}），点击「下载」开始`);
        log(`解析成功：共 ${fileCnt} 个文件，合计 ${e.totalHuman || ''}`);
      }
      break;
    }
    case 'log':
      log(e.m);
      break;
    case 'file':
      log('已保存：' + e.name);
      break;
    case 'progress':
      setDlProgress(e.p);
      if (e.eta) {
        setDlEta(e.eta === '即将完成' ? '即将完成' : `剩余 ${e.eta}`);
      } else if (e.p > 0 && e.p < 100 && downloadStartTime > 0) {
        const elapsed = (Date.now() - downloadStartTime) / 1000;
        if (elapsed >= 1) {
          const rem = Math.round((elapsed / e.p) * (100 - e.p));
          const remStr = formatDuration(rem);
          setDlEta(remStr === '即将完成' ? '即将完成' : `剩余 ${remStr}`);
        }
      } else if (e.p >= 100) {
        setDlEta('即将完成');
      }
      setDlStatus(e.m || `下载中 ${e.p}%`);
      break;
    case 'done': {
      downloading = false;
      isResolving = false;
      const btnDlStart = $('btnDlStart');
      btnDlStart.disabled = false;
      btnDlStart.textContent = '下载';
      setDlProgress(100);
      const zipNote = e.zip ? '（已打包 ZIP）' : '';
      const dur = e.durationStr || (downloadStartTime > 0 ? formatElapsed((Date.now() - downloadStartTime) / 1000) : '');
      const durMsg = dur ? `（耗时 ${dur}）` : '';
      setDlEta(dur ? `耗时 ${dur}` : '');
      setDlStatus(`下载完成${zipNote}${durMsg}，已保存到 ${e.dir}`);
      $('btnDlOpen').disabled = false;
      $('btnDlOpen').setAttribute('data-dir', e.dir);
      const total = (e.files || []).length;
      const names = (e.files || []).map((p) => p.split(/[\\/]/).pop());
      const display = names.length > 1 ? `${names[0]} 等 ${names.length} 个文件` : names[0] || '文件';
      addHistory(dlLinkValue, display, names.join(', '), 'download', e.dir, { zip: e.zip, files: e.files });
      log(`下载完成${durMsg}：` + e.dir);
      break;
    }
    case 'error': {
      const btnDlStart = $('btnDlStart');
      if (dlPhase === 'resolve') {
        isResolving = false;
        btnDlStart.disabled = false;
        btnDlStart.textContent = '下载';
        setDlStatus('解析失败：' + e.m);
        log('解析失败：' + e.m);
      } else {
        downloading = false;
        setDlEta('');
        btnDlStart.disabled = false;
        btnDlStart.textContent = '下载';
        setDlStatus('下载失败：' + e.m);
        log('错误：' + e.m);
        if (e.dir) {
          $('btnDlOpen').disabled = false;
          $('btnDlOpen').setAttribute('data-dir', e.dir);
        }
      }
      break;
    }
    case 'exit': {
      const btnDlStart = $('btnDlStart');
      if (dlPhase === 'resolve') {
        isResolving = false;
        if (dlResolvedMeta) {
          btnDlStart.disabled = false;
          btnDlStart.textContent = '下载';
        } else {
          btnDlStart.disabled = false;
          btnDlStart.textContent = '下载';
        }
      } else {
        downloading = false;
        setDlEta('');
        btnDlStart.disabled = false;
        btnDlStart.textContent = '下载';
        if (e.code !== 0) {
          log(`${e.phase || '下载'}进程退出，代码 ${e.code}`);
        }
      }
      break;
    }
  }
}

$('btnDlPaste').addEventListener('click', () => {
  const t = (S.readClipboard && S.readClipboard()) || '';
  const link = extractSendgbLink(t);
  if (link) {
    $('dlLink').value = link;
    startResolve(link);
  } else {
    setDlStatus('剪贴板里没有 SendGB 链接');
  }
});

$('dlLink').addEventListener('paste', (ev) => {
  const t = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
  const link = extractSendgbLink(t);
  if (!link) return;
  ev.preventDefault();
  $('dlLink').value = link;
  startResolve(link);
});

$('dlLink').addEventListener('input', () => {
  const raw = $('dlLink').value.trim();
  if (!raw) {
    dlResolvedMeta = null;
    dlResolvedLink = '';
    $('dlInfo').classList.add('hidden');
    $('btnDlStart').disabled = true;
    $('btnDlStart').textContent = '下载';
    setDlStatus('输入或粘贴 SendGB 链接即可开始下载');
    return;
  }
  const link = extractSendgbLink(raw);
  if (link && link !== dlResolvedLink && !isResolving && !downloading) {
    startResolve(link);
  }
});

$('dlLink').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    const link = extractSendgbLink($('dlLink').value);
    if (!link) return;
    if (link === dlResolvedLink && dlResolvedMeta) {
      startDownload(link);
    } else if (!isResolving && !downloading) {
      startResolve(link);
    }
  }
});

$('btnDlStart').addEventListener('click', () => {
  const link = extractSendgbLink($('dlLink').value);
  if (link) {
    startDownload(link);
  } else {
    setDlStatus('请先在上方输入或粘贴 SendGB 链接');
  }
});

$('btnDlDir').addEventListener('click', () => {
  const dir = S.pickDir && S.pickDir();
  if (dir) {
    $('dlDir').value = dir;
    dlLastDir = dir;
    S.setDownloadBaseDir(dir);
    log('下载目录改为：' + dir);
  }
});

$('chkZip').addEventListener('change', () => {
  dlZipTouched = true;
  S.dbSet('sendgb:zip', $('chkZip').checked);
  log($('chkZip').checked ? '下载后打包成一个 ZIP' : '下载后不打包');
});

$('btnDlOpen').addEventListener('click', () => {
  const dir = $('btnDlOpen').getAttribute('data-dir') || $('dlDir').value;
  if (dir) S.openPath(dir);
});

document.querySelectorAll('.mode').forEach((b) => {
  b.addEventListener('click', () => setMode(b.getAttribute('data-mode')));
});

/* ---------------- 模态弹窗（删除确认 / 提示弹窗） ---------------- */

const alertModal = $('alertModal');
const alertTitle = $('alertTitle');
const alertMsg = $('alertMsg');

function showAlert(msgHtml, title = '文件大小超出限制') {
  if (alertTitle) alertTitle.textContent = title;
  if (alertMsg) alertMsg.innerHTML = msgHtml;
  if (alertModal) alertModal.classList.remove('hidden');
}

function hideAlert() {
  if (alertModal) alertModal.classList.add('hidden');
}

if ($('btnAlertOk')) {
  $('btnAlertOk').addEventListener('click', hideAlert);
}
if (alertModal) {
  alertModal.addEventListener('click', (e) => {
    if (e.target === alertModal) hideAlert();
  });
}

let pendingDeleteLink = null;
const confirmModal = $('confirmModal');
const confirmMsg = $('confirmMsg');
function showConfirm(link) {
  pendingDeleteLink = link;
  const list = readHistory();
  const item = list.find((x) => x.link === link);
  const nameDesc = item && item.name && item.name !== '-' ? `<br>文件：<span style="color:var(--fg);font-weight:600;">${item.name}</span>` : '';
  confirmMsg.innerHTML = `确定要删除此条历史记录吗？${nameDesc}<br><span style="color:var(--muted);font-family:monospace;font-size:11px;">${link}</span>`;
  confirmModal.classList.remove('hidden');
}

function hideConfirm() {
  pendingDeleteLink = null;
  confirmModal.classList.add('hidden');
}

function removeHistory(link) {
  const list = readHistory().filter((x) => x.link !== link);
  S.dbSet('sendgb:history', list);
  renderHistory();
  setStatus('已删除历史记录');
  log('已删除历史记录：' + link);
}

$('btnConfirmCancel').addEventListener('click', hideConfirm);
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) hideConfirm();
});

$('btnConfirmOk').addEventListener('click', () => {
  if (pendingDeleteLink) {
    const link = pendingDeleteLink;
    hideConfirm();
    removeHistory(link);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (alertModal && !alertModal.classList.contains('hidden')) {
      hideAlert();
      return;
    }
    if (confirmModal && !confirmModal.classList.contains('hidden')) {
      hideConfirm();
      return;
    }
  }
  if (e.key === 'Enter') {
    if (alertModal && !alertModal.classList.contains('hidden')) {
      hideAlert();
      return;
    }
  }
});

function readHistory() { return S.dbGet('sendgb:history') || []; }

let histFilter = 'all'; // 'all' | 'up' | 'down'

function setHistFilter(filter) {
  histFilter = filter;
  document.querySelectorAll('.hist-filter').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-filter') === filter);
  });
  const colTitle = $('histColTitle');
  const timeTitle = $('histTimeTitle');
  if (filter === 'up') {
    if (colTitle) colTitle.textContent = '上传链接';
    if (timeTitle) timeTitle.textContent = '上传时间';
  } else if (filter === 'down') {
    if (colTitle) colTitle.textContent = '下载链接';
    if (timeTitle) timeTitle.textContent = '下载时间';
  } else {
    if (colTitle) colTitle.textContent = '链接地址';
    if (timeTitle) timeTitle.textContent = '记录时间';
  }
  renderHistory();
}

function addHistory(link, name, fullNames, kind, dir, meta = {}) {
  const list = readHistory().filter((x) => x.link !== link);
  list.unshift({
    link,
    name: name || '文件',
    fullNames: fullNames || name || '文件',
    kind: kind || 'upload',
    dir: dir || '',
    zip: meta.zip || '',
    files: Array.isArray(meta.files) ? meta.files : [],
    at: Date.now()
  });
  S.dbSet('sendgb:history', list.slice(0, 50));
  renderHistory();
}

function renderHistory() {
  const allList = readHistory();
  const upCount = allList.filter((x) => x.kind !== 'download').length;
  const dlCount = allList.filter((x) => x.kind === 'download').length;

  const btnAll = document.querySelector('.hist-filter[data-filter="all"]');
  const btnUp = document.querySelector('.hist-filter[data-filter="up"]');
  const btnDown = document.querySelector('.hist-filter[data-filter="down"]');
  if (btnAll) btnAll.textContent = `全部 (${allList.length})`;
  if (btnUp) btnUp.textContent = `上传链接 (${upCount})`;
  if (btnDown) btnDown.textContent = `下载链接 (${dlCount})`;

  let list = allList;
  if (histFilter === 'up') {
    list = allList.filter((x) => x.kind !== 'download');
  } else if (histFilter === 'down') {
    list = allList.filter((x) => x.kind === 'download');
  }

  if (!list.length) {
    const tip = histFilter === 'up' ? '暂无上传链接记录' : histFilter === 'down' ? '暂无下载链接记录' : '还没有历史记录';
    histEl.innerHTML = `<li style="color:var(--muted);cursor:default;justify-content:center;padding:12px;">${tip}</li>`;
    return;
  }
  histEl.innerHTML = list.map((x) => {
    const d = new Date(x.at);
    const fileName = x.name || '-';
    const fullNames = x.fullNames || fileName;
    const isDl = x.kind === 'download';
    const badge = isDl
      ? '<span class="badge badge-dl">下载链接</span>'
      : '<span class="badge badge-up">上传链接</span>';

    // 检查已下载的文件或目录是否仍然存在（如果存在才显示打开按钮）
    const fileExists = isDl && S.checkFileOrDirExists ? S.checkFileOrDirExists(x) : false;
    const openTarget = (x.zip && S.checkFileOrDirExists && S.checkFileOrDirExists(x.zip))
      ? x.zip
      : (x.dir && S.checkFileOrDirExists && S.checkFileOrDirExists(x.dir) ? x.dir : (x.dir || ''));

    const openBtn = isDl && fileExists && openTarget
      ? `<button class="btn-open" data-open="${escapeAttr(openTarget)}" title="打开已下载的文件或目录">打开</button>`
      : '';
    return `<li data-link="${x.link}" data-dir="${escapeAttr(x.dir || '')}" data-kind="${x.kind || 'upload'}">
      ${badge}<span class="col-link" title="${x.link}">${x.link}</span>
      <span class="col-name" title="${fullNames}">${fileName}</span>
      <span class="col-time" title="${d.toLocaleString()}">${d.toLocaleString()}</span>
      <span class="col-action">${openBtn}<button class="btn-del" data-del="${x.link}" title="删除此记录">删除</button></span>
    </li>`;
  }).join('');
}

document.querySelectorAll('.hist-filter').forEach((b) => {
  b.addEventListener('click', () => setHistFilter(b.getAttribute('data-filter')));
});

histEl.addEventListener('click', (ev) => {
  const openBtn = ev.target.closest('.btn-open');
  if (openBtn) {
    ev.stopPropagation();
    const p = openBtn.getAttribute('data-open');
    if (p && S.openPath) {
      const ok = S.openPath(p);
      if (!ok) {
        renderHistory();
      }
    }
    return;
  }

  const delBtn = ev.target.closest('.btn-del');
  if (delBtn) {
    ev.stopPropagation();
    const link = delBtn.getAttribute('data-del');
    if (link) showConfirm(link);
    return;
  }

  const li = ev.target.closest('li[data-link]');
  if (!li) return;
  const link = li.getAttribute('data-link');
  const kind = li.getAttribute('data-kind');
  if (kind === 'download') {
    if ($('dlLink')) $('dlLink').value = link;
    S.copyText(link);
    setStatus('已复制下载链接');
    log('从历史复制下载链接：' + link);
  } else {
    linkEl.value = link;
    copyBtn.disabled = false;
    S.copyText(link);
    setStatus('已复制上传链接');
    log('从历史复制上传链接：' + link);
  }
});

copyBtn.addEventListener('click', () => {
  if (!linkEl.value) return;
  S.copyText(linkEl.value);
  setStatus('已复制');
});

/* ---------------- 选择 / 拖放 ---------------- */

dropEl.addEventListener('click', () => {
  const files = S.pickFiles();
  if (files && files.length) startUpload(files);
});

['dragenter', 'dragover'].forEach((t) =>
  dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.add('on'); })
);
['dragleave', 'drop'].forEach((t) =>
  dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.remove('on'); })
);
dropEl.addEventListener('drop', (e) => {
  const paths = [];
  const dt = e.dataTransfer;
  if (dt && dt.files) {
    for (const f of dt.files) {
      const p = f.path || (API && API.getPathForFile ? API.getPathForFile(f) : null);
      if (p) paths.push(p);
    }
  }
  if (paths.length) startUpload(paths);
  else {
    setStatus('没拿到文件路径，请改用「点击选择」，或把文件拖到 ZTools 主搜索框');
    log('拖放未拿到路径（宿主环境限制），请用 files 匹配指令：主搜索框拖文件 → 选“用 SendGB 上传”');
  }
});

/* ---------------- 标签页 / 设置 ---------------- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.getAttribute('data-tab');
    ['history', 'log', 'settings'].forEach((n) =>
      $('panel-' + n).classList.toggle('hidden', n !== name)
    );
    if (name === 'history') renderHistory();
  });
});

$('btnSettings').addEventListener('click', () => {
  const tab = [...document.querySelectorAll('.tab')].find((t) => t.getAttribute('data-tab') === 'settings');
  tab.click();
  checkEnv(true);
});

const chkShowBrowser = $('chkShowBrowser');
if (chkShowBrowser) {
  const savedVal = S.dbGet('sendgb:showBrowser');
  chkShowBrowser.checked = savedVal !== false;
  chkShowBrowser.addEventListener('change', () => {
    S.dbSet('sendgb:showBrowser', chkShowBrowser.checked);
    log(chkShowBrowser.checked ? '设置更新：上传时【显示浏览器窗口】' : '设置更新：上传时【后台静默运行】');
  });
}

const chkUseAria2 = $('chkUseAria2');
if (chkUseAria2) {
  const savedVal = S.dbGet('sendgb:useAria2');
  chkUseAria2.checked = savedVal !== false;
  chkUseAria2.addEventListener('change', () => {
    S.dbSet('sendgb:useAria2', chkUseAria2.checked);
    log(chkUseAria2.checked ? '设置更新：优先使用 aria2c 多线程加速' : '设置更新：使用内置下载引擎');
  });
}

$('btnEnv').addEventListener('click', () => checkEnv(true));

$('btnKill').addEventListener('click', () => {
  const killFn = S.killStrayBrowser || S.killStrayChrome;
  if (killFn) {
    killFn((n) => {
      log('已清理残留浏览器进程（Chrome / Edge）：' + n + ' 个');
      setStatus(n ? `已清理 ${n} 个残留浏览器进程` : '当前没有残留的浏览器进程');
    });
  }
});

$('btnCancel').addEventListener('click', () => {
  if (S.cancel()) {
    uploading = false;
    setUpEta('');
    setUpStatus('已中止（若浏览器还开着，点「清理残留浏览器」）');
    log('用户中止上传');
  }
});

$('btnCancelDl').addEventListener('click', () => {
  if (S.cancelDownload && S.cancelDownload()) {
    downloading = false;
    isResolving = false;
    setDlEta('');
    const btnDlStart = $('btnDlStart');
    btnDlStart.disabled = false;
    btnDlStart.textContent = '下载';
    setDlStatus('已中止操作（已下载的部分文件保留，可再次点下载续传）');
    log('用户中止下载/解析');
  } else {
    setDlStatus('当前没有正在进行的下载或解析');
  }
});

/* ---------------- 进入插件的启动参数 ---------------- */

function handleEnter(info) {
  const api = getAPI();
  if (api && api.setExpendHeight) {
    try { api.setExpendHeight(560); } catch (e) {}
  }
  if (!info) return;
  checkEnv(false);

  // 收到 SendGB 链接（例如把链接粘到 ZTools 搜索框）→ 直接进下载模式并自动解析
  const link = extractSendgbLink(info.text);
  if (link && !(info.files && info.files.length)) {
    setMode('down');
    $('dlLink').value = link;
    startResolve(link);
    return;
  }

  if (info.files && info.files.length) {
    setMode('up');
    startUpload(info.files);
  } else {
    setUpStatus(info.text ? `收到文本「${info.text}」，请点选择或拖文件` : '等待文件');
  }
}

window.__onEnter = handleEnter;
if (window.__pendingEnter) { handleEnter(window.__pendingEnter); window.__pendingEnter = null; }

/* ---------------- 初始化 ---------------- */

renderHistory();
checkEnv(false);
syncDlDir();
if (S.dbGet('sendgb:zip') !== undefined) {
  $('chkZip').checked = !!S.dbGet('sendgb:zip');
  dlZipTouched = true;
}
const api = getAPI();
if (api && api.setExpendHeight) {
  try { api.setExpendHeight(560); } catch (e) {}
}
log('插件已就绪（上传 / 接收下载）');
