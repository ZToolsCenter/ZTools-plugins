/**
 * 模型服务商 Provider 抽象层
 * 统一各个服务商的模型列表获取逻辑
 */

/**
 * IModelProvider 接口定义
 * 所有 Provider 必须实现 listModels 方法
 */
class IModelProvider {
    /**
     * 获取模型列表
     * @param {Object} config - 配置对象 { platform, apiKey, baseUrl, extraHeaders, timeout }
     * @returns {Promise<Array>} 规范化的模型列表
     */
    async listModels(config) {
        throw new Error('listModels 方法必须被实现');
    }

    /**
     * 规范化模型数据
     * @param {Object} rawModel - 原始模型数据
     * @param {string} platform - 平台标识
     * @returns {Object} 规范化的模型对象
     */
    normalizeModel(rawModel, platform) {
        return {
            id: rawModel.id || rawModel.name,
            name: rawModel.name || rawModel.id,
            description: rawModel.description || '',
            provider: platform,
            group: rawModel.group || '',
            capabilities: rawModel.capabilities || [],
            isVisionModel: rawModel.isVisionModel || false,
            extraMeta: rawModel.extraMeta || {}
        };
    }

    /**
     * 过滤不支持的模型类型
     * @param {Array} models - 模型列表
     * @returns {Array} 过滤后的模型列表
     */
    filterUnsupportedModels(models) {
        const NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech|embedding)/i;
        return models.filter(model => {
            if (!model.id) return false;
            return !NOT_SUPPORTED_REGEX.test(model.id);
        });
    }

    /**
     * 获取模型描述
     * @param {string} modelId - 模型ID
     * @returns {string} 模型描述
     */
    getModelDescription(modelId) {
        // 使用全局 ModelManager 的描述方法
        if (window.modelManager) {
            return window.modelManager.getModelDescription(modelId);
        }
        return '多模态视觉语言模型';
    }

    /**
     * 检测模型能力
     * @param {string} platform - 平台标识
     * @param {string} modelId - 模型ID
     * @param {Object} extraData - 额外数据
     * @returns {Array} 能力列表
     */
    detectCapabilities(platform, modelId, extraData = {}) {
        if (window.modelCapabilityDetector) {
            return window.modelCapabilityDetector.detectCapabilities(platform, modelId, extraData);
        }
        return [];
    }

    /**
     * 检测是否为视觉模型
     * @param {string} platform - 平台标识
     * @param {string} modelId - 模型ID
     * @param {Object} extraData - 额外数据
     * @returns {boolean} 是否为视觉模型
     */
    isVisionModel(platform, modelId, extraData = {}) {
        if (window.modelCapabilityDetector) {
            return window.modelCapabilityDetector.isVisionModel(platform, modelId, extraData);
        }
        return false;
    }
}

/**
 * OpenAI Provider
 * 支持原生 OpenAI API
 */
class OpenAIProvider extends IModelProvider {
    async listModels(config) {
        const { apiKey, baseUrl } = config;
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

        const filteredModels = this.filterUnsupportedModels(data.data);

        return filteredModels.map(model => {
            const cleanId = model.id.trim();
            return {
                id: cleanId,
                name: cleanId,
                description: this.getModelDescription(cleanId),
                created: model.created,
                owned_by: model.owned_by,
                object: model.object,
                capabilities: this.detectCapabilities('openai', cleanId, {
                    owned_by: model.owned_by,
                    object: model.object
                }),
                isVisionModel: this.isVisionModel('openai', cleanId, {
                    owned_by: model.owned_by,
                    object: model.object
                })
            };
        });
    }
}

/**
 * OpenAI 兼容 Provider
 * 用于支持 OpenAI 兼容的第三方服务
 */
class OpenAICompatibleProvider extends IModelProvider {
    async listModels(config) {
        const { apiKey, baseUrl, platform } = config;
        const modelsUrl = window.urlUtils.buildOpenAIModelsUrl(baseUrl, baseUrl);

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
            throw new Error(`OpenAI兼容API错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 兼容多种响应格式
        let modelsArray = [];
        if (data.data && Array.isArray(data.data)) {
            modelsArray = data.data;
        } else if (Array.isArray(data)) {
            modelsArray = data;
        } else if (data.models && Array.isArray(data.models)) {
            modelsArray = data.models;
        } else {
            throw new Error('OpenAI兼容API返回的数据格式异常');
        }

        const filteredModels = this.filterUnsupportedModels(modelsArray);

        return filteredModels.map(model => {
            const cleanId = model.id.trim();
            return {
                id: cleanId,
                name: cleanId,
                description: this.getModelDescription(cleanId),
                created: model.created,
                owned_by: model.owned_by || platform,
                object: model.object || 'model',
                capabilities: this.detectCapabilities(platform, cleanId, {
                    owned_by: model.owned_by,
                    object: model.object
                }),
                isVisionModel: this.isVisionModel(platform, cleanId, {
                    owned_by: model.owned_by,
                    object: model.object
                })
            };
        });
    }
}

/**
 * Google Gemini Provider
 */
class GoogleProvider extends IModelProvider {
    async listModels(config) {
        const { apiKey, baseUrl } = config;

        // 构建 API URL，支持 # 原样使用标记
        let modelsUrl;
        const rawUrl = window.urlUtils.checkRawUrlMarker(baseUrl);
        if (rawUrl !== null) {
            const separator = rawUrl.includes('?') ? '&' : '?';
            modelsUrl = `${rawUrl}${separator}key=${apiKey}`;
        } else {
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

        // 过滤 Gemini 模型
        const allModels = data.models.filter(model => {
            if (!model.name) return false;
            const modelName = model.name.toLowerCase();
            const isGemini = modelName.includes('gemini');
            const hasGenerateContent = model.supportedGenerationMethods?.includes('generateContent');
            const isEmbeddingModel = modelName.includes('embedding') ||
                model.supportedGenerationMethods?.includes('embedContent');
            const isAQAModel = modelName.includes('aqa');
            return isGemini && hasGenerateContent && !isEmbeddingModel && !isAQAModel;
        });

        return allModels.map(model => {
            const modelId = model.name.replace('models/', '');
            const displayName = model.displayName || modelId;

            return {
                id: modelId,
                name: displayName,
                description: model.description || this.getModelDescription(modelId),
                version: model.version,
                supportedMethods: model.supportedGenerationMethods,
                capabilities: this.detectCapabilities('google', modelId, {
                    name: displayName,
                    supportedMethods: model.supportedGenerationMethods
                }),
                isVisionModel: this.isVisionModel('google', modelId, {
                    name: displayName,
                    supportedMethods: model.supportedGenerationMethods
                })
            };
        });
    }
}

/**
 * 阿里云百炼 Provider
 */
class AlibabaProvider extends IModelProvider {
    async listModels(config) {
        const { apiKey, baseUrl } = config;
        const defaultBaseUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        const actualBaseUrl = baseUrl || defaultBaseUrl;

        // 构建 API URL，支持 # 原样使用标记
        let modelsUrl;
        const rawUrl = window.urlUtils.checkRawUrlMarker(actualBaseUrl);
        if (rawUrl !== null) {
            modelsUrl = rawUrl;
        } else {
            modelsUrl = window.urlUtils.buildOpenAIModelsUrl(actualBaseUrl, defaultBaseUrl);
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
            throw new Error(`阿里云百炼API错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 兼容多种响应格式
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

        const filteredModels = this.filterUnsupportedModels(modelsArray);

        return filteredModels.map(model => {
            const modelId = model.id.trim();
            return {
                id: modelId,
                name: modelId,
                description: this.getModelDescription(modelId),
                created: model.created,
                owned_by: model.owned_by || 'alibaba',
                object: model.object || 'model',
                capabilities: this.detectCapabilities('alibaba', modelId, {
                    owned_by: model.owned_by,
                    object: model.object
                }),
                isVisionModel: this.isVisionModel('alibaba', modelId, {
                    owned_by: model.owned_by,
                    object: model.object
                })
            };
        });
    }
}

/**
 * 火山引擎 Provider
 * 支持新旧两种 API
 */
class ByteDanceProvider extends IModelProvider {
    constructor() {
        super();
        this.modelManager = null; // 将在初始化时设置
    }

    async listModels(config) {
        const { apiKey, baseUrl, accessKey, secretKey, forceRefresh } = config;

        // 配置验证
        const hasNewApiConfig = accessKey && secretKey;
        const hasLegacyApiConfig = apiKey;

        if (!hasNewApiConfig && !hasLegacyApiConfig) {
            throw new Error('BYTEDANCE_CONFIG_MISSING');
        }

        // 优先尝试新 API
        if (hasNewApiConfig && this.modelManager) {

            try {
                const newApiResult = await this.modelManager.tryFetchByteDanceModelsWithNewAPI(forceRefresh);
                if (newApiResult && newApiResult.length > 0) {
                    return newApiResult;
                }
            } catch (error) {
                console.warn('[火山引擎Provider] 新API失败，尝试回退到旧API:', error);
            }
        }

        // 回退到旧 API
        if (hasLegacyApiConfig) {

            return await this.fetchLegacyModels(apiKey, baseUrl);
        }

        throw new Error('BYTEDANCE_CONFIG_MISSING');
    }

    async fetchLegacyModels(apiKey, baseUrl) {
        const defaultApiUrl = 'https://ark.cn-beijing.volces.com/api/v3';
        const apiUrl = baseUrl || defaultApiUrl;

        // 构建 API URL，支持 # 原样使用标记
        let modelsUrl;
        const rawUrl = window.urlUtils.checkRawUrlMarker(apiUrl);
        if (rawUrl !== null) {
            modelsUrl = rawUrl;
        } else {
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
            throw new Error(`火山引擎旧API错误 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 兼容多种响应格式
        let modelsArray = [];
        if (data.data && Array.isArray(data.data)) {
            modelsArray = data.data;
        } else if (Array.isArray(data)) {
            modelsArray = data;
        } else if (data.models && Array.isArray(data.models)) {
            modelsArray = data.models;
        } else {
            throw new Error('火山引擎旧API返回的数据格式异常');
        }

        const filteredModels = this.filterUnsupportedModels(modelsArray);

        return filteredModels.map(model => {
            const modelId = model.id.trim();
            return {
                id: modelId,
                name: modelId,
                description: this.getModelDescription(modelId),
                created: model.created,
                owned_by: model.owned_by || 'bytedance',
                object: model.object || 'model',
                capabilities: this.detectCapabilities('bytedance', modelId, {
                    name: modelId,
                    owned_by: model.owned_by,
                    object: model.object
                }),
                isVisionModel: this.isVisionModel('bytedance', modelId, {
                    name: modelId,
                    owned_by: model.owned_by,
                    object: model.object
                })
            };
        });
    }
}


/**
 * 智谱AI Provider
 */
class ZhipuProvider extends IModelProvider {
    async listModels(config) {
        const { apiKey, baseUrl } = config;
        const zhipuBaseUrl = baseUrl || 'https://open.bigmodel.cn/api/paas/v4';

        // 构建 API URL，支持 # 原样使用标记
        let modelsUrl;
        const rawUrl = window.urlUtils.checkRawUrlMarker(zhipuBaseUrl);
        if (rawUrl !== null) {
            modelsUrl = rawUrl;
        } else {
            // 智谱AI使用专用的 buildZhipuChatBase，然后拼接 /models
            const chatBase = window.urlUtils.buildZhipuChatBase(zhipuBaseUrl);
            modelsUrl = `${chatBase}/models`;
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

        const filteredModels = this.filterUnsupportedModels(data.data);

        return filteredModels.map(model => {
            const cleanId = model.id.trim();
            return {
                id: cleanId,
                name: cleanId,
                description: this.getModelDescription(cleanId),
                created: model.created,
                owned_by: model.owned_by || 'zhipu',
                object: model.object,
                capabilities: this.detectCapabilities('zhipu', cleanId, {
                    owned_by: model.owned_by,
                    object: model.object
                }),
                isVisionModel: this.isVisionModel('zhipu', cleanId, {
                    owned_by: model.owned_by,
                    object: model.object
                })
            };
        });
    }
}

/**
 * Anthropic Provider
 * Anthropic 不提供模型列表 API，返回预设模型
 */
class AnthropicProvider extends IModelProvider {
    async listModels(config) {
        const { platformInfo } = config;

        return platformInfo.defaultModels.map(model => ({
            id: model,
            name: model,
            description: this.getModelDescription(model),
            isDefault: true,
            capabilities: this.detectCapabilities('anthropic', model),
            isVisionModel: this.isVisionModel('anthropic', model)
        }));
    }
}

/**
 * uTools AI Provider
 */
class UtoolsProvider extends IModelProvider {
    async listModels(config) {
        if (typeof utools === 'undefined') {
            throw new Error('uTools API 不可用，请确保在uTools环境中运行');
        }

        if (!utools.allAiModels) {
            throw new Error('uTools AI API 不可用，请确保uTools版本 >= 7.0.0');
        }

        const aiModels = await utools.allAiModels();

        if (!Array.isArray(aiModels) || aiModels.length === 0) {
            throw new Error('未获取到可用的uTools AI模型');
        }

        const allModels = aiModels.filter(model => {
            return model.id || model.label;
        });

        return allModels.map(model => {
            const modelId = model.id;
            const modelName = model.label || modelId;

            // 智能检测真实服务商
            const realProvider = window.modelCapabilityDetector ?
                window.modelCapabilityDetector.detectRealProvider(modelId, modelName) : 'utools';

            const modelData = {
                name: modelName,
                label: model.label,
                displayName: modelName,
                cost: model.cost,
                realProvider: realProvider
            };

            const capabilities = this.detectCapabilities('utools', modelId, modelData);

            return {
                id: modelId,
                name: modelName,
                description: model.description || `uTools AI 模型: ${modelName}`,
                icon: model.icon || '',
                cost: model.cost || 0,
                isDefault: false,
                platform: 'utools',
                realProvider: realProvider,
                capabilities: capabilities,
                isVisionModel: this.isVisionModel('utools', modelId, modelData)
            };
        });
    }
}

/**
 * OCR Pro Provider
 * 返回预设的 OCR Pro 模型列表
 */
class OcrProProvider extends IModelProvider {
    async listModels(config) {
        return [
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
    }
}

/**
 * Provider 注册表
 * 根据平台返回对应的 Provider 实例
 */
class ProviderRegistry {
    constructor() {
        this.providers = new Map();
        this.initializeProviders();
    }

    initializeProviders() {
        this.providers.set('openai', new OpenAIProvider());
        this.providers.set('openai-compatible', new OpenAICompatibleProvider());
        this.providers.set('google', new GoogleProvider());
        this.providers.set('alibaba', new AlibabaProvider());
        this.providers.set('bytedance', new ByteDanceProvider());
        this.providers.set('zhipu', new ZhipuProvider());
        this.providers.set('anthropic', new AnthropicProvider());
        this.providers.set('utools', new UtoolsProvider());
        this.providers.set('ocrpro', new OcrProProvider());
    }

    /**
     * 获取指定平台的 Provider
     * @param {string} platform - 平台标识
     * @returns {IModelProvider} Provider 实例
     */
    getProvider(platform) {
        const provider = this.providers.get(platform);
        if (!provider) {
            throw new Error(`不支持的平台: ${platform}`);
        }
        return provider;
    }

    /**
     * 注册自定义 Provider
     * @param {string} platform - 平台标识
     * @param {IModelProvider} provider - Provider 实例
     */
    registerProvider(platform, provider) {
        this.providers.set(platform, provider);
    }

    /**
     * 获取所有已注册的平台
     * @returns {Array<string>} 平台列表
     */
    getSupportedPlatforms() {
        return Array.from(this.providers.keys());
    }
}

// 导出所有类
window.IModelProvider = IModelProvider;
window.OpenAIProvider = OpenAIProvider;
window.OpenAICompatibleProvider = OpenAICompatibleProvider;
window.GoogleProvider = GoogleProvider;
window.AlibabaProvider = AlibabaProvider;
window.ByteDanceProvider = ByteDanceProvider;
window.ZhipuProvider = ZhipuProvider;
window.AnthropicProvider = AnthropicProvider;
window.UtoolsProvider = UtoolsProvider;
window.OcrProProvider = OcrProProvider;
window.ProviderRegistry = ProviderRegistry;


