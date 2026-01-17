import CanvasManager from './canvasManager.js';
import ImageProcessor from './imageProcessor.js';
import ScreenshotCapture from './screenshotCapture.js';
import UIController from './uiController.js';
import EventManager from './eventManager.js';
import SelectionView from './selectionView.js';
import NewStudentGuidance from './newStudentGuidance.js';
import { appStatus } from './appStatus.js';
import shopInstance, { isProUser } from '../components/shop.js';

/**
 * 应用主类
 * 协调各个组件工作，启动应用
 */
class LongScreenshotApp {
    constructor(components) {
        // 初始化应用状态
        this.initAppState();

        // 直接使用传入的组件
        window.newStudentGuidance = new NewStudentGuidance();
        this.canvasManager = new CanvasManager();
        this.imageProcessor = new ImageProcessor(this.canvasManager);
        this.screenshotCapture = new ScreenshotCapture(this.imageProcessor, this.canvasManager);
        this.uiController = new UIController(this.screenshotCapture, this.canvasManager);

        this.eventManager = new EventManager(this.canvasManager, this.uiController);

        // 保存AppStatus实例
        this.appStatus = appStatus;
        // 将AppStatus暴露给全局
        window.appStatus = this.appStatus;

        // 创建或获取SelectionView实例
        this.selectionView = SelectionView.getInstance();
        // 确保SelectionView能访问CanvasManager
        if (!this.selectionView.canvasManager) {
            this.selectionView.canvasManager = this.canvasManager;
        }

        // 将应用实例注册到全局，以便其他组件访问
        window.longScreenshotApp = this;

        // 提供访问应用实例的事件监听器
        document.addEventListener('getLongScreenshotApp', (event) => {
            if (event.detail && typeof event.detail.callback === 'function') {
                event.detail.callback(this);
            }
        });

        // 提供访问CanvasManager的事件监听器
        document.addEventListener('getCanvasManager', (event) => {
            if (event.detail && typeof event.detail.callback === 'function') {
                event.detail.callback(this.canvasManager);
            }
        });

        // 提供访问AppStatus实例的事件监听器
        document.addEventListener('getAppStatus', (event) => {
            if (event.detail && typeof event.detail.callback === 'function') {
                event.detail.callback(this.appStatus);
            }
        });

        // 监听应用状态变化事件
        document.addEventListener("selectionViewStatusChange", (event) => {
            if (event.detail && event.detail.status) {
                console.log("应用状态变更为:", event.detail.status);
                // 这里可以添加基于状态变化的全局处理逻辑
            }
        });
    }

    /**
     * 初始化应用状态
     */
    initAppState() {
        // 开发环境日志控制
        if (!ztools.isDev()) {
            console.log = console.info = console.error = console.warn = () => { };
        }

        // 选择区域相关
        this.selectionArea = { x: 0, y: 0, width: 0, height: 0 };
        // this.selectionArea_ = { x: 0, y: 0, width: 0, height: 0 };

        // 布局和滚动相关
        this.scaledPercent = 0.5;
        this.scaledWidth = 0;
        this.scaledHeight = 0;


        // 创建离屏Canvas用于灰度处理
        this.offscreenCanvasOfGray = new OffscreenCanvas(1, 1);

        // 操作控制标志
        this.confirmFlag = false;
        this.exitFlag = false;


        // // 用户设置
        // this.settings = settings;


        // 媒体相关
        this.mediaStream = null;
        this.images = [];
        this.draggingImage = null;
        this.offsetX = null;
        this.offsetY = null;
        this.lastGrayscaleMatrix = null;

        // 显示器设置
        this.displayBounds = ztools.getDisplayNearestPoint(ztools.getCursorScreenPoint());

        // 创建空格键状态的可观察对象
        this.spaceKeyDown = this.createObservable(false);

        // 空格键状态监听
        this.spaceKeyDown.subscribe((newValue, oldValue) => {
            const bothmoveBtn = document.getElementById('bothmoveBtn');
            const moveTips = document.getElementById('moveTips');

            if (!bothmoveBtn || !moveTips) return;

            if (newValue) {
                bothmoveBtn.classList.remove('active');
                moveTips.innerHTML = '拖动或按↑↓键可微调<strong>单张</strong>截图的拼接位置，按del、⌫可删除';
            } else {
                bothmoveBtn.classList.add('active');
                moveTips.innerText = '拖动或按↑↓键可微调拼接位置，按del、⌫可删除';
            }
        });

        // 将核心变量映射到window对象保持兼容性
        window.selectionArea = this.selectionArea;

        window.scaledPercent = this.scaledPercent;
        window.scaledWidth = this.scaledWidth;
        window.scaledHeight = this.scaledHeight;

        window.offscreenCanvasOfGray = this.offscreenCanvasOfGray;
        window.confirmFlag = this.confirmFlag;
        window.exitFlag = this.exitFlag;


        window.mediaStream = this.mediaStream;
        window.images = this.images;
        window.draggingImage = this.draggingImage;
        window.offsetX = this.offsetX;
        window.offsetY = this.offsetY;
        window.lastGrayscaleMatrix = this.lastGrayscaleMatrix;
        window.displayBounds = this.displayBounds;
        window.spaceKeyDown = this.spaceKeyDown;

        // 添加全局工具方法
        window.isProUser = this.isProUser.bind(this);
        window.updateCtrlNotice = (text) => this.updateCtrlNotice(text);
    }

    /**
     * 创建可观察对象
     */
    createObservable(value) {
        return {
            _value: value,
            _listeners: [],
            get value() {
                return this._value;
            },
            set value(newValue) {
                const oldValue = this._value;
                this._value = newValue;
                this._listeners.forEach(listener => listener(newValue, oldValue));
            },
            subscribe(listener) {
                this._listeners.push(listener);
                return () => {
                    this._listeners = this._listeners.filter(l => l !== listener);
                };
            }
        };
    }

    /**
     * 检查是否为专业用户
     */
    isProUser() {
        return isProUser();
    }

    /**
     * 更新控制提示区域文本
     */
    updateCtrlNotice(text) {
        if (this.uiController) {
            this.uiController.updateCtrlNotice(text);
        }
    }

    /**
     * 初始化应用
     */
    init() {
        // 初始化各个组件，先初始化UIController再初始化EventManager
        this.uiController.initEventListeners();
        this.eventManager.initEventListeners();

        // 确保SelectionView已经初始化
        if (this.selectionView && typeof this.selectionView.init === 'function') {
            // 避免重复初始化
            if (appStatus.status === 'idle') {
                this.selectionView.init();
            }
        }

        console.log("长截图应用已初始化");
    }
}

export default LongScreenshotApp; 