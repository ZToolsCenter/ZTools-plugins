function createTargetImportHostBridge(deps = {}) {
    const listTargets = deps.listTargets || require('../api/workflowy').listTargets;
    const listOfflineTargets = deps.listOfflineTargets || require('../api/workflowy').listOfflineTargets;
    const formatTargetItem = deps.formatTargetItem || require('../utils/helpers').formatTargetItem;
    const getTargetRef = deps.getTargetRef || (target => String(target?.key || target?.id || target?.nodeId || target?.node_id || '').trim());

    const showWorkflowyTargetImportMenu = async ({
        callbackSetList,
        existingRefs = [],
        manualAction,
        importAction,
        backAction,
        manualTitle = '📝 手动录入引用',
        manualDescription = '格式: 名称|引用，或直接输入引用',
        backTitle = '↩️ 返回列表'
    }) => {
        callbackSetList([{ title: '正在获取 Workflowy Targets...', description: '请稍候' }]);
        const taken = new Set(existingRefs);

        const menuItems = [
            { title: manualTitle, description: manualDescription, action: manualAction }
        ];

        try {
            const targets = await listTargets();
            if (Array.isArray(targets) && targets.length > 0) {
                targets.sort((a, b) => (a.type === 'system' && b.type !== 'system') ? -1 : 1);
                const availableTargets = targets.filter(target => !taken.has(getTargetRef(target)));
                menuItems.push(...availableTargets.map(target => {
                    const fmt = formatTargetItem(target);
                    return {
                        title: fmt.title,
                        description: fmt.description,
                        action: importAction,
                        data: target
                    };
                }));
            }
        } catch (error) {
            menuItems.push({ title: '⚠️ 无法加载 Targets', description: error.message, type: 'info' });
            // Offline-resolvable targets (inbox, built-in calendar targets)
            // need no API access; keep them selectable so the capture/view
            // target can still be corrected while the target list is down.
            listOfflineTargets()
                .filter(target => !taken.has(getTargetRef(target)))
                .forEach(target => {
                    const fmt = formatTargetItem(target);
                    menuItems.push({
                        title: fmt.title,
                        description: fmt.description,
                        action: importAction,
                        data: target
                    });
                });
        }

        menuItems.push({ title: backTitle, action: backAction });
        callbackSetList(menuItems);
    };

    return {
        showWorkflowyTargetImportMenu
    };
}

module.exports = {
    createTargetImportHostBridge
};
