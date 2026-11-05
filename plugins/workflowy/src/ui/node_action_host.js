const { openHintSubInput } = require('../utils/subinput_compat');

function createNodeActionHostBridge(deps = {}) {
    const { AppState, EventManager } = deps.state || require('../core/state');
    const {
        workflowyApiRequest
    } = deps.workflowy || require('../api/workflowy');
    const {
        getSettings
    } = deps.settings || require('../core/settings');
    const {
        getQuickMoveTargets,
        rememberMoveTarget
    } = deps.nodes || require('../core/node_manager');
    const {
        CacheManager
    } = deps.cache || require('../core/cache');
    const {
        stripHtml
    } = deps.helpers || require('../utils/helpers');
    const runtimeWindow = deps.window || globalThis.window;
    const openItemInBrowser = deps.openItemInBrowser || (() => {});
    const openListWidget = deps.openListWidget || (() => {});
    const handleEditNode = deps.handleEditNode || (() => {});
    const refreshParentView = deps.refreshParentView || (() => {});
    const getNavigateTo = deps.getNavigateTo || (() => null);
    const getShowMoveTargetImportMenu = deps.getShowMoveTargetImportMenu || (() => null);
    const getOpenManualMoveTargetInput = deps.getOpenManualMoveTargetInput || (() => null);

    const getMoveSourceParent = () => AppState.navigationStack[AppState.navigationStack.length - 1];

    const formatMoveTargetSource = (source) => {
        if (source === 'recent') return '最近移动';
        if (source === 'capture') return 'wf 发送目标';
        return 'wfv 查看入口';
    };

    const showNodeActions = (item) => {
        EventManager.clear();
        AppState.activeItem = item;

        const actions = [
            { title: '▶️ 进入节点', action: 'drill' },
            { title: '✏️ 编辑内容', action: 'edit' },
            { title: '📦 移动到...', action: 'move' },
            { title: item.completedAt ? '🔄 标记未完成' : '✅ 标记完成', action: item.completedAt ? 'uncomplete' : 'complete' },
            { title: '📝 复制文本', action: 'copy' },
            { title: '更多操作...', action: 'more' },
            { title: '↩️ 返回列表', action: 'back' }
        ].map((action) => ({ ...action, description: '按 Enter 执行' }));

        AppState.callbackSetList(actions);
        openHintSubInput(runtimeWindow, `操作: ${stripHtml(item.name)}`, true);
    };

    const showNodeMoreActions = (item) => {
        EventManager.clear();
        AppState.activeItem = item;
        AppState.callbackSetList([
            { title: '📌 独立挂件', description: '以悬浮窗口打开该节点', action: 'widget' },
            { title: '🌐 浏览器打开', description: '用 workflowy:// 打开该节点', action: 'browser' },
            { title: '🗑️ 删除节点', description: '需要二次确认', action: 'delete_confirm' },
            { title: '↩️ 返回节点操作', action: 'more_back_to_actions' }
        ]);
        openHintSubInput(runtimeWindow, `更多: ${stripHtml(item.name)}`, true);
    };

    const showNodeDeleteConfirm = (item) => {
        EventManager.clear();
        AppState.activeItem = item;
        AppState.callbackSetList([
            {
                title: '确认删除该节点',
                description: stripHtml(item.name) || '（无标题）',
                type: 'info'
            },
            {
                title: '删除节点',
                description: '此操作会调用 Workflowy 删除接口',
                action: 'delete'
            },
            {
                title: '取消',
                description: '返回节点操作',
                action: 'delete_cancel'
            }
        ]);
        openHintSubInput(runtimeWindow, `确认删除: ${stripHtml(item.name)}`, true);
    };

    const showMoveTargetPicker = (item) => {
        EventManager.clear();
        AppState.activeItem = item;
        const parent = getMoveSourceParent();
        const targets = getQuickMoveTargets({ excludeRef: parent?.id });
        const actions = targets.map((target) => ({
            title: `移动到：${target.name}`,
            description: `${formatMoveTargetSource(target.source)} | 引用: ${target.ref}`,
            action: 'move_to_target',
            data: target
        }));

        if (getShowMoveTargetImportMenu()) {
            actions.push({ title: '从 Workflowy Targets 选择', description: '从官方 target 列表选择移动目标', action: 'move_pick_target' });
        }
        actions.push({ title: '手动输入目标', description: '格式: 名称|引用，或直接输入引用', action: 'move_manual_target' });
        actions.push({ title: '↩️ 返回节点操作', action: 'move_back_to_actions' });
        AppState.callbackSetList(actions);
        openHintSubInput(runtimeWindow, `移动: ${stripHtml(item.name)}`, true);
    };

    const normalizeMoveTarget = (target = {}) => ({
        ref: String(target.ref || target.key || target.id || target.nodeId || target.node_id || '').trim(),
        name: String(target.name || target.title || target.ref || target.key || target.id || '').trim(),
        refType: target.refType || target.type
    });

    const moveActiveNodeToTarget = async (target) => {
        const item = AppState.activeItem;
        const parent = getMoveSourceParent();
        const normalizedTarget = normalizeMoveTarget(target);
        const targetRef = normalizedTarget.ref;
        if (!item || !targetRef) return;
        if (targetRef === parent?.id) {
            runtimeWindow.ztools?.showNotification('节点已在该目标下');
            showMoveTargetPicker(item);
            return;
        }

        const position = getSettings().createPosition === 'top' ? 'top' : 'bottom';
        await workflowyApiRequest(`nodes/${item.id}/move`, {
            parent_id: targetRef,
            position
        });

        rememberMoveTarget(targetRef, normalizedTarget.name, normalizedTarget.refType);
        CacheManager.remove(`nodes_${parent?.id || 'None'}`);
        CacheManager.remove(`nodes_${targetRef || 'None'}`);
        if (AppState.mode === 'cleanup') {
            AppState.cleanupFeedback = `已移动到：${normalizedTarget.name || targetRef}`;
        }
        runtimeWindow.ztools?.showNotification(`已移动到：${normalizedTarget.name || targetRef}`);
        refreshParentView(parent);
    };

    const promptManualMoveTarget = () => {
        const item = AppState.activeItem;
        const openManualMoveTargetInput = getOpenManualMoveTargetInput();
        if (!item || typeof openManualMoveTargetInput !== 'function') return;
        openManualMoveTargetInput({
            onConfirm(parsed) {
                moveActiveNodeToTarget({
                    ref: parsed.id,
                    name: parsed.name,
                    refType: parsed.type
                }).catch((error) => {
                    runtimeWindow.ztools?.showNotification(`移动失败: ${error.message}`);
                    showMoveTargetPicker(item);
                });
            },
            onCancel() {
                showMoveTargetPicker(item);
            }
        });
    };

    const executeNodeAction = async (actionType, data = null) => {
        const item = AppState.activeItem;
        if (!item) return;
        const parent = AppState.navigationStack[AppState.navigationStack.length - 1];

        try {
            switch (actionType) {
                case 'drill':
                    AppState.mode = 'view';
                    if (getNavigateTo()) getNavigateTo()(item.id, stripHtml(item.name));
                    return;
                case 'back':
                    refreshParentView(parent);
                    return;
                case 'browser':
                    openItemInBrowser(item.id);
                    refreshParentView(parent);
                    return;
                case 'widget':
                    openListWidget(item.id, stripHtml(item.name));
                    runtimeWindow.ztools?.hideMainWindow();
                    runtimeWindow.ztools?.outPlugin();
                    return;
                case 'copy':
                    runtimeWindow.ztools?.copyText(stripHtml(item.name));
                    runtimeWindow.ztools?.showNotification('已复制');
                    refreshParentView(parent);
                    return;
                case 'more':
                    showNodeMoreActions(item);
                    return;
                case 'more_back_to_actions':
                    showNodeActions(item);
                    return;
                case 'delete_confirm':
                    showNodeDeleteConfirm(item);
                    return;
                case 'delete_cancel':
                    showNodeActions(item);
                    return;
                case 'move':
                    showMoveTargetPicker(item);
                    return;
                case 'move_to_target':
                    await moveActiveNodeToTarget(data);
                    return;
                case 'move_pick_target':
                    if (getShowMoveTargetImportMenu()) getShowMoveTargetImportMenu()();
                    else promptManualMoveTarget();
                    return;
                case 'move_manual_target':
                    promptManualMoveTarget();
                    return;
                case 'move_back_to_picker':
                    showMoveTargetPicker(item);
                    return;
                case 'move_back_to_actions':
                    showNodeActions(item);
                    return;
                case 'delete':
                    await workflowyApiRequest(`nodes/${item.id}`, {}, 'DELETE');
                    CacheManager.remove(`nodes_${parent?.id || 'None'}`);
                    if (AppState.mode === 'cleanup') AppState.cleanupFeedback = '已删除节点';
                    break;
                case 'complete':
                case 'uncomplete':
                    await workflowyApiRequest(`nodes/${item.id}/${actionType}`, {});
                    CacheManager.remove(`nodes_${parent?.id || 'None'}`);
                    if (AppState.mode === 'cleanup') {
                        AppState.cleanupFeedback = actionType === 'complete' ? '已标记完成' : '已标记未完成';
                    }
                    break;
                case 'edit':
                    handleEditNode(item, parent);
                    return;
                default:
                    return;
            }
            refreshParentView(parent);
        } catch (error) {
            runtimeWindow.ztools?.showNotification(`操作失败: ${error.message}`);
            refreshParentView(parent);
        }
    };

    return {
        showNodeActions,
        executeNodeAction
    };
}

module.exports = {
    createNodeActionHostBridge
};
