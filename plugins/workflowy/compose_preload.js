const { contextBridge, ipcRenderer } = require('electron');
const {
    COMPOSE_CHANNELS,
    readComposeDraft,
    isComposeTextEmpty,
    isComposeSendShortcut,
    isComposeCancelKey,
    buildComposePayload,
    isComposeResultFor
} = require('./src/ui/compose_window_host');

const utoolsApi = globalThis.ztools;
const params = new URLSearchParams(globalThis.location?.search || '');

let composeId = params.get('id') || '';
let sessionText = '';
let standalone = false;
let sessionHandler = null;

try {
    const draft = readComposeDraft(utoolsApi?.dbStorage, composeId);
    sessionText = draft?.text || '';
    standalone = draft?.standalone === true;
} catch (error) {
    console.error('Failed to read compose draft:', error);
}

const publishSession = (next, ack) => {
    composeId = String(next?.id || '');
    sessionText = next?.text == null ? '' : String(next.text);
    standalone = next?.standalone === true;
    const session = { id: composeId, text: sessionText, standalone };
    if (typeof sessionHandler === 'function') sessionHandler(session);
    if (ack && typeof utoolsApi?.sendToParent === 'function') {
        utoolsApi.sendToParent(COMPOSE_CHANNELS.ready, { id: composeId });
    }
};

ipcRenderer.on(COMPOSE_CHANNELS.session, (_event, next) => {
    publishSession(next, true);
});

const shortcutFields = (event = {}) => ({
    key: event.key,
    ctrlKey: !!event.ctrlKey,
    metaKey: !!event.metaKey,
    altKey: !!event.altKey,
    shiftKey: !!event.shiftKey,
    isComposing: !!event.isComposing,
    keyCode: event.keyCode
});

const composeBridge = {
    get id() {
        return composeId;
    },
    get text() {
        return sessionText;
    },
    get standalone() {
        return standalone;
    },
    canSend: typeof utoolsApi?.sendToParent === 'function',
    isMac: !!(utoolsApi?.isMacOs?.() || /Mac/i.test(globalThis.navigator?.platform || '')),
    isDark() {
        return !!(utoolsApi?.isDarkColors?.()
            ?? globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches);
    },
    isTextEmpty(value) {
        return isComposeTextEmpty(value);
    },
    isSendShortcut(event) {
        return isComposeSendShortcut(shortcutFields(event));
    },
    isCancelKey(event) {
        return isComposeCancelKey(shortcutFields(event));
    },
    submit(text) {
        utoolsApi.sendToParent(
            COMPOSE_CHANNELS.submit,
            buildComposePayload({ id: composeId, text })
        );
    },
    cancel(text) {
        utoolsApi.sendToParent(
            COMPOSE_CHANNELS.cancel,
            buildComposePayload({ id: composeId, text })
        );
    },
    onResult(handler) {
        if (typeof handler !== 'function') return;
        ipcRenderer.on(COMPOSE_CHANNELS.result, (_event, result) => {
            if (!isComposeResultFor(result, composeId)) return;
            handler(result);
        });
    },
    onThemeChange(handler) {
        if (typeof handler !== 'function') return;
        utoolsApi?.onSystemThemeChange?.(() => handler());
    },
    onSession(handler) {
        if (typeof handler !== 'function') return;
        sessionHandler = handler;
        handler({ id: composeId, text: sessionText, standalone });
    }
};

let exposed = false;
try {
    contextBridge.exposeInMainWorld('composeBridge', composeBridge);
    exposed = true;
} catch (error) {
    exposed = false;
}

if (!exposed) {
    globalThis.composeBridge = composeBridge;
}
