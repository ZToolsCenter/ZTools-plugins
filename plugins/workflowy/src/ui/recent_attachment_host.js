function createRecentAttachmentHostBridge(deps = {}) {
    const runtimeWindow = deps.window || globalThis.window;
    const {
        getSettings
    } = deps.settings || require('../core/settings');
    const {
        deleteObjectFromOss
    } = deps.oss || require('../api/oss');
    const {
        removeRecentAttachment
    } = deps.recentAttachments || require('../core/recent_attachments');
    const {
        formatRecentAttachmentDescription
    } = deps.interaction || require('../utils/interaction');
    const previewHost = deps.previewHost || require('./renderer');
    const openPreviewWindow = deps.openPreviewWindow || previewHost.openPreviewWindow;
    const setPreviewDeleteRefreshHandler = deps.setPreviewDeleteRefreshHandler || previewHost.setPreviewDeleteRefreshHandler;
    const retryRecentAttachmentCreate = deps.retryRecentAttachmentCreate || (async () => false);

    const buildRecentAttachmentActions = (attachment, backAction = 'view_recent_attachments') => {
        const attachmentActions = [];
        if (['uploaded', 'save_failed'].includes(attachment?.status)) {
            attachmentActions.push({
                title: '保存到 Workflowy',
                description: '使用记录中的目标和标题重试创建节点',
                action: 'recent_attachment_retry',
                data: attachment
            });
        }
        attachmentActions.push({ title: '复制链接', description: '复制 OSS 链接', action: 'recent_attachment_copy', data: attachment });
        attachmentActions.push({ title: '预览附件', description: '在插件内弹窗预览内容', action: 'recent_attachment_preview', data: attachment });
        if (['uploaded', 'save_failed'].includes(attachment?.status)) {
            attachmentActions.push({ title: '删除 OSS 对象', description: '删除远端文件并标记为已删除', action: 'recent_attachment_delete', data: attachment });
        }
        if (['saved', 'deleted'].includes(attachment?.status)) {
            attachmentActions.push({ title: '从列表移除', description: '只移除本地最近记录', action: 'recent_attachment_remove', data: attachment });
        }
        attachmentActions.push({ title: '附件状态', description: formatRecentAttachmentDescription(attachment), type: 'info' });
        attachmentActions.push({ title: '↩️ 返回', action: backAction });
        return attachmentActions;
    };

    const openRecentAttachmentActions = (attachment, callbackSetList, backAction = 'view_recent_attachments') => {
        callbackSetList?.(buildRecentAttachmentActions(attachment, backAction));
    };

    const handleRecentAttachmentAction = (item, callbackSetList, refresh, backAction = 'view_recent_attachments') => {
        if (item.action === 'open_recent_attachment') {
            openRecentAttachmentActions(item.data, callbackSetList, backAction);
            return true;
        }
        if (item.action === 'recent_attachment_back') {
            refresh?.();
            return true;
        }
        if (item.action === 'recent_attachment_copy') {
            runtimeWindow.ztools?.copyText(item.data?.url || '');
            runtimeWindow.ztools?.showNotification('已复制附件链接');
            refresh?.('view_recent_attachments');
            return true;
        }
        if (item.action === 'recent_attachment_preview') {
            const attachment = item.data || {};
            const previewUrl = attachment.rawUrl || attachment.url || '';
            if (previewUrl) {
                const refreshAfterDelete = typeof refresh === 'function'
                    ? () => refresh('view_recent_attachments')
                    : null;
                if (refreshAfterDelete) {
                    setPreviewDeleteRefreshHandler(refreshAfterDelete);
                }
                openPreviewWindow(
                    previewUrl,
                    attachment.displayName || attachment.name || '附件预览',
                    attachment.kind || 'image',
                    {
                        objectKey: attachment.objectKey,
                        attachmentId: attachment.id
                    }
                );
            } else {
                runtimeWindow.ztools?.showNotification('没有可预览的附件链接');
            }
            return true;
        }
        if (item.action === 'recent_attachment_retry') {
            void Promise.resolve(retryRecentAttachmentCreate(item.data?.id))
                .finally(() => refresh?.('view_recent_attachments'));
            return true;
        }
        if (item.action === 'recent_attachment_delete') {
            const attachment = item.data;
            void Promise.resolve(deleteObjectFromOss(getSettings(), attachment?.objectKey))
                .then(() => {
                    removeRecentAttachment(attachment?.id);
                    runtimeWindow.ztools?.showNotification('已删除 OSS 对象');
                })
                .catch((error) => {
                    runtimeWindow.ztools?.showNotification(`删除失败: ${error.message}`);
                })
                .finally(() => refresh?.('view_recent_attachments'));
            return true;
        }
        if (item.action === 'recent_attachment_remove') {
            removeRecentAttachment(item.data?.id);
            refresh?.('view_recent_attachments');
            return true;
        }
        return false;
    };

    return {
        buildRecentAttachmentActions,
        openRecentAttachmentActions,
        handleRecentAttachmentAction
    };
}

module.exports = {
    createRecentAttachmentHostBridge
};
