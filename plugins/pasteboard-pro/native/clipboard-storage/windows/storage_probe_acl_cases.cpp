#include "storage_probe_acl_cases.h"
#include <aclapi.h>
#include <array>

namespace pasteboard_storage {
namespace {
bool SetProtectedDacl(HANDLE object, PACL dacl) {
  return SetSecurityInfo(object, SE_FILE_OBJECT,
    DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
    nullptr, nullptr, dacl, nullptr) == ERROR_SUCCESS;
}

bool Restore(HANDLE object, const UserSid& user_sid, AclCaseResults& result) {
  result.restore = RestorePrivateSecurity(object, true, user_sid);
  if (result.restore == Status::ok) result.restore = RequirePrivateSecurity(object, true, user_sid);
  return result.restore == Status::ok;
}
}  // namespace

AclCaseResults RunOwnedAclCases(HANDLE object, const UserSid& user_sid) {
  AclCaseResults result;
  if (RequirePrivateSecurity(object, true, user_sid) != Status::ok) return result;
  if (!SetProtectedDacl(object, nullptr)) {
    result.null_dacl = Status::inspection_failed;
    return result;
  }
  result.null_dacl = RequirePrivateSecurity(object, true, user_sid);
  if (!Restore(object, user_sid, result)) return result;

  alignas(ACL) std::array<BYTE, sizeof(ACL)> empty{};
  auto* empty_acl = reinterpret_cast<PACL>(empty.data());
  if (!InitializeAcl(empty_acl, static_cast<DWORD>(empty.size()), ACL_REVISION) ||
      !SetProtectedDacl(object, empty_acl)) {
    result.empty_dacl = Status::inspection_failed;
    return result;
  }
  result.empty_dacl = RequirePrivateSecurity(object, true, user_sid);
  if (!Restore(object, user_sid, result)) return result;

  alignas(SID) std::array<BYTE, SECURITY_MAX_SID_SIZE> everyone{};
  DWORD sid_bytes = static_cast<DWORD>(everyone.size());
  PACL current = nullptr;
  PSECURITY_DESCRIPTOR descriptor = nullptr;
  PACL expanded = nullptr;
  if (!CreateWellKnownSid(WinWorldSid, nullptr, everyone.data(), &sid_bytes) ||
      GetSecurityInfo(object, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
        nullptr, nullptr, &current, nullptr, &descriptor) != ERROR_SUCCESS) {
    result.extra_principal = Status::inspection_failed;
    if (descriptor) LocalFree(descriptor);
    return result;
  }
  EXPLICIT_ACCESSW entry{};
  entry.grfAccessPermissions = FILE_GENERIC_READ;
  entry.grfAccessMode = GRANT_ACCESS;
  entry.grfInheritance = NO_INHERITANCE;
  entry.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  entry.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  entry.Trustee.ptstrName = reinterpret_cast<LPWSTR>(everyone.data());
  if (SetEntriesInAclW(1, &entry, current, &expanded) != ERROR_SUCCESS ||
      !SetProtectedDacl(object, expanded)) {
    result.extra_principal = Status::inspection_failed;
  } else {
    result.extra_principal = RequirePrivateSecurity(object, true, user_sid);
  }
  if (expanded) LocalFree(expanded);
  if (descriptor) LocalFree(descriptor);
  Restore(object, user_sid, result);
  return result;
}
}  // namespace pasteboard_storage
