function createComposeFeatureHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const { getSettings } = deps.settings || require('../core/settings');
    const { getDefaultNode } = deps.nodeManager || require('../core/node_manager');
    const { resolveCaptureApiRef } = deps.workflowy || require('../api/workflowy');
    const { humanizeRefName } = deps.helpers || require('../utils/helpers');
    const deriveComposeInitialText = deps.deriveComposeInitialText
        || (deps.helpers && deps.helpers.deriveComposeInitialText)
        || require('../utils/helpers').deriveComposeInitialText;
    const runtimeWindow = deps.window || globalThis.window;

    const composeHost = deps.composeHost || null;
    const notify = deps.notify || ((message) => runtimeWindow.ztools?.showNotification?.(message));
    const setCaptureTarget = deps.setCaptureTarget || (() => {});

    const hideMainWindow = () => {
        try {
            runtimeWindow.ztools?.hideMainWindow?.();
        } catch (error) {
            console.error('Failed to hide uTools window before compose:', error);
        }
    };

    const showError = (callbackSetList, items) => {
        try {
            runtimeWindow.ztools?.showMainWindow?.();
        } catch (error) {
            console.error('Failed to show uTools window for compose error:', error);
        }
        callbackSetList?.(items);
    };

    const handleComposeFeatureEnter = async ({ action, callbackSetList } = {}) => {
        // The shortcut shows the uTools input before this handler runs.
        // Hide it before any list paint or target request, and keep it hidden
        // on success so the editor is the first window the user sees.
        hideMainWindow();

        // Text typed beside the invoke keyword rides along as the opening
        // draft; a shortcut entry or a keyword-only payload opens empty.
        const initialText = deriveComposeInitialText(action);

        const settings = getSettings();
        if (!settings?.apiKey) {
            showError(callbackSetList, [{
                title: '请先配置 API Key',
                description: '输入 wfs 进入设置',
                type: 'error'
            }]);
            return false;
        }

        const defaultNode = getDefaultNode();
        if (!defaultNode?.id) {
            showError(callbackSetList, [{
                title: '未配置 wf 发送目标',
                description: '输入 wfs 选择发送目标后再试',
                type: 'error'
            }]);
            return false;
        }

        let targetName = defaultNode.name || humanizeRefName(defaultNode.id);

        try {
            composeHost?.prepareComposeWindow?.({ immediate: true });
            const parentId = await resolveCaptureApiRef(defaultNode, (recoveredTarget, recoveryError) => {
                targetName = recoveredTarget.name || targetName;
                if (recoveryError?.code === 'WORKFLOWY_NETWORK_ERROR') {
                    notify(`暂时无法连接 Workflowy 校验发送目标 ${defaultNode.id}，本次将发送到 Inbox（已保存目标未修改）`);
                    return;
                }
                setCaptureTarget(recoveredTarget.ref, recoveredTarget.name, recoveredTarget.refType);
                notify(`原 wf 发送目标 ${defaultNode.id} 已失效，已自动切换为 Inbox`);
            });

            AppState.currentItemId = parentId;
            AppState.mode = 'add';
            AppState.exitAfterSubmit = true;

            const win = composeHost?.openComposeWindow?.({
                text: initialText,
                parentId,
                parentName: targetName,
                standalone: true
            });

            if (!win) {
                showError(callbackSetList, [{
                    title: '无法打开长文本编辑窗口',
                    description: '请重试，或使用 wf 输入框',
                    type: 'error'
                }]);
                return false;
            }

            hideMainWindow();
            return true;
        } catch (error) {
            showError(callbackSetList, [{
                title: '无法定位发送目标',
                description: error?.message || '请检查网络或 wfs 发送目标',
                type: 'error'
            }]);
            notify(`定位失败: ${error?.message || '未知错误'}`);
            return false;
        }
    };

    return {
        handleComposeFeatureEnter
    };
}

module.exports = {
    createComposeFeatureHostBridge
};
