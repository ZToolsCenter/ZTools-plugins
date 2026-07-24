/**
 * EditorEngineAdapter 接口定义（JSDoc）
 *
 * 渲染引擎适配器抽象。Fabric.js 是默认实现，后续可替换为 CanvasKit / WebGL / 原生等。
 *
 * @interface EditorEngineAdapter
 */
export default class EditorEngineAdapter {
  /**
   * 初始化引擎。
   * @param {HTMLCanvasElement|object} target - canvas 元素或平台等价物
   * @param {object} [options] - 引擎配置
   * @returns {Promise<void>}
   */
  async init(target, options = {}) {}

  /** 销毁引擎，释放资源。 */
  destroy() {}

  /**
   * 加载图片。
   * @param {string|File|Blob} source
   * @returns {Promise<string>} engineId
   */
  async loadImage(source) { throw new Error('Not implemented'); }

  /**
   * 替换当前背景图片。
   * @param {string} source
   * @returns {Promise<string>} engineId
   */
  async replaceImage(source) { throw new Error('Not implemented'); }

  /**
   * 导出画布为 dataURL。
   * @param {object} [options] - { format, quality, multiplier }
   * @returns {string|null}
   */
  exportToDataURL(options = {}) { return null; }

  // ── 物件操作 ──

  /** @returns {{ engineId: string, type: string, name?: string }[]} */
  getObjects() { return []; }

  /**
   * @param {string} engineId
   * @returns {object|null}
   */
  getObject(engineId) { return null; }

  /**
   * @param {object} input - { type, options }
   * @returns {Promise<string>} engineId
   */
  async addObject(input) { throw new Error('Not implemented'); }

  /**
   * @param {string} engineId
   * @param {object} patch
   */
  updateObject(engineId, patch) {}

  /** @param {string} engineId */
  removeObject(engineId) {}

  /**
   * @param {string} engineId
   * @param {number} targetIndex
   */
  reorderObject(engineId, targetIndex) {}

  // ── 选择 ──

  /** @returns {string[]} 选中的 engineId 列表 */
  getSelection() { return []; }

  /** @param {string[]} engineIds */
  setSelection(engineIds) {}

  /**
   * @param {string} engineId
   * @param {boolean} interactive
   */
  setInteractivity(engineId, interactive) {}

  // ── 视口 ──

  /** @returns {{ zoom: number, offsetX: number, offsetY: number }} */
  getViewport() { return { zoom: 1, offsetX: 0, offsetY: 0 }; }

  /**
   * @param {{ zoom?: number, offsetX?: number, offsetY?: number }} viewport
   */
  setViewport(viewport) {}

  /**
   * 图片自适应视口。
   * @param {number} [padding=40]
   */
  fitToViewport(padding = 40) {}

  // ── 序列化 ──

  /**
   * 将当前引擎状态序列化为可存储的 JSON。
   * @returns {object}
   */
  serialize() { return {}; }

  /**
   * 从序列化数据恢复引擎状态。
   * @param {object} state
   * @returns {Promise<void>}
   */
  async restore(state) {}

  // ── 事件 ──

  /**
   * 订阅引擎事件。
   * @param {string} event
   * @param {Function} callback
   * @returns {Function} 取消订阅函数
   */
  on(event, callback) { return () => {}; }

  /** 取消订阅。 */
  off(event, callback) {}
}
