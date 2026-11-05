#include "clipboard_self_test_native.h"
#include "clipboard_self_test_comparison.h"

#include "../common/clipboard_codecs.h"
#include "clipboard_formats.h"
#include "clipboard_file_reference_fixture.h"
#include "clipboard_probe.h"
#include "clipboard_self_test_fixtures.h"

#include <algorithm>
#include <cstring>
#include <new>
#include <string>
#include <utility>
#include <windows.h>

namespace clipboard_format_probe {
namespace {

void Add(std::vector<CaseResult>* cases, const char* id, bool passed) {
  cases->push_back(CaseResult{id, passed ? "pass" : "fail",
                              passed ? "native-format-roundtrip"
                                     : "native-format-roundtrip-failed"});
}

FormatPayload MakePayload(const char* key, const wchar_t* native_name, UINT id,
                          std::string encoding, std::string fidelity,
                          std::string source, std::vector<std::uint8_t> bytes) {
  FormatPayload result;
  result.key = key;
  result.native_name = native_name;
  result.format_id = id;
  result.encoding = std::move(encoding);
  result.fidelity = std::move(fidelity);
  result.source_format = std::move(source);
  result.source_origin = "unknown";
  result.materialization =
      result.key == "bitmap" ? "win32-getdibits-24bpp-top-down"
      : result.key == "palette"
          ? "win32-getpaletteentries-logpalette-v0300"
          : "current-clipboard-format-bytes";
  result.bytes = std::move(bytes);
  return result;
}

bool InjectUnsupportedEnhMetafile(Win32ClipboardAdapter* adapter) {
  HDC metafile_dc = CreateEnhMetaFileW(nullptr, nullptr, nullptr,
                                       L"Clipboard format probe");
  if (metafile_dc == nullptr) return false;
  HENHMETAFILE metafile = CloseEnhMetaFile(metafile_dc);
  if (metafile == nullptr) return false;
  if (!OpenClipboard(adapter->Window())) {
    DeleteEnhMetaFile(metafile);
    return false;
  }
  const bool written = SetClipboardData(
      CF_ENHMETAFILE, reinterpret_cast<HANDLE>(metafile)) != nullptr;
  if (!written) DeleteEnhMetaFile(metafile);
  const bool closed = CloseClipboard() != FALSE;
  return written && closed;
}

bool InjectOverLimitRegisteredFormats(Win32ClipboardAdapter* adapter) {
  std::vector<UINT> format_ids;
  std::vector<HGLOBAL> memory_blocks;
  try {
    format_ids.reserve(kMaximumFormats + 1);
    memory_blocks.reserve(kMaximumFormats + 1);
    for (std::size_t index = 0; index < kMaximumFormats + 1; ++index) {
      std::wstring name = L"ClipboardProbeOverLimitFormat_";
      name += std::to_wstring(index);
      const UINT format_id = RegisterClipboardFormatW(name.c_str());
      if (format_id == 0) return false;
      format_ids.push_back(format_id);
    }
  } catch (const std::bad_alloc&) {
    return false;
  }

  for (std::size_t index = 0; index < format_ids.size(); ++index) {
    HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, sizeof(std::uint32_t));
    if (memory == nullptr) break;
    auto* target = static_cast<std::uint8_t*>(GlobalLock(memory));
    if (target == nullptr) {
      GlobalFree(memory);
      break;
    }
    const std::uint32_t marker = static_cast<std::uint32_t>(index);
    std::memcpy(target, &marker, sizeof(marker));
    GlobalUnlock(memory);
    memory_blocks.push_back(memory);
  }
  if (memory_blocks.size() != format_ids.size() ||
      !OpenClipboard(adapter->Window())) {
    for (const auto memory : memory_blocks) GlobalFree(memory);
    return false;
  }

  bool written = EmptyClipboard() != FALSE;
  for (std::size_t index = 0; written && index < format_ids.size(); ++index) {
    if (SetClipboardData(format_ids[index], memory_blocks[index]) == nullptr) {
      written = false;
    } else {
      memory_blocks[index] = nullptr;
    }
  }
  const bool closed = CloseClipboard() != FALSE;
  for (const auto memory : memory_blocks) {
    if (memory != nullptr) GlobalFree(memory);
  }
  return written && closed;
}

bool RoundTrip(Win32ClipboardAdapter* adapter,
               const std::vector<FormatPayload>& expected) {
  if (adapter == nullptr || expected.empty()) return false;
  const OperationResult initial_publish =
      adapter->Publish(adapter->Revision(), expected);
  std::vector<std::string> expected_keys;
  expected_keys.reserve(expected.size());
  for (const auto& format : expected) expected_keys.push_back(format.key);
  if (initial_publish.status != OperationStatus::committed ||
      initial_publish.planned_keys != expected_keys ||
      initial_publish.written_keys != expected_keys ||
      !initial_publish.missing_keys.empty()) {
    return false;
  }
  ClipboardSnapshot initial_capture;
  const OperationResult initial_read =
      adapter->Capture(initial_publish.observed_revision, &initial_capture);
  if (!self_test_comparison::CompleteCaptureMatchesPublished(
          expected, initial_read, initial_capture, true)) {
    return false;
  }

  const auto frozen_formats = initial_capture.formats;
  const OperationResult replay_publish =
      adapter->Publish(initial_read.observed_revision, frozen_formats);
  std::vector<std::string> frozen_keys;
  frozen_keys.reserve(frozen_formats.size());
  for (const auto& format : frozen_formats) frozen_keys.push_back(format.key);
  if (replay_publish.status != OperationStatus::committed ||
      replay_publish.planned_keys != frozen_keys ||
      replay_publish.written_keys != frozen_keys ||
      !replay_publish.missing_keys.empty()) {
    return false;
  }
  ClipboardSnapshot replay_capture;
  const OperationResult replay_read =
      adapter->Capture(replay_publish.observed_revision, &replay_capture);
  return self_test_comparison::CompleteCaptureMatchesExactly(
      frozen_formats, replay_read, replay_capture, true);
}

bool OtherNativeRejectedAndNotReplayed(Win32ClipboardAdapter* adapter) {
  FormatPayload baseline = test_fixtures::MakeText(CF_UNICODETEXT);
  if (!RoundTrip(adapter, {baseline}) || !InjectUnsupportedEnhMetafile(adapter)) {
    return false;
  }
  ClipboardSnapshot partial;
  const OperationResult capture = adapter->Capture(adapter->Revision(), &partial);
  const std::string unknown_key = "format-id-" +
                                  std::to_string(CF_ENHMETAFILE);
  const auto known_text = std::find_if(
      partial.formats.begin(), partial.formats.end(),
      [](const FormatPayload& item) { return item.key == "text"; });
  if (capture.status != OperationStatus::unsupported_format ||
      std::find(capture.missing_keys.begin(), capture.missing_keys.end(),
                unknown_key) == capture.missing_keys.end() ||
      known_text == partial.formats.end()) {
    return false;
  }
  return RoundTrip(adapter, partial.formats) &&
         CapturesOverLimitAsIncomplete(adapter, partial.formats);
}

bool RestoreClipboard(Win32ClipboardAdapter* adapter,
                      const std::vector<FormatPayload>& recovery) {
  return adapter->Publish(adapter->Revision(), recovery).status ==
         OperationStatus::committed;
}

}  // namespace

void AddNativeNotRunCases(ProbeReport* report) {
  if (report == nullptr) return;
  for (const char* id : {"cf-dib", "cf-dibv5", "cf-bitmap", "cf-hdrop",
                         "ansi-text", "cf-locale", "other-native-formats"}) {
    report->cases.push_back(CaseResult{id, "not-run", "case-not-run"});
  }
}

bool RejectsInvalidNativePlans(
    Win32ClipboardAdapter* adapter,
    const std::vector<FormatPayload>& recovery) {
  if (adapter == nullptr || recovery.empty()) return false;
  const std::vector<FormatPayload> mismatched = {
      test_fixtures::MakeBitmap(CF_DIB),
      test_fixtures::MakeDib(CF_BITMAP, false)};
  for (const auto& payload : mismatched) {
    const std::uint32_t revision = adapter->Revision();
    const OperationResult rejected = adapter->Publish(revision, {payload});
    if (rejected.status != OperationStatus::invalid_request ||
        rejected.clipboard_may_have_changed || adapter->Revision() != revision) {
      RestoreClipboard(adapter, recovery);
      return false;
    }
  }
  FormatPayload wrong_encoding = DescribeOsClipboardBytes(
      "text", L"CF_UNICODETEXT", CF_UNICODETEXT, "utf8", "CF_UNICODETEXT");
  wrong_encoding.bytes = {'o', 0, 0, 0};
  const FormatPayload wrong_registered_id =
      test_fixtures::MakeHtml(CF_UNICODETEXT);
  for (const auto& payload : {wrong_encoding, wrong_registered_id}) {
    const std::uint32_t revision = adapter->Revision();
    const OperationResult rejected = adapter->Publish(revision, {payload});
    if (rejected.status != OperationStatus::invalid_request ||
        rejected.clipboard_may_have_changed || adapter->Revision() != revision) {
      RestoreClipboard(adapter, recovery);
      return false;
    }
  }
  std::vector<FormatPayload> over_limit(kMaximumFormats + 1, recovery.front());
  const std::uint32_t revision = adapter->Revision();
  const OperationResult rejected = adapter->Publish(revision, over_limit);
  if (rejected.status != OperationStatus::invalid_request ||
      rejected.clipboard_may_have_changed || adapter->Revision() != revision) {
    RestoreClipboard(adapter, recovery);
    return false;
  }
  return true;
}

bool CapturesOverLimitAsIncomplete(
    Win32ClipboardAdapter* adapter,
    const std::vector<FormatPayload>& recovery) {
  if (adapter == nullptr || recovery.empty()) return false;
  if (!RestoreClipboard(adapter, recovery) ||
      !InjectOverLimitRegisteredFormats(adapter)) {
    RestoreClipboard(adapter, recovery);
    return false;
  }
  ClipboardSnapshot snapshot;
  const OperationResult captured = adapter->Capture(adapter->Revision(), &snapshot);
  const bool limit_reported =
      std::find(captured.missing_keys.begin(), captured.missing_keys.end(),
                "format-enumeration-limit") != captured.missing_keys.end();
  const bool incomplete = captured.status != OperationStatus::committed &&
                          !captured.missing_keys.empty() && limit_reported;
  return RestoreClipboard(adapter, recovery) && incomplete;
}

std::vector<CaseResult> RunNativeFormatCases(Win32ClipboardAdapter* adapter) {
  std::vector<CaseResult> results;
  Add(&results, "cf-dib",
      RoundTrip(adapter, {test_fixtures::MakeDib(CF_DIB, false)}));
  Add(&results, "cf-dibv5",
      RoundTrip(adapter, {test_fixtures::MakeDib(CF_DIBV5, true)}));
  Add(&results, "cf-bitmap",
      RoundTrip(adapter, {test_fixtures::MakeBitmap(CF_BITMAP),
                          test_fixtures::MakePalette()}));

  ClipboardFileReferenceFixture file_reference_fixture;
  const bool fixture_created = file_reference_fixture.Create();
  std::vector<std::uint8_t> drop_bytes;
  const bool drop_built = fixture_created &&
      clipboard_codecs::BuildDropFilesWide(
          {std::u16string(file_reference_fixture.File().begin(),
                          file_reference_fixture.File().end()),
           std::u16string(file_reference_fixture.Directory().begin(),
                          file_reference_fixture.Directory().end())},
          &drop_bytes);
  const FormatPayload drop = MakePayload(
      "file-list", L"CF_HDROP", CF_HDROP, "utf16le-dropfiles",
      "representation-bytes-preserved", "CF_HDROP", std::move(drop_bytes));
  Add(&results, "cf-hdrop", drop_built && RoundTrip(adapter, {drop}));

  const std::vector<FormatPayload> ansi = {
      MakePayload("text-acp", L"CF_TEXT", CF_TEXT, "windows-acp-raw",
                  "representation-bytes-preserved", "CF_TEXT",
                  {'A', 'C', 'P', 0}),
      MakePayload("text-oem", L"CF_OEMTEXT", CF_OEMTEXT,
                  "windows-oemcp-raw", "representation-bytes-preserved",
                  "CF_OEMTEXT",
                  {'O', 'E', 'M', 0}),
      MakePayload("locale", L"CF_LOCALE", CF_LOCALE, "windows-lcid-le",
                  "representation-bytes-preserved", "CF_LOCALE",
                  {0x09, 0x04, 0, 0})};
  Add(&results, "ansi-text", RoundTrip(adapter, ansi));
  Add(&results, "cf-locale", RoundTrip(adapter, {ansi[2]}));
  Add(&results, "other-native-formats",
      OtherNativeRejectedAndNotReplayed(adapter));
  return results;
}

}  // namespace clipboard_format_probe
