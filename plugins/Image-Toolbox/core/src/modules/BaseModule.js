/**
 * 模块基类 — 所有功能模块的抽象基类
 */
class BaseModule {
  /**
   * @param {CanvasManager} canvasManager
   * @param {HistoryManager} historyManager
   * @param {object} [defaultOptions]
   */
  constructor(canvasManager, historyManager, defaultOptions = {}) {
    this.canvasManager = canvasManager;
    this.history = historyManager;
    this.active = false;
    this.options = { ...defaultOptions };
    this._savedInteractivity = new Map();
  }

  /**
   * 激活模块（子类必须调用 super.activate()）
   *
   * 自动禁用画布上所有对象的 selectable/evented，
   * 防止 Fabric.js 默认的选中/拖拽行为干扰工具模块的鼠标事件。
   * 需要保留某些对象交互性的子类可在 super.activate() 之后按需恢复。
   *
   * @param {object} [options] - 运行时选项
   */
  activate(options = {}) {
    this.active = true;
    this.options = { ...this.options, ...options };

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    canvas.selection = false;
    this._disableObjectsInteractivity();
  }

  /**
   * 停用模块（子类必须调用 super.deactivate()）
   *
   * 恢复画布默认行为：允许框选、允许对象交互。
   */
  deactivate() {
    this.active = false;

    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    canvas.selection = true;
    canvas.defaultCursor = 'default';
    this._restoreObjectsInteractivity();
  }

  /**
   * 禁用所有对象交互性，同时保存原始状态以便恢复
   */
  _disableObjectsInteractivity() {
    const objects = this.canvasManager.canvas.getObjects();
    this._savedInteractivity.clear();
    objects.forEach(obj => {
      this._savedInteractivity.set(obj, {
        selectable: obj.selectable,
        evented: obj.evented,
      });
      obj.set({ selectable: false, evented: false });
    });
  }

  /**
   * 恢复所有对象到激活前的交互状态（保留锁定/背景图层的原始状态）
   */
  _restoreObjectsInteractivity() {
    const objects = this.canvasManager.canvas.getObjects();
    objects.forEach(obj => {
      const saved = this._savedInteractivity.get(obj);
      if (saved) {
        obj.set({ selectable: saved.selectable, evented: saved.evented });
      }
      // 不在保存映射中的对象（如工具激活期间新增的图层）保持原样，
      // 不做任何修改，避免错误地解锁被用户主动锁定的图层
    });
    this._savedInteractivity.clear();
  }

  /**
   * 启用可编辑图层的交互性，保留用户主动锁定的图层和临时辅助对象状态。
   */
  _enableEditableLayerInteractivity() {
    const canvas = this.canvasManager.canvas;
    if (!canvas) return;

    const layerManager = this.canvasManager.layerManager;
    const objects = canvas.getObjects();
    objects.forEach(obj => {
      if (obj.excludeFromLayer || obj.excludeFromHistory) return;

      const meta = layerManager?.getLayerByObject?.(obj) || null;
      const locked = meta ? meta.locked : obj._layerLocked === true;
      if (locked && !meta?.isBackground && obj !== this.canvasManager.originalImage && !obj._originalImage) return;

      obj.set({ selectable: true, evented: true });
    });
  }

  /**
   * 获取属性面板 HTML（子类可选实现）
   * @returns {string}
   */
  getPropertyPanelHTML() {
    return '';
  }

  /**
   * 属性变更回调（子类可选实现）
   * @param {string} key
   * @param {*} value
   */
  onPropertyChange(key, value) {}

  /**
   * 获取选项栏 HTML（子类可选实现）
   * @returns {string}
   */
  getOptionsBarHTML() {
    return '';
  }

  /**
   * 键盘事件（子类可选实现）
   * @param {KeyboardEvent} e
   */
  onKeyDown(e) {}

  /**
   * 鼠标事件（子类可选实现）
   * @param {Event} e
   */
  onMouseDown(e) {}
  onMouseMove(e) {}
  onMouseUp(e) {}
}

export default BaseModule;
