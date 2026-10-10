(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuickInput = factory();
})(globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'quick-input.commands.v1';
  const FEATURE_PREFIX = 'quick-input-';
  const MANAGER_KEYWORDS = ['快捷输入', '命令管理', 'quick input'];

  function validateCommand(input) {
    if (!input || typeof input !== 'object') throw new Error('命令配置数据无效。');
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
    const text = input.text;
    if (!name || name.length > 60) throw new Error('命令名称需要 1–60 个字符。');
    if (!keyword || keyword.length > 80 || /[\u0000-\u001f\u007f]/u.test(keyword)) {
      throw new Error('触发词需要 1–80 个字符，不能包含控制字符。');
    }
    if (keyword.includes('/')) throw new Error('触发词不能包含 /，ZTools 用它区分插件和指令。');
    if (MANAGER_KEYWORDS.includes(keyword.toLowerCase())) throw new Error('该触发词是命令管理入口的保留词。');
    if (typeof text !== 'string' || !text.trim() || text.length > 10000) {
      throw new Error('输入内容需要 1–10000 个字符，不能全部为空格。');
    }
    if (/[\u0000-\u001f\u007f]/u.test(text)) throw new Error('输入内容仅支持单行文字，不能包含换行或控制字符。');
    if (typeof input.enabled !== 'boolean') throw new Error('命令启用状态无效。');
    if (typeof input.id !== 'string' || !/^[a-z0-9-]{1,80}$/u.test(input.id)) throw new Error('命令配置 ID 无效。');
    // Do not trim text: trailing spaces are useful for command arguments.
    return { id: input.id, name, keyword, text, enabled: input.enabled };
  }

  function validateCommands(value) {
    if (!Array.isArray(value)) throw new Error('已保存的命令配置数据无效，请检查本地数据。');
    const commands = value.map(validateCommand);
    if (new Set(commands.map(command => command.id)).size !== commands.length) throw new Error('命令配置 ID 重复。');
    if (new Set(commands.map(command => command.keyword.toLowerCase())).size !== commands.length) {
      throw new Error('触发词已存在，请换一个不重复的触发词。');
    }
    return commands;
  }

  function createQuickInput(host) {
    let commands = [];

    function persist(next) {
      const result = host.dbStorage.setItem(STORAGE_KEY, next);
      if (result === false || result?.error || result?.ok === false || result?.success === false) {
        throw new Error('保存命令失败：' + (result?.error || '请检查 ZTools 本地存储。'));
      }
    }

    function syncFeatures(next) {
      const current = host.getFeatures();
      if (!Array.isArray(current)) throw new Error('读取 ZTools 功能失败，请更新 ZTools。');
      const wanted = next.filter(command => command.enabled).map(command => ({
        code: FEATURE_PREFIX + command.id,
        explain: command.name + ' · 快捷输入',
        // Matching commands remain valid shortcut targets by label. Unlike text
        // commands, ZTools does not add each one to its recent-command tiles.
        cmds: [{
          type: 'regex',
          label: command.keyword,
          match: '/^' + command.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$/i',
          minLength: command.keyword.length,
        }],
        mainHide: true,
      }));
      const wantedCodes = new Set(wanted.map(feature => feature.code));
      for (const feature of current) {
        if (feature.code.startsWith(FEATURE_PREFIX) && !wantedCodes.has(feature.code)) {
          if (host.removeFeature(feature.code) === false) throw new Error('移除快捷输入功能失败。');
        }
      }
      for (const feature of wanted) {
        const existing = current.find(item => item.code === feature.code);
        if (existing?.mainHide === true && existing.explain === feature.explain && JSON.stringify(existing.cmds) === JSON.stringify(feature.cmds)) continue;
        const result = host.setFeature(feature);
        if (result === false || result?.success === false) throw new Error('注册命令功能失败，请检查触发词是否冲突。');
      }
    }

    function commit(next) {
      const validated = validateCommands(next);
      // Save first; a failed disk write must not disturb registered shortcuts.
      persist(validated);
      try {
        syncFeatures(validated);
      } catch (error) {
        try {
          persist(commands);
          syncFeatures(commands);
        } catch (rollbackError) {
          throw new Error('功能同步失败，恢复旧配置也失败。请重新打开插件检查。', { cause: new AggregateError([error, rollbackError]) });
        }
        throw error;
      }
      commands = validated;
    }

    function refresh() {
      const saved = host.dbStorage.getItem(STORAGE_KEY);
      const next = validateCommands(saved == null ? [] : saved);
      if (saved == null) persist(next);
      syncFeatures(next);
      commands = next;
      return list();
    }

    function list() {
      return commands.map(command => ({ ...command }));
    }

    function find(id, requireEnabled = false) {
      const command = commands.find(item => item.id === id);
      if (!command) throw new Error('该命令已删除或不存在。');
      if (requireEnabled && !command.enabled) throw new Error('该命令已停用，请先在命令管理中启用。');
      return command;
    }

    function save(input) {
      const id = input.id || globalThis.crypto.randomUUID();
      if (input.id) find(input.id);
      const command = validateCommand({ ...input, id });
      const next = list();
      const index = next.findIndex(item => item.id === id);
      if (index === -1) next.push(command);
      else next[index] = command;
      commit(next);
      return { ...command };
    }

    function remove(id) {
      find(id);
      commit(commands.filter(command => command.id !== id));
    }

    async function type(id) {
      const command = find(id, true);
      if (typeof host.hideMainWindowTypeString !== 'function') throw new Error('当前 ZTools 版本不支持模拟输入，请更新 ZTools。');
      if (typeof host.hideMainWindow !== 'function') throw new Error('当前 ZTools 版本不支持焦点恢复，请更新 ZTools。');
      if (typeof host.outPlugin !== 'function') throw new Error('当前 ZTools 版本不支持退出插件，请更新 ZTools。');
      if (await host.hideMainWindow(true) === false) throw new Error('隐藏 ZTools 窗口失败。');
      // ZTools 3.2 types immediately inside its combined API. Hide first and allow
      // the OS focus change and a normal shortcut key release to settle.
      await new Promise(resolve => setTimeout(resolve, 200));
      const latest = find(command.id, true);
      if (await host.hideMainWindowTypeString(latest.text) === false) throw new Error('模拟输入失败，请确认目标窗口有可输入的光标。');
      // Merely hiding leaves the same text feature active; ZTools then suppresses
      // the next onPluginEnter. Detach this invocation while keeping the cache.
      if (await host.outPlugin(false) === false) throw new Error('文字已输入，但退出插件失败，请重新打开插件。');
    }

    async function bind(id) {
      const command = find(id, true);
      if (typeof host.redirectHotKeySetting !== 'function') throw new Error('当前 ZTools 版本不支持快捷键跳转，请在 ZTools 设置中手动绑定。');
      if (await host.redirectHotKeySetting(command.keyword) === false) throw new Error('打开快捷键设置失败。');
    }

    async function copy(id) {
      if (await host.copyText(find(id).text) === false) throw new Error('复制失败。');
    }

    refresh();
    return { list, refresh, save, remove, type, bind, copy };
  }

  return { createQuickInput, FEATURE_PREFIX };
});
