const { t } = require('../utils/i18n');

function createWorkflowyViewHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const {
        getNodes,
        getDefaultNode,
        NodeManager
    } = deps.nodes || require('../core/node_manager');
    const {
        listRecentAttachments
    } = deps.recentAttachments || require('../core/recent_attachments');
    const {
        getPendingRecentAttachments,
        formatRecentAttachmentDescription
    } = deps.interaction || require('../utils/interaction');
    const {
        humanizeRefName
    } = deps.helpers || require('../utils/helpers');
    const recentAttachmentHost = deps.recentAttachmentHost || require('./recent_attachment_host');
    const pendingCaptureHost = deps.pendingCaptureHost || {
        buildPendingCaptureItems: () => [],
        handlePendingCaptureAction: () => false
    };
    const manualTargetHost = deps.manualTargetHost || require('./manual_target_host');
    const showWorkflowyTargetImportMenu = deps.showWorkflowyTargetImportMenu || (async () => {});
    const getTargetRef = deps.getTargetRef || (target => String(target?.key || target?.id || target?.nodeId || target?.node_id || '').trim());
    const getTargetName = deps.getTargetName || (target => String(target?.name || getTargetRef(target) || 'Unnamed').trim());
    const runtimeWindow = deps.window || globalThis.window;

    const buildWorkflowyViewRootList = () => {
        const nodes = getNodes();
        const menu = nodes.map((node) => ({
            title: `${node.isCapture ? '🚀 ' : '📁 '}${node.name}`,
            description: `${[t('enterBrowse') + ' | ' + t('pinWidget'), node.isCapture ? t('captureTarget') : null, `${t('reference')}: ${node.id}`].filter(Boolean).join(' | ')}`,
            type: 'nodeEntry',
            nodeId: node.id,
            nodeName: node.name
        }));
        const pendingRecentAttachments = getPendingRecentAttachments(listRecentAttachments({ includeDeleted: true }), 3);
        const defaultNode = getDefaultNode();

        menu.unshift({
            title: `🧹 清理 ${defaultNode.name || humanizeRefName(defaultNode.id)}`,
            description: '只显示 wf 发送目标下未完成的直接子节点',
            type: 'cleanupEntry',
            nodeId: defaultNode.id,
            nodeName: defaultNode.name || humanizeRefName(defaultNode.id)
        });

        if (pendingRecentAttachments.length > 0) {
            menu.unshift(...pendingRecentAttachments.map((attachment) => ({
                title: `待处理附件：${attachment.kind === 'markdown' ? '文件' : '图片'} ${attachment.displayName || attachment.name || attachment.objectKey}`,
                description: formatRecentAttachmentDescription(attachment),
                action: 'open_recent_attachment',
                data: attachment
            })));
        }

        const pendingCaptureItems = pendingCaptureHost.buildPendingCaptureItems?.({ limit: 5 }) || [];
        if (pendingCaptureItems.length > 0) {
            menu.unshift(...pendingCaptureItems);
        }

        menu.push({ title: '➕ 添加查看入口', description: '添加到 wfv 查看入口', type: 'addViewEntryMenu' });
        return menu;
    };

    const handleWorkflowyViewRootSelect = async ({
        item,
        callbackSetList,
        refreshRoot,
        handlePendingUploadAction,
        navigateTo,
        navigateToCleanup,
        openListWidget,
        modifierTracker,
        showNodeActions,
        handleInlineEditAction,
        executeNodeAction,
        createNode
    }) => {
        if (pendingCaptureHost.handlePendingCaptureAction(item, callbackSetList, () => {
            if (AppState.inputActions?.renderCurrentList) {
                AppState.inputActions.renderCurrentList();
                return;
            }
            refreshRoot?.();
        })) return true;
        if (await handlePendingUploadAction(item.action)) return true;
        if (recentAttachmentHost.handleRecentAttachmentAction(
            item,
            callbackSetList,
            refreshRoot,
            'recent_attachment_back'
        )) return true;

        if (item.action === 'quick_create_node') {
            createNode(item.data);
            return true;
        }

        if (item.type === 'nodeEntry') {
            if (modifierTracker.isPinAction()) {
                openListWidget(item.nodeId, item.nodeName);
                runtimeWindow.ztools?.hideMainWindow();
                runtimeWindow.ztools?.outPlugin();
            } else {
                navigateTo(item.nodeId, item.nodeName);
            }
            return true;
        }

        if (item.type === 'cleanupEntry') {
            navigateToCleanup(item.nodeId, item.nodeName);
            return true;
        }

        if (item.type === 'dataItem') {
            showNodeActions(item.item);
            return true;
        }

        if (item.type === 'addViewEntryMenu') {
            void showWorkflowyTargetImportMenu({
                callbackSetList,
                existingRefs: getNodes().map((node) => node.id),
                manualAction: 'add_view_entry_manual_from_wfv',
                importAction: 'import_target_as_view_entry_from_wfv',
                backAction: 'back_to_wfv_root',
                manualTitle: t('addViewEntry').replace('➕ ', '📝 '),
                backTitle: `${t('back')} wfv`
            });
            return true;
        }

        if (item.action === 'add_view_entry_manual_from_wfv') {
            manualTargetHost.openManualTargetInput({
                onConfirm(parsed) {
                    const result = NodeManager.add(parsed.id, parsed.name, parsed.type);
                    if (result?.success === false) {
                        runtimeWindow.ztools?.showNotification(result.message);
                        return;
                    }
                    runtimeWindow.ztools?.showNotification(t('addSuccess'));
                    refreshRoot();
                }
            });
            return true;
        }

        if (item.action === 'import_target_as_view_entry_from_wfv') {
            const target = item.data || {};
            const ref = getTargetRef(target);
            if (ref) {
                const result = NodeManager.add(ref, getTargetName(target), target.type);
                if (result?.success === false) {
                    runtimeWindow.ztools?.showNotification(result.message);
                } else {
                    runtimeWindow.ztools?.showNotification(`已添加查看入口: ${getTargetName(target)} `);
                }
            }
            refreshRoot();
            return true;
        }

        if (item.action === 'back_to_wfv_root') {
            refreshRoot();
            return true;
        }

        if (item.action && item.action.startsWith('wf_edit_')) {
            handleInlineEditAction(item.action, item.data);
            return true;
        }

        if (item.action) {
            executeNodeAction(item.action, item.data);
            return true;
        }

        return false;
    };

    return {
        buildWorkflowyViewRootList,
        handleWorkflowyViewRootSelect
    };
}

module.exports = {
    createWorkflowyViewHostBridge
};
