#include "clipboard_file_reference_paths.h"

#include "../common/clipboard_reparse.h"

#include <array>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include <windows.h>
#include <winioctl.h>

namespace clipboard_format_probe {
namespace {

constexpr std::wstring_view kExtendedPrefix = L"\\\\?\\";
constexpr std::wstring_view kExtendedUncPrefix = L"\\\\?\\UNC\\";
constexpr std::wstring_view kVolumePrefix = L"\\\\?\\Volume{";
constexpr std::wstring_view kNtPrefix = L"\\??\\";
constexpr std::size_t kMaximumPathCharacters = 32767;
constexpr std::size_t kReparseBufferCapacity = 16 * 1024;
constexpr DWORD kOpenFlags =
    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT |
    FILE_FLAG_OPEN_NO_RECALL;
constexpr DWORD kShareMode =
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
constexpr ULONG kSymlinkTag = clipboard_reparse::kSymbolicLinkTag;
constexpr ULONG kMountPointTag = clipboard_reparse::kMountPointTag;

class ScopedHandle final {
 public:
  explicit ScopedHandle(HANDLE handle) : handle_(handle) {}
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;
  ~ScopedHandle() { Close(); }

  HANDLE Get() const { return handle_; }
  void Close() {
    if (handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr) {
      CloseHandle(handle_);
      handle_ = INVALID_HANDLE_VALUE;
    }
  }

 private:
  HANDLE handle_;
};

bool IsSeparator(wchar_t value) {
  return value == L'\\' || value == L'/';
}

bool IsAsciiAlpha(wchar_t value) {
  return (value >= L'a' && value <= L'z') ||
         (value >= L'A' && value <= L'Z');
}

bool StartsWithIgnoreCase(std::wstring_view value,
                          std::wstring_view prefix) {
  return value.size() >= prefix.size() &&
         CompareStringOrdinal(value.data(), static_cast<int>(prefix.size()),
                              prefix.data(), static_cast<int>(prefix.size()),
                              TRUE) == CSTR_EQUAL;
}

bool HasWellFormedUtf16(std::wstring_view value) {
  if (value.empty() || value.size() > kMaximumPathCharacters) return false;
  for (std::size_t index = 0; index < value.size(); ++index) {
    const wchar_t unit = value[index];
    if (unit == L'\0' || unit < 0x20) return false;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= value.size()) return false;
      const wchar_t low = value[++index];
      if (low < 0xdc00 || low > 0xdfff) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

std::wstring NormalizeSeparators(std::wstring_view path) {
  std::wstring result(path);
  for (auto& unit : result) {
    if (unit == L'/') unit = L'\\';
  }
  return result;
}

std::wstring NativePath(std::wstring_view original) {
  std::wstring path = NormalizeSeparators(original);
  if (path.size() >= MAX_PATH &&
      path.substr(0, kExtendedPrefix.size()) != kExtendedPrefix) {
    if (path.size() >= 2 && path[0] == L'\\' && path[1] == L'\\') {
      path = std::wstring(kExtendedUncPrefix) + path.substr(2);
    } else {
      path = std::wstring(kExtendedPrefix) + path;
    }
  }
  return path;
}

void AppendComponent(std::wstring* path, std::wstring_view component) {
  if (!path->empty() && !IsSeparator(path->back())) path->push_back(L'\\');
  path->append(component);
}

bool ConvertNtTarget(std::wstring_view raw, std::wstring* target) {
  if (target == nullptr || !HasWellFormedUtf16(raw)) return false;
  std::wstring normalized = NormalizeSeparators(raw);
  if (StartsWithIgnoreCase(normalized, kNtPrefix)) {
    const std::wstring_view rest(normalized.data() + kNtPrefix.size(),
                                 normalized.size() - kNtPrefix.size());
    if (StartsWithIgnoreCase(rest, L"UNC\\")) {
      normalized = L"\\\\" + std::wstring(rest.substr(4));
    } else if ((rest.size() >= 3 && IsAsciiAlpha(rest[0]) &&
                rest[1] == L':' && IsSeparator(rest[2])) ||
               StartsWithIgnoreCase(rest, L"Volume{")) {
      normalized = std::wstring(kExtendedPrefix) + std::wstring(rest);
    } else {
      return false;
    }
  }
  return NormalizeFilesystemPath(normalized, target);
}

bool MakeLinkTarget(std::wstring_view link_path, std::wstring_view raw_target,
                    bool is_relative, std::wstring* target) {
  if (target == nullptr || !HasWellFormedUtf16(raw_target)) return false;
  const std::wstring link = NormalizeSeparators(link_path);
  if (!is_relative) return ConvertNtTarget(raw_target, target);

  const std::wstring relative = NormalizeSeparators(raw_target);
  if (relative.empty() || IsSeparator(relative.front()) ||
      (relative.size() >= 2 && IsAsciiAlpha(relative[0]) &&
       relative[1] == L':')) {
    return false;
  }
  std::wstring root;
  std::vector<std::wstring> link_components;
  if (!SplitFilesystemPath(link, &root, &link_components) ||
      link_components.empty()) {
    return false;
  }
  std::wstring combined = std::move(root);
  for (std::size_t index = 0; index + 1 < link_components.size(); ++index) {
    AppendComponent(&combined, link_components[index]);
  }
  AppendComponent(&combined, relative);
  return NormalizeFilesystemPath(combined, target);
}

bool ReadReparseTarget(HANDLE handle, ULONG expected_tag,
                       std::wstring* target, bool* is_relative) {
  if (target == nullptr || is_relative == nullptr) return false;
  target->clear();
  *is_relative = false;

  std::array<std::uint8_t, kReparseBufferCapacity> buffer{};
  DWORD returned = 0;
  if (!DeviceIoControl(handle, FSCTL_GET_REPARSE_POINT, nullptr, 0,
                       buffer.data(), static_cast<DWORD>(buffer.size()),
                       &returned, nullptr)) {
    return false;
  }

  try {
    clipboard_reparse::Target parsed;
    if (!clipboard_reparse::ParseBuffer(
            buffer.data(), buffer.size(), returned, expected_tag, &parsed)) {
      return false;
    }
    static_assert(sizeof(wchar_t) == sizeof(char16_t),
                  "Win32 reparse paths are UTF-16");
    std::wstring replacement;
    replacement.reserve(parsed.substitute_name.size());
    for (const char16_t unit : parsed.substitute_name) {
      replacement.push_back(static_cast<wchar_t>(unit));
    }
    target->swap(replacement);
    *is_relative = parsed.is_relative;
    return true;
  } catch (...) {
    target->clear();
    *is_relative = false;
    return false;
  }
}

bool SamePath(std::wstring_view left, std::wstring_view right) {
  return left.size() == right.size() &&
         CompareStringOrdinal(left.data(), static_cast<int>(left.size()),
                              right.data(), static_cast<int>(right.size()),
                              TRUE) == CSTR_EQUAL;
}

bool ResolvePath(std::wstring_view requested, bool require_read_access,
                 bool* is_directory, std::vector<std::wstring>* link_stack,
                 unsigned int reparse_hops);

bool InspectComponent(std::wstring_view path, DWORD desired_access,
                      FILE_ATTRIBUTE_TAG_INFO* attributes,
                      std::wstring* link_target, bool* link_is_relative,
                      bool* is_reparse) {
  if (attributes == nullptr || link_target == nullptr ||
      link_is_relative == nullptr || is_reparse == nullptr) {
    return false;
  }
  const std::wstring native = NativePath(path);
  ScopedHandle handle(CreateFileW(native.c_str(), desired_access, kShareMode,
                                  nullptr, OPEN_EXISTING, kOpenFlags,
                                  nullptr));
  if (handle.Get() == INVALID_HANDLE_VALUE) return false;
  if (GetFileType(handle.Get()) != FILE_TYPE_DISK ||
      !GetFileInformationByHandleEx(handle.Get(), FileAttributeTagInfo,
                                    attributes, sizeof(*attributes)) ||
      (attributes->FileAttributes &
       (FILE_ATTRIBUTE_DEVICE | FILE_ATTRIBUTE_OFFLINE |
        FILE_ATTRIBUTE_RECALL_ON_OPEN | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS))) {
    return false;
  }
  *is_reparse =
      (attributes->FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
  if (!*is_reparse) return true;
  if (attributes->ReparseTag != kSymlinkTag &&
      attributes->ReparseTag != kMountPointTag) {
    return false;
  }
  return ReadReparseTarget(handle.Get(), attributes->ReparseTag,
                           link_target, link_is_relative);
}

bool ResolveLink(std::wstring_view link_path, std::wstring_view raw_target,
                 bool link_is_relative,
                 const std::vector<std::wstring>& remaining,
                 bool require_read_access, bool* is_directory,
                 std::vector<std::wstring>* link_stack,
                 unsigned int reparse_hops) {
  if (!clipboard_reparse::CanFollowHop(reparse_hops)) return false;
  for (const auto& previous : *link_stack) {
    if (SamePath(previous, link_path)) return false;
  }
  std::wstring target;
  if (!MakeLinkTarget(link_path, raw_target, link_is_relative, &target)) {
    return false;
  }
  for (const auto& component : remaining) AppendComponent(&target, component);
  if (!NormalizeFilesystemPath(target, &target)) return false;
  link_stack->emplace_back(link_path);
  const bool resolved = ResolvePath(target, require_read_access, is_directory,
                                    link_stack, reparse_hops + 1);
  link_stack->pop_back();
  return resolved;
}

bool ResolveCandidate(std::wstring_view path, bool final_component,
                      const std::vector<std::wstring>& remaining,
                      bool require_read_access, bool* is_directory,
                      bool* followed_reparse,
                      std::vector<std::wstring>* link_stack,
                      unsigned int reparse_hops) {
  FILE_ATTRIBUTE_TAG_INFO attributes{};
  std::wstring target;
  bool target_is_relative = false;
  bool is_reparse = false;
  const DWORD desired_access =
      final_component && require_read_access ? GENERIC_READ
                                             : FILE_READ_ATTRIBUTES;
  if (!InspectComponent(path, desired_access, &attributes, &target,
                        &target_is_relative, &is_reparse)) {
    return false;
  }
  if (followed_reparse != nullptr) *followed_reparse = is_reparse;
  if (is_reparse) {
    return ResolveLink(path, target, target_is_relative, remaining,
                       require_read_access, is_directory, link_stack,
                       reparse_hops);
  }
  const bool directory =
      (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  if (!final_component && !directory) return false;
  if (final_component && is_directory != nullptr) *is_directory = directory;
  return true;
}

bool ResolvePath(std::wstring_view requested, bool require_read_access,
                 bool* is_directory, std::vector<std::wstring>* link_stack,
                 unsigned int reparse_hops) {
  if (reparse_hops > clipboard_reparse::kMaximumReparseHops ||
      !IsSafeFilesystemPath(requested)) {
    return false;
  }
  std::wstring root;
  std::vector<std::wstring> components;
  if (!SplitFilesystemPath(requested, &root, &components)) return false;
  if (components.empty()) {
    return ResolveCandidate(root, true, {}, require_read_access,
                            is_directory, nullptr, link_stack, reparse_hops);
  }

  std::wstring current = root;
  for (std::size_t index = 0; index < components.size(); ++index) {
    AppendComponent(&current, components[index]);
    const bool final_component = index + 1 == components.size();
    std::vector<std::wstring> remaining(
        components.begin() + static_cast<std::ptrdiff_t>(index + 1),
        components.end());
    bool followed_reparse = false;
    if (!ResolveCandidate(current, final_component, remaining,
                          require_read_access, is_directory,
                          &followed_reparse, link_stack, reparse_hops)) {
      return false;
    }
    if (followed_reparse || final_component) return true;
  }
  return false;
}

}  // namespace

bool FilesystemReferenceAccessible(std::wstring_view path,
                                   bool require_read_access,
                                   bool* is_directory) {
  if (is_directory == nullptr || !IsSafeFilesystemPath(path)) return false;
  std::vector<std::wstring> link_stack;
  return ResolvePath(path, require_read_access, is_directory, &link_stack, 0);
}

}  // namespace clipboard_format_probe
