/**
 * core/selectionView.js
 * 该文件实现了屏幕截图选择区域的交互逻辑，包括:
 * - 创建和调整选择框
 * - 移动选择框
 * - 调整选择框大小
 * - 处理鼠标事件
 * - 启动截图功能
 */

import CanvasManager from './canvasManager.js';
import { appStatus } from './appStatus.js';

class SelectionView {
  // 添加静态实例变量
  static instance;

  // 获取实例的静态方法
  static getInstance() {
    if (!SelectionView.instance) {
      SelectionView.instance = new SelectionView();
    }
    return SelectionView.instance;
  }

  constructor() {
    // 检查是否已经存在实例
    if (SelectionView.instance) {
      return SelectionView.instance;
    }

    this.minWH = 200;

    this._rect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };

    this.absoluteRect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    this.mousedownPoint = {
      x: 0,
      y: 0,
      offsetX: 0,
      offsetY: 0,
    };


    this.DOM = {
      // DOM元素 - 截图选择区域
      selection: document.getElementById("selection"),
      // DOM元素 - 开始按钮
      startButton: document.getElementById("startButton"),
      // DOM元素 - 按钮容器
      btnBox: document.getElementById("btnBox"),
      // DOM元素 - 原始覆盖层
      originOverlay: document.getElementById("originOverlay"),
      // DOM元素 - 尺寸提示区域
      sizeNotice: document.getElementById("sizeNotice"),


      // DOM元素 - 画布容器
      canvasBox: document.getElementById("canvasBox"),

    };

    this.absoluteBtnBoxRect = {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    this.currentHandle = null;
    SelectionView.instance = this;

    // 我们将尝试从LongScreenshotApp获取CanvasManager实例
    this.canvasManager = null;
    this.app = null;

    this.autoScrollStartMousePoint = null;

    // 初始化事件监听
    this.initEventListeners();

    // 如果DOM元素已准备好，立即初始化
    if (this.DOM.selection && this.DOM.startButton) {
      this.init();
    } else {
      // 否则等待DOM加载完成
      document.addEventListener('DOMContentLoaded', () => {
        this.init();
      });
    }

    // 将DOM元素设置到AppStatus
    appStatus.setDOMElements(this.DOM, this.currentHandle);
  }

  // 初始化自定义事件监听
  initEventListeners() {
    // 监听状态变化请求
    document.addEventListener("checkMouseInSelection", () => {
      this.checkMouseInSelection();
    });

    // 监听获取选择区域信息请求
    document.addEventListener("getSelectionAreaInfo", (event) => {
      if (event.detail && typeof event.detail.callback === "function") {
        event.detail.callback(this.rect);
      }
    });

    // 监听应用实例可用
    document.addEventListener('getLongScreenshotApp', (event) => {
      if (event.detail && typeof event.detail.callback === 'function') {
        this.app = event.detail.callback();
        if (this.app && this.app.canvasManager) {
          this.canvasManager = this.app.canvasManager;
        }
      }
    });
  }

  // 获取CanvasManager实例
  getCanvasManager() {
    // 首先检查是否已经有CanvasManager实例
    if (this.canvasManager) {
      return this.canvasManager;
    }

    // 尝试从LongScreenshotApp获取
    if (window.longScreenshotApp && window.longScreenshotApp.canvasManager) {
      this.canvasManager = window.longScreenshotApp.canvasManager;
      return this.canvasManager;
    }

    // 作为备选方案，尝试通过事件获取
    document.dispatchEvent(new CustomEvent('getCanvasManager', {
      detail: {
        callback: (instance) => {
          this.canvasManager = instance;
        }
      }
    }));

    // 如果上面的方法都失败，创建新实例
    if (!this.canvasManager) {
      this.canvasManager = new CanvasManager();
    }

    return this.canvasManager;
  }

  set rect(rect) {
    this._rect = rect;
    this.DOM.selection.style.width = `${this.rect.width}px`;
    this.DOM.selection.style.height = `${this.rect.height}px`;
    this.DOM.selection.style.left = `${this.rect.x}px`;
    this.DOM.selection.style.top = `${this.rect.y}px`;
    this.DOM.sizeNotice.innerText = `${this.rect.width * window.displayBounds.scaleFactor.toFixed(0)} × ${this.rect.height * window.displayBounds.scaleFactor.toFixed(0)}`;
  }

  get rect() {
    return this._rect;
  }

  init() {
    appStatus.status = "idle";

    // 设置mousedown事件
    document.body.onmousedown = (e) => {
      this.mousedownHandler(e);
    };

    // 设置mousemove事件
    document.body.onmousemove = (e) => {
      this.mousemoveHandler(e);
    };

    // 设置mouseup事件
    document.body.onmouseup = (e) => {
      this.mouseupHandler(e);
    };

    this.DOM.startButton.onclick = (e) => {
      this.onStartButtonClick(e);
    };
  }

  onStartButtonClick(e) {
    appStatus.status = "pause";

    // 隐藏选择框控制点
    document.querySelectorAll(".pseudo").forEach((handle) => (handle.style.display = "none"));
    document.querySelectorAll(".handle").forEach((handle) => (handle.style.display = "none"));

    this.initBtnBox();
    this.getCanvasManager().showCanvasBoxPosition(this.rect);

    // 移除mousedown事件
    document.body.onmousedown = null;
    document.body.onmouseup = null;
    console.log("移除全局mousedown事件");

    e.stopPropagation();

    // 获取selection 在系统中的绝对位置
    this.absoluteRect = this.DOM.selection.getBoundingClientRect();
    this.absoluteRect.x = this.absoluteRect.x + window.absolutePosition[0];
    this.absoluteRect.y = this.absoluteRect.y + window.absolutePosition[1];

    window.absoluteRect = this.absoluteRect;

    // 创建截图模块实例并调用方法
    // 这里我们直接监听一个自定义事件，由main.js在创建完截图实例后触发
    document.addEventListener(
      "screenshotCaptureReady",
      (event) => {
        const screenshotCapture = event.detail.screenshotCapture;
        screenshotCapture.startCapture().then(() => {
          // screenshotCapture.captureScreenshot();
          console.log("截图模块准备就绪");
        });
      },
      { once: true }
    );

    // 触发开始截图事件，通知main.js
    const startEvent = new CustomEvent("startScreenshotCapture", { detail: { selectionArea: this.rect } });
    document.dispatchEvent(startEvent);
  }

  initBtnBox() {
    const wa = window.displayBounds.workArea; // 获取当前屏幕的工作区
    const sel = this.rect; // 获取选择区域
    const SPACE = 90; // 按钮框所需的最小空间阈值

    // 计算选区相对于工作区的可用空间
    const spaceBelow = (wa.y + wa.height) - (sel.y + sel.height);
    const spaceAbove = sel.y - wa.y;
    const spaceLeft = sel.x - wa.x;
    const spaceRight = (wa.x + wa.width) - (sel.x + sel.width);

    // console.log("Available space - Below:", spaceBelow, "Above:", spaceAbove, "Left:", spaceLeft, "Right:", spaceRight);

    if (spaceBelow >= SPACE) {
      // 左下角，横排
      this.DOM.btnBox.style.left = `${sel.x - 2}px`;
      this.DOM.btnBox.style.top = `${sel.y + sel.height + 12}px`;
      this.DOM.btnBox.classList = "BtnBox";
    } else if (spaceAbove >= SPACE) {
      // 左上角，横排
      this.DOM.btnBox.style.left = `${sel.x - 2}px`;
      this.DOM.btnBox.style.top = `${sel.y - 52}px`; // 假设按钮框及边距总高度为52px
      this.DOM.btnBox.classList = "BtnBox above";
    } else if (spaceLeft >= SPACE) {
      // 左上角，竖排 (按钮在选区左边)
      this.DOM.btnBox.style.left = `${sel.x - 52}px`; // 假设按钮框及边距总宽度为52px
      this.DOM.btnBox.style.top = `${sel.y - 2}px`;
      this.DOM.btnBox.classList = "BtnBox vertical behind";
    } else {
      // 右上角，竖排 (按钮在选区右边，作为默认或最后选择)
      // 即使 spaceRight < SPACE，也放在右边，保持原有逻辑的默认行为
      this.DOM.btnBox.style.left = `${sel.x + sel.width + 12}px`;
      this.DOM.btnBox.style.top = `${sel.y - 2}px`;
      this.DOM.btnBox.classList = "BtnBox vertical above";
    }

    this.DOM.btnBox.style.display = "flex";
  }

  mousedownHandler(e) {
    if (e.target === this.DOM.startButton) {
      appStatus.status = "selected";
      return;
    }

    // 判断操作类型：调整大小、移动或创建新选区
    if (e.target.classList.contains("handle")) {
      // 点击调整大小的手柄
      appStatus.status = "resizing";
      this.currentHandle = e.target;
      // 更新AppStatus中的currentHandle
      appStatus.setDOMElements(this.DOM, this.currentHandle);
    } else if (e.clientX >= this.rect.x && e.clientX <= this.rect.x + this.rect.width && e.clientY >= this.rect.y && e.clientY <= this.rect.y + this.rect.height) {
      // 点击在选区内，准备移动选区
      appStatus.status = "moving";
      this.mousedownPoint.offsetX = e.clientX - this.rect.x;
      this.mousedownPoint.offsetY = e.clientY - this.rect.y;
    } else {
      // 点击在选区外，创建新选区
      appStatus.status = "selecting";
      this.mousedownPoint.x = e.clientX;
      this.mousedownPoint.y = e.clientY;

      this.rect = {
        x: e.clientX,
        y: e.clientY,
        width: this.minWH,
        height: this.minWH,
      };
      this.DOM.originOverlay.style.display = "none";
    }
  }

  mousemoveHandler(e) {
    switch (appStatus.status) {
      case "selecting":
        // 正在绘制新选区，设置 rect
        let width = Math.abs(e.clientX - this.mousedownPoint.x);
        let height = Math.abs(e.clientY - this.mousedownPoint.y);

        // 确保宽度和高度最小为this.minWH像素
        width = Math.max(width, this.minWH);
        height = Math.max(height, this.minWH);

        // 根据拖拽方向调整x和y坐标
        let x, y;
        if (e.clientX < this.mousedownPoint.x) {
          x = this.mousedownPoint.x - width;
        } else {
          x = this.mousedownPoint.x;
        }

        if (e.clientY < this.mousedownPoint.y) {
          y = this.mousedownPoint.y - height;
        } else {
          y = this.mousedownPoint.y;
        }

        this.rect = {
          x: x,
          y: y,
          width: width,
          height: height,
        };
        break;
      case "moving":
        this.rect = {
          x: e.clientX - this.mousedownPoint.offsetX,
          y: e.clientY - this.mousedownPoint.offsetY,
          width: this.rect.width,
          height: this.rect.height,
        };
        break;
      case "resizing":
        // 左上
        if (this.currentHandle.classList.contains("nw")) {
          this.rect = {
            x: Math.min(e.clientX, this.rect.x + this.rect.width - this.minWH),
            y: Math.min(e.clientY, this.rect.y + this.rect.height - this.minWH),
            width: Math.max(this.rect.width + this.rect.x - e.clientX, this.minWH),
            height: Math.max(this.rect.height + this.rect.y - e.clientY, this.minWH),
          };
        }
        // 右上
        else if (this.currentHandle.classList.contains("ne")) {
          this.rect = {
            x: this.rect.x,
            y: Math.min(e.clientY, this.rect.y + this.rect.height - this.minWH),
            width: Math.max(e.clientX - this.rect.x, this.minWH),
            height: Math.max(this.rect.height + this.rect.y - e.clientY, this.minWH),
          };
        }
        // 左下
        else if (this.currentHandle.classList.contains("sw")) {
          this.rect = {
            x: Math.min(e.clientX, this.rect.x + this.rect.width - this.minWH),
            y: this.rect.y,
            width: Math.max(this.rect.width + this.rect.x - e.clientX, this.minWH),
            height: Math.max(e.clientY - this.rect.y, this.minWH),
          };
        }
        // 右下
        else if (this.currentHandle.classList.contains("se")) {
          this.rect = {
            x: this.rect.x,
            y: this.rect.y,
            width: Math.max(e.clientX - this.rect.x, this.minWH),
            height: Math.max(e.clientY - this.rect.y, this.minWH),
          };
        }
        // 上边
        else if (this.currentHandle.classList.contains("n")) {
          this.rect = {
            x: this.rect.x,
            y: Math.min(e.clientY, this.rect.y + this.rect.height - this.minWH),
            width: this.rect.width,
            height: Math.max(this.rect.height + this.rect.y - e.clientY, this.minWH),
          };
        }
        // 右边
        else if (this.currentHandle.classList.contains("e")) {
          this.rect = {
            x: this.rect.x,
            y: this.rect.y,
            width: Math.max(e.clientX - this.rect.x, this.minWH),
            height: this.rect.height,
          };
        }
        // 下边
        else if (this.currentHandle.classList.contains("s")) {
          this.rect = {
            x: this.rect.x,
            y: this.rect.y,
            width: this.rect.width,
            height: Math.max(e.clientY - this.rect.y, this.minWH),
          };
        }
        // 左边
        else if (this.currentHandle.classList.contains("w")) {
          this.rect = {
            x: Math.min(e.clientX, this.rect.x + this.rect.width - this.minWH),
            y: this.rect.y,
            width: Math.max(this.rect.width + this.rect.x - e.clientX, this.minWH),
            height: this.rect.height,
          };
        }

        break;
    }
  }

  mouseupHandler(e) {
    switch (appStatus.status) {
      case "selecting":
      case "moving":
      case "resizing":
        appStatus.status = "selected";
        break;
    }
  }


  checkMouseInSelection() {
    switch (appStatus.status) {
      case "recording":
        if (this.isPointInSelection()) {
          // 现在在选区内
          appStatus.status = "pause";
          window.ipcRenderer.sendTo(window.parentSenderId, "pong", { type: "mouseEnter" });
          // 更新canvasBox位置

        }
        break;
      case "pause":
        // 之前在选区内，触发leave事件
        if (!this.isPointInSelection()) {
          // 添加10ms延迟
          if (!this._leaveTimer) {
            this._leaveTimer = setTimeout(() => {
              // 10ms后再次检查鼠标位置，确保不是快速移动后又返回
              if (!this.isPointInSelection() && window.newStudentGuidance.status === 'close') {
                appStatus.status = "recording";
                window.ipcRenderer.sendTo(window.parentSenderId, "pong", { type: "mouseLeave" });
                // 隐藏canvasBox
              }
              this._leaveTimer = null;
            }, 10);
          }
        } else if (this._leaveTimer) {
          // 如果鼠标在10ms内又移回选区，清除定时器
          clearTimeout(this._leaveTimer);
          this._leaveTimer = null;
        }
        break;
      case "autoScroll":


        if (this.autoScrollStartMousePoint === null) {
          this.autoScrollStartMousePoint = ztools.getCursorScreenPoint();
        } else {
          const currentMousePoint = ztools.getCursorScreenPoint();
          if (Math.abs(currentMousePoint.x - this.autoScrollStartMousePoint.x) > 40 && (currentMousePoint.y - this.autoScrollStartMousePoint.y > 10 || currentMousePoint.y - this.autoScrollStartMousePoint.y < -30)) {
            document.dispatchEvent(new CustomEvent("exitAutoScroll"));
            appStatus.status = "recording";
          }
        }
        break;
    }
  }

  isPointInSelection() {
    const point = ztools.getCursorScreenPoint();
    // 是否在selection中
    const isInSelection =
      point.x >= this.absoluteRect.x && point.x <= this.absoluteRect.x + this.absoluteRect.width && point.y >= this.absoluteRect.y && point.y <= this.absoluteRect.y + this.absoluteRect.height;

    if (this.absoluteBtnBoxRect.width <= 35) {
      const btnBoxRect = this.DOM.btnBox.getBoundingClientRect();
      this.absoluteBtnBoxRect = {
        x: btnBoxRect.x + window.absolutePosition[0],
        y: btnBoxRect.y + window.absolutePosition[1],
        width: btnBoxRect.width,
        height: btnBoxRect.height,
      };
    }
    // 是否在btnBox中
    const isInBtnBox =
      point.x >= this.absoluteBtnBoxRect.x &&
      point.x <= this.absoluteBtnBoxRect.x + this.absoluteBtnBoxRect.width &&
      point.y >= this.absoluteBtnBoxRect.y &&
      point.y <= this.absoluteBtnBoxRect.y + this.absoluteBtnBoxRect.height;
    // 是否在canvasBox中
    const canvasBoxRect = this.DOM.canvasBox.getBoundingClientRect();
    const absoluteCanvasBoxRect = {
      x: canvasBoxRect.x + window.absolutePosition[0],
      y: canvasBoxRect.y + window.absolutePosition[1],
      width: canvasBoxRect.width,
      height: canvasBoxRect.height,
    };
    const isInCanvasBox =
      point.x >= absoluteCanvasBoxRect.x &&
      point.x <= absoluteCanvasBoxRect.x + absoluteCanvasBoxRect.width &&
      point.y >= absoluteCanvasBoxRect.y &&
      point.y <= absoluteCanvasBoxRect.y + absoluteCanvasBoxRect.height;


    // 是否在btnExSetting中
    const btnExSetting = document.getElementById("cutBtnSetting");
    let isInBtnExSetting = false;
    if (btnExSetting) {
      const btnExSettingRect = btnExSetting.getBoundingClientRect();
      const absoluteBtnExSettingRect = {
        x: btnExSettingRect.x + window.absolutePosition[0],
        y: btnExSettingRect.y + window.absolutePosition[1],
        width: btnExSettingRect.width,
        height: btnExSettingRect.height,
      };
      isInBtnExSetting =
        point.x >= absoluteBtnExSettingRect.x &&
        point.x <= absoluteBtnExSettingRect.x + absoluteBtnExSettingRect.width &&
        point.y >= absoluteBtnExSettingRect.y &&
        point.y <= absoluteBtnExSettingRect.y + absoluteBtnExSettingRect.height;
    }


    return isInSelection || isInBtnBox || isInCanvasBox || isInBtnExSetting;
  }
}

// 创建并导出单例实例
export const selectionView = SelectionView.getInstance();

// 添加默认导出
export default SelectionView;
