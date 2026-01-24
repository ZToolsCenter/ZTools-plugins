/**
 * 历史记录管理器
 * 负责管理OCR识别历史记录的存储、加载和显示
 * 优化版本：支持数据压缩、存储效率优化和向后兼容
 */
class HistoryManager {
    constructor() {
        this.histories = [];
        this.translateHistories = [];
        this.currentSelectedId = null;
        this.currentHistoryType = 'ocr'; // 'ocr' 或 'translate'
        this.updateMaxHistoryCount(); // 从配置中读取最大数量

        // 滚动加载相关属性
        this.loadedItemCount = 0; // 已加载的记录数量
        this.batchSize = 20; // 每批加载的记录数量
        this.isLoadingMore = false; // 是否正在加载更多
        this.hasMoreData = true; // 是否还有更多数据
        this.scrollThreshold = 100; // 距离底部多少像素时触发加载
        this.defaultItemHeight = 44; // 默认单项高度（用于初始计算）

        // 存储优化配置
        this.storageConfig = {
            // 历史记录存储键名
            ocrHistoryKey: 'ocr_histories',
            translateHistoryKey: 'translateHistory', // 保持兼容性，用于数据迁移
            // 分片存储配置
            shardedStorage: {
                enabled: true,
                // 索引文档键名
                indexKey: 'translateHistory_index',
                // 文本记录分片前缀
                textShardPrefix: 'translateHistory_text_',
                // 图片元数据分片前缀
                imageMetaShardPrefix: 'translateHistory_image_meta_',
                // 图片数据前缀
                imageDataPrefix: 'translateHistory_img_',
                // 每个分片的最大大小 (字节)
                maxShardSize: 800 * 1024, // 800KB，留200KB缓冲
                // 每个文本分片的最大记录数
                maxTextRecordsPerShard: 200,
                // 每个图片元数据分片的最大记录数
                maxImageMetaRecordsPerShard: 50
            },
            // 数据压缩配置
            enableCompression: true,
            // 预览文本最大长度
            previewMaxLength: 50,
            // 结果文本压缩阈值（超过此长度的文本将被压缩存储）
            compressionThreshold: 1000,
            // 清理策略配置
            cleanup: {
                // 启用增量清理（避免全量重建）
                incrementalCleanup: true,
                // 异步清理图片数据（避免阻塞主线程）
                asyncImageCleanup: true,
                // 异步清理延迟（毫秒）
                cleanupDelay: 100,
                // 批量清理大小
                batchSize: 10
            },
            // 存储格式版本（用于数据迁移）
            storageVersion: '3.0' // 升级到3.0支持分片存储
        };

        // 定义模式图标SVG
        this.modeIcons = {
            ocr: `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
                <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
                <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
                <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
                <path d="M7 8h8"/>
                <path d="M7 12h10"/>
                <path d="M7 16h6"/>
            </svg>`,
            translate: `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m5 8 6 6"/>
                <path d="m4 14 6-6 2-3"/>
                <path d="M2 5h12"/>
                <path d="M7 2h1"/>
                <path d="m22 22-5-10-5 10"/>
                <path d="M14 18h6"/>
            </svg>`,
            select: `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 12l2 2 4-4"/>
                <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c2.39 0 4.56.94 6.16 2.46"/>
            </svg>`
        };

        this.init();
    }

    init() {
        // 首先进行数据迁移，清理旧的UI管理器存储的翻译记录
        this.migrateFromUIManagerStorage();

        // 初始化分片存储索引
        this.initShardedStorage();

        this.loadHistories();
        this.loadTranslateHistories();
        this.bindEvents();
        // 绑定分页事件
        this.bindPaginationEvents();
        // 绑定窗口大小变化事件
        this.bindResizeEvents();
        // 初始化时更新记录数量显示
        this.updateHistoryCount();

        // 初始化后进行数据完整性检查和存储优化
        setTimeout(() => {
            this.validateDataIntegrity();

            // 检查是否需要存储优化
            const stats = this.getStorageStats();
            if (stats.limits.isNearLimit) {
                this.performStorageOptimization();
            }
        }, 1000);

        // 延迟初始化滑块，确保DOM完全准备好
        setTimeout(() => {
            this.updateHistoryTypeSlider(true);
        }, 50);
    }

    // 绑定事件
    bindEvents() {
        // 历史记录页面的导航按钮
        document.getElementById('history-back-btn')?.addEventListener('click', () => {
            window.ocrPlugin.uiManager.showMainView();
        });

        document.getElementById('history-model-service-btn')?.addEventListener('click', () => {
            window.ocrPlugin.uiManager.showConfigView();
        });

        // 主题切换按钮事件已在ui.js中绑定，这里不需要重复绑定
        // document.getElementById('history-theme-toggle-btn')?.addEventListener('click', () => {
        //     window.ocrPlugin.uiManager.toggleTheme();
        // });

        document.getElementById('history-base-config-btn')?.addEventListener('click', () => {
            window.ocrPlugin.uiManager.showConfigView('base-config');
        });

        document.getElementById('history-history-btn')?.addEventListener('click', () => {
            window.ocrPlugin.uiManager.showHistoryView();
        });

        // 复制按钮
        document.getElementById('copy-btn-history')?.addEventListener('click', () => {
            this.copyHistoryResult();
        });

        // 翻译历史记录复制按钮
        document.getElementById('copy-btn-translate-source')?.addEventListener('click', () => {
            this.copyTranslateSourceResult();
        });

        document.getElementById('copy-btn-translate-target')?.addEventListener('click', () => {
            this.copyTranslateTargetResult();
        });

        // 历史记录类型切换按钮
        document.getElementById('history-ocr-btn')?.addEventListener('click', () => {
            this.switchHistoryType('ocr');
        });

        document.getElementById('history-translate-type-btn')?.addEventListener('click', () => {
            this.switchHistoryType('translate');
        });

        // 绑定滚动加载事件
        this.bindScrollLoadEvents();
    }

    // 绑定滚动加载事件
    bindScrollLoadEvents() {
        const historyList = document.getElementById('history-list');
        if (historyList) {
            historyList.addEventListener('scroll', (e) => {
                this.handleScroll(e);
            });
        }
    }

    // 处理滚动事件
    handleScroll(event) {
        if (this.isLoadingMore || !this.hasMoreData) {
            return;
        }

        const element = event.target;
        const { scrollTop, scrollHeight, clientHeight } = element;

        // 当滚动到距离底部小于阈值时，加载更多数据
        if (scrollTop + clientHeight >= scrollHeight - this.scrollThreshold) {
            this.loadMoreHistory();
        }
    }

    // 加载更多历史记录
    async loadMoreHistory() {
        if (this.isLoadingMore || !this.hasMoreData) {
            return;
        }

        this.isLoadingMore = true;
        this.showLoadingIndicator();

        try {
            // 模拟异步加载延迟，避免过度频繁的加载
            await new Promise(resolve => setTimeout(resolve, 300));

            const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;
            const start = this.loadedItemCount;
            const end = Math.min(start + this.batchSize, currentHistories.length);
            const newHistories = currentHistories.slice(start, end);

            if (newHistories.length > 0) {
                this.appendHistoryItems(newHistories);
                this.loadedItemCount = end;
            }

            // 检查是否还有更多数据
            this.hasMoreData = this.loadedItemCount < currentHistories.length;

        } catch (error) {
            console.error('加载更多历史记录失败:', error);
        } finally {
            this.isLoadingMore = false;
            this.hideLoadingIndicator();
        }
    }

    // 显示加载指示器
    showLoadingIndicator() {
        const loadingElement = document.getElementById('history-scroll-loading');
        if (loadingElement) {
            loadingElement.style.display = 'flex';
            setTimeout(() => {
                loadingElement.classList.add('visible');
            }, 10);
        }
    }

    // 隐藏加载指示器
    hideLoadingIndicator() {
        const loadingElement = document.getElementById('history-scroll-loading');
        if (loadingElement) {
            loadingElement.classList.remove('visible');
            setTimeout(() => {
                if (!this.isLoadingMore) {
                    loadingElement.style.display = 'none';
                }
            }, 300);
        }
    }

    // 追加历史记录项到列表
    appendHistoryItems(newHistories) {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;

        // 移除空状态提示（如果存在）
        const emptyElement = historyList.querySelector('.history-empty');
        if (emptyElement) {
            emptyElement.remove();
        }

        const historyItemsHTML = newHistories.map(history => {
            const timeStr = this.formatTime(history.timestamp);
            let preview = '';

            if (this.currentHistoryType === 'ocr') {
                preview = history.preview || this.generatePreview(history.result);
            } else {
                preview = history.preview || this.generatePreview(history.sourceText, 40);
            }

            // 关键修复：确保预览文本不会过长，防止HTML注入
            if (preview && preview.length > 50) {
                preview = preview.substring(0, 50) + '...';
            }

            // 关键修复：转义HTML特殊字符，防止布局破坏
            preview = preview.replace(/&/g, '&amp;')
                           .replace(/</g, '&lt;')
                           .replace(/>/g, '&gt;')
                           .replace(/"/g, '&quot;')
                           .replace(/'/g, '&#39;');

            const isActive = history.id === this.currentSelectedId ? 'active' : '';
            const confidenceClass = this.currentHistoryType === 'ocr' && history.confidence !== undefined
                ? `confidence-${this.getConfidenceLevel(history.confidence)}`
                : '';

            // 获取模型图标（确保向后兼容性）
            const modelIcon = (history.service) ? this.getModelIcon(history.service, history.model) : null;
            const modelIconHtml = modelIcon ? `<span class="history-model-icon">${modelIcon}</span>` : '';

            // 获取翻译类型图标（仅对翻译类别生效）
            const translateTypeIcon = (this.currentHistoryType === 'translate') ? this.getTranslateTypeIcon(history.type) : null;
            const translateTypeIconHtml = translateTypeIcon ? `<span class="history-translate-type-icon">${translateTypeIcon}</span>` : '';

            // 获取OCR识别类型图标（仅对OCR类别生效）
            const ocrTypeIcon = (this.currentHistoryType === 'ocr') ? this.getOCRTypeIcon(history.mode) : null;
            const ocrTypeIconHtml = ocrTypeIcon ? `<span class="history-ocr-type-icon">${ocrTypeIcon}</span>` : '';

            return `
                <div class="history-item ${isActive} ${confidenceClass}" data-id="${history.id}" data-type="${this.currentHistoryType}">
                    <div class="history-item-content">
                        <div class="history-preview">${preview}</div>
                        <div class="history-meta-line">
                            ${modelIconHtml}
                            ${translateTypeIconHtml}
                            ${ocrTypeIconHtml}
                            <span class="history-time">${timeStr}</span>
                        </div>
                    </div>
                    <button class="history-delete-btn" data-id="${history.id}" title="删除记录">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M18 6L6 18"/>
                            <path d="M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            `;
        }).join('');

        // 创建临时容器并添加到列表
        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = historyItemsHTML;

        while (tempContainer.firstChild) {
            historyList.appendChild(tempContainer.firstChild);
        }

        // 为新添加的项绑定事件
        this.bindHistoryItemEvents();
    }

    // 为历史记录项绑定事件
    bindHistoryItemEvents() {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;

        // 绑定点击事件
        historyList.querySelectorAll('.history-item:not(.event-bound)').forEach(item => {
            item.classList.add('event-bound');

            item.addEventListener('click', (e) => {
                // 如果点击的是删除按钮，不触发选择事件
                if (e.target.closest('.history-delete-btn')) {
                    return;
                }
                this.selectHistory(item.dataset.id, item.dataset.type);
            });
        });

        // 绑定删除按钮事件
        historyList.querySelectorAll('.history-delete-btn:not(.delete-event-bound)').forEach(btn => {
            btn.classList.add('delete-event-bound');

            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                const historyId = btn.dataset.id;
                this.deleteHistory(historyId);
            });
        });
    }

    // 重置滚动加载状态
    resetScrollLoad() {
        this.loadedItemCount = 0;
        this.isLoadingMore = false;
        this.hasMoreData = true;
        this.hideLoadingIndicator();
    }

    // 从配置中更新最大历史记录数量
    updateMaxHistoryCount() {
        if (window.ocrPlugin && window.ocrPlugin.config) {
            const uiConfig = window.ocrPlugin.config.ui || {};
            this.maxHistoryCount = uiConfig.historyMaxCount || 100; // 默认为100
        } else {
            this.maxHistoryCount = 100; // 默认值
        }
    }

    // 添加新的历史记录
    addHistory(imageData, result, service, model, mode = '文字') {
        // 更新最大历史记录数量配置
        this.updateMaxHistoryCount();

        // 创建优化的历史记录对象
        const history = this.createOptimizedHistoryRecord({
            id: Date.now().toString(),
            timestamp: new Date(),
            service: service,
            model: model,
            mode: mode,
            result: result
        });

        this.histories.unshift(history); // 添加到开头

        // 限制历史记录数量（保持现有逻辑）
        if (this.histories.length > this.maxHistoryCount) {
            this.histories = this.histories.slice(0, this.maxHistoryCount);
        }

        this.saveHistories();

        // 如果当前在历史记录页面，重置滚动状态并刷新列表
        if (window.ocrPlugin.uiManager.currentView === 'history') {
            // 如果当前是OCR类型，重置滚动加载状态以显示最新记录
            if (this.currentHistoryType === 'ocr') {
                this.resetScrollLoad();
            }
            this.loadHistoryList();
        }
    }

    // 创建优化的历史记录对象
    createOptimizedHistoryRecord(data) {
        const { id, timestamp, service, model, mode, result } = data;

        // 基础记录结构
        const record = {
            id,
            timestamp,
            service,
            model,
            mode,
            // 存储格式版本标识
            _v: this.storageConfig.storageVersion
        };

        // 处理结果文本的存储
        if (result) {
            // 如果文本较长且启用压缩，进行压缩存储
            if (this.storageConfig.enableCompression &&
                result.length > this.storageConfig.compressionThreshold) {
                record.result = this.compressText(result);
                record._compressed = true;
            } else {
                record.result = result;
            }
        }

        // 生成预览文本
        record.preview = this.generatePreview(result, this.storageConfig.previewMaxLength);

        return record;
    }

    // 生成预览文本
    generatePreview(text, maxLength = 50) {
        if (!text) return '无内容';
        // 清理文本：移除多余的空白字符和换行符
        const cleanText = text.replace(/\s+/g, ' ').trim();
        return cleanText.length > maxLength ? cleanText.substring(0, maxLength) + '...' : cleanText;
    }

    // 文本压缩方法（简单的重复字符压缩）
    compressText(text) {
        if (!text || typeof text !== 'string') return text;

        try {
            // 简单的压缩策略：
            // 1. 压缩连续的空白字符
            // 2. 移除不必要的换行符
            // 3. 保留文本的基本结构
            let compressed = text
                .replace(/[ \t]+/g, ' ')  // 多个空格/制表符压缩为单个空格
                .replace(/\n\s*\n/g, '\n') // 多个连续换行压缩为单个换行
                .trim();

            // 如果压缩后仍然很长，进一步处理
            if (compressed.length > this.storageConfig.compressionThreshold * 2) {
                // 对于极长的文本，保留开头和结尾部分
                const keepLength = this.storageConfig.compressionThreshold;
                const halfKeep = Math.floor(keepLength / 2);
                compressed = compressed.substring(0, halfKeep) +
                           '\n...[内容已压缩]...\n' +
                           compressed.substring(compressed.length - halfKeep);
            }

            return compressed;
        } catch (error) {
            return text;
        }
    }

    // 文本解压缩方法
    decompressText(compressedText) {
        // 当前的压缩方法是可逆的，直接返回
        return compressedText;
    }

    // 统一的存储读取方法
    getStorageItem(key) {
        try {
            // 优先使用uTools的dbStorage，如果不可用则回退到localStorage
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.getItem) {
                return utools.dbStorage.getItem(key);
            } else {
                return localStorage.getItem(key);
            }
        } catch (error) {
            console.warn(`读取存储项 ${key} 失败:`, error);
            return null;
        }
    }

    // 统一的存储写入方法
    setStorageItem(key, value) {
        try {
            // 优先使用uTools的dbStorage，如果不可用则回退到localStorage
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem) {
                utools.dbStorage.setItem(key, value);
                return true;
            } else {
                localStorage.setItem(key, value);
                return true;
            }
        } catch (error) {
            console.warn(`写入存储项 ${key} 失败:`, error);
            return false;
        }
    }

    // 从存储加载历史记录
    loadHistories() {
        try {
            const stored = this.getStorageItem(this.storageConfig.ocrHistoryKey);
            if (stored) {
                // uTools的dbStorage可能直接返回对象，localStorage返回字符串
                const data = typeof stored === 'string' ? JSON.parse(stored) : stored;
                let rawHistories = Array.isArray(data) ? data : [];

                // 数据迁移和兼容性处理
                const { migratedHistories, needsSave } = this.migrateHistoryData(rawHistories);
                this.histories = migratedHistories;

                // 如果数据被迁移，重新保存
                if (needsSave) {
                    this.saveHistories();
                }

                // 应用数量限制（确保不超过配置的最大数量）
                this.updateMaxHistoryCount();
                if (this.histories.length > this.maxHistoryCount) {
                    this.histories = this.histories.slice(0, this.maxHistoryCount);
                    this.saveHistories();
                }


            }
        } catch (error) {
            console.error('加载历史记录失败:', error);
            this.histories = [];
        }
    }

    // 历史记录数据迁移和兼容性处理
    migrateHistoryData(rawHistories) {
        let needsSave = false;
        const migratedHistories = rawHistories.map(history => {
            let migrated = { ...history };
            let recordChanged = false;

            // 转换时间戳为Date对象
            if (typeof migrated.timestamp === 'string') {
                migrated.timestamp = new Date(migrated.timestamp);
                recordChanged = true;
            }

            // 移除imageData字段（向后兼容）
            if (migrated.imageData) {
                delete migrated.imageData;
                recordChanged = true;
            }

            // 检查是否为旧格式记录（没有版本标识）
            if (!migrated._v) {
                // 为旧记录添加版本标识
                migrated._v = this.storageConfig.storageVersion;
                recordChanged = true;

                // 如果没有预览文本，生成预览
                if (!migrated.preview && migrated.result) {
                    migrated.preview = this.generatePreview(migrated.result, this.storageConfig.previewMaxLength);
                    recordChanged = true;
                }

                // 检查是否需要压缩长文本
                if (this.storageConfig.enableCompression &&
                    migrated.result &&
                    migrated.result.length > this.storageConfig.compressionThreshold &&
                    !migrated._compressed) {
                    migrated.result = this.compressText(migrated.result);
                    migrated._compressed = true;
                    recordChanged = true;
                }
            }

            if (recordChanged) {
                needsSave = true;
            }

            return migrated;
        });

        return { migratedHistories, needsSave };
    }

    // 保存历史记录到存储
    saveHistories() {
        try {
            // 准备存储数据
            const optimizedData = this.prepareDataForStorage(this.histories);

            // uTools的dbStorage可以直接存储数组，localStorage需要JSON序列化
            const isUToolsStorage = typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem;
            const dataToStore = isUToolsStorage ? optimizedData : JSON.stringify(optimizedData);

            // 计算数据大小用于监控
            const dataSize = JSON.stringify(optimizedData).length;

            // 检查是否接近uTools 1MB限制
            if (dataSize > 800 * 1024) { // 800KB警告阈值
                // 尝试进一步优化数据
                const furtherOptimized = this.emergencyOptimizeData(optimizedData);
                const finalDataToStore = isUToolsStorage ? furtherOptimized : JSON.stringify(furtherOptimized);

                this.setStorageItem(this.storageConfig.ocrHistoryKey, finalDataToStore);
                return;
            }

            // 尝试保存，如果失败则尝试紧急优化
            const success = this.setStorageItem(this.storageConfig.ocrHistoryKey, dataToStore);
            if (!success) {
                // 尝试紧急优化
                const emergencyData = this.emergencyOptimizeData(optimizedData);
                const emergencyDataToStore = isUToolsStorage ? emergencyData : JSON.stringify(emergencyData);
                this.setStorageItem(this.storageConfig.ocrHistoryKey, emergencyDataToStore);
            }
        } catch (error) {
            console.error('保存历史记录失败:', error);
        }
    }

    // 为存储准备优化的数据
    prepareDataForStorage(histories) {
        return histories.map(history => {
            // 创建存储副本，移除不必要的字段
            const storageRecord = {
                id: history.id,
                timestamp: history.timestamp,
                service: history.service,
                model: history.model,
                mode: history.mode,
                result: history.result,
                preview: history.preview,
                _v: history._v || this.storageConfig.storageVersion
            };

            // 如果记录被压缩，保留压缩标识
            if (history._compressed) {
                storageRecord._compressed = true;
            }

            return storageRecord;
        });
    }

    // 紧急数据优化（当接近存储限制时）
    emergencyOptimizeData(data) {
        return data.map(record => {
            const optimized = { ...record };

            // 进一步压缩长文本
            if (optimized.result && optimized.result.length > 500) {
                optimized.result = this.compressText(optimized.result);
                optimized._compressed = true;
            }

            // 缩短预览文本
            if (optimized.preview && optimized.preview.length > 30) {
                optimized.preview = optimized.preview.substring(0, 30) + '...';
            }

            return optimized;
        }).slice(0, Math.floor(this.maxHistoryCount * 0.8)); // 保留80%的记录
    }

    // 从存储加载翻译历史记录
    loadTranslateHistories() {
        try {
            // 如果启用了分片存储，从分片加载
            if (this.storageConfig.shardedStorage.enabled && this.shardIndex) {
                this.translateHistories = this.loadTranslateHistoriesFromShards();

                // 应用数量限制
                this.updateMaxHistoryCount();
                if (this.translateHistories.length > this.maxHistoryCount) {
                    this.enforceTranslateHistoryLimit();
                    // 重新保存截断后的数据
                    this.saveTranslateHistories();
                }
                return;
            }

            // 传统存储方式（向后兼容）
            const stored = this.getStorageItem(this.storageConfig.translateHistoryKey);
            if (stored) {
                // uTools的dbStorage可能直接返回对象，localStorage返回字符串
                const data = typeof stored === 'string' ? JSON.parse(stored) : stored;
                let rawHistories = Array.isArray(data) ? data : [];

                // 数据迁移和兼容性处理
                const { migratedHistories, needsSave } = this.migrateTranslateHistoryData(rawHistories);
                this.translateHistories = migratedHistories;

                // 如果数据被迁移，重新保存
                if (needsSave) {
                    this.saveTranslateHistories();
                }

                // 应用数量限制，确保不超过配置的最大数量
                this.updateMaxHistoryCount();
                if (this.translateHistories.length > this.maxHistoryCount) {
                    this.enforceTranslateHistoryLimit();
                    this.saveTranslateHistories();
                }
            } else {
                this.translateHistories = [];
            }
        } catch (error) {
            console.error('加载翻译历史记录失败:', error);
            this.translateHistories = [];
        }
    }

    // 翻译历史记录数据迁移和兼容性处理
    migrateTranslateHistoryData(rawHistories) {
        let needsSave = false;
        const migratedHistories = rawHistories.map(history => {
            let migrated = { ...history };
            let recordChanged = false;

            // 转换时间戳为Date对象
            if (typeof migrated.timestamp === 'string') {
                migrated.timestamp = new Date(migrated.timestamp);
                recordChanged = true;
            } else if (migrated.createdAt && typeof migrated.createdAt === 'number') {
                // 兼容旧格式
                migrated.timestamp = new Date(migrated.createdAt);
                delete migrated.createdAt;
                recordChanged = true;
            }

            // 检查是否为旧格式记录（没有版本标识）
            if (!migrated._v) {
                migrated._v = this.storageConfig.storageVersion;
                recordChanged = true;

                // 优化长文本存储
                if (this.storageConfig.enableCompression) {
                    if (migrated.sourceText && migrated.sourceText.length > this.storageConfig.compressionThreshold) {
                        migrated.sourceText = this.compressText(migrated.sourceText);
                        migrated._sourceCompressed = true;
                        recordChanged = true;
                    }
                    if (migrated.targetText && migrated.targetText.length > this.storageConfig.compressionThreshold) {
                        migrated.targetText = this.compressText(migrated.targetText);
                        migrated._targetCompressed = true;
                        recordChanged = true;
                    }
                }
            }

            if (recordChanged) {
                needsSave = true;
            }

            return migrated;
        });

        return { migratedHistories, needsSave };
    }

    // 保存翻译历史记录到存储
    saveTranslateHistories() {
        try {
            // 如果启用了分片存储，使用分片保存
            if (this.storageConfig.shardedStorage.enabled && this.shardIndex) {
                return this.saveTranslateHistoriesToShards();
            }

            // 传统存储方式（向后兼容）
            // 准备存储数据
            const optimizedData = this.prepareTranslateDataForStorage(this.translateHistories);

            // uTools的dbStorage可以直接存储数组，localStorage需要JSON序列化
            const isUToolsStorage = typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem;
            const dataToStore = isUToolsStorage ? optimizedData : JSON.stringify(optimizedData);

            // 计算数据大小用于监控
            const dataSize = JSON.stringify(optimizedData).length;

            // 检查是否接近存储限制
            if (dataSize > 800 * 1024) { // 800KB警告阈值
                // 尝试进一步优化数据
                const furtherOptimized = this.emergencyOptimizeTranslateData(optimizedData);
                const finalDataToStore = isUToolsStorage ? furtherOptimized : JSON.stringify(furtherOptimized);

                this.setStorageItem(this.storageConfig.translateHistoryKey, finalDataToStore);
                return;
            }

            this.setStorageItem(this.storageConfig.translateHistoryKey, dataToStore);
        } catch (error) {
            console.error('保存翻译历史记录失败:', error);
        }
    }

    // 为存储准备优化的翻译数据
    prepareTranslateDataForStorage(histories) {
        return histories.map(history => {
            const storageRecord = {
                id: history.id,
                timestamp: history.timestamp,
                sourceText: history.sourceText,
                targetText: history.targetText,
                sourceLanguage: history.sourceLanguage,
                targetLanguage: history.targetLanguage,
                service: history.service,
                model: history.model,
                _v: history._v || this.storageConfig.storageVersion
            };

            // 保留压缩标识
            if (history._sourceCompressed) storageRecord._sourceCompressed = true;
            if (history._targetCompressed) storageRecord._targetCompressed = true;

            // 支持图片翻译记录的额外字段
            if (history.type === 'image') {
                storageRecord.type = 'image';
                storageRecord.originalImage = history.originalImage;
                storageRecord.translatedImage = history.translatedImage;
                storageRecord.pasteMode = history.pasteMode; // 0-文本模式, 1-图片模式
                storageRecord.preview = history.preview; // 预览文本
            }

            return storageRecord;
        });
    }

    // 紧急翻译数据优化
    emergencyOptimizeTranslateData(data) {
        return data.map(record => {
            const optimized = { ...record };

            // 进一步压缩文本
            if (optimized.sourceText && optimized.sourceText.length > 300) {
                optimized.sourceText = this.compressText(optimized.sourceText);
                optimized._sourceCompressed = true;
            }
            if (optimized.targetText && optimized.targetText.length > 300) {
                optimized.targetText = this.compressText(optimized.targetText);
                optimized._targetCompressed = true;
            }

            return optimized;
        }).slice(0, Math.floor(this.maxHistoryCount * 0.8)); // 保留80%的记录
    }

    // 加载历史记录列表到界面（使用滚动加载）
    loadHistoryList() {
        const historyList = document.getElementById('history-list');
        if (!historyList) return;

        // 重置滚动加载状态
        this.resetScrollLoad();

        // 更新记录数量显示
        this.updateHistoryCount();

        const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;

        if (currentHistories.length === 0) {
            const emptyText = this.currentHistoryType === 'ocr' ? '暂无识别记录' : '暂无翻译记录';
            const emptyHint = this.currentHistoryType === 'ocr' ? '完成OCR识别后记录将显示在这里' : '完成翻译后记录将显示在这里';
            const emptyIcon = this.modeIcons[this.currentHistoryType];

            historyList.innerHTML = `
                <div class="history-empty">
                    <div class="empty-icon">${emptyIcon}</div>
                    <div class="empty-text">${emptyText}</div>
                    <div class="empty-hint">${emptyHint}</div>
                </div>
            `;
            this.showEmptyDetail();
            return;
        }

        // 清空列表并加载第一批数据
        historyList.innerHTML = '';

        // 设置初始滚动位置到顶部
        historyList.scrollTop = 0;

        // 加载第一批数据
        const initialBatch = currentHistories.slice(0, this.batchSize);
        this.appendHistoryItems(initialBatch);
        this.loadedItemCount = initialBatch.length;
        this.hasMoreData = this.loadedItemCount < currentHistories.length;

        // 默认选择第一个记录
        if (initialBatch.length > 0) {
            this.selectHistory(initialBatch[0].id, this.currentHistoryType);
        }
    }

    // 格式化时间显示
    formatTime(date) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');

        return `${month}/${day} ${hours}:${minutes}`;
    }

    // 格式化模型显示（uTools使用友好名称，其他使用原始API名称）
    formatModel(service, model) {
        const serviceNames = {
            'baidu': '百度智能云',
            'tencent': '腾讯云',
            'aliyun': '阿里云',
            'volcano': '火山引擎',
            'deeplx': 'DeepLX',
            'youdao': '有道翻译',
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'google': 'Gemini',
            'alibaba': '阿里云百炼',
            'bytedance': '火山引擎',
            'zhipu': '智谱AI',
            'utools': 'uTools AI',
            'custom': '自定义平台'
        };

        // 对于AI模型，所有平台都使用友好名称
        if (model && ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'utools', 'ocrpro', 'custom'].includes(service)) {
            let displayName = model;
            try {
                // 获取主插件实例
                const ocrPlugin = window.ocrPlugin;
                if (ocrPlugin && ocrPlugin.config && ocrPlugin.config[service]) {
                    const platformConfig = ocrPlugin.config[service];
                    const modelNameMap = platformConfig.modelNameMap || {};
                    displayName = modelNameMap[model] || model;
                }
            } catch (error) {
                // 如果获取友好名称失败，使用原始模型名称
            }
            // 返回模型名称，不需要服务名称前缀（因为图标已经显示了服务商）
            return displayName;
        }

        // 对于传统OCR服务，返回服务名称
        return serviceNames[service] || service;
    }

    // 获取模型图标
    getModelIcon(service, model) {
        try {
            // 检查service是否有效
            if (!service || typeof service !== 'string') {
                return null;
            }

            // 获取主插件实例中的UI管理器
            const ocrPlugin = window.ocrPlugin;
            if (ocrPlugin && ocrPlugin.uiManager && ocrPlugin.uiManager.getServiceIcon) {
                return ocrPlugin.uiManager.getServiceIcon(service);
            }
        } catch (error) {
            console.warn('获取模型图标失败:', error);
        }
        return null;
    }

    // 获取翻译类型图标
    getTranslateTypeIcon(type) {
        // 翻译类型图标定义
        const translateTypeIcons = {
            'text': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m5 8 6 6"/>
                <path d="m4 14 6-6 2-3"/>
                <path d="M2 5h12"/>
                <path d="M7 2h1"/>
                <path d="m22 22-5-10-5 10"/>
                <path d="M14 18h6"/>
            </svg>`,
            'image': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
                <circle cx="9" cy="9" r="2"/>
                <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>`
        };

        // 如果没有指定类型，默认为文本翻译
        const translateType = type || 'text';
        return translateTypeIcons[translateType] || translateTypeIcons['text'];
    }

    // 获取OCR识别类型图标
    getOCRTypeIcon(mode) {
        // OCR识别类型图标定义（使用主页面底部导航栏的图标）
        const ocrTypeIcons = {
            'text': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 12h6"/>
                <path d="M15 6h6"/>
                <path d="m3 13 3.553-7.724a.5.5 0 0 1 .894 0L11 13"/>
                <path d="M3 18h18"/>
                <path d="M3.92 11h6.16"/>
            </svg>`,
            'table': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3v18"/>
                <rect width="18" height="18" x="3" y="3" rx="2"/>
                <path d="M21 9H3"/>
                <path d="M21 15H3"/>
            </svg>`,
            'formula': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 20h4.5a.5.5 0 0 0 .5-.5v-.282a.52.52 0 0 0-.247-.437 8 8 0 1 1 8.494-.001.52.52 0 0 0-.247.438v.282a.5.5 0 0 0 .5.5H21"/>
            </svg>`,
            'markdown': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2"/>
                <g transform="rotate(90 12 12)"><path d="M16 8.9V7H8l4 5-4 5h8v-1.9"/></g>
            </svg>`,
            'qrcode': `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="5" height="5" x="3" y="3" rx="1"/>
                <rect width="5" height="5" x="16" y="3" rx="1"/>
                <rect width="5" height="5" x="3" y="16" rx="1"/>
                <path d="M21 16h-3a2 2 0 0 0-2 2v3"/>
                <path d="M21 21v.01"/>
                <path d="M12 7v3a2 2 0 0 1-2 2H7"/>
                <path d="M3 12h.01"/>
                <path d="M12 3h.01"/>
                <path d="M12 16v.01"/>
                <path d="M16 12h1"/>
                <path d="M21 12v.01"/>
                <path d="M12 21v-1"/>
            </svg>`
        };

        // 将显示名称映射回模式代码
        const modeMapping = {
            '文字': 'text',
            '表格': 'table',
            '公式': 'formula',
            'MD': 'markdown',
            '二维码': 'qrcode'
        };

        // 获取实际的模式代码
        const actualMode = modeMapping[mode] || mode || 'text';
        return ocrTypeIcons[actualMode] || ocrTypeIcons['text'];
    }



    // 选择历史记录
    selectHistory(id, type = null) {
        // 更新选中状态
        document.querySelectorAll('.history-item').forEach(item => {
            item.classList.remove('active');
        });

        const selectedItem = document.querySelector(`[data-id="${id}"]`);
        if (selectedItem) {
            selectedItem.classList.add('active');
        }

        this.currentSelectedId = id;
        this.showHistoryDetail(id, type || this.currentHistoryType);
    }

    // 显示历史记录详情
    showHistoryDetail(id, type = 'ocr') {
        const histories = type === 'ocr' ? this.histories : this.translateHistories;
        const history = histories.find(h => h.id === id);
        if (!history) {
            this.showEmptyDetail();
            return;
        }

        const detailEmpty = document.getElementById('history-detail-empty');
        const resultText = document.getElementById('history-result-text');
        const copyBtn = document.getElementById('copy-btn-history');

        const ocrResultArea = document.getElementById('ocr-result-area');
        const translateResultArea = document.getElementById('translate-result-area');

        if (detailEmpty) detailEmpty.style.display = 'none';

        // 隐藏所有结果区域
        if (ocrResultArea) ocrResultArea.style.display = 'none';
        if (translateResultArea) translateResultArea.style.display = 'none';

        // 隐藏图片容器
        const sourceImageContainer = document.getElementById('history-source-image-container');
        const targetImageContainer = document.getElementById('history-target-image-container');
        if (sourceImageContainer) sourceImageContainer.style.display = 'none';
        if (targetImageContainer) targetImageContainer.style.display = 'none';

        if (type === 'ocr') {
            // 显示OCR结果
            if (ocrResultArea) ocrResultArea.style.display = 'flex'; // 改为flex以正确布局
            if (resultText) {
                // 解压缩文本（如果需要）
                const displayText = this.getDisplayText(history.result, history._compressed);
                resultText.value = displayText || '';
            }
            if (copyBtn) {
                copyBtn.style.display = 'flex';
            }
        } else {
            // 显示翻译结果
            // 检查是否为图片翻译记录
            if (history.type === 'image') {
                this.showImageTranslateHistory(history);
            } else {
                // 显示普通文本翻译结果
                if (translateResultArea) translateResultArea.style.display = 'flex'; // 改为flex以正确布局

                const sourceText = document.getElementById('history-translate-source-text');
                const targetText = document.getElementById('history-translate-target-text');
                const translateSourceCopyBtn = document.getElementById('copy-btn-translate-source');
                const translateTargetCopyBtn = document.getElementById('copy-btn-translate-target');

                // 隐藏图片容器，显示文本框
                const sourceImageContainer = document.getElementById('history-source-image-container');
                const targetImageContainer = document.getElementById('history-target-image-container');
                if (sourceImageContainer) sourceImageContainer.style.display = 'none';
                if (targetImageContainer) targetImageContainer.style.display = 'none';

                if (sourceText) {
                    sourceText.style.display = 'block';
                    const displaySourceText = this.getDisplayText(history.sourceText, history._sourceCompressed);
                    sourceText.value = displaySourceText || '';
                }
                if (targetText) {
                    targetText.style.display = 'block';
                    const displayTargetText = this.getDisplayText(history.targetText, history._targetCompressed);
                    targetText.value = displayTargetText || '';
                }
                if (translateSourceCopyBtn) translateSourceCopyBtn.style.display = 'flex';
                if (translateTargetCopyBtn) translateTargetCopyBtn.style.display = 'flex';
                if (copyBtn) copyBtn.style.display = 'none';
            }
        }
    }

    // 显示图片翻译历史记录
    showImageTranslateHistory(history) {
        // 如果启用了分片存储且图片数据未加载，先加载图片数据
        if (this.storageConfig.shardedStorage.enabled && !history._imageDataLoaded) {
            history = this.loadImageDataForRecord(history);
        }

        // 显示翻译结果区域，复用普通翻译的样式
        const translateResultArea = document.getElementById('translate-result-area');
        if (translateResultArea) translateResultArea.style.display = 'flex';

        // 获取翻译结果的文本框
        const sourceText = document.getElementById('history-translate-source-text');
        const targetText = document.getElementById('history-translate-target-text');

        // 在源文本区域显示原始图片
        if (sourceText && history.originalImage) {
            // 创建图片元素替换文本框内容
            sourceText.style.display = 'none';
            let sourceImageContainer = document.getElementById('history-source-image-container');
            if (!sourceImageContainer) {
                sourceImageContainer = document.createElement('div');
                sourceImageContainer.id = 'history-source-image-container';
                sourceImageContainer.style.cssText = `
                    flex: 1;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 200px;
                    background: var(--area-result);
                    border: 1px solid var(--border-primary);
                    border-radius: 12px;
                    padding: 16px;
                    overflow: hidden;
                    font-family: var(--font-family);
                    font-size: var(--font-size-md);
                    line-height: var(--line-height-relaxed);
                    color: var(--text-primary);
                    resize: none;
                    scrollbar-width: none;
                    -ms-overflow-style: none;
                `;
                sourceText.parentNode.insertBefore(sourceImageContainer, sourceText);
            }

            sourceImageContainer.innerHTML = `
                <img src="${history.originalImage}" style="max-width: calc(100% - 32px); max-height: calc(400px - 32px); object-fit: contain; border-radius: 4px;" alt="原始图片" />
            `;

            // 添加WebKit滚动条隐藏样式
            const sourceStyle = document.createElement('style');
            sourceStyle.textContent = `
                #history-source-image-container::-webkit-scrollbar {
                    display: none;
                }
            `;
            if (!document.getElementById('source-image-container-style')) {
                sourceStyle.id = 'source-image-container-style';
                document.head.appendChild(sourceStyle);
            }
            sourceImageContainer.style.display = 'flex';
        }

        // 在目标文本区域显示翻译结果
        if (targetText) {
            if (history.pasteMode === 1 && history.translatedImage) {
                // 图片模式：显示翻译后的图片
                targetText.style.display = 'none';
                let targetImageContainer = document.getElementById('history-target-image-container');
                if (!targetImageContainer) {
                    targetImageContainer = document.createElement('div');
                    targetImageContainer.id = 'history-target-image-container';
                    targetImageContainer.style.cssText = `
                        flex: 1;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 200px;
                        background: var(--area-result);
                        border: 1px solid var(--border-primary);
                        border-radius: 12px;
                        padding: 16px;
                        overflow: hidden;
                        font-family: var(--font-family);
                        font-size: var(--font-size-md);
                        line-height: var(--line-height-relaxed);
                        color: var(--text-primary);
                        resize: none;
                        scrollbar-width: none;
                        -ms-overflow-style: none;
                    `;
                    targetText.parentNode.insertBefore(targetImageContainer, targetText);
                }

                targetImageContainer.innerHTML = `
                    <img src="${history.translatedImage}" style="max-width: calc(100% - 32px); max-height: calc(400px - 32px); object-fit: contain; border-radius: 4px;" alt="翻译后图片" />
                `;

                // 添加WebKit滚动条隐藏样式
                const targetStyle = document.createElement('style');
                targetStyle.textContent = `
                    #history-target-image-container::-webkit-scrollbar {
                        display: none;
                    }
                `;
                if (!document.getElementById('target-image-container-style')) {
                    targetStyle.id = 'target-image-container-style';
                    document.head.appendChild(targetStyle);
                }
                targetImageContainer.style.display = 'flex';
            } else {
                // 文本模式：显示翻译文本
                const displayText = this.getDisplayText(history.targetText, history._targetCompressed);
                targetText.value = displayText || '';
                targetText.style.display = 'block';

                // 隐藏图片容器
                const targetImageContainer = document.getElementById('history-target-image-container');
                if (targetImageContainer) {
                    targetImageContainer.style.display = 'none';
                }
            }
        }

        // 显示复制按钮（复用普通翻译的复制按钮）
        const translateSourceCopyBtn = document.getElementById('copy-btn-translate-source');
        const translateTargetCopyBtn = document.getElementById('copy-btn-translate-target');
        if (translateSourceCopyBtn) translateSourceCopyBtn.style.display = 'flex';
        if (translateTargetCopyBtn) translateTargetCopyBtn.style.display = 'flex';

        const copyBtn = document.getElementById('copy-btn-history');
        if (copyBtn) copyBtn.style.display = 'none';
    }

    // 获取用于显示的文本（处理压缩文本的解压缩）
    getDisplayText(text, isCompressed = false) {
        if (!text) return '';

        // 如果文本被压缩，进行解压缩
        if (isCompressed) {
            return this.decompressText(text);
        }

        return text;
    }



    // 显示提示消息
    showToast(message, type = 'info') {
        if (window.ocrPlugin && window.ocrPlugin.showToast) {
            window.ocrPlugin.showToast(message, type);
        }
    }

    // 显示空详情
    showEmptyDetail() {
        const detailEmpty = document.getElementById('history-detail-empty');
        const ocrResultArea = document.getElementById('ocr-result-area');
        const translateResultArea = document.getElementById('translate-result-area');

        if (detailEmpty) {
            detailEmpty.style.display = 'flex';
            // 根据当前历史记录类型和记录数量更新空状态内容
            this.updateEmptyDetailContent();
        }
        if (ocrResultArea) ocrResultArea.style.display = 'none';
        if (translateResultArea) translateResultArea.style.display = 'none';

        // 隐藏图片容器
        const sourceImageContainer = document.getElementById('history-source-image-container');
        const targetImageContainer = document.getElementById('history-target-image-container');
        if (sourceImageContainer) sourceImageContainer.style.display = 'none';
        if (targetImageContainer) targetImageContainer.style.display = 'none';

        // 隐藏所有复制按钮
        const copyBtn = document.getElementById('copy-btn-history');
        const translateSourceCopyBtn = document.getElementById('copy-btn-translate-source');
        const translateTargetCopyBtn = document.getElementById('copy-btn-translate-target');

        if (copyBtn) copyBtn.style.display = 'none';
        if (translateSourceCopyBtn) translateSourceCopyBtn.style.display = 'none';
        if (translateTargetCopyBtn) translateTargetCopyBtn.style.display = 'none';
    }

    // 更新空详情内容
    updateEmptyDetailContent() {
        const detailEmptyIcon = document.querySelector('.detail-empty-icon');
        const detailEmptyText = document.querySelector('.detail-empty-text');
        const detailEmptyHint = document.querySelector('.detail-empty-hint');

        if (!detailEmptyIcon || !detailEmptyText) return;

        const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;

        if (currentHistories.length === 0) {
            // 没有记录时的空状态
            if (this.currentHistoryType === 'ocr') {
                detailEmptyIcon.innerHTML = this.modeIcons.ocr;
                detailEmptyText.textContent = '暂无识别记录';
                if (detailEmptyHint) detailEmptyHint.textContent = '完成OCR识别后记录将显示在这里';
            } else {
                detailEmptyIcon.innerHTML = this.modeIcons.translate;
                detailEmptyText.textContent = '暂无翻译记录';
                if (detailEmptyHint) detailEmptyHint.textContent = '完成翻译后记录将显示在这里';
            }
        } else {
            // 有记录但未选中时的空状态
            detailEmptyIcon.innerHTML = this.modeIcons.select;
            detailEmptyText.textContent = '选择左侧记录查看详情';
            if (detailEmptyHint) detailEmptyHint.textContent = '记录详情将在此处显示';
        }
    }

    // 复制历史记录结果
    copyHistoryResult() {
        const resultText = document.getElementById('history-result-text');
        if (resultText && resultText.value) {
            const handleCopySuccess = () => {
                window.ocrPlugin.showToast('复制成功', 'success');

                // 检查是否启用复制后自动关闭插件
                const config = window.ocrPlugin.config;
                if (config?.ui?.autoClose === true) {
                    // 延迟一点时间让用户看到复制成功的提示
                    setTimeout(() => {
                        window.ocrAPI?.hideMainWindow?.();
                    }, 500);
                }
            };

            navigator.clipboard.writeText(resultText.value).then(() => {
                handleCopySuccess();
            }).catch(() => {
                // 降级方案
                resultText.select();
                document.execCommand('copy');
                handleCopySuccess();
            });
        }
    }

    // 复制翻译历史记录原文（智能复制：支持图片翻译记录）
    async copyTranslateSourceResult() {
        // 检查当前显示的历史记录类型
        const currentHistory = this.getCurrentDisplayedHistory();

        if (currentHistory && currentHistory.type === 'image') {
            // 图片翻译记录：复制原始图片
            await this.copyImageFromHistory(currentHistory.originalImage, '原图片复制成功');
        } else {
            // 普通翻译记录：复制原文文本
            const sourceText = document.getElementById('history-translate-source-text');
            if (sourceText && sourceText.value) {
                const handleCopySuccess = () => {
                    window.ocrPlugin.showToast('原文复制成功', 'success');

                    // 检查是否启用复制后自动关闭插件
                    const config = window.ocrPlugin.config;
                    if (config?.ui?.autoClose === true) {
                        // 延迟一点时间让用户看到复制成功的提示
                        setTimeout(() => {
                            window.ocrAPI?.hideMainWindow?.();
                        }, 500);
                    }
                };

                navigator.clipboard.writeText(sourceText.value).then(() => {
                    handleCopySuccess();
                }).catch(() => {
                    // 降级方案
                    sourceText.select();
                    document.execCommand('copy');
                    handleCopySuccess();
                });
            }
        }
    }

    // 复制翻译历史记录译文（智能复制：支持图片翻译记录）
    async copyTranslateTargetResult() {
        // 检查当前显示的历史记录类型
        const currentHistory = this.getCurrentDisplayedHistory();

        if (currentHistory && currentHistory.type === 'image') {
            // 图片翻译记录：根据pasteMode决定复制内容
            if (currentHistory.pasteMode === 0) {
                // 文本结果模式：复制翻译文本
                await this.copyTextFromHistory(currentHistory.targetText, '翻译文本复制成功');
            } else if (currentHistory.pasteMode === 1) {
                // 图片结果模式：复制翻译图片
                await this.copyImageFromHistory(currentHistory.translatedImage, '翻译图片复制成功');
            } else {
                // 默认复制文本
                await this.copyTextFromHistory(currentHistory.targetText, '翻译文本复制成功');
            }
        } else {
            // 普通翻译记录：复制译文文本
            const targetText = document.getElementById('history-translate-target-text');
            if (targetText && targetText.value) {
                const handleCopySuccess = () => {
                    window.ocrPlugin.showToast('译文复制成功', 'success');

                    // 检查是否启用复制后自动关闭插件
                    const config = window.ocrPlugin.config;
                    if (config?.ui?.autoClose === true) {
                        // 延迟一点时间让用户看到复制成功的提示
                        setTimeout(() => {
                            window.ocrAPI?.hideMainWindow?.();
                        }, 500);
                    }
                };

                navigator.clipboard.writeText(targetText.value).then(() => {
                    handleCopySuccess();
                }).catch(() => {
                    // 降级方案
                    targetText.select();
                    document.execCommand('copy');
                    handleCopySuccess();
                });
            }
        }
    }

    // 切换历史记录类型
    switchHistoryType(type) {
        if (this.currentHistoryType === type) return;

        this.currentHistoryType = type;
        this.currentSelectedId = null;

        // 重置滚动加载状态
        this.resetScrollLoad();

        // 更新按钮状态
        document.querySelectorAll('.history-type-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');

        // 更新滑块位置和大小
        this.updateHistoryTypeSlider();

        // 重新加载列表
        this.loadHistoryList();
    }

    // 更新历史记录类型滑块位置和大小
    updateHistoryTypeSlider(immediate = false) {
        try {
            // 确保历史记录页面是可见的
            if (window.ocrPlugin && window.ocrPlugin.uiManager &&
                window.ocrPlugin.uiManager.currentView !== 'history') {
                return;
            }

            const historyTypeSlider = document.querySelector('.history-type-slider');
            if (!historyTypeSlider) {
                // 如果滑块不存在，稍后重试
                if (immediate) {
                    setTimeout(() => this.updateHistoryTypeSlider(true), 100);
                }
                return;
            }

            const activeButton = document.querySelector('.history-type-btn.active');
            if (!activeButton) return;

            const buttonRect = activeButton.getBoundingClientRect();
            const containerRect = activeButton.parentElement.getBoundingClientRect();

            // 先设置滑块的位置和大小
            historyTypeSlider.style.width = `${buttonRect.width}px`;
            historyTypeSlider.style.left = `${buttonRect.left - containerRect.left}px`;

            // 然后显示滑块（确保位置已设置好）
            if (immediate) {
                // 初始化时：立即显示，无过渡
                historyTypeSlider.style.transition = 'none';
                historyTypeSlider.classList.add('ready');

                // 在下一帧启用过渡效果，为后续切换做准备
                requestAnimationFrame(() => {
                    historyTypeSlider.style.transition = 'left 0.2s ease, width 0.2s ease';
                });
            } else {
                // 切换时：有过渡效果
                if (!historyTypeSlider.classList.contains('ready')) {
                    historyTypeSlider.classList.add('ready');
                }
            }
        } catch (error) {
            console.error('更新历史记录类型滑块失败:', error);
        }
    }

    // 删除指定历史记录（不需要确认）
    deleteHistory(historyId) {
        if (this.currentHistoryType === 'ocr') {
            this.histories = this.histories.filter(h => h.id !== historyId);
            this.saveHistories();
        } else {
            this.translateHistories = this.translateHistories.filter(h => h.id !== historyId);
            this.saveTranslateHistories();
        }

        // 如果删除的是当前选中的记录，清空选中状态
        if (this.currentSelectedId === historyId) {
            this.currentSelectedId = null;
            this.showEmptyDetail();
        }

        // 重新计算分页，如果当前页没有数据了，回到上一页
        this.calculateTotalPages();
        if (this.currentPage > this.totalPages && this.totalPages > 0) {
            this.currentPage = this.totalPages;
        }

        this.loadHistoryList();
    }

    // 删除当前历史记录
    deleteCurrentHistory() {
        if (!this.currentSelectedId) return;

        if (confirm('确定要删除这条历史记录吗？')) {
            this.deleteHistory(this.currentSelectedId);
        }
    }

    // 清空所有历史记录
    clearAllHistories() {
        const typeText = this.currentHistoryType === 'ocr' ? 'OCR记录' : '翻译记录';
        if (confirm(`确定要清空所有${typeText}吗？此操作不可恢复。`)) {
            if (this.currentHistoryType === 'ocr') {
                this.histories = [];
                this.saveHistories();
            } else {
                this.translateHistories = [];
                this.saveTranslateHistories();
            }
            this.currentSelectedId = null;
            this.loadHistoryList();
            this.showEmptyDetail();
        }
    }



    // 获取历史记录统计
    getStatistics() {
        const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;

        if (this.currentHistoryType === 'ocr') {
            return {
                total: currentHistories.length,
                services: [...new Set(currentHistories.map(h => h.service))].length,
                lastWeek: currentHistories.filter(h =>
                    (new Date() - h.timestamp) < 7 * 24 * 60 * 60 * 1000
                ).length
            };
        } else {
            return {
                total: currentHistories.length,
                languages: [...new Set(currentHistories.map(h => h.targetLanguage))].length,
                lastWeek: currentHistories.filter(h =>
                    (new Date() - h.timestamp) < 7 * 24 * 60 * 60 * 1000
                ).length
            };
        }
    }

    // 更新历史记录数量显示
    updateHistoryCount() {
        const countText = document.getElementById('history-count-text');
        if (countText) {
            const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;
            const count = currentHistories.length;
            countText.textContent = `共 ${count} 条`;
        }
    }

    // 获取当前显示的历史记录
    getCurrentDisplayedHistory() {
        // 使用当前选中的ID直接查找历史记录
        if (!this.currentSelectedId) return null;

        // 在当前历史记录类型中查找
        const histories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;
        return histories.find(h => h.id === this.currentSelectedId);
    }

    // 复制图片（从历史记录）
    async copyImageFromHistory(imageBase64, successMessage = '图片复制成功') {
        if (!imageBase64) {
            window.ocrPlugin.showToast('没有可复制的图片', 'warning');
            return;
        }

        try {
            const blob = await this.base64ToBlob(imageBase64);
            const clipboardItem = new ClipboardItem({
                'image/png': blob
            });

            await navigator.clipboard.write([clipboardItem]);
            window.ocrPlugin.showToast(successMessage, 'success');

            // 检查是否启用复制后自动关闭插件
            const config = window.ocrPlugin.config;
            if (config?.ui?.autoClose === true) {
                setTimeout(() => {
                    window.ocrAPI?.hideMainWindow?.();
                }, 500);
            }
        } catch (error) {
            console.error('复制图片失败:', error);
            window.ocrPlugin.showToast('图片复制失败', 'error');
        }
    }

    // 复制文本（从历史记录）
    async copyTextFromHistory(text, successMessage = '文本复制成功') {
        if (!text) {
            window.ocrPlugin.showToast('没有可复制的文本', 'warning');
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            window.ocrPlugin.showToast(successMessage, 'success');

            // 检查是否启用复制后自动关闭插件
            const config = window.ocrPlugin.config;
            if (config?.ui?.autoClose === true) {
                setTimeout(() => {
                    window.ocrAPI?.hideMainWindow?.();
                }, 500);
            }
        } catch (error) {
            console.error('复制文本失败:', error);
            window.ocrPlugin.showToast('文本复制失败', 'error');
        }
    }

    // 将base64字符串转换为PNG格式的Blob对象（确保剪贴板兼容性）
    async base64ToBlob(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    canvas.width = img.width;
                    canvas.height = img.height;
                    ctx.drawImage(img, 0, 0);

                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject(new Error('PNG转换失败'));
                        }
                    }, 'image/png');
                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => {
                reject(new Error('图片加载失败'));
            };

            img.src = base64Data.startsWith('data:') ? base64Data : `data:image/jpeg;base64,${base64Data}`;
        });
    }

    // 添加普通翻译历史记录（统一入口）
    addTranslateHistory(sourceText, targetText, sourceLanguage, targetLanguage, service = 'baidu', model = 'translate') {
        try {
            // 更新最大历史记录数量配置
            this.updateMaxHistoryCount();

            // 创建优化的翻译历史记录对象
            const history = this.createOptimizedTranslateHistoryRecord({
                id: Date.now().toString(),
                timestamp: new Date(),
                sourceText: sourceText,
                targetText: targetText,
                sourceLanguage: sourceLanguage,
                targetLanguage: targetLanguage,
                service: service,
                model: model,
                type: 'text' // 标识为普通文本翻译记录
            });

            // 添加到翻译历史记录列表开头
            this.translateHistories.unshift(history);

            // 智能数量限制处理
            this.enforceTranslateHistoryLimit();

            // 保存到存储
            this.saveTranslateHistories();

            // 如果当前在历史记录页面且显示翻译记录，重置到第一页并刷新列表
            if (window.ocrPlugin && window.ocrPlugin.uiManager &&
                window.ocrPlugin.uiManager.currentView === 'history' &&
                this.currentHistoryType === 'translate') {
                // 重置滚动加载状态以显示最新记录
                this.resetScrollLoad();
                this.loadHistoryList();
            }

            return history;
        } catch (error) {
            console.error('保存翻译历史记录失败:', error);
            return null;
        }
    }

    // 创建优化的翻译历史记录对象
    createOptimizedTranslateHistoryRecord(data) {
        const { id, timestamp, sourceText, targetText, sourceLanguage, targetLanguage, service, model, type } = data;

        // 基础记录结构
        const record = {
            id,
            timestamp,
            sourceLanguage,
            targetLanguage,
            service,
            model,
            type: type || 'text',
            // 存储格式版本标识
            _v: this.storageConfig.storageVersion
        };

        // 处理源文本的存储
        if (sourceText) {
            if (this.storageConfig.enableCompression &&
                sourceText.length > this.storageConfig.compressionThreshold) {
                record.sourceText = this.compressText(sourceText);
                record._sourceCompressed = true;
            } else {
                record.sourceText = sourceText;
            }
        }

        // 处理目标文本的存储
        if (targetText) {
            if (this.storageConfig.enableCompression &&
                targetText.length > this.storageConfig.compressionThreshold) {
                record.targetText = this.compressText(targetText);
                record._targetCompressed = true;
            } else {
                record.targetText = targetText;
            }
        }

        // 生成预览文本（优先使用源文本，如果没有则使用目标文本）
        const previewText = sourceText || targetText || '翻译记录';
        record.preview = this.generatePreview(previewText, 40);

        return record;
    }

    // 添加图片翻译历史记录
    addImageTranslateHistory(originalImage, translatedResult, sourceLanguage, targetLanguage, pasteMode, service = 'baidu') {
        try {
            // 更新最大历史记录数量配置
            this.updateMaxHistoryCount();

            // 创建图片翻译历史记录
            const history = {
                id: Date.now().toString(),
                type: 'image', // 标识为图片翻译记录
                timestamp: new Date(),
                sourceText: translatedResult.sumSrc || '', // 原始识别文本
                targetText: translatedResult.sumDst || '', // 翻译后文本
                sourceLanguage: sourceLanguage,
                targetLanguage: targetLanguage,
                service: service,
                model: 'image-translate',
                pasteMode: pasteMode, // 0-文本模式, 1-图片模式
                _v: this.storageConfig.storageVersion
            };

            // 如果启用分片存储，图片数据将在保存时分离存储
            if (this.storageConfig.shardedStorage.enabled) {
                // 临时保存图片数据，在保存时会被分离到独立存储
                history.originalImage = originalImage;
                history.translatedImage = translatedResult.translatedImage || null;
            } else {
                // 传统存储方式，直接包含图片数据
                history.originalImage = originalImage;
                history.translatedImage = translatedResult.translatedImage || null;
            }

            // 生成预览文本（优先使用原始文本，如果没有则使用翻译文本）
            const previewText = history.sourceText || history.targetText || '图片翻译';
            history.preview = this.generatePreview(previewText, 40);

            // 添加到翻译历史记录列表开头
            this.translateHistories.unshift(history);

            // 智能数量限制处理
            this.enforceTranslateHistoryLimit();

            // 保存到存储
            this.saveTranslateHistories();

            // 如果当前在历史记录页面且显示翻译记录，重置到第一页并刷新列表
            if (window.ocrPlugin && window.ocrPlugin.uiManager &&
                window.ocrPlugin.uiManager.currentView === 'history' &&
                this.currentHistoryType === 'translate') {
                // 重置滚动加载状态以显示最新记录
                this.resetScrollLoad();
                this.loadHistoryList();
            }

            return history;
        } catch (error) {
            console.error('保存图片翻译历史记录失败:', error);
            return null;
        }
    }

    // 从UI管理器存储迁移翻译历史记录数据
    migrateFromUIManagerStorage() {
        try {
            // 检查是否存在旧的UI管理器存储的翻译记录
            const oldTranslateHistory = this.getStorageItem('translateHistory');
            if (oldTranslateHistory) {


                // 解析旧数据
                const oldData = typeof oldTranslateHistory === 'string' ?
                    JSON.parse(oldTranslateHistory) : oldTranslateHistory;

                if (Array.isArray(oldData) && oldData.length > 0) {
                    // 转换旧格式到新格式
                    const migratedRecords = oldData.map(oldRecord => {
                        return this.createOptimizedTranslateHistoryRecord({
                            id: oldRecord.id || Date.now().toString(),
                            timestamp: oldRecord.timestamp ? new Date(oldRecord.timestamp) :
                                      (oldRecord.createdAt ? new Date(oldRecord.createdAt) : new Date()),
                            sourceText: oldRecord.sourceText || '',
                            targetText: oldRecord.targetText || '',
                            sourceLanguage: oldRecord.sourceLanguage || 'auto',
                            targetLanguage: oldRecord.targetLanguage || 'zh-cn',
                            service: 'migrated', // 标记为迁移数据
                            model: 'legacy',
                            type: 'text'
                        });
                    });

                    // 合并到现有翻译历史记录中（如果有的话）
                    this.translateHistories = [...migratedRecords, ...this.translateHistories];

                    // 应用数量限制
                    this.updateMaxHistoryCount();
                    if (this.translateHistories.length > this.maxHistoryCount) {
                        this.translateHistories = this.translateHistories.slice(0, this.maxHistoryCount);
                    }


                }

                // 删除旧的存储项，避免冲突
                this.removeStorageItem('translateHistory');

            }
        } catch (error) {
            console.error('迁移翻译历史记录失败:', error);
            // 即使迁移失败，也要删除旧存储项避免冲突
            try {
                this.removeStorageItem('translateHistory');
            } catch (e) {
                console.error('清理旧存储项失败:', e);
            }
        }
    }

    // 移除存储项的统一方法
    removeStorageItem(key) {
        try {
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.removeItem) {
                utools.dbStorage.removeItem(key);
            } else {
                localStorage.removeItem(key);
            }
            return true;
        } catch (error) {
            console.warn(`移除存储项 ${key} 失败:`, error);
            return false;
        }
    }

    // ==================== 分片存储核心方法 ====================

    // 初始化分片存储
    initShardedStorage() {
        try {
            if (!this.storageConfig.shardedStorage.enabled) {
                return;
            }

            // 检查是否需要从旧格式迁移到分片存储
            this.migrateToShardedStorage();

            // 加载或创建索引
            this.loadOrCreateIndex();
        } catch (error) {
            console.error('初始化分片存储失败:', error);
            // 降级到传统存储模式
            this.storageConfig.shardedStorage.enabled = false;
        }
    }

    // 加载或创建分片存储索引
    loadOrCreateIndex() {
        const indexKey = this.storageConfig.shardedStorage.indexKey;
        let index = this.getStorageItem(indexKey);

        if (!index) {
            // 创建新索引
            index = {
                version: this.storageConfig.storageVersion,
                totalRecords: 0,
                textRecords: 0,
                imageRecords: 0,
                shards: {
                    text: [],
                    imageMeta: [],
                    imageData: []
                },
                lastUpdate: Date.now(),
                nextShardId: {
                    text: 0,
                    imageMeta: 0
                }
            };
            this.setStorageItem(indexKey, index);
        } else {
            // 解析现有索引
            if (typeof index === 'string') {
                index = JSON.parse(index);
            }
        }

        this.shardIndex = index;
    }

    // 从传统存储迁移到分片存储
    migrateToShardedStorage() {
        try {
            const oldData = this.getStorageItem(this.storageConfig.translateHistoryKey);
            if (!oldData) {
                return; // 没有旧数据需要迁移
            }


            const records = typeof oldData === 'string' ? JSON.parse(oldData) : oldData;

            if (!Array.isArray(records) || records.length === 0) {
                return;
            }

            // 分离文本记录和图片记录
            const textRecords = [];
            const imageRecords = [];

            records.forEach(record => {
                if (record.type === 'image') {
                    imageRecords.push(record);
                } else {
                    textRecords.push(record);
                }
            });

            // 迁移文本记录
            if (textRecords.length > 0) {
                this.migrateTextRecordsToShards(textRecords);
            }

            // 迁移图片记录
            if (imageRecords.length > 0) {
                this.migrateImageRecordsToShards(imageRecords);
            }

            // 删除旧的存储项
            this.removeStorageItem(this.storageConfig.translateHistoryKey);


        } catch (error) {
            console.error('迁移到分片存储失败:', error);
            throw error;
        }
    }

    // 迁移文本记录到分片
    migrateTextRecordsToShards(textRecords) {
        const config = this.storageConfig.shardedStorage;
        const shards = [];
        let currentShard = [];
        let currentShardSize = 0;

        textRecords.forEach(record => {
            const recordSize = JSON.stringify(record).length;

            // 检查是否需要创建新分片
            if (currentShard.length >= config.maxTextRecordsPerShard ||
                currentShardSize + recordSize > config.maxShardSize) {
                if (currentShard.length > 0) {
                    shards.push([...currentShard]);
                    currentShard = [];
                    currentShardSize = 0;
                }
            }

            currentShard.push(record);
            currentShardSize += recordSize;
        });

        // 添加最后一个分片
        if (currentShard.length > 0) {
            shards.push(currentShard);
        }

        // 保存分片
        shards.forEach((shard, index) => {
            const shardKey = `${config.textShardPrefix}${index}`;
            this.setStorageItem(shardKey, shard);
            this.shardIndex.shards.text.push(shardKey);
        });

        this.shardIndex.textRecords = textRecords.length;
        this.shardIndex.nextShardId.text = shards.length;
    }

    // 迁移图片记录到分片
    migrateImageRecordsToShards(imageRecords) {
        const config = this.storageConfig.shardedStorage;
        const metaShards = [];
        let currentMetaShard = [];

        imageRecords.forEach((record, index) => {
            // 分离图片数据
            const { originalImage, translatedImage, ...metaRecord } = record;

            // 生成图片ID
            const imageId = record.id || `img_${Date.now()}_${index}`;
            metaRecord.imageId = imageId;

            // 保存图片数据
            if (originalImage) {
                const origKey = `${config.imageDataPrefix}${imageId}_orig`;
                this.setStorageItem(origKey, originalImage);
                metaRecord.originalImageRef = origKey;
                this.shardIndex.shards.imageData.push(origKey);
            }

            if (translatedImage) {
                const transKey = `${config.imageDataPrefix}${imageId}_trans`;
                this.setStorageItem(transKey, translatedImage);
                metaRecord.translatedImageRef = transKey;
                this.shardIndex.shards.imageData.push(transKey);
            }

            // 检查是否需要创建新的元数据分片
            if (currentMetaShard.length >= config.maxImageMetaRecordsPerShard) {
                if (currentMetaShard.length > 0) {
                    metaShards.push([...currentMetaShard]);
                    currentMetaShard = [];
                }
            }

            currentMetaShard.push(metaRecord);
        });

        // 添加最后一个元数据分片
        if (currentMetaShard.length > 0) {
            metaShards.push(currentMetaShard);
        }

        // 保存元数据分片
        metaShards.forEach((shard, index) => {
            const shardKey = `${config.imageMetaShardPrefix}${index}`;
            this.setStorageItem(shardKey, shard);
            this.shardIndex.shards.imageMeta.push(shardKey);
        });

        this.shardIndex.imageRecords = imageRecords.length;
        this.shardIndex.nextShardId.imageMeta = metaShards.length;
    }

    // 从分片存储加载翻译历史记录
    loadTranslateHistoriesFromShards() {
        if (!this.storageConfig.shardedStorage.enabled || !this.shardIndex) {
            return [];
        }

        try {
            const allRecords = [];

            // 加载文本记录
            for (const shardKey of this.shardIndex.shards.text) {
                const shard = this.getStorageItem(shardKey);
                if (shard) {
                    const records = typeof shard === 'string' ? JSON.parse(shard) : shard;
                    if (Array.isArray(records)) {
                        allRecords.push(...records);
                    }
                }
            }

            // 加载图片记录元数据
            for (const shardKey of this.shardIndex.shards.imageMeta) {
                const shard = this.getStorageItem(shardKey);
                if (shard) {
                    const records = typeof shard === 'string' ? JSON.parse(shard) : shard;
                    if (Array.isArray(records)) {
                        // 为图片记录添加懒加载标记
                        records.forEach(record => {
                            record._imageDataLoaded = false;
                            allRecords.push(record);
                        });
                    }
                }
            }

            // 按时间戳排序
            allRecords.sort((a, b) => {
                const timeA = new Date(a.timestamp).getTime();
                const timeB = new Date(b.timestamp).getTime();
                return timeB - timeA; // 降序排列，最新的在前
            });

            return allRecords;
        } catch (error) {
            console.error('从分片存储加载翻译历史记录失败:', error);
            return [];
        }
    }

    // 懒加载图片数据
    loadImageDataForRecord(record) {
        if (record.type !== 'image' || record._imageDataLoaded) {
            return record;
        }

        try {
            // 加载原始图片
            if (record.originalImageRef) {
                const originalImage = this.getStorageItem(record.originalImageRef);
                if (originalImage) {
                    record.originalImage = originalImage;
                }
            }

            // 加载翻译后图片
            if (record.translatedImageRef) {
                const translatedImage = this.getStorageItem(record.translatedImageRef);
                if (translatedImage) {
                    record.translatedImage = translatedImage;
                }
            }

            record._imageDataLoaded = true;
            return record;
        } catch (error) {
            console.error('加载图片数据失败:', error);
            return record;
        }
    }

    // 保存翻译历史记录到分片存储
    saveTranslateHistoriesToShards() {
        if (!this.storageConfig.shardedStorage.enabled) {
            return false;
        }

        try {
            // 更新索引
            this.shardIndex.totalRecords = this.translateHistories.length;
            this.shardIndex.lastUpdate = Date.now();

            // 分离文本记录和图片记录
            const textRecords = this.translateHistories.filter(r => r.type !== 'image');
            const imageRecords = this.translateHistories.filter(r => r.type === 'image');

            // 清理现有分片
            this.cleanupExistingShards();

            // 重新保存文本记录分片
            if (textRecords.length > 0) {
                this.saveTextRecordsToShards(textRecords);
            }

            // 重新保存图片记录分片
            if (imageRecords.length > 0) {
                this.saveImageRecordsToShards(imageRecords);
            }

            // 保存更新后的索引
            this.setStorageItem(this.storageConfig.shardedStorage.indexKey, this.shardIndex);

            return true;
        } catch (error) {
            console.error('保存翻译历史记录到分片存储失败:', error);
            return false;
        }
    }

    // 清理现有分片
    cleanupExistingShards() {
        // 清理文本分片
        for (const shardKey of this.shardIndex.shards.text) {
            this.removeStorageItem(shardKey);
        }
        this.shardIndex.shards.text = [];

        // 清理图片元数据分片
        for (const shardKey of this.shardIndex.shards.imageMeta) {
            this.removeStorageItem(shardKey);
        }
        this.shardIndex.shards.imageMeta = [];

        // 注意：不清理图片数据，因为可能被其他记录引用
        // 图片数据的清理在垃圾回收时进行
    }

    // 保存文本记录到分片
    saveTextRecordsToShards(textRecords) {
        const config = this.storageConfig.shardedStorage;
        const shards = [];
        let currentShard = [];
        let currentShardSize = 0;

        textRecords.forEach(record => {
            const recordSize = JSON.stringify(record).length;

            // 检查是否需要创建新分片
            if (currentShard.length >= config.maxTextRecordsPerShard ||
                currentShardSize + recordSize > config.maxShardSize) {
                if (currentShard.length > 0) {
                    shards.push([...currentShard]);
                    currentShard = [];
                    currentShardSize = 0;
                }
            }

            currentShard.push(record);
            currentShardSize += recordSize;
        });

        // 添加最后一个分片
        if (currentShard.length > 0) {
            shards.push(currentShard);
        }

        // 保存分片
        shards.forEach((shard, index) => {
            const shardKey = `${config.textShardPrefix}${index}`;
            this.setStorageItem(shardKey, shard);
            this.shardIndex.shards.text.push(shardKey);
        });

        this.shardIndex.textRecords = textRecords.length;
        this.shardIndex.nextShardId.text = shards.length;
    }

    // 保存图片记录到分片
    saveImageRecordsToShards(imageRecords) {
        const config = this.storageConfig.shardedStorage;
        const metaShards = [];
        let currentMetaShard = [];

        imageRecords.forEach(record => {
            // 创建元数据记录（不包含图片数据）
            const { originalImage, translatedImage, _imageDataLoaded, ...metaRecord } = record;

            // 如果记录已有图片引用，保持不变；否则创建新的图片存储
            if (!metaRecord.originalImageRef && originalImage) {
                const imageId = metaRecord.imageId || metaRecord.id || `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const origKey = `${config.imageDataPrefix}${imageId}_orig`;
                this.setStorageItem(origKey, originalImage);
                metaRecord.originalImageRef = origKey;
                metaRecord.imageId = imageId;

                if (!this.shardIndex.shards.imageData.includes(origKey)) {
                    this.shardIndex.shards.imageData.push(origKey);
                }
            }

            if (!metaRecord.translatedImageRef && translatedImage) {
                const imageId = metaRecord.imageId || metaRecord.id || `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const transKey = `${config.imageDataPrefix}${imageId}_trans`;
                this.setStorageItem(transKey, translatedImage);
                metaRecord.translatedImageRef = transKey;
                metaRecord.imageId = imageId;

                if (!this.shardIndex.shards.imageData.includes(transKey)) {
                    this.shardIndex.shards.imageData.push(transKey);
                }
            }

            // 检查是否需要创建新的元数据分片
            if (currentMetaShard.length >= config.maxImageMetaRecordsPerShard) {
                if (currentMetaShard.length > 0) {
                    metaShards.push([...currentMetaShard]);
                    currentMetaShard = [];
                }
            }

            currentMetaShard.push(metaRecord);
        });

        // 添加最后一个元数据分片
        if (currentMetaShard.length > 0) {
            metaShards.push(currentMetaShard);
        }

        // 保存元数据分片
        metaShards.forEach((shard, index) => {
            const shardKey = `${config.imageMetaShardPrefix}${index}`;
            this.setStorageItem(shardKey, shard);
            this.shardIndex.shards.imageMeta.push(shardKey);
        });

        this.shardIndex.imageRecords = imageRecords.length;
        this.shardIndex.nextShardId.imageMeta = metaShards.length;
    }

    // 垃圾回收：清理不再使用的图片数据
    garbageCollectImageData() {
        if (!this.storageConfig.shardedStorage.enabled || !this.shardIndex) {
            return;
        }

        try {
            // 收集所有仍在使用的图片引用
            const activeImageRefs = new Set();

            // 从图片元数据分片中收集引用
            for (const shardKey of this.shardIndex.shards.imageMeta) {
                const shard = this.getStorageItem(shardKey);
                if (shard) {
                    const records = typeof shard === 'string' ? JSON.parse(shard) : shard;
                    if (Array.isArray(records)) {
                        records.forEach(record => {
                            if (record.originalImageRef) {
                                activeImageRefs.add(record.originalImageRef);
                            }
                            if (record.translatedImageRef) {
                                activeImageRefs.add(record.translatedImageRef);
                            }
                        });
                    }
                }
            }

            // 清理不再使用的图片数据
            const imagesToRemove = [];
            for (const imageKey of this.shardIndex.shards.imageData) {
                if (!activeImageRefs.has(imageKey)) {
                    imagesToRemove.push(imageKey);
                }
            }

            // 删除孤立的图片数据
            for (const imageKey of imagesToRemove) {
                this.removeStorageItem(imageKey);
                const index = this.shardIndex.shards.imageData.indexOf(imageKey);
                if (index > -1) {
                    this.shardIndex.shards.imageData.splice(index, 1);
                }
            }

            if (imagesToRemove.length > 0) {

                // 保存更新后的索引
                this.setStorageItem(this.storageConfig.shardedStorage.indexKey, this.shardIndex);
            }

        } catch (error) {
            console.error('图片数据垃圾回收失败:', error);
        }
    }

    // 获取分片存储统计信息
    getShardedStorageStats() {
        if (!this.storageConfig.shardedStorage.enabled || !this.shardIndex) {
            return null;
        }

        try {
            const stats = {
                totalShards: 0,
                textShards: this.shardIndex.shards.text.length,
                imageMetaShards: this.shardIndex.shards.imageMeta.length,
                imageDataShards: this.shardIndex.shards.imageData.length,
                totalRecords: this.shardIndex.totalRecords,
                textRecords: this.shardIndex.textRecords,
                imageRecords: this.shardIndex.imageRecords,
                estimatedSize: 0
            };

            stats.totalShards = stats.textShards + stats.imageMetaShards + stats.imageDataShards + 1; // +1 for index

            // 估算总大小（粗略计算）
            stats.estimatedSize = stats.totalShards * 50 * 1024; // 假设每个分片平均50KB

            return stats;
        } catch (error) {
            console.error('获取分片存储统计失败:', error);
            return null;
        }
    }

    // 获取存储统计信息
    getStorageStats() {
        const ocrDataSize = JSON.stringify(this.histories).length;
        const translateDataSize = JSON.stringify(this.translateHistories).length;
        const totalSize = ocrDataSize + translateDataSize;

        return {
            ocr: {
                count: this.histories.length,
                sizeBytes: ocrDataSize,
                sizeKB: (ocrDataSize / 1024).toFixed(2),
                compressed: this.histories.filter(h => h._compressed).length
            },
            translate: {
                count: this.translateHistories.length,
                sizeBytes: translateDataSize,
                sizeKB: (translateDataSize / 1024).toFixed(2),
                compressed: this.translateHistories.filter(h => h._sourceCompressed || h._targetCompressed).length
            },
            total: {
                count: this.histories.length + this.translateHistories.length,
                sizeBytes: totalSize,
                sizeKB: (totalSize / 1024).toFixed(2),
                sizeMB: (totalSize / (1024 * 1024)).toFixed(3)
            },
            limits: {
                maxRecords: this.maxHistoryCount,
                warningThresholdKB: 800,
                maxThresholdKB: 1024,
                isNearLimit: totalSize > 800 * 1024
            }
        };
    }

    // 执行存储清理和优化
    performStorageOptimization() {
        let optimized = false;

        // 1. 清理超出数量限制的记录
        if (this.histories.length > this.maxHistoryCount) {
            this.histories = this.histories.slice(0, this.maxHistoryCount);
            optimized = true;
        }

        if (this.translateHistories.length > this.maxHistoryCount) {
            this.translateHistories = this.translateHistories.slice(0, this.maxHistoryCount);
            optimized = true;
        }

        // 2. 压缩长文本
        this.histories.forEach(history => {
            if (!history._compressed && history.result &&
                history.result.length > this.storageConfig.compressionThreshold) {
                history.result = this.compressText(history.result);
                history._compressed = true;
                optimized = true;
            }
        });

        this.translateHistories.forEach(history => {
            if (!history._sourceCompressed && history.sourceText &&
                history.sourceText.length > this.storageConfig.compressionThreshold) {
                history.sourceText = this.compressText(history.sourceText);
                history._sourceCompressed = true;
                optimized = true;
            }
            if (!history._targetCompressed && history.targetText &&
                history.targetText.length > this.storageConfig.compressionThreshold) {
                history.targetText = this.compressText(history.targetText);
                history._targetCompressed = true;
                optimized = true;
            }
        });

        // 3. 如果仍然接近限制，进行更激进的优化
        const afterStats = this.getStorageStats();
        if (afterStats.total.sizeBytes > 800 * 1024) {
            // 减少记录数量到80%
            const targetCount = Math.floor(this.maxHistoryCount * 0.8);
            if (this.histories.length > targetCount) {
                this.histories = this.histories.slice(0, targetCount);
                optimized = true;
            }
            if (this.translateHistories.length > targetCount) {
                this.translateHistories = this.translateHistories.slice(0, targetCount);
                optimized = true;
            }
        }

        if (optimized) {
            this.saveHistories();
            this.saveTranslateHistories();
        }

        return optimized;
    }

    // 格式化模型显示（uTools使用友好名称，其他使用原始API名称）
    formatModel(service, model) {
        if (!service) return '未知';

        const serviceNames = {
            'baidu': '百度智能云',
            'tencent': '腾讯云',
            'aliyun': '阿里云',
            'volcano': '火山引擎',
            'deeplx': 'DeepLX',
            'youdao': '有道翻译',
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'google': 'Gemini',
            'alibaba': '阿里云百炼',
            'bytedance': '火山引擎',
            'zhipu': '智谱AI',
            'utools': 'uTools AI',
            'custom': '自定义平台'
        };

        // 对于AI模型，所有平台都使用友好名称
        if (model && ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'utools', 'ocrpro', 'custom'].includes(service)) {
            let displayName = model;
            try {
                // 获取主插件实例
                const ocrPlugin = window.ocrPlugin;
                if (ocrPlugin && ocrPlugin.config && ocrPlugin.config[service]) {
                    const platformConfig = ocrPlugin.config[service];
                    const modelNameMap = platformConfig.modelNameMap || {};
                    displayName = modelNameMap[model] || model;
                }
            } catch (error) {
                // 如果获取友好名称失败，使用原始模型名称
            }
            // 返回"服务商 - 模型名称"的格式
            const serviceName = serviceNames[service] || service;
            return `${serviceName} - ${displayName}`;
        }

        // 对于传统OCR服务，只返回服务名称
        return serviceNames[service] || service;
    }

    // 获取存储统计信息
    getStorageStats() {
        const ocrDataSize = JSON.stringify(this.histories).length;
        const translateDataSize = JSON.stringify(this.translateHistories).length;
        const totalSize = ocrDataSize + translateDataSize;

        return {
            ocr: {
                count: this.histories.length,
                sizeBytes: ocrDataSize,
                sizeKB: (ocrDataSize / 1024).toFixed(2),
                compressed: this.histories.filter(h => h._compressed).length
            },
            translate: {
                count: this.translateHistories.length,
                sizeBytes: translateDataSize,
                sizeKB: (translateDataSize / 1024).toFixed(2),
                compressed: this.translateHistories.filter(h => h._sourceCompressed || h._targetCompressed).length
            },
            total: {
                count: this.histories.length + this.translateHistories.length,
                sizeBytes: totalSize,
                sizeKB: (totalSize / 1024).toFixed(2),
                sizeMB: (totalSize / (1024 * 1024)).toFixed(3)
            },
            limits: {
                maxRecords: this.maxHistoryCount,
                warningThresholdKB: 800,
                maxThresholdKB: 1024,
                isNearLimit: totalSize > 800 * 1024
            }
        };
    }

    // 执行存储清理和优化
    performStorageOptimization() {
        const beforeStats = this.getStorageStats();

        let optimized = false;

        // 1. 清理超出数量限制的记录
        if (this.histories.length > this.maxHistoryCount) {
            this.histories = this.histories.slice(0, this.maxHistoryCount);
            optimized = true;
        }

        if (this.translateHistories.length > this.maxHistoryCount) {
            this.translateHistories = this.translateHistories.slice(0, this.maxHistoryCount);
            optimized = true;
        }

        // 2. 压缩长文本
        this.histories.forEach(history => {
            if (!history._compressed && history.result &&
                history.result.length > this.storageConfig.compressionThreshold) {
                history.result = this.compressText(history.result);
                history._compressed = true;
                optimized = true;
            }
        });

        this.translateHistories.forEach(history => {
            if (!history._sourceCompressed && history.sourceText &&
                history.sourceText.length > this.storageConfig.compressionThreshold) {
                history.sourceText = this.compressText(history.sourceText);
                history._sourceCompressed = true;
                optimized = true;
            }
            if (!history._targetCompressed && history.targetText &&
                history.targetText.length > this.storageConfig.compressionThreshold) {
                history.targetText = this.compressText(history.targetText);
                history._targetCompressed = true;
                optimized = true;
            }
        });

        // 3. 如果仍然接近限制，进行更激进的优化
        const afterStats = this.getStorageStats();
        if (afterStats.total.sizeBytes > 800 * 1024) {

            // 减少记录数量到80%
            const targetCount = Math.floor(this.maxHistoryCount * 0.8);
            if (this.histories.length > targetCount) {
                this.histories = this.histories.slice(0, targetCount);
                optimized = true;
            }
            if (this.translateHistories.length > targetCount) {
                this.translateHistories = this.translateHistories.slice(0, targetCount);
                optimized = true;
            }
        }

        if (optimized) {
            this.saveHistories();
            this.saveTranslateHistories();

            // 如果启用了分片存储，执行垃圾回收
            if (this.storageConfig.shardedStorage.enabled) {
                this.garbageCollectImageData();
            }

            const finalStats = this.getStorageStats();
        }

        return optimized;
    }

    // 数据完整性检查和修复
    validateDataIntegrity() {
        let issues = [];
        let repaired = 0;

        // 检查和修复OCR历史记录
        this.histories = this.histories.filter((history, index) => {
            let hasIssue = false;

            if (!history.id) {
                issues.push(`OCR记录 ${index} 缺少ID`);
                hasIssue = true;
            }
            if (!history.timestamp || !(history.timestamp instanceof Date)) {
                if (history.timestamp) {
                    // 尝试修复时间戳
                    try {
                        history.timestamp = new Date(history.timestamp);
                        repaired++;
                    } catch (e) {
                        issues.push(`OCR记录 ${history.id || index} 时间戳格式错误且无法修复`);
                        hasIssue = true;
                    }
                } else {
                    issues.push(`OCR记录 ${history.id || index} 缺少时间戳`);
                    hasIssue = true;
                }
            }
            if (!history.result || history.result.trim() === '') {
                // 尝试从预览文本恢复结果
                if (history.preview && history.preview !== '无内容') {
                    history.result = history.preview.replace('...', '');
                    repaired++;
                } else {
                    issues.push(`OCR记录 ${history.id || index} 缺少结果文本且无法修复`);
                    hasIssue = true;
                }
            }

            // 过滤掉无法修复的记录
            return !hasIssue;
        });

        // 检查和修复翻译历史记录
        this.translateHistories = this.translateHistories.filter((history, index) => {
            let hasIssue = false;

            if (!history.id) {
                issues.push(`翻译记录 ${index} 缺少ID`);
                hasIssue = true;
            }
            if (!history.timestamp || !(history.timestamp instanceof Date)) {
                if (history.timestamp || history.createdAt) {
                    // 尝试修复时间戳
                    try {
                        history.timestamp = new Date(history.timestamp || history.createdAt);
                        if (history.createdAt) delete history.createdAt;
                        repaired++;
                    } catch (e) {
                        issues.push(`翻译记录 ${history.id || index} 时间戳格式错误且无法修复`);
                        hasIssue = true;
                    }
                } else {
                    issues.push(`翻译记录 ${history.id || index} 缺少时间戳`);
                    hasIssue = true;
                }
            }
            if (!history.sourceText && !history.targetText) {
                issues.push(`翻译记录 ${history.id || index} 缺少文本内容且无法修复`);
                hasIssue = true;
            }

            return !hasIssue;
        });

        // 如果有修复，保存数据
        if (repaired > 0) {
            this.saveHistories();
            this.saveTranslateHistories();
        }

        return issues;
    }

    // ==================== 分页相关方法 ====================

    // 动态计算每页显示数量
    calculateItemsPerPage() {
        try {
            const historyListArea = document.querySelector('.history-list-area');
            if (!historyListArea) {
                return this.lastCalculatedItemsPerPage;
            }

            // 获取容器的可用高度
            const containerHeight = historyListArea.clientHeight;
            if (containerHeight <= 0) {
                return this.lastCalculatedItemsPerPage;
            }

            // 尝试获取实际历史记录项的高度
            let itemHeight = this.defaultItemHeight;
            const firstHistoryItem = document.querySelector('.history-item');
            if (firstHistoryItem) {
                // 获取包含边距的完整高度
                const computedStyle = window.getComputedStyle(firstHistoryItem);
                const marginTop = parseInt(computedStyle.marginTop) || 0;
                const marginBottom = parseInt(computedStyle.marginBottom) || 0;
                itemHeight = firstHistoryItem.offsetHeight + marginTop + marginBottom;
            }

            // 计算可显示的记录数量
            const calculatedItemsPerPage = Math.floor(containerHeight / itemHeight);

            // 确保结果为正整数，至少显示1条记录
            const finalItemsPerPage = Math.max(1, calculatedItemsPerPage);

            // 缓存计算结果
            this.lastCalculatedItemsPerPage = finalItemsPerPage;



            return finalItemsPerPage;
        } catch (error) {
            console.error('计算每页显示数量时出错:', error);
            return this.lastCalculatedItemsPerPage;
        }
    }

    // 更新每页显示数量
    updateItemsPerPage() {
        const newItemsPerPage = this.calculateItemsPerPage();
        if (newItemsPerPage !== this.itemsPerPage) {
            const oldItemsPerPage = this.itemsPerPage;
            this.itemsPerPage = newItemsPerPage;

            // 如果每页显示数量发生变化，需要重新计算当前页码
            // 尽量保持当前选中的记录仍然可见
            if (this.currentSelectedId && oldItemsPerPage > 0) {
                const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;
                const selectedIndex = currentHistories.findIndex(h => h.id === this.currentSelectedId);
                if (selectedIndex >= 0) {
                    // 计算选中记录应该在哪一页
                    const newPage = Math.floor(selectedIndex / newItemsPerPage) + 1;
                    this.currentPage = Math.max(1, newPage);
                }
            }


            return true; // 表示发生了变化
        }
        return false; // 表示没有变化
    }

    // 绑定窗口大小变化事件
    bindResizeEvents() {
        // 防抖处理，避免频繁计算
        let resizeTimeout;
        const handleResize = () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                if (window.ocrPlugin && window.ocrPlugin.uiManager &&
                    window.ocrPlugin.uiManager.currentView === 'history') {
                    const hasChanged = this.updateItemsPerPage();
                    if (hasChanged) {
                        // 重新加载列表以应用新的分页设置
                        this.loadHistoryList();
                    }
                    // 更新滑块位置
                    this.updateHistoryTypeSlider();
                }
            }, 300); // 300ms防抖
        };

        window.addEventListener('resize', handleResize);
    }

    // 计算总页数
    calculateTotalPages() {
        const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;
        this.totalPages = Math.max(1, Math.ceil(currentHistories.length / this.itemsPerPage));

        // 确保当前页码在有效范围内
        if (this.currentPage > this.totalPages) {
            this.currentPage = this.totalPages;
        }
        if (this.currentPage < 1) {
            this.currentPage = 1;
        }
    }

    // 获取当前页的历史记录
    getCurrentPageHistories() {
        const currentHistories = this.currentHistoryType === 'ocr' ? this.histories : this.translateHistories;
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        return currentHistories.slice(startIndex, endIndex);
    }

    // 切换到指定页码
    goToPage(pageNumber) {
        if (pageNumber < 1 || pageNumber > this.totalPages) {
            return false;
        }

        this.currentPage = pageNumber;
        this.loadHistoryList();
        this.updatePaginationControls();
        return true;
    }

    // 上一页
    goToPreviousPage() {
        return this.goToPage(this.currentPage - 1);
    }

    // 下一页
    goToNextPage() {
        return this.goToPage(this.currentPage + 1);
    }

    // 重置分页到第一页
    resetPagination() {
        this.currentPage = 1;
        this.calculateTotalPages();
    }

    // 更新分页控件状态
    updatePaginationControls() {
        const prevBtn = document.getElementById('history-prev-page-btn');
        const nextBtn = document.getElementById('history-next-page-btn');
        const prevArea = document.getElementById('history-prev-area');
        const nextArea = document.getElementById('history-next-area');
        const paginationInfo = document.getElementById('history-pagination-info');

        const isPrevDisabled = this.currentPage <= 1;
        const isNextDisabled = this.currentPage >= this.totalPages;

        // 更新按钮的disabled状态
        if (prevBtn) {
            prevBtn.disabled = isPrevDisabled;
        }

        if (nextBtn) {
            nextBtn.disabled = isNextDisabled;
        }

        // 更新点击区域的disabled状态
        if (prevArea) {
            if (isPrevDisabled) {
                prevArea.classList.add('disabled');
            } else {
                prevArea.classList.remove('disabled');
            }
        }

        if (nextArea) {
            if (isNextDisabled) {
                nextArea.classList.add('disabled');
            } else {
                nextArea.classList.remove('disabled');
            }
        }

        // 更新页码显示
        if (paginationInfo) {
            paginationInfo.textContent = `${this.currentPage}/${this.totalPages}`;
        }
    }

    // 绑定分页控件事件 - 适配新的三区域布局
    bindPaginationEvents() {
        const prevArea = document.getElementById('history-prev-area');
        const nextArea = document.getElementById('history-next-area');

        if (prevArea) {
            prevArea.addEventListener('click', (e) => {
                e.preventDefault(); // 防止默认行为
                e.stopPropagation(); // 阻止事件冒泡

                // 检查是否处于禁用状态
                if (!prevArea.classList.contains('disabled')) {
                    this.goToPreviousPage();
                }
            });

            // 添加mousedown事件处理，防止快速点击时的文本选择
            prevArea.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
        }

        if (nextArea) {
            nextArea.addEventListener('click', (e) => {
                e.preventDefault(); // 防止默认行为
                e.stopPropagation(); // 阻止事件冒泡

                // 检查是否处于禁用状态
                if (!nextArea.classList.contains('disabled')) {
                    this.goToNextPage();
                }
            });

            // 添加mousedown事件处理，防止快速点击时的文本选择
            nextArea.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
        }
    }

    /**
     * 智能翻译历史记录数量限制处理
     * 针对分片存储优化，避免全量重建
     */
    enforceTranslateHistoryLimit() {
        if (this.translateHistories.length <= this.maxHistoryCount) {
            return; // 未超限，无需处理
        }

        const excessCount = this.translateHistories.length - this.maxHistoryCount;


        // 如果启用了分片存储，使用增量清理策略
        if (this.storageConfig.shardedStorage.enabled && this.shardIndex) {
            this.incrementalCleanupTranslateHistory(excessCount);
        } else {
            // 传统存储，直接截断
            this.translateHistories = this.translateHistories.slice(0, this.maxHistoryCount);
        }
    }

    /**
     * 增量清理翻译历史记录（分片存储优化）
     * @param {number} excessCount 需要删除的记录数量
     */
    incrementalCleanupTranslateHistory(excessCount) {
        // 1. 标记要删除的记录
        const recordsToDelete = this.translateHistories.slice(this.maxHistoryCount);
        const imageRefsToDelete = new Set();

        // 收集需要删除的图片引用
        recordsToDelete.forEach(record => {
            if (record.type === 'image') {
                if (record.originalImageRef) imageRefsToDelete.add(record.originalImageRef);
                if (record.translatedImageRef) imageRefsToDelete.add(record.translatedImageRef);
            }
        });

        // 2. 从内存中删除记录
        this.translateHistories = this.translateHistories.slice(0, this.maxHistoryCount);

        // 3. 更新分片索引中的记录统计
        if (this.shardIndex) {
            this.shardIndex.totalRecords = this.translateHistories.length;
            this.shardIndex.textRecords = this.translateHistories.filter(r => r.type === 'text').length;
            this.shardIndex.imageRecords = this.translateHistories.filter(r => r.type === 'image').length;
        }

        // 4. 异步清理图片数据（避免阻塞主线程）
        if (imageRefsToDelete.size > 0 && this.storageConfig.cleanup.asyncImageCleanup) {
            setTimeout(() => {
                this.cleanupImageReferences(imageRefsToDelete);
            }, this.storageConfig.cleanup.cleanupDelay);
        } else if (imageRefsToDelete.size > 0) {
            // 同步清理（如果配置为同步）
            this.cleanupImageReferences(imageRefsToDelete);
        }


    }

    /**
     * 清理图片引用
     * @param {Set} imageRefsToDelete 要删除的图片引用集合
     */
    async cleanupImageReferences(imageRefsToDelete) {
        try {
            // 获取当前仍在使用的图片引用
            const activeImageRefs = new Set();
            this.translateHistories.forEach(record => {
                if (record.type === 'image') {
                    if (record.originalImageRef) activeImageRefs.add(record.originalImageRef);
                    if (record.translatedImageRef) activeImageRefs.add(record.translatedImageRef);
                }
            });

            // 批量删除不再被引用的图片数据
            const refsToDelete = Array.from(imageRefsToDelete).filter(ref => !activeImageRefs.has(ref));
            const batchSize = this.storageConfig.cleanup.batchSize;
            let deletedCount = 0;

            // 分批处理删除操作，避免一次性删除太多数据造成性能问题
            for (let i = 0; i < refsToDelete.length; i += batchSize) {
                const batch = refsToDelete.slice(i, i + batchSize);

                batch.forEach(imageRef => {
                    try {
                        this.removeStorageItem(imageRef);
                        deletedCount++;
                    } catch (error) {
                        console.warn(`删除图片引用 ${imageRef} 失败:`, error);
                    }
                });

                // 如果是异步处理，在批次之间添加短暂延迟
                if (this.storageConfig.cleanup.asyncImageCleanup && i + batchSize < refsToDelete.length) {
                    // 使用setTimeout让出控制权，避免长时间阻塞
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }

            // 更新分片索引中的图片数据引用
            if (this.shardIndex && this.shardIndex.shards.imageData) {
                const originalCount = this.shardIndex.shards.imageData.length;
                this.shardIndex.shards.imageData = this.shardIndex.shards.imageData.filter(
                    ref => activeImageRefs.has(ref)
                );
                const removedFromIndex = originalCount - this.shardIndex.shards.imageData.length;

                // 只有在索引发生变化时才保存
                if (removedFromIndex > 0) {
                    this.setStorageItem(this.storageConfig.shardedStorage.indexKey, this.shardIndex);

                }
            }


        } catch (error) {
            console.error('清理图片引用失败:', error);
        }
    }

    /**
     * 通用历史记录数量限制处理
     */
    enforceHistoryLimit() {
        // OCR历史记录限制
        if (this.histories.length > this.maxHistoryCount) {
            this.histories = this.histories.slice(0, this.maxHistoryCount);
        }

        // 翻译历史记录限制
        this.enforceTranslateHistoryLimit();
    }
}

// 导出类
window.HistoryManager = HistoryManager;
