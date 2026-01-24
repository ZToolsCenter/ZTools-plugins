/**
 * 模型能力检测器
 * 提供准确的AI模型能力检测和分类功能
 */
class ModelCapabilityDetector {
    constructor() {
        this.initializePatterns();
        this.initializeBuiltinModels();
    }

    /**
     * 初始化正则表达式模式
     */
    initializePatterns() {
        // 视觉模型允许列表
        this.visionAllowedModels = [
            'llava',
            'moondream', 
            'minicpm',
            'gemini-1\\.5',
            'gemini-2\\.0',
            'gemini-2\\.5',
            'gemini-exp',
            'claude-3',
            'claude-sonnet-4',
            'claude-opus-4',
            'vision',
            'glm-4(?:\\.\\d+)?v(?:-[\\w-]+)?',
            'qwen-vl',
            'qwen2-vl',
            'qwen2.5-vl',
            'qwen2.5-omni',
            'qvq',
            'internvl2',
            'grok-vision-beta',
            'pixtral',
            'gpt-4(?:-[\\w-]+)',
            'gpt-4.1(?:-[\\w-]+)?',
            'gpt-4o(?:-[\\w-]+)?',
            'gpt-4.5(?:-[\\w-]+)',
            'chatgpt-4o(?:-[\\w-]+)?',
            'o1(?:-[\\w-]+)?',
            'o3(?:-[\\w-]+)?',
            'o4(?:-[\\w-]+)?',
            'deepseek-vl(?:[\\w-]+)?',
            'kimi-latest',
            'gemma-3(?:-[\\w-]+)',
            'doubao-seed-1[.-]6(?:-[\\w-]+)?',
            'doubao(?:-[\\d.-]+)?-vision(?:-[\\w-]+)?',
            'doubao(?:-[\\d.-]+)?-thinking-vision(?:-[\\w-]+)?',
            'doubao-1[.-]5-vision(?:-[\\w-]+)?',
            'doubao-1[.-]5-thinking-vision(?:-[\\w-]+)?',
            'doubao-1[.-]5-ui-tars(?:-[\\w-]+)?',
            'glm-4v(?:-[\\w-]+)?',
            'glm-4(?:-[\\w-]+)?'
        ];

        // 视觉模型排除列表
        this.visionExcludedModels = [
            'gpt-4-\\d+-preview',
            'gpt-4-turbo-preview',
            'gpt-4-32k',
            'gpt-4-\\d+',
            'o1-mini',
            'o3-mini',
            'o1-preview',
            'AIDC-AI/Marco-o1'
        ];

        // 视觉模型正则表达式
        this.VISION_REGEX = new RegExp(
            `\\b(?!(?:${this.visionExcludedModels.join('|')})\\b)(${this.visionAllowedModels.join('|')})\\b`,
            'i'
        );

        // 推理模型正则表达式
        this.REASONING_REGEX = /^(o\d+(?:-[\w-]+)?|.*\b(?:reasoning|reasoner|thinking)\b.*|.*-[rR]\d+.*|.*\bqwq(?:-[\w-]+)?\b.*|.*\bhunyuan-t1(?:-[\w-]+)?\b.*|.*\bglm-zero-preview\b.*|.*\bgrok-3-mini(?:-[\w-]+)?\b.*)$/i;

        // 嵌入模型正则表达式
        this.EMBEDDING_REGEX = /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i;

        // 重排序模型正则表达式
        this.RERANKING_REGEX = /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i;

        // 不支持的模型正则表达式
        this.NOT_SUPPORTED_REGEX = /(?:^tts|whisper|speech)/i;

        // 函数调用模型
        this.FUNCTION_CALLING_MODELS = [
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-4',
            'gpt-4.5',
            'o(1|3|4)(?:-[\\w-]+)?',
            'claude',
            'qwen',
            'qwen3',
            'hunyuan',
            'deepseek',
            'glm-4(?:-[\\w-]+)?',
            'chatglm(?:-[\\w-]+)?',
            'learnlm(?:-[\\w-]+)?',
            'gemini(?:-[\\w-]+)?',
            'grok-3(?:-[\\w-]+)?',
            'doubao-seed-1[.-]6(?:-[\\w-]+)?'
        ];

        this.FUNCTION_CALLING_EXCLUDED_MODELS = [
            'aqa(?:-[\\w-]+)?',
            'imagen(?:-[\\w-]+)?',
            'o1-mini',
            'o1-preview',
            'AIDC-AI/Marco-o1'
        ];

        this.FUNCTION_CALLING_REGEX = new RegExp(
            `\\b(?!(?:${this.FUNCTION_CALLING_EXCLUDED_MODELS.join('|')})\\b)(?:${this.FUNCTION_CALLING_MODELS.join('|')})\\b`,
            'i'
        );
    }

    /**
     * 初始化内置模型配置
     */
    initializeBuiltinModels() {
        // uTools内置模型配置
        this.utoolsBuiltinModels = {
            // 所有内置模型都具备文本能力
            textCapable: [
                'deepseek-v3',
                'deepseek-r1', 
                '豆包1.5Pro',
                '通义千问3-235B',
                'QwQ-32B',
                '文心一言3.5',
                '文心一言Speed',
                '智谱GLM4-flash'
            ],
            // 只有这些模型具备推理能力
            reasoningCapable: [
                'deepseek-r1',
                '通义千问3-235B'
            ],
            // 所有内置模型都无视觉能力
            visionCapable: []
        };
    }

    /**
     * 检测模型能力
     * @param {string} service - 服务商
     * @param {string} modelId - 模型ID
     * @param {Object} modelData - 模型数据（可选，包含type等字段）
     * @returns {Array} 能力数组 ['text', 'vision', 'reasoning']
     */
    detectCapabilities(service, modelId, modelData = null) {
        if (!modelId) {
            return [];
        }

        // uTools AI模型特殊处理
        if (service === 'utools') {
            return this.detectUtoolsModelCapabilities(modelId, modelData);
        }

        const capabilities = [];

        // 检测文本能力
        const hasText = this.hasTextCapability(service, modelId, modelData);
        if (hasText) {
            capabilities.push('text');
        }

        // 检测视觉能力
        const hasVision = this.hasVisionCapability(service, modelId, modelData);
        if (hasVision) {
            capabilities.push('vision');
        }

        // 检测推理能力
        const hasReasoning = this.hasReasoningCapability(service, modelId, modelData);
        if (hasReasoning) {
            capabilities.push('reasoning');
        }

        return capabilities;
    }

    /**
     * 检测uTools AI模型能力的统一入口
     * @param {string} modelId - 模型ID
     * @param {Object} modelData - 模型数据
     * @returns {Array} 能力数组
     */
    detectUtoolsModelCapabilities(modelId, modelData = null) {
        // 1. 内置模型处理：直接使用预定义配置
        if (this.isUtoolsBuiltinModel(modelId)) {
            return this.getBuiltinModelCapabilities(modelId);
        }

        // 2. 自定义模型处理：检测真实服务商并使用对应检测逻辑
        const friendlyName = modelData?.name || modelData?.label || modelData?.displayName;
        const realProvider = this.detectRealProvider(modelId, friendlyName);

        if (realProvider !== 'utools') {
            // 使用友好名称作为模型ID进行真实服务商的能力检测
            const realModelId = friendlyName || modelId;
            return this.detectCapabilities(realProvider, realModelId, modelData);
        }

        // 3. 无法识别服务商：默认只具备文本能力
        return ['text'];
    }

    /**
     * 获取内置模型的预定义能力
     * @param {string} modelId - 模型ID
     * @returns {Array} 能力数组
     */
    getBuiltinModelCapabilities(modelId) {
        const capabilities = [];

        // 定义内置模型能力映射
        const builtinCapabilities = {
            // 具备推理能力的模型
            reasoning: [
                /deepseek.*r1/i,           // deepseek-r1
                /qwen.*235b/i,             // 通义千问3-235B (支持Qwen/Qwen3-235B-A22B格式)
                /通义千问.*235b/i          // 通义千问3-235B (支持中文名称)
            ],
            // 所有内置模型都具备文本能力
            text: [
                /deepseek.*r1/i,           // deepseek-r1
                /deepseek.*v3/i,           // deepseek-v3
                /qwen.*235b/i,             // 通义千问3-235B
                /通义千问.*235b/i,         // 通义千问3-235B
                /豆包.*1\.?5.*pro/i,       // 豆包1.5Pro
                /qwq.*32b/i,               // QwQ-32B
                /文心一言.*3\.?5/i,        // 文心一言3.5
                /文心一言.*speed/i,        // 文心一言Speed
                /glm.*4.*flash/i,          // 智谱GLM4-flash
                /智谱.*glm.*4.*flash/i     // 智谱GLM4-flash
            ],
            // 当前所有内置模型都无视觉能力
            vision: []
        };

        // 检查文本能力
        if (builtinCapabilities.text.some(pattern => pattern.test(modelId))) {
            capabilities.push('text');
        }

        // 检查推理能力
        if (builtinCapabilities.reasoning.some(pattern => pattern.test(modelId))) {
            capabilities.push('reasoning');
        }

        // 检查视觉能力
        if (builtinCapabilities.vision.some(pattern => pattern.test(modelId))) {
            capabilities.push('vision');
        }

        return capabilities;
    }

    /**
     * 检测文本能力
     */
    hasTextCapability(service, modelId, modelData) {
        // 传统OCR服务和传统翻译服务不是AI模型，没有文本能力
        const traditionalServices = ['baidu', 'tencent', 'aliyun', 'deeplx', 'youdao'];
        if (traditionalServices.includes(service)) {
            return false;
        }

        // uTools模型已在detectUtoolsModelCapabilities中统一处理，这里不应该到达
        if (service === 'utools') {
            console.warn('uTools模型应该通过detectUtoolsModelCapabilities处理，不应该到达hasTextCapability');
            return true; // 默认具备文本能力
        }

        // 检查模型类型字段
        if (modelData?.type?.includes('text')) {
            return true;
        }

        // 嵌入模型不算文本模型
        if (this.isEmbeddingModel(service, modelId, modelData)) {
            return false;
        }

        // 不支持的模型
        if (this.NOT_SUPPORTED_REGEX.test(modelId)) {
            return false;
        }

        // 对于不支持的服务商，默认具备文本能力
        const supportedServices = ['openai', 'anthropic', 'google', 'alibaba', 'bytedance', 'zhipu', 'ocrpro'];
        if (!supportedServices.includes(service)) {
            return true;
        }

        // 默认AI模型都具备文本能力
        return true;
    }

    /**
     * 检测视觉能力
     */
    hasVisionCapability(service, modelId, modelData) {
        if (!modelId) return false;

        // uTools模型已在detectUtoolsModelCapabilities中统一处理，这里不应该到达
        if (service === 'utools') {
            console.warn('uTools模型应该通过detectUtoolsModelCapabilities处理，不应该到达hasVisionCapability');
            return false; // 默认无视觉能力
        }

        // 检查模型类型字段
        if (modelData?.type?.includes('vision')) {
            return true;
        }

        // 使用服务商特定逻辑
        return this.detectVisionByProvider(service, modelId, modelData);
    }

    /**
     * 根据服务商检测视觉能力
     */
    detectVisionByProvider(service, modelId, modelData) {
        switch (service) {
            case 'google':
                return this.isGoogleVisionModel(modelId, modelData);
            case 'anthropic':
                return this.isAnthropicVisionModel(modelId, modelData);
            case 'openai':
                return this.isOpenAIVisionModel(modelId, modelData);
            case 'alibaba':
                return this.isAlibabaVisionModel(modelId, modelData);
            case 'bytedance':
                return this.isByteDanceVisionModel(modelId, modelData);
            case 'zhipu':
                return this.isZhipuVisionModel(modelId, modelData);
            default:
                // 对于不支持的服务商，使用通用正则检测
                return this.VISION_REGEX.test(modelId);
        }
    }

    /**
     * 检测推理能力
     */
    hasReasoningCapability(service, modelId, modelData) {
        if (!modelId) return false;

        // uTools模型已在detectUtoolsModelCapabilities中统一处理，这里不应该到达
        if (service === 'utools') {
            console.warn('uTools模型应该通过detectUtoolsModelCapabilities处理，不应该到达hasReasoningCapability');
            return false; // 默认无推理能力
        }

        // 检查模型类型字段
        if (modelData?.type?.includes('reasoning')) {
            return true;
        }

        // 嵌入模型不具备推理能力
        if (this.isEmbeddingModel(service, modelId, modelData)) {
            return false;
        }

        // 使用服务商特定逻辑
        return this.detectReasoningByProvider(service, modelId, modelData);
    }

    /**
     * 根据服务商检测推理能力
     */
    detectReasoningByProvider(service, modelId, modelData) {
        switch (service) {
            case 'openai':
                return this.isOpenAIReasoningModel(modelId);
            case 'anthropic':
                return this.isAnthropicReasoningModel(modelId);
            case 'google':
                return this.isGoogleReasoningModel(modelId);
            case 'alibaba':
                return this.isAlibabaReasoningModel(modelId);
            case 'bytedance':
                return this.isByteDanceReasoningModel(modelId, modelData);
            case 'zhipu':
                return this.isZhipuReasoningModel(modelId, modelData);
            default:
                // 对于不支持的服务商，使用通用正则检测
                return this.REASONING_REGEX.test(modelId);
        }
    }

    /**
     * 检测是否为嵌入模型
     */
    isEmbeddingModel(service, modelId, modelData) {
        if (!modelId) return false;

        // 检查模型类型字段
        if (modelData?.type?.includes('embedding')) {
            return true;
        }

        // Anthropic不提供嵌入模型
        if (service === 'anthropic') {
            return false;
        }

        // 豆包特殊处理
        if (service === 'bytedance' || modelId.includes('doubao')) {
            return this.EMBEDDING_REGEX.test(modelData?.name || modelId);
        }

        // 重排序模型不是嵌入模型
        if (this.RERANKING_REGEX.test(modelId)) {
            return false;
        }

        return this.EMBEDDING_REGEX.test(modelId);
    }

    /**
     * 判断是否为uTools内置模型
     */
    isUtoolsBuiltinModel(modelId) {
        // 内置模型的特征匹配规则
        const builtinPatterns = [
            // DeepSeek系列
            { pattern: /deepseek.*r1/i, name: 'deepseek-r1' },
            { pattern: /deepseek.*v3/i, name: 'deepseek-v3' },

            // 通义千问系列 - 支持多种ID格式
            { pattern: /qwen.*235b/i, name: '通义千问3-235B' },
            { pattern: /通义千问.*235b/i, name: '通义千问3-235B' },

            // 豆包系列
            { pattern: /豆包.*1\.?5.*pro/i, name: '豆包1.5Pro' },

            // QwQ系列
            { pattern: /qwq.*32b/i, name: 'QwQ-32B' },

            // 文心一言系列
            { pattern: /文心一言.*3\.?5/i, name: '文心一言3.5' },
            { pattern: /文心一言.*speed/i, name: '文心一言Speed' },

            // 智谱GLM系列
            { pattern: /glm.*4.*flash/i, name: '智谱GLM4-flash' },
            { pattern: /智谱.*glm.*4.*flash/i, name: '智谱GLM4-flash' }
        ];

        // 检查是否匹配任何内置模型模式
        for (const { pattern } of builtinPatterns) {
            if (pattern.test(modelId)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 智能检测uTools自定义模型的真实服务商
     * 通过友好名称关键词匹配判断真实服务商归属
     * @param {string} modelId - 模型ID
     * @param {string} friendlyName - 友好名称（displayName或name字段）
     * @returns {string} 服务商标识
     */
    detectRealProvider(modelId, friendlyName) {
        if (!modelId && !friendlyName) {
            return 'utools';
        }

        const searchText = `${modelId || ''} ${friendlyName || ''}`.toLowerCase();

        // 通过关键词匹配推断模型的真实服务商
        if (searchText.includes('gemini')) {
            return 'google';
        } else if (searchText.includes('gpt') || searchText.includes('openai')) {
            return 'openai';
        } else if (searchText.includes('claude')) {
            return 'anthropic';
        } else if (searchText.includes('qwen')) {
            return 'alibaba';
        } else if (searchText.includes('doubao') || searchText.includes('豆包')) {
            return 'bytedance';
        } else if (searchText.includes('deepseek')) {
            return 'deepseek';
        } else if (searchText.includes('glm') || searchText.includes('chatglm')) {
            return 'zhipu';
        } else if (searchText.includes('hunyuan')) {
            return 'tencent';
        }

        // 无法识别服务商，返回utools
        return 'utools';
    }

    // ==================== 服务商特定检测方法 ====================

    /**
     * Google模型视觉能力检测 - 检测Gemini模型的视觉处理能力
     */
    isGoogleVisionModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // 检查模型是否支持视觉处理功能
        // 检查supportedGenerationMethods是否包含generateContent
        const supportedMethods = modelData?.supportedMethods || modelData?.supportedGenerationMethods;
        if (supportedMethods?.includes('generateContent')) {
            // 排除纯文本模型和嵌入模型
            const isTextOnly = modelLower.includes('text') && !modelLower.includes('vision');
            const isEmbedding = modelLower.includes('embedding') ||
                              supportedMethods.includes('embedContent');

            if (isTextOnly || isEmbedding) {
                return false;
            }

            // Gemini模型默认支持视觉（除非明确标记为文本模型）
            return modelLower.includes('gemini');
        }

        // 回退到基于名称的检测
        const hasVisionSupport = modelLower.includes('vision') ||
                               modelLower.includes('flash') ||
                               modelLower.includes('pro') ||
                               modelLower.includes('2.5') ||
                               modelLower.includes('2-5') ||
                               modelLower.includes('2.0') ||
                               modelLower.includes('1.5') ||
                               modelLower.includes('exp');

        // 排除纯文本模型和嵌入模型
        const isTextOnly = (modelLower.includes('text') && !modelLower.includes('vision')) ||
                          modelLower.includes('embedding');

        return hasVisionSupport && !isTextOnly;
    }

    /**
     * Anthropic模型视觉能力检测
     */
    isAnthropicVisionModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // Claude 3系列及以上支持视觉
        return modelLower.includes('claude-3') ||
               modelLower.includes('claude-sonnet-4') ||
               modelLower.includes('claude-opus-4');
    }

    /**
     * OpenAI模型视觉能力检测 - 检测GPT模型的视觉处理能力
     */
    isOpenAIVisionModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // OpenAI视觉模型检测逻辑
        // GPT-4系列的视觉模型
        const isGPT4Vision = modelLower.includes('gpt-4') &&
                           (modelLower.includes('vision') ||
                            modelLower.includes('turbo') ||
                            modelLower.includes('o') ||
                            !modelLower.includes('0314') && !modelLower.includes('0613'));

        // GPT-4o系列默认支持视觉
        const isGPT4o = modelLower.includes('gpt-4o');

        // 使用正则表达式作为补充检测
        const regexMatch = this.VISION_REGEX.test(modelId);

        return isGPT4Vision || isGPT4o || regexMatch;
    }

    /**
     * 阿里云模型视觉能力检测
     */
    isAlibabaVisionModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // 阿里云视觉模型识别逻辑
        return (modelLower.includes('qwen') && modelLower.includes('vl')) ||
               modelLower.includes('qwen-vl') ||
               modelLower.includes('qwen2-vl') ||
               modelLower.includes('qwen2.5-vl') ||
               modelLower.includes('qwen-vl-ocr');
    }

    /**
     * 火山引擎模型视觉能力检测（支持完整模型ID）
     */
    isByteDanceVisionModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // 明确的视觉模型标识（支持完整模型ID格式）
        const visionKeywords = [
            'vision', 'vl', 'ui-tars', 'thinking-vision'
        ];

        // 检查是否包含视觉关键词
        const hasVisionKeyword = visionKeywords.some(keyword =>
            modelLower.includes(keyword)
        );

        // 特殊处理：豆包Seed系列默认支持视觉（支持完整模型ID和最新版本）
        const isSeed16 = modelLower.includes('doubao-seed-1.6') ||
                        modelLower.includes('doubao-seed-1-6') ||
                        modelLower.includes('doubao-seed-1-6-flash-250615') ||
                        modelLower.includes('doubao-seed-1-6-32k-250615');

        // 特殊处理：豆包1.5思考视觉模型
        const isThinkingVision = modelLower.includes('thinking-vision');

        // 火山引擎特殊处理：检查name字段
        if (modelData?.name) {
            const nameLower = modelData.name.toLowerCase();
            const nameHasVision = visionKeywords.some(keyword =>
                nameLower.includes(keyword)
            );

            return hasVisionKeyword ||
                   nameHasVision ||
                   isSeed16 ||
                   isThinkingVision ||
                   this.VISION_REGEX.test(modelData.name) ||
                   this.VISION_REGEX.test(modelId) ||
                   modelData.type?.includes('vision');
        }

        return hasVisionKeyword || isSeed16 || isThinkingVision || this.VISION_REGEX.test(modelId);
    }



    /**
     * OpenAI推理模型检测
     */
    isOpenAIReasoningModel(modelId) {
        return modelId.includes('o1') || modelId.includes('o3') || modelId.includes('o4');
    }

    /**
     * Anthropic推理模型检测
     */
    isAnthropicReasoningModel(modelId) {
        return modelId.includes('claude-3-7-sonnet') ||
               modelId.includes('claude-3.7-sonnet') ||
               modelId.includes('claude-sonnet-4') ||
               modelId.includes('claude-opus-4');
    }

    /**
     * Google推理模型检测 - 检测Gemini模型的推理能力
     */
    isGoogleReasoningModel(modelId) {
        const modelLower = modelId.toLowerCase();

        // Gemini thinking模型
        if (modelLower.includes('gemini') && modelLower.includes('thinking')) {
            return true;
        }

        // Gemini 2.5系列支持thinking tokens（推理能力）
        // 支持多种格式：gemini-2.5, gemini 2.5, gemini2.5
        if (modelLower.includes('gemini') &&
            (modelLower.includes('2.5') || modelLower.includes('2-5') || modelLower.includes('exp'))) {
            return true;
        }

        // Gemini Flash Thinking系列
        if (modelLower.includes('flash') && modelLower.includes('thinking')) {
            return true;
        }

        return false;
    }

    /**
     * 阿里云推理模型检测
     */
    isAlibabaReasoningModel(modelId) {
        return modelId.includes('qwq') || modelId.includes('qvq');
    }

    /**
     * 火山引擎推理模型检测（支持完整模型ID）
     */
    isByteDanceReasoningModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // 检查模型类型字段
        if (modelData?.type?.includes('reasoning')) {
            return true;
        }

        // 明确的推理模型标识（支持完整模型ID格式）
        const reasoningKeywords = [
            'thinking', 'reasoning', 'reasoner'
        ];

        // 检查是否包含推理关键词
        const hasReasoningKeyword = reasoningKeywords.some(keyword =>
            modelLower.includes(keyword)
        );

        // 特殊模型：DeepSeek R1系列（支持完整模型ID）
        const isDeepSeekR1 = modelLower.includes('deepseek-r1') ||
                            modelLower.includes('deepseek-r-1');

        // 特殊模型：豆包思考系列（包含最新的Seed思考模型）
        const isDoubaoThinking = modelLower.includes('doubao') &&
                                (modelLower.includes('thinking') ||
                                 modelLower.includes('seed') ||
                                 modelLower.includes('doubao-seed-1-6-thinking'));

        // 使用正则表达式检测
        return hasReasoningKeyword ||
               isDeepSeekR1 ||
               isDoubaoThinking ||
               this.REASONING_REGEX.test(modelId) ||
               (modelData?.name && this.REASONING_REGEX.test(modelData.name));
    }

    /**
     * 智谱AI视觉能力检测
     */
    isZhipuVisionModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // 检查模型类型字段
        if (modelData?.type?.includes('vision')) {
            return true;
        }

        // 智谱AI视觉模型识别逻辑
        return modelLower.includes('glm-4v') ||
               modelLower.includes('glm-4-v') ||
               modelLower.includes('chatglm-v') ||
               (modelLower.includes('glm') && modelLower.includes('v'));
    }

    /**
     * 智谱AI推理能力检测
     */
    isZhipuReasoningModel(modelId, modelData) {
        if (!modelId) return false;

        const modelLower = modelId.toLowerCase();

        // 检查模型类型字段
        if (modelData?.type?.includes('reasoning')) {
            return true;
        }

        // 智谱AI推理模型识别逻辑
        return modelLower.includes('glm-zero') ||
               modelLower.includes('glm-reasoning') ||
               this.REASONING_REGEX.test(modelId);
    }

    // ==================== 便捷方法 ====================

    /**
     * 检测模型是否具备特定能力
     */
    hasCapability(service, modelId, capability, modelData = null) {
        const capabilities = this.detectCapabilities(service, modelId, modelData);
        return capabilities.includes(capability);
    }

    /**
     * 检测模型是否为视觉模型
     */
    isVisionModel(service, modelId, modelData = null) {
        return this.hasCapability(service, modelId, 'vision', modelData);
    }

    /**
     * 检测模型是否为推理模型
     */
    isReasoningModel(service, modelId, modelData = null) {
        return this.hasCapability(service, modelId, 'reasoning', modelData);
    }

    /**
     * 检测模型是否为文本模型
     */
    isTextModel(service, modelId, modelData = null) {
        return this.hasCapability(service, modelId, 'text', modelData);
    }

    /**
     * 获取模型能力描述
     */
    getCapabilityDescription(capabilities) {
        const descriptions = {
            text: '文本处理',
            vision: '视觉理解',
            reasoning: '推理思考'
        };

        return capabilities.map(cap => descriptions[cap] || cap).join(', ');
    }

    /**
     * 检测模型是否支持OCR功能
     */
    supportsOCR(service, modelId, modelData = null) {
        // OCR需要视觉能力
        return this.isVisionModel(service, modelId, modelData);
    }

    /**
     * 检测模型是否支持翻译功能
     */
    supportsTranslation(service, modelId, modelData = null) {
        // 翻译需要文本能力
        return this.isTextModel(service, modelId, modelData);
    }
}

// 创建全局实例
const modelCapabilityDetector = new ModelCapabilityDetector();

// 导出类和实例
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        ModelCapabilityDetector,
        modelCapabilityDetector
    };
} else if (typeof window !== 'undefined') {
    window.ModelCapabilityDetector = ModelCapabilityDetector;
    window.modelCapabilityDetector = modelCapabilityDetector;
}
