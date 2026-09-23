/**
 * Teaven Identity SDK Token 存储实现
 */
/**
 * 内存 Token 存储，用于非浏览器环境
 */
export class MemoryTokenStorage {
    store = new Map();
    getItem(key) {
        return this.store.get(key) ?? null;
    }
    setItem(key, value) {
        this.store.set(key, value);
    }
    removeItem(key) {
        this.store.delete(key);
    }
}
/**
 * Web Storage 适配器（localStorage / sessionStorage）
 */
export function createWebStorage(storage) {
    return {
        getItem(key) {
            return storage.getItem(key);
        },
        setItem(key, value) {
            storage.setItem(key, value);
        },
        removeItem(key) {
            storage.removeItem(key);
        },
    };
}
/**
 * Taro Storage 适配器
 */
export function createTaroStorage(taro) {
    return {
        getItem(key) {
            return taro.getItem(key);
        },
        setItem(key, value) {
            return taro.setItem(key, value);
        },
        removeItem(key) {
            return taro.removeItem(key);
        },
    };
}
