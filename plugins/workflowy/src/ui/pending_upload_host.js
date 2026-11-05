function createPendingUploadHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const {
        getSettings
    } = deps.settings || require('../core/settings');
    const {
        upsertRecentAttachment,
        updateRecentAttachment,
        removeRecentAttachment,
        markRecentAttachmentSaved
    } = deps.recentAttachments || require('../core/recent_attachments');
    const {
        clearRememberedWebSource
    } = deps.webCapture || require('../core/web_capture');
    const {
        isOssConfigured,
        getMissingOssFields,
        uploadBufferToOss,
        deleteObjectFromOss
    } = deps.oss || require('../api/oss');
    const {
        readImageFromElectronClipboard,
        readImageFileFromUtoolsClipboard,
        prepareImageForUpload
    } = deps.image || require('../utils/image');
    const {
        prepareMarkdownFileForUpload
    } = deps.markdownFile || require('../utils/markdown_file');
    const {
        buildPendingUploadRecord
    } = deps.attachments || require('../utils/attachments');
    const {
        resolveMarkdownAttachmentUrls,
        createMarkdownStandaloneViewerUploadPayload
    } = deps.markdownViewer || require('../utils/markdown_viewer');
    const runtimeWindow = deps.window || globalThis.window;
    const openPreviewWindow = deps.openPreviewWindow || (() => {});

    const getUploadKindMeta = (kind) => {
        if (kind === 'markdown') {
            return {
                label: 'Markdown 文件',
                uploadingTitle: '📤 正在上传 Markdown...',
                uploadedTitle: '📄 已上传待保存 Markdown',
                failedTitle: '⚠️ Markdown 上传失败',
                uploadSuccess: 'Markdown 已上传，请选择“保存到 Workflowy”或按 Enter 保存',
                uploadError: 'Markdown 上传失败',
                pendingConflict: '已有待保存文件，请先按 Enter 提交或按 Esc 取消',
                cancelNotice: '已取消 Markdown 上传',
                deletePrompt: '再次按 Esc 删除已上传文件',
                deleteSuccess: '已删除待保存文件'
            };
        }

        return {
            label: '图片',
            uploadingTitle: '📤 正在上传图片...',
            uploadedTitle: '🖼️ 已上传待保存图片',
            failedTitle: '⚠️ 图片上传失败',
            uploadSuccess: '图片已上传，请选择“保存到 Workflowy”或按 Enter 保存',
            uploadError: '图片上传失败',
            pendingConflict: '已有待保存图片，请先按 Enter 提交或按 Esc 取消',
            cancelNotice: '已取消图片上传',
            deletePrompt: '再次按 Esc 删除已上传图片',
            deleteSuccess: '已删除待保存图片'
        };
    };

    const prepareUploadPayload = (payload) => {
        if (payload?.kind === 'markdown') return prepareMarkdownFileForUpload(payload);
        return prepareImageForUpload(payload);
    };

    const uploadPendingPayload = async (payload, renderCurrentList, options = {}) => {
        if (!payload) return false;

        const settings = getSettings();
        const meta = getUploadKindMeta(payload.kind);
        if (!settings.ossEnabled) {
            runtimeWindow.ztools?.showNotification('请先在 wfs -> OSS 上传设置中启用 OSS 上传');
            return false;
        }
        if (!isOssConfigured(settings)) {
            runtimeWindow.ztools?.showNotification(`OSS 配置不完整：${getMissingOssFields(settings).join(' / ')}`);
            return false;
        }
        if (AppState.uploadState.status === 'uploading') {
            runtimeWindow.ztools?.showNotification(`${meta.label}上传中，请稍候`);
            return false;
        }
        if (AppState.pendingUpload) {
            runtimeWindow.ztools?.showNotification(getUploadKindMeta(AppState.pendingUpload.kind).pendingConflict);
            return false;
        }

        const abortController = typeof AbortController === 'function' ? new AbortController() : null;
        AppState.uploadState = {
            status: 'uploading',
            kind: payload.kind || 'image',
            error: null,
            cancelArmed: false,
            abortController
        };
        renderCurrentList?.();

        try {
            const prepared = await prepareUploadPayload(payload);
            const uploaded = await uploadBufferToOss(settings, prepared, {
                signal: abortController?.signal
            });
            const attachmentUrls = payload.kind === 'markdown'
                ? resolveMarkdownAttachmentUrls(settings, uploaded.objectKey)
                : {
                    rawUrl: uploaded.url,
                    viewerUrl: '',
                    noteUrl: uploaded.url
                };

            if (payload.kind === 'markdown' && settings.ossMarkdownViewerEnabled) {
                const viewerPayload = createMarkdownStandaloneViewerUploadPayload({
                    markdownObjectKey: uploaded.objectKey,
                    markdownText: prepared.buffer.toString('utf8'),
                    rawUrl: attachmentUrls.rawUrl,
                    displayName: prepared.displayName || payload.displayName || payload.name || 'untitled.md'
                });
                await uploadBufferToOss(settings, viewerPayload, {
                    signal: abortController?.signal
                });
            }

            AppState.pendingUpload = buildPendingUploadRecord({
                uploaded: {
                    ...uploaded,
                    url: attachmentUrls.noteUrl,
                    rawUrl: attachmentUrls.rawUrl,
                    viewerUrl: attachmentUrls.viewerUrl
                },
                prepared,
                payload,
                context: {
                    targetParentId: AppState.currentItemId,
                    targetParentName: AppState.navigationStack[AppState.navigationStack.length - 1]?.name || '',
                    sourceMode: AppState.mode || 'add',
                    captureText: typeof options.getCaptureText === 'function' ? options.getCaptureText() : '',
                    status: 'uploaded',
                    rawUrl: attachmentUrls.rawUrl,
                    viewerUrl: attachmentUrls.viewerUrl
                }
            });
            upsertRecentAttachment(AppState.pendingUpload);
            AppState.uploadState = {
                status: 'uploaded',
                kind: payload.kind || 'image',
                error: null,
                cancelArmed: false,
                abortController: null
            };
            renderCurrentList?.();
            runtimeWindow.ztools?.showNotification(meta.uploadSuccess);
            return true;
        } catch (error) {
            if (error?.name === 'AbortError') {
                AppState.uploadState = {
                    status: 'idle',
                    kind: null,
                    error: null,
                    cancelArmed: false,
                    abortController: null
                };
                renderCurrentList?.();
                return false;
            }

            AppState.uploadState = {
                status: 'failed',
                kind: payload.kind || 'image',
                error: error?.message || meta.uploadError,
                cancelArmed: false,
                abortController: null
            };
            renderCurrentList?.();
            runtimeWindow.ztools?.showNotification(AppState.uploadState.error);
            return false;
        }
    };

    const uploadPendingImage = async (imagePayload, renderCurrentList, options = {}) => {
        if (!imagePayload) return false;
        return uploadPendingPayload({
            ...imagePayload,
            kind: 'image'
        }, renderCurrentList, options);
    };

    const uploadPendingMarkdown = async (markdownPayload, renderCurrentList, options = {}) => {
        if (!markdownPayload) return false;
        return uploadPendingPayload({
            ...markdownPayload,
            kind: 'markdown'
        }, renderCurrentList, options);
    };

    const buildUploadStatusItems = ({ currentInputText = '' } = {}) => {
        const pendingKind = AppState.pendingUpload?.kind || AppState.uploadState.kind || 'image';
        const meta = getUploadKindMeta(pendingKind);

        if (AppState.createState.status === 'creating') {
            return [{
                title: '正在创建 Workflowy 节点...',
                description: '请勿重复按 Enter，完成后会自动刷新',
                type: 'info'
            }];
        }

        if (AppState.uploadState.status === 'uploading') {
            return [{
                title: meta.uploadingTitle,
                description: '上传完成后再选择保存、复制或删除；正在上传时不会重复创建',
                type: 'info'
            }];
        }

        if (AppState.queuedUploadPayload) {
            const queuedMeta = getUploadKindMeta(AppState.queuedUploadPayload.kind || 'image');
            return [{
                title: `检测到待上传${queuedMeta.label}`,
                description: '为避免误传旧剪贴板内容，请选择此项确认上传',
                action: 'pending_upload_start'
            }];
        }

        if (AppState.pendingUpload) {
            const isMarkdown = pendingKind === 'markdown';
            const saveDescription = isMarkdown
                ? '创建文件节点，备注写入 Markdown 链接'
                : (currentInputText.trim()
                    ? `使用标题“${currentInputText.trim()}”创建图片节点`
                    : '未填写标题时自动生成图片标题');
            const clearTextItem = currentInputText.trim()
                ? [{
                    title: '继续编辑 / 清空标题',
                    description: '清空当前输入，附件继续保留待保存',
                    action: 'pending_upload_clear_text'
                }]
                : [];
            return [
                {
                    title: meta.uploadedTitle,
                    description: AppState.uploadState.cancelArmed
                        ? `${meta.deletePrompt}，也可选择下方删除 OSS 对象`
                        : '请选择下一步；Enter 也会执行保存',
                    type: 'info'
                },
                {
                    title: '保存到 Workflowy',
                    description: saveDescription,
                    action: 'pending_upload_save'
                },
                {
                    title: '复制链接',
                    description: '只复制 OSS 链接，不创建 Workflowy 节点；执行后会清空待保存状态',
                    action: 'pending_upload_copy_link'
                },
                {
                    title: '预览附件',
                    description: '在插件内弹窗预览，确认内容后再决定下一步',
                    action: 'pending_upload_preview'
                },
                {
                    title: '删除 OSS 对象',
                    description: '删除已上传文件并清除待保存状态',
                    action: 'pending_upload_delete'
                },
                ...clearTextItem
            ];
        }

        if (AppState.uploadState.status === 'failed') {
            return [{
                title: meta.failedTitle,
                description: AppState.uploadState.error || '请重试或按 Esc 取消',
                type: 'info'
            }];
        }

        return [];
    };

    const updatePendingCaptureText = (text) => {
        if (AppState.pendingUpload?.id) {
            AppState.pendingUpload = {
                ...AppState.pendingUpload,
                captureText: text
            };
            updateRecentAttachment(AppState.pendingUpload.id, { captureText: text });
        }
        if (AppState.uploadState.cancelArmed) {
            AppState.uploadState = {
                ...AppState.uploadState,
                cancelArmed: false
            };
        }
    };

    const deletePendingUpload = async (renderCurrentList) => {
        if (!AppState.pendingUpload) return false;
        const meta = getUploadKindMeta(AppState.pendingUpload.kind);
        try {
            await deleteObjectFromOss(getSettings(), AppState.pendingUpload.objectKey);
            removeRecentAttachment(AppState.pendingUpload.id);
            AppState.resetUploadState();
            renderCurrentList?.();
            runtimeWindow.ztools?.showNotification(meta.deleteSuccess);
            return true;
        } catch (error) {
            AppState.uploadState = {
                ...AppState.uploadState,
                status: 'uploaded',
                error: error?.message || '删除失败',
                cancelArmed: false,
                abortController: null
            };
            renderCurrentList?.();
            runtimeWindow.ztools?.showNotification(`删除失败: ${AppState.uploadState.error}`);
            return false;
        }
    };

    const uploadClipboardImageFallback = async ({ currentInputText = '', renderCurrentList, stageOnly = false } = {}) => {
        if (stageOnly && currentInputText.trim()) return false;

        const imagePayload = readImageFromElectronClipboard()
            || readImageFileFromUtoolsClipboard(runtimeWindow.ztools);
        if (!imagePayload) return false;

        if (stageOnly) {
            AppState.queuedUploadPayload = {
                ...imagePayload,
                kind: 'image'
            };
            renderCurrentList?.();
            runtimeWindow.ztools?.showNotification('检测到剪贴板图片，请选择列表中的上传项后继续');
            return true;
        }

        await uploadPendingImage(imagePayload, renderCurrentList, {
            getCaptureText: () => currentInputText
        });
        return true;
    };

    const uploadQueuedPayload = async (renderCurrentList, options = {}) => {
        const queuedUploadPayload = AppState.queuedUploadPayload;
        if (!queuedUploadPayload) return false;
        AppState.queuedUploadPayload = null;
        if (queuedUploadPayload.kind === 'markdown') {
            return uploadPendingMarkdown(queuedUploadPayload, renderCurrentList, options);
        }
        return uploadPendingImage(queuedUploadPayload, renderCurrentList, options);
    };

    const copyPendingUploadLink = async ({ clearSubInput, exitAfterSubmit = false } = {}) => {
        const pending = AppState.pendingUpload;
        if (!pending?.url) {
            runtimeWindow.ztools?.showNotification('没有可复制的附件链接');
            return false;
        }
        runtimeWindow.ztools?.copyText(pending.url);
        markRecentAttachmentSaved(pending.id, {
            captureText: '',
            workflowyNodeId: ''
        });
        AppState.resetUploadState();
        clearSubInput?.();
        runtimeWindow.ztools?.showNotification('已复制附件链接，未创建 Workflowy 节点');
        if (exitAfterSubmit && AppState.mode === 'add') {
            AppState.exitAfterSubmit = false;
            runtimeWindow.ztools?.hideMainWindow();
            runtimeWindow.ztools?.outPlugin();
        }
        return true;
    };

    const createInputActions = ({
        savePendingCreate,
        clearSubInput,
        renderCurrentList,
        getCaptureText,
        exitAfterSubmit = false
    }) => ({
        savePendingCreate,
        deletePendingUpload: async () => deletePendingUpload(renderCurrentList),
        clearSubInput,
        uploadQueuedPayload: async () => uploadQueuedPayload(renderCurrentList, { getCaptureText }),
        renderCurrentList,
        copyPendingUploadLink: async () => copyPendingUploadLink({ clearSubInput, exitAfterSubmit })
    });

    const handlePendingUploadAction = async (action, actions = {}) => {
        if (!actions) return false;

        switch (action) {
            case 'pending_upload_start':
                return actions.uploadQueuedPayload?.() || false;
            case 'pending_upload_save':
                return actions.savePendingCreate?.() || false;
            case 'pending_upload_copy_link':
                return actions.copyPendingUploadLink?.() || false;
            case 'pending_upload_preview':
                if (AppState.pendingUpload?.rawUrl || AppState.pendingUpload?.url) {
                    openPreviewWindow(
                        AppState.pendingUpload.rawUrl || AppState.pendingUpload.url,
                        AppState.pendingUpload.displayName || AppState.pendingUpload.name || '附件预览',
                        AppState.pendingUpload.kind || 'image',
                        {
                            objectKey: AppState.pendingUpload.objectKey,
                            attachmentId: AppState.pendingUpload.id
                        }
                    );
                } else {
                    runtimeWindow.ztools?.showNotification('没有可预览的附件链接');
                }
                return true;
            case 'pending_upload_delete':
                return actions.deletePendingUpload?.() || false;
            case 'pending_upload_clear_text':
                actions.clearSubInput?.();
                return true;
            case 'remembered_source_clear':
                clearRememberedWebSource();
                runtimeWindow.ztools?.showNotification('已清除记住的摘录来源');
                actions.renderCurrentList?.();
                return true;
            default:
                return false;
        }
    };

    return {
        getUploadKindMeta,
        uploadPendingImage,
        uploadPendingMarkdown,
        buildUploadStatusItems,
        updatePendingCaptureText,
        deletePendingUpload,
        uploadClipboardImageFallback,
        createInputActions,
        handlePendingUploadAction
    };
}

module.exports = {
    createPendingUploadHostBridge
};
