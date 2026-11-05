// host/shim.js —— 双宿主兼容层（uTools / ZTools）
//
// 设计目标：让同一份插件代码在两个宿主下都能运行，且**业务代码零改动**。
//
// 做法：在 preload 最顶部调用 installHostShim()，保证 window.utools 一定存在：
//   - uTools：本来就有 window.utools，只补缺失的 removeSubInput 语义
//   - ZTools：把 window.ztools 挂成 window.utools，并包装两个行为差异
//
// 为什么不是改 186 处调用点：源码里 167 处走 runtimeWindow.utools（模块内
// `const runtimeWindow = deps.window || globalThis.window`），18 处走
// window.utools。只要保证 window.utools 存在，两者全部自动生效。
//
// 两个真实的行为差异（已实证）：
//   1) Enter 转发：uTools 用 sendPluginSomeKeyDownEvent 把 Enter 转发给插件；
//      ZTools 只转发 Tab。→ 提交时机必须去抖兜底（已在上层 settings_host 等实现）
//   2) removeSubInput：ZTools 只发 visible=false，不清 cached.subInputValue，
//      下次进入插件会把旧文本灌回输入框。→ 在这里包装成「先清值再隐藏」

function detectHost(win) {
    if (!win) return 'unknown';
    if (win.utools) return 'utools';
    if (win.ztools) return 'ztools';
    return 'unknown';
}

function installHostShim(win) {
    const host = win || (typeof window !== 'undefined' ? window : globalThis);
    const kind = detectHost(host);

    // 已经是 uTools：只补 removeSubInput（uTools 的 apisdk 也没有这个方法）
    if (kind === 'utools') {
        const api = host.utools;
        if (typeof api.removeSubInput !== 'function') {
            // uTools 没有「隐藏子输入框」的公开 API，退化为清空值（保持不崩）
            api.removeSubInput = function removeSubInputFallback() {
                try {
                    if (typeof api.setSubInputValue === 'function') api.setSubInputValue('');
                } catch (e) { /* ignore */ }
                return true;
            };
        }
        host.__hostKind = 'utools';
        return { kind: 'utools', api };
    }

    // ZTools：把 ztools 挂成 utools，并包装 removeSubInput 清值语义
    if (kind === 'ztools') {
        const zapi = host.ztools;

        // 包装 removeSubInput：先 setSubInputValue('') 清缓存，再真正隐藏。
        // 顺序不能反 —— 反了会先隐藏再写值，值仍留在 ZTools 的 cached.subInputValue 里。
        if (typeof zapi.removeSubInput === 'function' && !zapi.__removeSubInputWrapped) {
            const rawRemove = zapi.removeSubInput.bind(zapi);
            zapi.removeSubInput = function removeSubInputClearing() {
                try {
                    if (typeof zapi.setSubInputValue === 'function') zapi.setSubInputValue('');
                } catch (e) { /* ignore */ }
                return rawRemove();
            };
            zapi.__removeSubInputWrapped = true;
        }

        // uTools 没有 hideSubInput（两边都没有），插件历史上调用过它。
        // 在 ZTools 下映射为「清值 + 隐藏」，语义与 uTools 的意图一致。
        if (typeof zapi.hideSubInput !== 'function') {
            zapi.hideSubInput = function hideSubInput() {
                return zapi.removeSubInput();
            };
        }

        // 关键：把 ztools 挂成 utools，让 167 处 runtimeWindow.utools 直接可用
        if (!host.utools) {
            host.utools = zapi;
        }
        host.__hostKind = 'ztools';
        return { kind: 'ztools', api: zapi };
    }

    // 都不存在（浏览器调试模式）：给一个最小 stub，避免顶层抛 TypeError
    const stub = {
        showNotification() {},
        hideMainWindow() {},
        showMainWindow() {},
        outPlugin() {},
        copyText() { return true; },
        setSubInput() { return true; },
        setSubInputValue() { return true; },
        removeSubInput() { return true; },
        hideSubInput() { return true; },
        subInputSelect() { return true; },
        subInputFocus() { return true; },
        onPluginEnter() {},
        onPluginOut() {},
        isMacOs() { return false; },
        isWindows() { return true; },
        dbStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        db: { get: () => null, put: () => ({ ok: true }), remove: () => ({ ok: true }) },
        getPath: () => '',
        shellOpenExternal() {},
        createBrowserWindow() {},
    };
    host.utools = stub;
    host.__hostKind = 'stub';
    return { kind: 'stub', api: stub };
}

module.exports = { installHostShim, detectHost };
