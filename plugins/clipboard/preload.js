const electron = require("electron");
const fs = require("fs/promises");
const crypto = require("crypto");

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

function generateDedupKey(item) {
    const hash = (content) => crypto.createHash('md5').update(content).digest('hex');
    
    if (item.type === 'text') {
        // 对文本内容进行规范化处理，消除空格、换行等差异
        const text = (item.content || item.preview || '').trim().replace(/\s+/g, ' ');
        return `text:${hash(text)}`;
    }
    
    if (item.type === 'image') {
        return `image:${item.imagePath || ''}`;
    }
    
    if (item.type === 'file') {
        const files = Array.isArray(item.files) ? item.files : [];
        const paths = files.map(f => f.path || '').sort().join('|');
        return `file:${hash(paths)}`;
    }
    
    return `unknown:${item.id || ''}`;
}

function deduplicateHistory(items) {
    const seen = new Map();
    
    for (const item of items) {
        const key = generateDedupKey(item);
        
        // 保留时间戳最新的记录
        if (!seen.has(key) || item.timestamp > seen.get(key).timestamp) {
            seen.set(key, item);
        }
    }
    
    const deduplicated = Array.from(seen.values()).sort((a, b) => b.timestamp - a.timestamp);
    // console.log(`[去重] 原始${items.length}条 -> 去重后${deduplicated.length}条`);
    return deduplicated;
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
})

window.ztools.setSubInput((details) => {
    console.log('子输入框变化:', details)
}, '搜索剪贴板')

console.log('clipboard plugin preload.js - 初始化剪贴板去重层');

// 缓存最近的去重结果，提升性能
let dedupCache = null;
let lastFetchTime = 0;
const CACHE_TTL = 1000; // 1秒缓存

// 拦截 getHistory 方法，自动去重
const originalGetHistory = window.ztools.clipboard.getHistory;
window.ztools.clipboard.getHistory = async function(...args) {
    // console.log('[拦截] getHistory 被调用，参数:', args);
    const result = await originalGetHistory.apply(this, args);
    if (result && result.items) {
        // console.log('[拦截] 原始数据条数:', result.items.length);
        result.items = deduplicateHistory(result.items);
        // console.log('[拦截] 去重后数据条数:', result.items.length);
    }
    return result;
};

// 拦截 search 方法，自动去重
const originalSearch = window.ztools.clipboard.search;
window.ztools.clipboard.search = async function(...args) {
    const items = await originalSearch.apply(this, args);
    if (Array.isArray(items)) {
        return deduplicateHistory(items);
    }
    return items;
};

// 导出去重工具供前端使用
window.clipboardUtils = {
    deduplicateHistory,
    generateDedupKey,
    clearCache: () => { dedupCache = null; }
};
window.ztools.registerTool('search_history', async (params = {}) => {
    const query = typeof params.query === 'string' ? params.query.trim() : '';
    const type = normalizeToolType(params.type);
    const limit = normalizeLimit(params.limit);

    let rawItems = query
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
