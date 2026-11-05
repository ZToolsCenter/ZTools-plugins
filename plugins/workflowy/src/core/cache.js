const {
    getStorageItem,
    setStorageItem,
    removeStorageItem
} = require('./storage');

const CACHE_PREFIX = 'wf_cache_';
const DEFAULT_TTL = 1000 * 60 * 60 * 24; // 24 hours

const CacheManager = {
    get(key) {
        const item = getStorageItem(CACHE_PREFIX + key);
        if (!item) return null;
        if (item.expiry && Date.now() > item.expiry) {
            removeStorageItem(CACHE_PREFIX + key);
            return null;
        }
        return item.data;
    },
    set(key, value, ttl = DEFAULT_TTL) {
        const expiry = Date.now() + ttl;
        setStorageItem(CACHE_PREFIX + key, { data: value, expiry });
    },
    remove(key) {
        removeStorageItem(CACHE_PREFIX + key);
    }
};

module.exports = { CacheManager };
