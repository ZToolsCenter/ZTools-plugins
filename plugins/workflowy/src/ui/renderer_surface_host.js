function createRendererSurfaceHostBridge(deps = {}) {
    const {
        stripHtml,
        isUuidId
    } = deps.helpers || require('../utils/helpers');
    const {
        noteContainsImageUrl
    } = deps.image || require('../utils/image');
    const {
        getSettings
    } = deps.settings || require('../core/settings');
    const runtimeWindow = deps.window || globalThis.window;

    const renderList = (items) => {
        if (!items || items.length === 0) return [];
        return items.map((item) => {
            const isCompleted = !!item.completedAt;
            const indent = item.__depth ? '  '.repeat(item.__depth) : '';
            const note = typeof item.note === 'string'
                ? item.note
                : (typeof item.nt === 'string' ? item.nt : '');
            const titlePrefix = `${isCompleted ? '✅ ' : ''}${noteContainsImageUrl(note) ? '图片 ' : ''}`;
            const title = `${indent}${titlePrefix}${stripHtml(item.name) || '(无标题)'}`;

            let description = `📅 ${new Date((item.modifiedAt || 0) * 1000).toLocaleDateString()}`;
            if (item.ch) description += ' (有子节点)';
            if (isCompleted) description += ' | 已完成';

            return {
                title,
                description,
                item,
                type: 'dataItem'
            };
        });
    };

    const openItemInBrowser = (itemId) => {
        if (!itemId) return;
        runtimeWindow.ztools?.shellOpenExternal(`workflowy://workflowy.com/#/${itemId}`);
    };

    const openPreviewWindow = (url, name, kind, options = {}) => {
        if (!url) {
            runtimeWindow.ztools?.showNotification('没有可预览的附件链接');
            return;
        }
        const queryParts = [
            `url=${encodeURIComponent(url)}`,
            `name=${encodeURIComponent(name || '附件预览')}`,
            `kind=${encodeURIComponent(kind || 'image')}`,
            `_v=${Date.now()}`,
            `objectKey=${encodeURIComponent(options.objectKey || '')}`,
            `attachmentId=${encodeURIComponent(options.attachmentId || '')}`
        ];
        const previewUrl = `preview.html?${queryParts.join('&')}`;
        runtimeWindow.ztools?.createBrowserWindow(
            previewUrl,
            {
                width: 600,
                height: 500,
                title: name || '附件预览',
                alwaysOnTop: true,
                frame: false,
                resizable: true,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            }
        );
    };

    const openListWidget = (nodeId, nodeName) => {
        const settings = getSettings();
        const apiKey = settings.apiKey;
        if (!apiKey) {
            runtimeWindow.ztools?.showNotification('请先配置 API Key');
            return;
        }

        const allowExternal = isUuidId(nodeId) ? '1' : '0';
        const createPosition = settings.createPosition === 'top' ? 'top' : 'bottom';
        const url = `widget.html?nodeId=${encodeURIComponent(nodeId)}&title=${encodeURIComponent(nodeName)}&allowExternal=${allowExternal}&createPosition=${encodeURIComponent(createPosition)}`;
        runtimeWindow.ztools?.createBrowserWindow(
            url,
            {
                width: 320,
                height: 500,
                title: nodeName,
                alwaysOnTop: true,
                frame: false,
                transparent: true,
                resizable: true,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            }
        );
    };

    return {
        renderList,
        openItemInBrowser,
        openPreviewWindow,
        openListWidget
    };
}

module.exports = {
    createRendererSurfaceHostBridge
};
