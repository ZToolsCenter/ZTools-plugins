/**
 * 原生 OCR 模块管理器
 * 负责 @napi-rs/system-ocr 原生模块的下载、安装、加载和卸载
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

// 模块版本
const MODULE_VERSION = '1.0.2';

// 各平台对应的 npm 包信息
const PLATFORM_PACKAGES = {
    'win32-x64': {
        packageName: '@napi-rs/system-ocr-win32-x64-msvc',
        nodeFileName: 'system-ocr-win32-x64-msvc.node',
        displayName: 'Windows x64'
    },
    'win32-arm64': {
        packageName: '@napi-rs/system-ocr-win32-arm64-msvc',
        nodeFileName: 'system-ocr-win32-arm64-msvc.node',
        displayName: 'Windows ARM64'
    },
    'darwin-x64': {
        packageName: '@napi-rs/system-ocr-darwin-x64',
        nodeFileName: 'system-ocr-darwin-x64.node',
        displayName: 'macOS Intel'
    },
    'darwin-arm64': {
        packageName: '@napi-rs/system-ocr-darwin-arm64',
        nodeFileName: 'system-ocr-darwin-arm64.node',
        displayName: 'macOS Apple Silicon'
    }
};

class NativeOcrManager {
    constructor() {
        this.binding = null;
        this.installDir = null;
    }

    /**
     * 获取当前平台标识
     */
    getPlatformKey() {
        return `${process.platform}-${process.arch}`;
    }

    /**
     * 获取当前平台的模块信息
     */
    getModuleInfo() {
        const platformKey = this.getPlatformKey();
        const info = PLATFORM_PACKAGES[platformKey];
        if (!info) {
            return {
                supported: false,
                platformKey,
                error: `当前平台不支持系统 OCR: ${platformKey}`
            };
        }
        return {
            supported: true,
            platformKey,
            ...info,
            version: MODULE_VERSION
        };
    }

    /**
     * 获取模块安装目录
     */
    getInstallDir() {
        if (this.installDir) {
            return this.installDir;
        }

        // 优先使用 uTools 数据目录
        if (typeof utools !== 'undefined' && utools.getPath) {
            const dataPath = utools.getPath('userData');
            this.installDir = path.join(dataPath, 'system-ocr');
        } else {
            // 回退到插件目录
            this.installDir = path.join(__dirname, 'system-ocr');
        }

        return this.installDir;
    }

    /**
     * 获取 .node 文件路径（动态查找）
     */
    getNodeFilePath() {
        const info = this.getModuleInfo();
        if (!info.supported) {
            return null;
        }

        const installDir = this.getInstallDir();
        if (!fs.existsSync(installDir)) {
            return null;
        }

        // 动态查找 .node 文件
        try {
            const files = fs.readdirSync(installDir);
            const nodeFile = files.find(f => f.endsWith('.node'));
            if (nodeFile) {
                return path.join(installDir, nodeFile);
            }
        } catch (e) {
            // 忽略读取错误
        }

        return null;
    }

    /**
     * 检查模块是否已安装
     */
    isInstalled() {
        const nodePath = this.getNodeFilePath();
        if (!nodePath) {
            return false;
        }
        return fs.existsSync(nodePath);
    }

    /**
     * 获取安装状态信息
     */
    getInstallStatus() {
        const info = this.getModuleInfo();
        const installed = this.isInstalled();
        const installDir = this.getInstallDir();

        return {
            ...info,
            installed,
            installDir,
            nodeFilePath: installed ? this.getNodeFilePath() : null
        };
    }

    /**
     * 获取 npm 包下载 URL
     */
    getDownloadUrl() {
        const info = this.getModuleInfo();
        if (!info.supported) {
            return null;
        }
        // npm registry URL 格式
        const scopedName = info.packageName.replace('@napi-rs/', '');
        return `https://registry.npmjs.org/${info.packageName}/-/${scopedName}-${MODULE_VERSION}.tgz`;
    }

    /**
     * 下载文件
     */
    downloadFile(url, destPath, onProgress) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);

            const request = (targetUrl) => {
                https.get(targetUrl, (response) => {
                    // 处理重定向
                    if (response.statusCode === 302 || response.statusCode === 301) {
                        request(response.headers.location);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        reject(new Error(`下载失败: HTTP ${response.statusCode}`));
                        return;
                    }

                    const totalSize = parseInt(response.headers['content-length'], 10);
                    let downloadedSize = 0;

                    response.on('data', (chunk) => {
                        downloadedSize += chunk.length;
                        if (onProgress && totalSize) {
                            onProgress({
                                downloaded: downloadedSize,
                                total: totalSize,
                                percent: Math.round((downloadedSize / totalSize) * 100)
                            });
                        }
                    });

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve(destPath);
                    });

                    file.on('error', (err) => {
                        fs.unlink(destPath, () => { });
                        reject(err);
                    });
                }).on('error', (err) => {
                    fs.unlink(destPath, () => { });
                    reject(err);
                });
            };

            request(url);
        });
    }

    /**
     * 解压 .tgz 文件并提取 .node 文件
     */
    extractNodeFile(tgzPath, destDir) {
        return new Promise((resolve, reject) => {
            const tar = require('tar');

            // 解压到临时目录
            const tempDir = path.join(destDir, 'temp_extract');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            tar.extract({
                file: tgzPath,
                cwd: tempDir
            }).then(() => {
                // 查找 .node 文件
                const packageDir = path.join(tempDir, 'package');
                const files = fs.readdirSync(packageDir);
                const nodeFile = files.find(f => f.endsWith('.node'));

                if (!nodeFile) {
                    reject(new Error('未找到 .node 文件'));
                    return;
                }

                // 移动 .node 文件到目标目录
                const srcPath = path.join(packageDir, nodeFile);
                const destPath = path.join(destDir, nodeFile);
                fs.copyFileSync(srcPath, destPath);

                // 清理临时文件
                fs.rmSync(tempDir, { recursive: true, force: true });
                fs.unlinkSync(tgzPath);

                resolve(destPath);
            }).catch(reject);
        });
    }

    /**
     * 使用系统 tar 命令解压（不依赖 npm 包）
     */
    extractWithSystemTar(tgzPath, destDir) {
        return new Promise((resolve, reject) => {
            const { execSync } = require('child_process');

            // 解压到临时目录
            const tempDir = path.join(destDir, 'temp_extract');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            try {
                // Windows 10+ 和 macOS 都内置 tar 命令
                execSync(`tar -xzf "${tgzPath}" -C "${tempDir}"`, {
                    stdio: 'pipe',
                    windowsHide: true
                });

                // 查找 .node 文件
                const packageDir = path.join(tempDir, 'package');
                const files = fs.readdirSync(packageDir);
                const nodeFile = files.find(f => f.endsWith('.node'));

                if (!nodeFile) {
                    reject(new Error('未找到 .node 文件'));
                    return;
                }

                // 移动 .node 文件到目标目录
                const srcPath = path.join(packageDir, nodeFile);
                const destPath = path.join(destDir, nodeFile);
                fs.copyFileSync(srcPath, destPath);

                // 清理临时文件
                fs.rmSync(tempDir, { recursive: true, force: true });
                fs.unlinkSync(tgzPath);

                resolve(destPath);
            } catch (error) {
                // 清理
                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    fs.unlinkSync(tgzPath);
                } catch (e) { }
                reject(error);
            }
        });
    }

    /**
     * 安装模块
     */
    async install(onProgress) {
        const info = this.getModuleInfo();
        if (!info.supported) {
            throw new Error(info.error);
        }

        if (this.isInstalled()) {
            return { success: true, message: '模块已安装' };
        }

        const installDir = this.getInstallDir();
        if (!fs.existsSync(installDir)) {
            fs.mkdirSync(installDir, { recursive: true });
        }

        const downloadUrl = this.getDownloadUrl();
        const tgzPath = path.join(installDir, 'package.tgz');

        try {
            // 下载
            if (onProgress) {
                onProgress({ stage: 'downloading', percent: 0 });
            }

            await this.downloadFile(downloadUrl, tgzPath, (progress) => {
                if (onProgress) {
                    onProgress({
                        stage: 'downloading',
                        ...progress
                    });
                }
            });

            // 解压
            if (onProgress) {
                onProgress({ stage: 'extracting', percent: 100 });
            }

            const nodeFilePath = await this.extractWithSystemTar(tgzPath, installDir);

            // 验证安装
            if (onProgress) {
                onProgress({ stage: 'verifying', percent: 100 });
            }

            // 尝试加载验证
            this.binding = null; // 重置
            await this.load();

            if (onProgress) {
                onProgress({ stage: 'complete', percent: 100 });
            }

            return {
                success: true,
                message: '安装成功',
                nodeFilePath
            };
        } catch (error) {
            // 清理失败的安装
            try {
                if (fs.existsSync(tgzPath)) {
                    fs.unlinkSync(tgzPath);
                }
            } catch (e) { }

            throw error;
        }
    }

    /**
     * 卸载模块
     */
    uninstall() {
        const installDir = this.getInstallDir();

        if (fs.existsSync(installDir)) {
            fs.rmSync(installDir, { recursive: true, force: true });
        }

        this.binding = null;

        return { success: true, message: '卸载成功' };
    }

    /**
     * 加载模块
     */
    async load() {
        if (this.binding) {
            return this.binding;
        }

        if (!this.isInstalled()) {
            throw new Error('模块未安装');
        }

        const nodePath = this.getNodeFilePath();

        try {
            this.binding = require(nodePath);
            return this.binding;
        } catch (error) {
            throw new Error(`加载模块失败: ${error.message}`);
        }
    }

    /**
     * 执行 OCR 识别
     * @param {Buffer} imageBuffer - 图片 Buffer
     * @param {string[]} langs - 语言列表 (仅 Windows 需要)
     * @returns {Promise<{text: string, lines: Array}>}
     */
    async recognize(imageBuffer, langs = ['zh-Hans', 'en']) {
        const binding = await this.load();

        // OcrAccuracy: 0 = Fast, 1 = Accurate
        const accuracy = binding.OcrAccuracy ? binding.OcrAccuracy.Accurate : 1;

        // Windows 需要语言参数，macOS 自动检测
        const langParam = process.platform === 'win32' ? langs : undefined;

        const result = await binding.recognize(imageBuffer, accuracy, langParam);

        // 后处理：移除中日韩字符之间的多余空格（Windows OCR API 的已知问题）
        const processedText = this.removeCJKSpaces(result.text || '');

        return {
            text: processedText,
            lines: result.lines || []
        };
    }

    /**
     * 移除中日韩字符之间的多余空格
     * Windows OCR API 会在 CJK 字符之间插入空格
     * @param {string} text - 原始文本
     * @returns {string} 处理后的文本
     */
    removeCJKSpaces(text) {
        if (!text) return '';

        // CJK 字符范围正则表达式
        // 包括中文、日文假名、韩文等
        const cjkPattern = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\uff00-\uffef]/;

        // 移除两个 CJK 字符之间的空格
        // 同时保留 CJK 与英文/数字之间的空格
        let result = '';
        const chars = text.split('');

        for (let i = 0; i < chars.length; i++) {
            const char = chars[i];
            const prevChar = i > 0 ? chars[i - 1] : '';
            const nextChar = i < chars.length - 1 ? chars[i + 1] : '';

            // 如果当前字符是空格
            if (char === ' ') {
                // 检查前后字符是否都是 CJK 字符
                const prevIsCJK = cjkPattern.test(prevChar);
                const nextIsCJK = cjkPattern.test(nextChar);

                // 如果前后都是 CJK 字符，跳过这个空格
                if (prevIsCJK && nextIsCJK) {
                    continue;
                }
            }

            result += char;
        }

        return result;
    }
}

// 创建单例
const nativeOcrManager = new NativeOcrManager();

module.exports = { nativeOcrManager, NativeOcrManager };
