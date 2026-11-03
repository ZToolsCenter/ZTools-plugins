const { t } = require('../utils/i18n');

// A payload longer than this that also contains a link is treated as a
// composed excerpt (link + the user's own words) rather than a bare link, so
// it is never auto-submitted without review.
const STAGED_LINK_LENGTH_THRESHOLD = 40;

function createWorkflowyAddHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const recentAttachmentHost = deps.recentAttachmentHost || require('./recent_attachment_host');
    const pendingCaptureHost = deps.pendingCaptureHost || { handlePendingCaptureAction: () => false };
    const runtimeWindow = deps.window || globalThis.window;

    // 记住来源消息
    const rememberSourceTitle = '已记住摘录来源';

    const handleWorkflowyAddEnter = async ({
        action,
        callbackSetList,
        settings,
        resolveTarget,
        targetContext,
        rememberWebSourceFeatureCode,
        getRememberableWebLink,
        createTextCaptureNodes,
        getWorkflowyNodeId,
        findCreatedWorkflowyChildNodeId,
        rememberWebSourceFromInput,
        rememberWebSource,
        extractImageFromPluginPayload,
        extractMarkdownFileFromPluginPayload,
        deriveInitialQuickTextFromAction,
        isWorkflowyAddKeyword,
        createNode,
        navigateTo,
        getRememberedWebSource,
        readClipboardText,
        parseStagedWebLinkCandidate
    }) => {        const rawPayloadText = typeof action?.payload === 'string'
            ? action.payload.trim()
            : String(action?.payload?.text || '').trim();

        if (action?.code === rememberWebSourceFeatureCode && rawPayloadText) {
            const link = getRememberableWebLink(rawPayloadText);
            if (!link?.url) {
                runtimeWindow.ztools?.showNotification('未识别到可记住的网页链接');
                runtimeWindow.ztools?.outPlugin();
                return true;
            }

            runtimeWindow.ztools?.hideMainWindow();
            const resolved = await resolveTarget();
            if (!resolved) return true;
            AppState.currentItemId = targetContext.parentId;

            try {
                const createResult = await createTextCaptureNodes({
                    parentId: targetContext.parentId,
                    text: rawPayloadText,
                    settings
                });
                const createdNode = createResult.createdNodes[0] || null;
                const createdNodeId = getWorkflowyNodeId(createdNode)
                    || await findCreatedWorkflowyChildNodeId({
                        parentId: createResult.createdParentId,
                        expectedItem: createResult.childItems[0],
                        settings
                    });

                const remembered = await rememberWebSourceFromInput(rawPayloadText, settings);
                if (remembered?.url && createdNodeId) {
                    rememberWebSource({
                        ...remembered,
                        workflowyNodeId: createdNodeId
                    });
                    runtimeWindow.ztools?.showNotification(`${rememberSourceTitle}：${remembered.title}`);
                } else {
                    runtimeWindow.ztools?.showNotification('已创建链接，但未能记住摘录来源');
                }
            } catch (error) {
                runtimeWindow.ztools?.showNotification(`操作失败：${error?.message || '未知错误'}`);
            }
            runtimeWindow.ztools?.outPlugin();
            return true;
        }

        const initialImagePayload = extractImageFromPluginPayload(action?.payload);
        const canReadMarkdownPayload = action?.code === 'workflowy-add-markdown'
            || Array.isArray(action?.payload)
            || Array.isArray(action?.payload?.files);
        const initialMarkdownPayload = initialImagePayload
            ? null
            : (canReadMarkdownPayload ? extractMarkdownFileFromPluginPayload(action?.payload) : null);
        const initialUploadPayload = initialImagePayload || initialMarkdownPayload;

        if (initialUploadPayload) {
            AppState.queuedUploadPayload = initialUploadPayload;
        }
        const initText = deriveInitialQuickTextFromAction({
            action,
            hasInitialUploadPayload: !!initialUploadPayload
        });

        // A payload that opens the input for review must remain visible in it.
        let prefillText = '';

        if (initText && !isWorkflowyAddKeyword(initText)) {
            // Auto-submit guard: only a payload that combines a link with the
            // user's own words is a composed excerpt. A bare link of any length
            // is still a link capture; classifying by length alone sent normal
            // article URLs into an empty input and silently dropped the link.
            const bareLink = typeof getRememberableWebLink === 'function'
                ? getRememberableWebLink(initText)
                : null;
            const composedExcerpt = !bareLink
                && initText.length > STAGED_LINK_LENGTH_THRESHOLD
                && /https?:\/\//i.test(initText);
            if (composedExcerpt) {
                prefillText = initText;
                AppState.stagedWebLink = null;
            } else {
                runtimeWindow.ztools?.hideMainWindow();
                const resolved = await resolveTarget();
                if (!resolved) return true;
                AppState.currentItemId = targetContext.parentId;
                try {
                    await createNode(initText, { parentName: targetContext.nodeName });
                } catch (error) {
                    AppState.exitAfterSubmit = false;
                    runtimeWindow.ztools?.showNotification(
                        `发送失败：${error?.message || '未知错误'}；已保存为待发送消息，重新进入 wf 可重试`
                    );
                    runtimeWindow.ztools?.outPlugin();
                    return true;
                }
                runtimeWindow.ztools?.outPlugin();
                return true;
            }
        }

        // We are about to open the input. If the clipboard holds exactly one
        // bare link, uTools is about to auto-fill it into the sub-input, which
        // used to merge the link with whatever the user then typed. Keep it
        // out of the input and stage it as the parent of that note instead.
        // Only the 'parent' policy stages: 'fill' keeps the legacy auto-fill
        // behavior and 'off' ignores the clipboard entirely. All three deps are
        // optional, so a missing or unreadable clipboard simply stages nothing.
        const readClipboard = typeof readClipboardText === 'function'
            ? readClipboardText
            : () => '';
        const parseStaged = typeof parseStagedWebLinkCandidate === 'function'
            ? parseStagedWebLinkCandidate
            : () => null;
        const prefillPolicy = settings?.prefillPolicy || 'parent';
        // A composed excerpt is already on screen for review; consuming the
        // clipboard link here would both mislead with the parent-link row and
        // let a second link fight with the text already in the input.
        AppState.stagedWebLink = prefillPolicy === 'parent' && !prefillText
            ? parseStaged(readClipboard(runtimeWindow.ztools))
            : null;
        if (prefillText) AppState.inputText = prefillText;

        AppState.exitAfterSubmit = true;
        callbackSetList([{ title: '正在跳转...' }]);
        const resolved = await resolveTarget();
        if (!resolved) {
            AppState.exitAfterSubmit = false;
            callbackSetList([
                {
                    title: '无法定位发送目标',
                    description: '请检查网络，或在 wfs 中重新选择 wf 发送目标',
                    type: 'error'
                },
                ...(pendingCaptureHost.buildPendingCaptureItems?.({ limit: 3 }) || [])
            ]);
            return true;
        }
        const rememberedWebSource = getRememberedWebSource();
        if (rememberedWebSource?.url) {
            runtimeWindow.ztools?.showNotification(`${rememberSourceTitle}：${rememberedWebSource.title}`);
        }
        navigateTo(targetContext.parentId, targetContext.nodeName);
        return true;
    };

    const handleWorkflowyAddSelect = async ({
        item,
        callbackSetList,
        handlePendingUploadAction,
        handleInlineEditAction,
        executeNodeAction,
        showNodeActions
    }) => {
        if (pendingCaptureHost.handlePendingCaptureAction(
            item,
            callbackSetList,
            () => {
                if (AppState.inputActions?.renderCurrentList) {
                    AppState.inputActions.renderCurrentList();
                    return;
                }
                callbackSetList([
                    {
                        title: '无法定位发送目标',
                        description: '请检查网络，或在 wfs 中重新选择 wf 发送目标',
                        type: 'error'
                    },
                    ...(pendingCaptureHost.buildPendingCaptureItems?.({ limit: 3 }) || [])
                ]);
            }
        )) return true;
        if (await handlePendingUploadAction(item.action)) return true;
        if (item.action === 'staged_link_dismiss') {
            AppState.stagedWebLink = null;
            AppState.inputActions?.renderCurrentList?.();
            runtimeWindow.ztools?.showNotification('已放弃本次摘录链接，笔记将作为普通节点保存');
            return true;
        }
        if (recentAttachmentHost.handleRecentAttachmentAction(
            item,
            callbackSetList,
            () => AppState.inputActions?.renderCurrentList?.(),
            'recent_attachment_back'
        )) return true;

        if (item.action === 'goto_settings') {
            runtimeWindow.ztools?.redirect('workflowy-settings');
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
        if (item.type === 'dataItem') {
            showNodeActions(item.item);
            return true;
        }
        return false;
    };

    return {
        handleWorkflowyAddEnter,
        handleWorkflowyAddSelect
    };
}

module.exports = {
    createWorkflowyAddHostBridge
};
