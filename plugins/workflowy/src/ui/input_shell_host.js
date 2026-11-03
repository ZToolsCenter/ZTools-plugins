function createInputShellHostBridge(deps = {}) {
    const { AppState, EventManager } = deps.state || require('../core/state');
    const {
        listRecentAttachments
    } = deps.recentAttachments || require('../core/recent_attachments');
    const {
        getRememberedWebSource,
        isStagedWebLinkEcho = () => false
    } = deps.webCapture || require('../core/web_capture');
    const {
        stripHtml
    } = deps.helpers || require('../utils/helpers');
    const {
        extractImageFromPasteEvent,
        readImageFileFromUtoolsClipboard
    } = deps.image || require('../utils/image');
    const {
        extractMarkdownFileFromPasteEvent,
        readMarkdownFileFromUtoolsClipboard
    } = deps.markdownFile || require('../utils/markdown_file');
    const {
        shouldStageClipboardImageFallback,
        buildSearchCreateItem,
        buildCleanupStatusItem,
        buildStagedLinkStatusItem,
        getPendingRecentAttachments,
        formatRecentAttachmentDescription,
        formatRememberedWebSourceDescription
    } = deps.interaction || require('../utils/interaction');
    const runtimeWindow = deps.window || globalThis.window;
    const runtimeDocument = deps.document || globalThis.document;
    const trimString = (value) => String(value || '').trim();

    const setupInputAndKeyboard = ({
        nodeName,
        renderList,
        pendingUploadHost,
        pendingCaptureHost,
        composeHost,
        setPreviewDeleteRefreshHandler,
        consumePreviewDeleteNotification,
        createNode,
        navigateTo
    }) => {
        EventManager.clear();

        const isAddMode = AppState.mode === 'add';
        const composeShortcut = runtimeWindow.ztools?.isMacOs?.() ? 'Cmd+Enter' : 'Ctrl+Enter';
        const placeholder = isAddMode
            ? `发送到「${nodeName}」· Enter 提交 · ${composeShortcut} 长文本 (Esc 退出)`
            : `在「${nodeName}」中搜索或新建...`;

        // Survives re-entry: stale-while-revalidate calls setup twice, and the
        // second call must not drop text the user already typed.
        const exitAfterSubmit = AppState.exitAfterSubmit && isAddMode;
        let currentInputText = AppState.inputText;

        const syncInputText = (text) => {
            currentInputText = String(text == null ? '' : text);
            AppState.inputText = currentInputText;
            return currentInputText;
        };

        const buildStagedLinkStatusItems = () => {
            const item = buildStagedLinkStatusItem(AppState.stagedWebLink);
            return item ? [item] : [];
        };

        const renderCurrentList = () => {
            const kw = currentInputText.trim().toLowerCase();

            let displayItems = [];
            if (!kw) {
                displayItems = renderList(AppState.currentItems);
                const pendingRecentAttachments = getPendingRecentAttachments(
                    listRecentAttachments({ includeDeleted: true }),
                    3
                );
                if (pendingRecentAttachments.length > 0 && AppState.mode !== 'cleanup') {
                    displayItems.unshift(...pendingRecentAttachments.map((attachment) => ({
                        title: `待处理附件：${attachment.kind === 'markdown' ? '文件' : '图片'} ${attachment.displayName || attachment.name || attachment.objectKey}`,
                        description: formatRecentAttachmentDescription(attachment),
                        action: 'open_recent_attachment',
                        data: attachment
                    })));
                }
                const rememberedWebSource = AppState.mode === 'add' ? getRememberedWebSource() : null;
                if (rememberedWebSource?.url) {
                    displayItems.unshift({
                        title: '当前摘录来源',
                        description: formatRememberedWebSourceDescription(rememberedWebSource),
                        action: 'remembered_source_clear'
                    });
                }
            } else {
                const filtered = AppState.currentItems.filter((item) => (stripHtml(item.name) || '').toLowerCase().includes(kw));
                displayItems = renderList(filtered);
            }

            if (AppState.mode === 'view' && kw) {
                displayItems.push(buildSearchCreateItem({
                    keyword: currentInputText,
                    resultCount: displayItems.length
                }));
            }

            if (displayItems.length === 0 && !kw) {
                displayItems.push({ title: '（空节点）', description: '输入内容以创建新节点', type: 'info' });
            }

            if (AppState.mode === 'cleanup') {
                displayItems.unshift(buildCleanupStatusItem({
                    remainingCount: AppState.currentItems.length,
                    feedback: AppState.cleanupFeedback
                }));
            }

            AppState.callbackSetList([
                ...buildStagedLinkStatusItems(),
                ...pendingUploadHost.buildUploadStatusItems({ currentInputText }),
                ...(AppState.loadNotice
                    ? [{
                        title: '⚠️ 列表载入失败',
                        description: AppState.loadNotice,
                        type: 'info'
                    }]
                    : []),
                ...(pendingCaptureHost?.buildPendingCaptureItems?.({ limit: 3 }) || []),
                ...displayItems
            ]);
        };

        const onSubInput = ({ text }) => {
            const incoming = String(text == null ? '' : text);

            // uTools auto-fills the clipboard into the sub-input on its own,
            // right after setSubInput. Staging the link is only half the job:
            // that auto-fill still arrives here, and if it is recorded the note
            // the user types lands *after* the URL, so buildCaptureChildren
            // merges both into one web-clip node and the note can never be
            // captured on its own. Swallow the echo and empty the box.
            if (isStagedWebLinkEcho(incoming, AppState.stagedWebLink)) {
                syncInputText('');
                runtimeWindow.ztools?.setSubInputValue?.('');
                pendingUploadHost.updatePendingCaptureText('');
                renderCurrentList();
                return;
            }

            syncInputText(incoming);
            pendingUploadHost.updatePendingCaptureText(currentInputText);
            renderCurrentList();
        };
        runtimeWindow.ztools?.setSubInput(onSubInput, placeholder);

        // A payload that opened the input for review (for example a link plus
        // the user's own text) lives in AppState.inputText. Write it into the
        // visible sub-input so what is shown and what Enter submits cannot
        // diverge.
        // ZTools 会保留上次的 cached.subInputValue，进入时若不同步就会显示旧文本。
        runtimeWindow.ztools?.setSubInputValue?.(currentInputText || '');

        const clearSubInput = () => {
            syncInputText('');
            pendingUploadHost.updatePendingCaptureText('');
            // ZTools 不自动清空缓存值，必须先写空值，否则旧文本会残留在输入框里
            runtimeWindow.ztools?.setSubInputValue?.('');
            // Third setSubInput argument is isFocus, not a default value.
            // Passing a falsy value here left the sub-input blurred, so the
            // next keystroke went nowhere in browse mode.
            runtimeWindow.ztools?.setSubInput(onSubInput, placeholder, true);
            renderCurrentList();
        };

        const handlePaste = async (e) => {
            const clipboardItems = Array.from(e?.clipboardData?.items || []);
            const hasImageItem = clipboardItems.some((item) => /^image\//i.test(String(item?.type || '')));
            const hasClipboardItems = !!(e?.clipboardData?.items && clipboardItems.length > 0);
            const hasText = !!trimString(e?.clipboardData?.getData?.('text/plain'));
            let hasExplicitFilePayload = false;

            if (hasImageItem) {
                e.preventDefault();
                const imagePayload = await extractImageFromPasteEvent(e);
                if (imagePayload) {
                    await pendingUploadHost.uploadPendingImage(imagePayload, renderCurrentList, {
                        getCaptureText: () => currentInputText
                    });
                } else if (!await pendingUploadHost.uploadClipboardImageFallback({ currentInputText, renderCurrentList })) {
                    runtimeWindow.ztools?.showNotification('未读取到有效图片数据');
                }
                return;
            }

            const markdownPayload = await extractMarkdownFileFromPasteEvent(e);
            if (markdownPayload) {
                e.preventDefault();
                await pendingUploadHost.uploadPendingMarkdown(markdownPayload, renderCurrentList, {
                    getCaptureText: () => currentInputText
                });
                return;
            }

            const clipboardMarkdownPayload = readMarkdownFileFromUtoolsClipboard(runtimeWindow.ztools);
            if (clipboardMarkdownPayload) {
                hasExplicitFilePayload = true;
                e.preventDefault();
                await pendingUploadHost.uploadPendingMarkdown(clipboardMarkdownPayload, renderCurrentList, {
                    getCaptureText: () => currentInputText
                });
                return;
            }

            const clipboardImageFilePayload = readImageFileFromUtoolsClipboard(runtimeWindow.ztools);
            if (clipboardImageFilePayload) {
                hasExplicitFilePayload = true;
                e.preventDefault();
                await pendingUploadHost.uploadPendingImage(clipboardImageFilePayload, renderCurrentList, {
                    getCaptureText: () => currentInputText
                });
                return;
            }

            if (shouldStageClipboardImageFallback({
                hasImageItem,
                hasClipboardItems,
                hasText,
                hasExplicitFilePayload
            })) {
                if (await pendingUploadHost.uploadClipboardImageFallback({ currentInputText, renderCurrentList, stageOnly: true })) {
                    e.preventDefault();
                }
            }
        };

        const savePendingCreate = async (e) => {
            const pendingText = currentInputText.trim();
            const hasPendingUpload = !!AppState.pendingUpload;
            // Enter with only a staged clipboard link is still a capture: pass
            // the URL through so createNode takes its link-only branch instead
            // of the submission doing nothing.
            const stagedLinkText = AppState.mode === 'add' && !pendingText && !hasPendingUpload
                ? String(AppState.stagedWebLink?.url || '').trim()
                : '';
            const submitText = pendingText || stagedLinkText;
            const shouldCreate =
                (AppState.mode === 'add' && (submitText || hasPendingUpload))
                || (AppState.mode === 'view' && hasPendingUpload)
                || (AppState.mode === 'cleanup' && hasPendingUpload);

            if (!shouldCreate) return false;
            if (composeHost?.isComposeOpen?.()) {
                e?.preventDefault?.();
                runtimeWindow.ztools?.showNotification('长文本编辑窗口已打开，请在编辑窗口中发送');
                return true;
            }
            if (AppState.uploadState.status === 'uploading') {
                e?.preventDefault?.();
                const meta = pendingUploadHost.getUploadKindMeta(AppState.pendingUpload?.kind || AppState.uploadState.kind || 'image');
                runtimeWindow.ztools?.showNotification(`${meta.label}上传中，请稍候`);
                return true;
            }
            if (AppState.createState.status === 'creating') {
                e?.preventDefault?.();
                runtimeWindow.ztools?.showNotification('正在创建，请稍候');
                return true;
            }

            e?.preventDefault?.();
            try {
                if (createNode) await createNode(submitText);
                clearSubInput();
                if (exitAfterSubmit) {
                    AppState.exitAfterSubmit = false;
                    runtimeWindow.ztools?.hideMainWindow();
                    runtimeWindow.ztools?.outPlugin();
                }
            } catch (error) {
                AppState.createState = {
                    status: 'failed',
                    error: error?.message || '创建失败'
                };
                AppState.uploadState = {
                    ...AppState.uploadState,
                    cancelArmed: false
                };
                renderCurrentList();
                const queuedHint = AppState.pendingUpload ? '' : '；已保存为待发送消息';
                runtimeWindow.ztools?.showNotification(`发送失败: ${AppState.createState.error}${queuedHint}`);
            }
            return true;
        };

        AppState.inputActions = pendingUploadHost.createInputActions({
            savePendingCreate,
            clearSubInput,
            renderCurrentList,
            getCaptureText: () => currentInputText,
            exitAfterSubmit
        });
        AppState.inputActions.setInputText = (text) => {
            syncInputText(text);
            pendingUploadHost.updatePendingCaptureText(currentInputText);
            runtimeWindow.ztools?.setSubInputValue?.(currentInputText);
            runtimeWindow.ztools?.subInputFocus?.();
            renderCurrentList();
        };

        const handleKeydown = async (e) => {
            const isPasteShortcut = String(e.key || '').toLowerCase() === 'v'
                && (e.metaKey || e.ctrlKey)
                && !e.altKey;
            if (isPasteShortcut) {
                setTimeout(() => {
                    if (AppState.uploadState.status !== 'idle' || AppState.pendingUpload) return;
                    if (trimString(currentInputText)) return;
                    void pendingUploadHost.uploadClipboardImageFallback({ currentInputText, renderCurrentList, stageOnly: true });
                }, 0);
            }

            const isComposeShortcut = String(e.key || '') === 'Enter'
                && (e.ctrlKey || e.metaKey)
                && !e.altKey
                && !e.shiftKey
                && !e.isComposing;
            if (isComposeShortcut) {
                e.preventDefault();
                composeHost?.openComposeWindow?.({ text: currentInputText });
                return;
            }

            if (e.key === 'Escape') {
                e.preventDefault();
                if (currentInputText) {
                    clearSubInput();
                    return;
                }
                if (AppState.uploadState.status === 'uploading') {
                    const meta = pendingUploadHost.getUploadKindMeta(AppState.pendingUpload?.kind || AppState.uploadState.kind || 'image');
                    AppState.uploadState.abortController?.abort();
                    AppState.uploadState = {
                        status: 'idle',
                        kind: null,
                        error: null,
                        cancelArmed: false,
                        abortController: null
                    };
                    renderCurrentList();
                    runtimeWindow.ztools?.showNotification(meta.cancelNotice);
                    return;
                }
                if (AppState.pendingUpload) {
                    const meta = pendingUploadHost.getUploadKindMeta(AppState.pendingUpload.kind);
                    if (!AppState.uploadState.cancelArmed) {
                        AppState.uploadState = {
                            ...AppState.uploadState,
                            cancelArmed: true
                        };
                        renderCurrentList();
                        runtimeWindow.ztools?.showNotification(meta.deletePrompt);
                        return;
                    }

                    await AppState.inputActions?.deletePendingUpload?.();
                    return;
                }
                if (AppState.navigationStack.length > 1) {
                    AppState.navigationStack.pop();
                    const parent = AppState.navigationStack.pop();
                    if (navigateTo) navigateTo(parent.id, parent.name);
                } else {
                    runtimeWindow.ztools?.hideMainWindow();
                    runtimeWindow.ztools?.outPlugin();
                }
                return;
            }

            if (e.key === 'Enter') {
                if (composeHost?.isComposeOpen?.()) {
                    e.preventDefault();
                    runtimeWindow.ztools?.showNotification('长文本编辑窗口已打开，请在编辑窗口中发送');
                    return;
                }
                await savePendingCreate(e);
            }
        };

        EventManager.add(runtimeDocument, 'paste', handlePaste);
        EventManager.add(runtimeDocument, 'keydown', handleKeydown);
        setPreviewDeleteRefreshHandler(() => renderCurrentList());
        consumePreviewDeleteNotification();
        renderCurrentList();

        if (AppState.queuedUploadPayload) {
            void AppState.inputActions.uploadQueuedPayload?.();
        }

        if (isAddMode) composeHost?.prepareComposeWindow?.();

        return AppState.inputActions;
    };

    return {
        setupInputAndKeyboard
    };
}

module.exports = {
    createInputShellHostBridge
};
