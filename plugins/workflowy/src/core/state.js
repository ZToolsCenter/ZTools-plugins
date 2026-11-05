const EventManager = {
    handlers: [],
    add(target, type, listener) {
        target.addEventListener(type, listener);
        this.handlers.push({ target, type, listener });
    },
    clear() {
        if (this.handlers.length === 0) return;

        // Batch remove for better performance - group by target
        const targetGroups = new Map();
        for (const h of this.handlers) {
            const key = h.target;
            if (!targetGroups.has(key)) {
                targetGroups.set(key, []);
            }
            targetGroups.get(key).push(h);
        }

        // Remove listeners grouped by target
        for (const [target, group] of targetGroups) {
            for (const h of group) {
                target.removeEventListener(h.type, h.listener);
            }
        }
        this.handlers = [];
    }
};

const ModifierTracker = {
    current: { ctrl: false, alt: false, meta: false, shift: false },
    _boundReset: null,
    init() {
        this._boundReset = () => this.reset();
        EventManager.add(window, 'keydown', (e) => this.update(e, true));
        EventManager.add(window, 'keyup', (e) => this.update(e, false));
        EventManager.add(window, 'blur', this._boundReset);
    },
    update(e, isDown) {
        this.current.ctrl = e.ctrlKey;
        this.current.alt = e.altKey;
        this.current.meta = e.metaKey;
        this.current.shift = e.shiftKey;
    },
    reset() {
        this.current = { ctrl: false, alt: false, meta: false, shift: false };
    },
    isJumpAction() { return window.ztools?.isMacOs() ? this.current.meta : this.current.ctrl; },
    isPinAction() { return this.current.alt; }
};

const createInitialUploadState = () => ({
    status: 'idle',
    kind: null,
    error: null,
    cancelArmed: false,
    abortController: null
});

const createInitialImageUploadState = createInitialUploadState;

const createInitialCreateState = () => ({
    status: 'idle',
    error: null
});

const AppState = {
    mode: null,
    apiKey: '',
    navigationStack: [],
    currentItems: [],
    currentItemId: null,
    activeItem: null,
    callbackSetList: null,
    exitAfterSubmit: false,
    editContext: null,
    queuedUploadPayload: null,
    pendingUpload: null,
    // Live sub-input text. Kept on AppState rather than in a
    // setupInputAndKeyboard closure so that re-running input setup (the
    // stale-while-revalidate node fetch calls it once per callback) does not
    // orphan text the user already typed or that uTools auto-filled.
    inputText: '',
    // One-shot bare clipboard link staged as the parent of the next typed
    // note. Never persisted: it is cleared after a single submission.
    stagedWebLink: null,
    uploadState: createInitialUploadState(),
    createState: createInitialCreateState(),
    cleanupFeedback: '',
    loadNotice: '',
    healthcheckResult: null,
    inputActions: null,

    resetUploadState() {
        this.queuedUploadPayload = null;
        this.pendingUpload = null;
        this.uploadState = createInitialUploadState();
    },

    resetImageState() {
        this.resetUploadState();
    },

    reset() {
        this.mode = null;
        this.navigationStack = [];
        this.currentItems = [];
        this.currentItemId = null;
        this.activeItem = null;
        this.callbackSetList = null;
        this.exitAfterSubmit = false;
        this.editContext = null;
        this.createState = createInitialCreateState();
        this.cleanupFeedback = '';
        this.loadNotice = '';
        this.inputActions = null;
        this.inputText = '';
        this.stagedWebLink = null;
        this.resetUploadState();
        ModifierTracker.reset();
    }
};

module.exports = {
    ModifierTracker,
    AppState,
    createInitialUploadState,
    createInitialImageUploadState,
    createInitialCreateState,
    EventManager
};
