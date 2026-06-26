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
      } else {
        obj.set({ selectable: true, evented: true });
      }
    });
    this._savedInteractivity.clear();
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
