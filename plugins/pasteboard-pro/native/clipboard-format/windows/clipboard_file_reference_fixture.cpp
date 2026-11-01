#include "clipboard_file_reference_fixture.h"

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <string_view>
#include <vector>
#include <windows.h>
#include <winioctl.h>

namespace clipboard_format_probe {
namespace {

constexpr std::string_view kFixtureContents = "pasteboard-pro-g0-fixture";
constexpr ULONG kMountPointTag = 0xA0000003;
constexpr std::size_t kReparseBufferLimit = 16 * 1024;

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

bool EnsureOwnedDirectory(const std::wstring& path) {
  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  if (GetLastError() != ERROR_ALREADY_EXISTS) return false;
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0 &&
         (attributes & FILE_ATTRIBUTE_REPARSE_POINT) == 0;
}

bool WriteFixtureFile(const std::wstring& path) {
  HANDLE file = CreateFileW(
      path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
      FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_NO_RECALL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;
  DWORD written = 0;
  const bool succeeded = WriteFile(
                            file, kFixtureContents.data(),
                            static_cast<DWORD>(kFixtureContents.size()),
                            &written, nullptr) != FALSE &&
                        written == kFixtureContents.size();
  const bool closed = CloseHandle(file) != FALSE;
  return succeeded && closed;
}

}  // namespace

ClipboardFileReferenceFixture::~ClipboardFileReferenceFixture() {
  Cleanup();
}

bool ClipboardFileReferenceFixture::Create(bool ascii_names) {
  if (owns_root_) return false;

  std::error_code error;
  const auto current = std::filesystem::current_path(error);
  if (error) return false;
  std::filesystem::path directory = current;
  for (const wchar_t* segment : {L"artifacts", L"pasteboardpro",
                                 L"clipboard-format-g0", L"win32",
                                 L"file-references"}) {
    directory /= segment;
    if (!EnsureOwnedDirectory(directory.native())) return false;
  }

  const std::wstring base = directory.native() + L"\\fixture-" +
      std::to_wstring(GetCurrentProcessId()) + L"-" +
      std::to_wstring(GetTickCount64());
  for (unsigned int attempt = 0; attempt < 8; ++attempt) {
    root_ = base + L"-" + std::to_wstring(attempt);
    if (!CreateDirectoryW(root_.c_str(), nullptr)) {
      if (GetLastError() == ERROR_ALREADY_EXISTS) continue;
      root_.clear();
      return false;
    }
    owns_root_ = true;
    break;
  }
  if (!owns_root_) return false;

  file_ = root_ + (ascii_names ? L"\\file.txt" : L"\\主文件.txt");
  directory_ = root_ + (ascii_names ? L"\\directory" : L"\\资料目录");
  moved_source_ = root_ + L"\\move-source.txt";
  moved_target_ = root_ + L"\\move-target.txt";
  directory_junction_ = root_ + (ascii_names ? L"\\directory-link" : L"\\资料目录链接");
  if (!WriteFixtureFile(file_) || !CreateDirectoryW(directory_.c_str(), nullptr) ||
      !WriteFixtureFile(moved_source_)) {
    Cleanup();
    return false;
  }
  return true;
}

bool ClipboardFileReferenceFixture::DeleteFile() {
  if (file_.empty()) return false;
  if (::DeleteFileW(file_.c_str())) return true;
  return GetLastError() == ERROR_FILE_NOT_FOUND;
}

bool ClipboardFileReferenceFixture::MoveFile() {
  return !moved_source_.empty() && !moved_target_.empty() &&
         MoveFileExW(moved_source_.c_str(), moved_target_.c_str(),
                     MOVEFILE_WRITE_THROUGH) != FALSE;
}

bool ClipboardFileReferenceFixture::CreateDirectoryJunction() {
  if (!owns_root_ || directory_junction_.empty() || directory_.empty() ||
      !CreateDirectoryW(directory_junction_.c_str(), nullptr)) {
    return false;
  }
  HANDLE handle = CreateFileW(
      directory_junction_.c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr);
  if (handle == INVALID_HANDLE_VALUE) {
    RemoveDirectoryW(directory_junction_.c_str());
    return false;
  }

  std::wstring substitute = L"\\??\\";
  if (directory_.size() >= 4 && directory_.substr(0, 4) == L"\\\\?\\") {
    if (directory_.size() >= 8 &&
        CompareStringOrdinal(directory_.data(), 8, L"\\\\?\\UNC\\", 8,
                             TRUE) == CSTR_EQUAL) {
      substitute += L"UNC\\" + directory_.substr(8);
    } else {
      substitute += directory_.substr(4);
    }
  } else {
    substitute += directory_;
  }

  const std::size_t substitute_bytes = substitute.size() * sizeof(wchar_t);
  const std::size_t print_bytes = directory_.size() * sizeof(wchar_t);
  const std::size_t data_length = 8 + substitute_bytes + print_bytes;
  bool created = false;
  if (substitute_bytes <= UINT16_MAX && print_bytes <= UINT16_MAX &&
      data_length <= UINT16_MAX && data_length + 8 <= kReparseBufferLimit) {
    std::vector<std::uint8_t> buffer(8 + data_length, 0);
    PutU32(&buffer, 0, kMountPointTag);
    PutU16(&buffer, 4, static_cast<std::uint16_t>(data_length));
    PutU16(&buffer, 8, 0);
    PutU16(&buffer, 10, static_cast<std::uint16_t>(substitute_bytes));
    PutU16(&buffer, 12, static_cast<std::uint16_t>(substitute_bytes));
    PutU16(&buffer, 14, static_cast<std::uint16_t>(print_bytes));
    std::memcpy(buffer.data() + 16, substitute.data(), substitute_bytes);
    std::memcpy(buffer.data() + 16 + substitute_bytes, directory_.data(),
                print_bytes);
    DWORD returned = 0;
    created = DeviceIoControl(handle, FSCTL_SET_REPARSE_POINT,
                              buffer.data(), static_cast<DWORD>(buffer.size()),
                              nullptr, 0, &returned, nullptr) != FALSE;
  }
  CloseHandle(handle);
  if (!created) RemoveDirectoryW(directory_junction_.c_str());
  return created;
}

void ClipboardFileReferenceFixture::Cleanup() {
  if (!owns_root_) return;
  if (!file_.empty()) ::DeleteFileW(file_.c_str());
  if (!moved_source_.empty()) ::DeleteFileW(moved_source_.c_str());
  if (!moved_target_.empty()) ::DeleteFileW(moved_target_.c_str());
  if (!directory_junction_.empty()) RemoveDirectoryW(directory_junction_.c_str());
  if (!directory_.empty()) RemoveDirectoryW(directory_.c_str());
  RemoveDirectoryW(root_.c_str());
  owns_root_ = false;
}

}  // namespace clipboard_format_probe
