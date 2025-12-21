// 引入配置管理类
// const ConfigManager = require('./lib/configManager');
// const configManager = new ConfigManager();

// 导出插件功能
window.exports = {
    'confetti': {
        mode: 'none',
        args: {
            // 进入插件时调用
            enter: ({ code, type, payload }) => {
                createEffectWindow('index.html');
            }
        }
    },
    'settings': {
        mode: 'none',
        args: {
            // 进入设置时调用
            enter: ({ code, type, payload }) => {
                createSettingsWindow('settings.html');
            }
        }
    }
}

/**
 * 创建特效窗口的通用函数
 * @param {string} htmlFile - HTML文件名
 */
function createEffectWindow(htmlFile) {
    try {
        ztools.hideMainWindow()

        // 1. 获取鼠标位置
        const { x, y } = ztools.getCursorScreenPoint()

        // 2. 获取鼠标所在显示器
        const display = ztools.getDisplayNearestPoint({ x, y })
        if (!display) {
            ztools.showNotification('未找到鼠标所在的显示器', 'error')
            ztools.outPlugin()
            return
        }

        // 使用配置管理器获取全屏设置
        // const fullscreenEnabled = configManager.getFullscreenSetting();
        // 3. 只在该显示器创建特效窗口
        const { x: dx, y: dy, width, height } = display.bounds
        const win = ztools.createBrowserWindow(htmlFile, {
            x: dx,
            y: dy,
            width,
            height,
            frame: false,
            transparent: true,
            hasShadow: false,
            backgroundColor: '#00000000',
            alwaysOnTop: true,
            skipTaskbar: true,
            fullscreen: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false
            }
        })
        win.setIgnoreMouseEvents(true, { forward: true })

    } catch (error) {
        ztools.showNotification('创建窗口失败: ' + error.message, 'error')
    }
    // 这里不能 kill 否则动画窗口会一起关闭
    ztools.outPlugin()
}

/**
 * 创建设置窗口的函数
 * @param {string} htmlFile - HTML文件名
 */
function createSettingsWindow(htmlFile) {
    try {
        ztools.hideMainWindow()

        // 创建设置窗口
        const win = ztools.createBrowserWindow(htmlFile, {
            width: 500,
            height: 400,
            frame: true,
            transparent: false,
            hasShadow: true,
            backgroundColor: '#ffffff',
            alwaysOnTop: false,
            skipTaskbar: false,
            resizable: false,
            minimizable: true,
            maximizable: false,
            center: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        })

    } catch (error) {
        ztools.showNotification('创建设置窗口失败: ' + error.message, 'error')
    }

    ztools.outPlugin()
}
