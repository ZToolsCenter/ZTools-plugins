/**
 * Teaven Identity SDK Token 存储实现
 */
import type { TokenStorage } from "./types.js";
/**
 * 内存 Token 存储，用于非浏览器环境
 */
export declare class MemoryTokenStorage implements TokenStorage {
    private store;
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
/**
 * Web Storage 适配器（localStorage / sessionStorage）
 */
export declare function createWebStorage(storage: globalThis.Storage): TokenStorage;
/**
 * Taro Storage 适配器
 */
export declare function createTaroStorage(taro: {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
}): TokenStorage;
