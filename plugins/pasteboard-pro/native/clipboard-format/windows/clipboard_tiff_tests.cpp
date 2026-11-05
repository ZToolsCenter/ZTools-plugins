#include "clipboard_tiff_tests.h"

#include "clipboard_self_test_fixtures.h"
#include "clipboard_tiff_fixture.h"
#include "clipboard_tiff_wic.h"
#include "../common/clipboard_tiff.h"

#include <array>
#include <cstdint>
#include <cstring>
#include <functional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace clipboard_format_probe {
class ClipboardTiffTestAccess final {
 public:
  static void SetValidator(
      Win32ClipboardAdapter* adapter,
      std::function<bool(const std::vector<std::uint8_t>&, std::string*)>
          validator) {
    adapter->tiff_validator_for_testing_ = std::move(validator);
  }
};

namespace {

constexpr std::array<const char*, 8> kCaseIds = {
    "cf-tiff-byte-roundtrip",
    "cf-tiff-multipage-roundtrip",
    "cf-tiff-16bit-alpha-roundtrip",
    "cf-tiff-malformed-image-rejected",
    "cf-tiff-pixel-budget-rejected",
    "cf-tiff-capture-validates-after-close",
    "cf-tiff-format-id-mismatch-rejected",
    "cf-tiff-validator-exception-is-partial",
};

void Add(std::vector<CaseResult>* results, const char* id,
         const char* status, const char* detail) {
  results->push_back(CaseResult{id, status, detail});
}

std::vector<CaseResult> AllNotRun(const char* detail) {
  std::vector<CaseResult> results;
  results.reserve(kCaseIds.size());
  for (const char* id : kCaseIds) Add(&results, id, "not-run", detail);
  return results;
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

bool SameTiffCapture(const FormatPayload& expected,
                     const ClipboardSnapshot& snapshot) {
  if (!snapshot.missing_keys.empty() || snapshot.formats.size() != 1) {
    return false;
  }
  const FormatPayload& actual = snapshot.formats.front();
  return actual.key == expected.key &&
         actual.native_name == expected.native_name &&
         actual.format_id == expected.format_id &&
         actual.bytes == expected.bytes &&
         actual.encoding == expected.encoding &&
         actual.fidelity == expected.fidelity &&
         actual.source_format == expected.source_format &&
         actual.source_origin == expected.source_origin &&
         actual.materialization == expected.materialization;
}

bool SameTextCapture(const FormatPayload& expected,
                     const ClipboardSnapshot& snapshot) {
  if (snapshot.formats.size() != 1 || !snapshot.missing_keys.empty()) {
    return false;
  }
  const FormatPayload& actual = snapshot.formats.front();
  return actual.key == expected.key && actual.format_id == expected.format_id &&
         actual.bytes == expected.bytes;
}

bool RoundTripTiff(Win32ClipboardAdapter* adapter,
                   const FormatPayload& expected) {
  const OperationResult published =
      adapter->Publish(adapter->Revision(), {expected});
  if (published.status != OperationStatus::committed ||
      published.written_keys != std::vector<std::string>{expected.key} ||
      !published.clipboard_may_have_changed) {
    return false;
  }
  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &snapshot);
  return captured.status == OperationStatus::committed &&
         SameTiffCapture(expected, snapshot);
}

bool PublishRejectedWithoutChangingTiff(Win32ClipboardAdapter* adapter,
                                        const FormatPayload& invalid) {
  const FormatPayload baseline =
      tiff_fixtures::MakeTiff(CF_TIFF);
  const OperationResult baseline_publish =
      adapter->Publish(adapter->Revision(), {baseline});
  if (baseline_publish.status != OperationStatus::committed) return false;
  const std::uint32_t baseline_revision = baseline_publish.observed_revision;

  ClipboardSnapshot before;
  const OperationResult before_capture =
      adapter->Capture(baseline_revision, &before);
  if (before_capture.status != OperationStatus::committed ||
      !SameTiffCapture(baseline, before) ||
      adapter->Revision() != baseline_revision) {
    return false;
  }

  const OperationResult rejected =
      adapter->Publish(baseline_revision, {invalid});
  const bool rejected_before_open =
      rejected.status == OperationStatus::invalid_request &&
      !rejected.clipboard_may_have_changed &&
      rejected.observed_revision == baseline_revision &&
      adapter->Revision() == baseline_revision;

  ClipboardSnapshot after;
  const OperationResult after_capture =
      adapter->Capture(baseline_revision, &after);
  return rejected_before_open &&
         after_capture.status == OperationStatus::committed &&
         SameTiffCapture(baseline, after) && SameTiffCapture(baseline, before);
}

class TiffValidatorReset final {
 public:
  explicit TiffValidatorReset(Win32ClipboardAdapter* adapter)
      : adapter_(adapter) {}
  TiffValidatorReset(const TiffValidatorReset&) = delete;
  TiffValidatorReset& operator=(const TiffValidatorReset&) = delete;
  ~TiffValidatorReset() {
    ClipboardTiffTestAccess::SetValidator(adapter_, {});
  }

 private:
  Win32ClipboardAdapter* adapter_;
};

struct TiffCaptureValidationEvidence {
  Win32ClipboardAdapter* adapter = nullptr;
  std::uint32_t captured_revision = 0;
  FormatPayload next_clipboard_text;
  std::size_t validator_calls = 0;
  std::size_t wic_calls = 0;
  bool no_open_clipboard_window = false;
  bool clipboard_reopened = false;
  bool clipboard_reclosed = false;
  bool wic_valid = false;
  OperationResult publication;

  bool Validate(const std::vector<std::uint8_t>& bytes, std::string* error) {
    ++validator_calls;
    no_open_clipboard_window = GetOpenClipboardWindow() == nullptr;
    clipboard_reopened = no_open_clipboard_window &&
                         OpenClipboard(adapter->Window()) != FALSE;
    if (clipboard_reopened) clipboard_reclosed = CloseClipboard() != FALSE;
    if (clipboard_reclosed) {
      publication = adapter->Publish(captured_revision, {next_clipboard_text});
    }
    ++wic_calls;
    wic_valid = ValidateTiffPixels(bytes, error);
    return wic_valid;
  }
};

bool CaptureValidatesTiffAfterClose(Win32ClipboardAdapter* adapter,
                                    const FormatPayload& tiff) {
  const OperationResult baseline_publish =
      adapter->Publish(adapter->Revision(), {tiff});
  if (baseline_publish.status != OperationStatus::committed) return false;

  TiffCaptureValidationEvidence evidence;
  evidence.adapter = adapter;
  evidence.captured_revision = baseline_publish.observed_revision;
  evidence.next_clipboard_text = test_fixtures::MakeText(CF_UNICODETEXT);
  ClipboardTiffTestAccess::SetValidator(
      adapter, [&evidence](const std::vector<std::uint8_t>& bytes,
                           std::string* error) {
        return evidence.Validate(bytes, error);
      });
  TiffValidatorReset restore_validator(adapter);

  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(evidence.captured_revision, &snapshot);
  return captured.status == OperationStatus::committed &&
         captured.expected_revision == evidence.captured_revision &&
         captured.observed_revision == evidence.publication.observed_revision &&
         captured.observed_revision == adapter->Revision() &&
         snapshot.revision_before_open == evidence.captured_revision &&
         snapshot.revision_after_materialization == evidence.captured_revision &&
         SameTiffCapture(tiff, snapshot) && evidence.validator_calls == 1 &&
         evidence.wic_calls == 1 && evidence.no_open_clipboard_window &&
         evidence.clipboard_reopened && evidence.clipboard_reclosed &&
         evidence.wic_valid &&
         evidence.publication.status == OperationStatus::committed &&
         evidence.publication.observed_revision != evidence.captured_revision;
}

bool CaptureValidatorExceptionIsPartial(Win32ClipboardAdapter* adapter,
                                        const FormatPayload& tiff) {
  const FormatPayload text = test_fixtures::MakeText(CF_UNICODETEXT);
  const OperationResult published =
      adapter->Publish(adapter->Revision(), {tiff, text});
  if (published.status != OperationStatus::committed) return false;

  std::size_t validator_calls = 0;
  ClipboardTiffTestAccess::SetValidator(
      adapter, [&validator_calls](const std::vector<std::uint8_t>&,
                                  std::string*) -> bool {
        ++validator_calls;
        throw std::runtime_error("private TIFF validator fixture");
      });
  TiffValidatorReset restore_validator(adapter);

  ClipboardSnapshot snapshot;
  const OperationResult captured =
      adapter->Capture(published.observed_revision, &snapshot);
  return captured.status == OperationStatus::partial_capture &&
         captured.expected_revision == published.observed_revision &&
         snapshot.missing_keys == std::vector<std::string>{"tiff"} &&
         snapshot.formats.size() == 1 &&
         snapshot.formats.front().key == "text" &&
         snapshot.formats.front().format_id == text.format_id &&
         snapshot.formats.front().bytes == text.bytes && validator_calls == 1;
}

}  // namespace

std::vector<CaseResult> RunTiffFormatCases(Win32ClipboardAdapter* adapter) {
  if (adapter == nullptr || adapter->Window() == nullptr) {
    return AllNotRun("adapter-unavailable");
  }
  if (!IsPrivateProbeStation(adapter)) {
    return AllNotRun("private-station-required");
  }

  std::vector<CaseResult> results;
  results.reserve(kCaseIds.size());
  const FormatPayload tiff = tiff_fixtures::MakeTiff(CF_TIFF);
  const bool byte_round_trip = RoundTripTiff(adapter, tiff);
  Add(&results, kCaseIds[0], byte_round_trip ? "pass" : "fail",
      byte_round_trip ? "cf-tiff-representation-bytes-preserved"
                      : "cf-tiff-byte-roundtrip-failed");

  const FormatPayload multipage = tiff_fixtures::MakeMultipageTiff(CF_TIFF);
  const bool multipage_round_trip = RoundTripTiff(adapter, multipage);
  Add(&results, kCaseIds[1], multipage_round_trip ? "pass" : "fail",
      multipage_round_trip ? "cf-tiff-all-main-ifd-pages-validated"
                           : "cf-tiff-multipage-roundtrip-failed");

  const FormatPayload alpha = tiff_fixtures::Make16BitAlphaTiff(CF_TIFF);
  const bool alpha_round_trip = RoundTripTiff(adapter, alpha);
  Add(&results, kCaseIds[2], alpha_round_trip ? "pass" : "fail",
      alpha_round_trip ? "cf-tiff-16bit-alpha-bytes-preserved"
                       : "cf-tiff-16bit-alpha-roundtrip-failed");

  const FormatPayload malformed =
      tiff_fixtures::MakeMalformedCompressedTiff(CF_TIFF);
  clipboard_codecs::TiffLayout malformed_layout;
  const bool malformed_is_structural =
      clipboard_codecs::AnalyzeTiff(
          malformed.bytes.data(), malformed.bytes.size(), &malformed_layout) &&
      malformed_layout.logical_bytes == malformed.bytes.size();
  std::string malformed_error;
  const bool malformed_rejected =
      malformed_is_structural &&
      !ValidateTiffPixels(malformed.bytes, &malformed_error) &&
      PublishRejectedWithoutChangingTiff(adapter, malformed);
  Add(&results, kCaseIds[3], malformed_rejected ? "pass" : "fail",
      malformed_rejected ? "cf-tiff-structural-image-rejected-by-wic"
                         : "cf-tiff-malformed-image-not-rejected");

  const FormatPayload over_budget = tiff_fixtures::MakePixelBudgetTiff(CF_TIFF);
  clipboard_codecs::TiffLayout budget_layout;
  const bool over_budget_rejected =
      !clipboard_codecs::AnalyzeTiff(
          over_budget.bytes.data(), over_budget.bytes.size(), &budget_layout) &&
      PublishRejectedWithoutChangingTiff(adapter, over_budget);
  Add(&results, kCaseIds[4], over_budget_rejected ? "pass" : "fail",
      over_budget_rejected ? "cf-tiff-pixel-budget-rejected-before-wic"
                           : "cf-tiff-pixel-budget-not-enforced");

  const bool capture_after_close = CaptureValidatesTiffAfterClose(adapter, tiff);
  Add(&results, kCaseIds[5], capture_after_close ? "pass" : "fail",
      capture_after_close ? "cf-tiff-validation-runs-after-close"
                          : "cf-tiff-capture-order-or-snapshot-failed");

  FormatPayload mismatch = tiff;
  mismatch.format_id = RegisterClipboardFormatW(
      L"application/x-pasteboardpro-tiff-mismatch-v09");
  const bool mismatch_rejected =
      mismatch.format_id != 0 &&
      PublishRejectedWithoutChangingTiff(adapter, mismatch);
  Add(&results, kCaseIds[6], mismatch_rejected ? "pass" : "fail",
      mismatch_rejected ? "cf-tiff-format-id-mismatch-rejected"
                        : "cf-tiff-format-id-mismatch-accepted");

  const bool exception_partial =
      CaptureValidatorExceptionIsPartial(adapter, tiff);
  Add(&results, kCaseIds[7], exception_partial ? "pass" : "fail",
      exception_partial ? "cf-tiff-validator-exception-preserves-text"
                        : "cf-tiff-validator-exception-lost-other-format");
  return results;
}

}  // namespace clipboard_format_probe
