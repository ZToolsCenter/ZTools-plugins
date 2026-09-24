/**
 * Teaven Identity SDK 错误处理
 * 使用统一状态码: https://problems.moruteaven.com/codes.json
 */
/**
 * Teaven Identity 错误类
 * 使用 RFC 7807 Problem Details 风格的状态码
 */
export declare class TeavenIdentityError extends Error {
    /** 业务状态码 (如 "1010001") */
    readonly code: string;
    /** HTTP 状态码 (如 404) */
    readonly status: number;
    /** 错误详情 */
    readonly details: unknown;
    constructor(code: string, message?: string, details?: unknown);
}
/**
 * 检查错误是否为 TeavenIdentityError
 */
export declare function isTeavenIdentityError(error: unknown): error is TeavenIdentityError;
export declare const SDKErrors: {
    success(message?: string): TeavenIdentityError;
    invalidParameter(message?: string, details?: unknown): TeavenIdentityError;
    internalError(message?: string, details?: unknown): TeavenIdentityError;
    userNotFound(message?: string, details?: unknown): TeavenIdentityError;
    userAlreadyExists(message?: string, details?: unknown): TeavenIdentityError;
    userDisabled(message?: string, details?: unknown): TeavenIdentityError;
    userDeleted(message?: string, details?: unknown): TeavenIdentityError;
    loginFailed(message?: string, details?: unknown): TeavenIdentityError;
    loginRequired(message?: string, details?: unknown): TeavenIdentityError;
    loginStateExpired(message?: string, details?: unknown): TeavenIdentityError;
    sessionExpired(message?: string, details?: unknown): TeavenIdentityError;
    sessionRevoked(message?: string, details?: unknown): TeavenIdentityError;
    sessionInvalid(message?: string, details?: unknown): TeavenIdentityError;
    permissionDenied(message?: string, details?: unknown): TeavenIdentityError;
    oauthAuthorizationFailed(message?: string, details?: unknown): TeavenIdentityError;
    oauthScopeInsufficient(message?: string, details?: unknown): TeavenIdentityError;
    registrationFailed(message?: string, details?: unknown): TeavenIdentityError;
    registrationUnavailable(message?: string, details?: unknown): TeavenIdentityError;
};
