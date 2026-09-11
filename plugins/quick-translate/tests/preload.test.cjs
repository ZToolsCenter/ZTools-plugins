const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const preloadSource = fs.readFileSync(path.resolve(__dirname, '../public/preload.js'), 'utf8');

/**
 * 创建可记录请求并返回固定 JSON 的 https 测试替身。
 * @param {Record<string, object>} responses 按请求路径配置的响应体。
 * @returns {{https: object, requests: Array<object>}} 测试替身与请求记录。
 */
function createHTTPSMock(responses) {
    const requests = [];
    return {
        requests,
        https: {
            request(options, onResponse) {
                const request = new EventEmitter();
                let body = '';
                request.write = (chunk) => {
                    body += chunk;
                };
                request.destroy = (error) => request.emit('error', error);
                request.end = () => {
                    requests.push({ options, body: JSON.parse(body) });
                    const response = new EventEmitter();
                    response.statusCode = 200;
                    response.setEncoding = () => {};
                    onResponse(response);
                    queueMicrotask(() => {
                        response.emit('data', JSON.stringify(responses[options.path]));
                        response.emit('end');
                    });
                };
                return request;
            },
        },
    };
}

/**
 * 在隔离上下文中加载插件 preload。
 * @param {Record<string, object>} responses 按请求路径配置的响应体。
 * @returns {{window: object, requests: Array<object>, readConfig: function}} preload 测试上下文。
 */
function loadPreload(responses) {
    const { https, requests } = createHTTPSMock(responses);
    let config = { targetLanguage: 'en', apiKey: 'legacy-key', apiKeyEncrypted: 'legacy-value' };
    const window = {
        addEventListener() {},
        dispatchEvent() {},
        ztools: {
            clipboard: { writeContent: async () => ({ success: true }) },
            copyText() {},
            dbStorage: {
                getItem: () => config,
                setItem: (_key, value) => {
                    config = value;
                },
            },
            getUserTempToken: async () => ({ token: 'temporary-token', expiredAt: Date.now() + 60_000 }),
            getUser: () => ({ uid: 'user-1' }),
            hideMainWindow() {},
            onPluginEnter() {},
        },
    };
    vm.runInNewContext(preloadSource, {
        Buffer,
        console,
        CustomEvent: class CustomEvent {},
        Date,
        queueMicrotask,
        require: (request) => {
            if (request === 'node:https') return https;
            throw new Error(`Unexpected require: ${request}`);
        },
        window,
    });
    return { window, requests, readConfig: () => config };
}

test('translation and speech requests declare the google engine', async () => {
    const context = loadPreload({
        '/api/plugin/translate': { text: '你好', detectedSourceLanguage: 'en' },
        '/api/plugin/speech': { audioContent: 'bXAz', mimeType: 'audio/mpeg', voiceName: 'en-US-Wavenet-D' },
    });

    await context.window.quickTranslate.translate({
        text: 'hello',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
    });
    await context.window.quickTranslate.synthesizeSpeech({ text: 'hello', language: 'en' });

    assert.equal(context.requests.length, 2);
    assert.equal(context.requests[0].body.engine, 'google');
    assert.equal(context.requests[1].body.engine, 'google');
    assert.equal(context.requests[0].options.headers.Authorization, 'Bearer temporary-token');
    assert.equal(context.requests[1].options.headers.Authorization, 'Bearer temporary-token');
});

test('translation reports the minimum ZTools version when token API is unavailable', async () => {
    const context = loadPreload({});
    delete context.window.ztools.getUserTempToken;

    await assert.rejects(
        context.window.quickTranslate.translate({ text: 'hello', targetLanguage: 'zh-CN' }),
        { message: '快翻译需要 ZTools 3.1.0 或更高版本，请升级后重试' },
    );
    assert.equal(context.requests.length, 0);
});

test('reading config removes legacy local API keys', () => {
    const context = loadPreload({});
    const summary = context.window.quickTranslate.getConfig();

    assert.equal(summary.isLoggedIn, true);
    assert.equal(summary.targetLanguage, 'en');
    assert.equal(Object.hasOwn(context.readConfig(), 'apiKey'), false);
    assert.equal(Object.hasOwn(context.readConfig(), 'apiKeyEncrypted'), false);
});
