/**
 * ToolRegistry — 纯工具注册 / 切换 / 状态管理
 *
 * 零 DOM、零 fabric、零平台依赖。
 * 只管理工具定义和当前激活状态，实际工具逻辑由外部 handler 实现。
 *
 * @example
 * const registry = new ToolRegistry({ eventBus });
 * registry.register({ name: 'brush', label: '画笔', shortcut: 'B', handler: myBrushHandler });
 * registry.activate('brush');
 * registry.getActive(); // 'brush'
 */
export default class ToolRegistry {
  /**
   * @param {object} options
   * @param {import('./EventBus.js').EventBus} [options.eventBus]
   */
  constructor({ eventBus = null } = {}) {
    this._eventBus = eventBus;
    this._tools = new Map();   // name -> ToolDefinition
    this._activeTool = null;
    this._toolOptions = {};    // name -> options
  }

  // ── 注册 ──

  /**
   * 注册工具。
   * @param {ToolDefinition} def - { name, label, group?, shortcut?, icon?, defaultOptions?, controls?, presets?, handler? }
   */
  register(def) {
    if (!def || !def.name) {
      throw new Error('[ToolRegistry] 工具定义必须包含 name');
    }

    this._tools.set(def.name, {
      name: def.name,
      label: def.label || def.name,
      group: def.group || 'edit',
      shortcut: def.shortcut || null,
      icon: def.icon || def.name,
      defaultOptions: def.defaultOptions ? { ...def.defaultOptions } : {},
      controls: def.controls || [],
      presets: def.presets || [],
      handler: def.handler || null,
    });

    if (!this._toolOptions[def.name]) {
      this._toolOptions[def.name] = { ...(def.defaultOptions || {}) };
    }
  }

  /**
   * 批量注册。
   * @param {ToolDefinition[]} defs
   */
  registerAll(defs) {
    defs.forEach(d => this.register(d));
  }

  /**
   * 注销工具。
   * @param {string} name
   */
  unregister(name) {
    this._tools.delete(name);
    delete this._toolOptions[name];
    if (this._activeTool === name) {
      this._activeTool = null;
      this._emit('tool:changed', { toolName: null });
    }
  }

  // ── 查询 ──

  /**
   * 获取所有已注册工具。
   * @returns {ToolDefinition[]}
   */
  getAll() {
    return Array.from(this._tools.values());
  }

  /**
   * 按组获取工具。
   * @param {string} group
   * @returns {ToolDefinition[]}
   */
  getByGroup(group) {
    return this.getAll().filter(t => t.group === group);
  }

  /**
   * 获取单个工具定义。
   * @param {string} name
   * @returns {ToolDefinition|null}
   */
  get(name) {
    return this._tools.get(name) || null;
  }

  /**
   * 根据快捷键查找工具。
   * @param {string} key - 按键值（如 'B', 'V', 'M'）
   * @returns {ToolDefinition|null}
   */
  getByShortcut(key) {
    const upper = key.toUpperCase();
    return this.getAll().find(t => t.shortcut === upper) || null;
  }

  /**
   * 工具是否已注册。
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._tools.has(name);
  }

  // ── 激活 ──

  /**
   * 激活工具。
   * @param {string} name
   * @param {object} [options] - 运行时选项（合并到默认选项上）
   * @returns {boolean} 是否成功激活
   */
  activate(name, options = {}) {
    const def = this._tools.get(name);
    if (!def) {
      console.warn(`[ToolRegistry] 未知工具: ${name}`);
      return false;
    }

    // 通知当前工具停用
    const prevName = this._activeTool;
    if (prevName && prevName !== name) {
      const prev = this._tools.get(prevName);
      if (prev?.handler?.deactivate) {
        try { prev.handler.deactivate(); } catch (e) { console.error('[ToolRegistry]', e); }
      }
      this._emit('tool:deactivated', { toolName: prevName });
    }

    this._activeTool = name;

    // 合并选项
    this._toolOptions[name] = {
      ...def.defaultOptions,
      ...options,
    };

    // 通知新工具激活
    if (def.handler?.activate) {
      try { def.handler.activate(this._toolOptions[name]); } catch (e) { console.error('[ToolRegistry]', e); }
    }

    this._emit('tool:changed', {
      toolName: name,
      options: { ...this._toolOptions[name] },
    });

    return true;
  }

  /**
   * 获取当前激活工具名。
   * @returns {string|null}
   */
  getActive() {
    return this._activeTool;
  }

  /**
   * 获取当前工具定义。
   * @returns {ToolDefinition|null}
   */
  getActiveDef() {
    return this._activeTool ? this._tools.get(this._activeTool) || null : null;
  }

  // ── 选项 ──

  /**
   * 获取工具当前选项。
   * @param {string} name
   * @returns {object}
   */
  getOptions(name) {
    return { ...(this._toolOptions[name] || {}) };
  }

  /**
   * 获取当前激活工具的选项。
   * @returns {object}
   */
  getActiveOptions() {
    return this._activeTool ? this.getOptions(this._activeTool) : {};
  }

  /**
   * 更新工具选项。
   * @param {string} name
   * @param {object} patch
   */
  updateOptions(name, patch) {
    if (!this._toolOptions[name]) {
      this._toolOptions[name] = {};
    }
    Object.assign(this._toolOptions[name], patch);
    this._emit('tool:optionsChanged', {
      toolName: name,
      options: { ...this._toolOptions[name] },
    });
  }

  /**
   * 更新当前工具选项。
   * @param {object} patch
   */
  updateActiveOptions(patch) {
    if (this._activeTool) {
      this.updateOptions(this._activeTool, patch);
    }
  }

  // ── 控件 schema 查询 ──

  /**
   * 获取工具的预设列表。
   * @param {string} name
   * @returns {ToolPreset[]}
   */
  getPresets(name) {
    return this._tools.get(name)?.presets || [];
  }

  /**
   * 获取工具的控件 schema。
   * @param {string} name
   * @returns {ToolControlSchema[]}
   */
  getControls(name) {
    return this._tools.get(name)?.controls || [];
  }

  // ── 销毁 ──

  destroy() {
    for (const [name, def] of this._tools) {
      if (def.handler?.deactivate) {
        try { def.handler.deactivate(); } catch (e) { /* ignore */ }
      }
    }
    this._tools.clear();
    this._toolOptions = {};
    this._activeTool = null;
  }

  // ── 内部 ──

  _emit(event, ...args) {
    if (this._eventBus) {
      this._eventBus.emit(event, ...args);
    }
  }
}
