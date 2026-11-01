#pragma once

#ifndef _WIN32
#error "Windows storage foundation requires the Windows SDK"
#endif

#include "private_storage.h"

#include <Aclapi.h>
#include <cstddef>

namespace pasteboard_storage {
namespace detail {

inline constexpr std::size_t kMaxTokenInfoBytes = 64 * 1024;
inline constexpr std::size_t kSidHeaderBytes = 8;
inline constexpr std::size_t kMaxSidBytes = kSidHeaderBytes + 4 * SID_MAX_SUB_AUTHORITIES;

class ScopedHandle final {
 public:
  ScopedHandle() = default;
  explicit ScopedHandle(HANDLE value) : value_(value) {}
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;
  ~ScopedHandle() { if (valid()) CloseHandle(value_); }

  bool valid() const { return value_ != nullptr && value_ != INVALID_HANDLE_VALUE; }
  HANDLE get() const { return value_; }
  HANDLE release() {
    const HANDLE value = value_;
    value_ = INVALID_HANDLE_VALUE;
    return value;
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

class LocalBlock final {
 public:
  LocalBlock() = default;
  LocalBlock(const LocalBlock&) = delete;
  LocalBlock& operator=(const LocalBlock&) = delete;
  ~LocalBlock() { if (value_ != nullptr) LocalFree(value_); }

  void adopt(HLOCAL value) { value_ = value; }
  HLOCAL get() const { return value_; }
  bool close() {
    if (value_ == nullptr) return true;
    if (LocalFree(value_) != nullptr) return false;
    value_ = nullptr;
    return true;
  }

 private:
  HLOCAL value_ = nullptr;
};

bool IsValidUserSid(const UserSid& sid);
Status RequireCurrentProcessSid(const UserSid& sid);
Status InspectPrivateHandle(HANDLE object, bool directory);
Status ObjectOwnerMatches(HANDLE object, const UserSid& sid);

class PrivateSecurityDescriptor final {
 public:
  PrivateSecurityDescriptor() = default;
  PrivateSecurityDescriptor(const PrivateSecurityDescriptor&) = delete;
  PrivateSecurityDescriptor& operator=(const PrivateSecurityDescriptor&) = delete;

  bool initialize(const UserSid& user_sid, bool directory);
  PSECURITY_DESCRIPTOR descriptor() { return &descriptor_; }
  PACL dacl() const { return reinterpret_cast<PACL>(dacl_.get()); }
  PSECURITY_ATTRIBUTES attributes() { return &attributes_; }

 private:
  SECURITY_DESCRIPTOR descriptor_{};
  LocalBlock dacl_;
  SECURITY_ATTRIBUTES attributes_{};
};

}  // namespace detail
}  // namespace pasteboard_storage
