/**
 * core/appStatus.js
 * 该文件管理应用状态，实现为单例模式
 * 用于集中管理应用的状态变化和状态相关逻辑
 */

class AppStatus {
  // 单例实例
  static instance;

  // 获取实例的静态方法
  static getInstance() {
    if (!AppStatus.instance) {
      AppStatus.instance = new AppStatus();
    }
    return AppStatus.instance;
  }

  constructor() {
    // 检查是否已经存在实例
    if (AppStatus.instance) {
      return AppStatus.instance;
    }

    this._internalStatus = "idle";
    AppStatus.instance = this;
    
    // 初始化状态监听
    this.initStatusPropertyObserver();

    // DOM引用，会在初始化时设置
    this.DOM = null;
    this.currentHandle = null;
  }
  
  // 初始化状态属性观察者
  initStatusPropertyObserver() {
    Object.defineProperty(this, "__internalStatus", {
      value: "idle",
      writable: true,
    });
  }

  // 设置DOM引用
  setDOMElements(domElements, currentHandle = null) {
    this.DOM = domElements;
    this.currentHandle = currentHandle;
  }

  // 恢复到暂停状态
  restoreAfterShop() {
    this.status = "pause";
  }

  // 状态的getter和setter
  set status(status) {
    // 状态有变化时
    if (status === this._internalStatus) {
      return;
    }

    // 存储旧状态用于比较
    const oldStatus = this._internalStatus;
    this._internalStatus = status;

    console.log("状态", status);

    // 如果状态确实发生变化，触发自定义事件
    if (oldStatus !== status) {
      document.dispatchEvent(
        new CustomEvent("selectionViewStatusChange", {
          detail: { status: status },
        })
      );
    }

    // 根据状态更新UI和行为
    this.updateStatusBehavior(status);
  }

  get status() {
    return this._internalStatus;
  }

  // 根据状态更新UI和行为
  updateStatusBehavior(status) {
    // 确保DOM引用已设置
    if (!this.DOM) {
      console.warn("无法更新UI，DOM引用未设置");
      return;
    }

    switch (status) {
      case "idle":
        this.DOM.startButton.style.display = "none";
        this.DOM.selection.style.display = "none";
        break;
      case "selecting":
        this.DOM.startButton.style.display = "none";
        this.DOM.selection.style.display = "block";
        break;
      case "moving":
        this.DOM.startButton.style.display = "none";
        break;
      case "resizing":
        this.DOM.startButton.style.display = "none";
        break;
      case "selected":
        this.DOM.startButton.style.display = "flex";
        this.currentHandle = null;
        break;
      case "recording":
        this.DOM.selection.style.cursor = "none";
        this.DOM.startButton.style.display = "none";
        // this.DOM.selection.style.backgroundColor = "";
        this.DOM.selection.style.outlineColor = "";
        if (typeof window.updateCtrlNotice === 'function') {
          window.updateCtrlNotice("请向下滚动页面");
        }
        break;
      case "pause":
        // focus组件
        this.DOM.selection.style.cursor = `url('../assets/pause.svg') , auto`;
        this.DOM.startButton.style.display = "none";
        this.DOM.selection.style.outlineColor = "#ff3355";
        if (typeof window.updateCtrlNotice === 'function') {
          window.updateCtrlNotice("⏸暂停中，鼠标离开区域后继续");
        }
        break;
      case "autoScroll":
        this.DOM.selection.style.cursor = "none";
        this.DOM.startButton.style.display = "none";
        this.DOM.selection.style.outlineColor = "#ff3355";
        if (typeof window.updateCtrlNotice === 'function') {
          window.updateCtrlNotice("自动滚动中，请不要移动鼠标，否则会停止自动滚动");
        }
        break;
      case "shop":
        // 商店状态，保持当前UI但阻止截图等操作
        if (typeof window.updateCtrlNotice === 'function') {
          window.updateCtrlNotice("请先完成购买");
        }
        break;
    }
  }
}

// 创建并导出单例实例
export const appStatus = AppStatus.getInstance();

// 添加默认导出
export default AppStatus;
