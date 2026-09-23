/**
 * Teaven Identity SDK uni-app 请求适配器
 */
import type { RequestAdapter, RequestAdapterInput } from "../types.js";
/** uni-app 请求成功回调类型 */
interface UniRequestSuccess {
    statusCode: number;
    data: unknown;
    header?: Record<string, string>;
}
/** uni-app 请求接口 */
interface UniLike {
    request(options: {
        url: string;
        method: RequestAdapterInput["method"];
        header: Record<string, string>;
        data?: unknown;
        success: (result: UniRequestSuccess) => void;
        fail: (error: unknown) => void;
    }): unknown;
}
/**
 * 创建 uni-app 请求适配器
 */
export declare function createUniRequestAdapter(uni: UniLike): RequestAdapter;
export {};
