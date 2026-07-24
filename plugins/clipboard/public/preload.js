const electron = require("electron");
const fs = require("fs/promises");

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const MAX_TEXT_LENGTH = 5000;
const MAX_FILE_ITEMS = 20;

function normalizeToolType(type) {
    if (type === 'text' || type === 'image' || type === 'files') return type;
    return 'all';
}

function normalizeLimit(limit) {
    const parsed = Number(limit);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(100, Math.max(1, Math.floor(parsed)));
}

function matchesType(item, type) {
    if (type === 'all') return true;
    if (type === 'files') return item.type === 'file';
    return item.type === type;
}

async function getImageSize(imagePath) {
    if (!imagePath) return undefined;
    try {
        const stat = await fs.stat(imagePath);
        return stat.size;
    } catch {
        return undefined;
    }
}

function mapTextItem(item) {
    const text = item.content || item.preview || '';
    return {
        id: item.id,
        type: 'text',
        text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : text,
        timestamp: item.timestamp,
        truncated: text.length > MAX_TEXT_LENGTH,
        size: text.length
    };
}

async function mapImageItem(item) {
    return {
        id: item.id,
        type: 'image',
        image: item.imagePath,
        timestamp: item.timestamp,
        truncated: false,
        size: await getImageSize(item.imagePath)
    };
}

function mapFileItem(item) {
    const files = Array.isArray(item.files) ? item.files : [];
    const truncated = files.length > MAX_FILE_ITEMS;
    return {
        id: item.id,
        type: 'files',
        files: files.slice(0, MAX_FILE_ITEMS).map(file => ({
            name: file.name,
            path: file.path,
            type: file.isDirectory ? 'folder' : 'file',
            exist: !!file.exists
        })),
        timestamp: item.timestamp,
        truncated,
        size: files.length
    };
}

async function mapHistoryItem(item) {
    if (item.type === 'text') return mapTextItem(item);
    if (item.type === 'image') return await mapImageItem(item);
    if (item.type === 'file') return mapFileItem(item);
    return null;
}

window.ztools.onPluginEnter((param) => {
    console.log("clipboard plugin enter", param);
    setTimeout(() => {
        try {
            window.ztools.subInputFocus();
        } catch (error) {
            console.error('聚焦搜索框失败:', error);
        }
    }, 0);
})

window.ztools.setSubInput((details) => {
    console.log('子输入框变化:', details)
}, '搜索剪贴板')

console.log('clipboard plugin preload.js');
window.ztools.registerTool('search_history', async (params = {}) => {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    const type = normalizeToolType(params.type);
    const limit = normalizeLimit(params.limit);

    const rawItems = query
        ? await window.ztools.clipboard.search(query)
        : (await window.ztools.clipboard.getHistory(1, 1000)).items;

    const matchedItems = rawItems.filter(item => matchesType(item, type));
    const mappedItems = [];

    for (const item of matchedItems.slice(0, limit)) {
        const mapped = await mapHistoryItem(item);
        if (mapped) {
            mappedItems.push(mapped);
        }
    }

    return {
        items: mappedItems,
        total: matchedItems.length
    };
});
