// subinput_compat.js —— ZTools / uTools 子输入框提交兼容层
//
// ZTools 不把 Enter 转发给插件 WebContentsView（只转发 Tab），
// uTools 会转发（sendPluginSomeKeyDownEvent）。这里统一成：
//   - 文本变化去抖 400ms 后自动提交
//   - Enter 若到达（uTools），立即提交
// 两种宿主行为一致，且不会重复提交。

function createSubInputCommitter(options = {}) {
    const {
        normalize = (v) => v,
        onCommit,
        delay = 400,
        notify,
        onEmpty
    } = options;

    let timer = null;
    let lastCommitted = null;
    let disposed = false;

    const commit = (silent) => {
        if (disposed) return false;
        const value = normalize(String(current || '').trim());
        if (value === lastCommitted) return false;
        if (!value && typeof onEmpty === 'function') {
            const handled = onEmpty(value);
            if (handled) {
                lastCommitted = value;
                return true;
            }
        }
        lastCommitted = value;
        onCommit(value);
        if (!silent && typeof notify === 'function') notify('已保存');
        return true;
    };

    let current = '';

    const onChange = (text) => {
        current = typeof text === 'string' ? text : '';
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            commit(false);
        }, delay);
    };

    const onEnter = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        commit(false);
    };

    const dispose = () => {
        disposed = true;
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return { onChange, onEnter, commit, dispose, getValue: () => current };
}

// 关闭子输入框并清空残留文本。
//
// ZTools 状态机实证（appMain-9GEoA_QC.js）：
//   removeSubInput()   → 只发 update-sub-input-visible=false，**不清 cached.subInputValue**
//   setSubInputValue() → 只改 cached.subInputValue，**不隐藏输入框**
//   重新进入插件时：searchQuery = cached.subInputValue || ""  ← 旧文本被灌回输入框
//
// 因此必须「先清值、再隐藏」，两步顺序不能反（反了会先隐藏再写值，值仍留在缓存里）。
function closeSubInput(runtimeWindow) {
    const api = runtimeWindow && runtimeWindow.ztools;
    if (!api) return;
    try {
        if (typeof api.setSubInputValue === 'function') api.setSubInputValue('');
    } catch (e) { /* ignore */ }
    try {
        if (typeof api.removeSubInput === 'function') api.removeSubInput();
    } catch (e) { /* ignore */ }
}

// 打开「仅提示」的子输入框（不接受真实输入，只显示提示语），并清空残留值。
//
// 这类调用形如 setSubInput(() => {}, '提示语', '')：
//   - 第三个参数是 isFocus，不是默认值；传 '' 会让输入框失焦
//   - ZTools 不会自动清空 cached.subInputValue，上次输入会残留在输入框里
//
// 因此先 setSubInputValue('') 清缓存，再 setSubInput 显示提示。
function openHintSubInput(runtimeWindow, placeholder, isFocus = true) {
    const api = runtimeWindow && runtimeWindow.ztools;
    if (!api) return;
    try {
        if (typeof api.setSubInputValue === 'function') api.setSubInputValue('');
    } catch (e) { /* ignore */ }
    try {
        if (typeof api.setSubInput === 'function') api.setSubInput(() => {}, placeholder, isFocus);
    } catch (e) { /* ignore */ }
}

module.exports = { createSubInputCommitter, closeSubInput, openHintSubInput };

