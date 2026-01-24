/**
 * 统一存储管理器
 * 提供统一的存储接口，优化数据存储效率和兼容性
 */
class UnifiedStorageManager {
    constructor() {
        // 存储配置映射
        this.storageConfig = {
            // 核心配置数据 - 使用utools.db（支持版本控制和云同步）
            'ocr-config': { 
                type: 'db', 
                encrypt: false,
                description: '插件配置数据'
            },
            'ocrpro-quota': { 
                type: 'db', 
                encrypt: false,
                description: 'OCR Pro额度数据'
            },
            
            // 历史记录和缓存数据 - 使用utools.dbStorage（高性能）
            'ocr_histories': { 
                type: 'dbStorage', 
                maxSize: '500KB',
                description: 'OCR历史记录'
            },
            'translateHistory': { 
                type: 'dbStorage', 
                maxSize: '300KB',
                description: '翻译历史记录'
            },
            'ocr_service_status_cache': {
                type: 'dbStorage',
                // 移除TTL，改为永久存储，与AI模型服务保持一致
                // 只有在配置变更或连接失败时才更新状态
                description: '服务状态缓存'
            },
            'ocr_model_status_cache': {
                type: 'dbStorage',
                // 移除TTL，改为永久存储，只能通过手动操作更新
                description: '模型状态缓存（可重新生成）'
            },
            
            // 模型列表缓存 - 使用dbStorage，无TTL（手动刷新机制）
            'models_cache_openai': {
                type: 'dbStorage',
                encrypt: false,
                description: 'OpenAI模型列表缓存'
            },
            'models_cache_google': {
                type: 'dbStorage',
                encrypt: false,
                description: 'Google模型列表缓存'
            },
            'models_cache_anthropic': {
                type: 'dbStorage',
                encrypt: false,
                description: 'Anthropic模型列表缓存'
            },
            'models_cache_alibaba': {
                type: 'dbStorage',
                encrypt: false,
                description: '阿里云模型列表缓存'
            },
            'models_cache_bytedance': {
                type: 'dbStorage',
                encrypt: false,
                description: '火山引擎模型列表缓存'
            },
            'models_cache_zhipu': {
                type: 'dbStorage',
                encrypt: false,
                description: '智谱AI模型列表缓存'
            },
            'models_cache_utools': {
                type: 'dbStorage',
                encrypt: false,
                description: 'uTools模型列表缓存'
            },
            'models_cache_ocrpro': {
                type: 'dbStorage',
                encrypt: false,
                description: 'OCR Pro模型列表缓存'
            }
        };
        
        // 存储统计信息
        this.stats = {
            totalReads: 0,
            totalWrites: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0
        };
        
        // 内存缓存（用于频繁访问的数据）
        this.memoryCache = new Map();
        this.memoryCacheTTL = new Map();
        
        this.init();
    }
    
    init() {
        // 定期清理过期的内存缓存
        setInterval(() => {
            this.cleanExpiredMemoryCache();
        }, 5 * 60 * 1000); // 每5分钟清理一次
        
        // 定期清理过期的存储数据
        setInterval(() => {
            this.cleanExpiredStorageData();
        }, 60 * 60 * 1000); // 每小时清理一次
    }
    
    // 统一的获取方法（同步版本，兼容现有代码）
    getItem(key, useMemoryCache = true) {
        this.stats.totalReads++;

        try {
            // 1. 检查内存缓存
            if (useMemoryCache && this.memoryCache.has(key)) {
                const ttl = this.memoryCacheTTL.get(key);
                if (!ttl || Date.now() < ttl) {
                    this.stats.cacheHits++;
                    return this.memoryCache.get(key);
                } else {
                    // 缓存过期，清理
                    this.memoryCache.delete(key);
                    this.memoryCacheTTL.delete(key);
                }
            }

            this.stats.cacheMisses++;

            // 2. 从存储获取数据
            const config = this.storageConfig[key];
            let result = null;

            if (config) {
                switch (config.type) {
                    case 'db':
                        result = this.getFromDbSync(key);
                        break;
                    case 'dbStorage':
                        result = this.getFromDbStorageSync(key);
                        break;
                    case 'dbCryptoStorage':
                        result = this.getFromDbCryptoStorageSync(key);
                        break;
                    default:
                        result = this.fallbackGetSync(key);
                }
            } else {
                result = this.fallbackGetSync(key);
            }

            // 3. 检查TTL（模型缓存、模型状态缓存和服务状态缓存跳过TTL检查，使用手动刷新机制）
            if (result && config && config.ttl &&
                !key.startsWith('models_cache_') &&
                !key.startsWith('ocr_model_status_cache') &&
                !key.startsWith('ocr_service_status_cache')) {
                const now = Date.now();
                if (result._timestamp && (now - result._timestamp) > config.ttl) {
                    this.removeItem(key);
                    return null;
                }
            }

            // 4. 更新内存缓存
            if (useMemoryCache && result) {
                this.memoryCache.set(key, result);
                // 设置内存缓存TTL（较短，避免内存占用过多）
                this.memoryCacheTTL.set(key, Date.now() + 5 * 60 * 1000); // 5分钟
            }

            return result;

        } catch (error) {
            this.stats.errors++;
            console.error(`获取存储项 ${key} 失败:`, error);
            return null;
        }
    }
    
    // 统一的设置方法（同步版本，兼容现有代码）
    setItem(key, value, options = {}) {
        this.stats.totalWrites++;

        try {
            const config = this.storageConfig[key];
            let dataToStore = value;

            // 添加时间戳（用于TTL检查，模型缓存和模型状态缓存跳过）
            if (config && config.ttl &&
                !key.startsWith('models_cache_') &&
                !key.startsWith('ocr_model_status_cache')) {
                dataToStore = {
                    ...value,
                    _timestamp: Date.now()
                };
            }

            // 根据配置选择存储方式
            let success = false;
            if (config) {
                switch (config.type) {
                    case 'db':
                        success = this.setToDbSync(key, dataToStore);
                        break;
                    case 'dbStorage':
                        success = this.setToDbStorageSync(key, dataToStore);
                        break;
                    case 'dbCryptoStorage':
                        success = this.setToDbCryptoStorageSync(key, dataToStore);
                        break;
                    default:
                        success = this.fallbackSetSync(key, dataToStore);
                }
            } else {
                success = this.fallbackSetSync(key, dataToStore);
            }

            // 更新内存缓存
            if (success && !options.skipMemoryCache) {
                this.memoryCache.set(key, dataToStore);
                this.memoryCacheTTL.set(key, Date.now() + 5 * 60 * 1000);
            }

            return success;

        } catch (error) {
            this.stats.errors++;
            console.error(`设置存储项 ${key} 失败:`, error);
            return false;
        }
    }
    
    // 统一的删除方法（同步版本，兼容现有代码）
    removeItem(key) {
        try {
            const config = this.storageConfig[key];
            let success = false;

            if (config) {
                switch (config.type) {
                    case 'db':
                        success = this.removeFromDbSync(key);
                        break;
                    case 'dbStorage':
                        success = this.removeFromDbStorageSync(key);
                        break;
                    case 'dbCryptoStorage':
                        success = this.removeFromDbCryptoStorageSync(key);
                        break;
                    default:
                        success = this.fallbackRemoveSync(key);
                }
            } else {
                success = this.fallbackRemoveSync(key);
            }

            // 清理内存缓存
            this.memoryCache.delete(key);
            this.memoryCacheTTL.delete(key);

            return success;

        } catch (error) {
            this.stats.errors++;
            console.error(`删除存储项 ${key} 失败:`, error);
            return false;
        }
    }
    
    // utools.db 操作方法（同步版本）
    getFromDbSync(key) {
        if (typeof utools !== 'undefined' && utools.db) {
            return utools.db.get(key);
        }
        return null;
    }

    setToDbSync(key, value) {
        if (typeof utools !== 'undefined' && utools.db) {
            const dataToSave = {
                _id: key,
                ...value
            };

            // 检查是否已存在，保留_rev
            const existing = utools.db.get(key);
            if (existing && existing._rev) {
                dataToSave._rev = existing._rev;
            }

            const result = utools.db.put(dataToSave);
            return result && result.ok;
        }
        return false;
    }

    removeFromDbSync(key) {
        if (typeof utools !== 'undefined' && utools.db) {
            const result = utools.db.remove(key);
            return result && result.ok;
        }
        return false;
    }
    
    // utools.dbStorage 操作方法（同步版本）
    getFromDbStorageSync(key) {
        if (typeof utools !== 'undefined' && utools.dbStorage) {
            return utools.dbStorage.getItem(key);
        }
        return null;
    }

    setToDbStorageSync(key, value) {
        if (typeof utools !== 'undefined' && utools.dbStorage) {
            utools.dbStorage.setItem(key, value);
            return true;
        }
        return false;
    }

    removeFromDbStorageSync(key) {
        if (typeof utools !== 'undefined' && utools.dbStorage) {
            utools.dbStorage.removeItem(key);
            return true;
        }
        return false;
    }
    
    // utools.dbCryptoStorage 操作方法（同步版本）
    getFromDbCryptoStorageSync(key) {
        if (typeof utools !== 'undefined' && utools.dbCryptoStorage) {
            return utools.dbCryptoStorage.getItem(key);
        }
        return null;
    }

    setToDbCryptoStorageSync(key, value) {
        if (typeof utools !== 'undefined' && utools.dbCryptoStorage) {
            utools.dbCryptoStorage.setItem(key, value);
            return true;
        }
        return false;
    }

    removeFromDbCryptoStorageSync(key) {
        if (typeof utools !== 'undefined' && utools.dbCryptoStorage) {
            utools.dbCryptoStorage.removeItem(key);
            return true;
        }
        return false;
    }
    
    // 后备存储方法（localStorage）（同步版本）
    fallbackGetSync(key) {
        try {
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : null;
        } catch (error) {
            return localStorage.getItem(key);
        }
    }

    fallbackSetSync(key, value) {
        try {
            const dataToStore = typeof value === 'string' ? value : JSON.stringify(value);
            localStorage.setItem(key, dataToStore);
            return true;
        } catch (error) {
            return false;
        }
    }

    fallbackRemoveSync(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            return false;
        }
    }

    // 清理过期的内存缓存
    cleanExpiredMemoryCache() {
        const now = Date.now();

        for (const [key, ttl] of this.memoryCacheTTL.entries()) {
            if (now >= ttl) {
                this.memoryCache.delete(key);
                this.memoryCacheTTL.delete(key);
            }
        }
    }

    // 清理过期的存储数据
    cleanExpiredStorageData() {
        const now = Date.now();

        for (const [key, config] of Object.entries(this.storageConfig)) {
            // 跳过模型状态缓存的自动清理，只能通过手动操作更新
            if (config.ttl && !key.startsWith('ocr_model_status_cache')) {
                try {
                    const data = this.getItem(key, false); // 不使用内存缓存
                    if (data && data._timestamp && (now - data._timestamp) > config.ttl) {
                        this.removeItem(key);
                    }
                } catch (error) {
                    // 静默处理过期数据检查错误
                }
            }
        }
    }

    // 获取存储统计信息
    getStorageStats() {
        return {
            ...this.stats,
            memoryCache: {
                size: this.memoryCache.size,
                keys: Array.from(this.memoryCache.keys())
            },
            cacheHitRate: this.stats.totalReads > 0 ?
                ((this.stats.cacheHits / this.stats.totalReads) * 100).toFixed(2) + '%' : '0%'
        };
    }

    // 清理所有缓存
    clearAllCaches() {
        this.memoryCache.clear();
        this.memoryCacheTTL.clear();
    }

    // 预热缓存（预加载常用数据）
    warmupCache(keys = []) {
        const warmupKeys = keys.length > 0 ? keys : [
            'ocr-config',
            'ocr_service_status_cache',
            'ocr_model_status_cache'
        ];

        for (const key of warmupKeys) {
            try {
                this.getItem(key);
            } catch (error) {
                // 静默处理预热失败
            }
        }
    }

    // ==================== 模型列表缓存专用方法 ====================

    /**
     * 获取平台模型列表缓存
     * @param {string} platform - 平台名称 (openai, google, anthropic, alibaba, bytedance, utools, ocrpro)
     * @param {string} configHash - 配置哈希值（用于区分不同的API配置）
     * @returns {Array|null} 缓存的模型列表或null
     */
    getModelListCache(platform, configHash = '') {
        const cacheKey = this.generateModelCacheKey(platform, configHash);
        const cached = this.getItem(cacheKey, true);

        if (cached && Array.isArray(cached.models)) {
            return cached.models;
        }

        return null;
    }

    /**
     * 设置平台模型列表缓存
     * @param {string} platform - 平台名称
     * @param {Array} models - 模型列表
     * @param {string} configHash - 配置哈希值
     * @returns {boolean} 是否设置成功
     */
    setModelListCache(platform, models, configHash = '') {
        if (!Array.isArray(models)) {
            return false;
        }

        const cacheKey = this.generateModelCacheKey(platform, configHash);
        const cacheData = {
            platform,
            models,
            configHash,
            cachedAt: Date.now(),
            version: '1.0'
        };

        return this.setItem(cacheKey, cacheData);
    }

    /**
     * 清除平台模型列表缓存
     * @param {string} platform - 平台名称
     * @param {string} configHash - 配置哈希值，为空则清除该平台所有缓存
     * @returns {boolean} 是否清除成功
     */
    clearModelListCache(platform, configHash = '') {
        if (configHash) {
            // 清除特定配置的缓存
            const cacheKey = this.generateModelCacheKey(platform, configHash);
            return this.removeItem(cacheKey);
        } else {
            // 清除该平台所有缓存
            const baseKey = `models_cache_${platform}`;
            return this.removeItem(baseKey);
        }
    }

    /**
     * 生成模型缓存键
     * @param {string} platform - 平台名称
     * @param {string} configHash - 配置哈希值
     * @returns {string} 缓存键
     */
    generateModelCacheKey(platform, configHash = '') {
        const baseKey = `models_cache_${platform}`;
        return configHash ? `${baseKey}_${configHash}` : baseKey;
    }

    /**
     * 获取所有平台的模型缓存状态
     * @returns {Object} 各平台缓存状态
     */
    getModelCacheStatus() {
        const platforms = ['openai', 'google', 'anthropic', 'alibaba', 'bytedance', 'zhipu', 'utools', 'ocrpro'];
        const status = {};

        platforms.forEach(platform => {
            const cacheKey = this.generateModelCacheKey(platform);
            const cached = this.getItem(cacheKey, false);

            status[platform] = {
                hasCached: !!cached,
                modelCount: cached && cached.models ? cached.models.length : 0,
                cachedAt: cached ? cached.cachedAt : null,
                configHash: cached ? cached.configHash : null
            };
        });

        return status;
    }
}

// 创建全局实例
if (typeof window !== 'undefined') {
    window.unifiedStorage = new UnifiedStorageManager();
}

// 导出类
if (typeof window !== 'undefined') {
    window.UnifiedStorageManager = UnifiedStorageManager;
}
