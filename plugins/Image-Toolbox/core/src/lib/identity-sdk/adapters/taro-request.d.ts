/**
 * Teaven Identity SDK Taro 请求适配器
 */
import type { RequestAdapter, RequestAdapterInput } from "../types.js";
/** Taro 请求成功回调类型 */
interface TaroRequestSuccess<T = unknown> {
    statusCode: number;
    data: T;
    header?: Record<string, string>;
}
/** Taro 请求接口 */
interface TaroLike {
    request(options: {
        url: string;
        method: RequestAdapterInput["method"];
        header: Record<string, string>;
        data?: unknown;
        success: (result: TaroRequestSuccess) => void;
        fail: (error: unknown) => void;
    }): unknown;
}
/**
 * 创建 Taro 请求适配器
 */
export declare function createTaroRequestAdapter(taro: TaroLike): RequestAdapter;
export {};
