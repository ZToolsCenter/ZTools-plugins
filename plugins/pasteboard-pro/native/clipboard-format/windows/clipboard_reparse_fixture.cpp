#include "clipboard_reparse_fixture.h"

#include <cstdint>
#include <filesystem>
#include <string_view>
#include <system_error>
#include <vector>
#include <windows.h>
#include <winioctl.h>

namespace clipboard_format_probe {
namespace {

constexpr ULONG kMountPointTag = 0xA0000003;
constexpr std::size_t kMaximumReparseBufferSize = 16 * 1024;

class ScopedHandle final {
 public:
  explicit ScopedHandle(HANDLE handle) : handle_(handle) {}
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;
  ~ScopedHandle() {
    if (handle_ != INVALID_HANDLE_VALUE && handle_ != nullptr) {
      CloseHandle(handle_);
    }
  }

  HANDLE Get() const { return handle_; }

 private:
  HANDLE handle_;
};

std::wstring NativePath(std::wstring path) {
  constexpr std::wstring_view extended_prefix = L"\\\\?\\";
  constexpr std::wstring_view unc_prefix = L"\\\\?\\UNC\\";
  if (path.size() < MAX_PATH || path.compare(0, extended_prefix.size(),
                                             extended_prefix) == 0) {
    return path;
  }
  if (path.size() >= 2 && path[0] == L'\\' && path[1] == L'\\') {
    return std::wstring(unc_prefix) + path.substr(2);
  }
  return std::wstring(extended_prefix) + path;
}

bool IsPluginRoot(const std::filesystem::path& candidate) {
  std::error_code error;
  const bool has_windows_source = std::filesystem::is_regular_file(
      candidate / L"native" / L"clipboard-format" / L"windows" /
          L"CMakeLists.txt",
      error);
  if (error || !has_windows_source) return false;
  error.clear();
  return std::filesystem::is_regular_file(candidate / L"package.json", error) &&
         !error;
}

bool FindPluginRoot(std::filesystem::path* root) {
  if (root == nullptr) return false;
  std::vector<std::filesystem::path> candidates;
  std::error_code error;
  const std::filesystem::path current = std::filesystem::current_path(error);
  if (!error) candidates.push_back(current);
  error.clear();
  const std::filesystem::path source =
      std::filesystem::absolute(std::filesystem::path(__FILE__), error);
  if (!error) candidates.push_back(source.parent_path());

  for (const auto& candidate : candidates) {
    for (std::filesystem::path directory = candidate; !directory.empty();
         directory = directory.parent_path()) {
      if (IsPluginRoot(directory)) {
        *root = directory;
        return true;
      }
      if (directory == directory.root_path()) break;
    }
  }
  return false;
}

bool EnsureOwnedDirectory(const std::wstring& path) {
  const std::wstring native = NativePath(path);
  if (CreateDirectoryW(native.c_str(), nullptr)) return true;
  if (GetLastError() != ERROR_ALREADY_EXISTS) return false;
  const DWORD attributes = GetFileAttributesW(native.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 &&
         (attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

void PutU16(std::vector<std::uint8_t>* bytes, std::size_t offset,
            std::uint16_t value) {
  (*bytes)[offset] = static_cast<std::uint8_t>(value & 0xff);
  (*bytes)[offset + 1] = static_cast<std::uint8_t>(value >> 8);
}

void PutU32(std::vector<std::uint8_t>* bytes, std::size_t offset,
            std::uint32_t value) {
  for (std::size_t index = 0; index < 4; ++index) {
    (*bytes)[offset + index] =
        static_cast<std::uint8_t>((value >> (index * 8)) & 0xff);
  }
}

void PutWideBytes(std::vector<std::uint8_t>* bytes, std::size_t offset,
                  const std::wstring& value) {
  for (std::size_t index = 0; index < value.size(); ++index) {
    const auto utf16 = static_cast<std::uint16_t>(value[index]);
    PutU16(bytes, offset + index * 2, utf16);
  }
}

std::wstring SubstituteName(std::wstring_view path) {
  constexpr std::wstring_view extended_prefix = L"\\\\?\\";
  constexpr std::wstring_view extended_unc_prefix = L"\\\\?\\UNC\\";
  std::wstring result = L"\\??\\";
  if (path.size() >= extended_unc_prefix.size() &&
      CompareStringOrdinal(path.data(),
                           static_cast<int>(extended_unc_prefix.size()),
                           extended_unc_prefix.data(),
                           static_cast<int>(extended_unc_prefix.size()), TRUE) ==
          CSTR_EQUAL) {
    result += L"UNC\\";
    result.append(path.substr(extended_unc_prefix.size()));
  } else if (path.size() >= extended_prefix.size() &&
             path.substr(0, extended_prefix.size()) == extended_prefix) {
    result.append(path.substr(extended_prefix.size()));
  } else if (path.size() >= 2 && path[0] == L'\\' && path[1] == L'\\') {
    result += L"UNC\\";
    result.append(path.substr(2));
  } else {
    result.append(path);
  }
  return result;
}

}  // namespace

ClipboardReparseFixture::~ClipboardReparseFixture() {
  Cleanup();
}

bool ClipboardReparseFixture::CreateRoot() {
  if (owns_root_) return false;
  std::filesystem::path parent;
  if (!FindPluginRoot(&parent)) return false;
  for (const wchar_t* segment : {L"artifacts", L"pasteboardpro",
                                 L"clipboard-format-g0",
                                 L"reparse-v09-worker", L"win32"}) {
    parent /= segment;
    if (!EnsureOwnedDirectory(parent.native())) return false;
  }

  const std::wstring base = parent.native() + L"\\fixture-" +
                            std::to_wstring(GetCurrentProcessId()) + L"-" +
                            std::to_wstring(GetTickCount64());
  for (unsigned int attempt = 0; attempt < 8; ++attempt) {
    root_ = base + L"-" + std::to_wstring(attempt);
    const std::wstring native = NativePath(root_);
    if (CreateDirectoryW(native.c_str(), nullptr)) {
      owns_root_ = true;
      return true;
    }
    if (GetLastError() != ERROR_ALREADY_EXISTS) {
      root_.clear();
      return false;
    }
  }
  root_.clear();
  return false;
}

bool ClipboardReparseFixture::CreateDirectory(const std::wstring& path) {
  if (!owns_root_ || !EnsureOwnedDirectory(path)) return false;
  directories_.push_back(path);
  return true;
}

bool ClipboardReparseFixture::CreateJunction(const std::wstring& link,
                                             const std::wstring& target) {
  const std::wstring native_link = NativePath(link);
  ScopedHandle handle(CreateFileW(
      native_link.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (handle.Get() == INVALID_HANDLE_VALUE) return false;

  const std::wstring substitute = SubstituteName(target);
  const std::size_t substitute_bytes = substitute.size() * sizeof(wchar_t);
  const std::size_t print_bytes = target.size() * sizeof(wchar_t);
  const std::size_t data_length = 8 + substitute_bytes + print_bytes;
  bool created = false;
  if (substitute_bytes <= UINT16_MAX && print_bytes <= UINT16_MAX &&
      data_length <= UINT16_MAX && data_length + 8 <= kMaximumReparseBufferSize) {
    std::vector<std::uint8_t> buffer(8 + data_length, 0);
    PutU32(&buffer, 0, kMountPointTag);
    PutU16(&buffer, 4, static_cast<std::uint16_t>(data_length));
    PutU16(&buffer, 8, 0);
    PutU16(&buffer, 10, static_cast<std::uint16_t>(substitute_bytes));
    PutU16(&buffer, 12, static_cast<std::uint16_t>(substitute_bytes));
    PutU16(&buffer, 14, static_cast<std::uint16_t>(print_bytes));
    PutWideBytes(&buffer, 16, substitute);
    PutWideBytes(&buffer, 16 + substitute_bytes, target);
    DWORD returned = 0;
    created = DeviceIoControl(handle.Get(), FSCTL_SET_REPARSE_POINT,
                              buffer.data(), static_cast<DWORD>(buffer.size()),
                              nullptr, 0, &returned, nullptr) != FALSE;
  }
  if (created) junctions_.push_back(link);
  return created;
}


bool ClipboardReparseFixture::CreateChain(std::size_t junction_count) {
  if (junction_count == 0 || junction_count > 64 || !CreateRoot()) return false;
  std::vector<std::wstring> links;
  links.reserve(junction_count);
  for (std::size_t index = 0; index < junction_count; ++index) {
    const std::wstring path = root_ + L"\\chain-" +
                              std::to_wstring(index);
    if (!CreateDirectory(path)) return false;
    links.push_back(path);
  }

  const std::wstring endpoint = root_ + L"\\endpoint";
  if (!CreateDirectory(endpoint)) return false;
  for (std::size_t index = 0; index < links.size(); ++index) {
    const std::wstring& target =
        index + 1 < links.size() ? links[index + 1] : endpoint;
    if (!CreateJunction(links[index], target)) return false;
  }
  reference_path_ = links.front();
  return true;
}

bool ClipboardReparseFixture::CreateCycle() {
  if (!CreateRoot()) return false;
  const std::wstring first = root_ + L"\\cycle-a";
  const std::wstring second = root_ + L"\\cycle-b";
  if (!CreateDirectory(first) || !CreateDirectory(second) ||
      !CreateJunction(first, second) || !CreateJunction(second, first)) {
    return false;
  }
  reference_path_ = first;
  return true;
}

void ClipboardReparseFixture::Cleanup() {
  if (!owns_root_) return;
  for (auto iterator = junctions_.rbegin(); iterator != junctions_.rend();
       ++iterator) {
    const std::wstring native = NativePath(*iterator);
    RemoveDirectoryW(native.c_str());
  }
  for (auto iterator = directories_.rbegin(); iterator != directories_.rend();
       ++iterator) {
    const std::wstring native = NativePath(*iterator);
    RemoveDirectoryW(native.c_str());
  }
  const std::wstring native_root = NativePath(root_);
  RemoveDirectoryW(native_root.c_str());
  owns_root_ = false;
}

}  // namespace clipboard_format_probe
