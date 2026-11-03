const { closeSubInput } = require('../utils/subinput_compat');

function createManualTargetHostBridge(deps = {}) {
    const { EventManager } = deps.state || require('../core/state');
    const {
        parseTaskboxInput
    } = deps.helpers || require('../utils/helpers');
    const runtimeWindow = deps.window || globalThis.window;
    const runtimeDocument = deps.document || globalThis.document;

    const openManualTargetInput = ({
        placeholder = '格式: 名称|引用，或直接输入引用',
        initialValue = '',
        onConfirm,
        onCancel,
        onInvalid
    }) => {
        EventManager.clear();
        let draft = String(initialValue || '');

        // ZTools 不转发 Enter，改为「停止输入后自动提交」；uTools 下 Enter 仍即时提交
        const tryCommit = (silent) => {
            const parsed = parseTaskboxInput(draft);
            if (!parsed?.id) {
                if (silent) return false;
                if (typeof onInvalid === 'function') {
                    onInvalid(parsed, draft);
                } else {
                    runtimeWindow.ztools?.showNotification(parsed?.error || '格式错误，请按“名称|引用”输入');
                }
                return false;
            }
            closeSubInput(runtimeWindow);
            onConfirm?.(parsed, draft);
            return true;
        };

        let commitTimer = null;
        runtimeWindow.ztools?.setSubInput(({ text }) => {
            draft = typeof text === 'string' ? text : '';
            if (commitTimer) clearTimeout(commitTimer);
            commitTimer = setTimeout(() => {
                commitTimer = null;
                tryCommit(true);
            }, 500);
        }, placeholder, draft);

        EventManager.add(runtimeDocument, 'keydown', (event) => {
            if (event.key === 'Escape') {
                if (commitTimer) clearTimeout(commitTimer);
                closeSubInput(runtimeWindow);
                onCancel?.();
                return;
            }
            if (event.key !== 'Enter') return;
            if (commitTimer) clearTimeout(commitTimer);
            tryCommit(false);
        });
    };

    return {
        openManualTargetInput
    };
}

let defaultBridge = null;

const getDefaultBridge = () => {
    if (!defaultBridge) {
        defaultBridge = createManualTargetHostBridge();
    }
    return defaultBridge;
};

module.exports = {
    createManualTargetHostBridge,
    openManualTargetInput: (...args) => getDefaultBridge().openManualTargetInput(...args)
};
