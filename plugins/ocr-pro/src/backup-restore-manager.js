/**
 * 数据备份与恢复管理器
 * 提供完整的插件数据备份和恢复功能
 *
 * ============================================================================
 * 版本历史与改进说明
 * ============================================================================
 *
 * v1.0.0 (初始版本)
 * - 基于硬编码字段列表的配置拆分
 * - 问题：新增字段需要手动添加到白名单，容易遗漏
 *
 * v1.1.0 (规则驱动重构 - 2024)
 *
 * 【第一阶段：配置完整性改进】
 * 1. 重写 separateOcrConfig() 为规则驱动方式
 *    - 定义 PERSONAL_CONFIG_FIELDS 常量，只包含个人偏好字段
 *    - 其余所有字段自动归入服务配置
 *    - 解决问题：volcano、custom、customProviders、customLLMProviders、
 *               selectedTranslateModels、enableQRCodeDetection 等新字段
 *               现在会自动纳入备份
 *
 * 2. 移除硬编码字段列表
 *    - 删除 backupItems.serviceConfig.configFields
 *    - 删除 backupItems.personalSettings.configFields
 *    - 未来新增字段无需修改备份代码
 *
 * 【第二阶段：版本兼容性改进】
 * 3. 补充旧格式 data.db 的完整恢复逻辑
 *    - 支持从旧版本备份中恢复 ocr-config 等文档
 *    - 版本检查：提示用户备份版本过高时的兼容性问题
 *
 * 4. 优化分片翻译历史恢复流程
 *    - 避免重复写入分片数据
 *    - 新格式直接恢复，旧格式才调用 restoreShardedTranslateHistory()
 *
 * 5. 恢复后自动触发 ConfigManager 迁移
 *    - 确保恢复的配置结构与当前版本对齐
 *    - 自动补齐新增字段的默认值
 *
 * 【第三阶段：错误处理与安全增强】
 * 6. 错误收集机制
 *    - 新增 backupErrors 和 restoreErrors 数组
 *    - 记录每个失败项的详细信息（section、key、error）
 *    - 回调中返回错误列表，UI 可显示"部分成功"状态
 *
 * 7. 敏感数据安全提示
 *    - checkSensitiveData() 检测备份中的敏感信息
 *    - 在备份元数据中标记 containsSensitiveData
 *    - 导出时显示安全警告，提醒用户妥善保管
 *
 * 8. 自动快照与回滚支持
 *    - createAutoSnapshot() 在清空数据前自动备份
 *    - restoreAutoSnapshot() 支持从快照回滚
 *    - 降低误操作风险
 *
 * ============================================================================
 * 数据结构说明
 * ============================================================================
 *
 * 备份文件格式：
 * {
 *   format: "OCR_PRO_BACKUP",
 *   version: "1.1.0",
 *   timestamp: "2024-01-01T00:00:00.000Z",
 *   metadata: {
 *     pluginVersion: "1.0.0",
 *     utoolsVersion: "4.0.0",
 *     includeConfig: true,
 *     includePersonal: true,
 *     includeHistory: true,
 *     includeCache: true,
 *     hasErrors: false,              // 【新增】是否有备份错误
 *     errors: [],                    // 【新增】错误详情列表
 *     containsSensitiveData: true,   // 【新增】是否包含敏感数据
 *     securityWarning: "..."         // 【新增】安全警告文本
 *   },
 *   data: {
 *     serviceConfig: {               // 服务配置（包含 API Key）
 *       "ocrpro-quota": {...},
 *       "ocr-config": {...}          // 【改进】现在包含所有服务字段
 *     },
 *     personalSettings: {            // 个人设置
 *       configFields: {...},         // UI、快捷键等
 *       storageData: {...}           // 用户信息、统计等
 *     },
 *     historyData: {...},            // 历史记录（含分片）
 *     cache: {...},                  // 缓存数据
 *     db: {...},                     // 【兼容】旧格式 utools.db 数据
 *     dbStorage: {...}               // 【兼容】旧格式 dbStorage 数据
 *   }
 * }
 *
 * ============================================================================
 */
class BackupRestoreManager {
    constructor() {
        // 备份格式版本（用于版本兼容性控制）
        this.version = '1.1.0';
        this.backupFormat = 'OCR_PRO_BACKUP';

        // 验证环境支持
        this.environmentValidation = this.validateEnvironment();
        if (!this.environmentValidation.supported) {
            console.warn('备份恢复功能环境验证失败:', this.environmentValidation.issues);
        }

        // 【改进】定义个人配置字段常量（规则驱动方式）
        // 只有这些字段会被归类为个人设置，其余所有字段自动归入服务配置
        // 未来新增个人偏好字段时，只需在此添加即可
        this.PERSONAL_CONFIG_FIELDS = ['ui', 'shortcuts'];

        // 定义需要备份的数据项
        this.backupItems = {
            // 核心配置数据（utools.db）- 仅包含服务商配置和API密钥
            coreConfig: [
                'ocrpro-quota'
            ],
            // 【改进】移除硬编码的 serviceConfig.configFields
            // 现在通过 separateOcrConfig() 的规则自动拆分，无需维护字段列表
            serviceConfig: {
                // 保留此对象结构以兼容现有代码，但不再使用 configFields
            },
            // 个人设置（包含个人偏好设置和个人使用信息）
            personalSettings: {
                // 【改进】移除硬编码的 configFields，改用 PERSONAL_CONFIG_FIELDS 常量
                // 这些数据存储在utools.dbStorage中
                storageKeys: [
                    'personalSettings',
                    'translateLanguageSettings',
                    'userInfo',
                    'utoolsUserInfo',
                    'utoolsUserInfoInitialized',
                    'usageStats',
                    'miniTranslate_selectedModels',  // 小窗翻译模型选择状态
                    // 【修复】添加缺失的个人偏好设置键
                    'themeMode',                     // 主题模式（亮色/暗色）
                    'lastConfigPage',                // 最后访问的配置页面
                    'lastBaseConfigSection',         // 最后访问的基础配置区域
                    'lastSelectedModelService',      // 最后选择的模型服务
                    'lastActiveServiceCategory',     // 最后激活的服务分类
                    'imageTranslate_selectedService' // 图片翻译选择的服务
                ]
            },
            // 历史记录数据（utools.dbStorage）
            historyData: [
                'ocr_histories',
                'translateHistory'
            ],
            // 可选的缓存数据（用户可选择是否包含）
            // 【重要】使用 UnifiedStorageManager 的新命名规范：models_cache_{platform}
            cache: [
                'ocr_service_status_cache',
                'ocr_model_status_cache',
                // 模型列表缓存（新格式：models_cache_{platform}）
                'models_cache_openai',
                'models_cache_google',
                'models_cache_anthropic',
                'models_cache_alibaba',
                'models_cache_bytedance',
                'models_cache_zhipu',      // 【修复】使用正确的 key 名称
                'models_cache_utools',
                'models_cache_ocrpro'
            ]
        };

        this.callbacks = {
            onProgress: null,
            onSuccess: null,
            onError: null
        };

        // 【新增】错误收集器（用于汇总备份/恢复过程中的失败项）
        this.backupErrors = [];
        this.restoreErrors = [];
    }

    /**
     * 创建完整备份
     * @param {Object} options 备份选项
     * @param {boolean} options.includeConfig 是否包含服务配置数据
     * @param {boolean} options.includePersonal 是否包含个人设置（包含个人偏好和使用信息）
     * @param {boolean} options.includeHistory 是否包含历史记录
     * @param {boolean} options.includeCache 是否包含缓存数据
     * @returns {Promise<Object>} 备份数据对象
     */
    async createBackup(options = {}) {
        const {
            includeConfig = true,
            includePersonal = true,
            includeHistory = true,
            includeCache = true
        } = options;

        try {
            // 【新增】清空错误收集器
            this.backupErrors = [];

            this.updateProgress('开始创建备份...', 0);

            const backupData = {
                format: this.backupFormat,
                version: this.version,
                timestamp: new Date().toISOString(),
                metadata: {
                    pluginVersion: this.getPluginVersion(),
                    utoolsVersion: this.getUtoolsVersion(),
                    includeConfig,
                    includePersonal,
                    includeHistory,
                    includeCache
                },
                data: {}
            };

            // 计算总项目数
            let totalItems = 0;
            if (includeConfig) totalItems += this.backupItems.coreConfig.length + 1; // +1 for ocr-config service part
            if (includePersonal) totalItems += this.backupItems.personalSettings.storageKeys.length + 1; // +1 for ocr-config personal part
            if (includeHistory) totalItems += this.backupItems.historyData.length + 5; // +5 for sharded data estimation
            if (includeCache) totalItems += this.backupItems.cache.length;

            let processedItems = 0;

            // 备份服务配置数据（从ocr-config中分离）
            if (includeConfig) {
                this.updateProgress('备份服务配置数据...', 10);
                backupData.data.serviceConfig = {};

                // 备份核心配置项
                for (const key of this.backupItems.coreConfig) {
                    try {
                        const data = await this.getDbData(key);
                        if (data) {
                            backupData.data.serviceConfig[key] = data;
                        }
                        processedItems++;
                        this.updateProgress(`备份配置: ${key}`, 10 + (processedItems / totalItems) * 15);
                    } catch (error) {
                        console.warn(`备份配置项 ${key} 失败:`, error);
                        // 【新增】记录错误
                        this.backupErrors.push({
                            section: 'serviceConfig',
                            key: key,
                            error: error.message || String(error)
                        });
                    }
                }

                // 【改进】备份ocr-config中的服务配置部分
                // 现在使用规则驱动的 separateOcrConfig()，自动包含所有服务相关字段
                try {
                    const ocrConfig = await this.getDbData('ocr-config');
                    if (ocrConfig) {
                        const { serviceConfig } = this.separateOcrConfig(ocrConfig);
                        backupData.data.serviceConfig['ocr-config'] = serviceConfig;
                    }
                    processedItems++;
                    this.updateProgress('备份服务配置: ocr-config', 10 + (processedItems / totalItems) * 15);
                } catch (error) {
                    console.warn('备份ocr-config服务配置失败:', error);
                    // 【新增】记录错误
                    this.backupErrors.push({
                        section: 'serviceConfig',
                        key: 'ocr-config',
                        error: error.message || String(error)
                    });
                }
            }

            // 备份个人设置（包含个人偏好设置和个人使用信息）
            if (includePersonal) {
                this.updateProgress('备份个人设置...', 25);
                backupData.data.personalSettings = {};

                // 备份ocr-config中的个人设置部分
                try {
                    const ocrConfig = await this.getDbData('ocr-config');
                    if (ocrConfig) {
                        const { personalPreferences } = this.separateOcrConfig(ocrConfig);
                        backupData.data.personalSettings.configFields = personalPreferences;
                    }
                    processedItems++;
                    this.updateProgress('备份个人设置: UI设置和快捷键', 25 + (processedItems / totalItems) * 25);
                } catch (error) {
                    console.warn('备份个人设置失败:', error);
                }

                // 备份dbStorage中的个人设置
                backupData.data.personalSettings.storageData = {};
                for (const key of this.backupItems.personalSettings.storageKeys) {
                    try {
                        const data = await this.getDbStorageData(key);
                        if (data) {
                            backupData.data.personalSettings.storageData[key] = data;
                        }
                        processedItems++;
                        this.updateProgress(`备份个人设置: ${key}`, 25 + (processedItems / totalItems) * 25);
                    } catch (error) {
                        console.warn(`备份个人设置 ${key} 失败:`, error);
                    }
                }
            }

            // 备份历史记录数据
            if (includeHistory) {
                this.updateProgress('备份历史记录数据...', 50);
                backupData.data.historyData = {};

                // 备份明确的历史记录项
                for (const key of this.backupItems.historyData) {
                    try {
                        const data = await this.getDbStorageData(key);
                        if (data) {
                            backupData.data.historyData[key] = data;
                        }
                        processedItems++;
                        this.updateProgress(`备份历史: ${key}`, 50 + (processedItems / totalItems) * 20);
                    } catch (error) {
                        console.warn(`备份历史记录 ${key} 失败:`, error);
                    }
                }

                // 备份分片存储的翻译历史记录
                await this.backupShardedTranslateHistory(backupData);
                processedItems += 5; // 估算分片备份的进度
                this.updateProgress('备份分片历史记录...', 50 + (processedItems / totalItems) * 20);
            }

            // 备份动态键名的数据（如首次使用标志）
            if (includePersonal) {
                try {
                    const dynamicKeys = await this.getDynamicKeys();
                    for (const key of dynamicKeys) {
                        try {
                            const data = await this.getDbStorageData(key);
                            if (data) {
                                if (!backupData.data.personalSettings) {
                                    backupData.data.personalSettings = {};
                                }
                                if (!backupData.data.personalSettings.storageData) {
                                    backupData.data.personalSettings.storageData = {};
                                }
                                backupData.data.personalSettings.storageData[key] = data;
                            }
                        } catch (error) {
                            console.warn(`备份动态键 ${key} 失败:`, error);
                        }
                    }
                } catch (error) {
                    console.warn('获取动态键失败:', error);
                }
            }

            // 备份缓存数据（可选）
            if (includeCache) {
                this.updateProgress('备份缓存数据...', 75);
                backupData.data.cache = {};
                for (const key of this.backupItems.cache) {
                    try {
                        const data = await this.getDbStorageData(key);
                        if (data) {
                            backupData.data.cache[key] = data;
                        }
                        processedItems++;
                        this.updateProgress(`备份缓存: ${key}`, 75 + (processedItems / totalItems) * 20);
                    } catch (error) {
                        console.warn(`备份缓存数据 ${key} 失败:`, error);
                    }
                }
            }

            this.updateProgress('备份完成', 100);

            // 验证备份数据完整性
            this.validateBackupData(backupData);

            // 【新增】在备份数据中附加错误信息（如果有）
            if (this.backupErrors.length > 0) {
                backupData.metadata.errors = this.backupErrors;
                backupData.metadata.hasErrors = true;
                console.warn(`备份完成，但有 ${this.backupErrors.length} 项失败:`, this.backupErrors);
            }

            if (this.callbacks.onSuccess) {
                // 【改进】回调中包含错误信息，让UI可以显示"部分成功"
                this.callbacks.onSuccess(backupData, this.backupErrors);
            }

            return backupData;

        } catch (error) {
            console.error('创建备份失败:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    /**
     * 恢复备份数据
     *
     * 【改进】增强版本兼容性和错误处理：
     * - 支持旧格式备份（data.db / data.dbStorage）
     * - 检查备份版本，给出兼容性提示
     * - 收集恢复过程中的错误，返回详细失败信息
     *
     * @param {Object} backupData 备份数据对象
     * @param {Object} options 恢复选项
     * @returns {Promise<boolean>} 恢复是否成功
     */
    async restoreBackup(backupData, options = {}) {
        const {
            restoreConfig = true,
            restorePersonal = true,
            restoreHistory = true,
            restoreCache = true,
            clearExisting = false
        } = options;

        try {
            // 【新增】清空错误收集器
            this.restoreErrors = [];

            this.updateProgress('开始恢复备份...', 0);

            // 验证备份数据（简化版本，只检查基本格式）
            if (!backupData || !backupData.data) {
                throw new Error('无效的备份数据格式');
            }

            // 【新增】版本兼容性检查
            if (backupData.version) {
                const backupVersion = parseFloat(backupData.version);
                const currentVersion = parseFloat(this.version);

                if (backupVersion > currentVersion) {
                    console.warn(`备份版本 (${backupData.version}) 高于当前支持版本 (${this.version})，可能存在兼容性问题`);
                    // 不阻止恢复，但记录警告
                    this.restoreErrors.push({
                        section: 'version',
                        key: 'compatibility',
                        error: `备份版本较新 (${backupData.version})，建议升级插件后再恢复`
                    });
                }
            }

            // 计算总步骤数
            let totalSteps = 0;
            if (restoreConfig && backupData.data.serviceConfig) totalSteps += Object.keys(backupData.data.serviceConfig).length;
            if (restorePersonal && backupData.data.personalSettings) {
                totalSteps += (backupData.data.personalSettings.storageData ? Object.keys(backupData.data.personalSettings.storageData).length : 0) + 1; // +1 for config fields
            }
            if (restoreHistory && backupData.data.historyData) totalSteps += Object.keys(backupData.data.historyData).length;
            if (restoreCache && backupData.data.cache) totalSteps += Object.keys(backupData.data.cache).length;

            // 【改进】兼容旧格式 - 增加对 data.db 的完整支持
            if (restoreConfig && backupData.data.db) totalSteps += Object.keys(backupData.data.db).length;
            if ((restorePersonal || restoreHistory) && backupData.data.dbStorage) totalSteps += Object.keys(backupData.data.dbStorage).length;

            let processedSteps = 0;

            // 清除现有数据（如果选择）
            if (clearExisting) {
                this.updateProgress('清除现有数据...', 5);
                await this.clearExistingData();
            }

            // 【改进】恢复服务配置数据（新格式）
            if (restoreConfig && backupData.data.serviceConfig) {
                this.updateProgress('恢复服务配置数据...', 10);

                // 处理ocr-config的服务配置部分
                let currentOcrConfig = null;
                if (backupData.data.serviceConfig['ocr-config']) {
                    try {
                        // 获取当前的ocr-config（如果存在）
                        currentOcrConfig = await this.getDbData('ocr-config');

                        // 如果需要保留个人设置，先分离出来
                        let personalPreferences = {};
                        if (currentOcrConfig && !restorePersonal) {
                            const separated = this.separateOcrConfig(currentOcrConfig);
                            personalPreferences = separated.personalPreferences;
                        }

                        // 【改进】从备份的服务配置中分离出纯服务配置部分
                        // 使用新的规则驱动 separateOcrConfig()，确保所有字段都能正确恢复
                        const backupServiceConfig = backupData.data.serviceConfig['ocr-config'];
                        const { serviceConfig: pureServiceConfig } = this.separateOcrConfig(backupServiceConfig);

                        // 合并纯服务配置和个人设置
                        const mergedConfig = this.mergeOcrConfig(personalPreferences, pureServiceConfig);

                        await this.setDbData('ocr-config', mergedConfig);
                        processedSteps++;
                        this.updateProgress('恢复服务配置: ocr-config', 10 + (processedSteps / totalSteps) * 15);
                    } catch (error) {
                        console.error('恢复ocr-config服务配置失败:', error);
                        // 【新增】记录错误
                        this.restoreErrors.push({
                            section: 'serviceConfig',
                            key: 'ocr-config',
                            error: error.message || String(error)
                        });
                    }
                }

                // 恢复其他配置项
                for (const [key, data] of Object.entries(backupData.data.serviceConfig)) {
                    if (key !== 'ocr-config') {
                        try {
                            await this.setDbData(key, data);
                            processedSteps++;
                            this.updateProgress(`恢复配置: ${key}`, 10 + (processedSteps / totalSteps) * 15);
                        } catch (error) {
                            console.error(`恢复配置项 ${key} 失败:`, error);
                            // 【新增】记录错误
                            this.restoreErrors.push({
                                section: 'serviceConfig',
                                key: key,
                                error: error.message || String(error)
                            });
                        }
                    }
                }
            }

            // 恢复个人设置（包含个人偏好设置和个人使用信息）
            if (restorePersonal && backupData.data.personalSettings) {
                this.updateProgress('恢复个人设置...', 25);

                // 恢复ocr-config中的个人设置部分
                if (backupData.data.personalSettings.configFields) {
                    try {
                        // 获取当前的ocr-config
                        let currentOcrConfig = await this.getDbData('ocr-config');
                        if (!currentOcrConfig) {
                            currentOcrConfig = { _id: 'ocr-config' };
                        }

                        // 分离当前配置
                        const { serviceConfig } = this.separateOcrConfig(currentOcrConfig);

                        // 合并新的个人设置
                        const mergedConfig = this.mergeOcrConfig(backupData.data.personalSettings.configFields, serviceConfig);

                        await this.setDbData('ocr-config', mergedConfig);
                        processedSteps++;
                        this.updateProgress('恢复个人设置: UI设置和快捷键', 25 + (processedSteps / totalSteps) * 25);
                    } catch (error) {
                        console.error('恢复个人设置失败:', error);
                    }
                }

                // 恢复dbStorage中的个人设置
                if (backupData.data.personalSettings.storageData) {
                    for (const [key, data] of Object.entries(backupData.data.personalSettings.storageData)) {
                        try {
                            await this.setDbStorageData(key, data);
                            processedSteps++;
                            this.updateProgress(`恢复个人设置: ${key}`, 25 + (processedSteps / totalSteps) * 25);
                        } catch (error) {
                            console.error(`恢复个人设置 ${key} 失败:`, error);
                        }
                    }
                }
            }

            // 【新增】恢复旧格式 data.db 中的配置数据
            // 旧版本备份可能将 ocr-config 等文档存储在 data.db 中
            if (restoreConfig && backupData.data.db) {
                this.updateProgress('恢复旧格式配置数据...', 25);

                for (const [key, doc] of Object.entries(backupData.data.db)) {
                    try {
                        // 特殊处理 ocr-config：如果新格式中没有，则使用旧格式
                        if (key === 'ocr-config') {
                            // 检查是否已经从新格式恢复过
                            const alreadyRestored = backupData.data.serviceConfig &&
                                backupData.data.serviceConfig['ocr-config'];

                            if (!alreadyRestored) {
                                // 新格式中没有，使用旧格式整体恢复
                                await this.setDbData(key, doc);
                                console.log('从旧格式 data.db 恢复 ocr-config');
                            }
                        } else {
                            // 其他配置项直接恢复
                            await this.setDbData(key, doc);
                        }

                        processedSteps++;
                        this.updateProgress(`恢复旧格式配置: ${key}`, 25 + (processedSteps / totalSteps) * 10);
                    } catch (error) {
                        console.error(`恢复旧格式配置 ${key} 失败:`, error);
                        // 【新增】记录错误
                        this.restoreErrors.push({
                            section: 'db (legacy)',
                            key: key,
                            error: error.message || String(error)
                        });
                    }
                }
            }

            // 【改进】恢复历史记录数据（新格式）
            // 优化分片恢复流程，避免重复写入
            if (restoreHistory && backupData.data.historyData) {
                this.updateProgress('恢复历史记录数据...', 50);

                // 检查是否存在分片翻译历史
                const hasShardedHistory = backupData.data.historyData['translateHistory_index'];
                const shardKeys = new Set();

                if (hasShardedHistory) {
                    // 收集所有分片相关的 key
                    const index = typeof backupData.data.historyData['translateHistory_index'] === 'string'
                        ? JSON.parse(backupData.data.historyData['translateHistory_index'])
                        : backupData.data.historyData['translateHistory_index'];

                    if (index && index.shards) {
                        shardKeys.add('translateHistory_index');
                        if (index.shards.text) index.shards.text.forEach(k => shardKeys.add(k));
                        if (index.shards.imageMeta) index.shards.imageMeta.forEach(k => shardKeys.add(k));
                        if (index.shards.imageData) index.shards.imageData.forEach(k => shardKeys.add(k));
                    }
                }

                // 恢复所有历史数据（包括分片）
                for (const [key, data] of Object.entries(backupData.data.historyData)) {
                    try {
                        await this.setDbStorageData(key, data);
                        processedSteps++;
                        this.updateProgress(`恢复历史: ${key}`, 50 + (processedSteps / totalSteps) * 15);
                    } catch (error) {
                        console.error(`恢复历史记录 ${key} 失败:`, error);
                        // 【新增】记录错误
                        this.restoreErrors.push({
                            section: 'historyData',
                            key: key,
                            error: error.message || String(error)
                        });
                    }
                }

                // 【优化】只在旧格式（data.dbStorage）中调用分片恢复
                // 新格式已经在上面的循环中恢复完成，无需重复
                if (!hasShardedHistory && backupData.data.dbStorage) {
                    this.updateProgress('恢复分片存储翻译历史记录...', 65);
                    await this.restoreShardedTranslateHistory(backupData);
                }
            }

            // 兼容旧格式：恢复个人使用信息和历史记录数据
            if ((restorePersonal || restoreHistory) && backupData.data.dbStorage) {
                const personalDataKeys = ['userInfo', 'usageStats', 'personalSettings', 'utoolsUserInfo', 'utoolsUserInfoInitialized', 'translateLanguageSettings'];
                const historyDataKeys = ['ocr_histories', 'translateHistory'];

                if (restorePersonal) {
                    this.updateProgress('恢复个人使用信息...', 35);
                }
                if (restoreHistory) {
                    this.updateProgress('恢复历史记录数据...', 50);
                }

                for (const [key, data] of Object.entries(backupData.data.dbStorage)) {
                    const isPersonalData = personalDataKeys.includes(key) || key.startsWith('isFirstTimeUser_');
                    const isHistoryData = historyDataKeys.includes(key);
                    const isShardedData = key.startsWith('translateHistory_');

                    // 根据选项决定是否恢复该数据
                    const shouldRestore = (restorePersonal && isPersonalData) ||
                        (restoreHistory && (isHistoryData || isShardedData || (!isPersonalData && !isHistoryData)));

                    if (shouldRestore) {
                        try {
                            await this.setDbStorageData(key, data);
                            processedSteps++;
                            const progressBase = restorePersonal && isPersonalData ? 35 : 50;
                            this.updateProgress(`恢复数据: ${key}`, progressBase + (processedSteps / totalSteps) * 20);
                        } catch (error) {
                            console.error(`恢复数据 ${key} 失败:`, error);
                        }
                    }
                }

                // 恢复分片存储的翻译历史记录
                if (restoreHistory) {
                    this.updateProgress('恢复分片存储翻译历史记录...', 65);
                    await this.restoreShardedTranslateHistory(backupData);
                }
            }

            // 恢复缓存数据
            if (restoreCache && backupData.data.cache) {
                this.updateProgress('恢复缓存数据...', 75);
                for (const [key, data] of Object.entries(backupData.data.cache)) {
                    try {
                        await this.setDbStorageData(key, data);
                        processedSteps++;
                        this.updateProgress(`恢复缓存: ${key}`, 75 + (processedSteps / totalSteps) * 20);
                    } catch (error) {
                        console.error(`恢复缓存数据 ${key} 失败:`, error);
                        // 【新增】记录错误
                        this.restoreErrors.push({
                            section: 'cache',
                            key: key,
                            error: error.message || String(error)
                        });
                    }
                }
            }

            this.updateProgress('恢复完成', 100);

            // 【新增】触发 ConfigManager 迁移（如果可用）
            // 确保恢复后的配置结构与当前版本对齐
            try {
                if (typeof window !== 'undefined' && window.ocrPlugin && window.ocrPlugin.configManager) {
                    console.log('触发配置迁移以对齐新版本字段...');
                    const config = window.ocrPlugin.configManager.getConfig();
                    window.ocrPlugin.configManager.saveConfig(config);
                }
            } catch (error) {
                console.warn('配置迁移失败（非致命错误）:', error);
            }

            // 【新增】在恢复结果中附加错误信息（如果有）
            const hasErrors = this.restoreErrors.length > 0;
            if (hasErrors) {
                console.warn(`恢复完成，但有 ${this.restoreErrors.length} 项失败:`, this.restoreErrors);
            }

            if (this.callbacks.onSuccess) {
                // 【改进】回调中包含错误信息，让UI可以显示"部分成功"
                this.callbacks.onSuccess({ hasErrors, errors: this.restoreErrors });
            }

            return true;

        } catch (error) {
            console.error('恢复备份失败:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError(error);
            }
            throw error;
        }
    }

    /**
     * 导出备份到文件
     *
     * 【改进】增加安全提示，提醒用户备份文件包含敏感信息
     *
     * @param {Object} backupData 备份数据
     * @param {string} filename 文件名
     */
    async exportBackupToFile(backupData, filename) {
        try {
            // 【新增】安全提示
            if (backupData.metadata && backupData.metadata.containsSensitiveData) {
                console.warn('⚠️ 安全提示：备份文件包含敏感信息（API 密钥、历史记录等），请妥善保管');

                // 如果在浏览器环境中，可以通过 UI 显示警告
                if (typeof window !== 'undefined' && window.ocrPlugin && window.ocrPlugin.showToast) {
                    window.ocrPlugin.showToast(
                        '备份文件包含敏感信息，请妥善保管，不要上传到公开位置',
                        'warning'
                    );
                }
            }

            const jsonString = JSON.stringify(backupData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });

            // 创建下载链接
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || `ocr-pro-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            return true;
        } catch (error) {
            console.error('导出备份文件失败:', error);
            throw error;
        }
    }

    /**
     * 从文件导入备份
     * @param {File} file 备份文件
     * @returns {Promise<Object>} 备份数据对象
     */
    async importBackupFromFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const backupData = JSON.parse(e.target.result);
                    this.validateBackupData(backupData);
                    resolve(backupData);
                } catch (error) {
                    reject(new Error('备份文件格式无效: ' + error.message));
                }
            };
            reader.onerror = () => reject(new Error('读取备份文件失败'));
            reader.readAsText(file);
        });
    }

    // 辅助方法
    async getDbData(key) {
        if (typeof utools !== 'undefined' && utools.db) {
            return utools.db.get(key);
        }
        return null;
    }

    /**
     * 【改进】从ocr-config中分离个人设置和服务配置（规则驱动方式）
     *
     * 改进说明：
     * - 旧版本：基于硬编码的字段白名单（configFields）进行拆分
     *   问题：新增字段（volcano、custom、customProviders、selectedTranslateModels等）
     *        不在白名单中，会被静默丢弃，导致备份不完整
     *
     * - 新版本：基于规则自动拆分所有字段
     *   规则：只有 PERSONAL_CONFIG_FIELDS 中的字段归入个人设置，
     *        其余所有字段（除 _id/_rev）自动归入服务配置
     *   优势：新增任何顶层字段都会自动纳入备份，无需手动维护白名单
     *
     * @param {Object} ocrConfig 完整的ocr-config数据
     * @returns {Object} 分离后的配置对象 { personalPreferences, serviceConfig }
     */
    separateOcrConfig(ocrConfig) {
        if (!ocrConfig) return { personalPreferences: {}, serviceConfig: {} };

        const personalPreferences = {};
        const serviceConfig = {};

        // 遍历 ocrConfig 的所有顶层 key，按规则自动分类
        for (const key in ocrConfig) {
            if (!ocrConfig.hasOwnProperty(key)) continue;

            // 规则1：以下划线开头的内部字段（_id, _rev）归入 serviceConfig
            if (key.startsWith('_')) {
                serviceConfig[key] = ocrConfig[key];
                continue;
            }

            // 规则2：在 PERSONAL_CONFIG_FIELDS 中的字段归入个人设置
            if (this.PERSONAL_CONFIG_FIELDS.includes(key)) {
                personalPreferences[key] = ocrConfig[key];
                continue;
            }

            // 规则3：其余所有字段归入服务配置
            // 包括但不限于：
            // - service, configVersion
            // - 各云厂商配置：baidu, tencent, aliyun, volcano, deeplx, youdao
            // - AI平台配置：openai, anthropic, google, alibaba, bytedance, zhipu, ocrpro, utools
            // - 自定义配置：custom, customProviders, customLLMProviders
            // - 识别模式：recognitionModes
            // - 翻译相关：translateModels, selectedTranslateModels, currentTranslateModel
            // - 服务顺序：serviceOrder
            // - 功能开关：enableQRCodeDetection, continueOCRAfterQRCode
            // - 未来新增的任何其他字段
            serviceConfig[key] = ocrConfig[key];
        }

        return { personalPreferences, serviceConfig };
    }

    /**
     * 合并个人偏好设置和服务配置为完整的ocr-config
     * @param {Object} personalPreferences 个人偏好设置
     * @param {Object} serviceConfig 服务配置
     * @returns {Object} 合并后的ocr-config
     */
    mergeOcrConfig(personalPreferences, serviceConfig) {
        const merged = { ...serviceConfig };

        // 合并个人偏好设置
        Object.keys(personalPreferences).forEach(field => {
            merged[field] = personalPreferences[field];
        });

        return merged;
    }

    async setDbData(key, data) {
        if (typeof utools !== 'undefined' && utools.db) {
            const dataToSave = { _id: key, ...data };

            // 如果数据中没有_rev，尝试获取现有记录的_rev
            if (!dataToSave._rev) {
                try {
                    const existing = utools.db.get(key);
                    if (existing && existing._rev) {
                        dataToSave._rev = existing._rev;
                    }
                } catch (error) {
                    // 记录不存在，继续保存
                }
            }

            return utools.db.put(dataToSave);
        }
        return false;
    }

    async getDbStorageData(key) {
        if (typeof utools !== 'undefined' && utools.dbStorage) {
            return utools.dbStorage.getItem(key);
        }
        return null;
    }

    async setDbStorageData(key, data) {
        if (typeof utools !== 'undefined' && utools.dbStorage) {
            utools.dbStorage.setItem(key, data);
            return true;
        }
        return false;
    }

    validateBackupData(backupData) {
        if (!backupData || typeof backupData !== 'object') {
            throw new Error('备份数据格式无效');
        }

        if (!backupData.data) {
            throw new Error('备份数据不完整');
        }

        // 检查是否有数据容器（支持新旧格式）
        const hasNewFormatData = backupData.data.serviceConfig || backupData.data.personalSettings ||
            backupData.data.historyData || backupData.data.cache;
        const hasOldFormatData = backupData.data.db || backupData.data.dbStorage;

        if (!hasNewFormatData && !hasOldFormatData) {
            throw new Error('备份文件中没有有效数据');
        }

        // 【新增】安全提示：检查备份中是否包含敏感数据
        const hasSensitiveData = this.checkSensitiveData(backupData);
        if (hasSensitiveData) {
            // 在备份元数据中标记包含敏感信息
            if (!backupData.metadata) {
                backupData.metadata = {};
            }
            backupData.metadata.containsSensitiveData = true;
            backupData.metadata.securityWarning = '此备份文件包含 API 密钥和历史记录等敏感信息，请妥善保管，不要上传到公开位置';
        }
    }

    /**
     * 【新增】检查备份数据中是否包含敏感信息
     * @param {Object} backupData 备份数据
     * @returns {boolean} 是否包含敏感数据
     */
    checkSensitiveData(backupData) {
        // 检查是否包含服务配置（通常包含 API Key）
        if (backupData.data.serviceConfig || backupData.data.db) {
            return true;
        }

        // 检查是否包含历史记录（可能包含敏感文本/图片）
        if (backupData.data.historyData || backupData.data.dbStorage) {
            return true;
        }

        // 检查是否包含个人设置（可能包含用户信息）
        if (backupData.data.personalSettings) {
            return true;
        }

        return false;
    }

    /**
     * 【改进】清除现有数据
     *
     * 改进说明：
     * - 在清除前自动创建快照（如果启用）
     * - 提供更详细的清除日志
     *
     * @param {Object} options 清除选项
     * @param {boolean} options.createSnapshot 是否在清除前创建自动快照（默认 true）
     * @returns {Promise<Object|null>} 返回创建的快照（如果有）
     */
    async clearExistingData(options = {}) {
        const { createSnapshot = true } = options;

        let snapshot = null;

        // 【新增】在清除前创建自动快照
        if (createSnapshot) {
            try {
                snapshot = await this.createAutoSnapshot();
                console.log('已创建自动快照，可用于回滚');
            } catch (error) {
                console.warn('创建自动快照失败，继续清除操作:', error);
            }
        }

        // 清除核心配置数据（utools.db）
        for (const key of this.backupItems.coreConfig) {
            try {
                if (typeof utools !== 'undefined' && utools.db) {
                    utools.db.remove(key);
                }
            } catch (error) {
                console.warn(`清除核心配置 ${key} 失败:`, error);
            }
        }

        // 清除ocr-config数据
        try {
            if (typeof utools !== 'undefined' && utools.db) {
                utools.db.remove('ocr-config');
            }
        } catch (error) {
            console.warn('清除ocr-config失败:', error);
        }

        // 清除个人设置数据（utools.dbStorage）
        for (const key of this.backupItems.personalSettings.storageKeys) {
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    utools.dbStorage.removeItem(key);
                }
            } catch (error) {
                console.warn(`清除个人设置 ${key} 失败:`, error);
            }
        }

        // 清除历史记录数据（utools.dbStorage）
        for (const key of this.backupItems.historyData) {
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    utools.dbStorage.removeItem(key);
                }
            } catch (error) {
                console.warn(`清除历史记录 ${key} 失败:`, error);
            }
        }

        // 清除缓存数据（utools.dbStorage）
        for (const key of this.backupItems.cache) {
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    utools.dbStorage.removeItem(key);
                }
            } catch (error) {
                console.warn(`清除缓存数据 ${key} 失败:`, error);
            }
        }

        // 清除分片存储的翻译历史记录
        await this.clearShardedTranslateHistory();

        return snapshot;
    }

    /**
     * 清除分片存储的翻译历史记录
     */
    async clearShardedTranslateHistory() {
        try {
            // 获取分片存储索引
            const indexKey = 'translateHistory_index';
            const shardIndex = await this.getDbStorageData(indexKey);

            if (!shardIndex) {
                return; // 没有分片存储数据
            }

            // 解析索引数据
            const index = typeof shardIndex === 'string' ? JSON.parse(shardIndex) : shardIndex;

            if (index && index.shards) {
                // 清除文本分片
                if (index.shards.text && Array.isArray(index.shards.text)) {
                    for (const shardKey of index.shards.text) {
                        try {
                            if (typeof utools !== 'undefined' && utools.dbStorage) {
                                utools.dbStorage.removeItem(shardKey);
                            }
                        } catch (error) {
                            console.warn(`清除文本分片 ${shardKey} 失败:`, error);
                        }
                    }
                }

                // 清除图片元数据分片
                if (index.shards.imageMeta && Array.isArray(index.shards.imageMeta)) {
                    for (const shardKey of index.shards.imageMeta) {
                        try {
                            if (typeof utools !== 'undefined' && utools.dbStorage) {
                                utools.dbStorage.removeItem(shardKey);
                            }
                        } catch (error) {
                            console.warn(`清除图片元数据分片 ${shardKey} 失败:`, error);
                        }
                    }
                }

                // 清除图片数据分片
                if (index.shards.imageData && Array.isArray(index.shards.imageData)) {
                    for (const imageKey of index.shards.imageData) {
                        try {
                            if (typeof utools !== 'undefined' && utools.dbStorage) {
                                utools.dbStorage.removeItem(imageKey);
                            }
                        } catch (error) {
                            console.warn(`清除图片数据 ${imageKey} 失败:`, error);
                        }
                    }
                }
            }

            // 最后清除索引
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    utools.dbStorage.removeItem(indexKey);
                }
            } catch (error) {
                console.warn(`清除分片存储索引失败:`, error);
            }


        } catch (error) {
            console.error('清除分片存储翻译历史记录失败:', error);
        }
    }

    getPluginVersion() {
        // 从plugin.json或其他地方获取插件版本
        return '1.0.0'; // 占位符
    }

    getUtoolsVersion() {
        if (typeof utools !== 'undefined' && utools.getVersion) {
            return utools.getVersion();
        }
        return 'unknown';
    }

    updateProgress(message, percentage) {
        this._triggerProgress(message, percentage);
    }

    // 设置回调函数
    setCallbacks(callbacks) {
        this.callbacks = { ...this.callbacks, ...callbacks };
    }

    /**
     * 获取备份信息摘要
     *
     * 【改进】增加错误信息和安全警告的展示
     *
     * @param {Object} backupData 备份数据
     * @returns {Object} 备份信息摘要
     */
    getBackupSummary(backupData) {
        if (!backupData || !backupData.data) {
            return null;
        }

        const summary = {
            version: backupData.version,
            timestamp: backupData.timestamp,
            metadata: backupData.metadata,
            items: {
                config: 0,
                personal: 0,
                history: 0,
                cache: 0
            },
            size: {
                total: 0,
                config: 0,
                personal: 0,
                history: 0,
                cache: 0
            },
            // 【新增】错误和警告信息
            hasErrors: backupData.metadata?.hasErrors || false,
            errors: backupData.metadata?.errors || [],
            containsSensitiveData: backupData.metadata?.containsSensitiveData || false,
            securityWarning: backupData.metadata?.securityWarning || null
        };

        // 统计服务配置项（新格式）
        if (backupData.data.serviceConfig) {
            summary.items.config = Object.keys(backupData.data.serviceConfig).length;
            summary.size.config = JSON.stringify(backupData.data.serviceConfig).length;
        }

        // 统计个人设置项（新格式）
        if (backupData.data.personalSettings) {
            let personalCount = 0;
            if (backupData.data.personalSettings.configFields) {
                personalCount += Object.keys(backupData.data.personalSettings.configFields).length;
            }
            if (backupData.data.personalSettings.storageData) {
                personalCount += Object.keys(backupData.data.personalSettings.storageData).length;
            }
            summary.items.personal = personalCount;
            summary.size.personal = JSON.stringify(backupData.data.personalSettings).length;
        }

        // 统计历史记录项（新格式）
        if (backupData.data.historyData) {
            summary.items.history = Object.keys(backupData.data.historyData).length;
            summary.size.history = JSON.stringify(backupData.data.historyData).length;

            // 分析分片存储统计
            const shardedStats = this.analyzeShardedStorageInBackup(backupData.data.historyData);
            if (shardedStats) {
                summary.shardedStorage = shardedStats;
            }
        }

        // 统计缓存数据
        if (backupData.data.cache) {
            summary.items.cache = Object.keys(backupData.data.cache).length;
            summary.size.cache = JSON.stringify(backupData.data.cache).length;
        }

        // 【修复】兼容旧格式 - 改为累加统计而不是互斥判断
        // 修复前：只有在新格式为空时才统计旧格式，导致混合格式备份的旧数据被忽略
        // 修复后：累加旧格式数据，但避免重复计数同一个键
        if (backupData.data.db) {
            // 只统计不在新格式中的键
            const newFormatKeys = backupData.data.serviceConfig ? Object.keys(backupData.data.serviceConfig) : [];
            const oldDbKeys = Object.keys(backupData.data.db).filter(key => !newFormatKeys.includes(key));
            
            if (oldDbKeys.length > 0) {
                summary.items.config += oldDbKeys.length;
                // 只计算这些键的大小
                const oldDbData = {};
                oldDbKeys.forEach(key => { oldDbData[key] = backupData.data.db[key]; });
                summary.size.config += JSON.stringify(oldDbData).length;
            }
        }

        if (backupData.data.dbStorage) {
            // 收集新格式中已包含的键
            const newFormatKeys = new Set();
            if (backupData.data.personalSettings && backupData.data.personalSettings.storageData) {
                Object.keys(backupData.data.personalSettings.storageData).forEach(k => newFormatKeys.add(k));
            }
            if (backupData.data.historyData) {
                Object.keys(backupData.data.historyData).forEach(k => newFormatKeys.add(k));
            }
            if (backupData.data.cache) {
                Object.keys(backupData.data.cache).forEach(k => newFormatKeys.add(k));
            }

            // 只统计不在新格式中的键
            const oldDbStorageKeys = Object.keys(backupData.data.dbStorage).filter(key => !newFormatKeys.has(key));
            
            if (oldDbStorageKeys.length > 0) {
                // 分类统计（个人设置 vs 历史记录）
                const personalDataKeys = ['userInfo', 'usageStats', 'personalSettings', 'utoolsUserInfo', 'utoolsUserInfoInitialized', 'translateLanguageSettings'];
                const historyDataKeys = ['ocr_histories', 'translateHistory'];
                
                let oldPersonalCount = 0;
                let oldHistoryCount = 0;
                
                oldDbStorageKeys.forEach(key => {
                    if (personalDataKeys.includes(key) || key.startsWith('isFirstTimeUser_')) {
                        oldPersonalCount++;
                    } else if (historyDataKeys.includes(key) || key.startsWith('translateHistory_')) {
                        oldHistoryCount++;
                    } else {
                        // 其他归为历史/缓存类
                        oldHistoryCount++;
                    }
                });
                
                summary.items.personal += oldPersonalCount;
                summary.items.history += oldHistoryCount;
                
                // 计算这些键的大小
                const oldDbStorageData = {};
                oldDbStorageKeys.forEach(key => { oldDbStorageData[key] = backupData.data.dbStorage[key]; });
                const oldSize = JSON.stringify(oldDbStorageData).length;
                summary.size.personal += Math.floor(oldSize * oldPersonalCount / oldDbStorageKeys.length);
                summary.size.history += Math.floor(oldSize * oldHistoryCount / oldDbStorageKeys.length);
            }

            // 分析分片存储统计（如果还没有分析过）
            if (!summary.shardedStorage) {
                const shardedStats = this.analyzeShardedStorageInBackup(backupData.data.dbStorage);
                if (shardedStats) {
                    summary.shardedStorage = shardedStats;
                }
            }
        }

        summary.size.total = summary.size.config + summary.size.personal + summary.size.history + summary.size.cache;

        return summary;
    }

    /**
     * 验证当前环境是否支持备份恢复
     * @returns {Object} 验证结果
     */
    validateEnvironment() {
        const result = {
            supported: true,
            issues: [],
            warnings: []
        };

        // 检查utools API可用性
        if (typeof utools === 'undefined') {
            result.supported = false;
            result.issues.push('utools API不可用');
        } else {
            if (!utools.db) {
                result.supported = false;
                result.issues.push('utools.db API不可用');
            }
            if (!utools.dbStorage) {
                result.warnings.push('utools.dbStorage API不可用，部分功能受限');
            }
        }

        // 检查统一存储管理器
        if (typeof window !== 'undefined' && typeof window.unifiedStorage === 'undefined') {
            result.warnings.push('统一存储管理器不可用，将使用原生API');
        }

        // 检查文件API支持
        if (typeof window !== 'undefined') {
            if (!window.FileReader) {
                result.supported = false;
                result.issues.push('FileReader API不可用，无法读取备份文件');
            }
            if (!window.Blob) {
                result.supported = false;
                result.issues.push('Blob API不可用，无法创建备份文件');
            }
            if (!window.URL || !window.URL.createObjectURL) {
                result.supported = false;
                result.issues.push('URL API不可用，无法下载备份文件');
            }
        }

        return result;
    }





    /**
     * 【新增】创建自动快照（用于清空数据前的备份）
     *
     * 当用户选择"清空现有数据"时，自动创建当前状态的完整备份
     * 以便在恢复失败时可以回滚
     *
     * @returns {Promise<Object>} 自动快照数据
     */
    async createAutoSnapshot() {
        try {
            console.log('创建自动快照...');

            const snapshot = await this.createBackup({
                includeConfig: true,
                includePersonal: true,
                includeHistory: true,
                includeCache: true
            });

            // 标记为自动快照
            snapshot.metadata.isAutoSnapshot = true;
            snapshot.metadata.snapshotReason = '清空数据前的自动备份';

            // 保存到本地存储（使用特殊 key）
            try {
                if (typeof utools !== 'undefined' && utools.dbStorage) {
                    utools.dbStorage.setItem('_auto_snapshot_latest', snapshot);
                    console.log('自动快照已保存到本地存储');
                }
            } catch (error) {
                console.warn('保存自动快照到本地存储失败:', error);
            }

            return snapshot;
        } catch (error) {
            console.error('创建自动快照失败:', error);
            throw error;
        }
    }

    /**
     * 【新增】恢复自动快照
     *
     * 从本地存储中恢复最近的自动快照
     *
     * @returns {Promise<boolean>} 恢复是否成功
     */
    async restoreAutoSnapshot() {
        try {
            console.log('恢复自动快照...');

            let snapshot = null;
            if (typeof utools !== 'undefined' && utools.dbStorage) {
                snapshot = utools.dbStorage.getItem('_auto_snapshot_latest');
            }

            if (!snapshot) {
                throw new Error('未找到自动快照');
            }

            // 恢复快照
            await this.restoreBackup(snapshot, {
                restoreConfig: true,
                restorePersonal: true,
                restoreHistory: true,
                restoreCache: true,
                clearExisting: false // 不再次清空
            });

            console.log('自动快照恢复成功');
            return true;
        } catch (error) {
            console.error('恢复自动快照失败:', error);
            throw error;
        }
    }

    /**
     * 创建备份文件名
     * @param {Object} options 选项
     * @returns {string} 文件名
     */
    generateBackupFilename(options = {}) {
        const {
            includeConfig = true,
            includePersonal = true,
            includeHistory = true,
            includeCache = false,
            prefix = 'ocr-pro-backup'
        } = options;

        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        let suffix = '';

        // 根据包含的内容生成后缀
        const includedTypes = [];
        if (includeConfig) includedTypes.push('config');
        if (includePersonal) includedTypes.push('personal');
        if (includeHistory) includedTypes.push('history');
        if (includeCache) includedTypes.push('cache');

        if (includedTypes.length === 4) {
            suffix = '-complete';
        } else if (includedTypes.length === 0) {
            suffix = '-empty';
        } else {
            suffix = '-' + includedTypes.join('-');
        }

        return `${prefix}${suffix}-${timestamp}.json`;
    }

    /**
     * 比较两个备份的差异
     * @param {Object} backup1 备份1
     * @param {Object} backup2 备份2
     * @returns {Object} 差异报告
     */
    compareBackups(backup1, backup2) {
        const diff = {
            timestamp: {
                backup1: backup1.timestamp,
                backup2: backup2.timestamp
            },
            differences: {
                config: [],
                history: [],
                cache: []
            }
        };

        // 比较配置数据
        this.compareDataSection(backup1.data.db, backup2.data.db, diff.differences.config);

        // 比较历史数据
        this.compareDataSection(backup1.data.dbStorage, backup2.data.dbStorage, diff.differences.history);

        // 比较缓存数据
        this.compareDataSection(backup1.data.cache, backup2.data.cache, diff.differences.cache);

        return diff;
    }

    compareDataSection(data1, data2, diffArray) {
        const keys1 = Object.keys(data1 || {});
        const keys2 = Object.keys(data2 || {});
        const allKeys = new Set([...keys1, ...keys2]);

        for (const key of allKeys) {
            if (!data1 || !data1[key]) {
                diffArray.push({ key, type: 'added', in: 'backup2' });
            } else if (!data2 || !data2[key]) {
                diffArray.push({ key, type: 'removed', in: 'backup1' });
            } else {
                const hash1 = this.hashObject(data1[key]);
                const hash2 = this.hashObject(data2[key]);
                if (hash1 !== hash2) {
                    diffArray.push({ key, type: 'modified' });
                }
            }
        }
    }

    hashObject(obj) {
        // 简单的对象哈希函数
        return JSON.stringify(obj).split('').reduce((a, b) => {
            a = ((a << 5) - a) + b.charCodeAt(0);
            return a & a;
        }, 0);
    }

    /**
     * 获取当前数据状态摘要
     * @returns {Promise<Object>} 当前数据摘要
     */
    async getCurrentDataSummary() {
        const summary = {
            config: {},
            history: {},
            cache: {},
            timestamp: new Date().toISOString()
        };

        // 获取服务配置数据摘要
        for (const key of this.backupItems.coreConfig) {
            try {
                const data = await this.getDbData(key);
                if (data) {
                    summary.config[key] = {
                        exists: true,
                        size: JSON.stringify(data).length,
                        lastModified: data._rev || 'unknown'
                    };
                } else {
                    summary.config[key] = { exists: false };
                }
            } catch (error) {
                summary.config[key] = { exists: false, error: error.message };
            }
        }

        // 获取ocr-config数据摘要（仅服务配置部分）
        try {
            const ocrConfig = await this.getDbData('ocr-config');
            if (ocrConfig) {
                summary.config['ocr-config'] = {
                    exists: true,
                    size: JSON.stringify(ocrConfig).length,
                    lastModified: ocrConfig._rev || 'unknown'
                };
            } else {
                summary.config['ocr-config'] = { exists: false };
            }
        } catch (error) {
            summary.config['ocr-config'] = { exists: false, error: error.message };
        }

        // 获取个人设置数据摘要（包含个人偏好设置和个人使用信息）
        for (const key of this.backupItems.personalSettings.storageKeys) {
            try {
                const data = await this.getDbStorageData(key);
                if (data) {
                    summary.history[key] = {
                        exists: true,
                        size: JSON.stringify(data).length,
                        itemCount: Array.isArray(data) ? data.length : 'N/A',
                        category: 'personal'
                    };
                } else {
                    summary.history[key] = { exists: false, category: 'personal' };
                }
            } catch (error) {
                summary.history[key] = { exists: false, error: error.message, category: 'personal' };
            }
        }

        // 获取历史记录数据摘要
        for (const key of this.backupItems.historyData) {
            try {
                const data = await this.getDbStorageData(key);
                if (data) {
                    summary.history[key] = {
                        exists: true,
                        size: JSON.stringify(data).length,
                        itemCount: Array.isArray(data) ? data.length : 'N/A',
                        category: 'history'
                    };
                } else {
                    summary.history[key] = { exists: false, category: 'history' };
                }
            } catch (error) {
                summary.history[key] = { exists: false, error: error.message, category: 'history' };
            }
        }

        // 检查分片存储的翻译历史记录
        await this.checkShardedTranslateHistoryStatus(summary);

        // 获取动态键数据摘要（归类为个人使用信息）
        try {
            const dynamicKeys = await this.getDynamicKeys();
            for (const key of dynamicKeys) {
                try {
                    const data = await this.getDbStorageData(key);
                    if (data) {
                        summary.history[key] = {
                            exists: true,
                            size: JSON.stringify(data).length,
                            type: 'dynamic',
                            category: 'personal'
                        };
                    }
                } catch (error) {
                    summary.history[key] = { exists: false, error: error.message, type: 'dynamic', category: 'personal' };
                }
            }
        } catch (error) {
            console.warn('获取动态键摘要失败:', error);
        }

        // 获取缓存数据摘要
        for (const key of this.backupItems.cache) {
            try {
                const data = await this.getDbStorageData(key);
                if (data) {
                    summary.cache[key] = {
                        exists: true,
                        size: JSON.stringify(data).length,
                        timestamp: data._timestamp || 'unknown'
                    };
                } else {
                    summary.cache[key] = { exists: false };
                }
            } catch (error) {
                summary.cache[key] = { exists: false, error: error.message };
            }
        }

        return summary;
    }





    /**
     * 触发进度回调
     * @param {string} message 进度消息
     * @param {number} percentage 进度百分比
     */
    _triggerProgress(message, percentage) {
        if (this.callbacks.onProgress) {
            this.callbacks.onProgress(message, percentage);
        }
    }

    /**
     * 触发成功回调
     * @param {*} data 成功数据
     */
    _triggerSuccess(data) {
        if (this.callbacks.onSuccess) {
            this.callbacks.onSuccess(data);
        }
    }

    /**
     * 触发错误回调
     * @param {Error} error 错误对象
     */
    _triggerError(error) {
        if (this.callbacks.onError) {
            this.callbacks.onError(error);
        }
    }

    /**
     * 获取动态键名（如首次使用标志、代理配置等）
     * 
     * 【修复】增强动态键检测，支持以下模式：
     * - isFirstTimeUser_* : 首次使用标志
     * - proxy-config-* : 各平台代理配置
     * - proxy-status-* : 各平台代理状态
     * 
     * @returns {Promise<Array>} 动态键名数组
     */
    async getDynamicKeys() {
        const dynamicKeys = [];

        try {
            // 获取所有存储键（如果utools.dbStorage支持）
            if (typeof utools !== 'undefined' && utools.dbStorage) {
                // 【修复】扩展模式列表，添加 proxy-config 和 proxy-status
                const patterns = [
                    'isFirstTimeUser_', // 首次使用标志
                    'translateHistory_', // 分片翻译历史记录（已在专门方法中处理，这里作为备用）
                    'proxy-config-',    // 【新增】代理配置
                    'proxy-status-',    // 【新增】代理状态
                ];

                // 【修复】扩展可能的后缀，包括平台名称
                const possibleSuffixes = [
                    // 用户标识符
                    'default', 'user', 'anonymous', 'guest',
                    // 数字后缀
                    '1', '2', '3', '4', '5',
                    // 【新增】AI平台名称（用于代理配置）
                    'openai', 'google', 'anthropic', 'alibaba', 'bytedance', 
                    'zhipu', 'utools', 'ocrpro', 'baidu', 'tencent', 'aliyun',
                    'volcano', 'deeplx', 'youdao', 'baiduFanyi'
                ];

                // 遍历可能的键名模式
                for (const pattern of patterns) {
                    for (const suffix of possibleSuffixes) {
                        const key = pattern + suffix;
                        try {
                            const data = await this.getDbStorageData(key);
                            if (data !== null && data !== undefined) {
                                dynamicKeys.push(key);
                            }
                        } catch (error) {
                            // 键不存在，继续
                        }
                    }
                }

                // 尝试获取当前用户的首次使用标志
                try {
                    // @ts-ignore - window.ocrPlugin 在运行时存在
                    if (typeof window !== 'undefined' && window.ocrPlugin && window.ocrPlugin.uiManager) {
                        // @ts-ignore
                        const userIdentifier = await window.ocrPlugin.uiManager.getUserIdentifier();
                        if (userIdentifier) {
                            const firstTimeKey = `isFirstTimeUser_${userIdentifier}`;
                            const data = await this.getDbStorageData(firstTimeKey);
                            if (data !== null && data !== undefined) {
                                dynamicKeys.push(firstTimeKey);
                            }
                        }
                    }
                } catch (error) {
                    console.warn('获取用户标识符失败:', error);
                }

                // 尝试检测其他可能的动态键模式
                const additionalPatterns = [
                    'userSettings_',
                    'cache_',
                    'temp_',
                    'session_'
                ];

                for (const pattern of additionalPatterns) {
                    for (let i = 0; i < 10; i++) {
                        const key = pattern + i;
                        try {
                            const data = await this.getDbStorageData(key);
                            if (data !== null && data !== undefined) {
                                dynamicKeys.push(key);
                            }
                        } catch (error) {
                            // 键不存在，继续
                        }
                    }
                }
            }
        } catch (error) {
            console.warn('获取动态键失败:', error);
        }

        return [...new Set(dynamicKeys)]; // 去重
    }

    /**
     * 备份分片存储的翻译历史记录
     * @param {Object} backupData 备份数据对象
     */
    async backupShardedTranslateHistory(backupData) {
        try {
            // 检查是否存在分片存储索引
            const indexKey = 'translateHistory_index';
            const shardIndex = await this.getDbStorageData(indexKey);

            if (!shardIndex) {
                // 没有分片存储，跳过
                return;
            }

            // 确保historyData存在
            if (!backupData.data.historyData) {
                backupData.data.historyData = {};
            }

            // 备份索引
            backupData.data.historyData[indexKey] = shardIndex;

            // 解析索引数据
            const index = typeof shardIndex === 'string' ? JSON.parse(shardIndex) : shardIndex;

            if (index && index.shards) {
                // 备份文本分片
                if (index.shards.text && Array.isArray(index.shards.text)) {
                    for (const shardKey of index.shards.text) {
                        try {
                            const shardData = await this.getDbStorageData(shardKey);
                            if (shardData) {
                                backupData.data.historyData[shardKey] = shardData;
                            }
                        } catch (error) {
                            console.warn(`备份文本分片 ${shardKey} 失败:`, error);
                        }
                    }
                }

                // 备份图片元数据分片
                if (index.shards.imageMeta && Array.isArray(index.shards.imageMeta)) {
                    for (const shardKey of index.shards.imageMeta) {
                        try {
                            const shardData = await this.getDbStorageData(shardKey);
                            if (shardData) {
                                backupData.data.historyData[shardKey] = shardData;
                            }
                        } catch (error) {
                            console.warn(`备份图片元数据分片 ${shardKey} 失败:`, error);
                        }
                    }
                }

                // 备份图片数据分片
                if (index.shards.imageData && Array.isArray(index.shards.imageData)) {
                    for (const imageKey of index.shards.imageData) {
                        try {
                            const imageData = await this.getDbStorageData(imageKey);
                            if (imageData) {
                                backupData.data.historyData[imageKey] = imageData;
                            }
                        } catch (error) {
                            console.warn(`备份图片数据 ${imageKey} 失败:`, error);
                        }
                    }
                }
            }


        } catch (error) {
            console.error('备份分片存储翻译历史记录失败:', error);
        }
    }

    /**
     * 恢复分片存储的翻译历史记录
     * @param {Object} backupData 备份数据对象
     */
    async restoreShardedTranslateHistory(backupData) {
        try {
            // 支持新旧格式
            let storageData = null;
            if (backupData.data.historyData) {
                storageData = backupData.data.historyData;
            } else if (backupData.data.dbStorage) {
                storageData = backupData.data.dbStorage;
            }

            if (!storageData) {
                return;
            }

            const indexKey = 'translateHistory_index';

            // 检查是否有分片存储数据
            if (!storageData[indexKey]) {
                return;
            }

            // 恢复索引
            await this.setDbStorageData(indexKey, storageData[indexKey]);

            // 解析索引以获取所有分片键名
            const index = typeof storageData[indexKey] === 'string' ?
                JSON.parse(storageData[indexKey]) : storageData[indexKey];

            if (index && index.shards) {
                // 恢复文本分片
                if (index.shards.text && Array.isArray(index.shards.text)) {
                    for (const shardKey of index.shards.text) {
                        if (storageData[shardKey]) {
                            try {
                                await this.setDbStorageData(shardKey, storageData[shardKey]);
                            } catch (error) {
                                console.error(`恢复文本分片 ${shardKey} 失败:`, error);
                            }
                        }
                    }
                }

                // 恢复图片元数据分片
                if (index.shards.imageMeta && Array.isArray(index.shards.imageMeta)) {
                    for (const shardKey of index.shards.imageMeta) {
                        if (storageData[shardKey]) {
                            try {
                                await this.setDbStorageData(shardKey, storageData[shardKey]);
                            } catch (error) {
                                console.error(`恢复图片元数据分片 ${shardKey} 失败:`, error);
                            }
                        }
                    }
                }

                // 恢复图片数据分片
                if (index.shards.imageData && Array.isArray(index.shards.imageData)) {
                    for (const imageKey of index.shards.imageData) {
                        if (storageData[imageKey]) {
                            try {
                                await this.setDbStorageData(imageKey, storageData[imageKey]);
                            } catch (error) {
                                console.error(`恢复图片数据 ${imageKey} 失败:`, error);
                            }
                        }
                    }
                }
            }


        } catch (error) {
            console.error('恢复分片存储翻译历史记录失败:', error);
        }
    }

    /**
     * 分析备份中的分片存储统计信息
     * @param {Object} dbStorageData dbStorage数据
     * @returns {Object|null} 分片存储统计信息
     */
    analyzeShardedStorageInBackup(dbStorageData) {
        try {
            const indexKey = 'translateHistory_index';
            if (!dbStorageData[indexKey]) {
                return null; // 没有分片存储
            }

            const index = typeof dbStorageData[indexKey] === 'string' ?
                JSON.parse(dbStorageData[indexKey]) : dbStorageData[indexKey];

            if (!index || !index.shards) {
                return null;
            }

            const stats = {
                enabled: true,
                totalRecords: index.totalRecords || 0,
                textRecords: index.textRecords || 0,
                imageRecords: index.imageRecords || 0,
                shards: {
                    text: index.shards.text ? index.shards.text.length : 0,
                    imageMeta: index.shards.imageMeta ? index.shards.imageMeta.length : 0,
                    imageData: index.shards.imageData ? index.shards.imageData.length : 0
                },
                totalShards: 0,
                estimatedSize: 0
            };

            // 计算总分片数
            stats.totalShards = stats.shards.text + stats.shards.imageMeta + stats.shards.imageData + 1; // +1 for index

            // 估算各类分片的大小
            let totalSize = 0;

            // 文本分片大小
            if (index.shards.text) {
                for (const shardKey of index.shards.text) {
                    if (dbStorageData[shardKey]) {
                        totalSize += JSON.stringify(dbStorageData[shardKey]).length;
                    }
                }
            }

            // 图片元数据分片大小
            if (index.shards.imageMeta) {
                for (const shardKey of index.shards.imageMeta) {
                    if (dbStorageData[shardKey]) {
                        totalSize += JSON.stringify(dbStorageData[shardKey]).length;
                    }
                }
            }

            // 图片数据分片大小
            if (index.shards.imageData) {
                for (const imageKey of index.shards.imageData) {
                    if (dbStorageData[imageKey]) {
                        totalSize += JSON.stringify(dbStorageData[imageKey]).length;
                    }
                }
            }

            // 索引大小
            totalSize += JSON.stringify(dbStorageData[indexKey]).length;

            stats.estimatedSize = totalSize;

            return stats;
        } catch (error) {
            console.error('分析分片存储统计信息失败:', error);
            return null;
        }
    }

    /**
     * 检查分片存储的翻译历史记录状态
     * @param {Object} summary 数据摘要对象
     */
    async checkShardedTranslateHistoryStatus(summary) {
        try {
            // 检查分片存储索引
            const indexKey = 'translateHistory_index';
            const shardIndex = await this.getDbStorageData(indexKey);

            if (!shardIndex) {
                // 没有分片存储，检查传统存储
                const traditionalData = await this.getDbStorageData('translateHistory');
                if (traditionalData) {
                    summary.history['translateHistory'] = {
                        exists: true,
                        size: JSON.stringify(traditionalData).length,
                        itemCount: Array.isArray(traditionalData) ? traditionalData.length : 'N/A',
                        type: 'traditional'
                    };
                } else {
                    summary.history['translateHistory'] = {
                        exists: false,
                        type: 'missing'
                    };
                }
                return;
            }

            // 解析分片存储索引
            const index = typeof shardIndex === 'string' ? JSON.parse(shardIndex) : shardIndex;

            // 统计分片存储信息
            let totalSize = JSON.stringify(shardIndex).length;
            let totalRecords = index.totalRecords || 0;
            let textRecords = index.textRecords || 0;
            let imageRecords = index.imageRecords || 0;
            let totalShards = 1; // 索引本身

            // 检查文本分片
            if (index.shards && index.shards.text) {
                for (const shardKey of index.shards.text) {
                    try {
                        const shardData = await this.getDbStorageData(shardKey);
                        if (shardData) {
                            totalSize += JSON.stringify(shardData).length;
                            totalShards++;
                        }
                    } catch (error) {
                        console.warn(`检查文本分片 ${shardKey} 失败:`, error);
                    }
                }
            }

            // 检查图片元数据分片
            if (index.shards && index.shards.imageMeta) {
                for (const shardKey of index.shards.imageMeta) {
                    try {
                        const shardData = await this.getDbStorageData(shardKey);
                        if (shardData) {
                            totalSize += JSON.stringify(shardData).length;
                            totalShards++;
                        }
                    } catch (error) {
                        console.warn(`检查图片元数据分片 ${shardKey} 失败:`, error);
                    }
                }
            }

            // 检查图片数据分片（采样检查，避免加载所有图片数据）
            if (index.shards && index.shards.imageData) {
                const imageDataCount = index.shards.imageData.length;
                totalShards += imageDataCount;

                // 采样检查前几个图片数据的大小
                const sampleSize = Math.min(5, imageDataCount);
                let sampleTotalSize = 0;
                for (let i = 0; i < sampleSize; i++) {
                    try {
                        const imageKey = index.shards.imageData[i];
                        const imageData = await this.getDbStorageData(imageKey);
                        if (imageData) {
                            sampleTotalSize += JSON.stringify(imageData).length;
                        }
                    } catch (error) {
                        console.warn(`检查图片数据 ${index.shards.imageData[i]} 失败:`, error);
                    }
                }

                // 估算总图片数据大小
                if (sampleSize > 0) {
                    const avgImageSize = sampleTotalSize / sampleSize;
                    totalSize += avgImageSize * imageDataCount;
                }
            }

            // 添加分片存储摘要
            summary.history['translateHistory'] = {
                exists: true,
                type: 'sharded',
                totalSize: totalSize,
                totalRecords: totalRecords,
                textRecords: textRecords,
                imageRecords: imageRecords,
                totalShards: totalShards,
                shardBreakdown: {
                    textShards: index.shards?.text?.length || 0,
                    imageMetaShards: index.shards?.imageMeta?.length || 0,
                    imageDataShards: index.shards?.imageData?.length || 0
                }
            };

        } catch (error) {
            console.error('检查分片存储翻译历史记录状态失败:', error);
            summary.history['translateHistory'] = {
                exists: false,
                error: error.message,
                type: 'error'
            };
        }
    }
}

// 导出管理器实例
window.backupRestoreManager = new BackupRestoreManager();
