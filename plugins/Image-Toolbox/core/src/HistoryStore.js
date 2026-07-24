/**
 * HistoryStore — 纯状态历史管理
 *
 * 零 DOM、零 fabric、零平台依赖。
 * 通过外部传入的 snapshotProvider / snapshotRestorer 与引擎交互。
 *
 * @example
 * const store = new HistoryStore({
 *   maxSteps: 30,
 *   snapshotProvider: () => canvas.toJSON(),
 *   snapshotRestorer: (json) => canvas.loadFromJSON(json),
 *   eventBus,
 * });
 */
export default class HistoryStore {
  /**
   * @param {object} options
   * @param {number} [options.maxSteps=30]
   * @param {function} options.snapshotProvider - () => snapshot（纯 JSON，平台无关）
   * @param {function} options.snapshotRestorer - (snapshot) => Promise<void>
   * @param {import('./EventBus.js').EventBus} [options.eventBus]
   */
  constructor({ maxSteps = 30, snapshotProvider, snapshotRestorer, eventBus = null } = {}) {
    if (typeof snapshotProvider !== 'function') {
      throw new Error('[HistoryStore] snapshotProvider 必须是函数');
    }
    if (typeof snapshotRestorer !== 'function') {
      throw new Error('[HistoryStore] snapshotRestorer 必须是函数');
    }

    this._snapshotProvider = snapshotProvider;
    this._snapshotRestorer = snapshotRestorer;
    this._eventBus = eventBus;

    this._undoStack = [];
    this._redoStack = [];
    this._maxSteps = maxSteps;
    this._enabled = true;
    this._isRestoring = false;
  }

  // ── 保存 ──

  /**
   * 保存当前快照到历史栈。
   */
  save() {
    if (!this._enabled || this._isRestoring) return;

    const snapshot = this._snapshotProvider();
    if (!snapshot) return;

    this._undoStack.push(snapshot);

    if (this._undoStack.length > this._maxSteps) {
      this._undoStack.shift();
    }

    this._redoStack = [];
    this._notify();
  }

  // ── 撤销 / 重做 ──

  /**
   * 撤销。
   * @returns {Promise<boolean>} 是否成功恢复
   */
  async undo() {
    if (!this.canUndo()) return false;

    this._isRestoring = true;

    const current = this._snapshotProvider();
    if (current) {
      this._redoStack.push(current);
    }

    const prev = this._undoStack.pop();
    let ok = false;
    try {
      await this._snapshotRestorer(prev);
      ok = true;
    } catch (err) {
      console.error('[HistoryStore] 撤销恢复失败:', err);
    }

    this._isRestoring = false;
    this._notify();
    return ok;
  }

  /**
   * 重做。
   * @returns {Promise<boolean>} 是否成功恢复
   */
  async redo() {
    if (!this.canRedo()) return false;

    this._isRestoring = true;

    const current = this._snapshotProvider();
    if (current) {
      this._undoStack.push(current);
    }

    const next = this._redoStack.pop();
    let ok = false;
    try {
      await this._snapshotRestorer(next);
      ok = true;
    } catch (err) {
      console.error('[HistoryStore] 重做恢复失败:', err);
    }

    this._isRestoring = false;
    this._notify();
    return ok;
  }

  // ── 状态查询 ──

  canUndo() { return this._undoStack.length > 0; }
  canRedo() { return this._redoStack.length > 0; }

  getState() {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this._undoStack.length,
      redoCount: this._redoStack.length,
    };
  }

  // ── 控制 ──

  setEnabled(enabled) { this._enabled = !!enabled; }
  isEnabled() { return this._enabled; }

  clear() {
    this._undoStack = [];
    this._redoStack = [];
    this._notify();
  }

  setMaxSteps(max) { this._maxSteps = Math.max(1, max); }
  getMaxSteps() { return this._maxSteps; }

  // ── 内部 ──

  _notify() {
    if (this._eventBus) {
      this._eventBus.emit('history:changed', this.getState());
    }
  }
}
