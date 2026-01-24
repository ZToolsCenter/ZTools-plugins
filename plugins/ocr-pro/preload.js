// uTools插件预加载脚本

window.utools = {
    ...window.ztools,
    getUser: () => {
        return {
            "avatar": "https://res.u-tools.cn/assets/avatars/avatar.png",
            "ban": 0,
            "cellphone": "188****8888",
            "country_code": "86",
            "create_at": 1666057157,
            "db_address": null,
            "db_address2": "https://db2.u-tools.cn",
            "db_sync": 0,
            "email": null,
            "expired_at": 86399,
            "id": 1000000,
            "is_activated": null,
            "is_email_confirmed": null,
            "is_member": false,
            "nickname": "ZTools",
            "pay_count": 0,
            "purchased": [],
            "purchased_apps": [],
            "seat": 0,
            "student": 0,
            "student_identity_expired_at": null,
            "subscribed_at": 0,
            "teams": [],
            "trial": 7,
            "tryout": [],
            "type": 1,
            "uid": window.ztools.getNativeId(),
            "unionid": "oe0cN06d-1hZ2HR678uRkKBUPJoE",
            "user_id": null,
            "username": " ",
            "userDays": 1194,
            "accessToken": "tm4hdy4vekct6re9t7oungqvv5siogvbmlctqpop"
        }
    }
}

// 设置请求头
ztools.http.setHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) uTools/7.2.1 Chrome/108.0.5359.215 Electron/22.3.27 Safari/537.36'
})

// 引入 Electron clipboard API
const { clipboard, nativeImage } = require("electron");

// 保存当前功能代码和payload
let currentFeatureCode = null;
let currentPayload = null;

// 监听uTools进入事件
if (typeof utools !== 'undefined') {
    try {
        // 通用事件处理函数
        const handlePluginEvent = ({ code, type, payload, from, option }) => {
            currentFeatureCode = code;
            currentPayload = payload;
            window.currentFeatureCode = code;
            window.currentPayload = payload;

            // 触发自定义事件通知主程序
            window.dispatchEvent(new CustomEvent('utools-plugin-enter', {
                detail: { code, type, payload, from, option }
            }));
        };

        // 设置插件进入监听
        utools.onPluginEnter(handlePluginEvent);

        // 监听主窗口推送事件（用于处理图片匹配）
        utools.onMainPush((eventData) => {
            handlePluginEvent(eventData);
            return true; // 返回true表示进入插件应用
        });

        // 监听插件退出
        utools.onPluginOut(() => {
            // 根据配置决定是否清空相应页面内容
            if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                const currentView = window.ocrPlugin.uiManager.currentView;
                const config = window.ocrPlugin.configManager?.getConfig();

                if (currentView === 'translate' && config?.ui?.autoCleanTranslate) {
                    window.ocrPlugin.uiManager.clearTranslateContentSilently();
                } else if (currentView === 'main' && config?.ui?.autoCleanOCR) {
                    window.ocrPlugin.uiManager.clearOCRContentSilently();
                } else if (currentView === 'image-translate' && config?.ui?.autoCleanImageTranslate) {
                    window.ocrPlugin.uiManager.clearImageTranslateContentSilently();
                }
            }

            // 清理识别结果缓存
            if (window.ocrPlugin && typeof window.ocrPlugin.clearRecognitionCache === 'function') {
                window.ocrPlugin.clearRecognitionCache();
            }

            [currentFeatureCode, currentPayload, window.currentFeatureCode, window.currentPayload] = [null, null, null, null];
        });
    } catch (error) {
        console.error('设置uTools事件监听失败:', error);
    }
} else {
    console.warn('uTools API 不可用，可能在开发环境中运行');
}

// ============ 原生 OCR 模块管理器 ============
// 使用 @napi-rs/system-ocr 原生模块进行 OCR 识别
const { nativeOcrManager } = require('./src/native-ocr-manager.js');

// 暴露原生模块管理器 API 给渲染进程
window.nativeOcrManager = {
    // 获取模块信息
    getModuleInfo: () => nativeOcrManager.getModuleInfo(),

    // 获取安装状态
    getInstallStatus: () => nativeOcrManager.getInstallStatus(),

    // 检查是否已安装
    isInstalled: () => nativeOcrManager.isInstalled(),

    // 安装模块
    install: (onProgress) => nativeOcrManager.install(onProgress),

    // 卸载模块
    uninstall: () => nativeOcrManager.uninstall(),

    // 获取安装目录
    getInstallDir: () => nativeOcrManager.getInstallDir()
};

// 暴露API给渲染进程
window.ocrAPI = {
    // 屏幕截图
    screenCapture: (callback) => {
        if (typeof utools !== 'undefined' && utools.screenCapture) {
            let screenshotCompleted = false;
            let focusListener = null;

            // 完成截图的通用函数
            const completeScreenshot = (image, reason) => {
                if (screenshotCompleted) return;

                screenshotCompleted = true;

                // 清理监听器
                if (focusListener) {
                    window.removeEventListener('focus', focusListener);
                    focusListener = null;
                }

                if (callback) {
                    callback(image);
                }
            };

            // 监听窗口焦点变化来检测用户取消截图
            focusListener = () => {
                // 延迟一点检查，确保不是正常的焦点切换
                setTimeout(() => {
                    if (!screenshotCompleted) {
                        completeScreenshot(null, '用户取消');
                    }
                }, 100);
            };

            window.addEventListener('focus', focusListener);

            try {
                utools.screenCapture((image) => {
                    if (image) {
                        completeScreenshot(image, 'uTools回调');
                    } else {
                        completeScreenshot(null, 'uTools回调');
                    }
                });
            } catch (error) {
                console.error('截图API调用失败:', error);
                completeScreenshot(null, 'API调用失败');
            }
        } else {
            console.error('🔴 screenCapture API 不可用');
            if (callback) callback(null);
        }
    },

    // 安全调用utools API的通用方法
    safeCall: (apiName, ...args) => {
        if (typeof utools !== 'undefined' && utools[apiName]) {
            try {
                return utools[apiName](...args);
            } catch (error) {
                console.error(`调用${apiName} API失败:`, error);
                return null;
            }
        } else {
            // 在开发环境中，这是正常情况，不需要显示错误
            if (apiName === 'db.get' || apiName === 'db.put' || apiName === 'db.remove') {
                // 在开发环境中完全静默，不显示任何日志
                return null;
            } else {
                console.error(`${apiName} API 不可用`);
            }
            return null;
        }
    },

    // 数据库操作
    db: {
        get: (id) => window.ocrAPI.safeCall('db.get', id) || utools?.db?.get(id),
        put: (doc) => window.ocrAPI.safeCall('db.put', doc) || utools?.db?.put(doc),
        remove: (id) => window.ocrAPI.safeCall('db.remove', id) || utools?.db?.remove(id)
    },

    // 复制到剪贴板
    copyText: (text) => window.ocrAPI.safeCall('copyText', text),

    // 读取剪切板图片
    readClipboardImage: () => {
        try {
            const image = clipboard.readImage();
            if (image && !image.isEmpty()) {
                // 将图片转换为 base64 格式
                const buffer = image.toPNG();
                const base64 = buffer.toString('base64');
                return `data:image/png;base64,${base64}`;
            }
            return null;
        } catch (error) {
            console.error('读取剪切板图片失败:', error);
            return null;
        }
    },

    // 读取剪切板文本
    readClipboardText: () => {
        try {
            const text = clipboard.readText();
            if (text && text.trim()) {
                return text.trim();
            }
            return null;
        } catch (error) {
            console.error('读取剪切板文本失败:', error);
            return null;
        }
    },

    // 隐藏窗口
    hideMainWindow: () => window.ocrAPI.safeCall('hideMainWindow'),

    // 显示窗口
    showMainWindow: () => window.ocrAPI.safeCall('showMainWindow'),

    // 获取当前功能代码
    getCurrentFeature: () => {
        // 优先从保存的功能代码获取
        if (currentFeatureCode) {
            return currentFeatureCode;
        }

        if (window.currentFeatureCode) {
            return window.currentFeatureCode;
        }

        // 尝试从uTools API获取
        try {
            // 检查是否有payload，根据payload类型推断功能
            let payload = currentPayload || window.currentPayload;

            // 只有在uTools API可用且getPayload方法存在时才调用
            if (!payload && typeof utools !== 'undefined' && typeof utools.getPayload === 'function') {
                payload = utools.getPayload();
            }

            if (payload) {
                if (payload.type === 'img') {
                    currentFeatureCode = 'ocr-clipboard';
                    return 'ocr-clipboard';
                } else if (payload.type === 'files') {
                    currentFeatureCode = 'ocr-files';
                    return 'ocr-files';
                } else if (payload.text) {
                    // 文本匹配指令
                    currentFeatureCode = 'text-translate';
                    return 'text-translate';
                }
            }
        } catch (error) {
            console.error('获取payload失败:', error);
        }

        // 默认返回null，让主程序处理
        return null;
    },

    // 获取payload数据
    getPayload: () => {
        try {
            let payload = currentPayload || window.currentPayload;

            // 只有在uTools API可用且getPayload方法存在时才调用
            if (!payload && typeof utools !== 'undefined' && typeof utools.getPayload === 'function') {
                payload = utools.getPayload();
            }


            return payload || null;
        } catch (error) {
            console.error('获取payload失败:', error);
            return null;
        }
    },

    // 读取文件（如果uTools支持）
    readFile: (filePath) => {
        try {
            if (typeof utools !== 'undefined' && typeof utools.readFile === 'function') {
                return utools.readFile(filePath);
            } else {
                return null;
            }
        } catch (error) {
            console.error('读取文件失败:', error);
            return null;
        }
    },

    // 检查文件是否存在（如果uTools支持）
    fileExists: (filePath) => {
        try {
            if (typeof utools !== 'undefined' && typeof utools.fileExists === 'function') {
                return utools.fileExists(filePath);
            } else if (typeof utools !== 'undefined' && typeof utools.readFile === 'function') {
                // 尝试读取文件来检查是否存在
                try {
                    const result = utools.readFile(filePath);
                    return result !== null && result !== undefined;
                } catch (e) {
                    return false;
                }
            } else {
                return false;
            }
        } catch (error) {
            console.error('检查文件存在性失败:', error);
            return false;
        }
    },

    // 显示文件选择对话框
    showFileDialog: (callback) => {
        try {
            if (typeof utools !== 'undefined' && typeof utools.showOpenDialog === 'function') {
                const result = utools.showOpenDialog({
                    title: '选择图片文件',
                    filters: [
                        { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'svg'] }
                    ],
                    properties: ['openFile']
                });
                if (callback) callback(result);
                return result;
            } else {
                if (callback) callback(null);
                return null;
            }
        } catch (error) {
            console.error('显示文件选择对话框失败:', error);
            if (callback) callback(null);
            return null;
        }
    },

    // 获取鼠标位置
    getCursorPosition: () => {
        try {
            if (typeof utools !== 'undefined' && utools.getCursorScreenPoint) {
                return utools.getCursorScreenPoint();
            }
        } catch (error) {
            console.error('[状态指示器] 获取鼠标位置失败:', error);
        }
        // 默认位置
        return { x: 100, y: 100 };
    },

    // 显示系统通知
    showNotification: (message, type = 'info') => {
        try {
            if (typeof utools !== 'undefined' && typeof utools.showNotification === 'function') {
                // 使用uTools的通知API
                utools.showNotification(message);
            } else {
                // 备用方案：使用浏览器通知API
                if ('Notification' in window) {
                    if (Notification.permission === 'granted') {
                        new Notification('OCR Pro', {
                            body: message,
                            icon: 'assets/logo.png'
                        });
                    } else if (Notification.permission !== 'denied') {
                        Notification.requestPermission().then(permission => {
                            if (permission === 'granted') {
                                new Notification('OCR Pro', {
                                    body: message,
                                    icon: 'assets/logo.png'
                                });
                            }
                        });
                    }
                } else {
                    // 最后的备用方案：控制台输出
                    console.log(`[OCR Pro] ${type.toUpperCase()}: ${message}`);
                }
            }
        } catch (error) {
            console.error('显示通知失败:', error);
            // 最后的备用方案：控制台输出
            console.log(`[OCR Pro] ${type.toUpperCase()}: ${message}`);
        }
    },

    // 本地主机OCR - 使用 @napi-rs/system-ocr 原生模块
    nativeOCR: async (imageBase64, language = 'zh-Hans') => {
        try {
            // 检查模块是否已安装
            if (!nativeOcrManager.isInstalled()) {
                return {
                    success: false,
                    error: '系统 OCR 模块未安装，请在设置页面安装后使用',
                    needInstall: true
                };
            }

            // 检测平台
            const platform = process.platform;
            if (platform !== 'win32' && platform !== 'darwin') {
                return {
                    success: false,
                    error: `当前系统 (${platform}) 暂不支持本地 OCR，请使用其他服务商`
                };
            }

            // 移除 base64 前缀并转换为 Buffer
            const base64Data = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // 准备语言参数 (Windows 需要，macOS 自动检测)
            const langs = platform === 'win32' ? [language, 'en'] : undefined;

            // 调用原生 OCR
            const result = await nativeOcrManager.recognize(imageBuffer, langs);

            return {
                success: true,
                text: result.text,
                confidence: null,
                details: result.lines || []
            };
        } catch (error) {
            return {
                success: false,
                error: `本地 OCR 识别失败: ${error.message}`
            };
        }
    },

    // 状态指示器API - 用于静默模式下显示OCR处理状态
    statusIndicator: {
        window: null,           // 当前活动的状态指示器窗口实例
        preCreatedWindow: null, // 预创建的窗口实例
        autoHideTimer: null,    // 自动隐藏定时器
        backupTimer: null,      // 备用清理定时器
        isWindowReady: false,   // 当前窗口是否已准备就绪
        isPreCreatedReady: false, // 预创建窗口是否已准备就绪
        preCreateTimer: null,   // 预创建定时器

        // 预创建状态指示器窗口 - 实现<20ms响应时间
        preCreateWindow: () => {
            try {
                if (window.ocrAPI.statusIndicator.preCreatedWindow) {
                    return; // 已经预创建了
                }


                const startTime = performance.now();

                // 创建隐藏的预备窗口
                const statusUrl = `assets/status-indicator.html`;
                const options = {
                    width: 48,
                    height: 48,
                    x: -1000, // 放在屏幕外，避免闪烁
                    y: -1000,
                    frame: false,
                    transparent: true,
                    alwaysOnTop: true,
                    skipTaskbar: true,
                    resizable: false,
                    minimizable: false,
                    maximizable: false,
                    closable: false,
                    focusable: false,
                    show: false, // 预创建时不显示
                    webSecurity: false,
                    enableLargerThanScreen: true,
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    hasShadow: false,
                    roundedCorners: true
                };

                if (typeof utools !== 'undefined' && typeof utools.createBrowserWindow === 'function') {
                    window.ocrAPI.statusIndicator.preCreatedWindow = utools.createBrowserWindow(statusUrl, options);
                    window.ocrAPI.statusIndicator.isPreCreatedReady = false;

                    // 等待预创建窗口加载完成
                    setTimeout(() => {
                        window.ocrAPI.statusIndicator.isPreCreatedReady = true;
                        const endTime = performance.now();

                    }, 100); // 预创建可以等待更长时间
                }
            } catch (error) {
                console.error('[状态指示器] 预创建窗口失败:', error);
            }
        },

        // 显示状态指示器 - 超快响应版本（<20ms）
        show: (status = 'loading', autoHide = true, hideDelay = 2000) => {
            try {
                const startTime = performance.now();

                // 优先使用预创建窗口实现超快响应
                if (window.ocrAPI.statusIndicator.preCreatedWindow && window.ocrAPI.statusIndicator.isPreCreatedReady) {


                    // 获取鼠标位置
                    const mousePos = window.ocrAPI.getCursorPosition();
                    const position = { x: mousePos.x + 8, y: mousePos.y - 8 };

                    // 将预创建窗口移动到正确位置并显示
                    const preWindow = window.ocrAPI.statusIndicator.preCreatedWindow;
                    preWindow.setPosition(position.x, position.y);
                    preWindow.show();

                    // 切换到活动窗口
                    window.ocrAPI.statusIndicator.window = preWindow;
                    window.ocrAPI.statusIndicator.isWindowReady = true;
                    window.ocrAPI.statusIndicator.preCreatedWindow = null;
                    window.ocrAPI.statusIndicator.isPreCreatedReady = false;

                    // 立即发送状态更新
                    window.ocrAPI.statusIndicator.sendStatusUpdate(status, autoHide, hideDelay);

                    // 异步预创建下一个窗口
                    setTimeout(() => {
                        window.ocrAPI.statusIndicator.preCreateWindow();
                    }, 100);

                    const endTime = performance.now();

                    return;
                }

                // 如果当前窗口已存在且准备就绪，重用它
                if (window.ocrAPI.statusIndicator.window && window.ocrAPI.statusIndicator.isWindowReady) {
                    if (!window.ocrAPI.statusIndicator.window.isVisible()) {
                        window.ocrAPI.statusIndicator.showWindow();
                    }
                    window.ocrAPI.statusIndicator.sendStatusUpdate(status, autoHide, hideDelay);
                    return;
                }

                // 回退方案：创建新窗口（但仍然优化）

                window.ocrAPI.statusIndicator.forceDestroy();

                const mousePos = window.ocrAPI.getCursorPosition();
                const position = { x: mousePos.x + 8, y: mousePos.y - 8 };

                const statusUrl = `assets/status-indicator.html`;
                const options = {
                    width: 48,
                    height: 48,
                    x: position.x,
                    y: position.y,
                    frame: false,
                    transparent: true,
                    alwaysOnTop: true,
                    skipTaskbar: true,
                    resizable: false,
                    minimizable: false,
                    maximizable: false,
                    closable: false,
                    focusable: false,
                    show: true,
                    webSecurity: false,
                    enableLargerThanScreen: true,
                    backgroundColor: 'rgba(0, 0, 0, 0)',
                    hasShadow: false,
                    roundedCorners: true
                };

                if (typeof utools !== 'undefined' && typeof utools.createBrowserWindow === 'function') {
                    window.ocrAPI.statusIndicator.window = utools.createBrowserWindow(statusUrl, options);
                    window.ocrAPI.statusIndicator.isWindowReady = false;

                    // 进一步减少等待时间
                    setTimeout(() => {
                        window.ocrAPI.statusIndicator.isWindowReady = true;
                        window.ocrAPI.statusIndicator.sendStatusUpdate(status, autoHide, hideDelay);

                        // 创建完成后立即预创建下一个
                        setTimeout(() => {
                            window.ocrAPI.statusIndicator.preCreateWindow();
                        }, 200);
                    }, 30); // 进一步减少到30ms

                } else {
                    console.warn('[状态指示器] createBrowserWindow API 不可用');
                }

                const endTime = performance.now();

            } catch (error) {
                console.error('[状态指示器] 显示失败:', error);
            }
        },

        // 发送状态更新消息到窗口
        sendStatusUpdate: (status, autoHide = true, hideDelay = 2000) => {
            try {
                const indicatorWindow = window.ocrAPI.statusIndicator.window;
                if (indicatorWindow && window.ocrAPI.statusIndicator.isWindowReady) {
                    // 通过postMessage发送状态更新
                    indicatorWindow.webContents.executeJavaScript(`
                        if (window.statusIndicator) {
                            window.statusIndicator.updateStatus('${status}', ${autoHide}, ${hideDelay});
                        }
                    `).catch(error => {
                        console.warn('[状态指示器] 发送状态更新失败:', error);
                        // 如果发送失败，可能窗口已损坏，重新创建
                        window.ocrAPI.statusIndicator.isWindowReady = false;
                        window.ocrAPI.statusIndicator.show(status, autoHide, hideDelay);
                    });

                    // 设置自动隐藏定时器
                    if (autoHide && status !== 'loading') {
                        window.ocrAPI.statusIndicator.setAutoHideTimer(hideDelay);
                    }


                }
            } catch (error) {
                console.error('[状态指示器] 发送状态更新失败:', error);
            }
        },

        // 更新状态 - 使用消息传递而非重建窗口
        updateStatus: (status, autoHide = true, hideDelay = 2000) => {
            try {
                // 如果窗口存在且准备就绪，直接发送更新消息
                if (window.ocrAPI.statusIndicator.window && window.ocrAPI.statusIndicator.isWindowReady) {
                    window.ocrAPI.statusIndicator.sendStatusUpdate(status, autoHide, hideDelay);

                    // 设置备用定时器确保窗口能被清理
                    if (autoHide && status !== 'loading') {
                        window.ocrAPI.statusIndicator.clearBackupTimer();
                        window.ocrAPI.statusIndicator.backupTimer = setTimeout(() => {
                            // 备用清理：如果窗口仍然存在且不可见，则销毁
                            if (window.ocrAPI.statusIndicator.window &&
                                !window.ocrAPI.statusIndicator.window.isVisible()) {
                                window.ocrAPI.statusIndicator.forceDestroy();
                            }
                        }, hideDelay + 2000); // 给更多时间
                    }
                } else {
                    // 窗口不存在或未准备就绪，创建新窗口
                    window.ocrAPI.statusIndicator.show(status, autoHide, hideDelay);
                }
            } catch (error) {
                console.error('[状态指示器] 更新状态失败:', error);
            }
        },

        // 隐藏状态指示器
        hide: () => {
            try {
                const indicatorWindow = window.ocrAPI.statusIndicator.window;
                if (indicatorWindow) {
                    indicatorWindow.hide();
                }
            } catch (error) {
                console.error('[状态指示器] 隐藏失败:', error);
            }
        },

        // 显示已隐藏的状态指示器
        showWindow: () => {
            try {
                const indicatorWindow = window.ocrAPI.statusIndicator.window;
                if (indicatorWindow && window.ocrAPI.statusIndicator.isWindowReady) {
                    indicatorWindow.show();
                    return true;
                }
                return false;
            } catch (error) {
                console.error('[状态指示器] 显示窗口失败:', error);
                return false;
            }
        },

        // 销毁状态指示器窗口
        destroy: () => {
            try {
                window.ocrAPI.statusIndicator.clearAutoHideTimer();
                window.ocrAPI.statusIndicator.clearBackupTimer();

                const indicatorWindow = window.ocrAPI.statusIndicator.window;
                if (indicatorWindow) {
                    try {
                        indicatorWindow.close();
                    } catch (e) {
                        console.warn('[状态指示器] 关闭窗口失败:', e);
                    }
                    window.ocrAPI.statusIndicator.window = null;
                }
            } catch (error) {
                console.error('[状态指示器] 销毁窗口失败:', error);
                window.ocrAPI.statusIndicator.window = null;
            }
        },

        // 强制销毁窗口
        forceDestroy: () => {
            try {
                // 清除所有定时器
                window.ocrAPI.statusIndicator.clearAutoHideTimer();
                window.ocrAPI.statusIndicator.clearBackupTimer();

                if (window.ocrAPI.statusIndicator.preCreateTimer) {
                    clearTimeout(window.ocrAPI.statusIndicator.preCreateTimer);
                    window.ocrAPI.statusIndicator.preCreateTimer = null;
                }

                // 销毁当前窗口
                const indicatorWindow = window.ocrAPI.statusIndicator.window;
                if (indicatorWindow) {
                    try {
                        indicatorWindow.hide();
                        indicatorWindow.close();
                    } catch (e) {
                        console.warn('[状态指示器] 关闭当前窗口失败:', e);
                    }
                    window.ocrAPI.statusIndicator.window = null;
                }

                // 销毁预创建窗口
                const preCreatedWindow = window.ocrAPI.statusIndicator.preCreatedWindow;
                if (preCreatedWindow) {
                    try {
                        preCreatedWindow.hide();
                        preCreatedWindow.close();
                    } catch (e) {
                        console.warn('[状态指示器] 关闭预创建窗口失败:', e);
                    }
                    window.ocrAPI.statusIndicator.preCreatedWindow = null;
                }

                // 重置所有状态
                window.ocrAPI.statusIndicator.isWindowReady = false;
                window.ocrAPI.statusIndicator.isPreCreatedReady = false;
            } catch (error) {
                console.error('[状态指示器] 强制销毁失败:', error);
                window.ocrAPI.statusIndicator.window = null;
                window.ocrAPI.statusIndicator.preCreatedWindow = null;
                window.ocrAPI.statusIndicator.isWindowReady = false;
                window.ocrAPI.statusIndicator.isPreCreatedReady = false;
            }
        },

        // 初始化状态指示器系统
        init: () => {
            try {

                // 延迟预创建，避免影响插件启动速度
                window.ocrAPI.statusIndicator.preCreateTimer = setTimeout(() => {
                    window.ocrAPI.statusIndicator.preCreateWindow();
                }, 1000); // 插件启动1秒后预创建
            } catch (error) {
                console.error('[状态指示器] 初始化失败:', error);
            }
        },

        // 设置自动隐藏定时器
        setAutoHideTimer: (delay) => {
            window.ocrAPI.statusIndicator.clearAutoHideTimer();
            window.ocrAPI.statusIndicator.autoHideTimer = setTimeout(() => {
                // 先隐藏窗口，而不是直接销毁
                window.ocrAPI.statusIndicator.hide();

                // 延迟销毁窗口，给后续可能的状态更新留出时间
                setTimeout(() => {
                    // 只有在窗口确实没有被重新使用时才销毁
                    if (window.ocrAPI.statusIndicator.window &&
                        !window.ocrAPI.statusIndicator.window.isVisible()) {
                        window.ocrAPI.statusIndicator.forceDestroy();
                    }
                }, 1000); // 1秒后再检查是否需要销毁
            }, delay);
        },

        // 清除自动隐藏定时器
        clearAutoHideTimer: () => {
            if (window.ocrAPI.statusIndicator.autoHideTimer) {
                clearTimeout(window.ocrAPI.statusIndicator.autoHideTimer);
                window.ocrAPI.statusIndicator.autoHideTimer = null;
            }
        },

        // 清除备用定时器
        clearBackupTimer: () => {
            if (window.ocrAPI.statusIndicator.backupTimer) {
                clearTimeout(window.ocrAPI.statusIndicator.backupTimer);
                window.ocrAPI.statusIndicator.backupTimer = null;
            }
        }
    },

    // 小窗翻译API
    miniTranslate: {
        window: null,           // 小窗翻译窗口实例
        isWindowReady: false,   // 窗口是否就绪
        messageHandler: null,   // 消息处理函数
        isPinned: false,        // 窗口是否置顶
        preCreatedWindow: null, // 预创建的窗口实例
        isPreCreatedReady: false, // 预创建窗口是否已准备就绪
        preCreateTimer: null,   // 预创建定时器
        savedPosition: null,    // 保存的窗口位置 { x, y }

        // 获取保存的窗口位置
        getSavedPosition: () => {
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    const pos = utools.dbStorage.getItem('miniTranslatePosition');
                    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
                        return pos;
                    }
                }
            } catch (e) {
                // 静默处理读取失败
            }
            return null;
        },

        // 保存窗口位置
        savePosition: (x, y) => {
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    utools.dbStorage.setItem('miniTranslatePosition', { x, y });
                    window.ocrAPI.miniTranslate.savedPosition = { x, y };
                }
            } catch (e) {
                // 静默处理保存失败
            }
        },

        // 处理窗口位置变更
        handlePositionChange: (data) => {
            if (typeof data.x === 'number' && typeof data.y === 'number') {
                window.ocrAPI.miniTranslate.savePosition(data.x, data.y);
            }
        },

        // 预创建小窗翻译窗口 - 实现快速启动
        preCreateWindow: () => {
            try {
                const api = window.ocrAPI.miniTranslate;
                if (api.preCreatedWindow) {
                    return; // 已经预创建了
                }

                if (typeof utools === 'undefined' || typeof utools.createBrowserWindow !== 'function') {
                    return;
                }

                // 创建隐藏的预备窗口
                const options = {
                    width: 420,
                    height: 350,
                    x: -2000, // 放在屏幕外，避免闪烁
                    y: -2000,
                    frame: false,
                    transparent: false,
                    alwaysOnTop: false,
                    skipTaskbar: true,
                    resizable: true,
                    minimizable: true,
                    maximizable: false,
                    closable: true,
                    focusable: true,
                    show: false, // 预创建时不显示
                    webSecurity: false,
                    backgroundColor: '#ffffff',
                    hasShadow: true,
                    roundedCorners: true
                };

                api.preCreatedWindow = utools.createBrowserWindow('assets/mini-translate.html', options);
                api.isPreCreatedReady = false;

                // 等待预创建窗口加载完成
                setTimeout(() => {
                    api.isPreCreatedReady = true;
                }, 150);
            } catch (error) {
                console.error('[小窗翻译] 预创建窗口失败:', error);
            }
        },

        // 初始化小窗翻译系统
        init: () => {
            try {
                // 延迟预创建，避免影响插件启动速度
                window.ocrAPI.miniTranslate.preCreateTimer = setTimeout(() => {
                    window.ocrAPI.miniTranslate.preCreateWindow();
                }, 1500); // 插件启动1.5秒后预创建
            } catch (error) {
                console.error('[小窗翻译] 初始化失败:', error);
            }
        },

        // 打开小窗翻译
        open: (options = {}) => {
            try {
                const api = window.ocrAPI.miniTranslate;

                // 获取小窗翻译配置并添加到options
                try {
                    const config = window.ocrPlugin?.configManager?.getConfig();
                    if (config?.ui) {
                        options.miniTranslateConfig = {
                            autoTranslateOnBlur: config.ui.miniTranslateAutoTranslateOnBlur === true, // 默认关闭
                            instantAutoTranslate: config.ui.miniTranslateInstantAutoTranslate !== false, // 默认开启
                            instantAutoTranslateDelay: config.ui.miniTranslateInstantAutoTranslateDelay ?? 0.5, // 默认 0.5 秒
                            autoCloseOnCopy: config.ui.miniTranslateAutoCloseOnCopy !== false, // 默认开启
                            copyFirstModel: config.ui.miniTranslateCopyFirstModel !== false, // 默认开启
                            enableDoubleClickRightCopy: config.ui.enableDoubleClickRightCopy !== false, // 默认开启
                            positionFollowMouse: config.ui.miniTranslatePositionFollowMouse === true // 默认关闭
                        };
                    }
                } catch (e) {
                    console.warn('[小窗翻译] 获取配置失败:', e);
                }

                // 如果窗口已存在且可见，聚焦它
                if (api.window && api.isWindowReady) {
                    try {
                        api.window.show();
                        api.window.focus();
                        // 更新数据
                        if (options.text) {
                            api.sendMessage({ type: 'init', ...options });
                        }
                        return api.window;
                    } catch (e) {
                        // 窗口可能已损坏，重新创建
                        api.destroy();
                    }
                }

                // 优先使用保存的位置，否则使用鼠标位置（除非开启了跟随鼠标选项）
                const savedPos = api.getSavedPosition();
                const mousePos = window.ocrAPI.getCursorPosition();

                // 获取positionFollowMouse配置
                const positionFollowMouse = options.miniTranslateConfig?.positionFollowMouse === true;

                // 根据启用的模型数量计算初始高度
                let initialHeight = 226 + 10; // 固定部分 + 底部间距
                let selectedModelCount = 1;
                try {
                    if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                        const selectedModels = window.ocrPlugin.uiManager.selectedTranslateModels || [];
                        selectedModelCount = Math.max(1, selectedModels.length);
                    }
                } catch (e) {
                    console.warn('[小窗翻译] 获取选中模型数量失败:', e);
                }
                initialHeight += selectedModelCount * 54;
                initialHeight = Math.max(280, Math.min(800, initialHeight));

                // 确定窗口位置：如果开启跟随鼠标，始终使用鼠标位置；否则优先使用保存的位置
                let targetX, targetY;
                if (positionFollowMouse) {
                    // 跟随鼠标模式：始终使用当前鼠标位置
                    targetX = Math.max(50, mousePos.x - 210);
                    targetY = Math.max(50, mousePos.y - 100);
                } else if (savedPos) {
                    // 固定位置模式：使用保存的位置
                    targetX = savedPos.x;
                    targetY = savedPos.y;
                } else {
                    // 固定位置模式但没有保存的位置：使用鼠标位置
                    targetX = Math.max(50, mousePos.x - 210);
                    targetY = Math.max(50, mousePos.y - 100);
                }

                // ★ 优先使用预创建窗口 - 实现超快响应
                if (api.preCreatedWindow && api.isPreCreatedReady) {
                    // 将预创建窗口移动到正确位置并显示
                    const preWindow = api.preCreatedWindow;

                    try {
                        preWindow.setPosition(targetX, targetY);
                        preWindow.setSize(420, initialHeight);
                        preWindow.show();
                        preWindow.focus();
                    } catch (e) {
                        console.warn('[小窗翻译] 预创建窗口操作失败，回退到新建窗口:', e);
                        api.preCreatedWindow = null;
                        api.isPreCreatedReady = false;
                        return api.open(options); // 递归调用，走新建窗口路径
                    }

                    // 切换到活动窗口
                    api.window = preWindow;
                    api.isWindowReady = true;
                    api.preCreatedWindow = null;
                    api.isPreCreatedReady = false;

                    // 存储初始数据供子窗口读取
                    window.miniTranslateData = options;

                    // 设置消息处理
                    api.setupMessageHandler();

                    // 注入初始数据 - 多次重试确保成功
                    const initDataJson = JSON.stringify(options);
                    const injectDataWithRetry = (attempt = 0) => {
                        if (!api.window || attempt >= 5) return;
                        api.window.webContents.executeJavaScript(`
                            window.__miniTranslateDataReceived = false;
                            window.__miniTranslateInitData = ${initDataJson};
                            if (typeof handleInitialData === 'function') {
                                handleInitialData(${initDataJson});
                            } else if (window.handleInitialData) {
                                window.handleInitialData(${initDataJson});
                            } else if (window.tryGetInitialData) {
                                window.tryGetInitialData();
                            }
                            // 确保配置被刷新
                            if (window.refreshMiniTranslateConfig) {
                                window.refreshMiniTranslateConfig();
                            }
                        `).catch(() => {
                            // 失败时延迟重试
                            setTimeout(() => injectDataWithRetry(attempt + 1), 50 * (attempt + 1));
                        });
                    };
                    injectDataWithRetry();

                    // 发送初始化消息
                    api.sendMessage({ type: 'init', ...options });

                    // 启动请求轮询
                    api.startPolling();

                    // 异步预创建下一个窗口
                    setTimeout(() => {
                        api.preCreateWindow();
                    }, 200);

                    return api.window;
                }

                // 回退方案：创建新窗口
                const windowOptions = {
                    width: 420,
                    height: initialHeight,
                    x: targetX,
                    y: targetY,
                    frame: false,
                    transparent: false,
                    alwaysOnTop: false,
                    skipTaskbar: false,
                    resizable: true,
                    minimizable: true,
                    maximizable: false,
                    closable: true,
                    focusable: true,
                    show: true,
                    webSecurity: false,
                    backgroundColor: '#ffffff',
                    hasShadow: true,
                    roundedCorners: true
                };

                if (typeof utools !== 'undefined' && typeof utools.createBrowserWindow === 'function') {
                    // 存储初始数据供子窗口读取
                    window.miniTranslateData = options;

                    // 创建窗口
                    api.window = utools.createBrowserWindow('assets/mini-translate.html', windowOptions);
                    api.isWindowReady = false;

                    // 设置消息处理
                    api.setupMessageHandler();

                    // 缓存初始数据用于后续发送
                    const initDataJson = JSON.stringify(options);

                    // 多次尝试注入数据
                    const injectData = () => {
                        if (!api.window) return;
                        api.window.webContents.executeJavaScript(`
                            if (!window.__miniTranslateDataReceived) {
                                window.__miniTranslateInitData = ${initDataJson};
                                if (window.tryGetInitialData) {
                                    window.tryGetInitialData();
                                }
                            }
                        `).catch(() => { });
                    };

                    setTimeout(injectData, 5);
                    setTimeout(injectData, 15);
                    setTimeout(injectData, 35);
                    setTimeout(injectData, 70);
                    setTimeout(injectData, 120);

                    // 标记窗口准备就绪
                    setTimeout(() => {
                        api.isWindowReady = true;
                        api.sendMessage({ type: 'init', ...options });
                        api.startPolling();
                    }, 200);

                    // 创建完成后预创建下一个窗口
                    setTimeout(() => {
                        api.preCreateWindow();
                    }, 500);

                    return api.window;
                } else {
                    console.error('[小窗翻译] createBrowserWindow API 不可用');
                    return null;
                }
            } catch (error) {
                console.error('[小窗翻译] 打开窗口失败:', error);
                return null;
            }
        },

        // 轮询定时器
        pollingTimer: null,
        isTranslating: false,  // 翻译活动状态追踪
        POLLING_INTERVAL_ACTIVE: 30,   // 活跃时轮询间隔 (ms)
        POLLING_INTERVAL_IDLE: 150,    // 空闲时轮询间隔 (ms)

        // 启动轮询（自适应间隔）
        startPolling: () => {
            const api = window.ocrAPI.miniTranslate;
            api.stopPolling(); // 先停止现有的轮询

            const poll = () => {
                api.pollRequests();
                // 根据翻译状态选择轮询间隔
                const interval = api.isTranslating ? api.POLLING_INTERVAL_ACTIVE : api.POLLING_INTERVAL_IDLE;
                api.pollingTimer = setTimeout(poll, interval);
            };
            poll();
        },

        // 停止轮询
        stopPolling: () => {
            const api = window.ocrAPI.miniTranslate;
            if (api.pollingTimer) {
                clearTimeout(api.pollingTimer);
                api.pollingTimer = null;
            }
        },

        // 轮询子窗口的请求队列
        pollRequests: async () => {
            const api = window.ocrAPI.miniTranslate;
            if (!api.window || !api.isWindowReady) {
                api.stopPolling();
                return;
            }

            try {
                // 从子窗口获取请求队列
                const requests = await api.window.webContents.executeJavaScript(`
                    window.getMiniTranslateRequests ? window.getMiniTranslateRequests() : []
                `);

                // 处理每个请求
                for (const data of requests) {
                    if (!data || !data.type) continue;

                    switch (data.type) {
                        case 'translate':
                            api.handleTranslateRequest(data);
                            break;
                        case 'langChange':
                            api.handleLanguageChange(data);
                            break;
                        case 'tts':
                            api.handleTTSRequest(data);
                            break;
                        case 'openSettings':
                            api.handleOpenSettings(data);
                            break;
                        case 'pin':
                            api.handlePinChange(data);
                            break;
                        case 'modelSelectionChange':
                            api.handleModelSelectionChange(data);
                            break;
                        case 'resizeWindow':
                            api.handleResizeWindow(data);
                            break;
                        case 'positionChange':
                            api.handlePositionChange(data);
                            break;
                    }
                }
            } catch (e) {
                // 窗口可能已关闭
                if (e.message && e.message.includes('no exist')) {
                    api.stopPolling();
                    api.isWindowReady = false;
                }
            }
        },

        // 设置消息处理
        setupMessageHandler: () => {
            const api = window.ocrAPI.miniTranslate;

            // 移除旧的处理函数
            if (api.messageHandler) {
                window.removeEventListener('message', api.messageHandler);
            }

            // 创建新的处理函数
            api.messageHandler = (event) => {
                const data = event.data;
                if (!data || !data.type) return;

                switch (data.type) {
                    case 'translate':
                        // 触发翻译
                        api.handleTranslateRequest(data);
                        break;
                    case 'langChange':
                        // 语言变更，同步到主页面
                        api.handleLanguageChange(data);
                        break;
                    case 'tts':
                        // TTS请求
                        api.handleTTSRequest(data);
                        break;
                    case 'openSettings':
                        // 打开设置
                        api.handleOpenSettings();
                        break;
                    case 'pin':
                        // 置顶状态变更
                        api.handlePinChange(data);
                        break;
                }
            };

            window.addEventListener('message', api.messageHandler);
        },

        // 语言代码到英文value的映射（用于LLM翻译提示词）
        langCodeToValue: {
            'zh-cn': 'Chinese (Simplified)',
            'zh-tw': 'Chinese (Traditional)',
            'en-us': 'English',
            'ja': 'Japanese',
            'ja-jp': 'Japanese',
            'ko': 'Korean',
            'ko-kr': 'Korean',
            'fr': 'French',
            'fr-fr': 'French',
            'de': 'German',
            'de-de': 'German',
            'es': 'Spanish',
            'es-es': 'Spanish',
            'ru': 'Russian',
            'ru-ru': 'Russian',
            'pt': 'Portuguese',
            'pt-pt': 'Portuguese',
            'it': 'Italian',
            'it-it': 'Italian',
            'ar': 'Arabic',
            'ar-ar': 'Arabic',
            'th': 'Thai',
            'th-th': 'Thai',
            'vi': 'Vietnamese',
            'vi-vn': 'Vietnamese'
        },

        // 转换小窗翻译语言对象为包含value属性的格式
        convertLangObject: (lang) => {
            if (!lang) return null;
            const api = window.ocrAPI.miniTranslate;
            const code = lang.code || lang.langCode;
            const value = api.langCodeToValue[code] || lang.name || 'English';
            return {
                value: value,
                langCode: code,
                label: lang.name || lang.label,
                emoji: lang.emoji
            };
        },



        // 处理翻译请求 - 优化版：并行执行、无重复语言检测
        handleTranslateRequest: async (data) => {
            const api = window.ocrAPI.miniTranslate;
            api.isTranslating = true;  // 标记翻译开始，加速轮询

            try {
                // 调用主程序的翻译功能
                if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                    const uiManager = window.ocrPlugin.uiManager;
                    const config = window.ocrPlugin.configManager?.getConfig();

                    // 使用小窗翻译传递过来的模型列表（小窗有自己独立的模型启用状态）
                    const models = data.models || [];

                    if (models.length === 0) {
                        api.sendMessage({ type: 'translationComplete', error: '请先选择翻译模型' });
                        api.isTranslating = false;
                        return;
                    }

                    // 直接使用小窗传递的语言设置（已在小窗端完成检测）
                    const sourceLang = api.convertLangObject(data.sourceLang);
                    const targetLang = api.convertLangObject(data.targetLang);


                    // 先通知所有模型开始翻译
                    models.forEach(modelConfig => {
                        const modelKey = `${modelConfig.service}_${modelConfig.model}`;
                        api.sendMessage({
                            type: 'updateResult',
                            modelKey,
                            result: { status: 'streaming', text: '' }
                        });
                    });

                    // ★ 并行执行所有模型翻译
                    const translatePromises = models.map(async (modelConfig) => {
                        const modelKey = `${modelConfig.service}_${modelConfig.model}`;

                        try {
                            let result;

                            if (modelConfig.type === 'traditional') {
                                // 传统翻译API
                                const translateConfig = window.ocrPlugin.configManager.getTraditionalTranslateConfig(modelConfig.service);
                                if (!translateConfig) {
                                    throw new Error(`${modelConfig.service}翻译API未配置`);
                                }

                                const sourceCode = uiManager.convertLanguageCodeForTraditional(
                                    sourceLang?.langCode || sourceLang?.code || 'auto',
                                    modelConfig.service
                                );
                                const targetCode = uiManager.convertLanguageCodeForTraditional(
                                    targetLang?.langCode || targetLang?.code || 'zh-cn',
                                    modelConfig.service
                                );

                                result = await window.ocrPlugin.ocrServices.performTraditionalTranslation(
                                    data.text,
                                    sourceCode,
                                    targetCode,
                                    modelConfig.service,
                                    translateConfig
                                );
                            } else {
                                // AI模型翻译
                                result = await window.ocrPlugin.ocrServices.performTranslation(
                                    data.text,
                                    modelConfig.service,
                                    modelConfig.model,
                                    config,
                                    (chunk, fullText) => {
                                        // 流式输出回调
                                        api.sendMessage({
                                            type: 'updateResult',
                                            modelKey,
                                            result: {
                                                status: 'streaming',
                                                text: fullText !== undefined ? fullText : chunk
                                            }
                                        });
                                    },
                                    targetLang,
                                    sourceLang,
                                    null
                                );
                            }

                            // 发送最终结果
                            if (result.success) {
                                api.sendMessage({
                                    type: 'updateResult',
                                    modelKey,
                                    result: {
                                        status: 'completed',
                                        text: result.translatedText || result.text || result.fullText || ''
                                    }
                                });
                            } else {
                                api.sendMessage({
                                    type: 'updateResult',
                                    modelKey,
                                    result: { status: 'failed', error: result.error || '翻译失败' }
                                });
                            }
                            return { modelKey, success: true };
                        } catch (error) {
                            api.sendMessage({
                                type: 'updateResult',
                                modelKey,
                                result: { status: 'failed', error: error.message || '翻译失败' }
                            });
                            return { modelKey, success: false, error: error.message };
                        }
                    });

                    // 等待所有翻译完成
                    const results = await Promise.allSettled(translatePromises);

                    // 收集成功的翻译结果，用于保存历史记录
                    const successfulResults = results.filter(r =>
                        r.status === 'fulfilled' && r.value.success
                    );

                    // 保存翻译历史记录（遍历所有成功的模型结果）
                    if (successfulResults.length > 0 && data.text) {
                        // 获取所有翻译结果
                        const allResults = await api.window.webContents.executeJavaScript(`
                            (function() {
                                return JSON.stringify(window.translateResults || {});
                            })()
                        `).catch(() => '{}');

                        let resultsObj = {};
                        try {
                            resultsObj = JSON.parse(allResults);
                        } catch (e) {
                            console.warn('[小窗翻译] 解析翻译结果失败:', e);
                        }

                        // 遍历所有成功的模型，分别保存历史记录
                        for (const successResult of successfulResults) {
                            try {
                                const modelKey = successResult.value.modelKey;
                                const modelConfig = models.find(m =>
                                    `${m.service}_${m.model}` === modelKey
                                );

                                if (modelConfig) {
                                    const translatedText = resultsObj[modelKey]?.text || '';

                                    if (translatedText && translatedText.trim()) {
                                        uiManager.saveTranslateHistory(
                                            data.text,
                                            translatedText.trim(),
                                            sourceLang,
                                            targetLang,
                                            modelConfig.service,
                                            modelConfig.model
                                        );
                                        console.log('[小窗翻译] 历史记录已保存:', modelConfig.service, modelConfig.model);
                                    }
                                }
                            } catch (historyError) {
                                console.warn('[小窗翻译] 保存单个模型历史记录失败:', historyError);
                            }
                        }
                    }

                    // 所有翻译完成
                    api.sendMessage({ type: 'translationComplete' });
                } else {
                    // window.ocrPlugin 或 uiManager 不可用（插件可能在后台长时间运行后状态丢失）
                    console.warn('[小窗翻译] 翻译服务不可用，请打开主页面后重试');
                    api.sendMessage({ type: 'translationComplete', error: '翻译服务暂时不可用，请打开主页面后重试' });
                }
            } catch (error) {
                console.error('[小窗翻译] 翻译请求处理失败:', error);
                api.sendMessage({ type: 'translationComplete', error: error.message });
            } finally {
                api.isTranslating = false;  // 标记翻译结束，降低轮询频率
            }
        },

        // 处理语言变更
        handleLanguageChange: (data) => {
            // 同步语言设置到主翻译页面
            if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                const uiManager = window.ocrPlugin.uiManager;
                if (data.sourceLang) {
                    uiManager.updateLanguageSelector('source', {
                        langCode: data.sourceLang.code,
                        emoji: data.sourceLang.emoji,
                        name: data.sourceLang.name
                    });
                }
                if (data.targetLang) {
                    uiManager.updateLanguageSelector('target', {
                        langCode: data.targetLang.code,
                        emoji: data.targetLang.emoji,
                        name: data.targetLang.name
                    });
                }
            }
        },

        // 处理TTS请求
        handleTTSRequest: (data) => {
            // 优先使用主页面的TTS管理器
            if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                const ttsManager = window.ocrPlugin.uiManager.ttsManager;
                if (ttsManager && data.text) {
                    ttsManager.speak(data.text).catch(console.error);
                    return;
                }
            }

            // Fallback: 在小窗翻译窗口中直接使用Web Speech API
            const api = window.ocrAPI.miniTranslate;
            if (api.window && data.text) {
                try {
                    api.window.webContents.executeJavaScript(`
                        (function() {
                            if ('speechSynthesis' in window) {
                                // 停止当前朗读
                                window.speechSynthesis.cancel();
                                
                                // 创建语音合成实例
                                const utterance = new SpeechSynthesisUtterance(${JSON.stringify(data.text)});
                                
                                // 检测语言并设置
                                const text = ${JSON.stringify(data.text)};
                                const chineseRegex = /[\\u4e00-\\u9fff]/g;
                                const englishRegex = /[a-zA-Z]/g;
                                const chineseCount = (text.match(chineseRegex) || []).length;
                                const englishCount = (text.match(englishRegex) || []).length;
                                
                                if (chineseCount > englishCount) {
                                    utterance.lang = 'zh-CN';
                                } else {
                                    utterance.lang = 'en-US';
                                }
                                
                                utterance.rate = 1;
                                utterance.pitch = 1;
                                utterance.volume = 1;
                                
                                // 开始朗读
                                window.speechSynthesis.speak(utterance);
                            }
                        })();
                    `).catch(err => console.error('[小窗翻译] TTS执行失败:', err));
                } catch (e) {
                    console.error('[小窗翻译] TTS fallback失败:', e);
                }
            }
        },

        // 处理打开设置
        handleOpenSettings: (data = {}) => {
            const api = window.ocrAPI.miniTranslate;

            // 关闭小窗
            if (api.window) {
                try {
                    api.window.close();
                } catch (e) {
                    // 静默处理
                }
            }
            api.close();

            // 显示主窗口
            if (typeof utools !== 'undefined') {
                utools.showMainWindow();
            }

            // 延迟执行导航，确保主窗口完全显示
            setTimeout(() => {
                if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                    // 点击设置按钮显示配置页面
                    const configBtn = document.getElementById('config-btn');
                    if (configBtn) {
                        configBtn.click();
                    }

                    // 如果指定了目标配置项，则跳转到对应配置
                    if (data.target) {
                        setTimeout(() => {
                            const configItem = document.querySelector(`.config-item[data-config="${data.target}"]`);
                            if (configItem) {
                                configItem.click();
                            }
                        }, 100);
                    }
                }
            }, 50);
        },

        // 处理置顶状态变更
        handlePinChange: (data) => {
            const api = window.ocrAPI.miniTranslate;
            // 更新置顶状态追踪
            api.isPinned = data.isPinned;
            if (api.window) {
                try {
                    api.window.setAlwaysOnTop(data.isPinned);
                } catch (e) {
                    console.error('[小窗翻译] 设置置顶失败:', e);
                }
            }
        },

        // 处理模型选择变更 - 已弃用：小窗翻译现在使用独立的模型启用状态存储
        // 小窗翻译的模型启用状态保存在 utools.dbStorage.getItem('miniTranslate_selectedModels')
        // 不再同步回主页面
        handleModelSelectionChange: (data) => {
            // 不再同步到主页面 - 小窗翻译和主页面的模型启用状态现在是独立的
        },

        // 处理窗口高度调整请求
        handleResizeWindow: (data) => {
            const api = window.ocrAPI.miniTranslate;
            if (api.window && data.height) {
                try {
                    const currentBounds = api.window.getBounds();
                    const newHeight = Math.max(280, Math.min(800, data.height));

                    // Only resize if height changed significantly
                    if (Math.abs(currentBounds.height - newHeight) > 10) {
                        api.window.setBounds({
                            x: currentBounds.x,
                            y: currentBounds.y,
                            width: currentBounds.width,
                            height: newHeight
                        });
                    }
                } catch (e) {
                    console.warn('[小窗翻译] 调整窗口大小失败:', e);
                }
            }
        },

        // 发送消息到子窗口
        sendMessage: (data) => {
            const api = window.ocrAPI.miniTranslate;
            if (api.window && api.isWindowReady) {
                try {
                    // 检查窗口是否仍然有效
                    if (api.window.webContents) {
                        api.window.webContents.executeJavaScript(`
                            window.dispatchEvent(new MessageEvent('message', { data: ${JSON.stringify(data)} }));
                        `).catch(() => {
                            // 窗口可能已关闭，静默处理并清理状态
                            api.isWindowReady = false;
                        });
                    }
                } catch (e) {
                    // 发送失败，静默处理
                    api.isWindowReady = false;
                }
            }
        },

        // 更新模型选择（当主页面模型列表变化时调用，只更新模型列表，保持小窗翻译自己的启用状态）
        syncModels: () => {
            const api = window.ocrAPI.miniTranslate;
            if (api.window && api.isWindowReady) {
                if (window.ocrPlugin && window.ocrPlugin.uiManager) {
                    const uiManager = window.ocrPlugin.uiManager;
                    const configManager = window.ocrPlugin.configManager;
                    const config = window.ocrPlugin.config;

                    // 获取所有翻译模型（取前4个）- 模型列表从主页面获取
                    const allTranslateModels = configManager.getTranslateModels() || [];
                    const modelsToShow = allTranslateModels.slice(0, 4);

                    // 获取小窗翻译独立保存的模型启用状态
                    let miniTranslateSelectedKeys = [];
                    try {
                        const savedMiniSelection = utools.dbStorage.getItem('miniTranslate_selectedModels');
                        if (savedMiniSelection && Array.isArray(savedMiniSelection)) {
                            miniTranslateSelectedKeys = savedMiniSelection;
                        }
                    } catch (e) {
                        // 读取失败，使用空数组
                    }

                    // 如果没有小窗翻译的保存状态，默认只启用第一个模型
                    const shouldDefaultSelectFirst = miniTranslateSelectedKeys.length === 0 && modelsToShow.length > 0;

                    // 为所有模型添加完整信息和选中状态
                    const modelsWithInfo = modelsToShow.map((m, index) => {
                        let displayName = m.model;
                        const type = m.model === 'traditional' ? 'traditional' : 'ai';

                        if (type === 'traditional') {
                            displayName = configManager.getServiceDisplayName(m.service);
                        } else {
                            try {
                                const platformConfig = config[m.service];
                                if (platformConfig && platformConfig.modelNameMap) {
                                    displayName = platformConfig.modelNameMap[m.model] || m.model;
                                }
                            } catch (e) { }
                        }

                        // 获取图标HTML
                        let iconHtml = '';
                        if (uiManager.createProviderIconElement) {
                            iconHtml = uiManager.createProviderIconElement(m.service, 'small') || '';
                        }

                        // 检查是否选中 - 使用小窗翻译独立的启用状态
                        const modelKey = `${m.service}:${m.model}`;
                        const isSelected = shouldDefaultSelectFirst
                            ? (index === 0)  // 默认只启用第一个模型
                            : miniTranslateSelectedKeys.includes(modelKey);

                        return {
                            service: m.service,
                            model: m.model,
                            name: displayName,
                            type: type,
                            iconHtml: iconHtml,
                            isSelected: isSelected
                        };
                    });

                    api.sendMessage({
                        type: 'updateModels',
                        models: modelsWithInfo
                    });
                }
            }
        },

        // 关闭窗口
        close: () => {
            const api = window.ocrAPI.miniTranslate;
            // 停止轮询
            api.stopPolling();
            if (api.window) {
                try {
                    api.window.close();
                } catch (e) {
                    // 静默处理窗口已关闭的情况
                }
            }
            api.window = null;
            api.isWindowReady = false;
            api.isPinned = false; // 重置置顶状态
        },

        // 销毁 - 安全清理
        destroy: () => {
            const api = window.ocrAPI.miniTranslate;
            // 先停止轮询
            api.stopPolling();

            // 清除预创建定时器
            if (api.preCreateTimer) {
                clearTimeout(api.preCreateTimer);
                api.preCreateTimer = null;
            }

            // 移除消息处理函数
            if (api.messageHandler) {
                try {
                    window.removeEventListener('message', api.messageHandler);
                } catch (e) {
                    // 忽略
                }
                api.messageHandler = null;
            }

            // 尝试关闭当前窗口
            if (api.window) {
                try {
                    api.window.close();
                } catch (e) {
                    console.log('[小窗翻译] 窗口已关闭或不存在');
                }
            }

            // 尝试关闭预创建窗口
            if (api.preCreatedWindow) {
                try {
                    api.preCreatedWindow.close();
                } catch (e) {
                    // 忽略
                }
            }

            // 清理状态
            api.window = null;
            api.isWindowReady = false;
            api.preCreatedWindow = null;
            api.isPreCreatedReady = false;
        }
    }
};

// 插件加载完成后初始化状态指示器系统
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        // 延迟初始化，确保所有API都已准备就绪
        setTimeout(() => {
            if (window.ocrAPI?.statusIndicator?.init) {
                window.ocrAPI.statusIndicator.init();
            }
            // 初始化小窗翻译预创建系统
            if (window.ocrAPI?.miniTranslate?.init) {
                window.ocrAPI.miniTranslate.init();
            }
        }, 500);
    });
}
