#include "storage_probe_report.h"
#include "storage_probe_acl_cases.h"
#include "storage_probe_link_cases.h"
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <cstring>
#include <cstdio>
#include <fcntl.h>
#include <io.h>
#include <iostream>

namespace pasteboard_storage {
namespace {
std::wstring FixturePath() {
  std::array<wchar_t, 32768> buffer{};
  const DWORD written = GetTempPathW(static_cast<DWORD>(buffer.size()), buffer.data());
  if (written == 0 || written >= buffer.size()) return {};
  std::wstring parent(buffer.data(), written);
  if (parent.size() < 3 || parent[1] != L':' || parent[2] != L'\\') return {};
  std::array<BYTE, 16> nonce{};
  if (BCryptGenRandom(nullptr, nonce.data(), static_cast<ULONG>(nonce.size()),
                     BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) return {};
  if (parent.back() != L'\\') parent.push_back(L'\\');
  parent += L"pasteboard-storage-probe-";
  constexpr wchar_t hex[] = L"0123456789abcdef";
  for (BYTE value : nonce) { parent.push_back(hex[value >> 4]); parent.push_back(hex[value & 15]); }
  return parent;
}

bool RemoveOwnedHandle(OwnedHandle& handle) {
  if (!handle.valid()) return true;
  FILE_DISPOSITION_INFO disposition{};
  disposition.DeleteFile = TRUE;
  const bool marked = SetFileInformationByHandle(handle.get(), FileDispositionInfo,
                                                 &disposition, sizeof(disposition)) != FALSE;
  const bool closed = handle.close();
  return marked && closed;
}

bool IsAbsent(const std::wstring& path) {
  if (GetFileAttributesW(path.c_str()) != INVALID_FILE_ATTRIBUTES) return false;
  const DWORD error = GetLastError();
  return error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND;
}

Status WriteAndReadPublicMarker(HANDLE file, const FileIdentity& identity) {
  constexpr char marker[] = "public-storage-probe";
  DWORD written = 0;
  if (!WriteFile(file, marker, sizeof(marker) - 1, &written, nullptr) ||
      written != sizeof(marker) - 1) return Status::file_flush_failed;
  const Status flushed = FlushOwnedFile(file, identity);
  if (flushed != Status::ok) return flushed;
  LARGE_INTEGER beginning{};
  if (!SetFilePointerEx(file, beginning, nullptr, FILE_BEGIN)) return Status::inspection_failed;
  std::array<char, sizeof(marker)> received{};
  DWORD read = 0;
  if (!ReadFile(file, received.data(), static_cast<DWORD>(received.size()), &read, nullptr) ||
      read != sizeof(marker) - 1 || std::memcmp(received.data(), marker, read) != 0) {
    return Status::inspection_failed;
  }
  return RequireIdentity(file, false, identity);
}

void RunFixture(ProbeReport& report) {
  UserSid user;
  const Status token = ReadProcessUserSid(user);
  if (token != Status::ok) { report.Record("private-root-created", token); return; }
  const std::wstring root_path = FixturePath();
  if (root_path.empty()) { report.Record("private-root-created", Status::create_failed); return; }
  OwnedHandle root;
  OwnedHandle file;
  bool links_clean = true;
  const Status created = CreateNewPrivateDirectory(root_path, user, root);
  report.Record("private-root-created", created);
  if (created != Status::ok || !root.valid()) { report.Cleanup(false); return; }

  // Once created, cleanup stays bound to our exact handles. The fixture contains
  // only fixed public bytes; it never reads or writes the system clipboard.
  const auto cleanup = [&]() {
    const Status restored = RestorePrivateSecurity(root.get(), true, user);
    const bool file_removed = RemoveOwnedHandle(file);
    const bool root_removed = RemoveOwnedHandle(root);
    report.Cleanup(restored == Status::ok && links_clean && file_removed && root_removed && IsAbsent(root_path));
  };
  try {
    const Status root_security = RequirePrivateSecurity(root.get(), true, user);
    report.Record("root-owner-dacl-verified", root_security);
    FileIdentity root_identity{};
    if (root_security != Status::ok || InspectHandle(root.get(), true, root_identity) != Status::ok) {
      cleanup(); return;
    }
    const Status file_created = CreateNewPrivateFile(root_path + L"\\public-marker.bin", user, file);
    report.Record("private-file-created", file_created);
    if (file_created != Status::ok || !file.valid()) { cleanup(); return; }
    report.Record("file-owner-dacl-verified", RequirePrivateSecurity(file.get(), false, user));
    FileIdentity identity{};
    const Status inspected = InspectHandle(file.get(), false, identity);
    report.Record("file-identity-stable", inspected == Status::ok
      ? RequireIdentity(file.get(), false, identity) : inspected);
    report.Record("file-flush-write-handle", inspected == Status::ok
      ? WriteAndReadPublicMarker(file.get(), identity) : inspected);
    FileIdentity wrong = identity;
    wrong.file_id[0] ^= 1;
    report.Record("mismatched-identity-rejected", RequireIdentity(file.get(), false, wrong), Status::identity_mismatch);
    report.Record("file-kind-mismatch-rejected", InspectHandle(root.get(), false, wrong), Status::type_rejected);

    const auto acl = RunOwnedAclCases(root.get(), user);
    report.Record("null-dacl-rejected", acl.null_dacl, Status::acl_rejected);
    report.Record("empty-dacl-rejected", acl.empty_dacl, Status::acl_rejected);
    report.Record("additional-principal-rejected", acl.extra_principal, Status::acl_rejected);
    if (acl.restore == Status::ok && RequirePrivateSecurity(root.get(), true, user) == Status::ok) {
      const auto links = RunOwnedLinkCases(root_path, user);
      report.Record("reparse-object-rejected", links.reparse_status, Status::reparse_rejected);
      report.Record("hardlink-object-rejected", links.hardlink_status, Status::hardlink_rejected);
      links_clean = links.cleanup_status == Status::ok;
    } else links_clean = false;

    report.Record("directory-flush-call-observed", ObserveDirectoryFlush(root.get(), root_identity,
      report.directory_flush));
    cleanup();
  } catch (...) {
    report.Record("file-flush-write-handle", Status::inspection_failed);
    cleanup();
  }
}
}  // namespace
}  // namespace pasteboard_storage

int wmain(int argc, wchar_t** argv) {
  // CRT text mode would translate the canonical LF wire to CRLF on Windows.
  if (_setmode(_fileno(stdout), _O_BINARY) == -1) return 2;
  pasteboard_storage::ProbeReport report;
  if (argc == 2 && std::wstring_view(argv[1]) == L"--self-test") {
    try { pasteboard_storage::RunFixture(report); }
    catch (...) { report.Record("private-root-created", pasteboard_storage::Status::inspection_failed); }
  }
  report.Write();
  if (!std::cout.good()) return 2;
  return report.Execution() == "PASS" ? 0 : report.Execution() == "FAIL" ? 1 : 2;
}
