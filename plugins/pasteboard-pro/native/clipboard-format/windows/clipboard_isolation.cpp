#include "clipboard_probe.h"

#include <vector>

namespace clipboard_format_probe {
namespace {

struct UniqueHandle {
  HANDLE value = nullptr;
  ~UniqueHandle() {
    if (value != nullptr && value != INVALID_HANDLE_VALUE) CloseHandle(value);
  }
};

std::string Utf8FromWide(const std::wstring& input) {
  if (input.empty()) return {};
  const int required = WideCharToMultiByte(
      CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
      static_cast<int>(input.size()), nullptr, 0, nullptr, nullptr);
  if (required <= 0) return {};
  std::string output(static_cast<std::size_t>(required), '\0');
  if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input.data(),
                          static_cast<int>(input.size()), output.data(),
                          required, nullptr, nullptr) != required) {
    return {};
  }
  return output;
}

bool QueryUserObjectName(HANDLE handle, std::wstring* output) {
  DWORD required = 0;
  SetLastError(ERROR_SUCCESS);
  GetUserObjectInformationW(handle, UOI_NAME, nullptr, 0, &required);
  if (required == 0 || GetLastError() != ERROR_INSUFFICIENT_BUFFER ||
      required > 4096) {
    return false;
  }

  std::vector<wchar_t> buffer(required / sizeof(wchar_t) + 1, L'\0');
  if (!GetUserObjectInformationW(handle, UOI_NAME, buffer.data(), required,
                                 &required)) {
    return false;
  }
  *output = buffer.data();
  return !output->empty();
}

bool MakeCurrentUserSecurityAttributes(
    DWORD desired_access,
    SECURITY_ATTRIBUTES* attributes,
    PSECURITY_DESCRIPTOR* descriptor_out,
    std::vector<std::uint8_t>* acl_storage_out) {
  UniqueHandle token;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token.value)) {
    return false;
  }

  DWORD token_bytes = 0;
  GetTokenInformation(token.value, TokenUser, nullptr, 0, &token_bytes);
  if (token_bytes == 0 || token_bytes > 64 * 1024) return false;
  std::vector<std::uint8_t> token_storage(token_bytes);
  if (!GetTokenInformation(token.value, TokenUser, token_storage.data(),
                           token_bytes, &token_bytes)) {
    return false;
  }

  const auto* token_user =
      reinterpret_cast<const TOKEN_USER*>(token_storage.data());
  const DWORD sid_bytes = GetLengthSid(token_user->User.Sid);
  const DWORD acl_bytes = static_cast<DWORD>(
      sizeof(ACL) + sizeof(ACCESS_ALLOWED_ACE) + sid_bytes - sizeof(DWORD));
  acl_storage_out->assign(acl_bytes, 0);
  auto* acl = reinterpret_cast<PACL>(acl_storage_out->data());
  if (!InitializeAcl(acl, acl_bytes, ACL_REVISION) ||
      !AddAccessAllowedAce(acl, ACL_REVISION, desired_access,
                           token_user->User.Sid)) {
    return false;
  }

  auto* descriptor = static_cast<PSECURITY_DESCRIPTOR>(
      LocalAlloc(LPTR, SECURITY_DESCRIPTOR_MIN_LENGTH));
  if (descriptor == nullptr) return false;
  *descriptor_out = descriptor;

  // The owner defaults to this process token. The DACL contains only the
  // current user's SID and remains alive in acl_storage_out until creation.
  if (!InitializeSecurityDescriptor(descriptor,
                                    SECURITY_DESCRIPTOR_REVISION) ||
      !SetSecurityDescriptorDacl(descriptor, TRUE, acl, FALSE)) {
    return false;
  }
  attributes->nLength = static_cast<DWORD>(sizeof(*attributes));
  attributes->lpSecurityDescriptor = descriptor;
  attributes->bInheritHandle = FALSE;
  return true;
}

}  // namespace

IsolatedWindowStation::~IsolatedWindowStation() {
  Restore(nullptr);
}

bool IsolatedWindowStation::Enter(std::string* error) {
  if (private_station_ != nullptr) {
    if (error != nullptr) *error = "private window station already entered";
    return false;
  }

  original_station_ = GetProcessWindowStation();
  original_thread_desktop_ = GetThreadDesktop(GetCurrentThreadId());
  if (original_station_ == nullptr || original_thread_desktop_ == nullptr) {
    if (error != nullptr) *error = "could not identify the current station";
    return false;
  }

  std::wstring original_name;
  if (!QueryUserObjectName(original_station_, &original_name)) {
    if (error != nullptr) *error = "could not read the current station name";
    return false;
  }

  SECURITY_ATTRIBUTES station_attributes{};
  PSECURITY_DESCRIPTOR station_descriptor = nullptr;
  std::vector<std::uint8_t> station_acl_storage;
  const bool station_security_ready = MakeCurrentUserSecurityAttributes(
      WINSTA_ALL_ACCESS, &station_attributes, &station_descriptor,
      &station_acl_storage);
  if (!station_security_ready) {
    if (station_descriptor != nullptr) LocalFree(station_descriptor);
    if (error != nullptr) *error = "could not build a private station ACL";
    return false;
  }

  private_station_ = CreateWindowStationW(
      nullptr, CWF_CREATE_ONLY, WINSTA_ALL_ACCESS, &station_attributes);
  LocalFree(station_descriptor);
  if (private_station_ == nullptr) {
    if (error != nullptr) {
      *error = "CreateWindowStationW failed; isolated test was not started";
    }
    return false;
  }

  std::wstring private_name;
  if (!QueryUserObjectName(private_station_, &private_name) ||
      CompareStringOrdinal(private_name.c_str(), -1, L"WinSta0", -1, TRUE) ==
          CSTR_EQUAL ||
      CompareStringOrdinal(private_name.c_str(), -1, original_name.c_str(),
                           -1, TRUE) == CSTR_EQUAL) {
    if (error != nullptr) {
      *error = "private station identity could not be distinguished safely";
    }
    Restore(nullptr);
    return false;
  }
  station_name_utf8_ = Utf8FromWide(private_name);
  if (station_name_utf8_.empty()) {
    if (error != nullptr) *error = "private station name was not valid UTF-8";
    Restore(nullptr);
    return false;
  }

  if (!SetProcessWindowStation(private_station_)) {
    if (error != nullptr) {
      *error = "SetProcessWindowStation failed; isolated test was not started";
    }
    Restore(nullptr);
    return false;
  }
  process_station_switched_ = true;
  if (GetProcessWindowStation() != private_station_) {
    if (error != nullptr) *error = "private station switch did not take effect";
    Restore(nullptr);
    return false;
  }

  SECURITY_ATTRIBUTES desktop_attributes{};
  PSECURITY_DESCRIPTOR desktop_descriptor = nullptr;
  std::vector<std::uint8_t> desktop_acl_storage;
  const bool desktop_security_ready = MakeCurrentUserSecurityAttributes(
      DESKTOP_ALL_ACCESS, &desktop_attributes, &desktop_descriptor,
      &desktop_acl_storage);
  if (!desktop_security_ready) {
    if (desktop_descriptor != nullptr) LocalFree(desktop_descriptor);
    if (error != nullptr) *error = "could not build a private desktop ACL";
    Restore(nullptr);
    return false;
  }

  private_desktop_ = CreateDesktopW(
      L"ClipboardFormatProbe", nullptr, nullptr, 0, DESKTOP_ALL_ACCESS,
      &desktop_attributes);
  LocalFree(desktop_descriptor);
  if (private_desktop_ == nullptr) {
    if (error != nullptr) {
      *error = "CreateDesktopW failed; isolated test was not started";
    }
    Restore(nullptr);
    return false;
  }
  // CreateDesktopW assigns the new desktop to the calling thread. Record the
  // side effect before any validation so every failure path restores it.
  thread_desktop_switched_ = true;
  if (GetThreadDesktop(GetCurrentThreadId()) != private_desktop_) {
    if (error != nullptr) *error = "private desktop switch did not take effect";
    Restore(nullptr);
    return false;
  }
  return true;
}

bool IsolatedWindowStation::Restore(std::string* error) {
  bool restored = true;
  if (process_station_switched_) {
    if (!SetProcessWindowStation(original_station_)) {
      restored = false;
      if (error != nullptr) {
        *error = "could not restore the original process window station";
      }
    } else {
      process_station_switched_ = false;
    }
  }
  if (thread_desktop_switched_) {
    if (!SetThreadDesktop(original_thread_desktop_)) {
      restored = false;
      if (error != nullptr) {
        *error = "could not restore the original thread desktop";
      }
    } else {
      thread_desktop_switched_ = false;
    }
  }

  if (restored && private_desktop_ != nullptr) {
    if (!CloseDesktop(private_desktop_)) {
      restored = false;
      if (error != nullptr) *error = "could not release the private desktop";
    } else {
      private_desktop_ = nullptr;
    }
  }
  if (restored && private_station_ != nullptr) {
    if (!CloseWindowStation(private_station_)) {
      restored = false;
      if (error != nullptr) *error = "could not release the private station";
    } else {
      private_station_ = nullptr;
      original_station_ = nullptr;
      original_thread_desktop_ = nullptr;
    }
  }
  return restored;
}

}  // namespace clipboard_format_probe
