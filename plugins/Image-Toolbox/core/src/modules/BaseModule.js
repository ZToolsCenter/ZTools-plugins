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

    // 禁用框选 + 禁用所有对象的单独选中/拖拽
    canvas.selection = false;
    this._setObjectsInteractivity(false);
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
    this._setObjectsInteractivity(true);
  }

  /**
   * 批量设置画布上所有对象的交互性
   * @param {boolean} interactive - 是否可交互
   */
  _setObjectsInteractivity(interactive) {
    const objects = this.canvasManager.canvas.getObjects();
    objects.forEach(obj => {
      obj.set({ selectable: interactive, evented: interactive });
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
