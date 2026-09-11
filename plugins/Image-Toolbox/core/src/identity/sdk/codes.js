/**
 * Teaven Identity 统一状态码定义
 * 来源: https://problems.moruteaven.com/codes.json
 * RFC 7807 Problem Details 风格错误码
 */
// ============================================================
// 系统级状态码 (000xxxx)
// ============================================================
export const SystemCodes = {
    /** 成功 */
    SUCCESS: "0000000",
    /** 请求参数无效 */
    INVALID_PARAMETER: "0000002",
    /** 服务暂时不可用，请稍后重试 */
    INTERNAL_ERROR: "0000500",
};
// ============================================================
// 用户身份通用状态码 (1000xxx)
// ============================================================
export const IdentityGeneralCodes = {
    /** 用户身份操作失败 */
    IDENTITY_ERROR: "1000001",
    /** 用户身份不存在 */
    IDENTITY_NOT_FOUND: "1000002",
    /** 用户身份无效 */
    IDENTITY_INVALID: "1000003",
    /** 用户身份服务暂不可用 */
    IDENTITY_UNAVAILABLE: "1000004",
    /** 用户身份发生冲突 */
    IDENTITY_CONFLICT: "1000005",
};
// ============================================================
// 用户相关状态码 (101xxxx)
// ============================================================
export const UserGeneralCodes = {
    /** 用户不存在 */
    USER_NOT_FOUND: "1010001",
    /** 用户已存在 */
    USER_ALREADY_EXISTS: "1010002",
    /** 用户操作失败 */
    USER_OPERATION_FAILED: "1010003",
};
export const UserInfoCodes = {
    /** 用户信息不存在 */
    USER_INFO_NOT_FOUND: "1010101",
    /** 用户信息无效 */
    USER_INFO_INVALID: "1010102",
    /** 用户信息更新失败 */
    USER_INFO_UPDATE_FAILED: "1010103",
};
export const UserStatusCodes = {
    /** 用户已被禁用 */
    USER_DISABLED: "1010201",
    /** 用户已注销 */
    USER_DELETED: "1010202",
    /** 用户已被暂停使用 */
    USER_SUSPENDED: "1010203",
    /** 用户状态无效 */
    USER_STATUS_INVALID: "1010204",
};
export const UserIdCodes = {
    /** 用户 ID 无效 */
    USER_ID_INVALID: "1010301",
    /** 用户 ID 不存在 */
    USER_ID_NOT_FOUND: "1010302",
    /** 用户 ID 冲突 */
    USER_ID_CONFLICT: "1010303",
};
export const UserAttributeCodes = {
    /** 用户属性无效 */
    USER_ATTRIBUTE_INVALID: "1010401",
    /** 用户属性不存在 */
    USER_ATTRIBUTE_NOT_FOUND: "1010402",
    /** 用户属性更新失败 */
    USER_ATTRIBUTE_UPDATE_FAILED: "1010403",
};
export const UserRelationCodes = {
    /** 用户关系不存在 */
    USER_RELATION_NOT_FOUND: "1010501",
    /** 用户关系已存在 */
    USER_RELATION_ALREADY_EXISTS: "1010502",
    /** 用户关系无效 */
    USER_RELATION_INVALID: "1010503",
};
// ============================================================
// 注册相关状态码 (102xxxx)
// ============================================================
export const RegistrationGeneralCodes = {
    /** 注册失败 */
    REGISTRATION_FAILED: "1020001",
    /** 注册信息无效 */
    REGISTRATION_INVALID: "1020002",
    /** 当前暂不支持注册 */
    REGISTRATION_UNAVAILABLE: "1020003",
};
export const RegistrationFlowCodes = {
    /** 注册流程无效 */
    REGISTRATION_STEP_INVALID: "1020101",
    /** 注册流程已过期 */
    REGISTRATION_STEP_EXPIRED: "1020102",
    /** 当前无法进行此注册操作 */
    REGISTRATION_STEP_NOT_ALLOWED: "1020103",
};
export const RegistrationVerificationCodes = {
    /** 请完成注册验证 */
    REGISTRATION_VERIFICATION_REQUIRED: "1020201",
    /** 注册验证失败 */
    REGISTRATION_VERIFICATION_FAILED: "1020202",
    /** 注册验证已过期 */
    REGISTRATION_VERIFICATION_EXPIRED: "1020203",
};
export const RegistrationMethodCodes = {
    /** 不支持该注册方式 */
    REGISTRATION_METHOD_NOT_SUPPORTED: "1020301",
    /** 注册方式无效 */
    REGISTRATION_METHOD_INVALID: "1020302",
};
export const RegistrationLimitCodes = {
    /** 已超过注册限制 */
    REGISTRATION_LIMIT_EXCEEDED: "1020401",
    /** 当前不允许注册 */
    REGISTRATION_NOT_ALLOWED: "1020402",
};
export const RegistrationStatusCodes = {
    /** 注册已完成 */
    REGISTRATION_ALREADY_COMPLETED: "1020501",
    /** 注册正在处理中 */
    REGISTRATION_PENDING: "1020502",
    /** 注册已过期 */
    REGISTRATION_EXPIRED: "1020503",
};
// ============================================================
// 登录相关状态码 (103xxxx)
// ============================================================
export const LoginGeneralCodes = {
    /** 登录失败 */
    LOGIN_FAILED: "1030001",
    /** 当前不允许登录 */
    LOGIN_NOT_ALLOWED: "1030002",
};
export const LoginFlowCodes = {
    /** 登录流程无效 */
    LOGIN_STEP_INVALID: "1030101",
    /** 登录流程已过期 */
    LOGIN_STEP_EXPIRED: "1030102",
};
export const LoginMethodCodes = {
    /** 不支持该登录方式 */
    LOGIN_METHOD_NOT_SUPPORTED: "1030201",
    /** 登录方式无效 */
    LOGIN_METHOD_INVALID: "1030202",
};
export const LoginVerificationCodes = {
    /** 登录验证失败 */
    LOGIN_VERIFICATION_FAILED: "1030301",
    /** 请完成登录验证 */
    LOGIN_VERIFICATION_REQUIRED: "1030302",
    /** 登录验证已过期 */
    LOGIN_VERIFICATION_EXPIRED: "1030303",
};
export const LoginStateCodes = {
    /** 需要登录 */
    LOGIN_REQUIRED: "1030401",
    /** 登录状态无效 */
    LOGIN_STATE_INVALID: "1030402",
    /** 登录状态已过期 */
    LOGIN_STATE_EXPIRED: "1030403",
};
export const LoginLimitCodes = {
    /** 登录次数已超过限制 */
    LOGIN_LIMIT_EXCEEDED: "1030501",
    /** 登录暂时被限制 */
    LOGIN_TEMPORARILY_BLOCKED: "1030502",
};
// ============================================================
// OAuth 相关状态码 (104xxxx)
// ============================================================
export const OAuthGeneralCodes = {
    /** OAuth 操作失败 */
    OAUTH_ERROR: "1040001",
    /** 不支持该 OAuth 操作 */
    OAUTH_NOT_SUPPORTED: "1040002",
};
export const OAuthClientCodes = {
    /** OAuth 客户端不存在 */
    OAUTH_CLIENT_NOT_FOUND: "1040101",
    /** OAuth 客户端无效 */
    OAUTH_CLIENT_INVALID: "1040102",
    /** OAuth 客户端已禁用 */
    OAUTH_CLIENT_DISABLED: "1040103",
};
export const OAuthAuthorizationCodes = {
    /** OAuth 授权失败 */
    OAUTH_AUTHORIZATION_FAILED: "1040201",
    /** 用户拒绝授权 */
    OAUTH_AUTHORIZATION_DENIED: "1040202",
    /** OAuth 授权已过期 */
    OAUTH_AUTHORIZATION_EXPIRED: "1040203",
};
export const OAuthCodeCodes = {
    /** OAuth 授权码无效 */
    OAUTH_CODE_INVALID: "1040301",
    /** OAuth 授权码已过期 */
    OAUTH_CODE_EXPIRED: "1040302",
    /** OAuth 授权码已使用 */
    OAUTH_CODE_ALREADY_USED: "1040303",
};
export const OAuthScopeCodes = {
    /** OAuth 权限范围无效 */
    OAUTH_SCOPE_INVALID: "1040401",
    /** OAuth 权限范围不足 */
    OAUTH_SCOPE_INSUFFICIENT: "1040402",
};
export const OAuthProviderCodes = {
    /** OAuth 服务提供方不存在 */
    OAUTH_PROVIDER_NOT_FOUND: "1040501",
    /** OAuth 服务提供方暂不可用 */
    OAUTH_PROVIDER_UNAVAILABLE: "1040502",
    /** OAuth 服务提供方发生错误 */
    OAUTH_PROVIDER_ERROR: "1040503",
};
// ============================================================
// 会话相关状态码 (105xxxx)
// ============================================================
export const SessionGeneralCodes = {
    /** 会话无效 */
    SESSION_INVALID: "1050001",
    /** 会话不存在 */
    SESSION_NOT_FOUND: "1050002",
};
export const SessionCreateCodes = {
    /** 会话创建失败 */
    SESSION_CREATE_FAILED: "1050101",
};
export const SessionVerificationCodes = {
    /** 会话验证失败 */
    SESSION_VERIFICATION_FAILED: "1050201",
    /** 会话签名无效 */
    SESSION_SIGNATURE_INVALID: "1050202",
};
export const SessionStateCodes = {
    /** 会话已过期 */
    SESSION_EXPIRED: "1050301",
    /** 会话已失效 */
    SESSION_REVOKED: "1050302",
    /** 会话已被禁用 */
    SESSION_DISABLED: "1050303",
};
export const SessionRefreshCodes = {
    /** 会话续期失败 */
    SESSION_REFRESH_FAILED: "1050401",
    /** 当前无法续期会话 */
    SESSION_REFRESH_NOT_ALLOWED: "1050402",
};
export const SessionTerminateCodes = {
    /** 会话终止失败 */
    SESSION_TERMINATE_FAILED: "1050501",
};
// ============================================================
// 权限相关状态码 (106xxxx)
// ============================================================
export const PermissionGeneralCodes = {
    /** 无权限 */
    PERMISSION_DENIED: "1060001",
    /** 权限无效 */
    PERMISSION_INVALID: "1060002",
};
export const PermissionCheckCodes = {
    /** 权限验证失败 */
    PERMISSION_CHECK_FAILED: "1060101",
    /** 权限不存在 */
    PERMISSION_NOT_FOUND: "1060102",
};
export const PermissionGrantCodes = {
    /** 权限授予失败 */
    PERMISSION_GRANT_FAILED: "1060201",
};
export const PermissionRevokeCodes = {
    /** 权限撤销失败 */
    PERMISSION_REVOKE_FAILED: "1060301",
};
export const PermissionPolicyCodes = {
    /** 权限策略无效 */
    PERMISSION_POLICY_INVALID: "1060401",
    /** 权限策略不存在 */
    PERMISSION_POLICY_NOT_FOUND: "1060402",
};
export const PermissionInheritCodes = {
    /** 权限继承失败 */
    PERMISSION_INHERIT_FAILED: "1060501",
};
// ============================================================
// 统一身份服务状态码 (107xxxx)
// ============================================================
export const IdentityServiceCodes = {
    /** 统一身份服务发生错误 */
    IDENTITY_SERVICE_ERROR: "1070001",
    /** 统一身份服务暂不可用 */
    IDENTITY_SERVICE_UNAVAILABLE: "1070002",
    /** 统一身份认证失败 */
    IDENTITY_AUTHENTICATION_FAILED: "1070003",
};
// ============================================================
// 状态码到 HTTP 状态码的映射
// ============================================================
export const HTTP_STATUS_MAP = {
    // 系统级
    [SystemCodes.SUCCESS]: 200,
    [SystemCodes.INVALID_PARAMETER]: 400,
    [SystemCodes.INTERNAL_ERROR]: 500,
    // 用户身份通用
    [IdentityGeneralCodes.IDENTITY_ERROR]: 500,
    [IdentityGeneralCodes.IDENTITY_NOT_FOUND]: 404,
    [IdentityGeneralCodes.IDENTITY_INVALID]: 400,
    [IdentityGeneralCodes.IDENTITY_UNAVAILABLE]: 503,
    [IdentityGeneralCodes.IDENTITY_CONFLICT]: 409,
    // 用户相关
    [UserGeneralCodes.USER_NOT_FOUND]: 404,
    [UserGeneralCodes.USER_ALREADY_EXISTS]: 409,
    [UserGeneralCodes.USER_OPERATION_FAILED]: 500,
    [UserInfoCodes.USER_INFO_NOT_FOUND]: 404,
    [UserInfoCodes.USER_INFO_INVALID]: 400,
    [UserInfoCodes.USER_INFO_UPDATE_FAILED]: 500,
    [UserStatusCodes.USER_DISABLED]: 403,
    [UserStatusCodes.USER_DELETED]: 403,
    [UserStatusCodes.USER_SUSPENDED]: 403,
    [UserStatusCodes.USER_STATUS_INVALID]: 400,
    [UserIdCodes.USER_ID_INVALID]: 400,
    [UserIdCodes.USER_ID_NOT_FOUND]: 404,
    [UserIdCodes.USER_ID_CONFLICT]: 409,
    [UserAttributeCodes.USER_ATTRIBUTE_INVALID]: 400,
    [UserAttributeCodes.USER_ATTRIBUTE_NOT_FOUND]: 404,
    [UserAttributeCodes.USER_ATTRIBUTE_UPDATE_FAILED]: 500,
    [UserRelationCodes.USER_RELATION_NOT_FOUND]: 404,
    [UserRelationCodes.USER_RELATION_ALREADY_EXISTS]: 409,
    [UserRelationCodes.USER_RELATION_INVALID]: 400,
    // 注册
    [RegistrationGeneralCodes.REGISTRATION_FAILED]: 500,
    [RegistrationGeneralCodes.REGISTRATION_INVALID]: 400,
    [RegistrationGeneralCodes.REGISTRATION_UNAVAILABLE]: 503,
    [RegistrationFlowCodes.REGISTRATION_STEP_INVALID]: 400,
    [RegistrationFlowCodes.REGISTRATION_STEP_EXPIRED]: 400,
    [RegistrationFlowCodes.REGISTRATION_STEP_NOT_ALLOWED]: 403,
    [RegistrationVerificationCodes.REGISTRATION_VERIFICATION_REQUIRED]: 400,
    [RegistrationVerificationCodes.REGISTRATION_VERIFICATION_FAILED]: 400,
    [RegistrationVerificationCodes.REGISTRATION_VERIFICATION_EXPIRED]: 400,
    [RegistrationMethodCodes.REGISTRATION_METHOD_NOT_SUPPORTED]: 400,
    [RegistrationMethodCodes.REGISTRATION_METHOD_INVALID]: 400,
    [RegistrationLimitCodes.REGISTRATION_LIMIT_EXCEEDED]: 429,
    [RegistrationLimitCodes.REGISTRATION_NOT_ALLOWED]: 403,
    [RegistrationStatusCodes.REGISTRATION_ALREADY_COMPLETED]: 409,
    [RegistrationStatusCodes.REGISTRATION_PENDING]: 202,
    [RegistrationStatusCodes.REGISTRATION_EXPIRED]: 400,
    // 登录
    [LoginGeneralCodes.LOGIN_FAILED]: 401,
    [LoginGeneralCodes.LOGIN_NOT_ALLOWED]: 403,
    [LoginFlowCodes.LOGIN_STEP_INVALID]: 400,
    [LoginFlowCodes.LOGIN_STEP_EXPIRED]: 400,
    [LoginMethodCodes.LOGIN_METHOD_NOT_SUPPORTED]: 400,
    [LoginMethodCodes.LOGIN_METHOD_INVALID]: 400,
    [LoginVerificationCodes.LOGIN_VERIFICATION_FAILED]: 401,
    [LoginVerificationCodes.LOGIN_VERIFICATION_REQUIRED]: 401,
    [LoginVerificationCodes.LOGIN_VERIFICATION_EXPIRED]: 401,
    [LoginStateCodes.LOGIN_REQUIRED]: 401,
    [LoginStateCodes.LOGIN_STATE_INVALID]: 401,
    [LoginStateCodes.LOGIN_STATE_EXPIRED]: 401,
    [LoginLimitCodes.LOGIN_LIMIT_EXCEEDED]: 429,
    [LoginLimitCodes.LOGIN_TEMPORARILY_BLOCKED]: 429,
    // OAuth
    [OAuthGeneralCodes.OAUTH_ERROR]: 500,
    [OAuthGeneralCodes.OAUTH_NOT_SUPPORTED]: 400,
    [OAuthClientCodes.OAUTH_CLIENT_NOT_FOUND]: 404,
    [OAuthClientCodes.OAUTH_CLIENT_INVALID]: 400,
    [OAuthClientCodes.OAUTH_CLIENT_DISABLED]: 403,
    [OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_FAILED]: 400,
    [OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_DENIED]: 403,
    [OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_EXPIRED]: 400,
    [OAuthCodeCodes.OAUTH_CODE_INVALID]: 400,
    [OAuthCodeCodes.OAUTH_CODE_EXPIRED]: 400,
    [OAuthCodeCodes.OAUTH_CODE_ALREADY_USED]: 400,
    [OAuthScopeCodes.OAUTH_SCOPE_INVALID]: 400,
    [OAuthScopeCodes.OAUTH_SCOPE_INSUFFICIENT]: 403,
    [OAuthProviderCodes.OAUTH_PROVIDER_NOT_FOUND]: 404,
    [OAuthProviderCodes.OAUTH_PROVIDER_UNAVAILABLE]: 502,
    [OAuthProviderCodes.OAUTH_PROVIDER_ERROR]: 502,
    // 会话
    [SessionGeneralCodes.SESSION_INVALID]: 401,
    [SessionGeneralCodes.SESSION_NOT_FOUND]: 404,
    [SessionCreateCodes.SESSION_CREATE_FAILED]: 500,
    [SessionVerificationCodes.SESSION_VERIFICATION_FAILED]: 401,
    [SessionVerificationCodes.SESSION_SIGNATURE_INVALID]: 401,
    [SessionStateCodes.SESSION_EXPIRED]: 401,
    [SessionStateCodes.SESSION_REVOKED]: 401,
    [SessionStateCodes.SESSION_DISABLED]: 403,
    [SessionRefreshCodes.SESSION_REFRESH_FAILED]: 401,
    [SessionRefreshCodes.SESSION_REFRESH_NOT_ALLOWED]: 403,
    [SessionTerminateCodes.SESSION_TERMINATE_FAILED]: 500,
    // 权限
    [PermissionGeneralCodes.PERMISSION_DENIED]: 403,
    [PermissionGeneralCodes.PERMISSION_INVALID]: 400,
    [PermissionCheckCodes.PERMISSION_CHECK_FAILED]: 403,
    [PermissionCheckCodes.PERMISSION_NOT_FOUND]: 404,
    [PermissionGrantCodes.PERMISSION_GRANT_FAILED]: 500,
    [PermissionRevokeCodes.PERMISSION_REVOKE_FAILED]: 500,
    [PermissionPolicyCodes.PERMISSION_POLICY_INVALID]: 400,
    [PermissionPolicyCodes.PERMISSION_POLICY_NOT_FOUND]: 404,
    [PermissionInheritCodes.PERMISSION_INHERIT_FAILED]: 500,
    // 统一身份服务
    [IdentityServiceCodes.IDENTITY_SERVICE_ERROR]: 500,
    [IdentityServiceCodes.IDENTITY_SERVICE_UNAVAILABLE]: 503,
    [IdentityServiceCodes.IDENTITY_AUTHENTICATION_FAILED]: 401,
};
// ============================================================
// 状态码元数据
// ============================================================
export const CODE_METADATA = {
    [SystemCodes.SUCCESS]: { code: SystemCodes.SUCCESS, type: "https://problems.moruteaven.com/system/general/success", title: "SUCCESS", detail: "成功", httpStatus: 200 },
    [SystemCodes.INVALID_PARAMETER]: { code: SystemCodes.INVALID_PARAMETER, type: "https://problems.moruteaven.com/system/general/invalid-parameter", title: "INVALID_PARAMETER", detail: "请求参数无效", httpStatus: 400 },
    [SystemCodes.INTERNAL_ERROR]: { code: SystemCodes.INTERNAL_ERROR, type: "https://problems.moruteaven.com/system/internal/internal-error", title: "INTERNAL_ERROR", detail: "服务暂时不可用，请稍后重试", httpStatus: 500 },
    [IdentityGeneralCodes.IDENTITY_ERROR]: { code: IdentityGeneralCodes.IDENTITY_ERROR, type: "https://problems.moruteaven.com/user-identity/general/general/identity-error", title: "IDENTITY_ERROR", detail: "用户身份操作失败", httpStatus: 500 },
    [IdentityGeneralCodes.IDENTITY_NOT_FOUND]: { code: IdentityGeneralCodes.IDENTITY_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/general/general/identity-not-found", title: "IDENTITY_NOT_FOUND", detail: "用户身份不存在", httpStatus: 404 },
    [IdentityGeneralCodes.IDENTITY_INVALID]: { code: IdentityGeneralCodes.IDENTITY_INVALID, type: "https://problems.moruteaven.com/user-identity/general/general/identity-invalid", title: "IDENTITY_INVALID", detail: "用户身份无效", httpStatus: 400 },
    [IdentityGeneralCodes.IDENTITY_UNAVAILABLE]: { code: IdentityGeneralCodes.IDENTITY_UNAVAILABLE, type: "https://problems.moruteaven.com/user-identity/general/general/identity-unavailable", title: "IDENTITY_UNAVAILABLE", detail: "用户身份服务暂不可用", httpStatus: 503 },
    [IdentityGeneralCodes.IDENTITY_CONFLICT]: { code: IdentityGeneralCodes.IDENTITY_CONFLICT, type: "https://problems.moruteaven.com/user-identity/general/general/identity-conflict", title: "IDENTITY_CONFLICT", detail: "用户身份发生冲突", httpStatus: 409 },
    [UserGeneralCodes.USER_NOT_FOUND]: { code: UserGeneralCodes.USER_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/user/general/user-not-found", title: "USER_NOT_FOUND", detail: "用户不存在", httpStatus: 404 },
    [UserGeneralCodes.USER_ALREADY_EXISTS]: { code: UserGeneralCodes.USER_ALREADY_EXISTS, type: "https://problems.moruteaven.com/user-identity/user/general/user-already-exists", title: "USER_ALREADY_EXISTS", detail: "用户已存在", httpStatus: 409 },
    [UserGeneralCodes.USER_OPERATION_FAILED]: { code: UserGeneralCodes.USER_OPERATION_FAILED, type: "https://problems.moruteaven.com/user-identity/user/general/user-operation-failed", title: "USER_OPERATION_FAILED", detail: "用户操作失败", httpStatus: 500 },
    [UserInfoCodes.USER_INFO_NOT_FOUND]: { code: UserInfoCodes.USER_INFO_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/user/info/not-found", title: "USER_INFO_NOT_FOUND", detail: "用户信息不存在", httpStatus: 404 },
    [UserInfoCodes.USER_INFO_INVALID]: { code: UserInfoCodes.USER_INFO_INVALID, type: "https://problems.moruteaven.com/user-identity/user/info/invalid", title: "USER_INFO_INVALID", detail: "用户信息无效", httpStatus: 400 },
    [UserInfoCodes.USER_INFO_UPDATE_FAILED]: { code: UserInfoCodes.USER_INFO_UPDATE_FAILED, type: "https://problems.moruteaven.com/user-identity/user/info/update-failed", title: "USER_INFO_UPDATE_FAILED", detail: "用户信息更新失败", httpStatus: 500 },
    [UserStatusCodes.USER_DISABLED]: { code: UserStatusCodes.USER_DISABLED, type: "https://problems.moruteaven.com/user-identity/user/status/user-disabled", title: "USER_DISABLED", detail: "用户已被禁用", httpStatus: 403 },
    [UserStatusCodes.USER_DELETED]: { code: UserStatusCodes.USER_DELETED, type: "https://problems.moruteaven.com/user-identity/user/status/user-deleted", title: "USER_DELETED", detail: "用户已注销", httpStatus: 403 },
    [UserStatusCodes.USER_SUSPENDED]: { code: UserStatusCodes.USER_SUSPENDED, type: "https://problems.moruteaven.com/user-identity/user/status/user-suspended", title: "USER_SUSPENDED", detail: "用户已被暂停使用", httpStatus: 403 },
    [UserStatusCodes.USER_STATUS_INVALID]: { code: UserStatusCodes.USER_STATUS_INVALID, type: "https://problems.moruteaven.com/user-identity/user/status/invalid", title: "USER_STATUS_INVALID", detail: "用户状态无效", httpStatus: 400 },
    [UserIdCodes.USER_ID_INVALID]: { code: UserIdCodes.USER_ID_INVALID, type: "https://problems.moruteaven.com/user-identity/user/identifier/user-id-invalid", title: "USER_ID_INVALID", detail: "用户 ID 无效", httpStatus: 400 },
    [UserIdCodes.USER_ID_NOT_FOUND]: { code: UserIdCodes.USER_ID_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/user/identifier/user-id-not-found", title: "USER_ID_NOT_FOUND", detail: "用户 ID 不存在", httpStatus: 404 },
    [UserIdCodes.USER_ID_CONFLICT]: { code: UserIdCodes.USER_ID_CONFLICT, type: "https://problems.moruteaven.com/user-identity/user/identifier/user-id-conflict", title: "USER_ID_CONFLICT", detail: "用户 ID 冲突", httpStatus: 409 },
    [UserAttributeCodes.USER_ATTRIBUTE_INVALID]: { code: UserAttributeCodes.USER_ATTRIBUTE_INVALID, type: "https://problems.moruteaven.com/user-identity/user/attribute/invalid", title: "USER_ATTRIBUTE_INVALID", detail: "用户属性无效", httpStatus: 400 },
    [UserAttributeCodes.USER_ATTRIBUTE_NOT_FOUND]: { code: UserAttributeCodes.USER_ATTRIBUTE_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/user/attribute/not-found", title: "USER_ATTRIBUTE_NOT_FOUND", detail: "用户属性不存在", httpStatus: 404 },
    [UserAttributeCodes.USER_ATTRIBUTE_UPDATE_FAILED]: { code: UserAttributeCodes.USER_ATTRIBUTE_UPDATE_FAILED, type: "https://problems.moruteaven.com/user-identity/user/attribute/update-failed", title: "USER_ATTRIBUTE_UPDATE_FAILED", detail: "用户属性更新失败", httpStatus: 500 },
    [UserRelationCodes.USER_RELATION_NOT_FOUND]: { code: UserRelationCodes.USER_RELATION_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/user/relation/not-found", title: "USER_RELATION_NOT_FOUND", detail: "用户关系不存在", httpStatus: 404 },
    [UserRelationCodes.USER_RELATION_ALREADY_EXISTS]: { code: UserRelationCodes.USER_RELATION_ALREADY_EXISTS, type: "https://problems.moruteaven.com/user-identity/user/relation/already-exists", title: "USER_RELATION_ALREADY_EXISTS", detail: "用户关系已存在", httpStatus: 409 },
    [UserRelationCodes.USER_RELATION_INVALID]: { code: UserRelationCodes.USER_RELATION_INVALID, type: "https://problems.moruteaven.com/user-identity/user/relation/invalid", title: "USER_RELATION_INVALID", detail: "用户关系无效", httpStatus: 400 },
    [RegistrationGeneralCodes.REGISTRATION_FAILED]: { code: RegistrationGeneralCodes.REGISTRATION_FAILED, type: "https://problems.moruteaven.com/user-identity/registration/general/registration-failed", title: "REGISTRATION_FAILED", detail: "注册失败", httpStatus: 500 },
    [RegistrationGeneralCodes.REGISTRATION_INVALID]: { code: RegistrationGeneralCodes.REGISTRATION_INVALID, type: "https://problems.moruteaven.com/user-identity/registration/general/registration-invalid", title: "REGISTRATION_INVALID", detail: "注册信息无效", httpStatus: 400 },
    [RegistrationGeneralCodes.REGISTRATION_UNAVAILABLE]: { code: RegistrationGeneralCodes.REGISTRATION_UNAVAILABLE, type: "https://problems.moruteaven.com/user-identity/registration/general/registration-unavailable", title: "REGISTRATION_UNAVAILABLE", detail: "当前暂不支持注册", httpStatus: 503 },
    [RegistrationFlowCodes.REGISTRATION_STEP_INVALID]: { code: RegistrationFlowCodes.REGISTRATION_STEP_INVALID, type: "https://problems.moruteaven.com/user-identity/registration/flow/registration-step-invalid", title: "REGISTRATION_STEP_INVALID", detail: "注册流程无效", httpStatus: 400 },
    [RegistrationFlowCodes.REGISTRATION_STEP_EXPIRED]: { code: RegistrationFlowCodes.REGISTRATION_STEP_EXPIRED, type: "https://problems.moruteaven.com/user-identity/registration/flow/registration-step-expired", title: "REGISTRATION_STEP_EXPIRED", detail: "注册流程已过期", httpStatus: 400 },
    [RegistrationFlowCodes.REGISTRATION_STEP_NOT_ALLOWED]: { code: RegistrationFlowCodes.REGISTRATION_STEP_NOT_ALLOWED, type: "https://problems.moruteaven.com/user-identity/registration/flow/registration-step-not-allowed", title: "REGISTRATION_STEP_NOT_ALLOWED", detail: "当前无法进行此注册操作", httpStatus: 403 },
    [RegistrationVerificationCodes.REGISTRATION_VERIFICATION_REQUIRED]: { code: RegistrationVerificationCodes.REGISTRATION_VERIFICATION_REQUIRED, type: "https://problems.moruteaven.com/user-identity/registration/verification/required", title: "REGISTRATION_VERIFICATION_REQUIRED", detail: "请完成注册验证", httpStatus: 400 },
    [RegistrationVerificationCodes.REGISTRATION_VERIFICATION_FAILED]: { code: RegistrationVerificationCodes.REGISTRATION_VERIFICATION_FAILED, type: "https://problems.moruteaven.com/user-identity/registration/verification/failed", title: "REGISTRATION_VERIFICATION_FAILED", detail: "注册验证失败", httpStatus: 400 },
    [RegistrationVerificationCodes.REGISTRATION_VERIFICATION_EXPIRED]: { code: RegistrationVerificationCodes.REGISTRATION_VERIFICATION_EXPIRED, type: "https://problems.moruteaven.com/user-identity/registration/verification/expired", title: "REGISTRATION_VERIFICATION_EXPIRED", detail: "注册验证已过期", httpStatus: 400 },
    [RegistrationMethodCodes.REGISTRATION_METHOD_NOT_SUPPORTED]: { code: RegistrationMethodCodes.REGISTRATION_METHOD_NOT_SUPPORTED, type: "https://problems.moruteaven.com/user-identity/registration/method/not-supported", title: "REGISTRATION_METHOD_NOT_SUPPORTED", detail: "不支持该注册方式", httpStatus: 400 },
    [RegistrationMethodCodes.REGISTRATION_METHOD_INVALID]: { code: RegistrationMethodCodes.REGISTRATION_METHOD_INVALID, type: "https://problems.moruteaven.com/user-identity/registration/method/invalid", title: "REGISTRATION_METHOD_INVALID", detail: "注册方式无效", httpStatus: 400 },
    [RegistrationLimitCodes.REGISTRATION_LIMIT_EXCEEDED]: { code: RegistrationLimitCodes.REGISTRATION_LIMIT_EXCEEDED, type: "https://problems.moruteaven.com/user-identity/registration/limit/exceeded", title: "REGISTRATION_LIMIT_EXCEEDED", detail: "已超过注册限制", httpStatus: 429 },
    [RegistrationLimitCodes.REGISTRATION_NOT_ALLOWED]: { code: RegistrationLimitCodes.REGISTRATION_NOT_ALLOWED, type: "https://problems.moruteaven.com/user-identity/registration/limit/registration-not-allowed", title: "REGISTRATION_NOT_ALLOWED", detail: "当前不允许注册", httpStatus: 403 },
    [RegistrationStatusCodes.REGISTRATION_ALREADY_COMPLETED]: { code: RegistrationStatusCodes.REGISTRATION_ALREADY_COMPLETED, type: "https://problems.moruteaven.com/user-identity/registration/status/registration-already-completed", title: "REGISTRATION_ALREADY_COMPLETED", detail: "注册已完成", httpStatus: 409 },
    [RegistrationStatusCodes.REGISTRATION_PENDING]: { code: RegistrationStatusCodes.REGISTRATION_PENDING, type: "https://problems.moruteaven.com/user-identity/registration/status/registration-pending", title: "REGISTRATION_PENDING", detail: "注册正在处理中", httpStatus: 202 },
    [RegistrationStatusCodes.REGISTRATION_EXPIRED]: { code: RegistrationStatusCodes.REGISTRATION_EXPIRED, type: "https://problems.moruteaven.com/user-identity/registration/status/registration-expired", title: "REGISTRATION_EXPIRED", detail: "注册已过期", httpStatus: 400 },
    [LoginGeneralCodes.LOGIN_FAILED]: { code: LoginGeneralCodes.LOGIN_FAILED, type: "https://problems.moruteaven.com/user-identity/login/general/login-failed", title: "LOGIN_FAILED", detail: "登录失败", httpStatus: 401 },
    [LoginGeneralCodes.LOGIN_NOT_ALLOWED]: { code: LoginGeneralCodes.LOGIN_NOT_ALLOWED, type: "https://problems.moruteaven.com/user-identity/login/general/login-not-allowed", title: "LOGIN_NOT_ALLOWED", detail: "当前不允许登录", httpStatus: 403 },
    [LoginFlowCodes.LOGIN_STEP_INVALID]: { code: LoginFlowCodes.LOGIN_STEP_INVALID, type: "https://problems.moruteaven.com/user-identity/login/flow/login-step-invalid", title: "LOGIN_STEP_INVALID", detail: "登录流程无效", httpStatus: 400 },
    [LoginFlowCodes.LOGIN_STEP_EXPIRED]: { code: LoginFlowCodes.LOGIN_STEP_EXPIRED, type: "https://problems.moruteaven.com/user-identity/login/flow/login-step-expired", title: "LOGIN_STEP_EXPIRED", detail: "登录流程已过期", httpStatus: 400 },
    [LoginMethodCodes.LOGIN_METHOD_NOT_SUPPORTED]: { code: LoginMethodCodes.LOGIN_METHOD_NOT_SUPPORTED, type: "https://problems.moruteaven.com/user-identity/login/method/not-supported", title: "LOGIN_METHOD_NOT_SUPPORTED", detail: "不支持该登录方式", httpStatus: 400 },
    [LoginMethodCodes.LOGIN_METHOD_INVALID]: { code: LoginMethodCodes.LOGIN_METHOD_INVALID, type: "https://problems.moruteaven.com/user-identity/login/method/invalid", title: "LOGIN_METHOD_INVALID", detail: "登录方式无效", httpStatus: 400 },
    [LoginVerificationCodes.LOGIN_VERIFICATION_FAILED]: { code: LoginVerificationCodes.LOGIN_VERIFICATION_FAILED, type: "https://problems.moruteaven.com/user-identity/login/verification/failed", title: "LOGIN_VERIFICATION_FAILED", detail: "登录验证失败", httpStatus: 401 },
    [LoginVerificationCodes.LOGIN_VERIFICATION_REQUIRED]: { code: LoginVerificationCodes.LOGIN_VERIFICATION_REQUIRED, type: "https://problems.moruteaven.com/user-identity/login/verification/required", title: "LOGIN_VERIFICATION_REQUIRED", detail: "请完成登录验证", httpStatus: 401 },
    [LoginVerificationCodes.LOGIN_VERIFICATION_EXPIRED]: { code: LoginVerificationCodes.LOGIN_VERIFICATION_EXPIRED, type: "https://problems.moruteaven.com/user-identity/login/verification/expired", title: "LOGIN_VERIFICATION_EXPIRED", detail: "登录验证已过期", httpStatus: 401 },
    [LoginStateCodes.LOGIN_REQUIRED]: { code: LoginStateCodes.LOGIN_REQUIRED, type: "https://problems.moruteaven.com/user-identity/login/state/login-required", title: "LOGIN_REQUIRED", detail: "需要登录", httpStatus: 401 },
    [LoginStateCodes.LOGIN_STATE_INVALID]: { code: LoginStateCodes.LOGIN_STATE_INVALID, type: "https://problems.moruteaven.com/user-identity/login/state/invalid", title: "LOGIN_STATE_INVALID", detail: "登录状态无效", httpStatus: 401 },
    [LoginStateCodes.LOGIN_STATE_EXPIRED]: { code: LoginStateCodes.LOGIN_STATE_EXPIRED, type: "https://problems.moruteaven.com/user-identity/login/state/expired", title: "LOGIN_STATE_EXPIRED", detail: "登录状态已过期", httpStatus: 401 },
    [LoginLimitCodes.LOGIN_LIMIT_EXCEEDED]: { code: LoginLimitCodes.LOGIN_LIMIT_EXCEEDED, type: "https://problems.moruteaven.com/user-identity/login/limit/exceeded", title: "LOGIN_LIMIT_EXCEEDED", detail: "登录次数已超过限制", httpStatus: 429 },
    [LoginLimitCodes.LOGIN_TEMPORARILY_BLOCKED]: { code: LoginLimitCodes.LOGIN_TEMPORARILY_BLOCKED, type: "https://problems.moruteaven.com/user-identity/login/limit/login-temporarily-blocked", title: "LOGIN_TEMPORARILY_BLOCKED", detail: "登录暂时被限制", httpStatus: 429 },
    [OAuthGeneralCodes.OAUTH_ERROR]: { code: OAuthGeneralCodes.OAUTH_ERROR, type: "https://problems.moruteaven.com/user-identity/oauth/general/oauth-error", title: "OAUTH_ERROR", detail: "OAuth 操作失败", httpStatus: 500 },
    [OAuthGeneralCodes.OAUTH_NOT_SUPPORTED]: { code: OAuthGeneralCodes.OAUTH_NOT_SUPPORTED, type: "https://problems.moruteaven.com/user-identity/oauth/general/oauth-not-supported", title: "OAUTH_NOT_SUPPORTED", detail: "不支持该 OAuth 操作", httpStatus: 400 },
    [OAuthClientCodes.OAUTH_CLIENT_NOT_FOUND]: { code: OAuthClientCodes.OAUTH_CLIENT_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/oauth/client/not-found", title: "OAUTH_CLIENT_NOT_FOUND", detail: "OAuth 客户端不存在", httpStatus: 404 },
    [OAuthClientCodes.OAUTH_CLIENT_INVALID]: { code: OAuthClientCodes.OAUTH_CLIENT_INVALID, type: "https://problems.moruteaven.com/user-identity/oauth/client/invalid", title: "OAUTH_CLIENT_INVALID", detail: "OAuth 客户端无效", httpStatus: 400 },
    [OAuthClientCodes.OAUTH_CLIENT_DISABLED]: { code: OAuthClientCodes.OAUTH_CLIENT_DISABLED, type: "https://problems.moruteaven.com/user-identity/oauth/client/disabled", title: "OAUTH_CLIENT_DISABLED", detail: "OAuth 客户端已禁用", httpStatus: 403 },
    [OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_FAILED]: { code: OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_FAILED, type: "https://problems.moruteaven.com/user-identity/oauth/authorization/failed", title: "OAUTH_AUTHORIZATION_FAILED", detail: "OAuth 授权失败", httpStatus: 400 },
    [OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_DENIED]: { code: OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_DENIED, type: "https://problems.moruteaven.com/user-identity/oauth/authorization/denied", title: "OAUTH_AUTHORIZATION_DENIED", detail: "用户拒绝授权", httpStatus: 403 },
    [OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_EXPIRED]: { code: OAuthAuthorizationCodes.OAUTH_AUTHORIZATION_EXPIRED, type: "https://problems.moruteaven.com/user-identity/oauth/authorization/expired", title: "OAUTH_AUTHORIZATION_EXPIRED", detail: "OAuth 授权已过期", httpStatus: 400 },
    [OAuthCodeCodes.OAUTH_CODE_INVALID]: { code: OAuthCodeCodes.OAUTH_CODE_INVALID, type: "https://problems.moruteaven.com/user-identity/oauth/code/invalid", title: "OAUTH_CODE_INVALID", detail: "OAuth 授权码无效", httpStatus: 400 },
    [OAuthCodeCodes.OAUTH_CODE_EXPIRED]: { code: OAuthCodeCodes.OAUTH_CODE_EXPIRED, type: "https://problems.moruteaven.com/user-identity/oauth/code/expired", title: "OAUTH_CODE_EXPIRED", detail: "OAuth 授权码已过期", httpStatus: 400 },
    [OAuthCodeCodes.OAUTH_CODE_ALREADY_USED]: { code: OAuthCodeCodes.OAUTH_CODE_ALREADY_USED, type: "https://problems.moruteaven.com/user-identity/oauth/code/already-used", title: "OAUTH_CODE_ALREADY_USED", detail: "OAuth 授权码已使用", httpStatus: 400 },
    [OAuthScopeCodes.OAUTH_SCOPE_INVALID]: { code: OAuthScopeCodes.OAUTH_SCOPE_INVALID, type: "https://problems.moruteaven.com/user-identity/oauth/scope/invalid", title: "OAUTH_SCOPE_INVALID", detail: "OAuth 权限范围无效", httpStatus: 400 },
    [OAuthScopeCodes.OAUTH_SCOPE_INSUFFICIENT]: { code: OAuthScopeCodes.OAUTH_SCOPE_INSUFFICIENT, type: "https://problems.moruteaven.com/user-identity/oauth/scope/insufficient", title: "OAUTH_SCOPE_INSUFFICIENT", detail: "OAuth 权限范围不足", httpStatus: 403 },
    [OAuthProviderCodes.OAUTH_PROVIDER_NOT_FOUND]: { code: OAuthProviderCodes.OAUTH_PROVIDER_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/oauth/provider/not-found", title: "OAUTH_PROVIDER_NOT_FOUND", detail: "OAuth 服务提供方不存在", httpStatus: 404 },
    [OAuthProviderCodes.OAUTH_PROVIDER_UNAVAILABLE]: { code: OAuthProviderCodes.OAUTH_PROVIDER_UNAVAILABLE, type: "https://problems.moruteaven.com/user-identity/oauth/provider/unavailable", title: "OAUTH_PROVIDER_UNAVAILABLE", detail: "OAuth 服务提供方暂不可用", httpStatus: 502 },
    [OAuthProviderCodes.OAUTH_PROVIDER_ERROR]: { code: OAuthProviderCodes.OAUTH_PROVIDER_ERROR, type: "https://problems.moruteaven.com/user-identity/oauth/provider/error", title: "OAUTH_PROVIDER_ERROR", detail: "OAuth 服务提供方发生错误", httpStatus: 502 },
    // 会话
    [SessionGeneralCodes.SESSION_INVALID]: { code: SessionGeneralCodes.SESSION_INVALID, type: "https://problems.moruteaven.com/user-identity/session/general/session-invalid", title: "SESSION_INVALID", detail: "会话无效", httpStatus: 401 },
    [SessionGeneralCodes.SESSION_NOT_FOUND]: { code: SessionGeneralCodes.SESSION_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/session/general/session-not-found", title: "SESSION_NOT_FOUND", detail: "会话不存在", httpStatus: 404 },
    [SessionCreateCodes.SESSION_CREATE_FAILED]: { code: SessionCreateCodes.SESSION_CREATE_FAILED, type: "https://problems.moruteaven.com/user-identity/session/create/failed", title: "SESSION_CREATE_FAILED", detail: "会话创建失败", httpStatus: 500 },
    [SessionVerificationCodes.SESSION_VERIFICATION_FAILED]: { code: SessionVerificationCodes.SESSION_VERIFICATION_FAILED, type: "https://problems.moruteaven.com/user-identity/session/verification/failed", title: "SESSION_VERIFICATION_FAILED", detail: "会话验证失败", httpStatus: 401 },
    [SessionVerificationCodes.SESSION_SIGNATURE_INVALID]: { code: SessionVerificationCodes.SESSION_SIGNATURE_INVALID, type: "https://problems.moruteaven.com/user-identity/session/verification/session-signature-invalid", title: "SESSION_SIGNATURE_INVALID", detail: "会话签名无效", httpStatus: 401 },
    [SessionStateCodes.SESSION_EXPIRED]: { code: SessionStateCodes.SESSION_EXPIRED, type: "https://problems.moruteaven.com/user-identity/session/state/session-expired", title: "SESSION_EXPIRED", detail: "会话已过期", httpStatus: 401 },
    [SessionStateCodes.SESSION_REVOKED]: { code: SessionStateCodes.SESSION_REVOKED, type: "https://problems.moruteaven.com/user-identity/session/state/session-revoked", title: "SESSION_REVOKED", detail: "会话已失效", httpStatus: 401 },
    [SessionStateCodes.SESSION_DISABLED]: { code: SessionStateCodes.SESSION_DISABLED, type: "https://problems.moruteaven.com/user-identity/session/state/session-disabled", title: "SESSION_DISABLED", detail: "会话已被禁用", httpStatus: 403 },
    [SessionRefreshCodes.SESSION_REFRESH_FAILED]: { code: SessionRefreshCodes.SESSION_REFRESH_FAILED, type: "https://problems.moruteaven.com/user-identity/session/refresh/failed", title: "SESSION_REFRESH_FAILED", detail: "会话续期失败", httpStatus: 401 },
    [SessionRefreshCodes.SESSION_REFRESH_NOT_ALLOWED]: { code: SessionRefreshCodes.SESSION_REFRESH_NOT_ALLOWED, type: "https://problems.moruteaven.com/user-identity/session/refresh/not-allowed", title: "SESSION_REFRESH_NOT_ALLOWED", detail: "当前无法续期会话", httpStatus: 403 },
    [SessionTerminateCodes.SESSION_TERMINATE_FAILED]: { code: SessionTerminateCodes.SESSION_TERMINATE_FAILED, type: "https://problems.moruteaven.com/user-identity/session/terminate/failed", title: "SESSION_TERMINATE_FAILED", detail: "会话终止失败", httpStatus: 500 },
    // 权限
    [PermissionGeneralCodes.PERMISSION_DENIED]: { code: PermissionGeneralCodes.PERMISSION_DENIED, type: "https://problems.moruteaven.com/user-identity/permission/general/permission-denied", title: "PERMISSION_DENIED", detail: "无权限", httpStatus: 403 },
    [PermissionGeneralCodes.PERMISSION_INVALID]: { code: PermissionGeneralCodes.PERMISSION_INVALID, type: "https://problems.moruteaven.com/user-identity/permission/general/permission-invalid", title: "PERMISSION_INVALID", detail: "权限无效", httpStatus: 400 },
    [PermissionCheckCodes.PERMISSION_CHECK_FAILED]: { code: PermissionCheckCodes.PERMISSION_CHECK_FAILED, type: "https://problems.moruteaven.com/user-identity/permission/check/failed", title: "PERMISSION_CHECK_FAILED", detail: "权限验证失败", httpStatus: 403 },
    [PermissionCheckCodes.PERMISSION_NOT_FOUND]: { code: PermissionCheckCodes.PERMISSION_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/permission/check/permission-not-found", title: "PERMISSION_NOT_FOUND", detail: "权限不存在", httpStatus: 404 },
    [PermissionGrantCodes.PERMISSION_GRANT_FAILED]: { code: PermissionGrantCodes.PERMISSION_GRANT_FAILED, type: "https://problems.moruteaven.com/user-identity/permission/grant/failed", title: "PERMISSION_GRANT_FAILED", detail: "权限授予失败", httpStatus: 500 },
    [PermissionRevokeCodes.PERMISSION_REVOKE_FAILED]: { code: PermissionRevokeCodes.PERMISSION_REVOKE_FAILED, type: "https://problems.moruteaven.com/user-identity/permission/revoke/failed", title: "PERMISSION_REVOKE_FAILED", detail: "权限撤销失败", httpStatus: 500 },
    [PermissionPolicyCodes.PERMISSION_POLICY_INVALID]: { code: PermissionPolicyCodes.PERMISSION_POLICY_INVALID, type: "https://problems.moruteaven.com/user-identity/permission/policy/invalid", title: "PERMISSION_POLICY_INVALID", detail: "权限策略无效", httpStatus: 400 },
    [PermissionPolicyCodes.PERMISSION_POLICY_NOT_FOUND]: { code: PermissionPolicyCodes.PERMISSION_POLICY_NOT_FOUND, type: "https://problems.moruteaven.com/user-identity/permission/policy/not-found", title: "PERMISSION_POLICY_NOT_FOUND", detail: "权限策略不存在", httpStatus: 404 },
    [PermissionInheritCodes.PERMISSION_INHERIT_FAILED]: { code: PermissionInheritCodes.PERMISSION_INHERIT_FAILED, type: "https://problems.moruteaven.com/user-identity/permission/inherit/failed", title: "PERMISSION_INHERIT_FAILED", detail: "权限继承失败", httpStatus: 500 },
    // 统一身份服务
    [IdentityServiceCodes.IDENTITY_SERVICE_ERROR]: { code: IdentityServiceCodes.IDENTITY_SERVICE_ERROR, type: "https://problems.moruteaven.com/user-identity/unified-identity/general/identity-service-error", title: "IDENTITY_SERVICE_ERROR", detail: "统一身份服务发生错误", httpStatus: 500 },
    [IdentityServiceCodes.IDENTITY_SERVICE_UNAVAILABLE]: { code: IdentityServiceCodes.IDENTITY_SERVICE_UNAVAILABLE, type: "https://problems.moruteaven.com/user-identity/unified-identity/general/identity-service-unavailable", title: "IDENTITY_SERVICE_UNAVAILABLE", detail: "统一身份服务暂不可用", httpStatus: 503 },
    [IdentityServiceCodes.IDENTITY_AUTHENTICATION_FAILED]: { code: IdentityServiceCodes.IDENTITY_AUTHENTICATION_FAILED, type: "https://problems.moruteaven.com/user-identity/unified-identity/general/identity-authentication-failed", title: "IDENTITY_AUTHENTICATION_FAILED", detail: "统一身份认证失败", httpStatus: 401 },
};
// ============================================================
// 辅助函数
// ============================================================
/**
 * 根据状态码获取 HTTP 状态码
 */
export function getHttpStatusCode(code) {
    return HTTP_STATUS_MAP[code] ?? 500;
}
/**
 * 根据状态码获取元数据
 */
export function getCodeMetadata(code) {
    return CODE_METADATA[code];
}
/**
 * 根据状态码获取中文描述
 */
export function getCodeDetail(code) {
    return CODE_METADATA[code]?.detail ?? "未知错误";
}
/**
 * 根据状态码获取 RFC 7807 type URL
 */
export function getCodeType(code) {
    return CODE_METADATA[code]?.type;
}
/**
 * 根据状态码获取英文标题
 */
export function getCodeTitle(code) {
    return CODE_METADATA[code]?.title;
}
