#include "clipboard_file_references_tests.h"

#include "../common/clipboard_codecs.h"
#include "clipboard_file_reference_fixture.h"
#include "clipboard_file_references.h"
#include "clipboard_formats.h"
#include "clipboard_self_test_comparison.h"
#include "clipboard_self_test_fixtures.h"

#include <array>
#include <cstdint>
#include <functional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>
#include <windows.h>

namespace clipboard_format_probe {
class ClipboardFileReferenceTestAccess final {
 public:
  static void SetAccessProbe(
      Win32ClipboardAdapter* adapter,
      std::function<bool(std::wstring_view, bool)> probe) {
    adapter->file_reference_access_for_testing_ = std::move(probe);
  }

  static void SetBeforeRevisionHook(Win32ClipboardAdapter* adapter,
                                    std::function<void()> hook) {
    adapter->publish_before_file_reference_revision_check_for_testing_ =
        std::move(hook);
  }

  static void Clear(Win32ClipboardAdapter* adapter) {
    adapter->file_reference_access_for_testing_ = {};
    adapter->publish_before_file_reference_revision_check_for_testing_ = {};
  }
};

namespace {

constexpr std::array<const char*, 12> kCaseIds = {
    "file-ref-existing-file-directory-order-roundtrip",
    "file-ref-deleted-capture-preserves-original-bytes",
    "file-ref-deleted-publish-preserves-clipboard",
    "file-ref-moved-publish-preserves-clipboard",
    "file-ref-denied-access-preserves-clipboard",
    "file-ref-revision-race-superseded",
    "file-ref-ansi-acp-roundtrip",
    "file-ref-ansi-invalid-path-rejected",
    "file-ref-ansi-context-change-rejected",
    "file-ref-relative-path-rejected",
    "file-ref-device-path-rejected",
    "file-ref-linked-filesystem-target"};

void Add(std::vector<CaseResult>* results, const char* id, bool passed,
         const char* passed_detail = "file-reference-case-passed",
         const char* failed_detail = "file-reference-case-failed") {
  results->push_back(CaseResult{id, passed ? "pass" : "fail",
                                passed ? passed_detail : failed_detail});
}

FormatPayload MakeDrop(std::vector<std::u16string> paths) {
  FormatPayload payload;
  payload.key = "file-list";
  payload.native_name = L"CF_HDROP";
  payload.format_id = CF_HDROP;
  payload.encoding = "utf16le-dropfiles";
  payload.fidelity = "representation-bytes-preserved";
  payload.source_format = "CF_HDROP";
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  if (!clipboard_codecs::BuildDropFilesWide(paths, &payload.bytes)) {
    payload.bytes.clear();
  }
  return payload;
}

FormatPayload MakeAnsiDrop(std::string_view path) {
  FormatPayload payload;
  payload.key = "file-list";
  payload.native_name = L"CF_HDROP";
  payload.format_id = CF_HDROP;
  payload.encoding = "ansi-dropfiles";
  payload.validation_code_page = GetACP();
  payload.fidelity = "representation-bytes-preserved";
  payload.source_format = "CF_HDROP";
  payload.source_origin = "unknown";
  payload.materialization = "current-clipboard-format-bytes";
  payload.bytes.assign(20, 0);
  payload.bytes[0] = 20;
  payload.bytes[16] = 0;
  payload.bytes.insert(payload.bytes.end(), path.begin(), path.end());
  payload.bytes.push_back(0);
  payload.bytes.push_back(0);
  return payload;
}

std::u16string AsUtf16(const std::wstring& path) {
  return std::u16string(path.begin(), path.end());
}

bool PublishAndRoundTrip(Win32ClipboardAdapter* adapter,
                         const FormatPayload& payload) {
  if (adapter == nullptr || payload.bytes.empty() ||
      !FileReferencesAvailableForPublish({payload}, nullptr)) {
    return false;
  }
  const OperationResult published =
      adapter->Publish(adapter->Revision(), {payload});
  if (published.status != OperationStatus::committed) return false;
  ClipboardSnapshot first;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &first);
  if (!self_test_comparison::CompleteCaptureMatchesPublished(
          {payload}, captured, first, true)) {
    return false;
  }
  const OperationResult replay =
      adapter->Publish(captured.observed_revision, first.formats);
  if (replay.status != OperationStatus::committed) return false;
  ClipboardSnapshot second;
  const OperationResult readback = adapter->Capture(replay.observed_revision,
                                                     &second);
  return self_test_comparison::CompleteCaptureMatchesExactly(
      first.formats, readback, second, true);
}

struct Baseline {
  std::uint32_t revision = 0;
  std::vector<FormatPayload> formats;
};

bool PutBaseline(Win32ClipboardAdapter* adapter, Baseline* baseline,
                 std::string text = "before-file-reference-check") {
  if (adapter == nullptr || baseline == nullptr) return false;
  const auto payload = test_fixtures::MakeText(CF_UNICODETEXT, text);
  const OperationResult published =
      adapter->Publish(adapter->Revision(), {payload});
  if (published.status != OperationStatus::committed) return false;
  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &snapshot);
  if (captured.status != OperationStatus::committed ||
      snapshot.formats.empty()) {
    return false;
  }
  baseline->revision = snapshot.revision_after_materialization;
  baseline->formats = std::move(snapshot.formats);
  return true;
}

bool BaselineIsStillPresent(Win32ClipboardAdapter* adapter,
                            const Baseline& baseline) {
  if (adapter == nullptr || adapter->Revision() != baseline.revision) {
    return false;
  }
  ClipboardSnapshot snapshot;
  const OperationResult captured = adapter->Capture(baseline.revision, &snapshot);
  return captured.status == OperationStatus::committed &&
         self_test_comparison::CompleteCaptureMatchesExactly(
             baseline.formats, captured, snapshot, false);
}

bool RejectMissingReferencePreservesBoard(Win32ClipboardAdapter* adapter,
                                          bool move_before_check) {
  if (adapter == nullptr) return false;
  ClipboardFileReferenceFixture fixture;
  if (!fixture.Create()) return false;
  if (move_before_check ? !fixture.MoveFile() : !fixture.DeleteFile()) {
    return false;
  }

  Baseline baseline;
  if (!PutBaseline(adapter, &baseline)) return false;
  const std::wstring stale = move_before_check ? fixture.MovedSource()
                                               : fixture.File();
  const FormatPayload drop = MakeDrop({AsUtf16(stale)});
  const OperationResult rejected =
      adapter->Publish(baseline.revision, {drop});
  const bool result =
      rejected.status == OperationStatus::file_reference_unavailable &&
      rejected.reason == "file-reference-unavailable" &&
      !rejected.clipboard_may_have_changed &&
      rejected.expected_revision == baseline.revision &&
      rejected.observed_revision == baseline.revision &&
      adapter->Revision() == baseline.revision &&
      BaselineIsStillPresent(adapter, baseline);
  return result;
}

bool TestRevisionRace(Win32ClipboardAdapter* adapter) {
  ClipboardFileReferenceFixture race_fixture;
  if (!race_fixture.Create()) return false;
  Baseline baseline;
  if (!PutBaseline(adapter, &baseline)) return false;
  const auto outer_payload = MakeDrop({AsUtf16(race_fixture.Directory())});
  const auto replacement = test_fixtures::MakeText(
      CF_UNICODETEXT, "after-file-reference-check");
  unsigned int access_checks = 0;
  unsigned int revision_hook_calls = 0;
  bool saw_existing_directory = false;
  bool replacement_published = false;
  ClipboardFileReferenceTestAccess::SetAccessProbe(
      adapter, [&](std::wstring_view path, bool is_directory) {
        ++access_checks;
        saw_existing_directory = path == race_fixture.Directory() && is_directory;
        return saw_existing_directory;
      });
  ClipboardFileReferenceTestAccess::SetBeforeRevisionHook(adapter, [&] {
    ++revision_hook_calls;
    replacement_published =
        adapter->Publish(adapter->Revision(), {replacement}).status ==
        OperationStatus::committed;
  });
  const OperationResult outer =
      adapter->Publish(baseline.revision, {outer_payload});
  ClipboardFileReferenceTestAccess::Clear(adapter);
  if (access_checks != 1 || !saw_existing_directory ||
      revision_hook_calls != 1 || !replacement_published ||
      outer.status != OperationStatus::superseded ||
      outer.reason != "clipboard changed during file reference preflight" ||
      outer.clipboard_may_have_changed ||
      outer.observed_revision == baseline.revision) {
    return false;
  }
  ClipboardSnapshot current;
  const OperationResult captured =
      adapter->Capture(adapter->Revision(), &current);
  return captured.status == OperationStatus::committed &&
         self_test_comparison::CompleteCaptureMatchesPublished(
             {replacement}, captured, current, false);
}

bool ReadUserObjectName(HANDLE object, std::wstring* name) {
  DWORD required_bytes = 0;
  SetLastError(ERROR_SUCCESS);
  GetUserObjectInformationW(object, UOI_NAME, nullptr, 0, &required_bytes);
  if (required_bytes < sizeof(wchar_t) || required_bytes > 65536 ||
      GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
    return false;
  }
  std::vector<wchar_t> buffer(
      (required_bytes + sizeof(wchar_t) - 1) / sizeof(wchar_t), L'\0');
  if (!GetUserObjectInformationW(object, UOI_NAME, buffer.data(),
                                 required_bytes, &required_bytes)) {
    return false;
  }
  name->assign(buffer.data());
  return !name->empty();
}

bool IsPrivateProbeStation(const Win32ClipboardAdapter* adapter) {
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

bool MakeAnsiWindowsRoot(std::wstring* wide_root,
                         std::string* encoded_path) {
  if (wide_root == nullptr || encoded_path == nullptr) return false;
  std::array<wchar_t, MAX_PATH> windows_directory{};
  const UINT length = GetWindowsDirectoryW(
      windows_directory.data(), static_cast<UINT>(windows_directory.size()));
  if (length == 0 || length >= windows_directory.size() ||
      length < 3 || windows_directory[1] != L':') {
    return false;
  }
  *wide_root = std::wstring(1, windows_directory[0]) + L":\\";
  const UINT code_page = GetACP();
  const bool strict_unicode_page =
      code_page == CP_UTF8 || code_page == 54936;  // GB18030.
  const DWORD flags = strict_unicode_page
                          ? WC_ERR_INVALID_CHARS
                          : code_page == 65000 ? 0 : WC_NO_BEST_FIT_CHARS;
  BOOL used_default = FALSE;
  BOOL* used_default_out = strict_unicode_page || code_page == 65000
                               ? nullptr
                               : &used_default;
  const int required = WideCharToMultiByte(
      code_page, flags, wide_root->data(),
      static_cast<int>(wide_root->size()), nullptr, 0, nullptr,
      used_default_out);
  if (required <= 0 || used_default) return false;
  encoded_path->assign(static_cast<std::size_t>(required), '\0');
  used_default = FALSE;
  return WideCharToMultiByte(
             code_page, flags, wide_root->data(),
             static_cast<int>(wide_root->size()), encoded_path->data(),
             required, nullptr,
             used_default_out) == required &&
         !used_default;
}

bool TestAnsiAcpRoundTrip(Win32ClipboardAdapter* adapter) {
  std::wstring wide_root;
  std::string ansi_path;
  if (!MakeAnsiWindowsRoot(&wide_root, &ansi_path)) return false;
  const FormatPayload drop = MakeAnsiDrop(ansi_path);
  bool checked = false;
  const bool available = FileReferencesAvailableForPublish(
      {drop}, nullptr, [&](std::wstring_view path, bool is_directory) {
        checked = path == wide_root && is_directory;
        return checked;
      });
  return available && checked && PublishAndRoundTrip(adapter, drop);
}

bool RejectedContextPreservesClipboard(
    Win32ClipboardAdapter* adapter, const FormatPayload& payload,
    const Baseline& baseline) {
  unsigned int access_checks = 0;
  ClipboardFileReferenceTestAccess::SetAccessProbe(
      adapter, [&](std::wstring_view, bool) {
        ++access_checks;
        return true;
      });
  const OperationResult rejected =
      adapter->Publish(baseline.revision, {payload});
  ClipboardFileReferenceTestAccess::Clear(adapter);
  return access_checks == 0 &&
         rejected.status == OperationStatus::file_reference_unavailable &&
         rejected.reason == "file-reference-unavailable" &&
         !rejected.clipboard_may_have_changed &&
         rejected.expected_revision == baseline.revision &&
         rejected.observed_revision == baseline.revision &&
         adapter->Revision() == baseline.revision &&
         BaselineIsStillPresent(adapter, baseline);
}

bool TestAnsiContextChangePreservesClipboard(
    Win32ClipboardAdapter* adapter) {
  std::wstring wide_root;
  std::string ansi_path;
  if (!MakeAnsiWindowsRoot(&wide_root, &ansi_path)) return false;
  const std::uint32_t current_code_page = GetACP();
  const std::uint32_t alternate_code_page =
      current_code_page == CP_UTF8 ? 1252u : CP_UTF8;
  auto stale = MakeAnsiDrop(ansi_path);
  stale.validation_code_page = alternate_code_page;

  Baseline baseline;
  if (!PutBaseline(adapter, &baseline)) return false;
  auto missing_context = MakeAnsiDrop(ansi_path);
  missing_context.validation_code_page.reset();
  const bool stale_context_rejected =
      RejectedContextPreservesClipboard(adapter, stale, baseline);
  const bool missing_context_rejected =
      RejectedContextPreservesClipboard(adapter, missing_context, baseline);
  return stale_context_rejected && missing_context_rejected;
}

bool TestRejectedPath(const FormatPayload& drop) {
  unsigned int access_checks = 0;
  std::string error;
  const bool available = FileReferencesAvailableForPublish(
      {drop}, &error, [&](std::wstring_view, bool) {
        ++access_checks;
        return true;
      });
  return !available && error == "file-reference-unavailable" &&
         access_checks == 0;
}

}  // namespace

std::vector<CaseResult> RunFileReferenceCases(
    Win32ClipboardAdapter* adapter) {
  std::vector<CaseResult> results;
  if (adapter == nullptr || !adapter->IsInitialized() ||
      !IsPrivateProbeStation(adapter)) {
    for (const char* id : kCaseIds) {
      results.push_back(CaseResult{id, "not-run",
                                   "isolated station unavailable"});
    }
    return results;
  }

  ClipboardFileReferenceFixture fixture;
  const bool fixture_created = fixture.Create();
  const bool valid_roundtrip = fixture_created &&
      PublishAndRoundTrip(adapter,
          MakeDrop({AsUtf16(fixture.File()), AsUtf16(fixture.Directory())}));
  Add(&results, kCaseIds[0], valid_roundtrip);

  bool deleted_capture_kept_bytes = false;
  if (fixture_created) {
    const auto original = MakeDrop({AsUtf16(fixture.File())});
    const OperationResult published =
        adapter->Publish(adapter->Revision(), {original});
    ClipboardSnapshot before_delete;
    const OperationResult captured =
        published.status == OperationStatus::committed
            ? adapter->Capture(published.observed_revision, &before_delete)
            : OperationResult{};
    if (captured.status == OperationStatus::committed &&
        fixture.DeleteFile()) {
      ClipboardSnapshot after_delete;
      const OperationResult reread =
          adapter->Capture(published.observed_revision, &after_delete);
      deleted_capture_kept_bytes =
          self_test_comparison::CompleteCaptureMatchesExactly(
              before_delete.formats, reread, after_delete, false);
    }
  }
  Add(&results, kCaseIds[1], deleted_capture_kept_bytes);

  const bool deleted_preserves =
      RejectMissingReferencePreservesBoard(adapter, false);
  Add(&results, kCaseIds[2], deleted_preserves);

  const bool moved_preserves =
      RejectMissingReferencePreservesBoard(adapter, true);
  Add(&results, kCaseIds[3], moved_preserves);

  bool denied_preserves = false;
  ClipboardFileReferenceFixture denied_fixture;
  if (denied_fixture.Create()) {
    Baseline baseline;
    if (PutBaseline(adapter, &baseline)) {
      const auto drop = MakeDrop({AsUtf16(denied_fixture.File())});
      bool saw_file = false;
      ClipboardFileReferenceTestAccess::SetAccessProbe(
          adapter, [&](std::wstring_view path, bool is_directory) {
            saw_file = path == denied_fixture.File() && !is_directory;
            return false;
          });
      const OperationResult rejected =
          adapter->Publish(baseline.revision, {drop});
      ClipboardFileReferenceTestAccess::Clear(adapter);
      denied_preserves =
          saw_file &&
          rejected.status == OperationStatus::file_reference_unavailable &&
          rejected.reason == "file-reference-unavailable" &&
          !rejected.clipboard_may_have_changed &&
          rejected.observed_revision == baseline.revision &&
          BaselineIsStillPresent(adapter, baseline);
    }
  }
  Add(&results, kCaseIds[4], denied_preserves,
      "simulated-access-denial-preserved-clipboard",
      "simulated-access-denial-did-not-preserve-clipboard");

  Add(&results, kCaseIds[5], TestRevisionRace(adapter),
      "simulated-revision-change-returned-superseded",
      "simulated-revision-change-not-superseded");
  Add(&results, kCaseIds[6], TestAnsiAcpRoundTrip(adapter));

  const std::string invalid_ansi_path = std::string("C:\\") + char(1);
  const auto invalid_ansi = MakeAnsiDrop(invalid_ansi_path);
  Add(&results, kCaseIds[7], TestRejectedPath(invalid_ansi));
  Add(&results, kCaseIds[8],
      fixture_created && TestAnsiContextChangePreservesClipboard(adapter));
  Add(&results, kCaseIds[9],
      TestRejectedPath(MakeDrop({u"relative\\file.txt"})));
  const bool device_paths_rejected =
      TestRejectedPath(MakeDrop({u"\\\\.\\pipe\\clipboard"})) &&
      TestRejectedPath(MakeDrop({u"\\Device\\HarddiskVolume1\\file.txt"})) &&
      TestRejectedPath(
          MakeDrop({u"\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\file.txt"})) &&
      TestRejectedPath(MakeDrop({u"C:\\COM\u00b9"})) &&
      TestRejectedPath(MakeDrop({u"C:\\LPT\u00b2"}));
  Add(&results, kCaseIds[10], device_paths_rejected);

  if (!fixture_created || !fixture.CreateDirectoryJunction()) {
    results.push_back(CaseResult{kCaseIds[11], "not-run",
                                 "junction-fixture-unavailable"});
  } else {
    const bool linked_roundtrip = PublishAndRoundTrip(
        adapter, MakeDrop({AsUtf16(fixture.DirectoryJunction())}));
    Add(&results, kCaseIds[11], linked_roundtrip,
        "junction-target-roundtrip-preserved-original-bytes",
        "junction-target-roundtrip-failed");
    Baseline final_baseline;
    if (!PutBaseline(adapter, &final_baseline) && linked_roundtrip) {
      results.back() = CaseResult{
          kCaseIds[11], "fail",
          "junction-roundtrip-could-not-restore-private-board"};
    }
  }

  ClipboardFileReferenceTestAccess::Clear(adapter);
  return results;
}

}  // namespace clipboard_format_probe
