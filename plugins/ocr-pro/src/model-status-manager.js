// 统一模型连接状态管理器
class ModelStatusManager {
    constructor() {
        this.modelStates = new Map(); // 存储所有模型的状态 Map<modelKey, ModelState>
        this.listeners = new Set(); // 状态变化监听器
        this.storageKey = 'ocr_model_status_cache';
        // 移除缓存超时机制，改为永久存储，只有在测试失败或使用失败时才更新状态

        this.init();
    }

    // 初始化
    init() {
        this.loadFromStorage();
        this.setupStorageMonitoring();
        // 移除过期状态清理，改为永久存储

        // 初始化内置服务（OCR Pro）的默认状态
        this.initializeBuiltinServices();
    }

    // 初始化内置服务状态
    initializeBuiltinServices() {
        try {
            let needsSave = false;

            // OCR Pro内置服务，设置默认可用状态
            const ocrproModels = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
            ocrproModels.forEach(modelId => {
                const modelKey = this.generateModelKey('ocrpro', modelId);
                const currentStatus = this.modelStates.get(modelKey);

                // 只有在没有状态或状态为unknown时才设置为success
                if (!currentStatus || currentStatus.status === 'unknown') {
                    const newState = this.createModelState('success');
                    this.modelStates.set(modelKey, newState);
                    needsSave = true;
                }
            });

            // 批量保存一次，避免频繁保存
            if (needsSave) {
                this.saveToStorage();

            }
        } catch (error) {
            console.error('[ModelStatusManager] 初始化内置服务失败:', error);
        }
    }

    // 设置存储监控
    setupStorageMonitoring() {
        // uTools环境中不需要监听storage事件，因为utools.dbStorage是插件独立的
        // 但我们可以监听uTools的数据同步事件
        if (typeof utools !== 'undefined' && utools.onDbPull) {
            utools.onDbPull((docs) => {
                // 检查是否有我们的数据被同步
                const hasOurData = docs.some(doc => doc._id === this.storageKey);
                if (hasOurData) {
                    this.loadFromStorage();
                }
            });
        }

        // 插件启动后延迟验证存储完整性
        setTimeout(() => {
            this.validateStorageIntegrity();
        }, 2000);

        // 定期验证存储完整性（每5分钟）
        setInterval(() => {
            this.validateStorageIntegrity();
        }, 5 * 60 * 1000);
    }

    // 验证存储完整性
    validateStorageIntegrity() {
        try {
            const stored = this.getStorageItem(this.storageKey);
            const hasMainStorage = !!stored;
            // 注意：这是内部备份机制，不包含在用户备份恢复功能中
            const hasBackupStorage = !!this.getStorageItem(this.storageKey + '_backup');
            const hasStatesInMemory = this.modelStates.size > 0;

            // 如果内存中有状态但存储中没有，说明可能发生了数据丢失
            if (hasStatesInMemory && !hasMainStorage && !hasBackupStorage) {
                console.warn('检测到存储数据丢失，尝试重新保存到存储');
                this.saveToStorage();
            }

            // 如果没有主存储但有备用存储，尝试从备用存储恢复
            if (!hasMainStorage && hasBackupStorage && !hasStatesInMemory) {
                console.warn('主存储丢失，从内部备份恢复');
                this.loadFromStorage();
            }

            // 记录当前状态统计（用于调试）
            const stats = this.getCacheStats();
            if (stats.totalCount === 0 && (hasMainStorage || hasBackupStorage)) {
                console.warn('存储文件存在但内存中无状态数据，可能存在加载问题');
            }
        } catch (error) {
            console.error('存储完整性检查失败:', error);
        }
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

    // 统一的存储删除方法
    removeStorageItem(key) {
        try {
            // 优先使用uTools的dbStorage，如果不可用则回退到localStorage
            if (typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.removeItem) {
                utools.dbStorage.removeItem(key);
                return true;
            } else {
                localStorage.removeItem(key);
                return true;
            }
        } catch (error) {
            console.warn(`删除存储项 ${key} 失败:`, error);
            return false;
        }
    }

    // 生成模型唯一标识符
    generateModelKey(platform, modelId) {
        return `${platform}:${modelId}`;
    }

    // 模型状态数据结构
    createModelState(status = 'unknown', error = null, lastTestedAt = null) {
        return {
            status, // 'success' | 'failed' | 'testing' | 'unknown'
            error,
            lastTestedAt: lastTestedAt || Date.now(),
            updatedAt: Date.now()
        };
    }

    // 获取模型状态
    getModelStatus(platform, modelId) {
        const modelKey = this.generateModelKey(platform, modelId);
        const state = this.modelStates.get(modelKey);

        if (!state) {
            return this.createModelState('unknown');
        }

        // 永久存储，不检查过期时间
        return { ...state };
    }

    // 更新模型状态
    updateModelStatus(platform, modelId, status, error = null) {
        const modelKey = this.generateModelKey(platform, modelId);
        const oldState = this.modelStates.get(modelKey);
        const newState = this.createModelState(status, error);



        this.modelStates.set(modelKey, newState);

        // 持久化存储
        this.saveToStorage();

        // 触发状态变化事件
        this.notifyStatusChange(platform, modelId, newState, oldState);

        return newState;
    }

    // 批量更新平台下所有模型状态
    updatePlatformModelsStatus(platform, modelStatusMap) {
        const changes = [];

        for (const [modelId, { status, error }] of Object.entries(modelStatusMap)) {
            const modelKey = this.generateModelKey(platform, modelId);
            const oldState = this.modelStates.get(modelKey);
            const newState = this.createModelState(status, error);

            this.modelStates.set(modelKey, newState);
            changes.push({ platform, modelId, newState, oldState });
        }

        // 持久化存储
        this.saveToStorage();

        // 批量触发状态变化事件
        changes.forEach(({ platform, modelId, newState, oldState }) => {
            this.notifyStatusChange(platform, modelId, newState, oldState);
        });

        return changes;
    }

    // 获取平台下所有模型的状态
    getPlatformModelsStatus(platform) {
        const platformStates = {};

        for (const [modelKey, state] of this.modelStates.entries()) {
            if (modelKey.startsWith(`${platform}:`)) {
                const modelId = modelKey.substring(platform.length + 1);

                // 永久存储，不检查过期时间
                platformStates[modelId] = { ...state };
            }
        }

        return platformStates;
    }

    // 获取所有可用（连接成功）的模型，按服务商顺序排序
    getAvailableModels() {
        const availableModels = {};

        for (const [modelKey, state] of this.modelStates.entries()) {
            if (state.status === 'success') { // 移除过期检查
                const [platform, modelId] = modelKey.split(':');
                if (!availableModels[platform]) {
                    availableModels[platform] = [];
                }
                availableModels[platform].push(modelId);
            }
        }

        // 按照服务商顺序配置重新排序结果
        const orderedModels = {};
        try {
            const serviceOrder = window.ocrPlugin?.configManager?.getServiceOrder() || [
                'baidu', 'tencent', 'aliyun', 'deeplx', 'youdao', 'openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro', 'utools'
            ];

            serviceOrder.forEach(platform => {
                if (availableModels[platform]) {
                    orderedModels[platform] = availableModels[platform];
                }
            });

            // 添加任何不在顺序配置中的平台（向后兼容）
            Object.keys(availableModels).forEach(platform => {
                if (!orderedModels[platform]) {
                    orderedModels[platform] = availableModels[platform];
                }
            });

            return orderedModels;
        } catch (error) {
            console.warn('获取服务商顺序配置失败，使用默认顺序:', error);
            return availableModels;
        }
    }

    // 获取平台状态汇总
    getPlatformSummaryStatus(platform) {
        const platformStates = this.getPlatformModelsStatus(platform);
        const modelIds = Object.keys(platformStates);

        if (modelIds.length === 0) {
            return { status: 'unknown', availableCount: 0, totalCount: 0 };
        }

        let successCount = 0;
        let failedCount = 0;
        let testingCount = 0;
        let unknownCount = 0;

        modelIds.forEach(modelId => {
            const state = platformStates[modelId];
            switch (state.status) {
                case 'success':
                    successCount++;
                    break;
                case 'failed':
                    failedCount++;
                    break;
                case 'testing':
                    testingCount++;
                    break;
                default:
                    unknownCount++;
            }
        });

        const totalCount = modelIds.length;

        // 确定平台整体状态 - 按照用户需求的逻辑
        let status = 'unknown';
        if (testingCount > 0) {
            // 如果有模型正在测试中，显示测试中状态
            status = 'testing';
        } else if (successCount > 0) {
            // 如果至少有一个模型连接成功，状态为绿色可用
            status = 'success';
        } else if (failedCount > 0) {
            // 如果有模型失败（无论是否还有未测试的），状态为红色不可用
            status = 'failed';
        } else {
            // 如果所有模型都是未测试状态，或者没有模型，显示默认状态
            status = 'unknown';
        }

        const result = {
            status,
            availableCount: successCount,
            totalCount,
            successCount,
            failedCount,
            testingCount,
            unknownCount
        };

        return result;
    }

    // 清除模型状态
    clearModelStatus(platform, modelId = null) {
        if (modelId) {
            // 清除特定模型状态
            const modelKey = this.generateModelKey(platform, modelId);
            const oldState = this.modelStates.get(modelKey);

            if (this.modelStates.delete(modelKey)) {
                this.saveToStorage();
                this.notifyStatusChange(platform, modelId, null, oldState);
            }
        } else {
            // 清除平台下所有模型状态
            const keysToDelete = [];

            for (const modelKey of this.modelStates.keys()) {
                if (modelKey.startsWith(`${platform}:`)) {
                    keysToDelete.push(modelKey);
                }
            }

            keysToDelete.forEach(modelKey => {
                const modelId = modelKey.substring(platform.length + 1);
                const oldState = this.modelStates.get(modelKey);

                this.modelStates.delete(modelKey);
                this.notifyStatusChange(platform, modelId, null, oldState);
            });

            if (keysToDelete.length > 0) {
                this.saveToStorage();
            }
        }
    }

    // 清除所有状态
    clearAllStates() {
        const oldStates = new Map(this.modelStates);
        this.modelStates.clear();
        this.saveToStorage();

        // 通知所有状态被清除
        for (const [modelKey, oldState] of oldStates.entries()) {
            const [platform, modelId] = modelKey.split(':');
            this.notifyStatusChange(platform, modelId, null, oldState);
        }
    }

    // 添加状态变化监听器
    addStatusChangeListener(listener) {
        this.listeners.add(listener);

        // 返回移除监听器的函数
        return () => {
            this.listeners.delete(listener);
        };
    }

    // 移除状态变化监听器
    removeStatusChangeListener(listener) {
        this.listeners.delete(listener);
    }

    // 触发状态变化事件
    notifyStatusChange(platform, modelId, newState, oldState) {
        const event = {
            platform,
            modelId,
            newState,
            oldState,
            timestamp: Date.now()
        };

        // 如果状态从success变为其他状态，记录详细信息
        if (oldState?.status === 'success' && newState?.status !== 'success') {
            console.warn(`[状态回退警告] ${platform}:${modelId} 从成功状态回退到 ${newState?.status}`, {
                error: newState?.error,
                timestamp: new Date().toISOString()
            });
        }

        // 触发监听器
        this.listeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('状态变化监听器执行失败:', error);
            }
        });

        // 触发DOM事件（向后兼容）
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            const customEvent = new CustomEvent('modelStatusChanged', {
                detail: {
                    platform,
                    modelId,
                    status: newState?.status || 'unknown',
                    error: newState?.error,
                    oldStatus: oldState?.status,
                    timestamp: event.timestamp
                }
            });

            window.dispatchEvent(customEvent);
        }
    }

    // 从存储加载状态
    loadFromStorage() {
        try {
            let cached = this.getStorageItem(this.storageKey);
            let isBackupUsed = false;

            // 如果主存储失败，尝试备用存储
            if (!cached) {
                cached = this.getStorageItem(this.storageKey + '_backup');
                if (cached) {
                    isBackupUsed = true;
                }
            }

            if (cached) {
                const data = typeof cached === 'string' ? JSON.parse(cached) : cached;

                // 版本兼容性检查


                // 转换普通对象回Map
                if (data.modelStates) {
                    this.modelStates = new Map(Object.entries(data.modelStates));

                    // 如果使用了备用存储，尝试重新保存到主存储
                    if (isBackupUsed) {
                        setTimeout(() => {
                            this.saveToStorage();
                        }, 1000);
                    }
                }
            } else {
                // 未找到已保存的模型状态数据
                this.modelStates = new Map();
            }
        } catch (error) {
            console.warn('加载模型状态缓存失败:', error);

            // 尝试从历史记录推断曾经成功的模型
            this.recoverFromHistory();
        }
    }

    // 从历史记录中恢复部分状态信息
    recoverFromHistory() {
        try {
            // 尝试从uTools存储或localStorage获取历史记录
            let historiesStr = this.getStorageItem('ocr_histories');
            if (!historiesStr) {
                // 如果uTools存储中没有，尝试从localStorage获取（兼容性）
                historiesStr = localStorage.getItem('ocr_histories');
            }

            const histories = JSON.parse(historiesStr || '[]');
            const successfulModels = new Set();

            // 从最近的识别记录中推断哪些模型是可用的
            histories.slice(0, 50).forEach(history => { // 只看最近50条记录
                if (history.service && history.model) {
                    const aiServices = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'ocrpro', 'utools'];
                    if (aiServices.includes(history.service)) {
                        successfulModels.add(`${history.service}:${history.model}`);
                    }
                }
            });

            // 将历史上成功的模型标记为unknown状态（需要重新测试）
            let recoveredCount = 0;
            successfulModels.forEach(modelKey => {
                const [platform, modelId] = modelKey.split(':');
                if (platform && modelId) {
                    this.modelStates.set(modelKey, this.createModelState('unknown'));
                    recoveredCount++;
                }
            });

            if (recoveredCount > 0) {
                this.saveToStorage(); // 保存恢复的状态
            } else {
                // 未从历史记录中找到可恢复的模型状态
                this.modelStates = new Map();
            }
        } catch (error) {
            console.error('从历史记录恢复状态失败:', error);
            this.modelStates = new Map();
        }
    }

    // 保存状态到存储
    saveToStorage() {
        try {
            const data = {
                modelStates: Object.fromEntries(this.modelStates),
                savedAt: Date.now(), // 移除cacheTimeout，改为永久存储
                version: '1.0' // 添加版本号用于兼容性
            };

            // uTools的dbStorage可以直接存储对象，不需要JSON序列化
            const isUToolsStorage = typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem;
            const dataToStore = isUToolsStorage ? data : JSON.stringify(data);

            // 检查数据大小，避免超出存储限制
            const dataSize = isUToolsStorage ? JSON.stringify(data).length : dataToStore.length;
            if (dataSize > 4 * 1024 * 1024) { // 4MB限制
                console.warn('模型状态数据过大，尝试压缩存储');
                // 只保留成功状态的模型，减少存储大小
                const compressedStates = new Map();
                for (const [key, state] of this.modelStates.entries()) {
                    if (state.status === 'success') {
                        compressedStates.set(key, state);
                    }
                }
                data.modelStates = Object.fromEntries(compressedStates);
            }

            const success = this.setStorageItem(this.storageKey, isUToolsStorage ? data : JSON.stringify(data));

            if (!success) {
                throw new Error('存储保存失败');
            }

            // 验证保存是否成功
            const saved = this.getStorageItem(this.storageKey);
            if (!saved) {
                throw new Error('存储保存验证失败');
            }

            // 只在状态数量变化时记录保存日志
            if (!this.lastSavedCount || this.lastSavedCount !== this.modelStates.size) {
                this.lastSavedCount = this.modelStates.size;
            }

        } catch (error) {
            console.error('保存模型状态缓存失败:', error);

            // 尝试备用存储方案 - 只保存最重要的成功状态
            try {
                const essentialStates = {};
                for (const [key, state] of this.modelStates.entries()) {
                    if (state.status === 'success') {
                        essentialStates[key] = {
                            status: state.status,
                            lastTestedAt: state.lastTestedAt,
                            updatedAt: state.updatedAt
                        };
                    }
                }

                const backupData = {
                    modelStates: essentialStates,
                    savedAt: Date.now(),
                    isBackup: true
                };

                const isUToolsStorage = typeof utools !== 'undefined' && utools.dbStorage && utools.dbStorage.setItem;
                const backupDataToStore = isUToolsStorage ? backupData : JSON.stringify(backupData);

                this.setStorageItem(this.storageKey + '_backup', backupDataToStore);
            } catch (backupError) {
                console.error('备用存储也失败:', backupError);
            }
        }
    }

    // 获取缓存统计信息
    getCacheStats() {
        let successCount = 0;
        let failedCount = 0;
        let testingCount = 0;
        let unknownCount = 0;

        for (const [modelKey, state] of this.modelStates.entries()) {
            switch (state.status) {
                case 'success':
                    successCount++;
                    break;
                case 'failed':
                    failedCount++;
                    break;
                case 'testing':
                    testingCount++;
                    break;
                default:
                    unknownCount++;
            }
        }

        return {
            totalCount: this.modelStates.size,
            successCount,
            failedCount,
            testingCount,
            unknownCount
        };
    }

    // 强制刷新所有状态（标记为unknown，等待重新测试）
    forceRefreshAll() {
        for (const [modelKey, state] of this.modelStates.entries()) {
            const [platform, modelId] = modelKey.split(':');
            this.updateModelStatus(platform, modelId, 'unknown');
        }
    }
}

// 导出模型状态管理器
window.ModelStatusManager = ModelStatusManager;