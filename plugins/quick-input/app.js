(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const form = $('command-form');
  const fields = { name: $('command-name'), keyword: $('command-keyword'), text: $('command-text'), enabled: $('command-enabled') };
  const message = $('message');
  let selectedId = null;
  let dirty = false;
  let busy = false;
  let noticeTimer;

  function notify(text, error = false) {
    clearTimeout(noticeTimer);
    message.textContent = text;
    message.classList.toggle('error', error);
    message.setAttribute('role', error ? 'alert' : 'status');
    message.hidden = !text;
    if (text && !error) noticeTimer = setTimeout(() => { message.hidden = true; }, 3500);
  }

  function selected() {
    return window.quickInput?.list().find(command => command.id === selectedId);
  }

  function updateActions() {
    const command = selected();
    const unavailable = !command || !command.enabled || dirty || busy;
    $('bind-command').disabled = unavailable;
    $('type-command').disabled = unavailable;
    $('delete-command').disabled = !command || busy;
    $('save-command').disabled = !window.quickInput || busy;
    $('editor-state').textContent = dirty ? '未保存' : command ? '已保存' : '新命令';
    $('editor-state').classList.toggle('dirty', dirty);
    $('action-help').textContent = dirty ? '保存修改后，再绑定快捷键或输入。'
      : !command ? '保存命令后，给它绑定一个快捷键。'
      : !command.enabled ? '命令已停用；启用并保存后可绑定快捷键。'
      : '修改触发词后，请重新绑定快捷键。';
  }

  function updateTextInfo() {
    const text = fields.text.value;
    $('text-count').textContent = `${text.length} 字符`;
    const leading = text.match(/^ +/u)?.[0].length || 0;
    const trailing = text.match(/ +$/u)?.[0].length || 0;
    $('text-spaces').textContent = trailing ? `末尾 ${trailing} 个空格` : leading ? `开头 ${leading} 个空格` : '';
  }

  function loadEditor(command) {
    selectedId = command?.id || null;
    fields.name.value = command?.name || '';
    fields.keyword.value = command?.keyword || '';
    fields.text.value = command?.text || '';
    fields.enabled.checked = command?.enabled ?? true;
    dirty = false;
    $('editor-title').textContent = command ? '编辑命令' : '新增命令';
    updateTextInfo();
    updateActions();
  }

  function renderList() {
    const commands = window.quickInput?.list() || [];
    const query = $('search').value.trim().toLowerCase();
    const filtered = commands.filter(command => `${command.name} ${command.keyword} ${command.text}`.toLowerCase().includes(query));
    $('command-count').textContent = `${commands.length} 条 · ${commands.filter(command => command.enabled).length} 启用`;
    const list = $('command-list');
    list.replaceChildren();

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      const key = document.createElement('span');
      key.className = 'empty-key';
      key.textContent = '>_';
      key.setAttribute('aria-hidden', 'true');
      const heading = document.createElement('h2');
      heading.textContent = commands.length ? '没有匹配的命令' : '还没有命令';
      const hint = document.createElement('p');
      hint.textContent = commands.length ? '换个搜索词试试。' : '添加你自己的命令，再绑定快捷键。';
      empty.append(key, heading, hint);
      list.append(empty);
      return;
    }

    for (const command of filtered) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'command-item';
      button.classList.toggle('selected', command.id === selectedId);
      button.classList.toggle('off', !command.enabled);
      button.dataset.commandId = command.id;
      button.setAttribute('aria-pressed', String(command.id === selectedId));
      const top = document.createElement('span');
      top.className = 'command-top';
      const name = document.createElement('span');
      name.className = 'command-name';
      name.textContent = command.name;
      top.append(name);
      if (!command.enabled) {
        const off = document.createElement('span');
        off.className = 'command-off';
        off.textContent = '已停用';
        top.append(off);
      }
      const keyword = document.createElement('span');
      keyword.className = 'command-keyword';
      keyword.textContent = command.keyword;
      const text = document.createElement('span');
      text.className = 'command-text';
      text.textContent = command.text;
      text.title = command.text;
      button.append(top, keyword, text);
      button.addEventListener('click', () => {
        loadEditor(command);
        notify('');
        renderList();
      });
      list.append(button);
    }
  }

  form.addEventListener('input', () => {
    dirty = true;
    updateTextInfo();
    updateActions();
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    try {
      if (!window.quickInput) throw new Error(window.quickInputError || '插件尚未就绪，请重新打开。');
      const previous = selected();
      const saved = window.quickInput.save({
        id: selectedId || undefined,
        name: fields.name.value,
        keyword: fields.keyword.value,
        text: fields.text.value,
        enabled: fields.enabled.checked,
      });
      loadEditor(saved);
      renderList();
      notify(previous && previous.keyword !== saved.keyword ? '已保存。触发词已修改，请重新绑定快捷键。' : '命令已保存。');
    } catch (error) {
      notify(error.message, true);
    }
  });

  $('new-command').addEventListener('click', () => {
    loadEditor(null);
    notify('');
    renderList();
    fields.name.focus();
  });
  $('search').addEventListener('input', renderList);

  async function runAction(action) {
    if (busy || dirty || !selected()?.enabled) return;
    busy = true;
    updateActions();
    try {
      await action(selectedId);
    } catch (error) {
      notify(error.message, true);
    } finally {
      busy = false;
      updateActions();
    }
  }
  $('bind-command').addEventListener('click', () => runAction(id => window.quickInput.bind(id)));
  $('type-command').addEventListener('click', () => runAction(id => window.quickInput.type(id)));

  $('delete-command').addEventListener('click', () => $('delete-dialog').showModal());
  $('cancel-delete').addEventListener('click', () => $('delete-dialog').close());
  $('confirm-delete').addEventListener('click', () => {
    try {
      window.quickInput.remove(selectedId);
      $('delete-dialog').close();
      loadEditor(window.quickInput.list()[0]);
      renderList();
      notify('命令已删除。已绑定的快捷键请在 ZTools 设置里删除。');
    } catch (error) {
      $('delete-dialog').close();
      notify(error.message, true);
    }
  });

  function refresh() {
    loadEditor(selected() || window.quickInput?.list()[0]);
    renderList();
    if (window.quickInputError) notify(window.quickInputError, true);
  }
  window.addEventListener('quick-input-refresh', refresh);
  window.addEventListener('quick-input-error', event => notify(event.detail, true));
  $('preview-banner').hidden = !window.quickInputPreview;
  refresh();
})();
