#include "private_security_internal.h"

#include <cstdint>
#include <cstring>
#include <new>

namespace pasteboard_storage {
namespace {

bool IsWellFormedSid(PSID sid, DWORD available_bytes, DWORD& sid_bytes) {
  sid_bytes = 0;
  if (sid == nullptr || available_bytes < detail::kSidHeaderBytes) return false;

  const auto* bytes = static_cast<const BYTE*>(sid);
  const BYTE revision = bytes[0];
  const BYTE sub_authority_count = bytes[1];
  if (revision != SID_REVISION || sub_authority_count > SID_MAX_SUB_AUTHORITIES) return false;

  const DWORD expected = static_cast<DWORD>(
      detail::kSidHeaderBytes + sizeof(DWORD) * sub_authority_count);
  if (expected > detail::kMaxSidBytes || expected > available_bytes) return false;
  if (!IsValidSid(sid) || GetLengthSid(sid) != expected) return false;

  sid_bytes = expected;
  return true;
}

bool GetSystemSid(BYTE (&storage)[detail::kMaxSidBytes]) {
  DWORD sid_bytes = sizeof(storage);
  if (!CreateWellKnownSid(WinLocalSystemSid, nullptr, storage, &sid_bytes) ||
      sid_bytes > sizeof(storage)) {
    return false;
  }
  DWORD validated_bytes = 0;
  return IsWellFormedSid(storage, sid_bytes, validated_bytes) &&
         validated_bytes == sid_bytes;
}

Status VerifyAcl(HANDLE object, bool directory, const UserSid& user_sid) {
  PSID returned_owner = nullptr;
  PACL returned_dacl = nullptr;
  PSECURITY_DESCRIPTOR raw_descriptor = nullptr;
  const DWORD result = GetSecurityInfo(
      object, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
      &returned_owner, nullptr, &returned_dacl, nullptr, &raw_descriptor);
  detail::LocalBlock descriptor;
  descriptor.adopt(reinterpret_cast<HLOCAL>(raw_descriptor));
  if (result != ERROR_SUCCESS || raw_descriptor == nullptr) return Status::inspection_failed;

  PSID owner = nullptr;
  BOOL owner_defaulted = FALSE;
  if (!GetSecurityDescriptorOwner(raw_descriptor, &owner, &owner_defaulted) ||
      owner_defaulted || owner == nullptr || returned_owner == nullptr ||
      !IsValidSid(owner) || !IsValidSid(returned_owner) ||
      GetLengthSid(owner) > detail::kMaxSidBytes ||
      GetLengthSid(returned_owner) > detail::kMaxSidBytes ||
      !EqualSid(owner, returned_owner) ||
      !EqualSid(owner, const_cast<BYTE*>(user_sid.data()))) {
    return Status::acl_rejected;
  }

  SECURITY_DESCRIPTOR_CONTROL control = 0;
  DWORD revision = 0;
  if (!GetSecurityDescriptorControl(raw_descriptor, &control, &revision) ||
      revision != SECURITY_DESCRIPTOR_REVISION) {
    return Status::inspection_failed;
  }
  if ((control & SE_DACL_PROTECTED) == 0) return Status::acl_rejected;

  BOOL dacl_present = FALSE;
  BOOL dacl_defaulted = FALSE;
  PACL dacl = nullptr;
  if (!GetSecurityDescriptorDacl(raw_descriptor, &dacl_present, &dacl, &dacl_defaulted)) {
    return Status::inspection_failed;
  }
  if (!dacl_present || dacl == nullptr || dacl_defaulted || dacl != returned_dacl ||
      !IsValidAcl(dacl) || dacl->AclRevision != ACL_REVISION ||
      dacl->AclSize < sizeof(ACL) || dacl->AceCount == 0 || dacl->AceCount > 2) {
    return Status::acl_rejected;
  }

  BYTE system_sid_storage[detail::kMaxSidBytes]{};
  if (!GetSystemSid(system_sid_storage)) return Status::inspection_failed;
  const bool same_principal =
      EqualSid(const_cast<BYTE*>(user_sid.data()), system_sid_storage) != FALSE;
  const WORD expected_ace_count = same_principal ? 1 : 2;
  if (dacl->AceCount != expected_ace_count) return Status::acl_rejected;

  const BYTE expected_flags = directory
      ? static_cast<BYTE>(OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)
      : static_cast<BYTE>(0);
  bool found_user = false;
  bool found_system = false;
  for (DWORD index = 0; index < dacl->AceCount; ++index) {
    LPVOID raw_ace = nullptr;
    if (!GetAce(dacl, index, &raw_ace) || raw_ace == nullptr) {
      return Status::inspection_failed;
    }

    const auto* header = static_cast<const ACE_HEADER*>(raw_ace);
    constexpr DWORD sid_offset = FIELD_OFFSET(ACCESS_ALLOWED_ACE, SidStart);
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE ||
        header->AceFlags != expected_flags || header->AceSize % sizeof(DWORD) != 0 ||
        header->AceSize < sid_offset + detail::kSidHeaderBytes) {
      return Status::acl_rejected;
    }

    const auto* allowed = static_cast<const ACCESS_ALLOWED_ACE*>(raw_ace);
    PSID ace_sid = reinterpret_cast<PSID>(
        const_cast<DWORD*>(&allowed->SidStart));
    DWORD ace_sid_bytes = 0;
    if (allowed->Mask != FILE_ALL_ACCESS ||
        !IsWellFormedSid(ace_sid, header->AceSize - sid_offset, ace_sid_bytes) ||
        ace_sid_bytes != header->AceSize - sid_offset) {
      return Status::acl_rejected;
    }

    if (EqualSid(ace_sid, const_cast<BYTE*>(user_sid.data()))) {
      if (found_user) return Status::acl_rejected;
      found_user = true;
      if (same_principal) found_system = true;
    } else if (EqualSid(ace_sid, system_sid_storage)) {
      if (found_system) return Status::acl_rejected;
      found_system = true;
    } else {
      return Status::acl_rejected;
    }
  }

  if (!found_user || !found_system) return Status::acl_rejected;
  return descriptor.close() ? Status::ok : Status::inspection_failed;
}

}  // namespace

namespace detail {

bool IsValidUserSid(const UserSid& sid) {
  if (sid.size() < kSidHeaderBytes || sid.size() > kMaxSidBytes) return false;
  DWORD actual = 0;
  return IsWellFormedSid(const_cast<BYTE*>(sid.data()),
                         static_cast<DWORD>(sid.size()), actual) &&
         actual == sid.size();
}

Status RequireCurrentProcessSid(const UserSid& sid) {
  if (!IsValidUserSid(sid)) return Status::invalid_request;
  UserSid current_sid;
  const Status read_status = ReadProcessUserSid(current_sid);
  if (read_status != Status::ok) return read_status;
  return EqualSid(const_cast<BYTE*>(sid.data()), current_sid.data())
      ? Status::ok
      : Status::unsupported_security_context;
}

Status InspectPrivateHandle(HANDLE object, bool directory) {
  if (object == nullptr || object == INVALID_HANDLE_VALUE) return Status::invalid_request;
  if (GetFileType(object) != FILE_TYPE_DISK) return Status::type_rejected;

  FILE_ATTRIBUTE_TAG_INFO tag_info{};
  if (!GetFileInformationByHandleEx(object, FileAttributeTagInfo,
                                    &tag_info, sizeof(tag_info))) {
    return Status::inspection_failed;
  }
  if ((tag_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return Status::reparse_rejected;
  }

  FILE_STANDARD_INFO standard_info{};
  if (!GetFileInformationByHandleEx(object, FileStandardInfo,
                                    &standard_info, sizeof(standard_info))) {
    return Status::inspection_failed;
  }
  if (standard_info.DeletePending) return Status::inspection_failed;
  if (standard_info.Directory != (directory ? TRUE : FALSE)) return Status::type_rejected;
  if (!directory && standard_info.NumberOfLinks != 1) return Status::hardlink_rejected;
  return Status::ok;
}

Status ObjectOwnerMatches(HANDLE object, const UserSid& sid) {
  if (object == nullptr || object == INVALID_HANDLE_VALUE || !IsValidUserSid(sid)) {
    return Status::invalid_request;
  }

  PSID owner = nullptr;
  PSECURITY_DESCRIPTOR raw_descriptor = nullptr;
  const DWORD result = GetSecurityInfo(
      object, SE_FILE_OBJECT, OWNER_SECURITY_INFORMATION,
      &owner, nullptr, nullptr, nullptr, &raw_descriptor);
  LocalBlock descriptor;
  descriptor.adopt(reinterpret_cast<HLOCAL>(raw_descriptor));
  if (result != ERROR_SUCCESS || raw_descriptor == nullptr) return Status::inspection_failed;

  PSID descriptor_owner = nullptr;
  BOOL owner_defaulted = FALSE;
  if (!GetSecurityDescriptorOwner(raw_descriptor, &descriptor_owner, &owner_defaulted)) {
    return Status::inspection_failed;
  }
  if (owner_defaulted || descriptor_owner == nullptr || owner == nullptr ||
      !IsValidSid(descriptor_owner) || !IsValidSid(owner) ||
      GetLengthSid(descriptor_owner) > kMaxSidBytes ||
      GetLengthSid(owner) > kMaxSidBytes || !EqualSid(descriptor_owner, owner)) {
    return Status::acl_rejected;
  }
  if (!EqualSid(descriptor_owner, const_cast<BYTE*>(sid.data()))) {
    return Status::acl_rejected;
  }
  return descriptor.close() ? Status::ok : Status::inspection_failed;
}

bool PrivateSecurityDescriptor::initialize(const UserSid& user_sid, bool directory) {
  if (!IsValidUserSid(user_sid)) return false;

  BYTE system_sid_storage[kMaxSidBytes]{};
  if (!GetSystemSid(system_sid_storage)) return false;

  const bool same_principal =
      EqualSid(const_cast<BYTE*>(user_sid.data()), system_sid_storage) != FALSE;
  EXPLICIT_ACCESSW entries[2]{};
  PSID trustees[2] = {
      const_cast<BYTE*>(user_sid.data()),
      system_sid_storage,
  };
  TRUSTEE_TYPE trustee_types[2] = {
      TRUSTEE_IS_USER,
      TRUSTEE_IS_WELL_KNOWN_GROUP,
  };
  std::size_t entry_count = 2;
  if (same_principal) {
    trustees[0] = system_sid_storage;
    trustee_types[0] = TRUSTEE_IS_WELL_KNOWN_GROUP;
    entry_count = 1;
  }
  const DWORD inheritance = directory
      ? static_cast<DWORD>(OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE)
      : 0;

  for (std::size_t index = 0; index < entry_count; ++index) {
    entries[index].grfAccessPermissions = FILE_ALL_ACCESS;
    entries[index].grfAccessMode = SET_ACCESS;
    entries[index].grfInheritance = inheritance;
    entries[index].Trustee.pMultipleTrustee = nullptr;
    entries[index].Trustee.MultipleTrusteeOperation = NO_MULTIPLE_TRUSTEE;
    entries[index].Trustee.TrusteeForm = TRUSTEE_IS_SID;
    entries[index].Trustee.TrusteeType = trustee_types[index];
    entries[index].Trustee.ptstrName = reinterpret_cast<LPWSTR>(trustees[index]);
  }

  PACL raw_dacl = nullptr;
  const DWORD acl_result = SetEntriesInAclW(
      static_cast<ULONG>(entry_count), entries, nullptr, &raw_dacl);
  dacl_.adopt(reinterpret_cast<HLOCAL>(raw_dacl));
  if (acl_result != ERROR_SUCCESS || raw_dacl == nullptr) return false;

  if (!InitializeSecurityDescriptor(&descriptor_, SECURITY_DESCRIPTOR_REVISION) ||
      !SetSecurityDescriptorOwner(&descriptor_, trustees[0], FALSE) ||
      !SetSecurityDescriptorDacl(&descriptor_, TRUE, dacl(), FALSE) ||
      !SetSecurityDescriptorControl(&descriptor_, SE_DACL_PROTECTED, SE_DACL_PROTECTED)) {
    return false;
  }

  attributes_.nLength = sizeof(attributes_);
  attributes_.lpSecurityDescriptor = &descriptor_;
  attributes_.bInheritHandle = FALSE;
  return true;
}

}  // namespace detail

Status ReadProcessUserSid(UserSid& user_sid) {
  user_sid.clear();

  HANDLE raw_thread_token = INVALID_HANDLE_VALUE;
  SetLastError(ERROR_SUCCESS);
  if (OpenThreadToken(GetCurrentThread(), TOKEN_QUERY, TRUE, &raw_thread_token)) {
    detail::ScopedHandle thread_token(raw_thread_token);
    if (!thread_token.close()) return Status::close_failed;
    return Status::unsupported_security_context;
  }
  if (GetLastError() != ERROR_NO_TOKEN) return Status::token_unavailable;

  HANDLE raw_process_token = INVALID_HANDLE_VALUE;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw_process_token)) {
    return Status::token_unavailable;
  }
  detail::ScopedHandle process_token(raw_process_token);

  DWORD required_bytes = 0;
  SetLastError(ERROR_SUCCESS);
  const BOOL first_query = GetTokenInformation(
      process_token.get(), TokenUser, nullptr, 0, &required_bytes);
  if (first_query || GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
      required_bytes < sizeof(TOKEN_USER) ||
      required_bytes > detail::kMaxTokenInfoBytes) {
    return Status::token_unavailable;
  }

  std::vector<BYTE> token_info;
  try {
    token_info.resize(required_bytes);
  } catch (const std::bad_alloc&) {
    return Status::token_unavailable;
  }

  DWORD actual_bytes = 0;
  if (!GetTokenInformation(process_token.get(), TokenUser, token_info.data(),
                           required_bytes, &actual_bytes) ||
      actual_bytes < sizeof(TOKEN_USER) || actual_bytes > token_info.size()) {
    return Status::token_unavailable;
  }

  const auto* token_user = reinterpret_cast<const TOKEN_USER*>(token_info.data());
  const std::uintptr_t start = reinterpret_cast<std::uintptr_t>(token_info.data());
  const std::uintptr_t sid_address =
      reinterpret_cast<std::uintptr_t>(token_user->User.Sid);
  if (sid_address < start || sid_address - start > actual_bytes) {
    return Status::token_unavailable;
  }
  const DWORD available_bytes = static_cast<DWORD>(actual_bytes - (sid_address - start));
  DWORD sid_bytes = 0;
  if (!IsWellFormedSid(token_user->User.Sid, available_bytes, sid_bytes)) {
    return Status::token_unavailable;
  }

  UserSid candidate;
  try {
    const auto* sid_start = static_cast<const BYTE*>(token_user->User.Sid);
    candidate.assign(sid_start, sid_start + sid_bytes);
  } catch (const std::bad_alloc&) {
    return Status::token_unavailable;
  }
  if (!detail::IsValidUserSid(candidate)) return Status::token_unavailable;

  if (!process_token.close()) return Status::close_failed;
  user_sid.swap(candidate);
  return Status::ok;
}

Status RequirePrivateSecurity(HANDLE object, bool directory, const UserSid& user_sid) {
  const Status current_user = detail::RequireCurrentProcessSid(user_sid);
  if (current_user != Status::ok) return current_user;

  const Status object_status = detail::InspectPrivateHandle(object, directory);
  if (object_status != Status::ok) return object_status;

  return VerifyAcl(object, directory, user_sid);
}

Status RestorePrivateSecurity(HANDLE object, bool directory, const UserSid& user_sid) {
  const Status current_user = detail::RequireCurrentProcessSid(user_sid);
  if (current_user != Status::ok) return current_user;

  const Status object_status = detail::InspectPrivateHandle(object, directory);
  if (object_status != Status::ok) return object_status;

  const Status owner_status = detail::ObjectOwnerMatches(object, user_sid);
  if (owner_status != Status::ok) return owner_status;

  detail::PrivateSecurityDescriptor security;
  if (!security.initialize(user_sid, directory)) return Status::acl_rejected;

  const DWORD result = SetSecurityInfo(
      object, SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
      nullptr, nullptr, security.dacl(), nullptr);
  if (result != ERROR_SUCCESS) return Status::acl_rejected;

  return RequirePrivateSecurity(object, directory, user_sid);
}

}  // namespace pasteboard_storage
