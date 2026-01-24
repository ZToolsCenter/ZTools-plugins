// LLM模型管理模块
class ModelManager {
    constructor() {
        // 初始化 Provider 注册表
        this.providerRegistry = new ProviderRegistry();

        // 为火山引擎 Provider 设置 modelManager 引用（用于访问新旧 API）
        const bytedanceProvider = this.providerRegistry.getProvider('bytedance');
        if (bytedanceProvider) {
            bytedanceProvider.modelManager = this;
        }

        this.platforms = {
            openai: {
                name: 'OpenAI',
                baseUrl: 'https://api.openai.com',  // 改为根地址，由 URL 构造函数统一添加 /v1
                modelsEndpoint: '/models',
                defaultModels: [
                    'gpt-4o',
                    'gpt-4o-mini',
                    'gpt-4o-2024-11-20',
                    'gpt-4o-2024-08-06',
                    'gpt-4o-2024-05-13',
                    'gpt-4o-mini-2024-07-18',
                    'gpt-4-turbo',
                    'gpt-4-turbo-2024-04-09',
                    'gpt-4-vision-preview'
                ]
            },
            anthropic: {
                name: 'Anthropic',
                baseUrl: 'https://api.anthropic.com/v1',
                modelsEndpoint: null, // Anthropic不提供模型列表API
                // Claude模型列表配置 (按发布时间从新到旧排序)
                defaultModels: [
                    // Claude 4.5 系列 (2025年最新)
                    'claude-sonnet-4.5-20250514',           // Claude Sonnet 4.5 (2025.05.14)
                    'claude-haiku-4.5-20251015',            // Claude Haiku 4.5 (2025.10.15)

                    // Claude 4 系列 (2025年)
                    'claude-opus-4.1-20250805',             // Claude Opus 4.1 (2025.08.05)
                    'claude-opus-4-20250522',               // Claude Opus 4 (2025.05.22)
                    'claude-sonnet-4-20250522',             // Claude Sonnet 4 (2025.05.22)

                    // Claude 3.5 系列 (2024年)
                    'claude-3-5-sonnet-20241022',           // Claude 3.5 Sonnet (2024.10.22)
                    'claude-3-5-haiku-20241022',            // Claude 3.5 Haiku (2024.10.22)
                    'claude-3-5-sonnet-20240620',           // Claude 3.5 Sonnet (2024.06.20)

                    // Claude 3 系列 (2024年)
                    'claude-3-opus-20240229',               // Claude 3 Opus (2024.02.29)
                    'claude-3-sonnet-20240229',             // Claude 3 Sonnet (2024.02.29)
                    'claude-3-haiku-20240307'               // Claude 3 Haiku (2024.03.07)
                ]
            },
            google: {
                name: 'Google',
                baseUrl: 'https://generativelanguage.googleapis.com',
                modelsEndpoint: '/v1beta/models',
                defaultModels: [
                    'gemini-2.5-pro',
                    'gemini-2.5-flash',
                    'gemini-2.0-flash',
                    'gemini-1.5-pro',
                    'gemini-1.5-flash',
                    'gemini-1.5-flash-8b'
                ]
            },
            alibaba: {
                name: '阿里云百炼',
                baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                modelsEndpoint: '/models',
                defaultModels: [
                    // Qwen-MT翻译专用模型
                    'qwen-mt-plus',
                    'qwen-mt-turbo',
                    // 视觉OCR模型
                    'qwen-vl-max',
                    'qwen-vl-plus',
                    'qwen-vl-ocr-latest',
                    'qwen-vl-ocr-2025-04-13',
                    'qwen2-vl-7b-instruct',
                    'qwen2-vl-72b-instruct',
                    'qwen2.5-vl-7b-instruct',
                    'qwen2.5-vl-72b-instruct'
                ]
            },
            bytedance: {
                name: '火山引擎',
                baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
                modelsEndpoint: '/models',
                // 注意：火山引擎API调用需要使用完整的模型ID（Model ID），而不是简化的模型名称
                // 完整模型ID格式：模型名称-版本号，如 doubao-1-5-vision-pro-32k-250115
                defaultModels: [
                    // 最新豆包1.5系列模型
                    'doubao-1-5-vision-pro-32k-250115',      // 豆包1.5视觉Pro 32K
                    'doubao-1-5-pro-32k-250115',             // 豆包1.5 Pro 32K
                    'doubao-1-5-pro-32k-character-250228',   // 豆包1.5 Pro 32K 角色版
                    'doubao-1-5-pro-256k-250115',            // 豆包1.5 Pro 256K
                    'doubao-1-5-lite-32k-250115',            // 豆包1.5 Lite 32K

                    // 最新豆包Seed系列（包含您提到的最新模型）
                    'doubao-seed-1-6-flash-250615',          // 豆包Seed 1.6 Flash (2025.06.15) - 最新版本
                    'doubao-seed-1-6-32k-250615',            // 豆包Seed 1.6 32K (2025.06.15) - 最新版本
                    'doubao-seed-1-6-thinking-32k-250615',   // 豆包Seed 1.6 Thinking 32K (2025.06.15)

                    // 豆包传统模型系列
                    'doubao-pro-32k-241215',                 // 豆包Pro 32K
                    'doubao-pro-32k-functioncall-241028',    // 豆包Pro 32K 函数调用版
                    'doubao-pro-32k-character-241215',       // 豆包Pro 32K 角色版
                    'doubao-pro-256k-241115',                // 豆包Pro 256K
                    'doubao-lite-4k-character-240828',       // 豆包Lite 4K 角色版
                    'doubao-lite-32k-240828',                // 豆包Lite 32K
                    'doubao-lite-32k-character-241015',      // 豆包Lite 32K 角色版
                    'doubao-lite-128k-240828',               // 豆包Lite 128K
                    'doubao-vision-lite-32k-241015',         // 豆包视觉Lite 32K

                    // 豆包嵌入模型
                    'doubao-embedding-large-text-240915',    // 豆包嵌入Large
                    'doubao-embedding-text-240715',          // 豆包嵌入
                    'doubao-embedding-vision-241215',        // 豆包视觉嵌入

                    // DeepSeek模型系列
                    'deepseek-r1-250120',                    // DeepSeek R1
                    'deepseek-r1-distill-qwen-32b-250120',  // DeepSeek R1 蒸馏版 32B
                    'deepseek-r1-distill-qwen-7b-250120',   // DeepSeek R1 蒸馏版 7B
                    'deepseek-v3-250324',                    // DeepSeek V3

                    // 其他第三方模型
                    'moonshot-v1-auto'                       // 月之暗面自动版本
                ]
            },
            ocrpro: {
                name: 'OCR Pro',
                baseUrl: 'https://api.jlws.top',
                modelsEndpoint: '/v1/models',
                defaultModels: [
                    'gemini-2.5-flash-lite',
                    'gemini-2.5-flash'
                ],
                // 预设API凭证
                presetApiKey: 'sk-lvDbg9jGPK1CJfPVmSTb4Fp7GFNrp87MS3j2ziyIVTOO0cCX',
                presetBaseUrl: 'https://api.jlws.top'
            },
            utools: {
                name: 'uTools AI',
                baseUrl: null, // uTools AI不需要baseUrl
                modelsEndpoint: null, // 使用utools.allAiModels()获取
                defaultModels: [] // 动态获取
            },
            zhipu: {
                name: '智谱AI',
                baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
                modelsEndpoint: '/v1/models',
                defaultModels: [
                    // GLM-4.5系列 (最新)
                    'glm-4.5',
                    'glm-4.5-flash',
                    'glm-4.5-air',
                    'glm-4.5-airx',
                    'glm-4.5-x',
                    // GLM-Z1系列 (推理模型)
                    'glm-z1-air',
                    'glm-z1-airx',
                    'glm-z1-flash',
                    // GLM-4系列
                    'glm-4-long',
                    'glm-4-plus',
                    'glm-4-air-250414',
                    'glm-4-airx',
                    'glm-4-flash-250414',
                    'glm-4-flashx',
                    // GLM-4V视觉系列
                    'glm-4v',
                    'glm-4v-flash',
                    'glm-4v-plus-0111',
                    // 工具和嵌入模型
                    'glm-4-alltools',
                    'embedding-3'
                ]
            }
        };

        // 移除内存缓存机制，使用统一存储管理器
    }

    // 获取平台信息
    getPlatformInfo(platform) {
        // 如果是预定义平台,直接返回
        if (this.platforms[platform]) {
            return this.platforms[platform];
        }

        // 如果是自定义服务商,动态构建平台信息
        if (platform && platform.startsWith('custom_')) {
            const configManager = window.configManager || new ConfigManager();
            const customProvider = configManager.getCustomLLMProviderMeta(platform);

            if (customProvider) {
                // 获取自定义服务商的配置
                const config = configManager.getConfig();
                const providerConfig = config[platform] || {};

                // 根据 platformType 获取基础平台信息
                const basePlatform = this.platforms[customProvider.platformType] || this.platforms['openai'];

                // 构建自定义平台信息
                return {
                    name: customProvider.name,
                    baseUrl: providerConfig.baseUrl || basePlatform.baseUrl,
                    modelsEndpoint: basePlatform.modelsEndpoint,
                    defaultModels: providerConfig.modelList || []
                };
            }
        }

        return null;
    }

    // 获取所有支持的平台
    getSupportedPlatforms() {
        return Object.keys(this.platforms);
    }

    // 获取模型列表（按需加载机制）
    async getModels(platform, apiKey, baseUrl = null, forceRefresh = false) {
        const platformInfo = this.getPlatformInfo(platform);
        if (!platformInfo) {
            throw new Error(`不支持的平台: ${platform}`);
        }

        // OCR Pro特殊处理：直接返回预设模型列表
        if (platform === 'ocrpro') {
            return this.getOcrProModels();
        }

        // 生成配置哈希值（用于区分不同的API配置）
        const configHash = this.generateConfigHash(apiKey, baseUrl);

        // 检查缓存（除非强制刷新）
        if (!forceRefresh && window.unifiedStorage) {
            const cached = window.unifiedStorage.getModelListCache(platform, configHash);
            if (cached) {

                return cached;
            }
        }

        try {

            const models = await this.fetchModelsForPlatform(platform, apiKey, baseUrl, platformInfo);

            // 缓存获取到的模型列表
            if (window.unifiedStorage && models && models.length > 0) {
                window.unifiedStorage.setModelListCache(platform, models, configHash);
            }

            return models;
        } catch (error) {
            console.error(`[模型管理器] 获取 ${platform} 模型列表失败:`, error);
            return this.getDefaultModels(platformInfo);
        }
    }

    // 生成配置哈希值（用于区分不同的API配置）
    generateConfigHash(apiKey, baseUrl) {
        if (!apiKey && !baseUrl) return '';

        // 简单哈希算法，用于生成配置标识
        const configString = `${apiKey || ''}:${baseUrl || ''}`;
        let hash = 0;
        for (let i = 0; i < configString.length; i++) {
            const char = configString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return Math.abs(hash).toString(36);
    }

    // 清除平台模型缓存
    clearPlatformCache(platform) {
        if (window.unifiedStorage) {
            return window.unifiedStorage.clearModelListCache(platform);
        }
        return false;
    }

    // 清除所有模型缓存
    clearAllCache() {
        const platforms = ['openai', 'google', 'anthropic', 'alibaba', 'bytedance', 'utools', 'ocrpro', 'zhipu'];
        let cleared = 0;

        platforms.forEach(platform => {
            if (this.clearPlatformCache(platform)) {
                cleared++;
            }
        });


        return cleared > 0;
    }

    // 获取OCR Pro预设模型列表
    getOcrProModels() {
        const models = [
            {
                id: 'gemini-2.5-flash-lite',
                name: 'Gemini 2.5 Flash-Lite',
                capabilities: ['text', 'vision']
            },
            {
                id: 'gemini-2.5-flash',
                name: 'Gemini 2.5 Flash',
                capabilities: ['text', 'vision']
            }
        ];

        return models;
    }

    // 获取默认模型列表 - 包含能力检测
    getDefaultModels(platformInfo, platform = null) {
        return platformInfo.defaultModels.map(model => ({
            id: model,
            name: model,
            description: this.getModelDescription(model),
            isDefault: true,
            // 为默认模型也添加能力检测
            capabilities: window.modelCapabilityDetector && platform ?
                window.modelCapabilityDetector.detectCapabilities(platform, model) : [],
            isVisionModel: window.modelCapabilityDetector && platform ?
                window.modelCapabilityDetector.isVisionModel(platform, model) : false
        }));
    }

    // 为特定平台获取模型（使用 Provider 驱动）
    async fetchModelsForPlatform(platform, apiKey, baseUrl, platformInfo) {
        try {
            // 确定实际使用的 Provider 类型
            let providerType = platform;

            // 检查是否为自定义服务商（格式：custom_xxx）
            if (platform.startsWith('custom_')) {
                // 获取自定义服务商的元信息
                const configManager = window.configManager || new ConfigManager();
                const customProvider = configManager.getCustomLLMProviderMeta(platform);

                if (customProvider && customProvider.platformType) {
                    // 对于自定义服务商,如果 platformType 是 openai,使用 openai-compatible Provider
                    if (customProvider.platformType === 'openai') {
                        providerType = 'openai-compatible';

                    } else {
                        // 其他平台类型直接使用对应的 Provider
                        providerType = customProvider.platformType;

                    }
                } else {
                    // 默认使用 OpenAI 兼容 Provider
                    providerType = 'openai-compatible';

                }
            }

            // 从 Provider 注册表获取对应的 Provider
            const provider = this.providerRegistry.getProvider(providerType);

            // 构建配置对象
            const config = {
                platform: platform,
                apiKey: apiKey,
                baseUrl: baseUrl || platformInfo.baseUrl,
                platformInfo: platformInfo,
                // 火山引擎特殊配置
                accessKey: platform === 'bytedance' ? this.getElementValue('bytedance-access-key') : null,
                secretKey: platform === 'bytedance' ? this.getElementValue('bytedance-secret-key') : null,
                forceRefresh: false
            };

            // 调用 Provider 的 listModels 方法
            return await provider.listModels(config);
        } catch (error) {
            console.error(`[模型管理器] Provider 获取 ${platform} 模型列表失败:`, error);
            throw error;
        }
    }

    // 获取Anthropic Claude模型列表 - 使用默认模型配置
    async fetchAnthropicModels(platformInfo) {
        // Anthropic不提供模型列表API，返回预配置的默认模型列表

        return platformInfo.defaultModels.map(model => ({
            id: model,
            name: model,
            description: this.getModelDescription(model),
            isDefault: true,
            // 使用模型能力检测逻辑
            capabilities: window.modelCapabilityDetector ?
                window.modelCapabilityDetector.detectCapabilities('anthropic', model) : [],
            // 保持向后兼容
            isVisionModel: window.modelCapabilityDetector ?
                window.modelCapabilityDetector.isVisionModel('anthropic', model) : false
        }));
    }

    // 获取OpenAI模型列表 - 通过API动态获取可用模型
    async fetchOpenAIModels(apiKey, baseUrl) {
        try {
            // 使用统一的 URL 构造函数获取模型列表 URL
            const modelsUrl = window.urlUtils.buildOpenAIModelsUrl(baseUrl, 'https://api.openai.com');

            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'OCR-Plugin/1.0'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`OpenAI API错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.data || !Array.isArray(data.data)) {
                throw new Error('OpenAI API返回的数据格式异常');
            }

            // 过滤不支持的模型类型（TTS、语音等）
            const allModels = data.data.filter(model => {
                if (!model.id) return false;

                // 排除不支持的模型类型（TTS、语音识别等）
                // NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i
                const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i;

                return !NOT_SUPPORTED_REGEX.test(model.id);
            });

            // 清理模型ID并格式化返回数据
            return allModels.map(model => {
                const cleanId = model.id.trim();

                return {
                    id: cleanId,
                    name: cleanId,
                    description: this.getModelDescription(cleanId),
                    created: model.created,
                    owned_by: model.owned_by,
                    object: model.object,
                    // 使用模型能力检测逻辑
                    capabilities: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.detectCapabilities('openai', cleanId, {
                            owned_by: model.owned_by,
                            object: model.object
                        }) : [],
                    // 保持向后兼容
                    isVisionModel: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.isVisionModel('openai', cleanId, {
                            owned_by: model.owned_by,
                            object: model.object
                        }) : false
                };
            });
        } catch (error) {
            // 返回默认模型列表
            const platformInfo = this.getPlatformInfo('openai');
            return this.getDefaultModels(platformInfo, 'openai');
        }
    }

    // 模型能力检测方法已移除，将由新的ModelCapabilityDetector处理



    // 获取Google模型列表 - 通过Gemini API获取可用模型
    async fetchGoogleModels(apiKey, baseUrl) {
        try {
            // 构建 API URL，支持 # 原样使用标记
            let modelsUrl;
            const rawUrl = window.urlUtils.checkRawUrlMarker(baseUrl);
            if (rawUrl !== null) {
                // 有 # 标记，直接使用去除 # 后的 URL（需要添加 API key 参数）
                const separator = rawUrl.includes('?') ? '&' : '?';
                modelsUrl = `${rawUrl}${separator}key=${apiKey}`;
            } else {
                // 正常处理：拼接路径和参数
                const versionedBase = window.urlUtils.buildVersionedBase(
                    baseUrl,
                    'https://generativelanguage.googleapis.com',
                    '/v1beta'
                );
                modelsUrl = `${versionedBase}/models?key=${apiKey}`;
            }

            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OCR-Plugin/1.0'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Google API错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.models || !Array.isArray(data.models)) {
                throw new Error('Google API返回的数据格式异常');
            }

            // 过滤并获取所有可用的Gemini模型
            const allModels = data.models.filter(model => {
                if (!model.name) return false;

                const modelName = model.name.toLowerCase();

                // 基本过滤：只保留Gemini模型
                const isGemini = modelName.includes('gemini');

                // 检查是否支持generateContent方法（对话生成标准）
                const hasGenerateContent = model.supportedGenerationMethods?.includes('generateContent');

                // 排除嵌入模型和其他非对话模型
                const isEmbeddingModel = modelName.includes('embedding') ||
                    model.supportedGenerationMethods?.includes('embedContent');

                // 排除AQA模型（问答模型，不适合OCR）
                const isAQAModel = modelName.includes('aqa');

                return isGemini && hasGenerateContent && !isEmbeddingModel && !isAQAModel;
            });

            // 格式化并返回模型数据
            return allModels.map(model => {
                const modelId = model.name.replace('models/', '');
                const displayName = model.displayName || modelId;

                return {
                    id: modelId,
                    name: displayName,
                    description: model.description || this.getModelDescription(modelId),
                    version: model.version,
                    supportedMethods: model.supportedGenerationMethods,
                    // 使用模型能力检测逻辑
                    capabilities: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.detectCapabilities('google', modelId, {
                            name: displayName,
                            supportedMethods: model.supportedGenerationMethods
                        }) : [],
                    // 保持向后兼容
                    isVisionModel: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.isVisionModel('google', modelId, {
                            name: displayName,
                            supportedMethods: model.supportedGenerationMethods
                        }) : false
                };
            });
        } catch (error) {
            // 返回默认模型列表
            const platformInfo = this.getPlatformInfo('google');
            return this.getDefaultModels(platformInfo, 'google');
        }
    }

    // 获取模型描述
    getModelDescription(modelId) {
        const descriptions = {
            // OpenAI 模型
            'gpt-4o': 'GPT-4 Omni - multimodal flagship model',
            'gpt-4o-mini': 'GPT-4 Omni Mini - faster and cheaper',
            'gpt-4o-2024-11-20': 'GPT-4 Omni (2024.11.20) - latest stable version',
            'gpt-4o-2024-08-06': 'GPT-4 Omni (2024.08.06) - stable version',
            'gpt-4o-2024-05-13': 'GPT-4 Omni (2024.05.13) - initial release',
            'gpt-4o-mini-2024-07-18': 'GPT-4 Omni Mini (2024.07.18) - optimized version',
            'gpt-4-turbo': 'GPT-4 Turbo - enhanced performance with vision',
            'gpt-4-turbo-2024-04-09': 'GPT-4 Turbo (2024.04.09) - stable version',
            'gpt-4-turbo-preview': 'GPT-4 Turbo Preview - latest capabilities',
            'gpt-4-vision-preview': 'GPT-4 with vision capabilities (preview)',

            // Claude 模型
            'claude-opus-4-20250514': 'Claude Opus 4 - 世界最佳编程模型，具有持续的复杂任务性能',
            'claude-sonnet-4-20250514': 'Claude Sonnet 4 - 高性能模型，具有卓越的推理能力',
            'claude-3-7-sonnet-20250219': 'Claude Sonnet 3.7 - 高性能模型，支持扩展思考',
            'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet - 最智能的模型',
            'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku - 最快速的智能模型',
            'claude-3-opus-20240229': 'Claude 3 Opus - 最强大的模型',
            'claude-3-sonnet-20240229': 'Claude 3 Sonnet - 平衡性能模型',
            'claude-3-haiku-20240307': 'Claude 3 Haiku - 最快速的模型',

            // Gemini 模型
            'gemini-2.5-pro': 'Gemini 2.5 Pro - state-of-the-art thinking model',
            'gemini-2.5-flash': 'Gemini 2.5 Flash - best price-performance with thinking',
            'gemini-2.0-flash': 'Gemini 2.0 Flash - next-gen features and speed',
            'gemini-1.5-flash': 'Gemini 1.5 Flash - fast and efficient',
            'gemini-1.5-flash-8b': 'Gemini 1.5 Flash-8B - lightweight model',
            'gemini-1.5-pro': 'Gemini 1.5 Pro - advanced reasoning',

            // 阿里云模型
            // Qwen-MT翻译专用模型
            'qwen-mt-plus': 'Qwen-MT Plus - 旗舰翻译模型',
            'qwen-mt-turbo': 'Qwen-MT Turbo - 快速翻译模型',
            // 视觉OCR模型
            'qwen-vl-plus': '通义千问VL Plus - 高性能多模态模型',
            'qwen-vl-max': '通义千问VL Max - 旗舰级多模态模型',
            'qwen-vl-ocr-latest': '通义千问VL OCR最新版 - 专业OCR文字识别模型',
            'qwen-vl-ocr-2025-04-13': '通义千问VL OCR (2025.04.13) - 专业OCR文字识别模型',
            'qwen2-vl-7b-instruct': '通义千问2 VL 7B - 轻量级视觉理解模型',
            'qwen2-vl-72b-instruct': '通义千问2 VL 72B - 大规模视觉理解模型',
            'qwen2.5-vl-7b-instruct': '通义千问2.5 VL 7B - 最新轻量级视觉模型',
            'qwen2.5-vl-72b-instruct': '通义千问2.5 VL 72B - 最新大规模视觉模型',

            // 豆包Seed系列最新模型（使用完整模型ID）
            'doubao-seed-1-6-flash-250615': '豆包Seed 1.6 Flash (2025.06.15) - 最新快速响应版本',
            'doubao-seed-1-6-32k-250615': '豆包Seed 1.6 32K (2025.06.15) - 最新一代基础模型',
            'doubao-seed-1-6-thinking-32k-250615': '豆包Seed 1.6 Thinking 32K (2025.06.15) - 最新深度思考模型',

            // 豆包1.5系列（使用完整模型ID）
            'doubao-1-5-vision-pro-32k-250115': '豆包1.5视觉Pro 32K (2025.01.15) - 最新专业级多模态模型',
            'doubao-1-5-pro-32k-250115': '豆包1.5 Pro 32K (2025.01.15) - 最新专业级文本模型',
            'doubao-1-5-pro-32k-character-250228': '豆包1.5 Pro 32K Character (2025.02.28) - 角色扮演专用模型',
            'doubao-1-5-pro-256k-250115': '豆包1.5 Pro 256K (2025.01.15) - 长上下文专业模型',
            'doubao-1-5-lite-32k-250115': '豆包1.5 Lite 32K (2025.01.15) - 轻量级文本模型',
            'doubao-1-5-vision-lite-32k-250115': '豆包1.5视觉Lite 32K (2025.01.15) - 轻量级多模态模型',
            'doubao-1-5-thinking-pro-32k-250115': '豆包1.5思考Pro 32K (2025.01.15) - 深度推理模型',

            // 豆包传统模型系列
            'doubao-pro-32k-241215': '豆包Pro 32K (2024.12.15) - 专业级文本模型',
            'doubao-pro-32k-functioncall-241028': '豆包Pro 32K 函数调用版 (2024.10.28) - 支持工具调用',
            'doubao-pro-32k-character-241215': '豆包Pro 32K 角色版 (2024.12.15) - 角色扮演专用',
            'doubao-pro-256k-241115': '豆包Pro 256K (2024.11.15) - 长上下文专业模型',
            'doubao-lite-4k-character-240828': '豆包Lite 4K 角色版 (2024.08.28) - 轻量级角色模型',
            'doubao-lite-32k-240828': '豆包Lite 32K (2024.08.28) - 轻量级文本模型',
            'doubao-lite-32k-character-241015': '豆包Lite 32K 角色版 (2024.10.15) - 轻量级角色模型',
            'doubao-lite-128k-240828': '豆包Lite 128K (2024.08.28) - 中等上下文轻量级模型',
            'doubao-vision-lite-32k-241015': '豆包视觉Lite 32K (2024.10.15) - 轻量级多模态模型',

            // 豆包嵌入模型
            'doubao-embedding-large-text-240915': '豆包嵌入Large (2024.09.15) - 大型文本嵌入模型',
            'doubao-embedding-text-240715': '豆包嵌入 (2024.07.15) - 标准文本嵌入模型',
            'doubao-embedding-vision-241215': '豆包视觉嵌入 (2024.12.15) - 多模态嵌入模型',

            // DeepSeek模型系列
            'deepseek-r1-250120': 'DeepSeek R1 (2025.01.20) - 推理专用模型',
            'deepseek-r1-distill-qwen-32b-250120': 'DeepSeek R1 Distill Qwen 32B (2025.01.20) - 蒸馏版推理模型32B',
            'deepseek-r1-distill-qwen-7b-250120': 'DeepSeek R1 Distill Qwen 7B (2025.01.20) - 蒸馏版推理模型7B',
            'deepseek-v3-250324': 'DeepSeek V3 (2025.03.24) - 最新通用模型',

            // 其他第三方模型
            'moonshot-v1-auto': 'Moonshot V1 Auto - 月之暗面自动版本',

            // 智谱AI模型
            'glm-4v-plus': '智谱AI GLM-4V Plus - 旗舰级多模态视觉理解模型',
            'glm-4v-flash': '智谱AI GLM-4V Flash - 快速响应视觉理解模型',
            'glm-4v': '智谱AI GLM-4V - 标准多模态视觉理解模型',
            'glm-4-plus': '智谱AI GLM-4 Plus - 旗舰级文本生成模型',
            'glm-4-flash': '智谱AI GLM-4 Flash - 快速文本生成模型',
            'glm-4-long': '智谱AI GLM-4 Long - 长文本处理模型',
            'glm-4-airx': '智谱AI GLM-4 AirX - 轻量级高性能模型',
            'glm-4-air': '智谱AI GLM-4 Air - 轻量级文本模型',
            'chatglm-turbo': '智谱AI ChatGLM Turbo - 对话生成模型',
            'glm-4v-plus-0111': '智谱AI GLM-4V Plus (0111版本) - 最新视觉理解模型',
            'glm-4v-flash-0111': '智谱AI GLM-4V Flash (0111版本) - 最新快速视觉模型'
        };

        return descriptions[modelId] || '多模态视觉语言模型';
    }

    // 验证自定义模型名称
    validateCustomModel(platform, modelName) {
        if (!modelName || typeof modelName !== 'string') {
            return { valid: false, error: '模型名称不能为空' };
        }

        const platformPatterns = {
            openai: /^(gpt-4|gpt-3\.5)/i,
            anthropic: /^claude-/i,
            google: /^gemini-/i,
            alibaba: /^(qwen|qwen2)-vl|^qwen-mt/i,
            bytedance: /^(doubao|ep-)/i,
            zhipu: /^(glm-|chatglm)/i
        };

        const pattern = platformPatterns[platform];
        if (pattern && !pattern.test(modelName)) {
            return {
                valid: false,
                error: `模型名称格式不正确，${platform}平台的模型应该以${this.getExpectedPrefix(platform)}开头`
            };
        }

        return { valid: true };
    }

    // 获取期望的模型前缀
    getExpectedPrefix(platform) {
        const prefixes = {
            openai: 'gpt-',
            anthropic: 'claude-',
            google: 'gemini-',
            alibaba: 'qwen-vl、qwen2-vl或qwen-mt',
            bytedance: 'doubao或ep-',
            zhipu: 'glm-或chatglm-'
        };
        return prefixes[platform] || '';
    }

    // 获取模型的详细信息
    getModelInfo(platform, modelId) {
        const platformInfo = this.getPlatformInfo(platform);
        if (!platformInfo) return null;

        return {
            platform: platformInfo.name,
            modelId: modelId,
            description: this.getModelDescription(modelId),
            apiEndpoint: this.getApiEndpoint(platform, modelId),
            maxTokens: this.getMaxTokens(platform, modelId),
            supportedFeatures: this.getSupportedFeatures(platform, modelId)
        };
    }

    // 获取API端点
    getApiEndpoint(platform, modelId) {
        const endpoints = {
            openai: '/v1/chat/completions',
            anthropic: '/v1/messages',
            google: `/v1beta/models/${modelId}:generateContent`,
            alibaba: '/api/v1/services/aigc/text-generation/generation',
            bytedance: '/api/v3/chat/completions',
            zhipu: '/chat/completions'  // 智谱AI使用官方端点，不是OpenAI兼容端点
        };
        return endpoints[platform] || '';
    }

    // 获取最大Token数
    getMaxTokens(modelId) {
        const maxTokens = {
            'gpt-4-vision-preview': 4096,
            'gpt-4o': 4096,
            'gpt-4o-mini': 16384,
            'claude-3-5-sonnet-20241022': 8192,
            'claude-3-opus-20240229': 4096,
            'claude-3-sonnet-20240229': 4096,
            'claude-3-haiku-20240307': 4096,
            'gemini-1.5-flash': 8192,
            'gemini-1.5-pro': 8192,
            'gemini-2.0-flash-exp': 8192,
            'qwen-vl-plus': 8192,
            'qwen-vl-max': 8192,
            'qwen2-vl-7b-instruct': 8192,
            'qwen2-vl-72b-instruct': 8192,
            'doubao-vision-pro-32k': 32768,
            'doubao-vision-lite-32k': 32768,
            'ep-20241230140207-8xqkz': 32768,
            'glm-4v-plus': 8192,
            'glm-4v-flash': 8192,
            'glm-4v': 8192,
            'glm-4-plus': 8192,
            'glm-4-flash': 8192,
            'glm-4-long': 8192,
            'glm-4-airx': 8192,
            'glm-4-air': 8192,
            'chatglm-turbo': 4096
        };
        return maxTokens[modelId] || 4096;
    }

    // 获取支持的功能
    getSupportedFeatures(platform, modelId) {
        return {
            vision: true,
            text: true,
            streaming: platform !== 'google',
            functionCalling: ['openai', 'zhipu'].includes(platform),
            systemPrompt: platform !== 'google'
        };
    }

    // 获取阿里云百炼模型列表 - 通过兼容模式API获取
    async fetchAlibabaModels(apiKey, baseUrl) {
        try {
            // 使用阿里云百炼的默认API端点
            const defaultBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
            const actualBaseUrl = baseUrl || defaultBaseUrl;

            // 构建 API URL，支持 # 原样使用标记
            let modelsUrl;
            const rawUrl = window.urlUtils.checkRawUrlMarker(actualBaseUrl);
            if (rawUrl !== null) {
                // 有 # 标记，直接使用去除 # 后的 URL
                modelsUrl = rawUrl;
            } else {
                // 正常处理：使用 buildOpenAIModelsUrl 构造 URL（阿里云百炼使用 OpenAI 兼容模式）
                modelsUrl = window.urlUtils.buildOpenAIModelsUrl(actualBaseUrl, defaultBaseUrl);
            }

            // 使用兼容模式API获取模型列表
            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'OCR-Plugin/1.0',
                    // 添加标准API请求头
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`阿里云百炼API错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            // 检查响应格式，支持多种可能的响应结构
            let modelsArray = [];
            if (data.data && Array.isArray(data.data)) {
                modelsArray = data.data;
            } else if (Array.isArray(data)) {
                modelsArray = data;
            } else if (data.models && Array.isArray(data.models)) {
                modelsArray = data.models;
            } else {
                throw new Error('阿里云百炼API返回的数据格式异常');
            }

            // 过滤不支持的模型类型
            const allModels = modelsArray.filter(model => {
                if (!model.id) return false;

                // 排除不支持的模型类型（TTS、语音识别等）
                // NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i
                const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i;

                return !NOT_SUPPORTED_REGEX.test(model.id);
            });

            // 格式化并返回模型数据
            return allModels.map(model => {
                // 清理模型ID格式
                const modelId = model.id.trim();

                return {
                    id: modelId,
                    name: modelId,
                    description: this.getModelDescription(modelId),
                    created: model.created,
                    owned_by: model.owned_by || 'alibaba',
                    object: model.object || 'model',
                    // 使用模型能力检测逻辑
                    capabilities: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.detectCapabilities('alibaba', modelId, {
                            owned_by: model.owned_by,
                            object: model.object
                        }) : [],
                    // 保持向后兼容
                    isVisionModel: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.isVisionModel('alibaba', modelId, {
                            owned_by: model.owned_by,
                            object: model.object
                        }) : false
                };
            });
        } catch (error) {
            // 返回默认模型列表
            const platformInfo = this.getPlatformInfo('alibaba');
            return this.getDefaultModels(platformInfo, 'alibaba');
        }
    }

    // 获取火山引擎模型列表
    async fetchByteDanceModels(apiKey, baseUrl, forceRefresh = false) {
        try {
            const accessKey = this.getElementValue('bytedance-access-key');
            const secretKey = this.getElementValue('bytedance-secret-key');

            // 配置验证：检查是否有任何可用的认证方式
            const hasNewApiConfig = accessKey && secretKey;
            const hasLegacyApiConfig = apiKey;

            if (!hasNewApiConfig && !hasLegacyApiConfig) {
                throw new Error('BYTEDANCE_CONFIG_MISSING');
            }

            // 生成配置哈希值
            const configHash = this.generateConfigHash(`${accessKey}:${secretKey}:${apiKey}`, baseUrl);

            // 检查统一缓存（除非强制刷新）
            if (!forceRefresh && window.unifiedStorage) {
                const cached = window.unifiedStorage.getModelListCache('bytedance', configHash);
                if (cached) {

                    return cached;
                }
            }

            // 优先尝试新API（如果配置完整）
            if (hasNewApiConfig) {

                const newApiResult = await this.tryFetchByteDanceModelsWithNewAPI(forceRefresh);
                if (newApiResult && newApiResult.length > 0) {
                    // 使用统一缓存存储
                    if (window.unifiedStorage) {
                        window.unifiedStorage.setModelListCache('bytedance', newApiResult, configHash);
                    }
                    return newApiResult;
                }

            }

            // 回退到旧API（如果有API Key配置）
            if (hasLegacyApiConfig) {

                const legacyResult = await this.fetchByteDanceModelsLegacy(apiKey, baseUrl);

                // 使用统一缓存存储
                if (window.unifiedStorage && legacyResult) {
                    window.unifiedStorage.setModelListCache('bytedance', legacyResult, configHash);
                }
                return legacyResult;
            }

            // 如果所有方式都失败，抛出配置错误
            throw new Error('BYTEDANCE_CONFIG_MISSING');

        } catch (error) {
            console.error(`[火山引擎] 获取模型列表失败:`, error);

            // 如果是配置缺失错误，直接抛出，让上层处理
            if (error.message === 'BYTEDANCE_CONFIG_MISSING') {
                throw error;
            }

            // 其他错误返回默认模型列表
            const platformInfo = this.getPlatformInfo('bytedance');
            const defaultModels = this.getDefaultModels(platformInfo, 'bytedance');
            return defaultModels;
        }
    }

    // 火山引擎模型缓存方法

    generateByteDanceCacheKey(accessKey, secretKey, apiKey) {
        const configHash = this.generateConfigHash(accessKey, secretKey, apiKey);
        return `bytedance-models-${configHash}`;
    }

    generateConfigHash(accessKey, secretKey, apiKey) {
        const configString = `${accessKey || ''}-${secretKey || ''}-${apiKey || ''}`;
        let hash = 0;
        for (let i = 0; i < configString.length; i++) {
            const char = configString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    // 火山引擎缓存方法已迁移到统一存储管理器

    clearByteDanceModelsCache(accessKey, secretKey, apiKey) {
        try {
            if (accessKey || secretKey || apiKey) {
                const cacheKey = this.generateByteDanceCacheKey(accessKey, secretKey, apiKey);
                localStorage.removeItem(cacheKey);
            } else {
                const keys = Object.keys(localStorage);
                keys.forEach(key => {
                    if (key.startsWith('bytedance-models-')) {
                        localStorage.removeItem(key);
                    }
                });
            }
        } catch (error) {
            console.error('[火山引擎] 清除缓存失败:', error);
        }
    }

    // 尝试使用新的火山引擎API获取完整模型列表
    async tryFetchByteDanceModelsWithNewAPI(forceRefresh = false) {
        try {
            // 获取配置的AK/SK
            const accessKey = this.getElementValue('bytedance-access-key');
            const secretKey = this.getElementValue('bytedance-secret-key');

            if (!accessKey || !secretKey) {

                return null;
            }



            // 第一步：获取所有基础模型列表
            const foundationModels = await this.fetchFoundationModels(accessKey, secretKey);
            if (!foundationModels || foundationModels.length === 0) {
                console.warn('[火山引擎] 未获取到基础模型列表');
                return null;
            }



            // 第二步：获取每个基础模型的版本列表（分批处理，避免过多并发）
            const allModelVersions = await this.fetchAllModelVersions(accessKey, secretKey, foundationModels);

            if (allModelVersions.length === 0) {
                console.warn('[火山引擎] 未获取到任何模型版本');
                return null;
            }


            return allModelVersions;

        } catch (error) {
            console.error('[火山引擎] 新API调用失败:', error);

            // 检查是否是认证相关错误
            if (error.message && (
                error.message.includes('InvalidAccessKeyId') ||
                error.message.includes('SignatureDoesNotMatch') ||
                error.message.includes('InvalidSecretAccessKey') ||
                error.message.includes('AccessDenied') ||
                error.message.includes('Forbidden')
            )) {
                throw new Error('BYTEDANCE_AUTH_ERROR: ' + error.message);
            }

            // 检查是否是网络错误
            if (error.message && (
                error.message.includes('NetworkError') ||
                error.message.includes('fetch') ||
                error.message.includes('timeout') ||
                error.message.includes('ENOTFOUND') ||
                error.message.includes('ECONNREFUSED')
            )) {
                throw new Error('BYTEDANCE_NETWORK_ERROR: ' + error.message);
            }

            // 其他错误也抛出，让上层处理
            throw new Error('BYTEDANCE_API_ERROR: ' + error.message);
        }
    }

    // 获取基础模型列表
    async fetchFoundationModels(accessKey, secretKey) {
        try {
            // 构建完整的请求URL（查询参数必须包含在签名计算中）
            const baseUrl = 'https://open.volcengineapi.com/';
            const requestUrl = `${baseUrl}?Action=ListFoundationModels&Version=2024-01-01`;
            const method = 'POST';
            const body = JSON.stringify({
                PageNumber: 1,
                PageSize: 100
            });

            // 创建签名器（使用正确的服务名称）
            const signer = new VolcengineSigner(accessKey, secretKey, 'cn-beijing', 'ark');

            // 构建基础请求头（必须在签名前设置所有需要签名的头）
            const headers = signer.buildHeaders(method, requestUrl, body);

            // 使用统一的时间戳
            const timestamp = new Date();
            const dateTime = signer.formatDateTime(timestamp);

            // 添加必要的请求头（这些头需要参与签名）
            headers['x-date'] = dateTime;
            headers['x-content-sha256'] = await signer.sha256(body);




            // 生成签名
            const signInfo = await signer.sign(method, requestUrl, headers, body);

            // 添加Authorization头
            headers['Authorization'] = signInfo.authorization;



            const response = await fetch(requestUrl, {
                method,
                headers,
                body
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[火山引擎] ListFoundationModels API调用失败 (${response.status}):`, errorText);
                throw new Error(`火山引擎ListFoundationModels API错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();


            // 处理响应格式
            if (!data.Result || !data.Result.Items || !Array.isArray(data.Result.Items)) {
                console.error('[火山引擎] ListFoundationModels API响应格式异常:', data);
                return [];
            }

            // 过滤掉没有模型名称的项，并添加调试信息
            // 注意：API返回的字段可能是 FoundationModelName 或 Name
            const validItems = data.Result.Items.filter(item => {
                const modelName = item.FoundationModelName || item.Name;
                if (!modelName || typeof modelName !== 'string' || modelName.trim() === '') {
                    console.warn('[火山引擎] 发现无效的基础模型项（缺少模型名称）:', item);
                    return false;
                }
                return true;
            });



            return validItems.map(item => {
                const modelName = item.FoundationModelName || item.Name;
                return {
                    name: modelName,
                    description: item.Description || '',
                    status: item.Status || '',
                    createTime: item.CreateTime || '',
                    updateTime: item.UpdateTime || ''
                };
            });

        } catch (error) {
            console.error('[火山引擎] 获取基础模型列表失败:', error);
            return [];
        }
    }

    // 获取所有基础模型的版本列表（分批处理）
    async fetchAllModelVersions(accessKey, secretKey, foundationModels) {
        const allVersions = [];
        const batchSize = 3; // 每批处理3个模型，避免过多并发请求

        // 分批处理基础模型
        for (let i = 0; i < foundationModels.length; i += batchSize) {
            const batch = foundationModels.slice(i, i + batchSize);


            // 并发获取当前批次的模型版本，添加额外的验证
            const batchPromises = batch.map(model => {
                // 验证模型名称是否有效
                if (!model || !model.name || typeof model.name !== 'string' || model.name.trim() === '') {
                    console.warn(`[火山引擎] 跳过无效的模型:`, model);
                    return Promise.resolve([]); // 返回空数组
                }

                return this.fetchFoundationModelVersions(accessKey, secretKey, model.name.trim())
                    .catch(error => {
                        console.warn(`[火山引擎] 获取模型 ${model.name} 的版本失败:`, error);
                        return []; // 返回空数组，不影响其他模型
                    });
            });

            const batchResults = await Promise.all(batchPromises);

            // 合并当前批次的结果
            batchResults.forEach(versions => {
                if (versions && versions.length > 0) {
                    allVersions.push(...versions);
                }
            });

            // 批次间稍作延迟，避免请求过于频繁
            if (i + batchSize < foundationModels.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        return allVersions;
    }

    // 获取特定基础模型的版本列表
    async fetchFoundationModelVersions(accessKey, secretKey, foundationModelName) {
        try {
            // 验证必需参数
            if (!foundationModelName || typeof foundationModelName !== 'string' || foundationModelName.trim() === '') {
                throw new Error(`无效的基础模型名称: ${foundationModelName}`);
            }

            const trimmedModelName = foundationModelName.trim();


            // 构建完整的请求URL（查询参数必须包含在签名计算中）
            const baseUrl = 'https://open.volcengineapi.com/';
            const requestUrl = `${baseUrl}?Action=ListFoundationModelVersions&Version=2024-01-01`;
            const method = 'POST';
            const body = JSON.stringify({
                FoundationModelName: trimmedModelName,
                PageNumber: 1,
                PageSize: 100
            });

            // 创建签名器（使用正确的服务名称）
            const signer = new VolcengineSigner(accessKey, secretKey, 'cn-beijing', 'ark');

            // 构建基础请求头（必须在签名前设置所有需要签名的头）
            const headers = signer.buildHeaders(method, requestUrl, body);

            // 使用统一的时间戳
            const timestamp = new Date();
            const dateTime = signer.formatDateTime(timestamp);

            // 添加必要的请求头（这些头需要参与签名）
            headers['x-date'] = dateTime;
            headers['x-content-sha256'] = await signer.sha256(body);

            // 生成签名
            const signInfo = await signer.sign(method, requestUrl, headers, body);

            // 添加Authorization头
            headers['Authorization'] = signInfo.authorization;

            const response = await fetch(requestUrl, {
                method,
                headers,
                body
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[火山引擎] ListFoundationModelVersions API调用失败 (${response.status}):`, errorText);
                throw new Error(`火山引擎ListFoundationModelVersions API错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();


            // 处理响应格式
            if (!data.Result || !data.Result.Items || !Array.isArray(data.Result.Items)) {
                console.warn(`[火山引擎] ${foundationModelName} 版本列表响应格式异常:`, data);
                return [];
            }

            return data.Result.Items.map(item => {
                const modelId = `${item.FoundationModelName}-${item.ModelVersion}`;

                return {
                    id: modelId,
                    name: modelId,
                    description: item.Description || this.getModelDescription(modelId),
                    created: item.CreateTime ? new Date(item.CreateTime).getTime() / 1000 : Date.now() / 1000,
                    owned_by: 'bytedance',
                    object: 'model',
                    // 新API特有的字段
                    foundationModelName: item.FoundationModelName,
                    modelVersion: item.ModelVersion,
                    status: item.Status,
                    publishTime: item.PublishTime,
                    updateTime: item.UpdateTime,
                    activeConfigurationId: item.ActiveConfigurationId,
                    // 使用模型能力检测逻辑
                    capabilities: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.detectCapabilities('bytedance', modelId) : [],
                    isVisionModel: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.isVisionModel('bytedance', modelId) : false
                };
            });

        } catch (error) {
            console.error(`[火山引擎] 获取 ${foundationModelName} 版本列表失败:`, error);
            return [];
        }
    }

    // 旧的方舟API方式（保持向后兼容）
    async fetchByteDanceModelsLegacy(apiKey, baseUrl) {
        // 使用火山引擎方舟API端点
        const defaultApiUrl = 'https://ark.cn-beijing.volces.com/api/v3';
        const apiUrl = baseUrl || defaultApiUrl;

        // 构建 API URL，支持 # 原样使用标记
        let modelsUrl;
        const rawUrl = window.urlUtils.checkRawUrlMarker(apiUrl);
        if (rawUrl !== null) {
            // 有 # 标记，直接使用去除 # 后的 URL
            modelsUrl = rawUrl;
        } else {
            // 正常处理：确保API端点格式正确
            modelsUrl = apiUrl.endsWith('/models') ? apiUrl : `${apiUrl}/models`;
        }

        const response = await fetch(modelsUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'OCR-Plugin/1.0',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[火山引擎] 旧API调用失败 (${response.status}):`, errorText);
            throw new Error(`火山引擎旧API错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 检查响应格式，支持多种可能的响应结构
        let modelsArray = [];
        if (data.data && Array.isArray(data.data)) {
            modelsArray = data.data;
        } else if (Array.isArray(data)) {
            modelsArray = data;
        } else if (data.models && Array.isArray(data.models)) {
            modelsArray = data.models;
        } else {
            console.error(`[火山引擎] 旧API未知的响应格式:`, data);
            throw new Error(`火山引擎旧API返回的数据格式异常: ${JSON.stringify(data)}`);
        }

        // 过滤不支持的模型类型
        const allModels = modelsArray.filter(model => {
            if (!model.id) {
                return false;
            }

            // 排除不支持的模型类型（TTS、语音识别等）
            const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i;
            const isSupported = !NOT_SUPPORTED_REGEX.test(model.id);
            return isSupported;
        });

        // 格式化并返回模型数据
        const processedModels = allModels.map(model => {
            // 清理模型ID格式
            const modelId = model.id.trim();
            return {
                id: modelId,
                name: modelId,
                description: this.getModelDescription(modelId),
                created: model.created,
                owned_by: model.owned_by || 'bytedance',
                object: model.object || 'model',
                capabilities: window.modelCapabilityDetector ?
                    window.modelCapabilityDetector.detectCapabilities('bytedance', modelId, {
                        name: modelId,
                        owned_by: model.owned_by,
                        object: model.object
                    }) : [],
                isVisionModel: window.modelCapabilityDetector ?
                    window.modelCapabilityDetector.isVisionModel('bytedance', modelId, {
                        name: modelId,
                        owned_by: model.owned_by,
                        object: model.object
                    }) : false
            };
        });

        return processedModels;
    }

    // 获取元素值的辅助方法
    getElementValue(elementId) {
        const element = document.getElementById(elementId);
        return element ? element.value.trim() : '';
    }

    // 获取智谱AI模型列表 - 通过OpenAI兼容API获取
    async fetchZhipuModels(apiKey, baseUrl) {
        try {
            // 使用智谱AI的OpenAI兼容API端点 - 需要使用/v1/models路径
            const zhipuBaseUrl = baseUrl || 'https://open.bigmodel.cn/api/paas/v4';

            // 构建 API URL，支持 # 原样使用标记
            let modelsUrl;
            const rawUrl = window.urlUtils.checkRawUrlMarker(zhipuBaseUrl);
            if (rawUrl !== null) {
                // 有 # 标记，直接使用去除 # 后的 URL
                modelsUrl = rawUrl;
            } else {
                const versionedBase = window.urlUtils.buildVersionedBase(
                    zhipuBaseUrl,
                    'https://open.bigmodel.cn',
                    '/v1'
                );
                modelsUrl = `${versionedBase}/models`;
            }



            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'OCR-Plugin/1.0'
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`智谱AI API错误 (${response.status}): ${errorText}`);
            }

            const data = await response.json();

            if (!data.data || !Array.isArray(data.data)) {
                throw new Error('智谱AI API返回的数据格式异常');
            }

            // 过滤并返回智谱AI模型
            const allModels = data.data.filter(model => {
                if (!model.id) return false;

                // 排除不支持的模型类型
                const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i;
                return !NOT_SUPPORTED_REGEX.test(model.id);
            });

            // 格式化并返回模型数据
            return allModels.map(model => {
                const cleanId = model.id.trim();
                return {
                    id: cleanId,
                    name: cleanId,
                    description: this.getModelDescription(cleanId),
                    created: model.created,
                    owned_by: model.owned_by || 'zhipu',
                    object: model.object,
                    // 使用模型能力检测逻辑
                    capabilities: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.detectCapabilities('zhipu', cleanId, {
                            owned_by: model.owned_by,
                            object: model.object
                        }) : [],
                    // 保持向后兼容
                    isVisionModel: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.isVisionModel('zhipu', cleanId, {
                            owned_by: model.owned_by,
                            object: model.object
                        }) : false
                };
            });
        } catch (error) {
            console.error(`[智谱AI] 获取模型列表失败:`, error);
            // 返回默认模型列表
            const platformInfo = this.getPlatformInfo('zhipu');
            return this.getDefaultModels(platformInfo, 'zhipu');
        }
    }

    // 获取uTools模型列表 - 使用智能服务商检测
    async fetchUtoolsModels() {
        try {
            if (typeof utools === 'undefined') {
                throw new Error('uTools API 不可用，请确保在uTools环境中运行');
            }

            if (!utools.allAiModels) {
                throw new Error('uTools AI API 不可用，请确保uTools版本 >= 7.0.0');
            }

            // 根据官方文档，utools.allAiModels() 返回 Promise<AiModel[]>
            const aiModels = await utools.allAiModels();

            if (!Array.isArray(aiModels) || aiModels.length === 0) {
                throw new Error('未获取到可用的uTools AI模型');
            }

            // 返回所有可用的uTools AI模型（包括视觉模型和文本模型）
            const allModels = aiModels.filter(model => {
                if (!model.id && !model.label) {
                    return false;
                }
                // 基本过滤：保留所有有效的AI模型
                return true;
            });

            return allModels.map(model => {
                const modelId = model.id;
                const modelName = model.label || modelId;

                // 智能检测真实服务商（使用统一的能力检测器）
                const realProvider = window.modelCapabilityDetector ?
                    window.modelCapabilityDetector.detectRealProvider(modelId, modelName) : 'utools';

                // 准备模型数据
                const modelData = {
                    name: modelName,
                    label: model.label,
                    displayName: modelName,
                    cost: model.cost,
                    realProvider: realProvider // 传递真实服务商信息
                };

                // 使用uTools服务商进行能力检测，让重构后的逻辑生效
                const capabilities = window.modelCapabilityDetector ?
                    window.modelCapabilityDetector.detectCapabilities('utools', modelId, modelData) : [];

                return {
                    id: modelId,
                    name: modelName,
                    description: model.description || `uTools AI 模型: ${modelName}`,
                    icon: model.icon || '',
                    cost: model.cost || 0,
                    isDefault: false,
                    platform: 'utools',
                    realProvider: realProvider, // 真实服务商
                    capabilities: capabilities,
                    // 保持向后兼容
                    isVisionModel: window.modelCapabilityDetector ?
                        window.modelCapabilityDetector.isVisionModel('utools', modelId, modelData) : false
                };
            });
        } catch (error) {
            // 返回空数组，表示没有可用模型
            return [];
        }
    }



    // 格式化火山引擎模型名称，使其更加用户友好（支持完整模型ID）
    formatByteDanceModelName(modelId) {
        if (!modelId) return modelId;

        // 如果已经有自定义描述，直接返回原ID
        const description = this.getModelDescription(modelId);
        if (description !== '多模态视觉语言模型') {
            return modelId;
        }

        // 格式化完整模型ID的显示名称
        let formattedName = modelId;

        // 处理版本号格式：1-5 -> 1.5, 1-6 -> 1.6
        formattedName = formattedName.replace(/doubao-1-5-/g, 'doubao-1.5-');
        formattedName = formattedName.replace(/doubao-1-6-/g, 'doubao-1.6-');
        formattedName = formattedName.replace(/doubao-seed-1-6-/g, 'doubao-seed-1.6-');
        formattedName = formattedName.replace(/doubao-seedance-1-0-/g, 'doubao-seedance-1.0-');
        formattedName = formattedName.replace(/wan2-1-/g, 'wan-2.1-');

        // 处理日期格式：250115 -> (2025.01.15), 250615 -> (2025.06.15)
        formattedName = formattedName.replace(/-(\d{2})(\d{2})(\d{2})$/, ' ($1.$2.$3)');

        // 美化显示
        formattedName = formattedName
            .replace(/doubao-/g, '豆包 ')
            .replace(/deepseek-/g, 'DeepSeek ')
            .replace(/moonshot-/g, 'Moonshot ')
            .replace(/wan-/g, 'Wan ')
            .replace(/vision-/g, '视觉 ')
            .replace(/thinking-/g, '思考 ')
            .replace(/seedance-/g, 'Seedance ')
            .replace(/seed-/g, 'Seed ')
            .replace(/ui-tars/g, 'UI-TARS')
            .replace(/pro/g, 'Pro')
            .replace(/lite/g, 'Lite')
            .replace(/flash/g, 'Flash')
            .replace(/32k/g, '32K')
            .replace(/256k/g, '256K')
            .replace(/4k/g, '4K')
            .replace(/128k/g, '128K')
            .replace(/-/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        return formattedName;
    }

    // 清除缓存（保持向后兼容）
    clearCache() {
        return this.clearAllCache();
    }
}

// 导出模型管理器
window.ModelManager = ModelManager;

// 创建全局 ModelManager 实例供 Provider 使用
if (!window.modelManager) {
    window.modelManager = new ModelManager();
}
