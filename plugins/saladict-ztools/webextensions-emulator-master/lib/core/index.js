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
let latestVersion = '7.19.0'
var currentPayload = '';

ztools.onPluginEnter(({ code, type, payload }) => {
    console.log('ztools.onPluginEnter')
    // let clipboardText = clipboard.readText();
    if (payload == "沙拉查词" || payload == "saladict") {
        payload = ''
    }
    enterEventListener = () => {
        openIframe('ext-saladic/quick-search.html', { hideCloseBtn: true })
        document.execCommand = function (cmd) {
            // console.log("document.execCommand -> cmd", cmd,payload)
            // let clipboardText = clipboard.readText();
            // let queryStr = payload || clipboardText;
            if(cmd == 'copy'){
                let textArea = document.querySelectorAll('textarea');
                textArea = textArea[textArea.length - 1];
                let text = textArea.value;
                ztools.copyText(text)
            }else if(cmd == 'paste'){
                document.getElementById("saladict-paste").value = payload
            }
        }
    }
    if (inited) {
        enterEventListener();
    }

})

async function init() {
    ztools.db.remove("indexedDBData")
    localStorageData = new ztoolsStorage('localStorageData');
    indexedDBData = new ztoolsStorage('indexedDBDataV2');
    versionData = new ztoolsStorage('versionData');
    // 还原内部storage
    restoreLocalStorageData(localStorageData);
    // 还原indexedDB
    await restoreIndexedBDData(indexedDBData)
    let ztoolsPageScript = [
        "ext-saladic/assets/runtime.4097fa5f.js",
        "ext-saladic/assets/view-vendor.13bec606.js",
        "ext-saladic/assets/dexie.c13adbda.js",
        "ext-saladic/assets/20.473a1c38.js",
        "ext-saladic/assets/background.68a7256d.js"
    ];
    // 加载沙拉
    await loadAllJs(ztoolsPageScript);
    
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
            try {
                var qsIframe = document.querySelector('.iframe-wrap iframe');
                if (qsIframe && qsIframe.contentDocument) {
                    var searchBox = qsIframe.contentDocument.querySelector('.menuBar-SearchBox');
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
    init()
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
