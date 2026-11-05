const { AppState } = require('../core/state');
const { createPreviewBridgeHostBridge } = require('./preview_bridge_host');
const { createPendingUploadHostBridge } = require('./pending_upload_host');
const { createInlineEditHostBridge } = require('./inline_edit_host');
const { createNodeActionHostBridge } = require('./node_action_host');
const { createInputShellHostBridge } = require('./input_shell_host');
const { createRendererSurfaceHostBridge } = require('./renderer_surface_host');

const rendererSurfaceHost = createRendererSurfaceHostBridge();
const renderList = (...args) => rendererSurfaceHost.renderList(...args);
const openItemInBrowser = (...args) => rendererSurfaceHost.openItemInBrowser(...args);
const openPreviewWindow = (...args) => rendererSurfaceHost.openPreviewWindow(...args);
const openListWidget = (...args) => rendererSurfaceHost.openListWidget(...args);
const previewBridgeHost = createPreviewBridgeHostBridge();
const consumePreviewDeleteRequest = (...args) => previewBridgeHost.consumePreviewDeleteRequest(...args);
const consumePreviewDeleteNotification = (...args) => previewBridgeHost.consumePreviewDeleteNotification(...args);
const setPreviewDeleteRefreshHandler = (...args) => previewBridgeHost.setPreviewDeleteRefreshHandler(...args);
const pendingUploadHost = createPendingUploadHostBridge({ openPreviewWindow });
const handlePendingUploadAction = async (action) => pendingUploadHost.handlePendingUploadAction(action, AppState.inputActions);

// Forward declarations to handle circular dependencies or hoisting issues
let navigateTo;
let createNode;
let navigateToCleanup;
let showMoveTargetImportMenu;
let openManualMoveTargetInput;
let composeHost = null;

const setNavigateTo = (fn) => { navigateTo = fn; };
const setCreateNode = (fn) => { createNode = fn; };
const setNavigateToCleanup = (fn) => { navigateToCleanup = fn; };
const setMoveTargetImportMenu = (fn) => { showMoveTargetImportMenu = fn; };
const setManualMoveTargetInput = (fn) => { openManualMoveTargetInput = fn; };
const setComposeHost = (host) => { composeHost = host; };

const refreshParentView = (parentContext) => {
    const parent = parentContext || AppState.navigationStack[AppState.navigationStack.length - 1];
    if (!parent) return;
    if (AppState.mode === 'cleanup' && navigateToCleanup) {
        navigateToCleanup(parent.id, parent.name, false);
        return;
    }
    if (navigateTo) navigateTo(parent.id, parent.name, false);
};

const inlineEditHost = createInlineEditHostBridge({ refreshParentView });
const handleInlineEditAction = (...args) => inlineEditHost.handleInlineEditAction(...args);
const handleEditNode = (...args) => inlineEditHost.handleEditNode(...args);
const nodeActionHost = createNodeActionHostBridge({
    openItemInBrowser,
    openListWidget,
    handleEditNode,
    refreshParentView,
    getNavigateTo: () => navigateTo,
    getShowMoveTargetImportMenu: () => showMoveTargetImportMenu,
    getOpenManualMoveTargetInput: () => openManualMoveTargetInput
});
const showNodeActions = (...args) => nodeActionHost.showNodeActions(...args);
const executeNodeAction = (...args) => nodeActionHost.executeNodeAction(...args);
const inputShellHost = createInputShellHostBridge();
const setupInputAndKeyboard = (nodeName, options = {}) => inputShellHost.setupInputAndKeyboard({
    nodeName,
    renderList,
    pendingUploadHost,
    pendingCaptureHost: options.pendingCaptureHost,
    composeHost,
    setPreviewDeleteRefreshHandler,
    consumePreviewDeleteNotification,
    createNode,
    navigateTo
});

module.exports = {
    renderList,
    openItemInBrowser,
    openPreviewWindow,
    openListWidget,
    consumePreviewDeleteRequest,
    consumePreviewDeleteNotification,
    setPreviewDeleteRefreshHandler,
    setupInputAndKeyboard,
    showNodeActions,
    executeNodeAction,
    handlePendingUploadAction,
    handleInlineEditAction,
    setNavigateTo,
    setNavigateToCleanup,
    setMoveTargetImportMenu,
    setManualMoveTargetInput,
    setCreateNode,
    setComposeHost
};
