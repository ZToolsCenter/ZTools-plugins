/**
 * 事件总线 — 发布-订阅模式，解耦模块间通信
 * 全局单例
 */
class EventBus {
  constructor() {
    this._events = {};
    this._idCounter = 0;
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名
   * @param {Function} callback - 回调函数
   * @param {object} [context] - 回调 this 上下文
   * @returns {Function} 取消订阅函数
   */
  on(event, callback, context) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    const listener = { id: ++this._idCounter, callback, context };
    this._events[event].push(listener);
    return () => this.off(event, listener.id);
  }

  /**
   * 一次性订阅
   * @param {string} event
   * @param {Function} callback
   * @param {object} [context]
   */
  once(event, callback, context) {
    const off = this.on(event, (...args) => {
      off();
      callback.apply(context, args);
    }, context);
  }

  /**
   * 取消订阅
   * @param {string} event
   * @param {number|Function} [target] - listener id 或 callback 函数
   */
  off(event, target) {
    if (!this._events[event]) return;
    if (target === undefined) {
      delete this._events[event];
      return;
    }
    this._events[event] = this._events[event].filter(listener => {
      if (typeof target === 'number') return listener.id !== target;
      return listener.callback !== target;
    });
  }

  /**
   * 发布事件
   * @param {string} event - 事件名
   * @param {...*} args - 参数
   */
  emit(event, ...args) {
    if (!this._events[event]) return;
    const listeners = [...this._events[event]]; // 拷贝，避免遍历时修改
    for (const listener of listeners) {
      try {
        listener.callback.apply(listener.context, args);
      } catch (err) {
        console.error(`[EventBus] "${event}" 回调执行错误:`, err);
      }
    }
  }

  /**
   * 清空所有事件
   */
  clear() {
    this._events = {};
  }
}

// 全局单例（向后兼容）
const eventBus = new EventBus();

export { EventBus };
export default eventBus;
