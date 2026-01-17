// 导入应用主类
import LongScreenshotApp from './longScreenshotApp.js';


// 创建并启动应用
document.addEventListener('DOMContentLoaded', () => {






    // 创建应用实例
    const app = new LongScreenshotApp();
    
    // 初始化应用
    app.init();
    
    // 使用app实例中的变量，窗口对象已在LongScreenshotApp构造函数中设置
    // 这里可以删除，因为已经在LongScreenshotApp的initAppState中映射到window对象
    // window.spaceKeyDown = app.spaceKeyDown;


    // 监听getCanvasManager事件，提供canvasManager实例
    document.addEventListener('getCanvasManager', (event) => {
        if (event.detail && typeof event.detail.callback === 'function') {
            event.detail.callback(app.canvasManager);
        }
    });

    // 监听来自selectionView.js的开始截图事件
    document.addEventListener('startScreenshotCapture', (event) => {
        // 触发一个事件，包含screenshotCapture实例
        const readyEvent = new CustomEvent('screenshotCaptureReady', {
            detail: { screenshotCapture: app.screenshotCapture }
        });
        document.dispatchEvent(readyEvent);
    });

    console.log("长截图应用已初始化");
});

