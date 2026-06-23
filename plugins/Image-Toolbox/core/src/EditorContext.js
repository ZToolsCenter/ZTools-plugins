import { EventBus } from './EventBus.js';

/**
 * EditorContext — 多端共享上下文容器
 *
 * 集中持有 EventBus、EngineAdapter、HostAdapter、HistoryStore、LayerStore 等实例。
 * 由应用层（App）创建并注入各模块，避免全局单例和硬编码依赖。
 */
export default class EditorContext {
  /**
   * @param {object} options
   * @param {import('./interfaces/EditorEngineAdapter.js').default} options.engine
   * @param {import('./interfaces/HostAdapter.js').default} [options.host]
   * @param {EventBus} [options.eventBus]
   * @param {number} [options.maxHistorySteps=30]
   */
  constructor({ engine, host = null, eventBus = null, maxHistorySteps = 30 } = {}) {
    /** @type {EventBus} */
    this.eventBus = eventBus || new EventBus();

    /** @type {import('./interfaces/EditorEngineAdapter.js').default} */
    this.engine = engine;

    /** @type {import('./interfaces/HostAdapter.js').default} */
    this.host = host;

    /** @type {number} */
    this.maxHistorySteps = maxHistorySteps;

    /** @type {object[]} 历史栈（snapshot 模式） */
    this._undoStack = [];

    /** @type {object[]} 重做栈 */
    this._redoStack = [];

    /** @type {boolean} */
    this._isRestoring = false;

    /** @type {string|null} 当前激活的工具名 */
    this._activeTool = null;

    /** @type {object} 当前工具选项 */
    this._toolOptions = {};
  }

  // ── 工具管理 ──

  /**
   * 激活工具。
   * @param {string} toolName
   * @param {object} [options]
   */
  setActiveTool(toolName, options = {}) {
    this._activeTool = toolName;
    this._toolOptions = { ...options };
    this.eventBus.emit('tool:changed', { toolName, options: this._toolOptions });
  }

  /**
   * 获取当前工具名。
   * @returns {string|null}
   */
  getActiveTool() {
    return this._activeTool;
  }

  /**
   * 获取当前工具选项。
   * @returns {object}
   */
  getToolOptions() {
    return { ...this._toolOptions };
  }

  /**
   * 更新当前工具选项。
   * @param {object} patch
   */
  updateToolOptions(patch) {
    Object.assign(this._toolOptions, patch);
    this.eventBus.emit('tool:optionsChanged', this._toolOptions);
  }

  // ── 历史管理（snapshot 模式） ──

  /**
   * 保存当前快照到历史栈。
   * @param {object} snapshot
   */
  saveSnapshot(snapshot) {
    if (this._isRestoring) return;

    this._undoStack.push(snapshot);

    if (this._undoStack.length > this.maxHistorySteps) {
      this._undoStack.shift();
    }

    this._redoStack = [];
    this._notifyHistory();
  }

  /**
   * 撤销。
   * @param {object} currentSnapshot
   * @returns {object|null} 恢复的快照，无可撤销时返回 null
   */
  undo(currentSnapshot) {
    if (this._undoStack.length === 0) return null;

    this._isRestoring = true;
    this._redoStack.push(currentSnapshot);
    const prev = this._undoStack.pop();
    this._isRestoring = false;

    this._notifyHistory();
    return prev;
  }

  /**
   * 重做。
   * @param {object} currentSnapshot
   * @returns {object|null} 恢复的快照，无可重做时返回 null
   */
  redo(currentSnapshot) {
    if (this._redoStack.length === 0) return null;

    this._isRestoring = true;
    this._undoStack.push(currentSnapshot);
    const next = this._redoStack.pop();
    this._isRestoring = false;

    this._notifyHistory();
    return next;
  }

  /** @returns {{ canUndo: boolean, canRedo: boolean, undoCount: number }} */
  getHistoryState() {
    return {
      canUndo: this._undoStack.length > 0,
      canRedo: this._redoStack.length > 0,
      undoCount: this._undoStack.length,
    };
  }

  /** 清空历史栈。 */
  clearHistory() {
    this._undoStack = [];
    this._redoStack = [];
    this._notifyHistory();
  }

  _notifyHistory() {
    this.eventBus.emit('history:changed', this.getHistoryState());
  }

  // ── 导出 ──

  /**
   * 生成当前画布的 dataURL（委托给 engine adapter）。
   * @param {object} [options] - { format, quality, multiplier, trimToImage }
   * @returns {string|null}
   */
  exportToDataURL(options = {}) {
    return this.engine?.exportToDataURL(options) || null;
  }

  /**
   * 保存图片（委托给 host adapter）。
   * @param {Blob|string} data
   * @param {string} [suggestedName]
   * @returns {Promise<boolean>}
   */
  async saveImage(data, suggestedName) {
    if (!this.host?.saveImage) return false;
    return this.host.saveImage(data, suggestedName);
  }

  /**
   * 复制图片到剪贴板（委托给 host adapter）。
   * @param {Blob|string} data
   * @returns {Promise<boolean>}
   */
  async copyImage(data) {
    if (!this.host?.copyImage) return false;
    return this.host.copyImage(data);
  }

  // ── 生命周期 ──

  /**
   * 销毁上下文，释放所有资源。
   */
  destroy() {
    this.engine?.destroy();
    this.eventBus.clear();
    this._undoStack = [];
    this._redoStack = [];
    this._activeTool = null;
  }
}
