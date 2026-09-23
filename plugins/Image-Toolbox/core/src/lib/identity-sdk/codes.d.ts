/**
 * Teaven Identity 统一状态码定义
 * 来源: https://problems.moruteaven.com/codes.json
 * RFC 7807 Problem Details 风格错误码
 */
export declare const SystemCodes: {
    /** 成功 */
    readonly SUCCESS: "0000000";
    /** 请求参数无效 */
    readonly INVALID_PARAMETER: "0000002";
    /** 服务暂时不可用，请稍后重试 */
    readonly INTERNAL_ERROR: "0000500";
};
export declare const IdentityGeneralCodes: {
    /** 用户身份操作失败 */
    readonly IDENTITY_ERROR: "1000001";
    /** 用户身份不存在 */
    readonly IDENTITY_NOT_FOUND: "1000002";
    /** 用户身份无效 */
    readonly IDENTITY_INVALID: "1000003";
    /** 用户身份服务暂不可用 */
    readonly IDENTITY_UNAVAILABLE: "1000004";
    /** 用户身份发生冲突 */
    readonly IDENTITY_CONFLICT: "1000005";
};
export declare const UserGeneralCodes: {
    /** 用户不存在 */
    readonly USER_NOT_FOUND: "1010001";
    /** 用户已存在 */
    readonly USER_ALREADY_EXISTS: "1010002";
    /** 用户操作失败 */
    readonly USER_OPERATION_FAILED: "1010003";
};
export declare const UserInfoCodes: {
    /** 用户信息不存在 */
    readonly USER_INFO_NOT_FOUND: "1010101";
    /** 用户信息无效 */
    readonly USER_INFO_INVALID: "1010102";
    /** 用户信息更新失败 */
    readonly USER_INFO_UPDATE_FAILED: "1010103";
};
export declare const UserStatusCodes: {
    /** 用户已被禁用 */
    readonly USER_DISABLED: "1010201";
    /** 用户已注销 */
    readonly USER_DELETED: "1010202";
    /** 用户已被暂停使用 */
    readonly USER_SUSPENDED: "1010203";
    /** 用户状态无效 */
    readonly USER_STATUS_INVALID: "1010204";
};
export declare const UserIdCodes: {
    /** 用户 ID 无效 */
    readonly USER_ID_INVALID: "1010301";
    /** 用户 ID 不存在 */
    readonly USER_ID_NOT_FOUND: "1010302";
    /** 用户 ID 冲突 */
    readonly USER_ID_CONFLICT: "1010303";
};
export declare const UserAttributeCodes: {
    /** 用户属性无效 */
    readonly USER_ATTRIBUTE_INVALID: "1010401";
    /** 用户属性不存在 */
    readonly USER_ATTRIBUTE_NOT_FOUND: "1010402";
    /** 用户属性更新失败 */
    readonly USER_ATTRIBUTE_UPDATE_FAILED: "1010403";
};
export declare const UserRelationCodes: {
    /** 用户关系不存在 */
    readonly USER_RELATION_NOT_FOUND: "1010501";
    /** 用户关系已存在 */
    readonly USER_RELATION_ALREADY_EXISTS: "1010502";
    /** 用户关系无效 */
    readonly USER_RELATION_INVALID: "1010503";
};
export declare const RegistrationGeneralCodes: {
    /** 注册失败 */
    readonly REGISTRATION_FAILED: "1020001";
    /** 注册信息无效 */
    readonly REGISTRATION_INVALID: "1020002";
    /** 当前暂不支持注册 */
    readonly REGISTRATION_UNAVAILABLE: "1020003";
};
export declare const RegistrationFlowCodes: {
    /** 注册流程无效 */
    readonly REGISTRATION_STEP_INVALID: "1020101";
    /** 注册流程已过期 */
    readonly REGISTRATION_STEP_EXPIRED: "1020102";
    /** 当前无法进行此注册操作 */
    readonly REGISTRATION_STEP_NOT_ALLOWED: "1020103";
};
export declare const RegistrationVerificationCodes: {
    /** 请完成注册验证 */
    readonly REGISTRATION_VERIFICATION_REQUIRED: "1020201";
    /** 注册验证失败 */
    readonly REGISTRATION_VERIFICATION_FAILED: "1020202";
    /** 注册验证已过期 */
    readonly REGISTRATION_VERIFICATION_EXPIRED: "1020203";
};
export declare const RegistrationMethodCodes: {
    /** 不支持该注册方式 */
    readonly REGISTRATION_METHOD_NOT_SUPPORTED: "1020301";
    /** 注册方式无效 */
    readonly REGISTRATION_METHOD_INVALID: "1020302";
};
export declare const RegistrationLimitCodes: {
    /** 已超过注册限制 */
    readonly REGISTRATION_LIMIT_EXCEEDED: "1020401";
    /** 当前不允许注册 */
    readonly REGISTRATION_NOT_ALLOWED: "1020402";
};
export declare const RegistrationStatusCodes: {
    /** 注册已完成 */
    readonly REGISTRATION_ALREADY_COMPLETED: "1020501";
    /** 注册正在处理中 */
    readonly REGISTRATION_PENDING: "1020502";
    /** 注册已过期 */
    readonly REGISTRATION_EXPIRED: "1020503";
};
export declare const LoginGeneralCodes: {
    /** 登录失败 */
    readonly LOGIN_FAILED: "1030001";
    /** 当前不允许登录 */
    readonly LOGIN_NOT_ALLOWED: "1030002";
};
export declare const LoginFlowCodes: {
    /** 登录流程无效 */
    readonly LOGIN_STEP_INVALID: "1030101";
    /** 登录流程已过期 */
    readonly LOGIN_STEP_EXPIRED: "1030102";
};
export declare const LoginMethodCodes: {
    /** 不支持该登录方式 */
    readonly LOGIN_METHOD_NOT_SUPPORTED: "1030201";
    /** 登录方式无效 */
    readonly LOGIN_METHOD_INVALID: "1030202";
};
export declare const LoginVerificationCodes: {
    /** 登录验证失败 */
    readonly LOGIN_VERIFICATION_FAILED: "1030301";
    /** 请完成登录验证 */
    readonly LOGIN_VERIFICATION_REQUIRED: "1030302";
    /** 登录验证已过期 */
    readonly LOGIN_VERIFICATION_EXPIRED: "1030303";
};
export declare const LoginStateCodes: {
    /** 需要登录 */
    readonly LOGIN_REQUIRED: "1030401";
    /** 登录状态无效 */
    readonly LOGIN_STATE_INVALID: "1030402";
    /** 登录状态已过期 */
    readonly LOGIN_STATE_EXPIRED: "1030403";
};
export declare const LoginLimitCodes: {
    /** 登录次数已超过限制 */
    readonly LOGIN_LIMIT_EXCEEDED: "1030501";
    /** 登录暂时被限制 */
    readonly LOGIN_TEMPORARILY_BLOCKED: "1030502";
};
export declare const OAuthGeneralCodes: {
    /** OAuth 操作失败 */
    readonly OAUTH_ERROR: "1040001";
    /** 不支持该 OAuth 操作 */
    readonly OAUTH_NOT_SUPPORTED: "1040002";
};
export declare const OAuthClientCodes: {
    /** OAuth 客户端不存在 */
    readonly OAUTH_CLIENT_NOT_FOUND: "1040101";
    /** OAuth 客户端无效 */
    readonly OAUTH_CLIENT_INVALID: "1040102";
    /** OAuth 客户端已禁用 */
    readonly OAUTH_CLIENT_DISABLED: "1040103";
};
export declare const OAuthAuthorizationCodes: {
    /** OAuth 授权失败 */
    readonly OAUTH_AUTHORIZATION_FAILED: "1040201";
    /** 用户拒绝授权 */
    readonly OAUTH_AUTHORIZATION_DENIED: "1040202";
    /** OAuth 授权已过期 */
    readonly OAUTH_AUTHORIZATION_EXPIRED: "1040203";
};
export declare const OAuthCodeCodes: {
    /** OAuth 授权码无效 */
    readonly OAUTH_CODE_INVALID: "1040301";
    /** OAuth 授权码已过期 */
    readonly OAUTH_CODE_EXPIRED: "1040302";
    /** OAuth 授权码已使用 */
    readonly OAUTH_CODE_ALREADY_USED: "1040303";
};
export declare const OAuthScopeCodes: {
    /** OAuth 权限范围无效 */
    readonly OAUTH_SCOPE_INVALID: "1040401";
    /** OAuth 权限范围不足 */
    readonly OAUTH_SCOPE_INSUFFICIENT: "1040402";
};
export declare const OAuthProviderCodes: {
    /** OAuth 服务提供方不存在 */
    readonly OAUTH_PROVIDER_NOT_FOUND: "1040501";
    /** OAuth 服务提供方暂不可用 */
    readonly OAUTH_PROVIDER_UNAVAILABLE: "1040502";
    /** OAuth 服务提供方发生错误 */
    readonly OAUTH_PROVIDER_ERROR: "1040503";
};
export declare const SessionGeneralCodes: {
    /** 会话无效 */
    readonly SESSION_INVALID: "1050001";
    /** 会话不存在 */
    readonly SESSION_NOT_FOUND: "1050002";
};
export declare const SessionCreateCodes: {
    /** 会话创建失败 */
    readonly SESSION_CREATE_FAILED: "1050101";
};
export declare const SessionVerificationCodes: {
    /** 会话验证失败 */
    readonly SESSION_VERIFICATION_FAILED: "1050201";
    /** 会话签名无效 */
    readonly SESSION_SIGNATURE_INVALID: "1050202";
};
export declare const SessionStateCodes: {
    /** 会话已过期 */
    readonly SESSION_EXPIRED: "1050301";
    /** 会话已失效 */
    readonly SESSION_REVOKED: "1050302";
    /** 会话已被禁用 */
    readonly SESSION_DISABLED: "1050303";
};
export declare const SessionRefreshCodes: {
    /** 会话续期失败 */
    readonly SESSION_REFRESH_FAILED: "1050401";
    /** 当前无法续期会话 */
    readonly SESSION_REFRESH_NOT_ALLOWED: "1050402";
};
export declare const SessionTerminateCodes: {
    /** 会话终止失败 */
    readonly SESSION_TERMINATE_FAILED: "1050501";
};
export declare const PermissionGeneralCodes: {
    /** 无权限 */
    readonly PERMISSION_DENIED: "1060001";
    /** 权限无效 */
    readonly PERMISSION_INVALID: "1060002";
};
export declare const PermissionCheckCodes: {
    /** 权限验证失败 */
    readonly PERMISSION_CHECK_FAILED: "1060101";
    /** 权限不存在 */
    readonly PERMISSION_NOT_FOUND: "1060102";
};
export declare const PermissionGrantCodes: {
    /** 权限授予失败 */
    readonly PERMISSION_GRANT_FAILED: "1060201";
};
export declare const PermissionRevokeCodes: {
    /** 权限撤销失败 */
    readonly PERMISSION_REVOKE_FAILED: "1060301";
};
export declare const PermissionPolicyCodes: {
    /** 权限策略无效 */
    readonly PERMISSION_POLICY_INVALID: "1060401";
    /** 权限策略不存在 */
    readonly PERMISSION_POLICY_NOT_FOUND: "1060402";
};
export declare const PermissionInheritCodes: {
    /** 权限继承失败 */
    readonly PERMISSION_INHERIT_FAILED: "1060501";
};
export declare const IdentityServiceCodes: {
    /** 统一身份服务发生错误 */
    readonly IDENTITY_SERVICE_ERROR: "1070001";
    /** 统一身份服务暂不可用 */
    readonly IDENTITY_SERVICE_UNAVAILABLE: "1070002";
    /** 统一身份认证失败 */
    readonly IDENTITY_AUTHENTICATION_FAILED: "1070003";
};
export interface CodeMetadata {
    code: string;
    type: string;
    title: string;
    detail: string;
    httpStatus: number;
}
export declare const HTTP_STATUS_MAP: Record<string, number>;
export declare const CODE_METADATA: Record<string, CodeMetadata>;
/**
 * 根据状态码获取 HTTP 状态码
 */
export declare function getHttpStatusCode(code: string): number;
/**
 * 根据状态码获取元数据
 */
export declare function getCodeMetadata(code: string): CodeMetadata | undefined;
/**
 * 根据状态码获取中文描述
 */
export declare function getCodeDetail(code: string): string;
/**
 * 根据状态码获取 RFC 7807 type URL
 */
export declare function getCodeType(code: string): string | undefined;
/**
 * 根据状态码获取英文标题
 */
export declare function getCodeTitle(code: string): string | undefined;
