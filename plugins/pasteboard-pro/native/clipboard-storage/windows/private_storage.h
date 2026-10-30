#pragma once

#ifndef _WIN32
#error "Windows storage foundation requires the Windows SDK"
#endif
#include <windows.h>
#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace pasteboard_storage {

enum class Status : std::uint8_t {
  ok, invalid_request, token_unavailable, unsupported_security_context,
  create_failed, inspection_failed, acl_rejected, type_rejected,
  reparse_rejected, hardlink_rejected, identity_mismatch,
  file_flush_failed, close_failed, cleanup_incomplete
};

class OwnedHandle final {
 public:
  OwnedHandle() = default;
  explicit OwnedHandle(HANDLE value) : value_(value) {}
  OwnedHandle(const OwnedHandle&) = delete;
  OwnedHandle& operator=(const OwnedHandle&) = delete;
  ~OwnedHandle() { if (valid()) CloseHandle(value_); }
  bool valid() const { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
  HANDLE get() const { return value_; }
  bool adopt(HANDLE value) {
    if (valid() || value == nullptr || value == INVALID_HANDLE_VALUE) return false;
    value_ = value;
    return true;
  }
  bool close() {
    if (!valid()) return true;
    if (!CloseHandle(value_)) return false;
    value_ = INVALID_HANDLE_VALUE;
    return true;
  }
 private:
  HANDLE value_ = INVALID_HANDLE_VALUE;
};

using UserSid = std::vector<BYTE>;
struct FileIdentity {
  ULONGLONG volume_serial = 0;
  std::array<BYTE, 16> file_id{};
};

// These functions are not a production filesystem adapter. Paths/handles are
// supplied only by a trusted owner; callers still need ancestry/path binding.
Status ReadProcessUserSid(UserSid& user_sid);
Status CreateNewPrivateDirectory(const std::wstring& path, const UserSid& user_sid,
                                 OwnedHandle& output);
Status CreateNewPrivateFile(const std::wstring& path, const UserSid& user_sid,
                            OwnedHandle& output);
Status RequirePrivateSecurity(HANDLE object, bool directory, const UserSid& user_sid);
// Only an object already owned by user_sid may have its DACL restored.
Status RestorePrivateSecurity(HANDLE object, bool directory, const UserSid& user_sid);

Status InspectHandle(HANDLE object, bool directory, FileIdentity& identity);
Status RequireIdentity(HANDLE object, bool directory, const FileIdentity& expected);
Status FlushOwnedFile(HANDLE object, const FileIdentity& expected);
enum class DirectoryFlushObservation : std::uint8_t { not_run, api_success, api_rejected };
// An API observation never grants directory namespace durability or enables G1.
Status ObserveDirectoryFlush(HANDLE object, const FileIdentity& expected,
                             DirectoryFlushObservation& observation);

}  // namespace pasteboard_storage
