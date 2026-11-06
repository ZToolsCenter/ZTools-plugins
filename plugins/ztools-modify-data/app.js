'use strict';
const $ = id => document.getElementById(id);
const api = window.dataEditor;
const layout = window.editorLayout;
const state = { plugins: [], plugin: null, records: [], record: null, mode: null, initial: '', forceDirty: false, busy: false, connected: false };
const pretty = value => JSON.stringify(value, null, 2);
const bytes = text => new TextEncoder().encode(text).length;
const formatBytes = n => n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
const dirty = () => !!state.record && (state.forceDirty || $('editor').value !== state.initial);
let toastTimer;
let validationTimer;

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.toggle('error', error);
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4500);
}

function ask({ title, description, preview, label = '确认', eyebrow = '确认操作' }) {
  $('modal-title').textContent = title;
  $('modal-description').textContent = description;
  $('modal-preview').textContent = preview || '';
  $('modal-preview').hidden = !preview;
  $('modal-confirm').textContent = label;
  $('modal-eyebrow').textContent = eyebrow;
  $('modal').showModal();
  return new Promise(resolve => {
    const finish = value => {
      $('modal').close();
      $('modal-confirm').onclick = $('modal-cancel').onclick = $('modal').oncancel = null;
      resolve(value);
    };
    $('modal-confirm').onclick = () => finish(true);
    $('modal-cancel').onclick = () => finish(false);
    $('modal').oncancel = event => { event.preventDefault(); finish(false); };
  });
}

async function canLeave() {
  return !dirty() || await ask({ title: '放弃未保存的修改？', description: '编辑区的修改尚未写入插件数据。', label: '放弃修改' });
}

async function run(action) {
  if (state.busy) return;
  state.busy = true;
  try { await action(); } catch (error) { toast(error.message || String(error), true); }
  finally { state.busy = false; validate(); }
}

function text(tag, className, content) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
}

function renderPlugins() {
  const search = $('plugin-search').value.toLocaleLowerCase();
  const visible = state.plugins.filter(p => `${p.title} ${p.name}`.toLocaleLowerCase().includes(search));
  $('plugin-count').textContent = state.plugins.length;
  $('plugin-list').replaceChildren();
  for (const item of visible) {
    const button = text('button', `plugin-item${state.plugin?.name === item.name ? ' selected' : ''}`, '');
    button.setAttribute('aria-pressed', String(state.plugin?.name === item.name));
    button.title = `${item.title} (${item.name})`;
    const copy = text('div', 'plugin-copy', '');
    copy.append(text('strong', '', item.title), text('small', '', item.installed ? item.name : `${item.name} · 残留数据`));
    button.append(text('span', 'plugin-avatar', item.title.slice(0, 1).toUpperCase()), copy, text('span', 'item-count', String(item.count)));
    button.onclick = () => run(async () => { if (await canLeave()) await selectPlugin(item); });
    $('plugin-list').append(button);
  }
  if (!visible.length) $('plugin-list').append(text('p', 'list-empty', !state.connected ? '未连接数据目录' : state.plugins.length ? '没有匹配的数据空间' : '当前账号暂无插件数据'));
}

function renderRecords() {
  const search = $('record-search').value.toLocaleLowerCase();
  const visible = state.records.filter(row => `${row.key} ${row.searchText || row.preview}`.toLocaleLowerCase().includes(search));
  $('record-count').textContent = state.records.length;
  $('record-list').replaceChildren();
  for (const row of visible) {
    const button = text('button', `record-item${state.record?.key === row.key ? ' selected' : ''}`, '');
    button.setAttribute('aria-pressed', String(state.record?.key === row.key));
    button.title = row.key;
    const bottom = text('div', 'record-bottom', '');
    bottom.append(text('span', '', row.kind === 'value' ? 'dbStorage' : row.kind === 'invalid' ? '不可编辑' : '文档'), text('span', '', formatBytes(row.bytes)));
    button.append(text('strong', '', row.key), text('small', '', row.preview), bottom);
    button.disabled = row.kind === 'invalid';
    button.onclick = () => run(async () => { if (await canLeave()) await selectRecord(row.key); });
    $('record-list').append(button);
  }
  if (!visible.length) $('record-list').append(text('p', 'list-empty', !state.plugin ? '选择左侧插件以查看数据' : state.records.length ? '没有匹配的记录' : '该插件尚无数据库记录。插件可能使用自己的文件或 localStorage。'));
  $('export').disabled = !state.plugin || !state.records.length;
}

function clearEditor() {
  state.record = null;
  state.initial = '';
  state.forceDirty = false;
  $('editor').value = '';
  $('editor-pane').hidden = true;
  $('empty-state').hidden = false;
  layout.recordClosed();
}

async function selectPlugin(plugin) {
  const records = await api.records(plugin.name);
  state.plugin = plugin;
  state.records = records;
  clearEditor();
  $('record-search').value = '';
  renderPlugins();
  renderRecords();
}

async function loadHistory() {
  const history = await api.history(state.plugin.name, state.record.key);
  $('history').replaceChildren(text('option', '', history.length ? '选择保存前的备份…' : '暂无备份 · 首次保存时创建'));
  $('history').firstChild.value = '';
  for (const item of history) {
    const option = text('option', '', `${new Date(item.savedAt).toLocaleString('zh-CN')} · ${item.rev?.split('-')[0] || ''} 版`);
    option.value = item.id;
    $('history').append(option);
  }
  $('restore').disabled = true;
}

async function showRecord(record) {
  state.record = record;
  state.mode = record.kind;
  state.initial = pretty(record.content);
  state.forceDirty = false;
  $('editor').value = state.initial;
  $('breadcrumb').textContent = `${state.plugin.title} / ${state.plugin.name}`;
  $('record-title').textContent = record.key;
  $('kind-badge').textContent = record.kind === 'value' ? 'dbStorage' : 'JSON 文档';
  $('revision').textContent = `版本 ${record.rev}`;
  $('revision').title = record.rev;
  $('attachment-info').textContent = record.hasAttachment ? '包含附件 · 附件内容保留' : '';
  $('value-mode').hidden = record.kind !== 'value';
  $('editor-pane').hidden = false;
  $('empty-state').hidden = true;
  modeTabs();
  await loadHistory();
  renderRecords();
  validate();
  layout.recordOpened();
}

async function selectRecord(key) { await showRecord(await api.read(state.plugin.name, key)); }
function modeTabs() { $('value-mode').classList.toggle('active', state.mode === 'value'); $('document-mode').classList.toggle('active', state.mode === 'document'); }

function getContent() {
  const content = JSON.parse($('editor').value);
  if (state.mode === 'document' && (!content || Array.isArray(content) || typeof content !== 'object')) throw new Error('文档字段必须是 JSON 对象');
  if (state.mode === 'document') {
    const reserved = ['_id', '_rev', '_attachments', '_deleted', '_lastModified', '_cloudSynced', '_conflicts', '_revisions', '_sync'];
    const field = Object.keys(content).find(key => reserved.includes(key));
    if (field) throw new Error(`${field} 是系统字段，不能修改`);
  }
  if (bytes(JSON.stringify(content)) > 1024 * 1024) throw new Error('数据超过 1 MB');
  return content;
}

function validate() {
  if (!state.record) { $('save').disabled = true; return; }
  let valid = true;
  try { getContent(); $('json-status').textContent = '✓ 有效 JSON'; }
  catch (error) { valid = false; $('json-status').textContent = error.message; }
  $('json-status').classList.toggle('invalid', !valid);
  $('size-status').textContent = `${$('editor').value.split('\n').length} 行 · ${formatBytes(bytes($('editor').value))}`;
  $('dirty-status').textContent = dirty() ? '● 有未保存的修改' : '已保存';
  $('dirty-status').classList.toggle('dirty', dirty());
  $('save').disabled = !valid || !dirty() || state.busy;
  layout.update();
}

function changedFields(before, after) {
  if (Array.isArray(before) || Array.isArray(after) || before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return pretty(after);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).map(key => `${key}\n  原值：${JSON.stringify(before[key]) ?? '（不存在）'}\n  新值：${JSON.stringify(after[key]) ?? '（删除字段）'}`).join('\n\n') || '内容格式已调整，数据值相同';
}

async function save() {
  if (!dirty()) return;
  const content = getContent();
  const body = Object.fromEntries(Object.entries(state.record.document).filter(([key]) => !['_id', '_rev', '_attachments', '_deleted', '_lastModified', '_cloudSynced', '_conflicts', '_revisions', '_sync'].includes(key)));
  const before = state.mode === 'value' && state.record.kind === 'value' ? body.value : body;
  const after = state.mode === 'value' && state.record.kind !== 'value' ? { value: content } : content;
  if (!await ask({ title: `保存 ${state.record.key} 的修改？`, description: `将写入「${state.plugin.title}」。保存前自动备份原数据；重新打开目标插件后读取新值。`, preview: changedFields(before, after), label: '备份并保存', eyebrow: '检查修改' })) return;
  const result = await api.save({ plugin: state.plugin.name, key: state.record.key, content, kind: state.mode, token: state.record.token });
  await showRecord(result);
  state.records = await api.records(state.plugin.name);
  renderRecords();
  toast('已保存，原数据已备份。请重新打开目标插件。');
}

async function connect(root) {
  state.connected = false;
  clearEditor();
  state.plugin = null; state.records = []; state.plugins = [];
  renderPlugins(); renderRecords();
  $('connection').textContent = '连接中';
  try {
    const info = await api.connect(root);
    state.plugins = (await api.plugins()).filter(plugin => plugin.count > 0);
    state.connected = true;
    $('root-path').textContent = info.root;
    $('root-path').title = info.root;
    $('account-label').textContent = info.accountLabel;
    $('connection').textContent = api.isDemo ? '演示模式' : '本地已连接';
    renderPlugins();
    if (!api.isDemo) { $('notice').textContent = '编辑前请退出目标插件。保存后重新打开；云同步可能需要重启 ZTools 才能感知修改。'; $('notice').hidden = false; }
    return info;
  } catch (error) {
    $('connection').textContent = '未连接';
    $('notice').textContent = error.message;
    $('notice').hidden = false;
    $('root-path').textContent = '未连接 ZTools 数据目录';
    $('account-label').textContent = '';
    throw error;
  }
}

$('plugin-search').oninput = renderPlugins;
$('record-search').oninput = renderRecords;
$('editor').oninput = () => {
  clearTimeout(validationTimer);
  $('save').disabled = true;
  $('dirty-status').textContent = '● 有未保存的修改';
  $('dirty-status').classList.add('dirty');
  $('json-status').textContent = '正在校验…';
  validationTimer = setTimeout(validate, 180);
};
$('editor').onkeydown = event => {
  if (event.key === 'Tab') { event.preventDefault(); const editor = $('editor'); editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end'); validate(); }
};
$('save').onclick = () => run(save);
$('format').onclick = () => run(() => { $('editor').value = pretty(getContent()); });
$('reload-record').onclick = () => run(async () => { if (await canLeave()) await selectRecord(state.record.key); });
$('refresh').onclick = () => run(async () => { if (await canLeave()) await connect(state.connected ? $('root-path').textContent : undefined); });
$('backups').onclick = () => run(async () => { const root = await api.openBackups(); if (api.isDemo) toast(root); });
$('export').onclick = () => run(async () => { const target = await api.export(state.plugin.name); if (target) toast(`已导出：${target}`); });
$('history').onchange = () => { $('restore').disabled = !$('history').value; };
$('restore').onclick = () => run(async () => {
  if (!await canLeave()) return;
  const snapshot = await api.backupContent(state.plugin.name, state.record.key, $('history').value);
  state.mode = snapshot.kind;
  $('editor').value = pretty(snapshot.content);
  const body = Object.fromEntries(Object.entries(state.record.document).filter(([key]) => !['_id', '_rev', '_attachments', '_deleted', '_lastModified', '_cloudSynced', '_conflicts', '_revisions', '_sync'].includes(key)));
  state.forceDirty = snapshot.kind === 'value' && (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'value'));
  state.initial = pretty(snapshot.kind === 'value' ? (Object.hasOwn(body, 'value') ? body.value : null) : body);
  modeTabs(); toast('备份已回填到编辑器，检查后保存即可恢复。');
});
async function switchMode(mode) {
  if (state.mode === mode) return;
  const content = getContent();
  if (mode === 'document') {
    $('editor').value = pretty({ value: content });
    state.initial = pretty({ value: JSON.parse(state.initial) });
  } else {
    if (Object.keys(content).length !== 1 || !Object.hasOwn(content, 'value')) throw new Error('当前文档包含额外字段，请在「文档字段」模式保存');
    $('editor').value = pretty(content.value);
    state.initial = pretty(JSON.parse(state.initial).value);
  }
  state.mode = mode; modeTabs();
}
$('value-mode').onclick = () => run(() => switchMode('value'));
$('document-mode').onclick = () => run(() => switchMode('document'));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!$('save').disabled && !$('modal').open) run(save); }
});
let allowWindowClose = false;
window.addEventListener('beforeunload', event => {
  if (!dirty() || allowWindowClose) return;
  event.preventDefault(); event.returnValue = '';
  if (new URL(location.href).searchParams.get('large') === '1' && !state.busy && !$('modal').open) {
    setTimeout(() => run(async () => {
      if (await ask({ title: '关闭编辑窗口？', description: '当前修改尚未保存。取消后可以继续编辑或保存。', label: '放弃修改并关闭' })) { allowWindowClose = true; window.close(); }
    }), 0);
  }
});
if (api.isDemo) { $('notice').textContent = '浏览器演示 · 以下数据为虚构示例，操作不会修改本机 ZTools 数据。'; $('notice').hidden = false; }
$('large-window').disabled = !api.openLargeWindow;
$('back-to-list').onclick = () => run(async () => { if (await canLeave()) { clearEditor(); renderRecords(); } });
$('large-window').onclick = () => run(async () => {
  if (!state.connected) throw new Error('请先连接数据目录');
  await api.openLargeWindow({ plugin: state.plugin?.name || null, record: state.record, draft: $('editor').value, mode: state.mode, initial: state.initial, forceDirty: state.forceDirty, layout: layout.snapshot() });
  toast('大窗口已打开，当前内容和未保存的修改已带入。');
});
if (new URL(location.href).searchParams.get('large') === '1') $('large-window').hidden = true;
run(async () => {
  const context = await api.takeLaunchContext?.();
  const info = await connect(context?.root);
  if (context && context.account !== info.account) throw new Error('ZTools 账号已切换，请从原窗口重新连接并打开大窗口');
  try { await api.prepareLayout?.(); } catch {}
  if (!context?.plugin) return;
  const plugin = state.plugins.find(item => item.name === context.plugin);
  if (!plugin) throw new Error('原窗口中的插件已不可用');
  await selectPlugin(plugin);
  if (!context.record) return;
  // Keep the original token: a newer value must trigger the same conflict check.
  await showRecord(context.record);
  state.mode = context.mode;
  state.initial = context.initial;
  state.forceDirty = context.forceDirty;
  $('editor').value = context.draft;
  modeTabs();
  layout.restore(context.layout);
});
