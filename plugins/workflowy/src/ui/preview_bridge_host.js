function createPreviewBridgeHostBridge(deps = {}) {
    const { AppState, EventManager } = deps.state || require('../core/state');
    const {
        listRecentAttachments,
        removeRecentAttachment
    } = deps.recentAttachments || require('../core/recent_attachments');
    const {
        getSettings
    } = deps.settings || require('../core/settings');
    const {
        deleteObjectFromOss
    } = deps.oss || require('../api/oss');
    const runtimeWindow = deps.window || globalThis.window;

    const PREVIEW_DELETE_STORAGE_KEY = 'wf_preview_deleted';
    const PREVIEW_DELETE_REQUEST_STORAGE_KEY = 'wf_preview_delete_request';
    const PREVIEW_DELETE_RESULT_STORAGE_KEY = 'wf_preview_delete_result';
    let previewDeleteRefreshHandler = null;
    let previewDeleteListenersInstalled = false;

    const trimString = (value) => String(value || '').trim();

    const getLocalStorage = () => {
        if (typeof localStorage !== 'undefined') return localStorage;
        if (runtimeWindow?.localStorage) return runtimeWindow.localStorage;
        return null;
    };

    const resolvePreviewDeletedAttachmentId = (data = {}) => {
        const attachmentId = trimString(data.attachmentId);
        if (attachmentId) return attachmentId;

        const objectKey = trimString(data.objectKey);
        if (!objectKey) return '';
        const match = listRecentAttachments({ includeDeleted: true })
            .find((item) => item.objectKey === objectKey && item.status !== 'deleted');
        return match?.id || '';
    };

    const writePreviewBridgePayload = (key, payload) => {
        const storage = getLocalStorage();
        if (!storage?.setItem) return false;
        storage.setItem(key, JSON.stringify(payload));
        return true;
    };

    const consumePreviewDeleteNotification = () => {
        const storage = getLocalStorage();
        if (!storage?.getItem) return null;

        const raw = storage.getItem(PREVIEW_DELETE_STORAGE_KEY);
        if (!raw) return null;

        try {
            const data = JSON.parse(raw);
            const attachmentId = resolvePreviewDeletedAttachmentId(data);
            if (!attachmentId) {
                storage.removeItem?.(PREVIEW_DELETE_STORAGE_KEY);
                return null;
            }

            removeRecentAttachment(attachmentId);
            if (AppState.pendingUpload?.id === attachmentId) {
                AppState.resetUploadState();
            }
            storage.removeItem?.(PREVIEW_DELETE_STORAGE_KEY);
            return {
                ...data,
                attachmentId
            };
        } catch (error) {
            storage.removeItem?.(PREVIEW_DELETE_STORAGE_KEY);
            return null;
        }
    };

    const consumePreviewDeleteRequest = () => {
        const storage = getLocalStorage();
        if (!storage?.getItem) return null;

        const raw = storage.getItem(PREVIEW_DELETE_REQUEST_STORAGE_KEY);
        if (!raw) return null;

        try {
            const data = JSON.parse(raw);
            storage.removeItem?.(PREVIEW_DELETE_REQUEST_STORAGE_KEY);
            return data;
        } catch (error) {
            storage.removeItem?.(PREVIEW_DELETE_REQUEST_STORAGE_KEY);
            return null;
        }
    };

    const refreshAfterPreviewDelete = (data) => {
        if (!data) return false;
        if (typeof previewDeleteRefreshHandler === 'function') {
            previewDeleteRefreshHandler(data);
            return true;
        }
        AppState.inputActions?.renderCurrentList?.();
        return true;
    };

    const handlePreviewDeleteNotification = () => refreshAfterPreviewDelete(consumePreviewDeleteNotification());

    const publishPreviewDeleteResult = (payload) => writePreviewBridgePayload(PREVIEW_DELETE_RESULT_STORAGE_KEY, payload);

    const handlePreviewDeleteRequestNotification = async () => {
        const data = consumePreviewDeleteRequest();
        if (!data) return false;

        const requestId = trimString(data.requestId);
        const objectKey = trimString(data.objectKey);
        const attachmentId = resolvePreviewDeletedAttachmentId(data);
        const resultBase = {
            requestId,
            attachmentId,
            objectKey,
            timestamp: Date.now()
        };

        if (!objectKey) {
            publishPreviewDeleteResult({
                ...resultBase,
                ok: false,
                error: 'objectKey 为空'
            });
            return false;
        }

        try {
            await deleteObjectFromOss(getSettings(), objectKey);
            if (attachmentId) {
                removeRecentAttachment(attachmentId);
            }
            if (
                (attachmentId && AppState.pendingUpload?.id === attachmentId)
                || (objectKey && AppState.pendingUpload?.objectKey === objectKey)
            ) {
                AppState.resetUploadState();
            }
            writePreviewBridgePayload(PREVIEW_DELETE_STORAGE_KEY, resultBase);
            publishPreviewDeleteResult({
                ...resultBase,
                ok: true
            });
            refreshAfterPreviewDelete(resultBase);
            return true;
        } catch (error) {
            publishPreviewDeleteResult({
                ...resultBase,
                ok: false,
                error: error?.message || '删除失败'
            });
            return false;
        }
    };

    const installPreviewDeleteNotificationBridge = () => {
        if (previewDeleteListenersInstalled) return;
        if (typeof runtimeWindow?.addEventListener !== 'function') return;

        EventManager.add(runtimeWindow, 'storage', (event) => {
            if (event?.key === PREVIEW_DELETE_REQUEST_STORAGE_KEY) {
                void handlePreviewDeleteRequestNotification();
                return;
            }
            if (event?.key === PREVIEW_DELETE_STORAGE_KEY) {
                handlePreviewDeleteNotification();
            }
        });
        EventManager.add(runtimeWindow, 'focus', () => {
            void handlePreviewDeleteRequestNotification();
            handlePreviewDeleteNotification();
        });
        previewDeleteListenersInstalled = true;
    };

    const setPreviewDeleteRefreshHandler = (handler) => {
        previewDeleteRefreshHandler = typeof handler === 'function' ? handler : null;
        installPreviewDeleteNotificationBridge();
    };

    return {
        consumePreviewDeleteNotification,
        consumePreviewDeleteRequest,
        setPreviewDeleteRefreshHandler
    };
}

module.exports = {
    createPreviewBridgeHostBridge
};
