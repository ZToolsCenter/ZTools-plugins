#include "storage_probe_link_cases.h"

#include <winioctl.h>

#include <array>
#include <cstddef>
#include <cstring>
#include <string>

namespace pasteboard_storage {
namespace {

constexpr std::size_t kMaximumReparseBufferSize = 16 * 1024;
constexpr std::size_t kMaximumWordValue = 0xFFFFu;
constexpr std::size_t kReparseHeaderSize = 8;
constexpr std::size_t kMountPointFieldsSize = 8;
constexpr std::size_t kPathBufferOffset = kReparseHeaderSize + kMountPointFieldsSize;
constexpr std::size_t kPathBufferCharacters =
    (kMaximumReparseBufferSize - kPathBufferOffset) / sizeof(WCHAR);
constexpr wchar_t kTargetChildName[] = L"pasteboard-storage-link-target";
constexpr wchar_t kJunctionChildName[] = L"pasteboard-storage-junction";
constexpr wchar_t kHardlinkSourceName[] = L"pasteboard-storage-hardlink-source";
constexpr wchar_t kHardlinkAliasName[] = L"pasteboard-storage-hardlink-alias";

struct JunctionReparseBuffer {
  DWORD tag;
  WORD data_length;
  WORD reserved;
  WORD substitute_name_offset;
  WORD substitute_name_length;
  WORD print_name_offset;
  WORD print_name_length;
  WCHAR path_buffer[kPathBufferCharacters];
};
static_assert(offsetof(JunctionReparseBuffer, path_buffer) == kPathBufferOffset,
              "junction buffer layout must match the Windows mount-point format");
static_assert(sizeof(JunctionReparseBuffer) == kMaximumReparseBufferSize,
              "junction buffer must stay within the Windows reparse limit");

struct CleanupState {
  Status status = Status::ok;

  void CloseFailed() {
    if (status == Status::ok) status = Status::close_failed;
  }

  void Incomplete() { status = Status::cleanup_incomplete; }
};

bool IsUsableHandle(HANDLE handle) {
  return handle != nullptr && handle != INVALID_HANDLE_VALUE;
}

std::wstring ChildPath(const std::wstring& root, const wchar_t* child) {
  if (root.empty()) return {};
  std::wstring path = root;
  if (path.back() != L'\\' && path.back() != L'/') path.push_back(L'\\');
  path.append(child);
  return path;
}

bool ContainsNull(const std::wstring& value) {
  return value.find(L'\0') != std::wstring::npos;
}

bool SameIdentity(const FileIdentity& left, const FileIdentity& right) {
  return left.volume_serial == right.volume_serial && left.file_id == right.file_id;
}

// Read identity without rejecting reparse points or multiply-linked files. Cleanup
// must identify the held object even when that is the expected negative test case.
Status ReadRawIdentity(HANDLE object, bool directory, FileIdentity& identity) {
  identity = FileIdentity{};
  if (!IsUsableHandle(object)) return Status::invalid_request;
  if (GetFileType(object) != FILE_TYPE_DISK) return Status::type_rejected;

  FILE_ATTRIBUTE_TAG_INFO attributes{};
  if (!GetFileInformationByHandleEx(object, FileAttributeTagInfo,
                                     &attributes, sizeof(attributes))) {
    return Status::inspection_failed;
  }
  const bool is_directory = (attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  if (is_directory != directory) return Status::type_rejected;

  FILE_STANDARD_INFO standard{};
  if (!GetFileInformationByHandleEx(object, FileStandardInfo, &standard, sizeof(standard))) {
    return Status::inspection_failed;
  }
  if ((standard.Directory != FALSE) != directory) return Status::type_rejected;

  FILE_ID_INFO id{};
  if (!GetFileInformationByHandleEx(object, FileIdInfo, &id, sizeof(id))) {
    return Status::inspection_failed;
  }
  identity.volume_serial = id.VolumeSerialNumber;
  std::memcpy(identity.file_id.data(), id.FileId.Identifier, identity.file_id.size());
  return Status::ok;
}

Status OpenOwnedObject(const std::wstring& path, bool directory, OwnedHandle& output,
                       CleanupState& cleanup) {
  constexpr DWORD access = DELETE | FILE_READ_ATTRIBUTES | READ_CONTROL;
  constexpr DWORD sharing = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
  const DWORD flags = directory
      ? FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT
      : FILE_FLAG_OPEN_REPARSE_POINT;
  HANDLE handle = CreateFileW(path.c_str(), access, sharing, nullptr, OPEN_EXISTING,
                              flags, nullptr);
  if (!IsUsableHandle(handle)) return Status::inspection_failed;
  if (output.adopt(handle)) return Status::ok;
  if (!CloseHandle(handle)) cleanup.CloseFailed();
  return Status::inspection_failed;
}

bool CloseTracked(OwnedHandle& handle, CleanupState& cleanup) {
  if (!handle.close()) {
    cleanup.CloseFailed();
    return false;
  }
  return true;
}

// FileDispositionInfo acts on the object referenced by this handle. The identity
// check prevents deleting a handle that no longer refers to the created fixture.
bool MarkOwnedForDeletion(OwnedHandle& handle, bool directory,
                          const FileIdentity& expected, CleanupState& cleanup) {
  FileIdentity actual{};
  const Status identity_status = ReadRawIdentity(handle.get(), directory, actual);
  if (identity_status != Status::ok || !SameIdentity(actual, expected)) {
    cleanup.Incomplete();
    return false;
  }

  FILE_DISPOSITION_INFO disposition{};
  disposition.DeleteFile = TRUE;
  if (!SetFileInformationByHandle(handle.get(), FileDispositionInfo,
                                  &disposition, sizeof(disposition))) {
    cleanup.Incomplete();
    return false;
  }
  return true;
}

void DeleteAndClose(OwnedHandle& handle, bool directory, const FileIdentity& expected,
                    CleanupState& cleanup) {
  if (handle.valid()) MarkOwnedForDeletion(handle, directory, expected, cleanup);
  CloseTracked(handle, cleanup);
}

bool BuildAbsolutePath(const std::wstring& path, std::wstring& absolute) {
  if (path.empty() || ContainsNull(path)) return false;
  std::array<wchar_t, 32768> buffer{};
  const DWORD length = GetFullPathNameW(path.c_str(), static_cast<DWORD>(buffer.size()),
                                        buffer.data(), nullptr);
  if (length == 0 || length >= buffer.size()) return false;
  absolute.assign(buffer.data(), length);
  return true;
}

bool IsDriveAbsolute(const std::wstring& path) {
  if (path.size() < 3 || path[1] != L':' ||
      (path[2] != L'\\' && path[2] != L'/')) {
    return false;
  }
  const wchar_t drive = path[0];
  return (drive >= L'A' && drive <= L'Z') || (drive >= L'a' && drive <= L'z');
}

bool BuildJunctionNames(const std::wstring& target_path, std::wstring& substitute_name,
                        std::wstring& print_name) {
  std::wstring absolute;
  if (!BuildAbsolutePath(target_path, absolute)) return false;
  if (ContainsNull(absolute)) return false;

  constexpr wchar_t kExtendedUncPrefix[] = L"\\\\?\\UNC\\";
  constexpr wchar_t kExtendedPrefix[] = L"\\\\?\\";
  if (absolute.rfind(kExtendedUncPrefix, 0) == 0) {
    substitute_name = L"\\??\\UNC\\" + absolute.substr(8);
    print_name = L"\\\\" + absolute.substr(8);
  } else if (absolute.rfind(kExtendedPrefix, 0) == 0) {
    substitute_name = L"\\??\\" + absolute.substr(4);
    print_name = absolute.substr(4);
  } else if (absolute.rfind(L"\\\\", 0) == 0) {
    substitute_name = L"\\??\\UNC\\" + absolute.substr(2);
    print_name = absolute;
  } else if (IsDriveAbsolute(absolute)) {
    substitute_name = L"\\??\\" + absolute;
    print_name = absolute;
  } else {
    return false;
  }
  return !substitute_name.empty() && !print_name.empty() &&
         !ContainsNull(substitute_name) && !ContainsNull(print_name);
}

bool SetOwnedJunction(HANDLE junction, const std::wstring& target_path) {
  std::wstring substitute_name;
  std::wstring print_name;
  if (!BuildJunctionNames(target_path, substitute_name, print_name)) return false;

  const std::size_t substitute_bytes = substitute_name.size() * sizeof(WCHAR);
  const std::size_t print_bytes = print_name.size() * sizeof(WCHAR);
  const std::size_t print_offset = substitute_bytes + sizeof(WCHAR);
  const std::size_t path_bytes = substitute_bytes + sizeof(WCHAR) + print_bytes + sizeof(WCHAR);
  const std::size_t data_length = kMountPointFieldsSize + path_bytes;
  const std::size_t input_length = kReparseHeaderSize + data_length;
  if (substitute_bytes > kMaximumWordValue || print_bytes > kMaximumWordValue ||
      print_offset > kMaximumWordValue || data_length > kMaximumWordValue ||
      input_length > kMaximumReparseBufferSize) {
    return false;
  }

  JunctionReparseBuffer buffer{};
  buffer.tag = IO_REPARSE_TAG_MOUNT_POINT;
  buffer.data_length = static_cast<WORD>(data_length);
  buffer.substitute_name_offset = 0;
  buffer.substitute_name_length = static_cast<WORD>(substitute_bytes);
  buffer.print_name_offset = static_cast<WORD>(print_offset);
  buffer.print_name_length = static_cast<WORD>(print_bytes);

  const std::size_t substitute_chars = substitute_name.size();
  const std::size_t print_chars = print_name.size();
  std::memcpy(buffer.path_buffer, substitute_name.data(), substitute_bytes);
  buffer.path_buffer[substitute_chars] = L'\0';
  std::memcpy(buffer.path_buffer + substitute_chars + 1, print_name.data(), print_bytes);
  buffer.path_buffer[substitute_chars + 1 + print_chars] = L'\0';

  DWORD bytes_returned = 0;
  return DeviceIoControl(junction, FSCTL_SET_REPARSE_POINT, &buffer,
                         static_cast<DWORD>(input_length), nullptr, 0,
                         &bytes_returned, nullptr) != FALSE;
}

Status RunReparseCase(const std::wstring& root, const UserSid& user_sid,
                      CleanupState& cleanup) {
  const std::wstring target_path = ChildPath(root, kTargetChildName);
  const std::wstring junction_path = ChildPath(root, kJunctionChildName);
  if (target_path.empty() || junction_path.empty()) return Status::invalid_request;

  OwnedHandle target_handle;
  OwnedHandle junction_handle;
  FileIdentity target_identity{};
  FileIdentity junction_identity{};
  bool target_created = false;
  bool junction_created = false;
  Status outcome = Status::create_failed;

  do {
    Status status = CreateNewPrivateDirectory(target_path, user_sid, target_handle);
    if (status == Status::cleanup_incomplete) cleanup.Incomplete();
    if (status != Status::ok) {
      outcome = status;
      break;
    }
    target_created = target_handle.valid();
    if (!target_created ||
        ReadRawIdentity(target_handle.get(), true, target_identity) != Status::ok) {
      outcome = Status::inspection_failed;
      break;
    }

    // Keep the factory handle throughout setup and cleanup. It is bound to the
    // directory object on which the reparse point is installed.
    status = CreateNewPrivateDirectory(junction_path, user_sid, junction_handle);
    if (status == Status::cleanup_incomplete) cleanup.Incomplete();
    if (status != Status::ok) {
      outcome = status;
      break;
    }
    junction_created = junction_handle.valid();
    if (!junction_created ||
        ReadRawIdentity(junction_handle.get(), true, junction_identity) != Status::ok) {
      outcome = Status::inspection_failed;
      break;
    }
    if (!SetOwnedJunction(junction_handle.get(), target_path)) {
      outcome = Status::create_failed;
      break;
    }

    FileIdentity ignored{};
    status = InspectHandle(junction_handle.get(), true, ignored);
    outcome = status == Status::ok ? Status::inspection_failed : status;
  } while (false);

  if (junction_created) DeleteAndClose(junction_handle, true, junction_identity, cleanup);
  else CloseTracked(junction_handle, cleanup);
  if (target_created) DeleteAndClose(target_handle, true, target_identity, cleanup);
  else CloseTracked(target_handle, cleanup);
  return outcome;
}

Status RunHardlinkCase(const std::wstring& root, const UserSid& user_sid,
                       CleanupState& cleanup) {
  const std::wstring source_path = ChildPath(root, kHardlinkSourceName);
  const std::wstring alias_path = ChildPath(root, kHardlinkAliasName);
  if (source_path.empty() || alias_path.empty()) return Status::invalid_request;

  OwnedHandle source_create_handle;
  OwnedHandle source_handle;
  OwnedHandle alias_handle;
  FileIdentity source_identity{};
  bool source_created = false;
  bool alias_created = false;
  Status outcome = Status::create_failed;

  do {
    Status status = CreateNewPrivateFile(source_path, user_sid, source_create_handle);
    if (status == Status::cleanup_incomplete) cleanup.Incomplete();
    if (status != Status::ok) {
      outcome = status;
      break;
    }
    source_created = source_create_handle.valid();
    if (!source_created ||
        ReadRawIdentity(source_create_handle.get(), false, source_identity) != Status::ok) {
      outcome = Status::inspection_failed;
      break;
    }
    FileIdentity inspected_source{};
    if (InspectHandle(source_create_handle.get(), false, inspected_source) != Status::ok) {
      outcome = Status::inspection_failed;
      break;
    }

    // The factory handle denies delete sharing, so close it before adding a link.
    if (!CloseTracked(source_create_handle, cleanup)) {
      outcome = Status::close_failed;
      break;
    }
    if (!CreateHardLinkW(alias_path.c_str(), source_path.c_str(), nullptr)) {
      outcome = Status::create_failed;
      break;
    }
    alias_created = true;

    status = OpenOwnedObject(source_path, false, source_handle, cleanup);
    if (status != Status::ok) {
      outcome = status;
      break;
    }
    status = OpenOwnedObject(alias_path, false, alias_handle, cleanup);
    if (status != Status::ok) {
      outcome = status;
      break;
    }

    FileIdentity opened_source{};
    FileIdentity opened_alias{};
    if (ReadRawIdentity(source_handle.get(), false, opened_source) != Status::ok ||
        ReadRawIdentity(alias_handle.get(), false, opened_alias) != Status::ok ||
        !SameIdentity(opened_source, source_identity) ||
        !SameIdentity(opened_alias, source_identity)) {
      outcome = Status::identity_mismatch;
      break;
    }

    FileIdentity ignored{};
    status = InspectHandle(source_handle.get(), false, ignored);
    outcome = status == Status::ok ? Status::inspection_failed : status;
  } while (false);

  // Independently remove only handles that still name the original created file.
  // A raced replacement stays untouched and makes the cleanup receipt incomplete.
  if (source_handle.valid()) {
    DeleteAndClose(source_handle, false, source_identity, cleanup);
  } else if (source_create_handle.valid() && !alias_created) {
    DeleteAndClose(source_create_handle, false, source_identity, cleanup);
  } else if (source_created) {
    // Reopen only to bind cleanup to the original file ID after its factory
    // handle was closed for hardlink creation.
    const Status open_status = OpenOwnedObject(source_path, false, source_handle, cleanup);
    if (open_status == Status::ok) {
      DeleteAndClose(source_handle, false, source_identity, cleanup);
    } else {
      cleanup.Incomplete();
    }
  } else {
    CloseTracked(source_handle, cleanup);
  }

  if (alias_handle.valid()) {
    DeleteAndClose(alias_handle, false, source_identity, cleanup);
  } else if (alias_created) {
    const Status open_status = OpenOwnedObject(alias_path, false, alias_handle, cleanup);
    if (open_status == Status::ok) {
      DeleteAndClose(alias_handle, false, source_identity, cleanup);
    } else {
      cleanup.Incomplete();
    }
  } else {
    CloseTracked(alias_handle, cleanup);
  }

  CloseTracked(source_create_handle, cleanup);
  return outcome;
}

}  // namespace

LinkCaseResults RunOwnedLinkCases(const std::wstring& root, const UserSid& user_sid) {
  LinkCaseResults results{};
  if (root.empty() || ContainsNull(root) || user_sid.empty()) return results;

  CleanupState cleanup;
  results.reparse_status = RunReparseCase(root, user_sid, cleanup);
  results.hardlink_status = RunHardlinkCase(root, user_sid, cleanup);
  results.cleanup_status = cleanup.status;
  return results;
}

}  // namespace pasteboard_storage
