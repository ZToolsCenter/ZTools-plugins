/**
 * ZTools Preload Script
 * 遵循 CommonJS 规范，用于释放沙箱限制并提供 Node.js 能力。
 */
const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

// 将 API 暴露给渲染进程 (window 对象)
window.ztoolsPreload = {
    // 获取当前应用的基础路径
    getAppPath: () => __dirname,
    
    // 打开外部链接
    openExternal: (url) => {
        if (url && url.startsWith('http')) {
            shell.openExternal(url);
        }
    },

    /**
     * 显示保存对话框
     * ZTools 通常会透传 Electron 的 showSaveDialog
     */
    showSaveDialog: async (options) => {
        // 如果 window.ztools 全局已经有此方法，优先使用（它是经过框架封装的）
        if (window.ztools && typeof window.ztools.showSaveDialog === 'function') {
            return await window.ztools.showSaveDialog(options);
        }
        // 回退方案：通过 IPC 调用（假设主进程有对应 handler）或直接返回提醒
        console.warn('ZTools 原生 showSaveDialog 接口检测失败，尝试调用插件自定义方案');
        // 注意：在普通 preload 中无法直接调用 dialog 模块，这里通常需要主进程支持
        // 但我们可以提供一个基础的文件名获取逻辑作为演示
    },

    /**
     * 下载文件到本地 (增强版：支持 HTTP/HTTPS 及自动重定向)
     */
    downloadFile: (url, destPath, onProgress, onDone, onError) => {
        const http = require('http');
        const https = require('https');
        
        const performDownload = (currentUrl, redirectCount = 0) => {
            if (redirectCount > 5) {
                onError && onError('重定向次数过多');
                return;
            }

            const protocol = currentUrl.startsWith('https') ? https : http;
            
            protocol.get(currentUrl, (response) => {
                // 处理重定向 (301, 302, 307, 308)
                if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
                    let nextUrl = response.headers.location;
                    if (!nextUrl.startsWith('http')) {
                        const origin = new URL(currentUrl).origin;
                        nextUrl = origin + (nextUrl.startsWith('/') ? '' : '/') + nextUrl;
                    }
                    performDownload(nextUrl, redirectCount + 1);
                    return;
                }

                if (response.statusCode !== 200) {
                    onError && onError(`下载失败: 状态码 ${response.statusCode}`);
                    return;
                }

                const file = fs.createWriteStream(destPath);
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;

                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (onProgress && totalSize) {
                        onProgress(downloadedSize / totalSize);
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    onDone && onDone(destPath);
                });

                file.on('error', (err) => {
                    fs.unlink(destPath, () => {});
                    onError && onError(`写入失败: ${err.message}`);
                });
            }).on('error', (err) => {
                fs.unlink(destPath, () => {});
                onError && onError(`请求失败: ${err.message}`);
            });
        };

        performDownload(url);
    },
    
    // 简单的本地日志记录
    logSession: (msg) => {
        const logPath = path.join(__dirname, 'plugin_log.txt');
        fs.appendFileSync(logPath, `[${new Date().toLocaleString()}] ${msg}\n`);
    }
};

console.log('MusicSquare ZTools Preload Loaded.');
