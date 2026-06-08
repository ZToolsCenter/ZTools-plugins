import browser from 'sinon-chrome/webextensions'
import { openIframe, ztoolsStorage, loadAllJs, restoreIndexedBDData, restoreLocalStorageData } from '../mock/utils'
import { exportDatabase } from '../mock/idb-export-import'
import { run } from '../mock/addon'
import '../mock/refactor.css'
window.browser = browser
window.chrome = browser
const req = require.context('./patches', false, /\.js$/)
req.keys().map(req)

window.openIframe = openIframe
window.addEventListener('load', run)

let inited, enterEventListener;
let localStorageData, indexedDBData, versionData;
let latestVersion = '7.21.0'
var currentPayload = '';

// 通知 iframe 搜索新词（防抖，避免 onPluginEnter + onPluginReady 重复触发）
var _searchDebounceTimer = null;
function notifyIframeSearch(text) {
    if (_searchDebounceTimer) clearTimeout(_searchDebounceTimer);
    _searchDebounceTimer = setTimeout(function() {
        _searchDebounceTimer = null;
        if (!text) return;
        var qsIframe = document.querySelector('.iframe-wrap iframe');
        if (qsIframe) {
            try {
                qsIframe.contentWindow.postMessage({ type: 'saladict-search', text: text }, '*');
            } catch(e) {}
        }
    }, 100);
}

// 更新 execCommand paste 命令
function updatePasteCommand() {
    document.execCommand = function (cmd) {
        if(cmd == 'copy'){
            let textArea = document.querySelectorAll('textarea');
            textArea = textArea[textArea.length - 1];
            let text = textArea.value;
            ztools.copyText(text)
        }else if(cmd == 'paste'){
            document.getElementById("saladict-paste").value = currentPayload
        }
    }
}

ztools.onPluginEnter(({ code, type, payload }) => {
    console.log('ztools.onPluginEnter', payload)
    if (payload == "沙拉查词" || payload == "saladict") {
        payload = ''
    }
    currentPayload = payload || '';
    enterEventListener = () => {
        openIframe('ext-saladic/quick-search.html', { hideCloseBtn: true })
        updatePasteCommand();
    }
    if (inited) {
        var qsIframe = document.querySelector('.iframe-wrap iframe');
        if (qsIframe && currentPayload) {
            notifyIframeSearch(currentPayload);
        } else if (!qsIframe) {
            enterEventListener();
        }
        updatePasteCommand();
    }
})

async function init() {
    if (inited) return; // 防止重复初始化
    ztools.db.remove("indexedDBData")
    localStorageData = new ztoolsStorage('localStorageData');
    indexedDBData = new ztoolsStorage('indexedDBDataV2');
    versionData = new ztoolsStorage('versionData');
    // 还原内部storage
    restoreLocalStorageData(localStorageData);
    // 还原indexedDB
    await restoreIndexedBDData(indexedDBData)
    // 安装 fetch 代理（在 loadAllJs 之前，确保 background 脚本中的 fetch 走 axios）
    installFetchProxy();
    // 从 manifest.json 动态读取 background.scripts 列表
    // 排除 browser-polyfill.min.js（已由 webextensions-emulator 替代）
    let manifest = await fetch('ext-saladic/manifest.json').then(r => r.json());
    let bgScripts = (manifest.background && manifest.background.scripts || [])
        .filter(s => !s.includes('browser-polyfill'))
        .map(s => 'ext-saladic/' + s);
    // 加载沙拉
    await loadAllJs(bgScripts);
    
    inited = true;
    await mockOnInstalled();
    if (enterEventListener) {
        enterEventListener();
    } else {
        openIframe('ext-saladic/quick-search.html', { hideCloseBtn: true });
        document.execCommand = function (cmd) {
            if(cmd == 'copy'){
                let textArea = document.querySelectorAll('textarea');
                textArea = textArea[textArea.length - 1];
                let text = textArea.value;
                ztools.copyText(text)
            }else if(cmd == 'paste'){
                document.getElementById("saladict-paste").value = currentPayload || ''
            }
        }
    }
    try {
        ztools.setSubInput(function(data) {
            var text = (typeof data === 'string') ? data : (data && data.text || '');
            if (!text) return;
            currentPayload = text;
            document.getElementById("saladict-paste").value = text;
            // 通过 postMessage 通知 iframe 搜索新词（不依赖 contentDocument）
            try {
                var qsIframe = document.querySelector('.iframe-wrap iframe');
                if (qsIframe) {
                    qsIframe.contentWindow.postMessage({ type: 'saladict-search', text: text }, '*');
                }
            } catch(e) {}
            // 备用：尝试直接操作 iframe DOM
            try {
                var qsIframe2 = document.querySelector('.iframe-wrap iframe');
                if (qsIframe2 && qsIframe2.contentDocument) {
                    var searchBox = qsIframe2.contentDocument.querySelector('.menuBar-SearchBox');
                    if (searchBox) {
                        var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                        nativeSetter.call(searchBox, text);
                        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
                        searchBox.dispatchEvent(new Event('change', { bubbles: true }));
                        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                    }
                }
            } catch(domErr) {}
        }, '输入要查询的单词', true);
    } catch(e) {}

}
window.init = init;
console.log('core run ')
ztools.onPluginReady((params) => {
    console.log('ztools.onPluginReady', params)
    if (params) {
        var payload = params.payload || '';
        if (payload == '沙拉查词' || payload == 'saladict') {
            payload = '';
        }
        currentPayload = payload;
    }
    if (!inited) {
        init()
    } else if (currentPayload) {
        notifyIframeSearch(currentPayload);
        updatePasteCommand();
    }
})
// 模拟install事件
function mockOnInstalled(){
    //install
    return window.browser.storage.sync.get().then((data) => {
        if (!data.activeProfileID) {
          console.log('mock install')
          window.browser.runtime.onInstalled._listeners.forEach((listener) => {
            if (!_.isFunction(listener)) {
              return
            }
            listener({ reason: 'install' })
          })
          let versionInfo = versionData.getData();
          versionData.save({...versionInfo, version:latestVersion})
        }
      }).finally(()=>{
        //update
        let versionInfo = versionData.getData();
        if(!versionInfo || versionInfo.version < latestVersion){
            console.log('mock update')
            window.browser.runtime.onInstalled._listeners.forEach((listener) => {
                if (!_.isFunction(listener)) {
                return
                }
                listener({ reason: 'update' });
            })
            versionData.save({...versionInfo, version:latestVersion})
        }
      })
}
// 保存indexedDB
function saveIndexedBDData() {
    console.log("saveIndexedBDData -> saveIndexedBDData")
    return new Promise(async (resolve, reject) => {
        let data = await exportDatabase('SaladictWords')
        console.log("saveIndexedBDData -> data", data)
        if (data) {
            indexedDBData.save(data);
        }
        resolve()
    })
}

// 保存localstorage
function saveLocalStorageData(data) {
    console.log("saveLocalStorageData -> saveLocalStorageData")
    if (data) {
        localStorageData.save(data);
    }
}
window.outPlugin = function () {
    ztools.outPlugin()
}
window.latestVersion = latestVersion;
window.saveLocalStorageData = saveLocalStorageData;
window.saveIndexedBDData = saveIndexedBDData;

// fetch 代理：将 HTTP fetch 请求转发到 window.axios（Node.js 网络，绕过 CORS）
// v7.21 大量词典引擎直接使用 fetch，在 Electron 渲染进程中受 CORS 限制
function installFetchProxy() {
    var pAxios = window.axios;
    if (!pAxios) {
        console.log('[proxy] WARNING: window.axios not available');
        return;
    }

    // === 1. 拦截 fetch ===
    var _origFetch = window.fetch;
    var fetchProxy = function(input, init) {
        var url = typeof input === 'string' ? input : (input && input.url);
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            return _origFetch.call(this, input, init);
        }
        var method = ((init && init.method) || 'GET').toUpperCase();
        var headers = {};
        if (init && init.headers) {
            if (init.headers instanceof Headers) { init.headers.forEach(function(v, k) { headers[k] = v; }); }
            else if (typeof init.headers === 'object') { Object.assign(headers, init.headers); }
        }
        var cfg = { url: url, method: method, headers: headers, responseType: 'text',
            withCredentials: init && (init.credentials === 'include' || init.credentials === 'same-origin') };
        if (init && init.body && !['GET','HEAD'].includes(method)) {
            if (typeof init.body === 'string') { cfg.data = init.body; }
            else if (init.body instanceof URLSearchParams) { cfg.data = init.body.toString(); cfg.headers['Content-Type'] = cfg.headers['Content-Type'] || 'application/x-www-form-urlencoded'; }
            else if (typeof init.body === 'object') { cfg.data = init.body; }
        }
        console.log('[fetch-proxy]', method, url);
        return pAxios(cfg).then(function(r) {
            var body = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data);
            console.log('[fetch-proxy] OK', r.status, url);
            return new Response(body, { status: r.status, statusText: r.statusText, headers: new Headers(r.headers) });
        }).catch(function(e) {
            console.log('[fetch-proxy] ERR', e.message, url);
            if (e.response) {
                var body = typeof e.response.data === 'object' ? JSON.stringify(e.response.data) : String(e.response.data);
                return new Response(body, { status: e.response.status, statusText: e.response.statusText, headers: new Headers(e.response.headers) });
            }
            return Promise.reject(e);
        });
    };
    try {
        Object.defineProperty(window, 'fetch', { value: fetchProxy, writable: false, configurable: false });
    } catch(e) { window.fetch = fetchProxy; }

    // === 2. 拦截 XMLHttpRequest（关键：patch prototype，即使 webpack 缓存了原始构造函数也生效）===
    var _origOpen = XMLHttpRequest.prototype.open;
    var _origSend = XMLHttpRequest.prototype.send;

    // 在 open 时记录 method 和 url
    XMLHttpRequest.prototype.open = function(method, url, async) {
        this.__proxyMethod = method;
        this.__proxyUrl = url;
        this.__proxyAsync = async;
        this.__proxyHeaders = {};
        return _origOpen.apply(this, arguments);
    };

    // 在 setRequestHeader 时记录 headers
    var _origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (this.__proxyHeaders) { this.__proxyHeaders[name] = value; }
        return _origSetHeader.apply(this, arguments);
    };

    // 在 send 时拦截 HTTP 请求，转发到 axios
    XMLHttpRequest.prototype.send = function(body) {
        var url = this.__proxyUrl;
        // 非 HTTP 请求走原始 XHR
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
            return _origSend.apply(this, arguments);
        }

        var self = this;
        var method = (this.__proxyMethod || 'GET').toUpperCase();
        var headers = Object.assign({}, this.__proxyHeaders || {});

        console.log('[xhr-proxy]', method, url);

        var cfg = {
            url: url,
            method: method,
            headers: headers,
            responseType: 'text',
            withCredentials: this.withCredentials
        };
        if (body && !['GET','HEAD'].includes(method)) {
            cfg.data = typeof body === 'object' ? (body.toString ? body.toString() : JSON.stringify(body)) : body;
        }

        pAxios(cfg).then(function(r) {
            // 模拟 XHR 响应属性
            Object.defineProperty(self, 'status', { writable: true, value: r.status });
            Object.defineProperty(self, 'statusText', { writable: true, value: r.statusText });
            Object.defineProperty(self, 'readyState', { writable: true, value: 4 });
            var respText = typeof r.data === 'object' ? JSON.stringify(r.data) : String(r.data);
            Object.defineProperty(self, 'responseText', { writable: true, value: respText });
            Object.defineProperty(self, 'response', { writable: true, value: respText });
            Object.defineProperty(self, 'responseURL', { writable: true, value: r.config ? r.config.url : url });
            // 模拟 getAllResponseHeaders
            var respHeaders = r.headers || {};
            var headerStr = Object.keys(respHeaders).map(function(k) { return k + ': ' + respHeaders[k]; }).join('\r\n');
            self.__proxyResponseHeaders = headerStr;
            self.__proxyGetResponseHeader = function(name) {
                var val = respHeaders[name] || respHeaders[name.toLowerCase()];
                return val || null;
            };

            console.log('[xhr-proxy] OK', r.status, url);

            // 触发事件
            var readystatechangeEvent = new Event('readystatechange');
            var loadEvent = new Event('load');
            var progressEvent = new ProgressEvent('progress', { lengthComputable: true, loaded: respText.length, total: respText.length });
            if (self.onreadystatechange) { self.onreadystatechange(readystatechangeEvent); }
            if (self.onload) { self.onload(loadEvent); }
            if (self.onprogress) { self.onprogress(progressEvent); }
            self.dispatchEvent(readystatechangeEvent);
            self.dispatchEvent(loadEvent);
            self.dispatchEvent(progressEvent);
        }).catch(function(e) {
            Object.defineProperty(self, 'readyState', { writable: true, value: 4 });
            if (e.response) {
                Object.defineProperty(self, 'status', { writable: true, value: e.response.status });
                Object.defineProperty(self, 'statusText', { writable: true, value: e.response.statusText });
                var respText = typeof e.response.data === 'object' ? JSON.stringify(e.response.data) : String(e.response.data);
                Object.defineProperty(self, 'responseText', { writable: true, value: respText });
                Object.defineProperty(self, 'response', { writable: true, value: respText });
            } else {
                Object.defineProperty(self, 'status', { writable: true, value: 0 });
                Object.defineProperty(self, 'statusText', { writable: true, value: e.message || 'Network Error' });
            }
            console.log('[xhr-proxy] ERR', self.status, url);
            var errorEvent = new ProgressEvent('error');
            if (self.onerror) { self.onerror(errorEvent); }
            self.dispatchEvent(errorEvent);
        });
    };

    // 拦截 getResponseHeader 和 getAllResponseHeaders
    var _origGetResponseHeader = XMLHttpRequest.prototype.getResponseHeader;
    XMLHttpRequest.prototype.getResponseHeader = function(name) {
        if (this.__proxyGetResponseHeader) { return this.__proxyGetResponseHeader(name); }
        return _origGetResponseHeader.apply(this, arguments);
    };
    var _origGetAllResponseHeaders = XMLHttpRequest.prototype.getAllResponseHeaders;
    XMLHttpRequest.prototype.getAllResponseHeaders = function() {
        if (this.__proxyResponseHeaders !== undefined) { return this.__proxyResponseHeaders; }
        return _origGetAllResponseHeaders.apply(this, arguments);
    };

    console.log('[proxy] fetch + XMLHttpRequest prototype patched');
}
