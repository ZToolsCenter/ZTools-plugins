const { previewText } = require('../utils/helpers');

function createPendingCaptureHostBridge(deps = {}) {
    const runtimeWindow = deps.window || globalThis.window;
    const pendingCaptures = deps.pendingCaptures || require('../core/pending_captures');
    const retryPendingCapture = deps.retryPendingCapture || (async () => false);
    const formatTarget = (record) => record?.targetParentName
        || record?.targetParentId
        || 'Inbox';

    const buildPendingCaptureItems = ({ limit = 3 } = {}) => pendingCaptures
        .listPendingCaptures()
        .slice(0, limit)
        .map((record) => ({
            title: `待发送：${previewText(record.text, 36)}`,
            description: `发送到 ${formatTarget(record)} 失败：${record.lastError || '未知错误'} · 选择后重试、复制或删除`,
            action: 'pending_capture_actions',
            data: record
        }));

    const buildPendingCaptureActions = (record = {}) => [
        {
            title: '重试发送',
            description: `重新发送到 ${formatTarget(record)}；若 Workflowy 中已出现该消息请先删除此记录`,
            action: 'pending_capture_retry',
            data: record
        },
        {
            title: '复制消息文本',
            description: previewText(record.text, 60),
            action: 'pending_capture_copy',
            data: record
        },
        {
            title: '删除待发送消息',
            description: '只删除本地记录，不影响 Workflowy；选择后需要再次确认',
            action: 'pending_capture_delete',
            data: record
        },
        {
            title: '↩️ 返回',
            action: 'pending_capture_back'
        }
    ];

    const handlePendingCaptureAction = (item, callbackSetList, refresh) => {
        const action = item?.action;
        if (!action || !action.startsWith('pending_capture_')) return false;

        if (action === 'pending_capture_actions') {
            callbackSetList?.(buildPendingCaptureActions(item.data || {}));
            return true;
        }
        if (action === 'pending_capture_back') {
            refresh?.();
            return true;
        }
        if (action === 'pending_capture_copy') {
            const text = item.data?.text || '';
            if (!text) {
                runtimeWindow.ztools?.showNotification('待发送消息已不存在');
            } else {
                runtimeWindow.ztools?.copyText(text);
                runtimeWindow.ztools?.showNotification('已复制待发送消息');
            }
            refresh?.();
            return true;
        }
        if (action === 'pending_capture_delete') {
            callbackSetList?.([
                {
                    title: '确认删除待发送消息',
                    description: previewText(item.data?.text, 60),
                    action: 'pending_capture_delete_confirm',
                    data: item.data
                },
                {
                    title: '↩️ 返回',
                    action: 'pending_capture_actions',
                    data: item.data
                }
            ]);
            return true;
        }
        if (action === 'pending_capture_delete_confirm') {
            pendingCaptures.removePendingCapture(item.data?.id);
            runtimeWindow.ztools?.showNotification('已删除待发送消息');
            refresh?.();
            return true;
        }
        if (action === 'pending_capture_retry') {
            void Promise.resolve(retryPendingCapture(item.data?.id))
                .finally(() => refresh?.());
            return true;
        }
        return false;
    };

    return {
        buildPendingCaptureItems,
        buildPendingCaptureActions,
        handlePendingCaptureAction
    };
}

module.exports = {
    createPendingCaptureHostBridge
};
