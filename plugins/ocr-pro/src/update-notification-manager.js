/**
 * 版本更新提示管理器
 * 负责检测插件版本更新并显示更新日志
 */
class UpdateNotificationManager {
    constructor() {
        this.storageKey = 'ocr-last-viewed-version';
        this.currentVersion = null;
        this.lastViewedVersion = null;
    }

    /**
     * 初始化并检查是否需要显示更新提示
     */
    async initialize() {
        try {
            // 获取当前版本号
            this.currentVersion = await this.getCurrentVersion();

            // 获取上次查看的版本号
            this.lastViewedVersion = this.getLastViewedVersion();

            // 检查是否需要显示更新提示
            if (this.shouldShowUpdateNotification()) {
                this.showUpdateNotification();
            }
        } catch (error) {
            console.error('[版本更新] 初始化失败:', error);
        }
    }

    /**
     * 获取当前插件版本号
     * 从 plugin.json 中读取版本号
     */
    async getCurrentVersion() {
        try {
            // 尝试从 plugin.json 读取版本号
            const response = await fetch('plugin.json');
            const pluginConfig = await response.json();

            // UTools plugin.json 可能使用 version 字段
            // 如果没有 version 字段，使用默认版本号
            return pluginConfig.version || '1.0.0';
        } catch (error) {
            console.warn('[版本更新] 无法读取 plugin.json，使用默认版本号:', error);
            return '1.0.0';
        }
    }

    /**
     * 从存储中获取上次查看的版本号
     */
    getLastViewedVersion() {
        try {
            if (window.ocrAPI && window.ocrAPI.db) {
                const data = window.ocrAPI.db.get(this.storageKey);
                return data?.version || null;
            }
        } catch (error) {
            console.warn('[版本更新] 获取上次查看版本失败:', error);
        }
        return null;
    }

    /**
     * 保存当前版本号到存储
     */
    saveCurrentVersion() {
        try {
            if (window.ocrAPI && window.ocrAPI.db) {
                const dataToSave = {
                    _id: this.storageKey,
                    version: this.currentVersion,
                    timestamp: Date.now()
                };

                // 检查是否已存在，保留 _rev
                const existing = window.ocrAPI.db.get(this.storageKey);
                if (existing && existing._rev) {
                    dataToSave._rev = existing._rev;
                }

                window.ocrAPI.db.put(dataToSave);
                console.log('[版本更新] 已保存当前版本:', this.currentVersion);
            }
        } catch (error) {
            console.error('[版本更新] 保存版本号失败:', error);
        }
    }

    /**
     * 判断是否需要显示更新提示
     */
    shouldShowUpdateNotification() {
        // 如果没有上次查看的版本记录
        if (!this.lastViewedVersion) {
            // 检查是否是真正的新用户（通过检查是否有配置数据来判断）
            const isNewUser = this.checkIfNewUser();

            if (isNewUser) {
                // 真正的新用户，不显示更新提示，直接保存当前版本
                this.saveCurrentVersion();
                return false;
            } else {
                // 老用户首次使用版本更新功能，显示更新提示
                return true;
            }
        }

        // 比较版本号
        return this.compareVersions(this.currentVersion, this.lastViewedVersion) > 0;
    }

    /**
     * 检查是否是新用户
     * 通过检查是否存在配置数据来判断
     */
    checkIfNewUser() {
        try {
            if (window.ocrAPI && window.ocrAPI.db) {
                // 检查是否存在配置数据
                const config = window.ocrAPI.db.get('ocr-config');
                // 如果没有配置数据，说明是新用户
                return !config;
            }
        } catch (error) {
            console.warn('[版本更新] 检查新用户状态失败:', error);
        }
        // 默认认为是新用户（保守策略）
        return true;
    }

    /**
     * 比较两个版本号
     * @param {string} v1 - 版本号1
     * @param {string} v2 - 版本号2
     * @returns {number} - 1: v1 > v2, 0: v1 = v2, -1: v1 < v2
     */
    compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const num1 = parts1[i] || 0;
            const num2 = parts2[i] || 0;

            if (num1 > num2) return 1;
            if (num1 < num2) return -1;
        }

        return 0;
    }

    /**
     * 显示更新提示弹窗
     */
    showUpdateNotification() {
        const updateLog = this.getUpdateLog(this.currentVersion);

        // 创建弹窗 HTML
        const modalHTML = `
            <div class="modal-overlay" id="update-notification-modal">
                <div class="update-modal-content">
                    <div class="modal-header">
                        <h3>🎉 OCR Pro 已更新至 v${this.currentVersion}</h3>
                        <button class="modal-close" id="update-modal-close">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    <div class="modal-body">
                        ${updateLog}
                    </div>
                    <div class="modal-footer">
                        <div class="update-modal-rating-hint">
                            觉得好用的话，麻烦给个五星✨支持一下吧，感谢🙏
                        </div>
                        <button class="modal-btn modal-btn-primary" id="update-modal-confirm">我知道了</button>
                    </div>
                </div>
            </div>
        `;

        // 插入到页面
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // 绑定事件
        this.bindModalEvents();
    }

    /**
     * 绑定弹窗事件
     */
    bindModalEvents() {
        const modal = document.getElementById('update-notification-modal');
        const closeBtn = document.getElementById('update-modal-close');
        const confirmBtn = document.getElementById('update-modal-confirm');

        if (!modal) return;

        // 关闭按钮
        const closeModal = () => {
            modal.remove();
            this.saveCurrentVersion();
        };

        closeBtn?.addEventListener('click', closeModal);
        confirmBtn?.addEventListener('click', closeModal);

        // 点击遮罩层关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal();
            }
        });

        // ESC 键关闭
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    /**
     * 获取指定版本的更新日志
     * @param {string} version - 版本号
     * @returns {string} - 更新日志 HTML
     */
    getUpdateLog(version) {
        // 版本更新日志配置
        const updateLogs = {
            '1.0.0': `
                <div class="update-section">
                    <h4>🎊 欢迎使用 OCR Pro</h4>
                    <ul class="update-list">
                        <li><strong>多平台 OCR 服务</strong>：支持百度、腾讯、阿里云、火山引擎等传统 OCR 服务</li>
                        <li><strong>AI 大模型集成</strong>：支持 OpenAI GPT、Anthropic Claude、Google Gemini、阿里云百炼、智谱 AI、uTools AI 等</li>
                        <li><strong>OCR Pro 免费额度</strong>：每日 20 次免费 OCR 识别和 10 次免费翻译</li>
                        <li><strong>智能识别模式</strong>：文字识别、表格识别、公式识别、Markdown 识别</li>
                        <li><strong>强大翻译功能</strong>：支持百度翻译、腾讯翻译、DeepLX、有道翻译及 AI 模型翻译</li>
                        <li><strong>图片翻译</strong>：支持图片内文字的原位翻译</li>
                        <li><strong>历史记录</strong>：自动保存识别和翻译历史，方便查看和管理</li>
                        <li><strong>二维码识别</strong>：支持识别图片中的二维码内容</li>
                        <li><strong>自定义提示词</strong>：为不同识别模式配置专属提示词</li>
                        <li><strong>流式输出</strong>：AI 模型支持流式输出，实时显示识别结果</li>
                    </ul>
                </div>
            `,
            '1.8.0': `
                <div class="update-section">
                    <h4>⚠️ 重要提示</h4>
                    <ul class="update-list">
                        <li><strong>OCR Pro 免费模型更新：</strong>Gemini 2.5 Flash-Lite Preview 06-17 已失效，请先移除该模型，然后点击"获取"按钮获取最新可用模型（建议使用 lite 模型）</li>
                    </ul>
                </div>
                <div class="update-section">
                    <h4>✨ 新增功能</h4>
                    <ul class="update-list">
                        <li><strong>二维码识别：</strong>支持本地二维码识别，默认开启，可在"可选配置"中关闭</li>
                        <li><strong>自定义模型服务商：</strong>支持添加自定义模型服务商</li>
                        <li><strong>模型能力自定义：</strong>支持自定义模型能力标签和名称（需具有视觉标签才能进入 OCR 列表）</li>
                        <li><strong>API 地址显示：</strong>实时显示完整 API URL 请求地址</li>
                        <li><strong>窗口高度设置：</strong>支持自定义窗口高度（默认 600px）</li>
                        <li><strong>双击右键复制：</strong>双击右键快速触发复制功能</li>
                    </ul>
                </div>
                <div class="update-section">
                    <h4>🐛 问题修复</h4>
                    <ul class="update-list">
                        <li>修复表格识别和公式识别模式下操作按钮背景丢失的问题</li>
                        <li>修复 OCR Pro 模型可用性状态无法持久化存储的问题</li>
                        <li>修复 OCR 页面点击翻译后无法自动翻译的问题</li>
                    </ul>
                </div>
                <div class="update-section">
                    <h4>🔧 优化改进</h4>
                    <ul class="update-list">
                        <li>优化页面布局和 UI 交互显示</li>
                        <li>优化识别模式和去除换行符的切换逻辑，取消持久化存储</li>
                        <li>优化 Markdown、表格、公式的渲染效果</li>
                        <li>优化按钮自动隐藏逻辑</li>
                        <li>优化图片预览放大的灵敏度</li>
                        <li>优化翻译模型显示，固定在结果区域不再自动消失</li>
                        <li>优化气泡通知的透明度，提高可读性</li>
                        <li>优化模型服务商模型列表的获取逻辑</li>
                        <li>优化历史记录列表，改为滑动页面</li>
                        <li>移除主题切换时的系统通知</li>
                    </ul>
                </div>
            `,
            '1.8.2': `
                <div class="update-section">
                    <h4>✨ 新增功能</h4>
                    <ul class="update-list">
                        <li><strong>小窗翻译：</strong>请为该指令设置快捷键触发，支持小窗口快速翻译功能</li>
                        <li><strong>鼠标书写 LaTeX 公式：</strong>支持鼠标手写 LaTeX 公式并识别</li>
                        <li><strong>本地 OCR 识别：</strong>支持使用系统原生 OCR 进行离线识别</li>
                        <li><strong>"百度翻译开放平台"：</strong>新增百度翻译开放平台翻译服务</li>
                        <li><strong>"翻译复制的文本"功能指令：</strong>新增快捷指令，可直接翻译剪贴板中的文本</li>
                        <li><strong>图片翻译默认模型配置：</strong>支持在配置页面设置图片翻译的默认模型</li>
                        <li><strong>"立即自动翻译"模式：</strong>可在"可选配置-翻译页面"中开启</li>
                        <li><strong>新增自定义配置翻译提示词：</strong>支持配置翻译提示词</li>
                    </ul>
                </div>
                <div class="update-section">
                    <h4>🐛 问题修复</h4>
                    <ul class="update-list">
                        <li>修复通知异常弹出的问题</li>
                    </ul>
                </div>
                <div class="update-section">
                    <h4>🔧 优化改进</h4>
                    <ul class="update-list">
                        <li>优化图片翻译页面布局</li>
                        <li>优化多模型翻译调用逻辑</li>
                        <li>优化基础配置页面布局</li>
                        <li>优化识别模式缓存机制，切换回已识别过的识别模式时不再重新进行识别</li>
                    </ul>
                </div>
            `,
            // 可以在这里添加更多版本的更新日志
        };

        // 返回对应版本的更新日志，如果没有则返回默认内容
        return updateLogs[version] || `
            <div class="update-section">
                <h4>✨ 新版本更新</h4>
                <p>感谢您使用 OCR Pro！本次更新包含了性能优化和问题修复。</p>
            </div>
        `;
    }

    /**
     * 手动触发显示更新日志（用于设置页面的"查看更新日志"功能）
     */
    showUpdateLogManually() {
        this.showUpdateNotification();
    }
}

// 调试函数：在控制台输入 showUpdateLog() 可主动显示版本更新弹窗
window.showUpdateLog = function () {
    if (window.ocrPlugin && window.ocrPlugin.updateNotificationManager) {
        window.ocrPlugin.updateNotificationManager.showUpdateLogManually();
    } else {
        console.warn('[调试] 更新提示管理器未找到，尝试直接创建...');
        const manager = new UpdateNotificationManager();
        manager.getCurrentVersion().then(version => {
            manager.currentVersion = version;
            manager.showUpdateNotification();
        });
    }
};
