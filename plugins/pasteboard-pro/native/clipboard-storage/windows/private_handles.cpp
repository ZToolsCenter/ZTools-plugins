#include "private_storage.h"

#include <algorithm>

namespace pasteboard_storage {
namespace {

bool IsUsableHandle(HANDLE object) {
  return object != nullptr && object != INVALID_HANDLE_VALUE;
}

bool SameIdentity(const FileIdentity& left, const FileIdentity& right) {
  return left.volume_serial == right.volume_serial && left.file_id == right.file_id;
}

}  // namespace

Status InspectHandle(HANDLE object, bool directory, FileIdentity& identity) {
  identity = FileIdentity{};
  if (!IsUsableHandle(object)) return Status::invalid_request;

  if (GetFileType(object) != FILE_TYPE_DISK) return Status::type_rejected;

  FILE_ATTRIBUTE_TAG_INFO attribute_info{};
  if (!GetFileInformationByHandleEx(object, FileAttributeTagInfo,
                                     &attribute_info, sizeof(attribute_info))) {
    return Status::inspection_failed;
  }
  if ((attribute_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return Status::reparse_rejected;
  }

  const bool attribute_is_directory =
      (attribute_info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  if (attribute_is_directory != directory) return Status::type_rejected;

  FILE_STANDARD_INFO standard_info{};
  if (!GetFileInformationByHandleEx(object, FileStandardInfo, &standard_info,
                                    sizeof(standard_info))) {
    return Status::inspection_failed;
  }
  if ((standard_info.Directory != FALSE) != directory) return Status::type_rejected;
  if (!directory && standard_info.NumberOfLinks != 1) {
    return Status::hardlink_rejected;
  }

  FILE_ID_INFO id_info{};
  if (!GetFileInformationByHandleEx(object, FileIdInfo, &id_info, sizeof(id_info))) {
    return Status::inspection_failed;
  }

  identity.volume_serial = id_info.VolumeSerialNumber;
  std::copy_n(id_info.FileId.Identifier, identity.file_id.size(), identity.file_id.begin());
  return Status::ok;
}

Status RequireIdentity(HANDLE object, bool directory, const FileIdentity& expected) {
  FileIdentity actual{};
  const Status inspection = InspectHandle(object, directory, actual);
  if (inspection != Status::ok) return inspection;
  return SameIdentity(actual, expected) ? Status::ok : Status::identity_mismatch;
}

Status FlushOwnedFile(HANDLE object, const FileIdentity& expected) {
  // The caller supplies a GENERIC_WRITE handle, as required by FlushFileBuffers.
  const Status before = RequireIdentity(object, false, expected);
  if (before != Status::ok) return before;
  if (!FlushFileBuffers(object)) return Status::file_flush_failed;
  return RequireIdentity(object, false, expected);
}

Status ObserveDirectoryFlush(HANDLE object, const FileIdentity& expected,
                             DirectoryFlushObservation& observation) {
  observation = DirectoryFlushObservation::not_run;
  const Status identity = RequireIdentity(object, true, expected);
  if (identity != Status::ok) return identity;

  // This records API acceptance only; it does not establish namespace durability.
  const bool api_accepted = FlushFileBuffers(object) != FALSE;
  const Status after = RequireIdentity(object, true, expected);
  if (after != Status::ok) {
    observation = DirectoryFlushObservation::not_run;
    return after;
  }

  observation = api_accepted ? DirectoryFlushObservation::api_success
                             : DirectoryFlushObservation::api_rejected;
  return Status::ok;
}

}  // namespace pasteboard_storage
