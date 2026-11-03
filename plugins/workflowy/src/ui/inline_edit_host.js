const { closeSubInput, openHintSubInput } = require('../utils/subinput_compat');

function createInlineEditHostBridge(deps = {}) {
    const { AppState, EventManager } = deps.state || require('../core/state');
    const {
        workflowyApiRequest
    } = deps.workflowy || require('../api/workflowy');
    const {
        CacheManager
    } = deps.cache || require('../core/cache');
    const {
        stripHtml,
        previewText,
        layoutModeLabel,
        LAYOUT_MODE_OPTIONS
    } = deps.helpers || require('../utils/helpers');
    const runtimeWindow = deps.window || globalThis.window;
    const runtimeDocument = deps.document || globalThis.document;
    const refreshParentView = deps.refreshParentView || (() => {});

    const renderInlineEditMenu = () => {
        if (!AppState.editContext) return;
        EventManager.clear();
        EventManager.add(runtimeDocument, 'keydown', (e) => {
            if (e.key === 'Escape') {
                exitInlineEdit(true);
            }
        });
        openHintSubInput(runtimeWindow, '编辑模式：Enter 选择，Esc 取消');
        const { draft } = AppState.editContext;
        const displayName = stripHtml(draft.name || '') || '（空）';
        const displayNote = previewText(stripHtml(draft.note || ''));
        const menu = [
            { title: `✏️ 标题：${displayName}`, description: '按 Enter 编辑，支持 Markdown/HTML', action: 'wf_edit_name' },
            { title: `📝 备注：${displayNote}`, description: '按 Enter 编辑，支持多行 Markdown', action: 'wf_edit_note' },
            { title: `🎨 布局模式：${layoutModeLabel(draft.layoutMode)}`, description: '按 Enter 选择官方 layoutMode', action: 'wf_edit_layout' },
            { title: '💾 保存修改', action: 'wf_edit_save' },
            { title: '↩️ 取消并返回', action: 'wf_edit_cancel' }
        ];
        AppState.callbackSetList(menu);
    };

    const exitInlineEdit = (refresh = true) => {
        const ctx = AppState.editContext;
        AppState.editContext = null;
        EventManager.clear();
        closeSubInput(runtimeWindow);
        if (!refresh) return;
        const target = ctx?.parent || AppState.navigationStack[AppState.navigationStack.length - 1];
        if (target) {
            refreshParentView(target);
        }
    };

    const promptInlineEditField = (field, placeholder) => {
        if (!AppState.editContext) return;
        EventManager.clear();
        let value = AppState.editContext.draft[field] || '';
        const applyValue = (silent) => {
            const cleaned = field === 'note' ? value : value.trim();
            if (field !== 'note' && !cleaned) {
                if (!silent) runtimeWindow.ztools?.showNotification('标题不能为空');
                return false;
            }
            AppState.editContext.draft[field] = cleaned;
            closeSubInput(runtimeWindow);
            renderInlineEditMenu();
            return true;
        };

        let commitTimer = null;
        runtimeWindow.ztools?.setSubInput(({ text }) => {
            value = text;
            if (commitTimer) clearTimeout(commitTimer);
            // ZTools 不转发 Enter：停止输入后自动提交
            commitTimer = setTimeout(() => {
                commitTimer = null;
                applyValue(true);
            }, 500);
        }, placeholder, value);

        const handler = (e) => {
            if (e.key === 'Enter') {
                if (commitTimer) clearTimeout(commitTimer);
                applyValue(false);
            } else if (e.key === 'Escape') {
                if (commitTimer) clearTimeout(commitTimer);
                closeSubInput(runtimeWindow);
                renderInlineEditMenu();
            }
        };
        EventManager.add(runtimeDocument, 'keydown', handler);
    };

    const showLayoutModePicker = () => {
        if (!AppState.editContext) return;
        EventManager.clear();
        openHintSubInput(runtimeWindow, '选择 layoutMode，Esc 返回');
        const current = AppState.editContext.draft.layoutMode;
        const items = LAYOUT_MODE_OPTIONS.map(opt => ({
            title: `${opt.label}${opt.value === current ? ' (当前)' : ''}`,
            action: 'wf_edit_layout_pick',
            data: opt
        }));
        items.push({ title: '↩️ 返回编辑菜单', action: 'wf_edit_back' });
        AppState.callbackSetList(items);
        EventManager.add(runtimeDocument, 'keydown', (e) => {
            if (e.key === 'Escape') renderInlineEditMenu();
        });
    };

    const startInlineEdit = (item, parentContext) => {
        const currentNote = typeof item.note === 'string'
            ? item.note
            : (typeof item.nt === 'string' ? item.nt : '');
        const layoutMode = item.layoutMode || (item.data && item.data.layoutMode) || 'bullets';
        AppState.editContext = {
            nodeId: item.id,
            parent: parentContext,
            draft: {
                name: item.name || '',
                note: currentNote || '',
                layoutMode: layoutMode || 'bullets'
            },
            original: {
                name: item.name || '',
                note: currentNote || '',
                layoutMode: layoutMode || 'bullets'
            }
        };
        renderInlineEditMenu();
    };

    const submitInlineEditChanges = async () => {
        const ctx = AppState.editContext;
        if (!ctx) return;
        const payload = {};
        const name = ctx.draft.name.trim();
        if (!name) {
            runtimeWindow.ztools?.showNotification('标题不能为空');
            return;
        }
        if (name !== ctx.original.name) payload.name = name;
        if ((ctx.draft.note || '') !== (ctx.original.note || '')) payload.note = ctx.draft.note || '';
        if ((ctx.draft.layoutMode || '') !== (ctx.original.layoutMode || '')) payload.layoutMode = ctx.draft.layoutMode;

        if (!Object.keys(payload).length) {
            runtimeWindow.ztools?.showNotification('没有可保存的改动');
            exitInlineEdit(true);
            return;
        }

        try {
            await workflowyApiRequest(`nodes/${ctx.nodeId}`, payload, 'POST');
            runtimeWindow.ztools?.showNotification('修改成功');
            const parentId = ctx.parent?.id || AppState.navigationStack[AppState.navigationStack.length - 1]?.id;
            CacheManager.remove(`nodes_${parentId || 'None'}`);
            exitInlineEdit(true);
        } catch (error) {
            runtimeWindow.ztools?.showNotification(error.message);
            renderInlineEditMenu();
        }
    };

    const handleInlineEditAction = (action, data) => {
        switch (action) {
            case 'wf_edit_name':
                promptInlineEditField('name', '编辑标题（Enter 确认，Esc 取消）');
                return;
            case 'wf_edit_note':
                promptInlineEditField('note', '编辑备注（Enter 确认，Esc 取消）');
                return;
            case 'wf_edit_layout':
                showLayoutModePicker();
                return;
            case 'wf_edit_layout_pick':
                if (AppState.editContext) {
                    AppState.editContext.draft.layoutMode = data?.value || 'bullets';
                }
                renderInlineEditMenu();
                return;
            case 'wf_edit_back':
                renderInlineEditMenu();
                return;
            case 'wf_edit_save':
                return submitInlineEditChanges();
            case 'wf_edit_cancel':
                return exitInlineEdit(true);
            default:
                return;
        }
    };

    const handleEditNode = (item, parentContext) => {
        startInlineEdit(item, parentContext);
    };

    return {
        handleEditNode,
        handleInlineEditAction
    };
}

module.exports = {
    createInlineEditHostBridge
};
