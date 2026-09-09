const https = require('node:https');

const CONFIG_KEY = 'quick-translate:config';
const MAX_TEXT_LENGTH = 4000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_SPEECH_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_SPEECH_TEXT_BYTES = 5000;
const SERVER_HOST = 'z.zosen.link';
const TRANSLATION_PATH = '/api/plugin/translate';
const SPEECH_PATH = '/api/plugin/speech';
const ENGINE = 'google';

/**
 * 检查翻译文本是否满足插件请求限制。
 * @param {unknown} value 待检查的文本。
 * @returns {string} 清理后的文本。
 * @throws {Error} 文本为空或超过长度限制时抛出错误。
 */
function normalizeText(value) {
    // 先将输入收敛为字符串，避免把对象意外序列化后发送到第三方服务。
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) {
        throw new Error('请输入需要翻译的文字');
    }
    if (text.length > MAX_TEXT_LENGTH) {
        throw new Error(`单次最多翻译 ${MAX_TEXT_LENGTH} 个字符`);
    }
    return text;
}

/**
 * 规范化翻译服务使用的语言代码。
 * @param {unknown} value 用户选择的语言代码。
 * @param {string} fallback 输入无效时使用的默认语言代码。
 * @returns {string} 可发送给 Google 的语言代码。
 */
function normalizeLanguage(value, fallback) {
    const language = typeof value === 'string' ? value.trim() : '';
    if (!language || language === 'auto') return fallback;
    if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) return fallback;
    return language;
}

/**
 * 检查朗读文本是否满足 Google 同步语音接口的字节限制。
 * @param {unknown} value 待朗读文本。
 * @returns {string} 清理后的朗读文本。
 * @throws {Error} 文本为空、字符数或 UTF-8 字节数超过限制时抛出错误。
 */
function normalizeSpeechText(value) {
    const text = normalizeText(value);
    if (Buffer.byteLength(text, 'utf8') > MAX_SPEECH_TEXT_BYTES) {
        throw new Error(`朗读内容过长，最多支持 ${MAX_SPEECH_TEXT_BYTES} 个 UTF-8 字节`);
    }
    return text;
}

/**
 * 读取插件持久化配置。
 * @returns {Record<string, unknown>} 本地保存的配置对象。
 */
function readStoredConfig() {
    // 配置读取失败时使用空配置，让插件仍然可以打开设置页。
    try {
        const stored = window.ztools.dbStorage.getItem(CONFIG_KEY);
        const config = stored && typeof stored === 'object' ? { ...stored } : {};
        if (
            Object.prototype.hasOwnProperty.call(config, 'apiKey')
            || Object.prototype.hasOwnProperty.call(config, 'apiKeyEncrypted')
        ) {
            // 语音迁移到服务端后主动清理旧版本遗留的本地 Google 凭证。
            delete config.apiKey;
            delete config.apiKeyEncrypted;
            window.ztools.dbStorage.setItem(CONFIG_KEY, config);
        }
        return config;
    } catch (error) {
        console.warn('读取快翻译配置失败:', error);
        return {};
    }
}

/**
 * 将服务端翻译错误映射为可操作的用户提示。
 * @param {number} statusCode HTTP 响应状态码。
 * @param {unknown} payload 服务端响应数据。
 * @returns {string} 适合展示给用户的错误文本。
 */
function getTranslationError(statusCode, payload) {
    if (statusCode === 401) return '登录鉴权已失效，请重试';
    if (statusCode === 403) return '当前插件无权使用翻译服务';
    if (statusCode === 429) return '翻译请求过于频繁，请稍后再试';
    if (statusCode === 502 || statusCode === 503) return '翻译服务暂时不可用，请稍后再试';
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }
    return `翻译请求失败（${statusCode || '未知状态'}）`;
}

/**
 * 使用插件临时令牌请求 ZTools 服务端翻译接口。
 * @param {string} temporaryToken ZTools 主程序签发的插件临时令牌。
 * @param {string} text 待翻译文本。
 * @param {string} targetLanguage 目标语言代码。
 * @param {string} sourceLanguage 源语言代码，auto 表示自动检测。
 * @returns {Promise<{text: string, detectedSourceLanguage: string}>} 翻译结果。
 * @throws {Error} 网络请求失败、鉴权失效或服务端返回错误时抛出错误。
 */
function requestServerTranslation(temporaryToken, text, targetLanguage, sourceLanguage) {
    return new Promise((resolve, reject) => {
        // 插件只携带短期令牌，官方账号凭据和 Google 翻译密钥都不会进入插件请求。
        const requestBody = JSON.stringify({
            engine: ENGINE,
            text,
            sourceLanguage,
            targetLanguage,
        });

        const request = https.request({
            hostname: SERVER_HOST,
            path: TRANSLATION_PATH,
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${temporaryToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            timeout: 15000,
        }, (response) => {
            let responseBody = '';
            let responseBytes = 0;
            response.setEncoding('utf8');

            // 限制响应大小并在完整收取后解析，避免异常上游响应占用过多内存。
            response.on('data', (chunk) => {
                responseBytes += Buffer.byteLength(chunk);
                if (responseBytes > MAX_RESPONSE_BYTES) {
                    response.destroy(new Error('翻译服务响应过大'));
                    return;
                }
                responseBody += chunk;
            });
            response.on('end', () => {
                let payload;
                try {
                    payload = JSON.parse(responseBody);
                } catch {
                    reject(new Error('翻译服务返回了无法识别的响应'));
                    return;
                }

                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(getTranslationError(response.statusCode, payload)));
                    return;
                }

                if (typeof payload?.text !== 'string' || !payload.text) {
                    reject(new Error('翻译服务没有返回译文'));
                    return;
                }

                resolve({
                    text: payload.text,
                    detectedSourceLanguage: payload.detectedSourceLanguage || sourceLanguage || 'und',
                });
            });
            response.on('error', (error) => reject(new Error(error.message || '翻译服务响应失败')));
        });

        // 请求超时或网络错误时主动终止连接，避免页面一直显示加载状态。
        request.on('timeout', () => request.destroy(new Error('翻译请求超时')));
        request.on('error', (error) => reject(new Error(error.message || '网络连接失败')));
        request.write(requestBody);
        request.end();
    });
}

/**
 * 将服务端语音错误映射为可操作的用户提示。
 * @param {number} statusCode HTTP 响应状态码。
 * @param {unknown} payload 服务端响应数据。
 * @returns {string} 适合展示给用户的错误文本。
 */
function getSpeechError(statusCode, payload) {
    if (statusCode === 400) return '当前朗读内容或语音引擎不受支持';
    if (statusCode === 401) return '登录鉴权已失效，请重试';
    if (statusCode === 403) return '当前插件无权使用语音服务';
    if (statusCode === 429) return '语音请求过于频繁，请稍后再试';
    if (statusCode === 502 || statusCode === 503) return 'WaveNet 语音服务暂时不可用，请稍后再试';
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
        return payload.error.trim();
    }
    return `语音请求失败（${statusCode || '未知状态'}）`;
}

/**
 * 使用插件临时令牌请求 ZTools 服务端语音接口。
 * @param {string} temporaryToken ZTools 主程序签发的插件临时令牌。
 * @param {string} text 待朗读文本。
 * @param {string} language 朗读语言代码。
 * @returns {Promise<{audioContent: string, mimeType: string, voiceName: string}>} Base64 音频结果。
 * @throws {Error} 网络请求失败、鉴权失效或服务端返回错误时抛出错误。
 */
function requestServerSpeech(temporaryToken, text, language) {
    return new Promise((resolve, reject) => {
        const requestBody = JSON.stringify({ engine: ENGINE, text, language });
        const request = https.request({
            hostname: SERVER_HOST,
            path: SPEECH_PATH,
            method: 'POST',
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${temporaryToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            timeout: 30000,
        }, (response) => {
            let responseBody = '';
            let responseBytes = 0;
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                responseBytes += Buffer.byteLength(chunk);
                if (responseBytes > MAX_SPEECH_RESPONSE_BYTES) {
                    response.destroy(new Error('语音服务响应过大'));
                    return;
                }
                responseBody += chunk;
            });
            response.on('end', () => {
                let payload;
                try {
                    payload = JSON.parse(responseBody);
                } catch {
                    reject(new Error('语音服务返回了无法识别的响应'));
                    return;
                }
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(getSpeechError(response.statusCode, payload)));
                    return;
                }
                if (
                    typeof payload?.audioContent !== 'string'
                    || !payload.audioContent
                    || payload.mimeType !== 'audio/mpeg'
                ) {
                    reject(new Error('语音服务没有返回有效音频'));
                    return;
                }
                resolve({
                    audioContent: payload.audioContent,
                    mimeType: payload.mimeType,
                    voiceName: typeof payload.voiceName === 'string' ? payload.voiceName : '',
                });
            });
            response.on('error', (error) => reject(new Error(error.message || '语音服务响应失败')));
        });
        request.on('timeout', () => request.destroy(new Error('语音请求超时')));
        request.on('error', (error) => reject(new Error(error.message || '语音网络连接失败')));
        request.write(requestBody);
        request.end();
    });
}

/**
 * 从 ZTools 主程序获取当前插件的短期服务端鉴权。
 * @returns {Promise<string>} 可用于 Server 插件接口的 Bearer token。
 * @throws {Error} 宿主版本过旧、未登录或返回值不完整时抛出错误。
 */
async function getTemporaryToken() {
    if (typeof window.ztools?.getUserTempToken !== 'function') {
        throw new Error('快翻译需要 ZTools 3.1.0 或更高版本，请升级后重试');
    }
    const credential = await window.ztools.getUserTempToken();
    if (!credential || typeof credential.token !== 'string' || !credential.token) {
        throw new Error('未能获取服务端鉴权，请重新登录 ZTools 账号');
    }
    return credential.token;
}

/**
 * 使用 ZTools 主程序提供的短期鉴权翻译文本。
 * @param {{text: string, targetLanguage: string, sourceLanguage?: string}} params 翻译参数。
 * @returns {Promise<{text: string, detectedSourceLanguage: string}>} 翻译结果。
 * @throws {Error} 未登录 ZTools、宿主版本过旧或请求失败时抛出错误。
 */
async function translate(params = {}) {
    // 先校验文本和语言，避免无效请求消耗服务端翻译配额。
    const text = normalizeText(params.text);
    const targetLanguage = normalizeLanguage(params.targetLanguage, 'en');
    const sourceLanguage = normalizeLanguage(params.sourceLanguage, 'auto');
    const temporaryToken = await getTemporaryToken();
    return requestServerTranslation(temporaryToken, text, targetLanguage, sourceLanguage);
}

/**
 * 通过 ZTools 服务端调用 Google Cloud Text-to-Speech WaveNet 生成 MP3 音频。
 * @param {{text: string, language?: string}} params 朗读文本和语言参数。
 * @returns {Promise<{audioContent: string, mimeType: string, voiceName: string}>} Base64 音频结果。
 * @throws {Error} 未登录、内容超限或服务端请求失败时抛出错误。
 */
async function synthesizeSpeech(params = {}) {
    const text = normalizeSpeechText(params.text);
    const language = normalizeLanguage(params.language, 'en');
    const temporaryToken = await getTemporaryToken();
    return requestServerSpeech(temporaryToken, text, language);
}

/**
 * 返回插件配置摘要，并触发旧版本地 API Key 清理。
 * @returns {{isLoggedIn: boolean, targetLanguage: string}} 配置摘要。
 */
function getConfig() {
    const config = readStoredConfig();
    return {
        isLoggedIn: Boolean(window.ztools.getUser()),
        targetLanguage: normalizeLanguage(config.targetLanguage, 'en'),
    };
}

/**
 * 保存本地默认目标语言。
 * @param {{targetLanguage?: string}} params 配置变更。
 * @returns {{isLoggedIn: boolean, targetLanguage: string}} 保存后的配置摘要。
 */
function saveConfig(params = {}) {
    // 只保留非敏感偏好，旧版 API Key 会由 readStoredConfig 清理。
    const current = readStoredConfig();
    current.targetLanguage = normalizeLanguage(params.targetLanguage, 'en');
    window.ztools.dbStorage.setItem(CONFIG_KEY, current);
    return getConfig();
}

/**
 * 执行翻译结果的复制、隐藏或粘贴操作。
 * @param {string} text 要处理的译文。
 * @param {'copy'|'copy-hide'|'paste'} action 操作类型。
 * @returns {Promise<boolean>} 操作成功后返回 true。
 * @throws {Error} 剪贴板操作失败时抛出错误。
 */
async function performResultAction(text, action) {
    // 所有剪贴板和窗口动作都在 preload 中完成，页面只接触业务级方法。
    if (typeof text !== 'string' || !text.trim()) throw new Error('没有可操作的译文');
    if (action === 'paste') {
        await window.ztools.clipboard.writeContent({ type: 'text', content: text }, true);
        return true;
    }
    window.ztools.copyText(text);
    if (action === 'copy-hide') {
        window.ztools.hideMainWindow(false);
    }
    return true;
}

window.quickTranslate = {
    translate,
    synthesizeSpeech,
    getConfig,
    saveConfig,
    performResultAction,
};

window.ztools.onPluginEnter((param = {}) => {
    // 将入口参数交给页面，页面负责恢复输入框并触发翻译。
    window.__quickTranslateEntry = param;
    window.dispatchEvent(new CustomEvent('quick-translate-enter', { detail: param }));
});

console.log('quick-translate preload loaded');
