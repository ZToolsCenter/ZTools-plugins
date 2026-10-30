#include "private_security_internal.h"

#include <string_view>

namespace pasteboard_storage {
namespace {

bool IsAsciiDriveLetter(wchar_t value) {
  return (value >= L'A' && value <= L'Z') || (value >= L'a' && value <= L'z');
}

bool IsAbsoluteLocalPath(const std::wstring& path) {
  if (path.empty() || path.size() >= 32767 ||
      path.find(L'\0') != std::wstring::npos ||
      path.find(L'/') != std::wstring::npos) {
    return false;
  }

  std::size_t drive_offset = 0;
  const bool extended = path.rfind(L"\\\\?\\", 0) == 0;
  if (extended) drive_offset = 4;
  if (path.size() <= drive_offset + 3 ||
      !IsAsciiDriveLetter(path[drive_offset]) ||
      path[drive_offset + 1] != L':' ||
      path[drive_offset + 2] != L'\\' ||
      path.back() == L'\\') {
    return false;
  }
  if (!extended && path.size() >= MAX_PATH) return false;

  std::size_t component_start = drive_offset + 3;
  while (component_start < path.size()) {
    const std::size_t separator = path.find(L'\\', component_start);
    const std::size_t component_end =
        separator == std::wstring::npos ? path.size() : separator;
    if (component_end == component_start) return false;
    const std::wstring_view component(path.data() + component_start,
                                      component_end - component_start);
    if (component == L"." || component == L"..") return false;
    if (component.back() == L'.' || component.back() == L' ') return false;
    if (component.find(L':') != std::wstring_view::npos) return false;
    if (separator == std::wstring::npos) break;
    component_start = separator + 1;
  }
  return true;
}

Status AdoptCreatedHandle(detail::ScopedHandle& created, OwnedHandle& output) {
  if (!output.adopt(created.get())) return Status::invalid_request;
  created.release();
  return Status::ok;
}

Status RemoveCreatedFile(detail::ScopedHandle& created) {
  FILE_DISPOSITION_INFO disposition{};
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(created.get(), FileDispositionInfo,
                                  &disposition, sizeof(disposition))) {
    if (!created.close()) return Status::close_failed;
    return Status::cleanup_incomplete;
  }
  return created.close() ? Status::ok : Status::close_failed;
}

Status CloseUnboundDirectory(detail::ScopedHandle& directory) {
  return directory.close() ? Status::cleanup_incomplete : Status::close_failed;
}

}  // namespace

Status CreateNewPrivateDirectory(const std::wstring& path, const UserSid& user_sid,
                                 OwnedHandle& output) {
  if (output.valid() || !IsAbsoluteLocalPath(path)) return Status::invalid_request;
  const Status current_user = detail::RequireCurrentProcessSid(user_sid);
  if (current_user != Status::ok) return current_user;

  detail::PrivateSecurityDescriptor security;
  if (!security.initialize(user_sid, true)) return Status::create_failed;
  if (!CreateDirectoryW(path.c_str(), security.attributes())) return Status::create_failed;

  constexpr DWORD access = GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC | DELETE |
                           FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES;
  HANDLE raw_handle = CreateFileW(
      path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
      OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
      nullptr);
  detail::ScopedHandle created(raw_handle);
  if (!created.valid()) return Status::cleanup_incomplete;

  Status status = detail::InspectPrivateHandle(created.get(), true);
  if (status == Status::ok) status = RequirePrivateSecurity(created.get(), true, user_sid);
  if (status != Status::ok) {
    const Status closed = CloseUnboundDirectory(created);
    return closed == Status::close_failed ? closed : Status::cleanup_incomplete;
  }
  status = AdoptCreatedHandle(created, output);
  if (status != Status::ok) {
    const Status closed = CloseUnboundDirectory(created);
    return closed == Status::close_failed ? closed : Status::cleanup_incomplete;
  }
  return status;
}

Status CreateNewPrivateFile(const std::wstring& path, const UserSid& user_sid,
                            OwnedHandle& output) {
  if (output.valid() || !IsAbsoluteLocalPath(path)) return Status::invalid_request;
  const Status current_user = detail::RequireCurrentProcessSid(user_sid);
  if (current_user != Status::ok) return current_user;

  detail::PrivateSecurityDescriptor security;
  if (!security.initialize(user_sid, false)) return Status::create_failed;

  constexpr DWORD access = GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC | DELETE |
                           FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES;
  HANDLE raw_handle = CreateFileW(
      path.c_str(), access, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
      CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
      security.attributes());
  detail::ScopedHandle created(raw_handle);
  if (!created.valid()) return Status::create_failed;

  Status status = detail::InspectPrivateHandle(created.get(), false);
  if (status == Status::ok) status = RequirePrivateSecurity(created.get(), false, user_sid);
  if (status != Status::ok) {
    const Status cleanup = RemoveCreatedFile(created);
    return cleanup == Status::ok ? status : cleanup;
  }
  status = AdoptCreatedHandle(created, output);
  if (status != Status::ok) {
    const Status cleanup = RemoveCreatedFile(created);
    return cleanup == Status::ok ? status : cleanup;
  }
  return status;
}

}  // namespace pasteboard_storage
