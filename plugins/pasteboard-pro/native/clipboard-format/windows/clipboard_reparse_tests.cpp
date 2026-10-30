#include "clipboard_reparse_tests.h"

#include "../common/clipboard_codecs.h"
#include "clipboard_file_references.h"
#include "clipboard_reparse_fixture.h"

#include <cstdint>
#include <string>
#include <vector>
#include <windows.h>

namespace clipboard_format_probe {
namespace {

constexpr char kDepth63Id[] = "file-ref-reparse-63-hop-allowed";
constexpr char kDepth64Id[] = "file-ref-reparse-64-hop-rejected";
constexpr char kCycleId[] = "file-ref-reparse-cycle-rejected";

bool ReadUserObjectName(HANDLE object, std::wstring* name) {
  if (object == nullptr || name == nullptr) return false;
  DWORD required_bytes = 0;
  SetLastError(ERROR_SUCCESS);
  GetUserObjectInformationW(object, UOI_NAME, nullptr, 0, &required_bytes);
  if (required_bytes < sizeof(wchar_t) || required_bytes > 65536 ||
      GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
    return false;
  }
  std::wstring buffer(required_bytes / sizeof(wchar_t), L'\0');
  if (!GetUserObjectInformationW(object, UOI_NAME, buffer.data(),
                                 required_bytes, &required_bytes)) {
    return false;
  }
  name->assign(buffer.data());
  return !name->empty();
}

bool IsPrivateProbeStation(const Win32ClipboardAdapter* adapter) {
  if (adapter == nullptr || !adapter->IsInitialized()) return false;
  const HWINSTA station = GetProcessWindowStation();
  const HDESK desktop = GetThreadDesktop(GetCurrentThreadId());
  if (station == nullptr || desktop == nullptr) return false;
  std::wstring station_name;
  std::wstring desktop_name;
  if (!ReadUserObjectName(station, &station_name) ||
      !ReadUserObjectName(desktop, &desktop_name) ||
      CompareStringOrdinal(station_name.c_str(), -1, L"WinSta0", -1, TRUE) ==
          CSTR_EQUAL ||
      CompareStringOrdinal(desktop_name.c_str(), -1,
                           L"ClipboardFormatProbe", -1, TRUE) != CSTR_EQUAL) {
    return false;
  }
  const DWORD owner_thread =
      GetWindowThreadProcessId(adapter->Window(), nullptr);
  return owner_thread != 0 && GetThreadDesktop(owner_thread) == desktop;
}

std::u16string AsUtf16(const std::wstring& value) {
  static_assert(sizeof(wchar_t) == sizeof(char16_t),
                "Win32 paths are UTF-16");
  std::u16string result;
  result.reserve(value.size());
  for (const wchar_t unit : value) {
    result.push_back(static_cast<char16_t>(unit));
  }
  return result;
}

FormatPayload MakeDirectoryReference(const std::wstring& path) {
  FormatPayload payload;
  payload.key = "file-list";
  payload.native_name = L"CF_HDROP";
  payload.format_id = CF_HDROP;
  payload.encoding = "utf16le-dropfiles";
  payload.fidelity = "representation-bytes-preserved";
  payload.source_format = "CF_HDROP";
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  if (!clipboard_codecs::BuildDropFilesWide({AsUtf16(path)}, &payload.bytes)) {
    payload.bytes.clear();
  }
  return payload;
}

CaseResult RunChainCase(const char* id, std::size_t junction_count,
                        bool expected_accessible) {
  ClipboardReparseFixture fixture;
  if (!fixture.CreateChain(junction_count)) {
    return CaseResult{id, "not-run", "junction-chain-fixture-unavailable"};
  }
  FormatPayload payload = MakeDirectoryReference(fixture.ReferencePath());
  if (payload.bytes.empty()) {
    return CaseResult{id, "fail", "directory-reference-encoding-failed"};
  }
  const std::vector<std::uint8_t> original_bytes = payload.bytes;
  std::string error;
  const bool accessible =
      FileReferencesAvailableForPublish({payload}, &error);
  const bool preserved = payload.bytes == original_bytes;
  const bool expected_error =
      expected_accessible ? error.empty()
                          : error == "file-reference-unavailable";
  const bool passed = accessible == expected_accessible && preserved &&
                      expected_error;
  const char* detail = expected_accessible
                           ? "63-junction-metadata-accessible-bytes-preserved"
                           : "64-junction-metadata-rejected-bytes-preserved";
  return CaseResult{id, passed ? "pass" : "fail", detail};
}

CaseResult RunCycleCase() {
  ClipboardReparseFixture fixture;
  if (!fixture.CreateCycle()) {
    return CaseResult{kCycleId, "not-run", "junction-cycle-fixture-unavailable"};
  }
  FormatPayload payload = MakeDirectoryReference(fixture.ReferencePath());
  if (payload.bytes.empty()) {
    return CaseResult{kCycleId, "fail", "directory-reference-encoding-failed"};
  }
  const std::vector<std::uint8_t> original_bytes = payload.bytes;
  std::string error;
  const bool accessible =
      FileReferencesAvailableForPublish({payload}, &error);
  const bool passed = !accessible &&
                      error == "file-reference-unavailable" &&
                      payload.bytes == original_bytes;
  return CaseResult{kCycleId, passed ? "pass" : "fail",
                    "junction-cycle-rejected-bytes-preserved"};
}

}  // namespace

std::vector<CaseResult> RunReparseBoundaryCases(
    Win32ClipboardAdapter* adapter) {
  if (!IsPrivateProbeStation(adapter)) {
    return {{kDepth63Id, "not-run", "isolated station unavailable"},
            {kDepth64Id, "not-run", "isolated station unavailable"},
            {kCycleId, "not-run", "isolated station unavailable"}};
  }
  return {RunChainCase(kDepth63Id, 63, true),
          RunChainCase(kDepth64Id, 64, false), RunCycleCase()};
}

}  // namespace clipboard_format_probe
