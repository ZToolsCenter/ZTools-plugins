/**
 * Teaven Identity SDK 错误处理
 * 使用统一状态码: https://problems.moruteaven.com/codes.json
 */
import { getHttpStatusCode, getCodeDetail } from "./codes.js";
/**
 * Teaven Identity 错误类
 * 使用 RFC 7807 Problem Details 风格的状态码
 */
export class TeavenIdentityError extends Error {
    /** 业务状态码 (如 "1010001") */
    code;
    /** HTTP 状态码 (如 404) */
    status;
    /** 错误详情 */
    details;
    constructor(code, message, details) {
        const defaultMessage = getCodeDetail(code);
        super(message || defaultMessage);
        this.name = "TeavenIdentityError";
        this.code = code;
        this.status = getHttpStatusCode(code);
        this.details = details;
    }
}
/**
 * 检查错误是否为 TeavenIdentityError
 */
export function isTeavenIdentityError(error) {
    return error instanceof TeavenIdentityError;
}
// ============================================================
// 便捷错误创建函数 (使用统一状态码)
// ============================================================
export const SDKErrors = {
    success(message = "成功") {
        return new TeavenIdentityError("0000000", message);
    },
    invalidParameter(message, details) {
        return new TeavenIdentityError("0000002", message, details);
    },
    internalError(message, details) {
        return new TeavenIdentityError("0000500", message, details);
    },
    userNotFound(message, details) {
        return new TeavenIdentityError("1010001", message, details);
    },
    userAlreadyExists(message, details) {
        return new TeavenIdentityError("1010002", message, details);
    },
    userDisabled(message, details) {
        return new TeavenIdentityError("1010201", message, details);
    },
    userDeleted(message, details) {
        return new TeavenIdentityError("1010202", message, details);
    },
    loginFailed(message, details) {
        return new TeavenIdentityError("1030001", message, details);
    },
    loginRequired(message, details) {
        return new TeavenIdentityError("1030401", message, details);
    },
    loginStateExpired(message, details) {
        return new TeavenIdentityError("1030403", message, details);
    },
    sessionExpired(message, details) {
        return new TeavenIdentityError("1050301", message, details);
    },
    sessionRevoked(message, details) {
        return new TeavenIdentityError("1050302", message, details);
    },
    sessionInvalid(message, details) {
        return new TeavenIdentityError("1050001", message, details);
    },
    permissionDenied(message, details) {
        return new TeavenIdentityError("1060001", message, details);
    },
    oauthAuthorizationFailed(message, details) {
        return new TeavenIdentityError("1040201", message, details);
    },
    oauthScopeInsufficient(message, details) {
        return new TeavenIdentityError("1040402", message, details);
    },
    registrationFailed(message, details) {
        return new TeavenIdentityError("1020001", message, details);
    },
    registrationUnavailable(message, details) {
        return new TeavenIdentityError("1020003", message, details);
    },
};
