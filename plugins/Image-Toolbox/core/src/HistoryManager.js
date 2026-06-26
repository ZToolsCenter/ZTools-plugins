import eventBus from './EventBus.js';

/**
 * 历史记录管理器 — 实现撤销/重做
 * 使用 Fabric.js toJSON/loadFromJSON 序列化快照
 */
class HistoryManager {
  constructor(canvasManager, maxSteps = 30) {
    this._cm = canvasManager;
    this.undoStack = [];
    this.redoStack = [];
    this.maxSteps = maxSteps;
    this._enabled = true;
    this._isRestoring = false; // 防止恢复时触发保存
  }

  /**
   * 保存当前画布状态
   */
  saveState() {
    if (!this._enabled || this._isRestoring) return;
    if (!this._cm.canvas) return;

    const json = this._cm.toJSON();
    if (!json) return;

    this.undoStack.push(json);

    // 限制栈大小
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }

    // 新操作清空重做栈
    this.redoStack = [];

    this._notify();
  }

  /**
   * 撤销
   */
  async undo() {
    if (!this.canUndo()) return;
    if (this._isRestoring) return; // 防止恢复期间重复触发

    this._isRestoring = true;

    // 保存当前状态到重做栈
    const currentJson = this._cm.toJSON();
    if (currentJson) {
      this.redoStack.push(currentJson);
    }

    // 恢复上一个状态
    const prevJson = this.undoStack.pop();
    try {
      await this._restoreState(prevJson);
    } catch (err) {
      console.error('[HistoryManager] undo 失败:', err);
    } finally {
      this._isRestoring = false;
      this._notify();
    }
  }

  /**
   * 重做
   */
  async redo() {
    if (!this.canRedo()) return;
    if (this._isRestoring) return; // 防止恢复期间重复触发

    this._isRestoring = true;

    // 保存当前状态到撤销栈
    const currentJson = this._cm.toJSON();
    if (currentJson) {
      this.undoStack.push(currentJson);
    }

    // 恢复下一个状态
    const nextJson = this.redoStack.pop();
    try {
      await this._restoreState(nextJson);
    } catch (err) {
      console.error('[HistoryManager] redo 失败:', err);
    } finally {
      this._isRestoring = false;
      this._notify();
    }
  }

  /**
   * 是否可撤销
   * @returns {boolean}
   */
  canUndo() {
    return this.undoStack.length > 0;
  }

  /**
   * 是否可重做
   * @returns {boolean}
   */
  canRedo() {
    return this.redoStack.length > 0;
  }

  /**
   * 清空历史
   */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this._notify();
  }

  /**
   * 启用/禁用历史记录
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this._enabled = enabled;
  }

  // ── 内部方法 ──

  async _restoreState(json) {
    return this._cm.fromJSON(json);
  }

  _notify() {
    eventBus.emit('history:changed', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoCount: this.undoStack.length,
    });
  }
}

export default HistoryManager;
