const {
    COMPOSE_DRAFT_KEY,
    COMPOSE_CHANNELS,
    buildComposeWindowUrl,
    normalizeComposeText
} = require('./compose_window_host');

function createComposeHostBridge(deps = {}) {
    const { AppState } = deps.state || require('../core/state');
    const { normalizeParentId } = deps.helpers || require('../utils/helpers');
    const { setStorageItem, removeStorageItem } = deps.storage || require('../core/storage');
    const runtimeWindow = deps.window || globalThis.window;

    const getCreateNode = deps.getCreateNode || (() => null);
    const getTargetContext = deps.getTargetContext || (() => ({}));
    const notify = deps.notify || ((message) => runtimeWindow.ztools?.showNotification?.(message));

    const schedule = deps.schedule || ((fn, delay) => setTimeout(fn, delay));
    const PREWARM_DELAY_MS = 120;

    let composeWindow = null;
    let composeId = '';
    let sessionText = '';
    let activeTarget = null;
    let submitting = false;
    let standalone = false;
    let shellWindow = null;
    let shellReady = false;
    let shellDocumentId = '';
    let prepareToken = 0;
    let preparePending = false;
    let revealTimer = null;

    const resetSession = () => {
        composeWindow = null;
        composeId = '';
        sessionText = '';
        activeTarget = null;
        submitting = false;
        standalone = false;
    };

    const forgetShell = () => {
        shellWindow = null;
        shellReady = false;
        shellDocumentId = '';
    };

    const liveShell = () => {
        if (!shellWindow) return null;
        try {
            if (typeof shellWindow.isDestroyed === 'function' && shellWindow.isDestroyed()) {
                forgetShell();
                return null;
            }
        } catch (error) {
            forgetShell();
            return null;
        }
        return shellWindow;
    };

    const isComposeOpen = () => {
        if (!composeWindow) return false;
        if (composeWindow !== liveShell()) {
            resetSession();
            return false;
        }
        return true;
    };

    const clearRevealTimer = () => {
        if (revealTimer == null) return;
        clearTimeout(revealTimer);
        revealTimer = null;
    };

    const revealShell = () => {
        const win = liveShell();
        if (!win || !composeId || composeWindow !== win) return;
        if (typeof win.isVisible === 'function' && win.isVisible()) return;
        clearRevealTimer();
        try {
            win.show?.();
            win.focus?.();
            win.setAlwaysOnTop?.(true);
        } catch (error) {
            console.error('Failed to focus compose window:', error);
        }
    };

    const expectReveal = () => {
        clearRevealTimer();
        const expectedId = composeId;
        revealTimer = schedule(() => {
            revealTimer = null;
            if (composeId !== expectedId || !isComposeOpen()) return;
            revealShell();
        }, 300);
    };

    const pushSession = (win) => {
        try {
            win.webContents?.send?.(COMPOSE_CHANNELS.session, {
                id: composeId,
                text: sessionText,
                standalone
            });
            expectReveal();
        } catch (error) {
            console.error('Failed to push compose session:', error);
            revealShell();
        }
    };

    const onShellLoaded = (win) => {
        if (!win || shellWindow !== win || shellReady) return;
        shellReady = true;
        if (!composeId || composeWindow !== win) return;
        if (shellDocumentId === composeId) {
            revealShell();
            return;
        }
        pushSession(win);
    };

    const windowOptions = () => ({
        width: 760,
        height: 560,
        minWidth: 520,
        minHeight: 360,
        title: 'Workflowy 长文本',
        show: false,
        alwaysOnTop: true,
        resizable: true,
        skipTaskbar: true,
        autoHideMenuBar: true,
        backgroundColor: runtimeWindow.ztools?.isDarkColors?.() ? '#171920' : '#f4f6fa',
        webPreferences: {
            preload: 'compose_preload.js',
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false
        }
    });

    const createShell = (url, documentId) => {
        let openedWindow = null;
        let loadedEarly = false;
        try {
            openedWindow = runtimeWindow.ztools?.createBrowserWindow(
                url,
                windowOptions(),
                () => {
                    if (!openedWindow) {
                        loadedEarly = true;
                        return;
                    }
                    onShellLoaded(openedWindow);
                }
            );
        } catch (error) {
            return { error };
        }
        if (!openedWindow) return { error: new Error('无法打开长文本编辑窗口') };
        shellWindow = openedWindow;
        shellDocumentId = documentId || '';
        shellReady = false;
        if (loadedEarly) onShellLoaded(openedWindow);
        return { window: openedWindow };
    };

    const releaseComposeWindow = ({ destroy }) => {
        const win = liveShell();
        clearRevealTimer();
        resetSession();
        if (!win) return;
        if (!destroy && typeof win.hide === 'function') {
            try {
                win.hide();
                return;
            } catch (error) {
                console.error('Failed to hide compose window:', error);
            }
        }
        forgetShell();
        try {
            if (!(typeof win.isDestroyed === 'function' && win.isDestroyed())) {
                win.close?.();
            }
        } catch (error) {
            console.error('Failed to close compose window:', error);
        }
    };

    const parkComposeWindow = () => releaseComposeWindow({ destroy: false });

    const closeComposeWindow = () => releaseComposeWindow({ destroy: true });

    const showPreparedComposeWindow = (payload = {}) => {
        if (!composeId || String(payload?.id || '') !== composeId) return false;
        if (!liveShell() || composeWindow !== shellWindow) return false;
        revealShell();
        return true;
    };

    const prepareComposeWindow = ({ immediate = false } = {}) => {
        if (liveShell() || preparePending) return;
        preparePending = true;
        const token = ++prepareToken;
        const warm = () => {
            preparePending = false;
            if (token !== prepareToken) return;
            if (liveShell() || composeWindow) return;
            const created = createShell('compose.html', '');
            if (created.error) {
                console.error('Failed to prewarm compose window:', created.error);
            }
        };
        if (immediate) {
            warm();
            return;
        }
        schedule(warm, PREWARM_DELAY_MS);
    };

    const sendResult = (result) => {
        try {
            composeWindow?.webContents?.send?.(COMPOSE_CHANNELS.result, {
                id: composeId,
                ...result
            });
        } catch (error) {
            console.error('Failed to send compose result:', error);
        }
    };

    const rejectOpen = () => {
        if (AppState.mode !== 'add') {
            notify('长文本编辑仅在 wf 新建时可用');
            return true;
        }
        if (AppState.pendingUpload) {
            notify('请先处理待保存附件，再打开长文本编辑');
            return true;
        }
        if (AppState.createState?.status === 'creating') {
            notify('正在创建，请稍候');
            return true;
        }
        return false;
    };

    const openComposeWindow = (options = {}) => {
        const opts = options || {};
        const {
            text = '',
            parentId: explicitParentId,
            parentName: explicitParentName,
            standalone: standaloneRequested = false
        } = opts;

        if (rejectOpen()) return null;
        if (isComposeOpen()) {
            try {
                composeWindow.show?.();
                composeWindow.focus?.();
            } catch (error) {
                console.error('Failed to focus existing compose window:', error);
            }
            return composeWindow;
        }

        const context = getTargetContext() || {};
        const id = `compose_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const targetParentId = Object.prototype.hasOwnProperty.call(opts, 'parentId')
            ? explicitParentId
            : context.parentId;
        const targetParentName = Object.prototype.hasOwnProperty.call(opts, 'parentName')
            ? explicitParentName
            : context.parentName;
        const parentId = normalizeParentId(targetParentId);
        const parentName = String(targetParentName || '').trim();
        const mode = context.mode || AppState.mode || 'add';

        activeTarget = { parentId, parentName, mode };
        composeId = id;
        sessionText = normalizeComposeText(text);
        standalone = !!standaloneRequested;
        prepareToken += 1;
        preparePending = false;

        try {
            setStorageItem(COMPOSE_DRAFT_KEY, {
                id,
                text: sessionText,
                parentId,
                parentName,
                standalone,
                createdAt: Date.now()
            });
        } catch (error) {
            resetSession();
            notify(`无法准备长文本编辑：${error?.message || '存储不可用'}`);
            return null;
        }

        // A shell created ahead of this shortcut, or hidden after the previous
        // edit, is already parsed. Push the new draft into it instead of
        // paying for another BrowserWindow. uTools invokes the load callback
        // with no window argument, so the returned handle stays the shell.
        const shell = liveShell();
        if (shell) {
            composeWindow = shell;
            if (shellReady && shellDocumentId !== composeId) pushSession(shell);
            else if (shellReady) revealShell();
            return composeWindow;
        }

        const created = createShell(buildComposeWindowUrl({ id, targetName: parentName }), id);
        if (!created.window) {
            resetSession();
            try {
                removeStorageItem(COMPOSE_DRAFT_KEY);
            } catch (storageError) {
                console.error('Failed to clear compose draft:', storageError);
            }
            notify(`无法打开长文本编辑：${created.error?.message || '未知错误'}`);
            return null;
        }
        composeWindow = created.window;
        if (shellReady && shellDocumentId === composeId) revealShell();
        return composeWindow;
    };

    const handleComposeSubmit = async (payload = {}) => {
        if (!isComposeOpen()) return false;
        if (String(payload?.id || '') !== composeId) return false;
        if (submitting) return true;

        const text = normalizeComposeText(payload?.text);
        if (!text.trim()) {
            sendResult({ ok: false, error: '内容为空，未发送' });
            return true;
        }
        if (AppState.createState?.status === 'creating') {
            sendResult({ ok: false, error: '正在创建，请稍候' });
            return true;
        }
        // A staged clipboard link is not a blocker: createNode owns the
        // staged-link branch that creates the link node and hangs the note
        // under it. Only an attachment that still needs upload and an
        // in-flight create make the submitted text unaccountable.
        if (AppState.pendingUpload) {
            sendResult({ ok: false, error: '主窗口存在待处理附件，请先处理后再发送' });
            return true;
        }

        const target = activeTarget || {};
        const createNode = getCreateNode();
        if (typeof createNode !== 'function') {
            sendResult({ ok: false, error: '发送通道未就绪，请关闭后重新打开 wf' });
            return true;
        }

        submitting = true;
        try {
            await createNode(text, {
                parentId: target.parentId,
                parentName: target.parentName,
                mode: target.mode || 'add'
            });

            const wasStandalone = standalone;
            const exitAfterSubmit = wasStandalone
                || (AppState.exitAfterSubmit && (target.mode || 'add') === 'add');
            sendResult({ ok: true });
            try {
                removeStorageItem(COMPOSE_DRAFT_KEY);
            } catch (storageError) {
                console.error('Failed to clear compose draft:', storageError);
            }

            AppState.inputActions?.clearSubInput?.();
            parkComposeWindow();

            if (exitAfterSubmit) {
                AppState.exitAfterSubmit = false;
                runtimeWindow.ztools?.hideMainWindow?.();
                runtimeWindow.ztools?.outPlugin?.();
            }
            return true;
        } catch (error) {
            sendResult({ ok: false, error: error?.message || '发送失败' });
            return false;
        } finally {
            submitting = false;
        }
    };

    const handleComposeCancel = (payload = {}) => {
        if (!isComposeOpen()) return false;
        if (String(payload?.id || '') !== composeId) return false;

        const text = normalizeComposeText(payload?.text);
        const wasStandalone = standalone;
        try {
            removeStorageItem(COMPOSE_DRAFT_KEY);
        } catch (storageError) {
            console.error('Failed to clear compose draft:', storageError);
        }

        parkComposeWindow();

        if (wasStandalone) {
            // The standalone entry has no sub-input to return to; cancel
            // simply dismisses the editor and leaves the plugin.
            runtimeWindow.ztools?.hideMainWindow?.();
            runtimeWindow.ztools?.outPlugin?.();
            return true;
        }

        runtimeWindow.ztools?.showMainWindow?.();

        if (typeof AppState.inputActions?.setInputText === 'function') {
            AppState.inputActions.setInputText(text);
        } else {
            AppState.inputText = text;
            try {
                runtimeWindow.ztools?.setSubInputValue?.(text);
            } catch (inputError) {
                console.error('Failed to restore compose text:', inputError);
            }
            AppState.inputActions?.renderCurrentList?.();
        }
        runtimeWindow.ztools?.subInputFocus?.();
        return true;
    };

    return {
        openComposeWindow,
        prepareComposeWindow,
        showPreparedComposeWindow,
        handleComposeSubmit,
        handleComposeCancel,
        isComposeOpen,
        closeComposeWindow
    };
}

module.exports = {
    createComposeHostBridge
};
